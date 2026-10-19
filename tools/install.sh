#!/bin/sh
# LocalDNS bootstrap. The Python installer uses only the standard library.
set -eu

case "${1:-}" in
  -h|--help)
    printf '%s\n' 'LocalDNS 一键安装 / UI 更新' \
      '新安装：sh install.sh' \
      '已有安装默认只更新 UI，保留核心、配置与规则。' \
      '参数：--dir /opt/localdns --version TAG --dns-port 53 --http-port 9099' \
      '      --with-ui-updater --ui-updater-url https://HOST/_updater' \
      '      --origin http://SERVER:9099' \
      '      --package-dir /offline/packages --stage-root /absolute/staging/root'
    exit 0;;
esac

[ "$(uname -s)" = Linux ] || { echo '请在 Linux 服务器上运行。' >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo '请切换为 root，或用 sudo sh install.sh 运行。' >&2; exit 1; }

install_python() {
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache python3 ca-certificates
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 ca-certificates
  else
    echo '请先安装 Python 3.8 或更新版本及系统 CA 证书。' >&2
    exit 1
  fi
}
command -v python3 >/dev/null 2>&1 || install_python
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else "需要 Python 3.8 或更新版本")'

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# Updated together with install_localdns.py; an old bootstrap fails closed.
ENGINE_SHA256=e59c461a5c188e125f7c282322d7a05672eb44c5296a0a0afc7504cafa7f1297
if [ -f "$SCRIPT_DIR/install_localdns.py" ]; then
  python3 - "$SCRIPT_DIR/install_localdns.py" "$ENGINE_SHA256" <<'PY'
import hashlib, pathlib, sys
if hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit('本地安装器版本不一致，请重新下载 install.sh 与 install_localdns.py。')
PY
  exec python3 "$SCRIPT_DIR/install_localdns.py" "$@"
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/localdns-bootstrap.XXXXXXXX")
trap 'rm -rf "$WORK"' 0
trap 'exit 1' HUP INT TERM
python3 - "$WORK/install_localdns.py" "$ENGINE_SHA256" <<'PY'
import hashlib, pathlib, sys, urllib.error, urllib.request
url = 'https://raw.githubusercontent.com/yyhoworks/LocalDNS/main/tools/install_localdns.py'
try:
    request = urllib.request.Request(url, headers={'User-Agent': 'LocalDNS-bootstrap'})
    with urllib.request.urlopen(request, timeout=45) as response:
        source = response.read(1024 * 1024)
    if hashlib.sha256(source).hexdigest() != sys.argv[2]:
        raise ValueError('安装器摘要不匹配，请重新下载最新 install.sh')
    compile(source, url, 'exec')
    pathlib.Path(sys.argv[1]).write_bytes(source)
except (OSError, ValueError, SyntaxError, urllib.error.URLError) as error:
    raise SystemExit('安装器下载失败，请检查 GitHub 连通性和系统 CA 证书：' + str(error))
PY
python3 "$WORK/install_localdns.py" "$@"
