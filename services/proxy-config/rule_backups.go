package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var ruleTags = map[string]bool{"whitelist": true, "greylist": true, "blocklist": true, "force_realip": true, "ddns_domains": true, "pcdn_domains": true, "pcdn_regex_v4": true, "pcdn_regex_v6": true, "client_ip": true, "direct_ip": true, "rewrite": true}
var ruleBackupName = regexp.MustCompile(`^\d{8}T\d{6}\.\d{9}Z_([a-z0-9_]+)_[a-f0-9]{16}\.json$`)

const maxRuleBackupRecord = 12 << 20
const maxRuleBackupBytes = 64 << 20

type ruleBackup struct {
	ID      string `json:"id"`
	Tag     string `json:"tag"`
	Time    int64  `json:"time"`
	Bytes   int    `json:"bytes"`
	SHA256  string `json:"sha256"`
	Content string `json:"content"`
}
type ruleBackupInfo struct {
	ID     string `json:"id"`
	Tag    string `json:"tag"`
	Time   int64  `json:"time"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func (b ruleBackup) info() ruleBackupInfo {
	return ruleBackupInfo{b.ID, b.Tag, b.Time, b.Bytes, b.SHA256}
}
func readRuleBackup(root *os.Root, name, tag string) (ruleBackup, error) {
	var b ruleBackup
	match := ruleBackupName.FindStringSubmatch(name)
	if len(match) != 2 || match[1] != tag || !ruleTags[tag] {
		return b, failure(400, "备份标识无效。")
	}
	file, err := root.Open(name)
	if err != nil {
		return b, failure(404, "这份备份已不存在，请刷新列表。")
	}
	defer file.Close()
	if err := json.NewDecoder(io.LimitReader(file, maxRuleBackupRecord+1)).Decode(&b); err != nil || b.ID != name || b.Tag != tag || b.Bytes != len(b.Content) || len(b.Content) > maxFile || b.SHA256 != digest([]byte(b.Content)) {
		return b, failure(500, "备份校验失败，未恢复内容。")
	}
	return b, nil
}

// The service stores snapshots only. Restoring always goes through the UI as a draft.
func (s *Server) ruleBackups(w http.ResponseWriter, r *http.Request) error {
	s.ruleBackupLock.Lock()
	defer s.ruleBackupLock.Unlock()
	directory := s.config.RuleBackupDirectory
	if directory == "" {
		directory = "/opt/localdns-proxy-config/data/rules-backups"
	}
	if r.Method != "GET" && r.Method != "POST" {
		return failure(405, "不支持此操作。")
	}
	tag := r.URL.Query().Get("tag")
	var input struct {
		Tag     string `json:"tag"`
		Content string `json:"content"`
	}
	if r.Method == "POST" {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRuleBackupRecord))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			return failure(400, "备份请求无效或过大。")
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			return failure(400, "备份请求含有多余内容。")
		}
		tag = input.Tag
	}
	if !ruleTags[tag] {
		return failure(400, "请选择有效的名单。")
	}
	if !utf8.ValidString(input.Content) || strings.ContainsRune(input.Content, 0) || len(input.Content) > maxFile {
		return failure(400, "名单内容须为不超过 2 MB 的有效文本。")
	}
	if r.Method == "POST" {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return failure(500, "无法创建名单备份目录，未保存名单。")
		}
	}
	root, err := os.OpenRoot(directory)
	if os.IsNotExist(err) && r.Method == "GET" && r.URL.Query().Get("id") == "" {
		writeJSON(w, 200, map[string]any{"backups": []ruleBackupInfo{}})
		return nil
	}
	if err != nil {
		return failure(500, "无法访问名单备份目录。")
	}
	defer root.Close()
	if r.Method == "GET" && r.URL.Query().Get("id") != "" {
		backup, err := readRuleBackup(root, r.URL.Query().Get("id"), tag)
		if err != nil {
			return err
		}
		writeJSON(w, 200, backup)
		return nil
	}
	if r.Method == "GET" {
		entries, err := os.ReadDir(directory)
		if err != nil {
			return failure(500, "无法读取备份列表。")
		}
		result := []ruleBackupInfo{}
		for i := len(entries) - 1; i >= 0; i-- {
			entry := entries[i]
			match := ruleBackupName.FindStringSubmatch(entry.Name())
			if len(match) != 2 || match[1] != tag || !entry.Type().IsRegular() {
				continue
			}
			backup, err := readRuleBackup(root, entry.Name(), tag)
			if err != nil {
				return err
			}
			result = append(result, backup.info())
		}
		writeJSON(w, 200, map[string]any{"backups": result})
		return nil
	}
	stamp := time.Now().UTC()
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	name := stamp.Format("20060102T150405.000000000Z") + "_" + tag + "_" + hex.EncodeToString(random) + ".json"
	backup := ruleBackup{name, tag, stamp.UnixMilli(), len(input.Content), digest([]byte(input.Content)), input.Content}
	data, err := json.Marshal(backup)
	if err != nil {
		return err
	}
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return failure(500, "无法写入备份，未保存名单。")
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		root.Remove(name)
		return failure(500, "备份未完整写入，未保存名单。")
	}
	if _, err := readRuleBackup(root, name, tag); err != nil {
		return err
	}
	if err := pruneRuleBackups(directory, root); err != nil {
		return failure(500, "备份清理失败，未保存名单。")
	}
	writeJSON(w, 200, map[string]any{"saved": true, "backup": backup.info()})
	return nil
}

func pruneRuleBackups(directory string, root *os.Root) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() > entries[j].Name() })
	counts := map[string]int{}
	var total int64
	for _, entry := range entries {
		match := ruleBackupName.FindStringSubmatch(entry.Name())
		if len(match) != 2 || !ruleTags[match[1]] || !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		tag := match[1]
		if counts[tag] >= 20 || total+info.Size() > maxRuleBackupBytes {
			if err := root.Remove(entry.Name()); err != nil {
				return err
			}
			continue
		}
		counts[tag]++
		total += info.Size()
	}
	return nil
}
