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
# Match the Python installer's standard: the manifest must cover the ui/
# tree exactly. Extra files (possibly planted) or missing files abort here,
# before anything is copied into the installation.
LIST_EXPECTED=$(mktemp "${TMPDIR:-/tmp}/localdns-manifest.XXXXXX")
LIST_ACTUAL=$(mktemp "${TMPDIR:-/tmp}/localdns-package.XXXXXX")
trap 'rm -f "$LIST_EXPECTED" "$LIST_ACTUAL"' EXIT HUP INT TERM
sed -n 's/^[0-9a-fA-F]\{64\}  //p' MANIFEST.sha256 | grep '^ui/' | LC_ALL=C sort > "$LIST_EXPECTED"
(cd ui && find . -type f -print | sed 's|^\./|ui/|' | LC_ALL=C sort) > "$LIST_ACTUAL"
EXTRA=$(comm -13 "$LIST_EXPECTED" "$LIST_ACTUAL")
MISSING=$(comm -23 "$LIST_EXPECTED" "$LIST_ACTUAL")
rm -f "$LIST_EXPECTED" "$LIST_ACTUAL"
trap - EXIT HUP INT TERM
if [ -n "$EXTRA" ] || [ -n "$MISSING" ]; then
  [ -z "$EXTRA" ] || printf '%s\n' "清单外多余文件：$EXTRA" >&2
  [ -z "$MISSING" ] || printf '%s\n' "清单内缺失文件：$MISSING" >&2
  echo '升级包文件集合与 MANIFEST.sha256 不一致，已中止' >&2
  exit 1
fi
UI_VERSION=$(sed -n 's/^LocalDNS UI //p' VERSION.txt)
case "$UI_VERSION" in ''|*[!A-Za-z0-9._-]*) echo "UI 版本信息无效" >&2; exit 1;; esac
PACKAGE_BACKEND=$(sed -n 's/^Backend //p' VERSION.txt)
# 内核代号不再是固定三位（FJGxx → FJH21），逐个列出需要同核心校验的后端。
case "$PACKAGE_BACKEND" in
  FJGLI|FJGOE|FJH21) SAME_CORE=1 ;;
  *) SAME_CORE=0 ;;
esac
if [ "$SAME_CORE" = 1 ] && [ -f "$INSTALL_DIR/ui/version.json" ]; then
  grep -Eq "\"backendVersion\"[[:space:]]*:[[:space:]]*\"$PACKAGE_BACKEND\"" "$INSTALL_DIR/ui/version.json" || {
    echo "此 UI 包需要 $PACKAGE_BACKEND。请先使用完整包的 upgrade-localdns.py 备份并迁移，或下载原核心的 UI 包。" >&2
    exit 1
  }
fi
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
