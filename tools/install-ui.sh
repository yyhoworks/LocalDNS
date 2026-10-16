#!/bin/sh
set -eu
umask 022
PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${1:-/opt/localdns}
case "$INSTALL_DIR" in /*) ;; *) echo "安装目录必须为绝对路径" >&2; exit 1;; esac
[ -d "$INSTALL_DIR/ui" ] || { echo "未找到已安装的 ui 目录" >&2; exit 1; }
INSTALL_DIR=$(CDPATH= cd -- "$INSTALL_DIR" && pwd -P)
[ "$INSTALL_DIR" != / ] || { echo "安装目录不能为根目录" >&2; exit 1; }
[ -f "$PACKAGE_DIR/ui/index.html" ] || { echo "升级包不完整" >&2; exit 1; }
cd "$PACKAGE_DIR"
sha256sum -c MANIFEST.sha256
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$INSTALL_DIR/ui-backup-2026.10.16.1-$STAMP-$$.tar.gz"
STAGE="$INSTALL_DIR/.ui-stage-2026.10.16.1-$STAMP-$$"
PREVIOUS="$INSTALL_DIR/ui.previous-2026.10.16.1-$STAMP-$$"
tar -C "$INSTALL_DIR" -czf "$BACKUP" ui
cp -a "$PACKAGE_DIR/ui" "$STAGE"
ROLLBACK=0
restore_ui() {
  if [ "$ROLLBACK" = 1 ] && [ ! -e "$INSTALL_DIR/ui" ] && [ -d "$PREVIOUS" ]; then
    mv "$PREVIOUS" "$INSTALL_DIR/ui"
  fi
}
trap restore_ui 0
trap 'exit 1' HUP INT TERM
ROLLBACK=1
mv "$INSTALL_DIR/ui" "$PREVIOUS"
mv "$STAGE" "$INSTALL_DIR/ui"
ROLLBACK=0
printf '%s\n' "LocalDNS UI 2026.10.16.1 已安装" "备份：$BACKUP" "上一版目录：$PREVIOUS"
