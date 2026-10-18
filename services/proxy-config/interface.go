package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

type displayIdentity struct {
	Name string `json:"name"`
	Logo string `json:"logo"`
	URL  string `json:"url,omitempty"`
}
type interfaceState struct {
	LocalDNS *displayIdentity `json:"localdns"`
	Proxy    *displayIdentity `json:"proxy"`
}
type interfaceUpdate struct {
	Value    displayIdentity `json:"value"`
	Revision string          `json:"revision"`
}

func webURL(value string) bool {
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && len(value) <= 4096
}
func validateIdentity(section string, value *displayIdentity) error {
	value.Name = strings.TrimSpace(value.Name)
	value.Logo = strings.TrimSpace(value.Logo)
	value.URL = strings.TrimSpace(value.URL)
	if value.Name == "" || utf8.RuneCountInString(value.Name) > 32 || strings.IndexFunc(value.Name, unicode.IsControl) >= 0 {
		return failure(400, "名称需为 1 到 32 个字符，不能包含换行或控制字符。")
	}
	if section == "proxy" {
		if !webURL(value.URL) {
			return failure(400, "请使用不含账号密码的 HTTP(S) 面板地址。")
		}
	} else if value.URL != "" {
		return failure(400, "LocalDNS 标识无需填写面板地址。")
	}
	if value.Logo == "" || webURL(value.Logo) {
		return nil
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(value.Logo, prefix) || len(value.Logo) > 500000 {
		return failure(400, "Logo 需为 HTTP(S) 图片地址，或上传后生成的 PNG 图片。")
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value.Logo, prefix))
	if err != nil {
		return failure(400, "Logo 图片编码无效。")
	}
	info, err := png.DecodeConfig(bytes.NewReader(b))
	if err != nil || info.Width < 1 || info.Height < 1 || info.Width > 256 || info.Height > 256 {
		return failure(400, "上传的 Logo 需为最长边不超过 256 像素的有效 PNG。")
	}
	return nil
}

func (s *Server) interfaceSettings(w http.ResponseWriter, r *http.Request, section string) error {
	if section != "localdns" && section != "proxy" {
		return failure(404, "界面设置不存在。")
	}
	if r.Method != "GET" && r.Method != "POST" {
		return failure(405, "不支持此操作。")
	}
	file := s.config.InterfaceFile
	if !filepath.IsAbs(file) {
		return failure(503, "服务未配置界面设置存储路径。")
	}
	s.interfaceLock.Lock()
	defer s.interfaceLock.Unlock()
	state := interfaceState{}
	var before []byte
	info, err := os.Lstat(file)
	if err == nil {
		if !info.Mode().IsRegular() {
			return failure(500, "服务器上的界面设置文件不可用。")
		}
		before, err = readFile(file)
		if err != nil || json.Unmarshal(before, &state) != nil {
			return failure(500, "服务器上的界面设置无法读取，请检查设置文件或备份。")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	value := state.LocalDNS
	if section == "proxy" {
		value = state.Proxy
	}
	encoded, _ := json.Marshal(value)
	revision := digest(encoded)
	if r.Method == "GET" {
		writeJSON(w, 200, map[string]any{"value": value, "revision": revision})
		return nil
	}
	var input interfaceUpdate
	if err := decode(r, w, &input); err != nil {
		return err
	}
	if input.Revision != revision {
		return failure(409, "设置已被其他设备修改，请重新读取后保存。")
	}
	if err := validateIdentity(section, &input.Value); err != nil {
		return err
	}
	if section == "proxy" {
		state.Proxy = &input.Value
	} else {
		state.LocalDNS = &input.Value
	}
	dir := filepath.Dir(file)
	if existing, err := os.Lstat(dir); err == nil && (!existing.IsDir() || existing.Mode()&os.ModeSymlink != 0) {
		return failure(500, "界面设置目录不可用。")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(state, "", "  ")
	stage, err := writeTemp(dir, append(data, '\n'), 0o600)
	if err != nil {
		return err
	}
	defer os.Remove(stage)
	if before != nil {
		backup, err := writeTemp(dir, before, 0o600)
		if err != nil {
			return err
		}
		defer os.Remove(backup)
		if err := os.Rename(backup, file+".bak"); err != nil {
			return err
		}
	}
	if err := os.Rename(stage, file); err != nil {
		return err
	}
	syncDir(dir)
	encoded, _ = json.Marshal(input.Value)
	writeJSON(w, 200, map[string]any{"value": input.Value, "revision": digest(encoded), "saved": true})
	return nil
}
