package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

// Preserve the original text in the editor. This normalized copy is used only
// for recognizing JSONC and reading the controller settings, never for saving.
func jsonContent(content []byte) []byte {
	result := append([]byte(nil), content...)
	quoted, escaped := false, false
	for i := 0; i < len(result); i++ {
		if quoted {
			if escaped {
				escaped = false
			} else if result[i] == '\\' {
				escaped = true
			} else if result[i] == '"' {
				quoted = false
			}
			continue
		}
		if result[i] == '"' {
			quoted = true
			continue
		}
		if result[i] != '/' || i+1 >= len(result) {
			continue
		}
		if result[i+1] == '/' {
			for ; i < len(result) && result[i] != '\n'; i++ {
				result[i] = ' '
			}
		} else if result[i+1] == '*' {
			result[i], result[i+1] = ' ', ' '
			i += 2
			for ; i+1 < len(result) && !(result[i] == '*' && result[i+1] == '/'); i++ {
				if result[i] != '\n' {
					result[i] = ' '
				}
			}
			if i+1 >= len(result) {
				return content
			} // Leave an unterminated comment invalid.
			result[i], result[i+1] = ' ', ' '
			i++
		}
	}
	quoted, escaped = false, false
	for i, c := range result {
		if quoted {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				quoted = false
			}
			continue
		}
		if c == '"' {
			quoted = true
			continue
		}
		if c != ',' {
			continue
		}
		j := i + 1
		for j < len(result) && strings.ContainsRune(" \t\r\n", rune(result[j])) {
			j++
		}
		if j < len(result) && (result[j] == '}' || result[j] == ']') {
			result[i] = ' '
		}
	}
	return result
}

func importURL(value string) (*url.URL, error) {
	u, err := url.Parse(value)
	if err != nil || len(value) > 4096 || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, failure(400, "请填写不含账号密码或片段的 HTTP(S) 配置链接。")
	}
	return u, nil
}

// importAllowed decides whether the fetch endpoint may connect to a resolved
// address. Private LAN, loopback, and public addresses are allowed so LAN
// subscription services work without extra configuration. Link-local addresses
// — including cloud metadata — multicast and unspecified addresses are never
// allowed; every redirect target is re-checked here.
func importAllowed(ip net.IP) bool {
	return !(ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified())
}

func importClient() *http.Client {
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !importAllowed(ip.IP) {
				return nil, failure(400, "此配置链接指向不支持的网络地址。")
			}
		}
		for _, ip := range ips {
			connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
			if dialErr == nil {
				return connection, nil
			}
			err = dialErr
		}
		if err == nil {
			err = failure(502, "配置链接没有可连接的地址。")
		}
		return nil, err
	}}
	return &http.Client{Timeout: 15 * time.Second, Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return failure(400, "配置链接重定向次数过多。")
		}
		_, err := importURL(req.URL.String())
		if err == nil && via[0].URL.Scheme == "https" && req.URL.Scheme != "https" {
			return failure(400, "配置链接不能从 HTTPS 重定向到 HTTP。")
		}
		return err
	}}
}

func (s *Server) fetchConfig(w http.ResponseWriter, r *http.Request) error {
	var input struct {
		URL  string `json:"url"`
		Core string `json:"core"`
	}
	if err := decode(r, w, &input); err != nil {
		return err
	}
	if input.Core != "mihomo" && input.Core != "sing-box" {
		return failure(400, "请先选择要导入的核心类型。")
	}
	u, err := importURL(strings.TrimSpace(input.URL))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(r.Context(), 16*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return failure(400, "配置链接格式无效。")
	}
	req.Header.Set("Accept", "application/json, application/yaml, text/yaml, text/plain, */*;q=0.5")
	client := importClient()
	defer client.CloseIdleConnections()
	response, err := client.Do(req)
	if err != nil {
		return failure(502, "无法读取配置链接，请检查地址、网络与访问权限后重试。")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return failure(502, "配置链接未返回成功响应，请检查地址与访问权限。")
	}
	if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
		return failure(422, "链接返回了网页，请使用原始 YAML 或 JSON 配置链接。")
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxFile+1))
	if err != nil {
		return failure(502, "配置下载中断，请重试。")
	}
	if len(content) > maxFile || !utf8.Valid(content) || strings.ContainsRune(string(content), 0) {
		return failure(422, "配置需为不超过 2 MB 的 UTF-8 文本。")
	}
	var object map[string]any
	if input.Core == "sing-box" {
		err = json.Unmarshal(jsonContent(content), &object)
	} else {
		err = yaml.Unmarshal(content, &object)
	}
	if err != nil || len(object) == 0 {
		return failure(422, "内容不是所选核心的有效配置对象，请检查配置格式。")
	}
	if input.Core == "mihomo" {
		if _, ok := object["outbounds"]; ok {
			return failure(422, "这是 sing-box 配置，请切换核心后读取。")
		}
		known := false
		for _, key := range []string{"proxies", "proxy-providers", "proxy-groups", "rules", "rule-providers", "mode", "mixed-port", "external-controller", "port", "dns", "tun", "listeners"} {
			if _, ok := object[key]; ok {
				known = true
			}
		}
		if !known {
			return failure(422, "未识别出 Mihomo 配置字段，请使用完整的 YAML 配置。")
		}
	} else {
		known := false
		for _, key := range []string{"outbounds", "inbounds", "route", "experimental", "dns", "log", "services", "endpoints"} {
			if _, ok := object[key]; ok {
				known = true
			}
		}
		if !known {
			return failure(422, "未识别出 sing-box 配置字段，请使用完整的 JSON 配置。")
		}
	}
	writeJSON(w, 200, map[string]any{"core": input.Core, "content": string(content), "bytes": len(content), "sourceHost": response.Request.URL.Host, "imported": true})
	return nil
}
