package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func importTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte("mode: rule\n"), 0600); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := newServer(Config{Origins: []string{"http://dns.test"}, Hosts: []string{"dns.test:9098"}, Cores: map[string]Core{"mihomo": {Binary: executable, Directory: dir, Config: path, Roots: []string{dir}}}})
	s.validate = func(context.Context, string, Core, string) (string, error) { return "checked", nil }
	s.reloadReady = nil
	s.reload = func(context.Context, string, Core, string, []byte) error { return nil }
	return s, path
}
func importCall(s *Server, endpoint string, value any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(value)
	r := httptest.NewRequest(http.MethodPost, "http://dns.test:9098"+apiPrefix+endpoint, strings.NewReader(string(b)))
	r.Header.Set("Origin", "http://dns.test")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestHTTPImportPreservesTextAndDoesNotWriteTarget(t *testing.T) {
	s, path := importTestServer(t)
	content := "# original comments\r\nmode: rule\r\nrules:\r\n - DOMAIN,example.com,DIRECT\r\n"
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("import forwarded credentials or used a mutation")
		}
		if r.URL.Query().Get("token") != "private-token" {
			t.Error("query token lost")
		}
		w.Write([]byte(content))
	}))
	defer origin.Close()
	w := importCall(s, "fetch", map[string]string{"url": origin.URL + "/config?token=private-token", "core": "mihomo"})
	var result struct {
		Content, SourceHost string
		Imported            bool
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if w.Code != 200 || result.Content != content || !result.Imported || strings.Contains(result.SourceHost, "private-token") {
		t.Fatal(w.Body.String())
	}
	target, _ := os.ReadFile(path)
	if string(target) != "mode: rule\n" {
		t.Fatal("import wrote live config")
	}
}
func TestHTTPImportSingBoxJSONC(t *testing.T) {
	s, _ := importTestServer(t)
	content := "{\n/* comment */ \"outbounds\": [{\"type\":\"direct\",\"tag\":\"https://example.com/a/*b*/\",},],\n}"
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(content)) }))
	defer origin.Close()
	w := importCall(s, "fetch", map[string]string{"url": origin.URL, "core": "sing-box"})
	var result struct{ Content string }
	json.Unmarshal(w.Body.Bytes(), &result)
	if w.Code != 200 || result.Content != content {
		t.Fatal(w.Body.String())
	}
}
func TestHTTPImportRejectsInvalidSourcesAndKeepsTarget(t *testing.T) {
	s, path := importTestServer(t)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/html":
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("<html>login</html>"))
		case "/array":
			w.Write([]byte("[1,2]"))
		case "/error":
			w.Write([]byte(`{"error":"login required"}`))
		case "/too-big":
			w.Write([]byte("mode: rule\n#" + strings.Repeat("x", maxFile)))
		case "/nul":
			w.Write([]byte("mode: rule\x00"))
		case "/invalid-utf8":
			w.Write([]byte{255})
		case "/sing-box":
			w.Write([]byte(`{"outbounds":[]}`))
		case "/loop":
			http.Redirect(w, r, "/loop", 302)
		case "/metadata":
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/?token=hidden", 302)
		default:
			w.WriteHeader(401)
		}
	}))
	defer origin.Close()
	for _, pathSuffix := range []string{"/html", "/array", "/error", "/too-big", "/nul", "/invalid-utf8", "/sing-box", "/loop", "/metadata", "/unauthorized"} {
		t.Run(pathSuffix, func(t *testing.T) {
			w := importCall(s, "fetch", map[string]string{"url": origin.URL + pathSuffix, "core": "mihomo"})
			if w.Code < 400 || strings.Contains(w.Body.String(), "token=hidden") {
				t.Fatal(w.Body.String())
			}
		})
	}
	for _, raw := range []string{"file:///etc/passwd", "ftp://example.com/config", "http://user:pass@example.com/config", "https://example.com/c#fragment"} {
		if w := importCall(s, "fetch", map[string]string{"url": raw, "core": "mihomo"}); w.Code != 400 {
			t.Fatal(w.Body.String())
		}
	}
	target, _ := os.ReadFile(path)
	if string(target) != "mode: rule\n" {
		t.Fatal("failed fetch modified target")
	}
}
func TestHTTPImportRequiresApprovedOrigin(t *testing.T) {
	s, _ := importTestServer(t)
	r := httptest.NewRequest(http.MethodPost, "http://dns.test:9098"+apiPrefix+"fetch", strings.NewReader(`{}`))
	r.Header.Set("Origin", "http://other.test")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-site fetch accepted")
	}
}
func TestPortableSaveConflictBackupAndRollback(t *testing.T) {
	s, path := importTestServer(t)
	before, _ := os.ReadFile(path)
	input := request{Core: "mihomo", Path: path, Revision: digest(before), Content: "mode: global\n"}
	if w := importCall(s, "check", input); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	unchanged, _ := os.ReadFile(path)
	if string(unchanged) != string(before) {
		t.Fatal("check wrote config")
	}
	stale := input
	stale.Revision = "stale"
	if w := importCall(s, "save", stale); w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	calls := 0
	s.reload = func(context.Context, string, Core, string, []byte) error {
		calls++
		if calls == 1 {
			return errors.New("injected failure")
		}
		return nil
	}
	w := importCall(s, "save", input)
	if w.Code != 502 || calls != 2 || !strings.Contains(w.Body.String(), `"rolledBack":true`) {
		t.Fatal(w.Body.String())
	}
	restored, _ := os.ReadFile(path)
	if string(restored) != string(before) {
		t.Fatal("rollback did not restore original")
	}
	s.reload = func(context.Context, string, Core, string, []byte) error { return nil }
	w = importCall(s, "save", input)
	var saved struct{ Backup, Confirmation string }
	json.Unmarshal(w.Body.Bytes(), &saved)
	if w.Code != 200 || saved.Confirmation != "api" {
		t.Fatal(w.Body.String())
	}
	backup, _ := os.ReadFile(saved.Backup)
	if string(backup) != string(before) {
		t.Fatal("backup differs")
	}
	current, _ := os.ReadFile(path)
	if string(current) != input.Content {
		t.Fatal("save did not commit draft")
	}
}
func TestMihomoApplyUsesReloadEndpointAndRejectsControllerChanges(t *testing.T) {
	s, path := importTestServer(t)
	puts := 0
	restarts := 0
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/restart" {
			restarts++
		}
		if r.Method == "PUT" && r.URL.Path == "/configs" {
			puts++
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			if input["path"] != path || r.URL.Query().Get("force") != "true" {
				t.Error("incorrect reload target")
			}
		}
		w.WriteHeader(204)
	}))
	defer controller.Close()
	before := []byte("external-controller: " + strings.TrimPrefix(controller.URL, "http://") + "\nsecret: test\nmode: rule\n")
	os.WriteFile(path, before, 0600)
	s.reloadReady = reloadReady
	s.reload = reloadCore
	input := request{Core: "mihomo", Path: path, Revision: digest(before), Content: string(before) + "rules:\n - MATCH,DIRECT\n"}
	if w := importCall(s, "save", input); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if puts != 1 || restarts != 0 {
		t.Fatal("used restart instead of reload")
	}
	current, _ := os.ReadFile(path)
	input.Revision = digest(current)
	input.Content = strings.Replace(string(current), "secret: test", "secret: changed", 1)
	if w := importCall(s, "save", input); w.Code != 422 {
		t.Fatal(w.Body.String())
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(current) || puts != 1 {
		t.Fatal("controller edit was applied without restart")
	}
}

func TestSingBoxRelativeWorkingDirectoryAndRepeatedInputs(t *testing.T) {
	root := t.TempDir()
	c, err := parseSingBoxInputs(Core{}, root, []string{"sing-box", "run", "-D", "work", "-cbase.json", "--config=route.json", "-C", "conf.d"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Directory != filepath.Join(root, "work") || c.Config != filepath.Join(root, "work", "base.json") || len(c.ConfigFiles) != 1 || c.ConfigFiles[0] != filepath.Join(root, "work", "route.json") || len(c.ConfigDirectories) != 1 || c.ConfigDirectories[0] != filepath.Join(root, "work", "conf.d") {
		t.Fatalf("wrong input resolution: %#v", c)
	}
	if _, err := parseSingBoxInputs(Core{}, root, []string{"sing-box", "run", "-c"}); err == nil {
		t.Fatal("missing path accepted")
	}
}
