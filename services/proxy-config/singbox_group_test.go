package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fragmentServer(t *testing.T) (*Server, string, string) {
	s, _ := testServer(t)
	dir := t.TempDir()
	a := filepath.Join(dir, "00-base.json")
	b := filepath.Join(dir, "10-route.json")
	os.WriteFile(a, []byte(`{"outbounds":[{"type":"direct","tag":"direct"}]}`), 0o600)
	os.WriteFile(b, []byte(`{"route":{"final":"direct"}}`), 0o600)
	s.config.Cores = map[string]Core{"sing-box": {Binary: "/bin/sh", Directory: dir, Roots: []string{dir}, ConfigDirectories: []string{dir}}}
	return s, a, b
}
func TestFragmentCheckStagesWholeGroupAndRejectsConcurrentChanges(t *testing.T) {
	s, other, path := fragmentServer(t)
	binary := filepath.Join(t.TempDir(), "sing-box-fixture")
	os.WriteFile(binary, []byte("#!/bin/sh\nif [ \"$1\" = merge ]; then printf '%s' '{\"outbounds\":[{\"type\":\"direct\",\"tag\":\"direct\"}]}' > \"$2\"; fi\n"), 0o700)
	configured := s.config.Cores["sing-box"]
	configured.Binary = binary
	s.config.Cores["sing-box"] = configured
	c := s.config.Cores["sing-box"]
	group, _ := snapshotSingBox(c)
	old, _ := os.ReadFile(path)
	input := request{Core: "sing-box", Path: path, Content: `{"route":{"final":"new-tag"}}`, Revision: digest(old), GroupRevision: group.Revision}
	s.validate = func(_ context.Context, _ string, c Core, path string) (string, error) {
		entries, _ := os.ReadDir(c.ConfigDirectories[0])
		if len(entries) != 2 {
			t.Fatal("fragment check did not see the entire group")
		}
		selected, _ := os.ReadFile(path)
		if string(selected) != input.Content {
			t.Fatal("overlay missing")
		}
		if err := os.WriteFile(other, []byte(`{"outbounds":[]}`), 0o600); err != nil {
			t.Fatal(err)
		}
		return "checked", nil
	}
	if rr := call(s, "check", input); rr.Code != 409 {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(old) {
		t.Fatal("checking group changed selected file")
	}
	if rr := call(s, "check", input); rr.Code != 409 {
		t.Fatal("accepted old group revision")
	}
}
func TestFragmentSnapshotRejectsEscapingLinksAndIncludesNewFiles(t *testing.T) {
	s, _, path := fragmentServer(t)
	c := s.config.Cores["sing-box"]
	before, _ := snapshotSingBox(c)
	os.WriteFile(filepath.Join(filepath.Dir(path), "20-extra.json"), []byte(`{}`), 0o600)
	after, _ := snapshotSingBox(c)
	if before.Revision == after.Revision {
		t.Fatal("new fragment did not invalidate group")
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	os.WriteFile(outside, []byte(`{}`), 0o600)
	os.Symlink(outside, filepath.Join(filepath.Dir(path), "30-escape.json"))
	if _, err := snapshotSingBox(c); err == nil {
		t.Fatal("fragment link escaped roots")
	}
}
func TestNativeSingBoxFragmentSaveReloadAndRollback(t *testing.T) {
	binary := os.Getenv("LOCALDNS_SINGBOX_TEST_BINARY")
	if binary == "" {
		t.Skip("native sing-box integration binary not supplied")
	}
	root := t.TempDir()
	dir := filepath.Join(root, "conf.d")
	os.Mkdir(dir, 0o700)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	base := fmt.Sprintf(`{"log":{"level":"fatal"},"experimental":{"clash_api":{"external_controller":%q,"secret":"local-test"}}}`, address)
	paths := []string{filepath.Join(dir, "00-base.json"), filepath.Join(dir, "10-outbounds.json"), filepath.Join(dir, "20-route.json")}
	contents := []string{base, `{"outbounds":[{"type":"direct","tag":"direct-a"}]}`, "{\n // route fragment\n \"route\":{\"final\":\"direct-a\"}\n}\n"}
	for i, path := range paths {
		if err := os.WriteFile(path, []byte(contents[i]), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cmd := exec.Command(binary, "run", "-D", root, "-C", dir)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	pidFile := filepath.Join(root, "sing-box.pid")
	os.WriteFile(pidFile, []byte(fmt.Sprint(cmd.Process.Pid)), 0o600)
	ready := false
	for i := 0; i < 40; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := apiCall(ctx, "http://"+address, "local-test", "GET", "/version", nil)
		cancel()
		if err == nil {
			ready = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !ready {
		t.Fatal("native core did not start")
	}
	c := Core{Binary: binary, Directory: root, Roots: []string{root}, ConfigDirectories: []string{dir}, PIDFile: pidFile}
	s := newServer(Config{Origins: []string{"http://localdns.test:9099"}, Hosts: []string{"localdns.test:9098"}, Cores: map[string]Core{"sing-box": c}})
	selected := paths[2]
	read := call(s, "read", request{Core: "sing-box", Path: selected})
	var loaded struct{ Revision, GroupRevision, Mode string }
	json.Unmarshal(read.Body.Bytes(), &loaded)
	if read.Code != 200 || loaded.Mode != "fragments" {
		t.Fatal(read.Body.String())
	}
	standby := filepath.Join(root, "spare.json")
	os.WriteFile(standby, []byte(`{}`), 0o600)
	if rr := call(s, "check", request{Core: "sing-box", Path: standby, Content: `{ broken`, Revision: digest([]byte(`{}`))}); rr.Code != 422 {
		t.Fatal("standby file was validated against the active directory instead of its own content: " + rr.Body.String())
	}
	input := request{Core: "sing-box", Path: selected, Content: `{"route":{"final":"missing-tag"}}`, Revision: loaded.Revision, GroupRevision: loaded.GroupRevision}
	if rr := call(s, "save", input); rr.Code != 422 {
		t.Fatal("broken reference across fragments was accepted: " + rr.Body.String())
	}
	current, _ := os.ReadFile(selected)
	if string(current) != contents[2] {
		t.Fatal("failed group check changed configuration")
	}
	realReady := s.reloadReady
	s.reloadReady = func(ctx context.Context, name string, c Core, before, after []byte) error {
		err := realReady(ctx, name, c, before, after)
		if err != nil {
			actual, inspectErr := processInputs(c)
			actualEXE, _ := os.Readlink(fmt.Sprintf("/proc/%d/exe", cmd.Process.Pid))
			t.Logf("exe=%q binary=%q", actualEXE, c.Binary)
			t.Logf("native reload preflight: %v; inspect=%v; expected=%q actual=%q", err, inspectErr, singBoxArguments(c, ""), singBoxArguments(actual, ""))
		}
		return err
	}
	input.Content = "{\n // updated comment\n \"route\":{\"final\":\"direct-a\",\"auto_detect_interface\":false}\n}\n"
	rr := call(s, "save", input)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"reloaded":true`) {
		t.Fatal(rr.Body.String())
	}
	var saved struct{ Revision, GroupRevision string }
	json.Unmarshal(rr.Body.Bytes(), &saved)
	if saved.GroupRevision == loaded.GroupRevision {
		t.Fatal("group revision did not advance")
	}
	untouched, _ := os.ReadFile(paths[1])
	if string(untouched) != contents[1] {
		t.Fatal("saving fragment changed sibling")
	}
	input.Revision = saved.Revision
	input.GroupRevision = saved.GroupRevision
	input.Content = contents[2]
	count := 0
	s.reload = func(ctx context.Context, name string, c Core, path string, before []byte) error {
		count++
		if count == 1 {
			return errors.New("injected reload failure")
		}
		return reloadCore(ctx, name, c, path, before)
	}
	rollback := call(s, "save", input)
	if rollback.Code != 502 || !strings.Contains(rollback.Body.String(), `"rolledBack":true`) {
		t.Fatal(rollback.Body.String())
	}
	current, _ = os.ReadFile(selected)
	if string(current) == contents[2] {
		t.Fatal("reload failure did not restore prior fragment")
	}
}
