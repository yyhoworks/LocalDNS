package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestInterfaceUploadedLogoAndResetSurviveRestart(t *testing.T) {
	s, _ := testServer(t)
	s.config.InterfaceFile = filepath.Join(t.TempDir(), "interface.json")
	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		t.Fatal(err)
	}
	value := displayIdentity{Name: "我的 DNS", Logo: "data:image/png;base64," + base64.StdEncoding.EncodeToString(picture.Bytes())}
	revision, _ := getIdentity(t, s, "localdns")
	if rr := call(s, "interface/localdns", interfaceUpdate{Value: value, Revision: revision}); rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	revision, actual := getIdentity(t, newServer(s.config), "localdns")
	if *actual != value {
		t.Fatal("uploaded logo was not persisted")
	}
	defaults := displayIdentity{Name: "LocalDNS"}
	if rr := call(s, "interface/localdns", interfaceUpdate{Value: defaults, Revision: revision}); rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	_, actual = getIdentity(t, newServer(s.config), "localdns")
	if *actual != defaults {
		t.Fatal("server reset was not durable")
	}
}

func getIdentity(t *testing.T, s *Server, section string) (string, *displayIdentity) {
	t.Helper()
	req := httptest.NewRequest("GET", "http://localdns.test:9098"+apiPrefix+"interface/"+section, nil)
	req.Header.Set("Origin", "http://localdns.test:9099")
	rr := httptest.NewRecorder()
	s.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var result struct {
		Revision string
		Value    *displayIdentity
	}
	json.Unmarshal(rr.Body.Bytes(), &result)
	return result.Revision, result.Value
}
func TestInterfacePersistsAcrossServiceAndDeviceReads(t *testing.T) {
	s, _ := testServer(t)
	s.config.InterfaceFile = filepath.Join(t.TempDir(), "data", "interface.json")
	revision, value := getIdentity(t, s, "localdns")
	if value != nil {
		t.Fatal("unexpected configured identity")
	}
	identity := displayIdentity{Name: "家庭 DNS", Logo: "https://example.test/logo.png"}
	rr := call(s, "interface/localdns", interfaceUpdate{Value: identity, Revision: revision})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	other := newServer(s.config)
	_, persisted := getIdentity(t, other, "localdns")
	if persisted == nil || *persisted != identity {
		t.Fatal("identity did not survive restart")
	}
	proxyRevision, _ := getIdentity(t, other, "proxy")
	proxy := displayIdentity{Name: "家庭代理", URL: "http://192.0.2.7:9090/ui"}
	if rr := call(other, "interface/proxy", interfaceUpdate{Value: proxy, Revision: proxyRevision}); rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	_, preserved := getIdentity(t, s, "localdns")
	if *preserved != identity {
		t.Fatal("proxy update overwrote DNS identity")
	}
	info, _ := os.Stat(s.config.InterfaceFile)
	if info.Mode().Perm() != 0o600 {
		t.Fatal("settings permissions")
	}
	backup, err := os.ReadFile(s.config.InterfaceFile + ".bak")
	if err != nil || len(backup) == 0 {
		t.Fatal("settings backup missing")
	}
	if rr := call(s, "interface/localdns", interfaceUpdate{Value: displayIdentity{Name: "stale"}, Revision: revision}); rr.Code != 409 {
		t.Fatal("concurrent device overwrote newer settings")
	}
}
func TestInterfaceRejectsInvalidContentWithoutChangingStoredSettings(t *testing.T) {
	s, _ := testServer(t)
	s.config.InterfaceFile = filepath.Join(t.TempDir(), "interface.json")
	revision, _ := getIdentity(t, s, "localdns")
	for _, value := range []displayIdentity{{Name: "bad\nname"}, {Name: "DNS", Logo: "javascript:alert(1)"}, {Name: "DNS", Logo: "data:image/png;base64,AAAA"}, {Name: "DNS", URL: "https://not-applicable.test"}} {
		if rr := call(s, "interface/localdns", interfaceUpdate{Value: value, Revision: revision}); rr.Code != 400 {
			t.Fatal(rr.Body.String())
		}
	}
	if _, err := os.Stat(s.config.InterfaceFile); !os.IsNotExist(err) {
		t.Fatal("invalid input wrote settings")
	}
	proxyRevision, _ := getIdentity(t, s, "proxy")
	if rr := call(s, "interface/proxy", interfaceUpdate{Value: displayIdentity{Name: "proxy", URL: "http://user:password@example.test"}, Revision: proxyRevision}); rr.Code != 400 {
		t.Fatal(rr.Body.String())
	}
}
