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
UI_VERSION=$(sed -n 's/^LocalDNS UI //p' VERSION.txt)
case "$UI_VERSION" in ''|*[!A-Za-z0-9._-]*) echo "UI 版本信息无效" >&2; exit 1;; esac
LOCK_FILE="$(dirname -- "$INSTALL_DIR")/.$(basename -- "$INSTALL_DIR")-installer.lock"
(set -C; umask 077; printf '%s\n' "$$" > "$LOCK_FILE") 2>/dev/null || { echo '已有安装任务或遗留安装锁'; exit 1; }
ROLLBACK=0
restore_ui() {
  if [ "$ROLLBACK" = 1 ] && [ ! -e "$INSTALL_DIR/ui" ] && [ -d "$PREVIOUS" ]; then
    mv "$PREVIOUS" "$INSTALL_DIR/ui"
  fi
  rm -f "$LOCK_FILE"
}
trap restore_ui 0
trap 'exit 1' HUP INT TERM
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$INSTALL_DIR/ui-backup-$UI_VERSION-$STAMP-$$.tar.gz"
STAGE="$INSTALL_DIR/.ui-stage-$UI_VERSION-$STAMP-$$"
PREVIOUS="$INSTALL_DIR/ui.previous-$UI_VERSION-$STAMP-$$"
tar -C "$INSTALL_DIR" -czf "$BACKUP" ui
cp -a "$PACKAGE_DIR/ui" "$STAGE"
if [ -f "$INSTALL_DIR/ui/config.js" ]; then cp -p "$INSTALL_DIR/ui/config.js" "$STAGE/config.js"; fi
if [ -e "$INSTALL_DIR/ui/custom" ]; then
  [ -d "$INSTALL_DIR/ui/custom" ] && [ ! -L "$INSTALL_DIR/ui/custom" ] || { echo '共享配置目录无效'; exit 1; }
  [ -z "$(find "$INSTALL_DIR/ui/custom" -type l -print)" ] || { echo '共享配置目录包含符号链接'; exit 1; }
  # This is the exact freshly copied staging directory created above.
  if [ -d "$STAGE/custom" ]; then rm -r "$STAGE/custom"; fi
  cp -a "$INSTALL_DIR/ui/custom" "$STAGE/custom"
fi
ROLLBACK=1
mv "$INSTALL_DIR/ui" "$PREVIOUS"
mv "$STAGE" "$INSTALL_DIR/ui"
ROLLBACK=0
printf '%s\n' "LocalDNS UI $UI_VERSION 已安装" "备份：$BACKUP" "上一版目录：$PREVIOUS"
