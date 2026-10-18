#!/bin/sh
set -eu
umask 077

usage() {
    printf '%s\n' 'Usage: sh install-proxy-config.sh http://SERVER:9099' \
        'Install on the same trusted LAN server as the DNS UI and proxy core.' \
        'Existing core paths, directory permissions and reload hooks are preserved.' \
        'DESTDIR=/absolute/staging/root stages files without starting services.'
}
case "${1:-}" in -h|--help) usage; exit 0;; esac
[ "$#" -eq 1 ] || { usage >&2; exit 1; }
UI_ORIGIN=$1
printf '%s\n' "$UI_ORIGIN" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$' || {
    echo 'Provide an HTTP(S) origin without a path, credentials or query string.' >&2; exit 1;
}
AUTHORITY=${UI_ORIGIN#*://}
case "$AUTHORITY" in
    *:*) PORT=${AUTHORITY##*:}; [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { echo 'Invalid UI port.' >&2; exit 1; }; HOST=${AUTHORITY%:*};;
    *) HOST=$AUTHORITY;;
esac
case "$UI_ORIGIN" in http://*:80) UI_ORIGIN="http://$HOST";; https://*:443) UI_ORIGIN="https://$HOST";; esac
case "${LOCALDNS_PROXY_CONFIG_ARCH:-$(uname -m)}" in
    x86_64|amd64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;;
    *) echo 'Supported service platforms: Linux amd64 and arm64.' >&2; exit 1;;
esac

STAGING=${DESTDIR:-}
if [ -n "$STAGING" ]; then
    case "$STAGING" in /*) ;; *) echo 'DESTDIR must be absolute.' >&2; exit 1;; esac
    [ -d "$STAGING" ] || { echo 'Create the staging root first.' >&2; exit 1; }
    STAGING=$(CDPATH= cd -- "$STAGING" && pwd -P)
    [ "$STAGING" != / ] || { echo 'Do not use / as DESTDIR.' >&2; exit 1; }
    MANAGER=staging
else
    [ "$(id -u)" -eq 0 ] || { echo 'Run the installer as root.' >&2; exit 1; }
    if command -v rc-service >/dev/null 2>&1; then MANAGER=openrc
    elif command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then MANAGER=systemd
    else echo 'An active OpenRC or systemd installation is required.' >&2; exit 1
    fi
fi

PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$PACKAGE_DIR"
sha256sum -c MANIFEST.sha256
PREFIX="$STAGING/opt/localdns-proxy-config"
CONFIG="$STAGING/etc/localdns-proxy-config.json"
[ ! -L "$PREFIX" ] && [ ! -L "$PREFIX/bin" ] && [ ! -L "$PREFIX/licenses" ] && [ ! -L "$CONFIG" ] || { echo 'Refusing symbolic-link install targets.' >&2; exit 1; }
STAMP=$(date +%Y%m%d-%H%M%S)-$$
BACKUP="$PREFIX/backups/install-$STAMP"
mkdir -p "$PREFIX/bin" "$PREFIX/licenses" "$BACKUP" "$STAGING/etc/init.d" "$STAGING/etc/systemd/system"
if [ -e "$PREFIX/bin/localdns-proxy-config" ]; then cp -p "$PREFIX/bin/localdns-proxy-config" "$BACKUP/localdns-proxy-config.binary"; fi
if [ -e "$CONFIG" ]; then
    [ -f "$CONFIG" ] || { echo 'Service configuration is not a regular file.' >&2; exit 1; }
    cp -p "$CONFIG" "$BACKUP/config.json"
else
    sed -e "s|127.0.0.1:9098|$HOST:9098|g" -e "s|http://127.0.0.1:9099|$UI_ORIGIN|g" \
        "$PACKAGE_DIR/config.example.json" > "$CONFIG.next-$STAMP"
    chmod 600 "$CONFIG.next-$STAMP"
    mv "$CONFIG.next-$STAMP" "$CONFIG"
fi
cp "$PACKAGE_DIR/bin/localdns-proxy-config-linux-$ARCH" "$PREFIX/bin/.next-$STAMP"
chmod 755 "$PREFIX/bin/.next-$STAMP"
mv "$PREFIX/bin/.next-$STAMP" "$PREFIX/bin/localdns-proxy-config"
cp "$PACKAGE_DIR"/licenses/* "$PREFIX/licenses/"
cp "$PACKAGE_DIR/README.md" "$PREFIX/README.md"
for SERVICE_FILE in etc/init.d/localdns-proxy-config etc/systemd/system/localdns-proxy-config.service; do
    if [ -e "$STAGING/$SERVICE_FILE" ]; then cp -p "$STAGING/$SERVICE_FILE" "$BACKUP/$(basename "$SERVICE_FILE")"; fi
done
cp "$PACKAGE_DIR/localdns-proxy-config.initd" "$STAGING/etc/init.d/localdns-proxy-config"
chmod 755 "$STAGING/etc/init.d/localdns-proxy-config"
cp "$PACKAGE_DIR/localdns-proxy-config.service" "$STAGING/etc/systemd/system/localdns-proxy-config.service"
chmod 644 "$STAGING/etc/systemd/system/localdns-proxy-config.service"

case "$MANAGER" in
    openrc) rc-service localdns-proxy-config restart; rc-update add localdns-proxy-config default;;
    systemd) systemctl daemon-reload; systemctl enable localdns-proxy-config.service; systemctl restart localdns-proxy-config.service;;
    staging) echo 'Staging only: services were not started.';;
esac
printf '%s\n' 'LocalDNS local configuration service installed.' "Configuration: $CONFIG" "Backup: $BACKUP" \
    'Adjust core binary paths, startup files and postReload hooks in the configuration when needed.'
