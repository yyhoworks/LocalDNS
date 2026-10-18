package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("mode: rule\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	s := &Server{config: Config{
		Origins: []string{"http://localdns.test:9099"}, Hosts: []string{"localdns.test:9098"},
		Cores: map[string]Core{"mihomo": {Binary: "/bin/sh", Directory: dir, Config: path, Roots: []string{dir}}},
	}}
	s.validate = func(context.Context, string, Core, string) (string, error) { return "checked", nil }
	s.reload = func(context.Context, string, Core, string, []byte) error { return nil }
	return s, path
}
func call(s *Server, path string, input any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(input)
	req := httptest.NewRequest("POST", "http://localdns.test:9098"+apiPrefix+path, strings.NewReader(string(b)))
	req.Header.Set("Origin", "http://localdns.test:9099")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	return rr
}
func TestDirectLocalReadWithoutSession(t *testing.T) {
	s, path := testServer(t)
	rr := call(s, "read", request{Core: "mihomo", Path: path})
	if rr.Code != http.StatusOK {
		t.Fatal(rr.Body.String())
	}
	if len(rr.Result().Cookies()) != 0 {
		t.Fatal("local file access created a login session")
	}
	var body map[string]any
	json.Unmarshal(rr.Body.Bytes(), &body)
	if body["content"] != "mode: rule\n" {
		t.Fatal("did not directly read the local file")
	}
}
func TestOriginAndHostRestrictions(t *testing.T) {
	s, _ := testServer(t)
	for _, origin := range []string{"", "http://evil.test"} {
		req := httptest.NewRequest("GET", "http://localdns.test:9098"+apiPrefix+"cores", nil)
		req.Header.Set("Origin", origin)
		rr := httptest.NewRecorder()
		s.ServeHTTP(rr, req)
		if rr.Code != http.StatusForbidden || rr.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatal("unapproved origin accepted")
		}
	}
	req := httptest.NewRequest("GET", "http://evil.test:9098"+apiPrefix+"cores", nil)
	req.Header.Set("Origin", "http://localdns.test:9099")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatal("unapproved host accepted")
	}
}
func TestPathBoundary(t *testing.T) {
	s, path := testServer(t)
	outside := filepath.Join(t.TempDir(), "private.yaml")
	os.WriteFile(outside, []byte("secret"), 0o600)
	link := filepath.Join(filepath.Dir(path), "escape.yaml")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{outside, link, filepath.Dir(path) + "/../private.yaml"} {
		if got := call(s, "read", request{Core: "mihomo", Path: p}).Code; got < 400 {
			t.Fatalf("escaped root: %s", p)
		}
	}
}
func TestValidateNeverWritesAndInvalidSavePreservesFile(t *testing.T) {
	s, path := testServer(t)
	before, _ := os.ReadFile(path)
	input := request{Core: "mihomo", Path: path, Content: "mode: global\n", Revision: digest(before)}
	if rr := call(s, "check", input); rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(before) {
		t.Fatal("validation wrote file")
	}
	s.validate = func(context.Context, string, Core, string) (string, error) { return "bad group", errors.New("invalid") }
	if rr := call(s, "save", input); rr.Code != 422 {
		t.Fatal(rr.Body.String())
	}
	current, _ = os.ReadFile(path)
	if string(current) != string(before) {
		t.Fatal("invalid file saved")
	}
	files, _ := os.ReadDir(filepath.Dir(path))
	if len(files) != 1 {
		t.Fatal("validation leaked temporary files")
	}
}
func TestConflictBeforeAndDuringCheck(t *testing.T) {
	s, path := testServer(t)
	before, _ := os.ReadFile(path)
	input := request{Core: "mihomo", Path: path, Content: "mode: global\n", Revision: "stale"}
	if rr := call(s, "save", input); rr.Code != 409 {
		t.Fatal(rr.Body.String())
	}
	input.Revision = digest(before)
	s.validate = func(context.Context, string, Core, string) (string, error) {
		return "", os.WriteFile(path, []byte("mode: direct\n"), 0o640)
	}
	if rr := call(s, "save", input); rr.Code != 409 {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(path)
	if string(current) != "mode: direct\n" {
		t.Fatal("overwrote concurrent edit")
	}
}
func TestSaveBackupPermissionsAndReload(t *testing.T) {
	s, path := testServer(t)
	before, _ := os.ReadFile(path)
	reloaded := false
	s.reload = func(_ context.Context, _ string, _ Core, selected string, old []byte) error {
		current, _ := os.ReadFile(selected)
		if string(old) != string(before) || string(current) != "mode: global\n" {
			t.Fatal("reload did not see committed contents")
		}
		reloaded = true
		return nil
	}
	rr := call(s, "save", request{Core: "mihomo", Path: path, Content: "mode: global\n", Revision: digest(before)})
	if rr.Code != 200 || !reloaded {
		t.Fatal(rr.Body.String())
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o640 {
		t.Fatal("permissions changed")
	}
	var result struct {
		Backup   string
		Revision string
	}
	json.Unmarshal(rr.Body.Bytes(), &result)
	saved, _ := os.ReadFile(result.Backup)
	if string(saved) != string(before) {
		t.Fatal("backup differs")
	}
	backupInfo, _ := os.Stat(result.Backup)
	if backupInfo.Mode().Perm() != 0o600 {
		t.Fatal("backup too permissive")
	}
}
func TestReloadFailureRestoresAndKeepsBackup(t *testing.T) {
	s, path := testServer(t)
	before, _ := os.ReadFile(path)
	calls := 0
	s.reload = func(context.Context, string, Core, string, []byte) error {
		calls++
		if calls == 1 {
			return errors.New("failed")
		}
		return nil
	}
	rr := call(s, "save", request{Core: "mihomo", Path: path, Content: "mode: global\n", Revision: digest(before)})
	if rr.Code != 502 || !strings.Contains(rr.Body.String(), `"rolledBack":true`) || calls != 2 {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(before) {
		t.Fatal("original not restored")
	}
	backups, _ := os.ReadDir(filepath.Join(filepath.Dir(path), "localdns-backups"))
	if len(backups) != 1 {
		t.Fatal("missing rollback backup")
	}
}
func TestInactiveFileCannotReplaceStartupConfiguration(t *testing.T) {
	s, path := testServer(t)
	other := filepath.Join(filepath.Dir(path), "other.yaml")
	before := []byte("mode: direct\n")
	os.WriteFile(other, before, 0o640)
	rr := call(s, "save", request{Core: "mihomo", Path: other, Content: "mode: global\n", Revision: digest(before)})
	if rr.Code != 409 {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(other)
	if string(current) != string(before) {
		t.Fatal("inactive file changed")
	}
}
func TestDiagnosticRedaction(t *testing.T) {
	output := scrubOutput("line 12 bad group\nsecret: abcdef\nprovider https://private.test/token\n", "/tmp/config")
	if strings.Contains(output, "abcdef") || strings.Contains(output, "private.test") || !strings.Contains(output, "line 12") {
		t.Fatal(output)
	}
}

func TestReloadPreflightRejectsBeforeWriting(t *testing.T) {
	s, path := testServer(t)
	before, _ := os.ReadFile(path)
	s.reloadReady = func(context.Context, string, Core, []byte, []byte) error { return errors.New("controller unavailable") }
	rr := call(s, "save", request{Core: "mihomo", Path: path, Content: "mode: global\n", Revision: digest(before)})
	if rr.Code != 422 {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(before) {
		t.Fatal("preflight failure wrote configuration")
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatal("preflight failure created backup or temporary files")
	}
}

func TestSingBoxUsesCheckCommandWithoutShellInterpolation(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "sing-box")
	capture := filepath.Join(dir, "arguments")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + capture + "'\n"
	if err := os.WriteFile(binary, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	selected := filepath.Join(dir, "config;echo-injection.json")
	if _, err := validateCore(context.Background(), "sing-box", Core{Binary: binary, Directory: dir}, selected); err != nil {
		t.Fatal(err)
	}
	args, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	expected := "check\n-D\n" + dir + "\n-c\n" + selected + "\n"
	if string(args) != expected {
		t.Fatalf("unexpected arguments: %q", args)
	}
}

func TestSingBoxRejectsForeignPID(t *testing.T) {
	file := filepath.Join(t.TempDir(), "sing-box.pid")
	if err := os.WriteFile(file, []byte(fmt.Sprint(os.Getpid())), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := singBoxPID(Core{Binary: "/bin/sh", PIDFile: file}); err == nil {
		t.Fatal("accepted PID of another executable")
	}
}
