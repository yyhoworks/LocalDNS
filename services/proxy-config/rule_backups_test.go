package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func ruleBackupGet(s *Server, query string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "http://localdns.test:9098"+apiPrefix+"rule-backups?"+query, nil)
	r.Header.Set("Origin", "http://localdns.test:9099")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestRuleBackupsPersistAndRemainDraftOnly(t *testing.T) {
	s, coreFile := testServer(t)
	s.config.RuleBackupDirectory = filepath.Join(t.TempDir(), "snapshots")
	text := "# 标题：保留原文\n  domain:example.com  \n192.0.2.0/24\n"
	w := call(s, "rule-backups", map[string]string{"tag": "whitelist", "content": text})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var saved struct{ Backup ruleBackupInfo }
	json.Unmarshal(w.Body.Bytes(), &saved)
	s = newServer(s.config)
	w = ruleBackupGet(s, "tag=whitelist&id="+saved.Backup.ID)
	var restored ruleBackup
	json.Unmarshal(w.Body.Bytes(), &restored)
	if w.Code != 200 || restored.Content != text || restored.SHA256 != digest([]byte(text)) {
		t.Fatal("saved bytes did not survive a new service instance", w.Body.String())
	}
	if content, _ := os.ReadFile(coreFile); string(content) != "mode: rule\n" {
		t.Fatal("backup access modified the core configuration")
	}
	info, err := os.Stat(filepath.Join(s.config.RuleBackupDirectory, saved.Backup.ID))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("backup must remain private", err)
	}
	// A damaged backup never becomes a restore candidate.
	os.WriteFile(filepath.Join(s.config.RuleBackupDirectory, saved.Backup.ID), []byte(`{"content":"tampered"}`), 0o600)
	if w := ruleBackupGet(s, "tag=whitelist&id="+saved.Backup.ID); w.Code != 500 {
		t.Fatal("corrupt backup was accepted")
	}
}
func TestRuleBackupRetentionAndInputBoundary(t *testing.T) {
	s, _ := testServer(t)
	s.config.RuleBackupDirectory = t.TempDir()
	for i := 0; i < 22; i++ {
		if w := call(s, "rule-backups", map[string]string{"tag": "greylist", "content": fmt.Sprintf("domain:sample%d.example", i)}); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	var result struct{ Backups []ruleBackupInfo }
	w := ruleBackupGet(s, "tag=greylist")
	json.Unmarshal(w.Body.Bytes(), &result)
	if w.Code != 200 || len(result.Backups) != 20 {
		t.Fatal("retention failed", w.Body.String())
	}
	for _, tag := range []string{"../greylist", "unknown", "/etc/passwd"} {
		if w := call(s, "rule-backups", map[string]string{"tag": tag, "content": "test"}); w.Code != 400 {
			t.Fatal("invalid tag accepted", tag)
		}
	}
	if w := ruleBackupGet(s, "tag=greylist&id=../../etc/passwd"); w.Code != 400 {
		t.Fatal("path escape accepted")
	}
	if w := ruleBackupGet(s, "tag=whitelist&id="+result.Backups[0].ID); w.Code != 400 {
		t.Fatal("cross-list backup accepted")
	}
	if w := call(s, "rule-backups", map[string]string{"tag": "greylist", "content": strings.Repeat("x", maxFile+1)}); w.Code != 400 {
		t.Fatal("oversized backup accepted")
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	os.WriteFile(outside, []byte(`{"secret":"outside"}`), 0o600)
	name := result.Backups[0].ID
	os.Remove(filepath.Join(s.config.RuleBackupDirectory, name))
	if err := os.Symlink(outside, filepath.Join(s.config.RuleBackupDirectory, name)); err != nil {
		t.Fatal(err)
	}
	if w := ruleBackupGet(s, "tag=greylist&id="+name); w.Code == 200 || strings.Contains(w.Body.String(), "outside") {
		t.Fatal("backup symlink escaped storage root")
	}
}
