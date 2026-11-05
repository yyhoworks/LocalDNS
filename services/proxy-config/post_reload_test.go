package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const hookCredentialFixture = "synthetic-fixture-credential-7319"

// Run a real subprocess on both Windows and Linux, using only loopback test
// fixtures. No shell, production core or service manager is involved.
func TestPostReloadProcessHelper(t *testing.T) {
	for i, arg := range os.Args {
		if arg != "--post-reload-test" || i+1 >= len(os.Args) {
			continue
		}
		if os.Args[i+1] == "sleep" {
			time.Sleep(10 * time.Second)
		} else {
			response, err := http.Get(os.Args[i+1])
			if err != nil {
				os.Exit(2)
			}
			response.Body.Close()
		}
		fmt.Fprintln(os.Stderr, hookCredentialFixture)
		os.Exit(1)
	}
}

func helperHook(t *testing.T, action string) []string {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return []string{executable, "-test.run=^TestPostReloadProcessHelper$", "--", "--post-reload-test", action}
}

func TestPostReloadHealthDeterminesRollbackMessage(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		applyOnline, rollbackOnline  bool
		transient, initialPUTFailure bool
	}{
		{name: "hook fails but core stays online", applyOnline: true, rollbackOnline: true},
		{name: "hook leaves core unavailable"},
		{name: "rollback restores online core", rollbackOnline: true},
		{name: "listener returns after transient failure", applyOnline: true, rollbackOnline: true, transient: true},
		{name: "reload fails then rollback hook fails", rollbackOnline: true, initialPUTFailure: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, path := importTestServer(t)
			var puts, hooks, checks, checksSinceHook atomic.Int32
			var healthy atomic.Bool
			healthy.Store(true)
			controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == "PUT" && r.URL.Path == "/configs":
					count := puts.Add(1)
					healthy.Store(true)
					if tc.initialPUTFailure && count == 1 {
						w.WriteHeader(500)
						return
					}
				case r.URL.Path == "/hook":
					hooks.Add(1)
					checksSinceHook.Store(0)
					healthy.Store(tc.applyOnline && puts.Load() == 1 || tc.rollbackOnline && puts.Load() == 2)
				case r.URL.Path == "/version":
					checks.Add(1)
					if !healthy.Load() || (tc.transient && hooks.Load() > 0 && checksSinceHook.Add(1) == 1) {
						w.WriteHeader(503)
						return
					}
				default:
					w.WriteHeader(404)
					return
				}
				w.WriteHeader(204)
			}))
			defer controller.Close()
			before := []byte("external-controller: " + strings.TrimPrefix(controller.URL, "http://") + "\nmode: rule\n")
			if err := os.WriteFile(path, before, 0600); err != nil {
				t.Fatal(err)
			}
			core := s.config.Cores["mihomo"]
			core.PostReload = helperHook(t, controller.URL+"/hook")
			s.config.Cores["mihomo"] = core
			s.reload, s.reloadReady = reloadCore, reloadReady
			response := importCall(s, "save", request{Core: "mihomo", Path: path, Revision: digest(before), Content: string(before) + "rules:\n - MATCH,DIRECT\n"})
			var result struct {
				Error, Detail string
				RolledBack    bool
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if response.Code != 502 || !result.RolledBack {
				t.Fatalf("save did not roll back: %s", response.Body.String())
			}
			confirmed := strings.Contains(result.Error, "核心在线检查通过")
			uncertain := strings.Contains(result.Error, "核心恢复尚未确认")
			if confirmed != tc.rollbackOnline || uncertain == tc.rollbackOnline {
				t.Fatalf("wrong recovery conclusion: %s", result.Error)
			}
			wantHooks := int32(2)
			if tc.initialPUTFailure {
				wantHooks = 1
			}
			if puts.Load() != 2 || hooks.Load() != wantHooks || checks.Load() < 1+wantHooks {
				t.Fatalf("missing reload/hook/health checks: puts=%d hooks=%d checks=%d", puts.Load(), hooks.Load(), checks.Load())
			}
			if !strings.Contains(result.Detail, "exit status 1") || strings.Contains(response.Body.String(), hookCredentialFixture) {
				t.Fatal("missing exit status or leaked hook output")
			}
			if restored, err := os.ReadFile(path); err != nil || !bytes.Equal(restored, before) {
				t.Fatal("original file not restored")
			}
		})
	}
}

func TestInvalidHookBlocksActiveSaveBeforeMutation(t *testing.T) {
	for _, hook := range [][]string{
		{"curl -H Authorization:Bearer=" + hookCredentialFixture + " https://example.invalid/reload"},
		{filepath.Join(t.TempDir(), hookCredentialFixture)},
		{""},
	} {
		s, path := importTestServer(t)
		before, _ := os.ReadFile(path)
		core := s.config.Cores["mihomo"]
		core.PostReload = hook
		s.config.Cores["mihomo"] = core
		s.reloadReady = func(context.Context, string, Core, []byte, []byte) error {
			t.Fatal("invalid hook reached core preflight")
			return nil
		}
		s.reload = func(context.Context, string, Core, string, []byte) error {
			t.Fatal("invalid hook reached reload")
			return nil
		}
		input := request{Core: "mihomo", Path: path, Revision: digest(before), Content: "mode: global\n"}
		response := importCall(s, "save", input)
		if response.Code != 422 || !strings.Contains(response.Body.String(), "postReload") || strings.Contains(response.Body.String(), hookCredentialFixture) {
			t.Fatalf("wrong preflight response: %s", response.Body.String())
		}
		if current, _ := os.ReadFile(path); !bytes.Equal(current, before) {
			t.Fatal("invalid hook changed original file")
		}
		if _, err := os.Stat(filepath.Join(filepath.Dir(path), "localdns-backups")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("invalid hook created a backup")
		}
		if check := importCall(s, "check", input); check.Code != 200 {
			t.Fatal("invalid hook disabled config checking")
		}
		backup := filepath.Join(filepath.Dir(path), "standalone.yaml")
		if err := os.WriteFile(backup, before, 0600); err != nil {
			t.Fatal(err)
		}
		input.Path = backup
		if save := importCall(s, "save", input); save.Code != 200 {
			t.Fatalf("invalid hook blocked standalone save: %s", save.Body.String())
		}
	}
}

func TestHookDiagnosticsDoNotExposeCredentials(t *testing.T) {
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)
	for _, program := range []string{
		"curl -H Authorization:Bearer=" + hookCredentialFixture + " https://example.invalid/reload",
		filepath.Join(t.TempDir(), hookCredentialFixture),
	} {
		err := validatePostReload(Config{Cores: map[string]Core{"mihomo": {PostReload: []string{program}}}})
		if err == nil {
			t.Fatal("bad hook accepted")
		}
		log.Printf("warning: %v", err)
		failure := &hookError{err: &os.PathError{Op: "fork/exec", Path: program, Err: os.ErrNotExist}, hasOutput: true, coreOnline: true}
		response := httptest.NewRecorder()
		writeError(response, failure)
		if strings.Contains(response.Body.String(), hookCredentialFixture) || strings.Contains(failure.Error(), hookCredentialFixture) {
			t.Fatal("hook error exposes command or output")
		}
	}
	if strings.Contains(logs.String(), hookCredentialFixture) {
		t.Fatal("startup or operation logs expose credential")
	}
}

func TestHookTimeoutStillChecksCoreWithinBudget(t *testing.T) {
	var probes atomic.Int32
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probes.Add(1)
		w.WriteHeader(204)
	}))
	defer controller.Close()
	ctx, cancel := context.WithTimeout(context.Background(), hookHealthTimeout+400*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := runPostReload(ctx, helperHook(t, "sleep"), controller.URL, "")
	if !hookFailure(err) || !errors.Is(err, context.DeadlineExceeded) || !coreRestored(err) || probes.Load() == 0 {
		t.Fatalf("hook timeout skipped independent health check: %v, probes=%d", err, probes.Load())
	}
	if time.Since(started) > hookHealthTimeout+time.Second {
		t.Fatal("hook exceeded the operation budget")
	}
}
