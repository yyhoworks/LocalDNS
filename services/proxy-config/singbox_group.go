package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

// Native check accepts some unresolved route/selector references until Start.
// Check these against the fully merged group before replacing any live file.
func validateMergedReferences(content []byte) error {
	var config map[string]any
	if err := json.Unmarshal(content, &config); err != nil {
		return err
	}
	tags := map[string]bool{}
	for _, key := range []string{"outbounds", "endpoints"} {
		items, _ := config[key].([]any)
		for _, item := range items {
			if object, ok := item.(map[string]any); ok {
				if tag, ok := object["tag"].(string); ok && tag != "" {
					tags[tag] = true
				}
			}
		}
	}
	require := func(tag, field string) error {
		if tag != "" && !tags[tag] {
			return &apiError{Status: 422, Message: "分片引用检查未通过，原配置未修改。", Detail: fmt.Sprintf("%s 引用了不存在的出口：%s", field, tag)}
		}
		return nil
	}
	if route, ok := config["route"].(map[string]any); ok {
		if tag, ok := route["final"].(string); ok {
			if err := require(tag, "route.final"); err != nil {
				return err
			}
		}
		var rules func([]any) error
		rules = func(items []any) error {
			for _, item := range items {
				object, ok := item.(map[string]any)
				if !ok {
					continue
				}
				if tag, ok := object["outbound"].(string); ok {
					if err := require(tag, "route.rules.outbound"); err != nil {
						return err
					}
				}
				if nested, ok := object["rules"].([]any); ok {
					if err := rules(nested); err != nil {
						return err
					}
				}
			}
			return nil
		}
		if items, ok := route["rules"].([]any); ok {
			if err := rules(items); err != nil {
				return err
			}
		}
	}
	items, _ := config["outbounds"].([]any)
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{"detour", "default"} {
			if tag, ok := object[key].(string); ok {
				if err := require(tag, "outbounds."+key); err != nil {
					return err
				}
			}
		}
		if choices, ok := object["outbounds"].([]any); ok {
			for _, choice := range choices {
				if tag, ok := choice.(string); ok {
					if err := require(tag, "selector/urltest"); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

// Alpine's gcompat may expose the loader as /proc/PID/exe. In that case also
// require an executable mapping of the exact configured binary inode.
func matchesSingBoxProcess(pid int, expected string) bool {
	exe, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "exe"))
	if err != nil {
		return false
	}
	if exe == expected {
		return true
	}
	base := filepath.Base(exe)
	if !strings.HasPrefix(base, "ld-musl-") && !strings.HasPrefix(base, "ld-linux-") {
		return false
	}
	info, err := os.Stat(expected)
	if err != nil {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	file, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "maps"))
	if err != nil {
		return false
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 6 || !strings.Contains(fields[1], "x") || strings.Join(fields[5:], " ") != expected {
			continue
		}
		inode, err := strconv.ParseUint(fields[4], 10, 64)
		if err == nil && inode == stat.Ino {
			return true
		}
	}
	return false
}

type groupInput struct {
	Path, Resolved string
	Data           []byte
}
type singBoxGroup struct {
	Inputs   []groupInput
	Revision string
}

func singBoxFiles(c Core) []string {
	files := []string{}
	if c.Config != "" {
		files = append(files, c.Config)
	}
	return append(files, c.ConfigFiles...)
}
func groupMode(c Core) bool { return len(c.ConfigDirectories) > 0 || len(c.ConfigFiles) > 0 }
func activeConfig(c Core, path string) bool {
	for _, file := range singBoxFiles(c) {
		resolved, err := filepath.EvalSymlinks(file)
		if err == nil && resolved == path {
			return true
		}
	}
	for _, directory := range c.ConfigDirectories {
		resolved, err := filepath.EvalSymlinks(directory)
		if err != nil {
			continue
		}
		entries, _ := os.ReadDir(resolved)
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			file, err := filepath.EvalSymlinks(filepath.Join(resolved, entry.Name()))
			if err == nil && file == path {
				return true
			}
		}
	}
	return false
}
func snapshotSingBox(c Core) (*singBoxGroup, error) {
	paths := append([]string{}, singBoxFiles(c)...)
	for _, directory := range c.ConfigDirectories {
		resolved, err := resolve(c, directory, true)
		if err != nil {
			return nil, err
		}
		entries, err := os.ReadDir(resolved)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
				paths = append(paths, filepath.Join(directory, entry.Name()))
			}
		}
	}
	if len(paths) == 0 || len(paths) > 128 {
		return nil, failure(400, "分片配置需包含 1 到 128 个 JSON 文件。")
	}
	sort.Strings(paths) // sing-box sorts all input paths before merging.
	group := &singBoxGroup{}
	manifest := []string{}
	total := 0
	for _, path := range paths {
		resolved, err := resolve(c, path, false)
		if err != nil {
			return nil, err
		}
		data, err := readFile(resolved)
		if err != nil {
			return nil, err
		}
		total += len(data)
		if total > 8<<20 {
			return nil, failure(400, "分片配置总大小不能超过 8 MB。")
		}
		group.Inputs = append(group.Inputs, groupInput{Path: path, Resolved: resolved, Data: data})
		manifest = append(manifest, path+"\x00"+resolved+"\x00"+digest(data))
	}
	encoded, _ := json.Marshal(manifest)
	group.Revision = digest(encoded)
	return group, nil
}
func (g *singBoxGroup) unchanged(c Core) bool {
	next, err := snapshotSingBox(c)
	return err == nil && next.Revision == g.Revision
}

type stagedGroup struct {
	Root     string
	Core     Core
	Selected string
}

func (g *singBoxGroup) stage(c Core, selected string) (*stagedGroup, error) {
	root, err := os.MkdirTemp("", "localdns-singbox-*")
	if err != nil {
		return nil, err
	}
	stage := &stagedGroup{Root: root, Core: c}
	ok := false
	defer func() {
		if !ok {
			os.RemoveAll(root)
		}
	}()
	mirror := func(path string) string {
		return filepath.Join(root, strings.TrimPrefix(path, string(filepath.Separator)))
	}
	for _, input := range g.Inputs {
		path := mirror(input.Path)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, err
		}
		if err := os.WriteFile(path, input.Data, 0o600); err != nil {
			return nil, err
		}
		if input.Resolved == selected {
			stage.Selected = path
		}
	}
	if c.Config != "" {
		stage.Core.Config = mirror(c.Config)
	}
	stage.Core.ConfigFiles = nil
	for _, file := range c.ConfigFiles {
		stage.Core.ConfigFiles = append(stage.Core.ConfigFiles, mirror(file))
	}
	stage.Core.ConfigDirectories = nil
	for _, directory := range c.ConfigDirectories {
		path := mirror(directory)
		os.MkdirAll(path, 0o700)
		stage.Core.ConfigDirectories = append(stage.Core.ConfigDirectories, path)
	}
	if stage.Selected == "" {
		return nil, failure(409, "当前文件已不在启动分片集合中，请重新读取。")
	}
	ok = true
	return stage, nil
}
func (g *singBoxGroup) overlay(stage *stagedGroup, selected string, content []byte) error {
	for _, input := range g.Inputs {
		if input.Resolved == selected {
			path := filepath.Join(stage.Root, strings.TrimPrefix(input.Path, string(filepath.Separator)))
			if err := os.WriteFile(path, content, 0o600); err != nil {
				return err
			}
		}
	}
	return nil
}
func singBoxArguments(c Core, fallback string) []string {
	args := []string{"-D", c.Directory}
	files := singBoxFiles(c)
	if len(files) == 0 && len(c.ConfigDirectories) == 0 {
		files = []string{fallback}
	}
	for _, file := range files {
		args = append(args, "-c", file)
	}
	for _, directory := range c.ConfigDirectories {
		args = append(args, "-C", directory)
	}
	return args
}
func mergeSingBox(ctx context.Context, c Core, output string) ([]byte, error) {
	args := append([]string{"merge", output}, singBoxArguments(c, "")...)
	message, err := command(ctx, c.Binary, args...)
	if err != nil {
		return nil, &apiError{Status: 422, Message: "整套分片无法合并，原配置未修改。", Detail: scrubOutput(message, output)}
	}
	os.Chmod(output, 0o600)
	return readFile(output)
}
func processInputs(c Core) (Core, error) {
	pid, err := singBoxPID(c)
	if err != nil {
		return c, err
	}
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cmdline"))
	if err != nil {
		return c, err
	}
	args := strings.Split(strings.TrimRight(string(data), "\x00"), "\x00")
	cwd, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "cwd"))
	if err != nil {
		return c, err
	}
	files, dirs := []string{}, []string{}
	working := cwd
	for i := 1; i < len(args); i++ {
		arg := args[i]
		flag, value, hasValue := strings.Cut(arg, "=")
		if !hasValue && len(arg) > 2 && strings.ContainsRune("cCD", rune(arg[1])) && arg[0] == '-' && arg[1] != '-' {
			flag, value, hasValue = arg[:2], arg[2:], true
		}
		if flag != "-c" && flag != "--config" && flag != "-C" && flag != "--config-directory" && flag != "-D" && flag != "--directory" {
			continue
		}
		if !hasValue {
			if i+1 >= len(args) {
				return c, errors.New("missing process flag value")
			}
			i++
			value = args[i]
		}
		switch flag {
		case "-c", "--config":
			files = append(files, value)
		case "-C", "--config-directory":
			dirs = append(dirs, value)
		default:
			working = value
		}
	}
	if len(files) == 0 && len(dirs) == 0 {
		return c, errors.New("process has no explicit config inputs")
	}
	if !filepath.IsAbs(working) {
		working = cwd
	}
	absolute := func(path string) string {
		if !filepath.IsAbs(path) {
			return filepath.Clean(filepath.Join(working, path))
		}
		return filepath.Clean(path)
	}
	c.Config = ""
	c.ConfigFiles = nil
	c.ConfigDirectories = nil
	c.Directory = working
	for i, file := range files {
		if i == 0 {
			c.Config = absolute(file)
		} else {
			c.ConfigFiles = append(c.ConfigFiles, absolute(file))
		}
	}
	for _, directory := range dirs {
		c.ConfigDirectories = append(c.ConfigDirectories, absolute(directory))
	}
	return c, nil
}
