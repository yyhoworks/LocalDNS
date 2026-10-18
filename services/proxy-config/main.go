// localdns-proxy-config provides transactional local core configuration editing.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const maxFile = 2 << 20
const apiPrefix = "/api/proxy-config/"

type Core struct {
	ConfigFiles             []string `json:"configFiles,omitempty"`
	ConfigDirectories       []string `json:"configDirectories,omitempty"`
	groupBefore, groupAfter []byte
	Binary                  string   `json:"binary"`
	Config                  string   `json:"config"`
	Directory               string   `json:"directory"`
	Roots                   []string `json:"roots"`
	PIDFile                 string   `json:"pidFile,omitempty"`
	PostReload              []string `json:"postReload,omitempty"`
}
type Config struct {
	RuleBackupDirectory string          `json:"ruleBackupDirectory,omitempty"`
	TrafficDirectory    string          `json:"trafficDirectory,omitempty"`
	MetricsURL          string          `json:"metricsURL,omitempty"`
	InterfaceFile       string          `json:"interfaceFile,omitempty"`
	Listen              string          `json:"listen"`
	Origins             []string        `json:"origins"`
	Hosts               []string        `json:"hosts"`
	Cores               map[string]Core `json:"cores"`
}
type Server struct {
	ruleBackupLock sync.Mutex
	traffic        *trafficCollector
	interfaceLock  sync.Mutex
	config         Config
	operation      sync.Mutex
	validate       func(context.Context, string, Core, string) (string, error)
	reload         func(context.Context, string, Core, string, []byte) error
	reloadReady    func(context.Context, string, Core, []byte, []byte) error
}
type request struct {
	GroupRevision string `json:"groupRevision,omitempty"`
	Core          string `json:"core"`
	Path          string `json:"path"`
	Content       string `json:"content"`
	Revision      string `json:"revision"`
}
type apiError struct {
	Status     int
	Message    string
	Detail     string
	RolledBack bool
	Backup     string
}

func (e *apiError) Error() string              { return e.Message }
func failure(status int, message string) error { return &apiError{Status: status, Message: message} }
func digest(b []byte) string                   { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func newServer(config Config) *Server {
	return &Server{config: config, validate: validateCore, reload: reloadCore, reloadReady: reloadReady}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	e := &apiError{Status: 500, Message: "操作未完成，请检查服务日志。"}
	if !errors.As(err, &e) {
		log.Printf("operation failed: %T", err)
	}
	writeJSON(w, e.Status, map[string]any{"error": e.Message, "detail": e.Detail, "rolledBack": e.RolledBack, "backup": e.Backup})
}
func decode(r *http.Request, w http.ResponseWriter, value any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return failure(415, "请使用 JSON 请求。")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 3*maxFile)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return failure(400, "请求内容无效或超过大小限制。")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return failure(400, "请求只能包含一个 JSON 对象。")
	}
	return nil
}
func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !contains(s.config.Hosts, r.Host) {
		writeError(w, failure(403, "不允许此主机地址。"))
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && contains(s.config.Origins, origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	if r.URL.Path == "/healthz" && r.Method == "GET" && origin == "" {
		writeJSON(w, 200, map[string]any{"service": "localdns-proxy-config", "version": "1.5.0"})
		return
	}
	if !contains(s.config.Origins, origin) {
		writeError(w, failure(403, "请从 LocalDNS 界面访问。"))
		return
	}
	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.WriteHeader(204)
		return
	}
	if !strings.HasPrefix(r.URL.Path, apiPrefix) {
		writeError(w, failure(404, "接口不存在。"))
		return
	}
	path := strings.TrimPrefix(r.URL.Path, apiPrefix)
	var err error
	switch {
	case path == "rule-backups":
		err = s.ruleBackups(w, r)
	case path == "traffic" && r.Method == "GET":
		err = s.trafficHistory(w, r)
	case strings.HasPrefix(path, "interface/"):
		err = s.interfaceSettings(w, r, strings.TrimPrefix(path, "interface/"))
	case path == "cores" && r.Method == "GET":
		s.cores(w)
	case path == "files" && r.Method == "GET":
		err = s.files(w, r)
	case path == "read" && r.Method == "POST":
		err = s.read(w, r)
	case path == "check" && r.Method == "POST":
		err = s.check(w, r, false)
	case path == "save" && r.Method == "POST":
		err = s.check(w, r, true)
	default:
		err = failure(405, "不支持此操作。")
	}
	if err != nil {
		writeError(w, err)
	}
}

func (s *Server) core(name string) (Core, error) {
	c, ok := s.config.Cores[name]
	if !ok || (name != "mihomo" && name != "sing-box") {
		return Core{}, failure(400, "请选择有效的核心类型。")
	}
	if name == "sing-box" {
		if runtime, err := processInputs(c); err == nil {
			c = runtime
		}
	}
	return c, nil
}
func binaryAvailable(c Core) bool {
	info, err := os.Stat(c.Binary)
	return err == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0
}
func (s *Server) cores(w http.ResponseWriter) {
	result := make([]map[string]any, 0, 2)
	for _, name := range []string{"mihomo", "sing-box"} {
		c, err := s.core(name)
		if err != nil {
			continue
		}
		path := c.Config
		directory := filepath.Dir(path)
		exists := false
		mode := "file"
		if groupMode(c) {
			mode = "fragments"
			if len(c.ConfigDirectories) > 0 {
				directory = c.ConfigDirectories[0]
			}
			if snapshot, err := snapshotSingBox(c); err == nil {
				exists = true
				if path == "" {
					path = snapshot.Inputs[0].Resolved
				}
			}
		} else {
			_, err := os.Stat(path)
			exists = err == nil
		}
		result = append(result, map[string]any{"id": name, "available": binaryAvailable(c), "path": path, "exists": exists, "roots": c.Roots, "directory": directory, "mode": mode, "configDirectories": c.ConfigDirectories})
	}
	writeJSON(w, 200, map[string]any{"cores": result, "maxBytes": maxFile, "localOnly": true})
}

func resolve(c Core, path string, directory bool) (string, error) {
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") || filepath.Clean(path) != path {
		return "", failure(400, "请填写规范的绝对路径。")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", failure(404, "文件或目录不存在，或无法读取。")
	}
	allowed := false
	for _, root := range c.Roots {
		r, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(r, resolved)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel) {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", failure(403, "请选择当前核心配置目录中的文件。")
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", failure(404, "无法读取文件信息。")
	}
	if directory {
		if !info.IsDir() {
			return "", failure(400, "请选择目录。")
		}
	} else {
		if !info.Mode().IsRegular() || info.Size() > maxFile {
			return "", failure(400, "只支持不超过 2 MB 的普通配置文件。")
		}
	}
	return resolved, nil
}
func readFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxFile+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxFile || !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
		return nil, failure(400, "配置需为不超过 2 MB 的 UTF-8 文本。")
	}
	return b, nil
}
func (s *Server) files(w http.ResponseWriter, r *http.Request) error {
	c, err := s.core(r.URL.Query().Get("core"))
	if err != nil {
		return err
	}
	dir := r.URL.Query().Get("path")
	if dir == "" {
		if len(c.ConfigDirectories) > 0 {
			dir = c.ConfigDirectories[0]
		} else {
			dir = filepath.Dir(c.Config)
		}
	}
	dir, err = resolve(c, dir, true)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return failure(403, "目录不可读取。")
	}
	items := make([]map[string]any, 0)
	truncated := false
	active, _ := filepath.EvalSymlinks(c.Config)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") || entry.Name() == "localdns-backups" {
			continue
		}
		candidate := filepath.Join(dir, entry.Name())
		resolved, err := filepath.EvalSymlinks(candidate)
		if err != nil {
			continue
		}
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		resolved, err = resolve(c, candidate, info.IsDir())
		if err != nil {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		supported := ext == ".json" || (r.URL.Query().Get("core") == "mihomo" && (ext == ".yaml" || ext == ".yml"))
		if !info.IsDir() && !supported && resolved != active {
			continue
		}
		if len(items) == 200 {
			truncated = true
			break
		}
		items = append(items, map[string]any{"name": entry.Name(), "path": resolved, "directory": info.IsDir(), "bytes": info.Size(), "active": isActiveConfig(c, resolved)})
	}
	writeJSON(w, 200, map[string]any{"directory": dir, "files": items, "truncated": truncated})
	return nil
}
func (s *Server) read(w http.ResponseWriter, r *http.Request) error {
	var input request
	if err := decode(r, w, &input); err != nil {
		return err
	}
	c, err := s.core(input.Core)
	if err != nil {
		return err
	}
	path, err := resolve(c, input.Path, false)
	if err != nil {
		return err
	}
	b, err := readFile(path)
	if err != nil {
		return err
	}
	response := map[string]any{"path": path, "content": string(b), "revision": digest(b), "core": input.Core, "active": isActiveConfig(c, path), "mode": "file"}
	if input.Core == "sing-box" && groupMode(c) && isActiveConfig(c, path) {
		group, err := snapshotSingBox(c)
		if err != nil {
			return err
		}
		response["groupRevision"] = group.Revision
		response["groupCount"] = len(group.Inputs)
		response["mode"] = "fragments"
	}
	writeJSON(w, 200, response)
	return nil
}
func isActiveConfig(c Core, path string) bool { return activeConfig(c, path) }

func (s *Server) check(w http.ResponseWriter, r *http.Request, save bool) error {
	var input request
	if err := decode(r, w, &input); err != nil {
		return err
	}
	if len(input.Content) > maxFile || strings.TrimSpace(input.Content) == "" || !utf8.ValidString(input.Content) {
		return failure(400, "配置不能为空，且不能超过 2 MB。")
	}
	if !s.operation.TryLock() {
		return failure(409, "另一个配置操作正在执行，请稍后重试。")
	}
	defer s.operation.Unlock()
	c, err := s.core(input.Core)
	if err != nil {
		return err
	}
	if !binaryAvailable(c) {
		return failure(422, "设备未安装此核心，无法执行核心校验。")
	}
	path, err := resolve(c, input.Path, false)
	if err != nil {
		return err
	}
	before, err := readFile(path)
	if err != nil {
		return err
	}
	if input.Revision == "" || input.Revision != digest(before) {
		return failure(409, "文件已被其他程序修改，请重新读取后合并改动。")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	stage, err := writeTemp(filepath.Dir(path), []byte(input.Content), 0o600)
	if err != nil {
		return err
	}
	defer os.Remove(stage)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var group *singBoxGroup
	validationCore := c
	validationPath := stage
	if input.Core == "sing-box" && !isActiveConfig(c, path) {
		validationCore.Config = ""
		validationCore.ConfigFiles = nil
		validationCore.ConfigDirectories = nil
	}
	if input.Core == "sing-box" && groupMode(c) && isActiveConfig(c, path) {
		group, err = snapshotSingBox(c)
		if err != nil {
			return err
		}
		if input.GroupRevision == "" || input.GroupRevision != group.Revision {
			return failure(409, "分片集合已变化，请重新读取并合并修改。")
		}
		staged, err := group.stage(c, path)
		if err != nil {
			return err
		}
		defer os.RemoveAll(staged.Root)
		if save {
			c.groupBefore, err = mergeSingBox(ctx, staged.Core, filepath.Join(staged.Root, "before-merged.json"))
			if err != nil {
				return err
			}
		}
		if err := group.overlay(staged, path, []byte(input.Content)); err != nil {
			return err
		}
		validationCore = staged.Core
		validationPath = staged.Selected
		c.groupAfter, err = mergeSingBox(ctx, staged.Core, filepath.Join(staged.Root, "after-merged.json"))
		if err != nil {
			return err
		}
		if err := validateMergedReferences(c.groupAfter); err != nil {
			return err
		}
	}
	detail, err := s.validate(ctx, input.Core, validationCore, validationPath)
	if err != nil {
		return &apiError{Status: 422, Message: "核心校验未通过，原配置未修改。", Detail: detail}
	}
	if group != nil && !group.unchanged(c) {
		return failure(409, "校验期间分片集合已变化，请重新读取。")
	}

	if !save {
		writeJSON(w, 200, map[string]any{"valid": true, "detail": detail, "revision": input.Revision})
		return nil
	}
	// Independent configs may be saved without changing the core's startup selection.
	active := isActiveConfig(c, path)
	if input.Content == string(before) {
		writeJSON(w, 200, map[string]any{"saved": false, "unchanged": true, "revision": input.Revision})
		return nil
	}
	if active && s.reloadReady != nil {
		if err := s.reloadReady(ctx, input.Core, c, before, []byte(input.Content)); err != nil {
			return failure(422, "无法确认本机重载通道。请保留可访问的核心控制接口，并检查核心进程与 PID 文件。原配置未修改。")
		}
	}
	if current, err := readFile(path); err != nil || digest(current) != input.Revision || (group != nil && !group.unchanged(c)) {
		return failure(409, "校验期间文件已变化，保存已停止，请重新读取。")
	}
	backupDir := filepath.Join(filepath.Dir(path), "localdns-backups")
	if existing, err := os.Lstat(backupDir); err == nil && (!existing.IsDir() || existing.Mode()&os.ModeSymlink != 0) {
		return failure(403, "备份目录不可用。")
	}
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return err
	}
	backup := filepath.Join(backupDir, filepath.Base(path)+"."+time.Now().Format("20060102-150405.000000000")+".bak")
	if err := writeExclusive(backup, before, 0o600); err != nil {
		return err
	}
	if err := preserveFile(stage, info); err != nil {
		return err
	}
	if current, err := readFile(path); err != nil || digest(current) != input.Revision || (group != nil && !group.unchanged(c)) {
		return failure(409, "写入前检测到文件变化，已停止保存，请重新读取。")
	}
	if err := os.Rename(stage, path); err != nil {
		return err
	}
	syncDir(filepath.Dir(path))
	log.Printf("save core=%s file=%s backup=%s", input.Core, path, backup)
	var reloadErr error
	if active {
		reloadErr = s.reload(ctx, input.Core, c, path, before)
	}
	if reloadErr != nil {
		restore, restoreErr := writeTemp(filepath.Dir(path), before, 0o600)
		if restoreErr == nil {
			restoreErr = preserveFile(restore, info)
		}
		if restoreErr == nil {
			restoreErr = os.Rename(restore, path)
			syncDir(filepath.Dir(path))
		}
		if restore != "" {
			os.Remove(restore)
		}
		if restoreErr != nil {
			return &apiError{Status: 500, Message: "重载失败，自动恢复文件也未完成，请立即检查备份。", Backup: backup}
		}
		rollbackCtx, stop := context.WithTimeout(context.Background(), 45*time.Second)
		defer stop()
		rollbackCore := c
		rollbackCore.groupBefore, rollbackCore.groupAfter = c.groupAfter, c.groupBefore
		rollbackErr := s.reload(rollbackCtx, input.Core, rollbackCore, path, []byte(input.Content))
		if rollbackErr != nil {
			return &apiError{Status: 502, Message: "重载失败，原文件已恢复；核心恢复尚未确认，请检查服务。", Backup: backup, RolledBack: true}
		}
		return &apiError{Status: 502, Message: "重载失败，已恢复原文件并重新加载原配置。修改仍保留在编辑器。", Backup: backup, RolledBack: true}
	}
	trimBackups(backupDir, filepath.Base(path)+".", 10)
	confirmation := "saved-only"
	if active {
		confirmation = "api"
	}
	if active && input.Core == "sing-box" {
		confirmation = "signal-and-health"
	}
	response := map[string]any{"saved": true, "active": active, "reloaded": active, "confirmation": confirmation, "revision": digest([]byte(input.Content)), "backup": backup, "detail": detail}
	if group != nil {
		next, err := snapshotSingBox(c)
		if err == nil {
			response["groupRevision"] = next.Revision
		}
	}
	writeJSON(w, 200, response)
	return nil
}

func writeExclusive(path string, b []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func writeTemp(dir string, b []byte, mode os.FileMode) (string, error) {
	f, err := os.CreateTemp(dir, ".localdns-config-*")
	if err != nil {
		return "", err
	}
	name := f.Name()
	err = f.Chmod(mode)
	if err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(name)
	}
	return name, err
}
func preserveFile(path string, info os.FileInfo) error {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		if err := os.Chown(path, int(st.Uid), int(st.Gid)); err != nil {
			return err
		}
	}
	return os.Chmod(path, info.Mode().Perm())
}
func syncDir(dir string) {
	if f, err := os.Open(dir); err == nil {
		f.Sync()
		f.Close()
	}
}
func trimBackups(dir, prefix string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), prefix) && strings.HasSuffix(entry.Name(), ".bak") {
			names = append(names, entry.Name())
		}
	}
	for len(names) > keep {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

type boundedOutput struct{ b []byte }

func (o *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if len(o.b) < 32768 {
		left := 32768 - len(o.b)
		if len(p) > left {
			p = p[:left]
		}
		o.b = append(o.b, p...)
	}
	return n, nil
}
func command(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out boundedOutput
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return string(out.b), err
}
func validateCore(ctx context.Context, name string, c Core, path string) (string, error) {
	var args []string
	if name == "mihomo" {
		args = []string{"-t", "-d", c.Directory, "-f", path}
	} else {
		if groupMode(c) {
			args = append([]string{"check"}, singBoxArguments(c, path)...)
		} else {
			args = []string{"check", "-D", c.Directory, "-c", path}
		}
	}
	output, err := command(ctx, c.Binary, args...)
	if err != nil {
		return scrubOutput(output, path), err
	}
	return "核心校验通过。", nil
}
func scrubOutput(output, path string) string {
	// Keep diagnostic locations, but suppress config values that could contain credentials or subscriptions.
	output = strings.ReplaceAll(output, path, "当前配置")
	lines := strings.Split(output, "\n")
	var result []string
	for _, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "secret") || strings.Contains(lower, "password") || strings.Contains(lower, "token") || strings.Contains(lower, "http://") || strings.Contains(lower, "https://") {
			result = append(result, "核心报告了配置项错误（具体值已隐藏）。")
			continue
		}
		if len(line) > 400 {
			line = line[:400] + "…"
		}
		if strings.TrimSpace(line) != "" {
			result = append(result, line)
		}
	}
	return strings.Join(result, "\n")
}

type mihomoControl struct {
	Address string `yaml:"external-controller"`
	Secret  string `yaml:"secret"`
}

func control(content []byte) (string, string, error) {
	var c mihomoControl
	if err := yaml.Unmarshal(content, &c); err != nil {
		return "", "", err
	}
	host, port, err := net.SplitHostPort(c.Address)
	if err != nil {
		return "", "", errors.New("missing HTTP controller")
	}
	if _, err := strconv.Atoi(port); err != nil {
		return "", "", err
	}
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	ip := net.ParseIP(host)
	allowed := ip != nil && ip.IsLoopback()
	addresses, _ := net.InterfaceAddrs()
	for _, addr := range addresses {
		network, _, err := net.ParseCIDR(addr.String())
		if err == nil && ip != nil && network.Equal(ip) {
			allowed = true
		}
	}
	if !allowed {
		return "", "", errors.New("controller is not local")
	}
	return "http://" + net.JoinHostPort(host, port), c.Secret, nil
}
func apiCall(ctx context.Context, address, secret, method, path string, body io.Reader) error {
	req, err := http.NewRequestWithContext(ctx, method, address+path, body)
	if err != nil {
		return err
	}
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 32768))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("controller returned %d", resp.StatusCode)
	}
	return nil
}
func singBoxControl(content []byte) (string, string, error) {
	var config struct {
		Experimental struct {
			ClashAPI struct {
				Address string `json:"external_controller"`
				Secret  string `json:"secret"`
			} `json:"clash_api"`
		} `json:"experimental"`
	}
	if err := json.Unmarshal(content, &config); err != nil {
		return "", "", err
	}
	mapped, _ := yaml.Marshal(mihomoControl{Address: config.Experimental.ClashAPI.Address, Secret: config.Experimental.ClashAPI.Secret})
	return control(mapped)
}
func singBoxPID(c Core) (int, error) {
	var b []byte
	var err error
	if c.PIDFile != "" {
		b, err = os.ReadFile(c.PIDFile)
	} else {
		err = os.ErrNotExist
	}
	if errors.Is(err, os.ErrNotExist) {
		expected, resolveErr := filepath.EvalSymlinks(c.Binary)
		if resolveErr != nil {
			return 0, resolveErr
		}
		entries, _ := os.ReadDir("/proc")
		found := 0
		for _, entry := range entries {
			pid, e := strconv.Atoi(entry.Name())
			if e != nil || pid < 2 {
				continue
			}
			if matchesSingBoxProcess(pid, expected) {
				if found != 0 {
					return 0, errors.New("multiple matching sing-box processes; configure pidFile")
				}
				found = pid
			}
		}
		if found == 0 {
			return 0, errors.New("sing-box process not found")
		}
		return found, nil
	}
	if err != nil {
		return 0, err
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || pid < 2 {
		return 0, errors.New("invalid PID")
	}
	expected, err := filepath.EvalSymlinks(c.Binary)
	if err != nil || !matchesSingBoxProcess(pid, expected) {
		return 0, errors.New("PID does not belong to sing-box")
	}

	return pid, nil
}
func reloadReady(ctx context.Context, name string, c Core, old, new []byte) error {
	if c.groupBefore != nil {
		old, new = c.groupBefore, c.groupAfter
	}
	if name == "sing-box" && groupMode(c) {
		actual, err := processInputs(c)
		if err != nil || strings.Join(singBoxArguments(actual, ""), "\x00") != strings.Join(singBoxArguments(c, ""), "\x00") {
			return errors.New("running sing-box inputs do not match the selected group")
		}
	}
	var address, secret string
	var err error
	if name == "mihomo" {
		address, secret, err = control(old)
		if err != nil {
			return err
		}
		if _, _, err := control(new); err != nil {
			return err
		}
	} else {
		if _, err := singBoxPID(c); err != nil {
			return err
		}
		address, secret, err = singBoxControl(old)
		if err != nil {
			return err
		}
		if _, _, err := singBoxControl(new); err != nil {
			return err
		}
	}
	return apiCall(ctx, address, secret, "GET", "/version", nil)
}
func reloadCore(ctx context.Context, name string, c Core, path string, previous []byte) error {
	if name == "mihomo" {
		oldAddress, oldSecret, err := control(previous)
		if err != nil {
			return err
		}
		content, err := readFile(path)
		if err != nil {
			return err
		}
		newAddress, newSecret, err := control(content)
		if err != nil {
			return err
		}
		body, _ := json.Marshal(map[string]string{"path": path})
		err = apiCall(ctx, oldAddress, oldSecret, "PUT", "/configs?force=true", strings.NewReader(string(body)))
		if err != nil && (oldAddress != newAddress || oldSecret != newSecret) {
			err = apiCall(ctx, newAddress, newSecret, "PUT", "/configs?force=true", strings.NewReader(string(body)))
		}
		if err != nil {
			return err
		}
		if len(c.PostReload) > 0 {
			if _, err := command(ctx, c.PostReload[0], c.PostReload[1:]...); err != nil {
				return fmt.Errorf("post reload hook failed: %w", err)
			}
		}
		return apiCall(ctx, newAddress, newSecret, "GET", "/version", nil)
	}
	pid, err := singBoxPID(c)
	if err != nil {
		return err
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(syscall.SIGHUP); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(800 * time.Millisecond):
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		return err
	}
	// sing-box does not expose a universal acknowledgement for SIGHUP; verify configured Clash API if present.
	var config struct {
		Experimental struct {
			ClashAPI struct {
				Address string `json:"external_controller"`
				Secret  string `json:"secret"`
			} `json:"clash_api"`
		} `json:"experimental"`
	}
	current, err := readFile(path)
	if c.groupAfter != nil {
		current, err = c.groupAfter, nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(current, &config); err != nil {
		return err
	}
	if config.Experimental.ClashAPI.Address != "" {
		c := mihomoControl{Address: config.Experimental.ClashAPI.Address, Secret: config.Experimental.ClashAPI.Secret}
		mapped, _ := yaml.Marshal(c)
		address, secret, err := control(mapped)
		if err != nil {
			return err
		}
		return apiCall(ctx, address, secret, "GET", "/version", nil)
	}
	return errors.New("sing-box reload requires a reachable Clash API for confirmation")
}

func main() {
	file := flag.String("config", "/etc/localdns-proxy-config.json", "service configuration")
	flag.Parse()
	b, err := os.ReadFile(*file)
	if err != nil {
		log.Fatal(err)
	}
	var config Config
	if err := json.Unmarshal(b, &config); err != nil {
		log.Fatal(err)
	}
	if config.Listen == "" || len(config.Origins) == 0 || len(config.Hosts) == 0 {
		log.Fatal("incomplete configuration")
	}
	if config.InterfaceFile == "" {
		config.InterfaceFile = "/opt/localdns-proxy-config/data/interface.json"
	}
	s := newServer(config)
	if config.TrafficDirectory == "" {
		config.TrafficDirectory = "/opt/localdns-proxy-config/data/traffic"
	}
	if config.MetricsURL == "" {
		config.MetricsURL = "http://127.0.0.1:9099/metrics"
	}
	s.traffic = newTrafficCollector(config.TrafficDirectory, config.MetricsURL)
	collectorContext, stopCollector := context.WithCancel(context.Background())
	defer stopCollector()
	go s.traffic.run(collectorContext)
	httpServer := &http.Server{Addr: config.Listen, Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 110 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		httpServer.Shutdown(ctx)
	}()
	log.Printf("listening on %s", config.Listen)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
