#!/usr/bin/env python3
"""代理流量采集器（LocalDNS 概览「代理流量」卡的数据源）。

内核不统计代理字节数，所以这里轮询 Mihomo / sing-box 的 Clash API，
按 chains 过滤掉直连连接，把「走代理」的下载 / 上传累计成日汇总，
写到 UI 的 custom 目录（UI 升级时保留），概览页直接读这个文件。

- 只统计走代理的连接：chains[0] 不是 DIRECT / REJECT 才算。
- 每个连接按 id 记录已计入的字节数，每次只累加增量；连接消失时它的尾部
  增量在上一次轮询已经计入，因此不会重复也不会漏掉整段。
- 轮询间隔默认 5 秒：短于这个间隔就关闭的连接可能漏计，属于已知精度边界。

用法：
    python3 traffic_collector.py --once            # 采一次，用于验证
    python3 traffic_collector.py --interval 5      # 常驻
"""

import argparse
import datetime as dt
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_CONTROLLER = "http://127.0.0.1:9090"
DEFAULT_OUT = "/opt/localdns/ui/custom/traffic.json"
DEFAULT_STATE = "/var/lib/localdns-traffic/state.json"
DIRECT = {"DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"}


def log(message):
    sys.stderr.write("[proxy-traffic] %s\n" % message)
    sys.stderr.flush()


def http_json(url, secret="", timeout=8):
    request = urllib.request.Request(url)
    if secret:
        request.add_header("Authorization", "Bearer " + secret)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def read_controller_from_config(path):
    """从 mihomo 配置里取 external-controller / secret（只做最小解析）。"""
    controller, secret = "", ""
    try:
        with open(path, "r", encoding="utf-8") as stream:
            for line in stream:
                stripped = line.strip()
                if stripped.startswith("external-controller:"):
                    controller = stripped.split(":", 1)[1].strip().strip('"\'')
                elif stripped.startswith("secret:"):
                    secret = stripped.split(":", 1)[1].strip().strip('"\'')
    except OSError:
        return "", ""
    if controller and not controller.startswith("http"):
        controller = "http://" + controller
    return controller, secret


def is_proxied(connection):
    chains = connection.get("chains") or []
    if not chains:
        return False
    head = str(chains[0]).upper()
    return head not in DIRECT


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as stream:
            state = json.load(stream)
        if isinstance(state, dict):
            state.setdefault("seen", {})
            state.setdefault("daily", {})
            state.setdefault("since", dt.date.today().isoformat())
            return state
    except (OSError, ValueError):
        pass
    return {"seen": {}, "daily": {}, "since": dt.date.today().isoformat()}


def atomic_write(path, payload):
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=directory, prefix=".traffic-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temp, path)
    except Exception:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def totals(daily, days):
    down = up = 0
    for entry in days:
        bucket = daily.get(entry) or {}
        down += int(bucket.get("down") or 0)
        up += int(bucket.get("up") or 0)
    return {"down": down, "up": up}


def collect_once(controller, secret, state, out, source):
    data = http_json(controller.rstrip("/") + "/connections", secret)
    connections = data.get("connections") or []
    seen = state["seen"]
    daily = state["daily"]
    today = dt.date.today().isoformat()
    bucket = daily.setdefault(today, {"down": 0, "up": 0})

    alive = set()
    counted = 0
    for connection in connections:
        identifier = str(connection.get("id") or "")
        if not identifier:
            continue
        alive.add(identifier)
        upload = int(connection.get("upload") or 0)
        download = int(connection.get("download") or 0)
        previous = seen.get(identifier) or {"up": 0, "down": 0}
        delta_up = max(0, upload - int(previous.get("up") or 0))
        delta_down = max(0, download - int(previous.get("down") or 0))
        seen[identifier] = {"up": upload, "down": download}
        if not is_proxied(connection):
            continue
        bucket["down"] += delta_down
        bucket["up"] += delta_up
        counted += 1

    for identifier in list(seen):
        if identifier not in alive:
            seen.pop(identifier, None)

    # 只保留最近 400 天，避免状态文件无限增长。
    for day in sorted(daily)[:-400]:
        daily.pop(day, None)

    days = sorted(daily)
    now = dt.datetime.now().astimezone()
    summary = {
        "version": 1,
        "updated": now.isoformat(timespec="seconds"),
        "since": state.get("since") or today,
        "source": source,
        "today": {"down": bucket["down"], "up": bucket["up"]},
        "yesterday": (daily.get((dt.date.today() - dt.timedelta(days=1)).isoformat()) or {"down": 0, "up": 0}),
        "week": totals(daily, [(dt.date.today() - dt.timedelta(days=offset)).isoformat() for offset in range(7)]),
        "total": totals(daily, days),
        "days": len(days),
        "connections": {"active": len(alive), "proxied": counted},
    }
    atomic_write(out, summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description="LocalDNS 代理流量采集器")
    parser.add_argument("--controller", default=os.environ.get("PROXY_TRAFFIC_CONTROLLER", ""))
    parser.add_argument("--secret", default=os.environ.get("PROXY_TRAFFIC_SECRET", ""))
    parser.add_argument("--mihomo-config", default="/etc/mihomo/config.yaml")
    parser.add_argument("--out", default=os.environ.get("PROXY_TRAFFIC_OUT", DEFAULT_OUT))
    parser.add_argument("--state", default=os.environ.get("PROXY_TRAFFIC_STATE", DEFAULT_STATE))
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--once", action="store_true", help="只采一次后退出")
    args = parser.parse_args()

    controller, secret = args.controller, args.secret
    if not controller:
        controller, config_secret = read_controller_from_config(args.mihomo_config)
        secret = secret or config_secret
    if not controller:
        controller = DEFAULT_CONTROLLER
    if controller.startswith("0.0.0.0"):
        controller = controller.replace("0.0.0.0", "127.0.0.1", 1)
    source = "mihomo" if "mihomo" in args.mihomo_config else "sing-box"

    state = load_state(args.state)
    while True:
        try:
            summary = collect_once(controller, secret, state, args.out, source)
            atomic_write(args.state, state)
            log("today down=%s up=%s proxied=%s" % (
                summary["today"]["down"], summary["today"]["up"], summary["connections"]["proxied"]))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as error:
            log("collect failed: %s" % error)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(max(1.0, args.interval))


if __name__ == "__main__":
    sys.exit(main())
