//go:build !windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
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
func TestIndependentConfigurationSaveDoesNotReloadStartup(t *testing.T) {
	s, path := testServer(t)
	other := filepath.Join(filepath.Dir(path), "other.yaml")
	before := []byte("mode: direct\n")
	os.WriteFile(other, before, 0o640)
	s.reloadReady = func(context.Context, string, Core, []byte, []byte) error {
		t.Fatal("inactive save checked running controller")
		return nil
	}
	s.reload = func(context.Context, string, Core, string, []byte) error {
		t.Fatal("inactive save reloaded running core")
		return nil
	}
	rr := call(s, "save", request{Core: "mihomo", Path: other, Content: "mode: global\n", Revision: digest(before)})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var result struct {
		Saved, Reloaded, Active bool
		Backup, Confirmation    string
	}
	json.Unmarshal(rr.Body.Bytes(), &result)
	if !result.Saved || result.Reloaded || result.Active || result.Confirmation != "saved-only" {
		t.Fatal(rr.Body.String())
	}
	current, _ := os.ReadFile(other)
	startup, _ := os.ReadFile(path)
	backup, _ := os.ReadFile(result.Backup)
	if string(current) != "mode: global\n" || string(startup) != "mode: rule\n" || string(backup) != string(before) {
		t.Fatal("independent save changed startup or lost backup")
	}
}
func TestDirectoryListsIndependentConfigsAndRejectsEscapes(t *testing.T) {
	s, path := testServer(t)
	dir := filepath.Dir(path)
	for _, filename := range []string{"other.yml", "backup.json", "notes.txt", ".hidden.yaml"} {
		os.WriteFile(filepath.Join(dir, filename), []byte("{}"), 0o600)
	}
	os.Mkdir(filepath.Join(dir, "profiles"), 0o700)
	os.Mkdir(filepath.Join(dir, "localdns-backups"), 0o700)
	outside := filepath.Join(t.TempDir(), "private.yaml")
	os.WriteFile(outside, []byte("secret"), 0o600)
	if err := os.Symlink(outside, filepath.Join(dir, "escape.yaml")); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "http://localdns.test:9098"+apiPrefix+"files?core=mihomo", nil)
	req.Header.Set("Origin", "http://localdns.test:9099")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var result struct {
		Files []struct {
			Name, Path        string
			Directory, Active bool
		}
	}
	json.Unmarshal(rr.Body.Bytes(), &result)
	if len(result.Files) != 4 {
		t.Fatal(rr.Body.String())
	}
	for _, item := range result.Files {
		if item.Name == "config.yaml" && !item.Active {
			t.Fatal("startup flag missing")
		}
		if item.Path == "" {
			t.Fatal("file path missing")
		}
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

func TestTrimBackupsOnlyMatchesOwnBackups(t *testing.T) {
	dir := t.TempDir()
	write := func(name string) {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Backups of a sibling file sharing the prefix sort after config.yaml.2026* and must be ignored.
	others := []string{"config.yaml.example.20260101-000000.000000000.bak", "config.yaml.bak", "config.yaml.20260101-000000.bak"}
	for _, name := range others {
		write(name)
	}
	var own []string
	for i := 0; i < 12; i++ {
		name := fmt.Sprintf("config.yaml.20261103-0000%02d.000000000.bak", i)
		own = append(own, name)
		write(name)
	}
	trimBackups(dir, "config.yaml", 10)
	for i, name := range own {
		_, err := os.Stat(filepath.Join(dir, name))
		if kept := err == nil; kept != (i >= 2) {
			t.Fatalf("%s kept=%v", name, kept)
		}
	}
	for _, name := range others {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("unrelated %s removed: %v", name, err)
		}
	}
}

func TestServeUntilSignalWaitsForInFlightRequest(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.Write([]byte("saved"))
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	stop := make(chan os.Signal, 1)
	served := make(chan error, 1)
	go func() { served <- serveUntilSignal(srv, ln, stop, 5*time.Second) }()
	body := make(chan string, 1)
	go func() {
		res, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			body <- err.Error()
			return
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		body <- string(b)
	}()
	<-started
	stop <- syscall.SIGTERM
	select {
	case err := <-served:
		t.Fatalf("returned before in-flight request finished: %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	if got := <-body; got != "saved" {
		t.Fatalf("response %q", got)
	}
	if err := <-served; err != nil {
		t.Fatal(err)
	}
}

func TestPostReloadRejectsShellCommandLine(t *testing.T) {
	config := Config{Cores: map[string]Core{"mihomo": {PostReload: []string{"rc-service mihomo-gateway restart"}}}}
	err := validatePostReload(config)
	if err == nil {
		t.Fatal("space-joined command line accepted as a hook")
	}
	for _, want := range []string{"postReload[0]", "argv 数组", `["rc-service", "mihomo-gateway", "restart"]`} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("hook error %q does not mention %q", err.Error(), want)
		}
	}
}

func TestPostReloadValidationAcceptsExecutableAndRejectsBadPaths(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "post-reload.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	plain := filepath.Join(dir, "plain.txt")
	if err := os.WriteFile(plain, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validatePostReload(Config{Cores: map[string]Core{"mihomo": {PostReload: []string{script, "--force"}}}}); err != nil {
		t.Fatalf("executable hook rejected: %v", err)
	}
	rejected := map[string][]string{
		"relative":  {"post-reload.sh"},
		"missing":   {filepath.Join(dir, "absent.sh")},
		"notexec":   {plain},
		"directory": {dir},
		"newline":   {"/bin/sh\nrm -rf /"},
		"empty":     {""},
	}
	for name, hook := range rejected {
		if err := validatePostReload(Config{Cores: map[string]Core{"mihomo": {PostReload: hook}}}); err == nil {
			t.Fatalf("%s hook accepted", name)
		}
	}
}

func TestHookFailureRollsBackWithoutClaimingCoreIsLost(t *testing.T) {
	s, path := importTestServer(t)
	puts := 0
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" && r.URL.Path == "/configs" {
			puts++
		}
		w.WriteHeader(204)
	}))
	defer controller.Close()

	dir := t.TempDir()
	runs := filepath.Join(dir, "runs")
	hook := filepath.Join(dir, "hook.sh")
	script := "#!/bin/sh\necho run >> '" + runs + "'\necho 'hook exploded' >&2\nexit 1\n"
	if err := os.WriteFile(hook, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	before := []byte("external-controller: " + strings.TrimPrefix(controller.URL, "http://") + "\nsecret: test\nmode: rule\n")
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	core := s.config.Cores["mihomo"]
	core.PostReload = []string{hook}
	s.config.Cores["mihomo"] = core
	s.reloadReady = reloadReady
	s.reload = reloadCore

	rr := importCall(s, "save", request{Core: "mihomo", Path: path, Revision: digest(before), Content: string(before) + "rules:\n - MATCH,DIRECT\n"})
	if rr.Code != http.StatusBadGateway {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	var result struct {
		Error, Detail string
		RolledBack    bool
	}
	json.Unmarshal(rr.Body.Bytes(), &result)
	if !result.RolledBack || !strings.Contains(result.Error, "重载后钩子执行失败") {
		t.Fatalf("hook failure misreported: %s", rr.Body.String())
	}
	if strings.Contains(result.Error, "核心恢复尚未确认") {
		t.Fatalf("hook failure claimed the core was lost: %s", result.Error)
	}
	if !strings.Contains(result.Detail, "post reload hook failed") || !strings.Contains(result.Detail, "hook exploded") {
		t.Fatalf("detail dropped the hook error: %q", result.Detail)
	}
	if puts != 2 {
		t.Fatalf("expected the core to reload twice (apply and rollback), got %d", puts)
	}
	if restored, _ := os.ReadFile(path); string(restored) != string(before) {
		t.Fatal("original not restored")
	}
	if count, _ := os.ReadFile(runs); strings.Count(string(count), "run") != 2 {
		t.Fatalf("hook ran an unexpected number of times: %q", count)
	}
}
