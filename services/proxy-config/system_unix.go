//go:build !windows

package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func preserveFile(path string, info os.FileInfo) error {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		if err := os.Chown(path, int(st.Uid), int(st.Gid)); err != nil {
			return err
		}
	}
	return os.Chmod(path, info.Mode().Perm())
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

func binaryAvailable(c Core) bool {
	info, err := os.Stat(c.Binary)
	return err == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0
}
