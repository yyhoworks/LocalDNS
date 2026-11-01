#!/bin/sh
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v python3 >/dev/null || { echo '需要 Python 3'; exit 1; }
[ "$(id -u)" = 0 ] || { echo '请以 root 安装采集服务'; exit 1; }
mkdir -p /opt/localdns-traffic /var/lib/localdns-traffic
if command -v rc-service >/dev/null; then
  MANAGER=openrc
  rc-service localdns-traffic stop 2>/dev/null || true
elif command -v systemctl >/dev/null; then
  MANAGER=systemd
  systemctl stop localdns-traffic 2>/dev/null || true
else
  echo '当前系统未提供 OpenRC 或 systemd，未修改服务'; exit 1
fi
STAMP=$(date +%Y%m%d-%H%M%S)
if [ -f /opt/localdns-traffic/traffic_collector.py ]; then cp -p /opt/localdns-traffic/traffic_collector.py "/opt/localdns-traffic/traffic_collector.py.$STAMP.bak"; fi
if [ -f /var/lib/localdns-traffic/state.json ]; then cp -p /var/lib/localdns-traffic/state.json "/var/lib/localdns-traffic/state.json.$STAMP.bak"; fi
if [ "$MANAGER" = openrc ]; then
  cp "$SOURCE/traffic_collector.py" /opt/localdns-traffic/traffic_collector.py
  cp "$SOURCE/localdns-traffic.initd" /etc/init.d/localdns-traffic
  chmod 755 /etc/init.d/localdns-traffic /opt/localdns-traffic/traffic_collector.py
  rc-update add localdns-traffic default
  rc-service localdns-traffic start
else
  cp "$SOURCE/traffic_collector.py" /opt/localdns-traffic/traffic_collector.py
  cp "$SOURCE/localdns-traffic.service" /etc/systemd/system/localdns-traffic.service
  systemctl daemon-reload
  systemctl enable --now localdns-traffic
fi
echo '采集器已安装，原有用量保留。'
