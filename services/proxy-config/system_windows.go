// Windows supports development tests of the HTTP interface. Production packages target Linux.
package main

import (
	"os"
	"path/filepath"
	"strings"
)

func preserveFile(path string, info os.FileInfo) error { return os.Chmod(path, info.Mode().Perm()) }
func matchesSingBoxProcess(_ int, _ string) bool       { return false }
func binaryAvailable(c Core) bool {
	info, err := os.Stat(c.Binary)
	return err == nil && info.Mode().IsRegular() && strings.EqualFold(filepath.Ext(c.Binary), ".exe")
}
