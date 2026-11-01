#!/usr/bin/env python3
"""Estimated proxied bytes from connection snapshots, never billing data.

Short connections and the tail after a final snapshot can be missed. Keep
lifetime totals independent of retention. Public files never contain secrets.
"""
import argparse
import datetime as dt
import json
import os
import shlex
import signal
import sys
import tempfile
import time
import urllib.parse
import urllib.request

DEFAULT_CONTROLLER = "http://127.0.0.1:9090"
DEFAULT_OUT = "/opt/localdns/ui/custom/traffic.json"
DEFAULT_STATE = "/var/lib/localdns-traffic/state.json"
DIRECT = {"DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"}
DIMENSIONS = ("devices", "providers", "nodes")
MAX_KEYS = 2048


def log(message):
    print("[proxy-traffic] " + message, file=sys.stderr, flush=True)


def pair(value=None):
    value = value if isinstance(value, dict) else {}
    return {key: max(0, int(value.get(key) or 0)) for key in ("down", "up")}


def add(target, delta):
    for key in ("down", "up"):
        target[key] = int(target.get(key) or 0) + delta[key]


def totals(daily, days):
    result = pair()
    for day in days:
        add(result, pair(daily.get(day)))
    return result


def http_json(url, secret="", timeout=8):
    request = urllib.request.Request(url)
    if secret:
        request.add_header("Authorization", "Bearer " + secret)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def read_controller_from_config(path):
    try:
        with open(path, encoding="utf-8") as stream:
            text = stream.read()
        if text.lstrip().startswith("{"):
            api = json.loads(text).get("experimental", {}).get("clash_api", {})
            controller, secret = api.get("external_controller", ""), api.get("secret", "")
        else:
            values = {}
            for line in text.splitlines():
                if line.startswith(("external-controller:", "secret:")):
                    key, value = line.split(":", 1)
                    values[key] = " ".join(shlex.split(value, comments=True))
            controller, secret = values.get("external-controller", ""), values.get("secret", "")
        if controller and not controller.startswith(("http://", "https://")):
            controller = "http://" + controller
        if controller:
            url = urllib.parse.urlsplit(controller)
            if url.hostname in ("0.0.0.0", "::"):
                controller = urllib.parse.urlunsplit((url.scheme, "127.0.0.1:" + str(url.port or 9090), url.path, "", ""))
        return controller, secret
    except (OSError, ValueError, TypeError):
        return "", ""


def is_proxied(connection):
    chains = connection.get("chains") or []
    return isinstance(chains, list) and bool(chains) and str(chains[0]).upper() not in DIRECT


def load_state(path, now=None):
    now = now or dt.datetime.now().astimezone()
    try:
        with open(path, encoding="utf-8") as stream:
            state = json.load(stream)
        if not isinstance(state, dict) or not isinstance(state.get("daily"), dict) or not isinstance(state.get("seen"), dict):
            raise ValueError("invalid state structure")
    except FileNotFoundError:
        state = {"seen": {}, "daily": {}, "since": now.date().isoformat()}
    # Corrupt existing state must not silently reset recorded totals.
    if state.get("version") != 2:
        state["total"] = totals(state["daily"], state["daily"])
        state["initialized"] = bool(state["seen"] or state["daily"])
        state["dimensions_since"] = now.isoformat(timespec="seconds")
        for bucket in state["daily"].values():
            bucket["coverage"] = "unknown"
        state["version"] = 2
    state.setdefault("since", now.date().isoformat())
    state.setdefault("total", totals(state["daily"], state["daily"]))
    return state


def atomic_write(path, payload, public=False):
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=directory, prefix=".traffic-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
        os.chmod(temp, 0o644 if public else 0o600)
        os.replace(temp, path)
    except Exception:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def record_dimension(bucket, dimension, key, delta):
    entries = bucket.setdefault(dimension, {})
    key = str(key or "")[:256] or "__unknown__"
    if key not in entries and len(entries) >= MAX_KEYS:
        key = "__other__"
    add(entries.setdefault(key, pair()), delta)


def sample(data, state, now=None, interval=5):
    """Update in memory. The first-ever snapshot establishes a baseline."""
    now = now or dt.datetime.now().astimezone()
    if not isinstance(data, dict) or not isinstance(data.get("connections"), (list, type(None))):
        raise ValueError("invalid connection snapshot")
    connections = data.get("connections") or []
    parsed = []
    for connection in connections:
        if not isinstance(connection, dict) or not connection.get("id"):
            continue
        values = {"up": max(0, int(connection.get("upload") or 0)), "down": max(0, int(connection.get("download") or 0))}
        parsed.append((connection, str(connection["id"]), values))
    day, stamp = now.date().isoformat(), now.isoformat(timespec="seconds")
    daily, seen = state["daily"], state["seen"]
    bucket = daily.setdefault(day, dict(pair(), coverage="partial" if now.hour or now.minute or now.second > interval * 3 else "full"))
    bucket.setdefault("first", stamp)
    bucket["last"] = stamp
    hourly = bucket.setdefault("hourly", {}).setdefault(now.strftime("%H"), pair())
    previous_time = state.get("updated")
    if previous_time and (now - dt.datetime.fromisoformat(previous_time)).total_seconds() > max(60, interval * 3):
        bucket["gaps"] = int(bucket.get("gaps", 0)) + 1
        if bucket.get("coverage") != "unknown":
            bucket["coverage"] = "partial"
    first = not state.get("initialized", False)
    current, counted = {}, 0
    for connection, identifier, counters in parsed:
        current[identifier] = counters
        values, previous = current[identifier], seen.get(identifier)
        if not is_proxied(connection):
            continue
        counted += 1
        if first:
            continue
        delta = {key: values[key] if previous is None or values[key] < int(previous.get(key, 0)) else values[key] - int(previous.get(key, 0)) for key in ("up", "down")}
        add(bucket, delta)
        add(hourly, delta)
        add(state["total"], delta)
        metadata, providers = connection.get("metadata") or {}, connection.get("providerChains") or []
        if not isinstance(metadata, dict):
            metadata = {}
        provider = providers[0] if isinstance(providers, list) and providers else ""
        record_dimension(bucket, "devices", metadata.get("sourceIP"), delta)
        record_dimension(bucket, "providers", provider, delta)
        record_dimension(bucket, "nodes", connection["chains"][0], delta)
    state.update(seen=current, initialized=True, updated=stamp, date=day,
                 utc_offset_minutes=int(now.utcoffset().total_seconds() // 60),
                 connections={"active": len(current), "proxied": counted})
    cutoff = (now.date() - dt.timedelta(days=399)).isoformat()
    dimension_cutoff = (now.date() - dt.timedelta(days=89)).isoformat()
    hourly_cutoff = (now.date() - dt.timedelta(days=6)).isoformat()
    for key in list(daily):
        if key < cutoff:
            daily.pop(key)
        elif key < dimension_cutoff:
            for dimension in DIMENSIONS:
                daily[key].pop(dimension, None)
        if key in daily and key < hourly_cutoff:
            daily[key].pop("hourly", None)
    return state


def read_aliases(path):
    try:
        with open(path, encoding="utf-8") as stream:
            aliases = json.load(stream)
        if isinstance(aliases, dict):
            return aliases
    except (OSError, ValueError):
        pass
    return {}


def publications(state, source="mihomo", interval=5, publish_interval=30, aliases=None):
    today, daily = dt.date.fromisoformat(state["date"]), state["daily"]
    yesterday = (today - dt.timedelta(days=1)).isoformat()
    summary = {
        "version": 2, "updated": state["updated"], "date": state["date"],
        "since": state["since"], "source": source, "utc_offset_minutes": state["utc_offset_minutes"],
        "method": "connection-snapshots", "interval_seconds": interval, "publish_interval_seconds": publish_interval,
        "today": pair(daily[state["date"]]), "yesterday": pair(daily[yesterday]) if yesterday in daily else None,
        "week": totals(daily, [(today - dt.timedelta(days=i)).isoformat() for i in range(7)]),
        "month": totals(daily, [key for key in daily if key[:7] == state["date"][:7]]),
        "total": pair(state["total"]), "days": len(daily), "connections": state["connections"],
    }
    detail = dict(summary, daily=[dict(bucket, date=day) for day, bucket in sorted(daily.items())],
                  aliases=aliases or {}, dimensions_since=state.get("dimensions_since", state["since"]),
                  retention={"daily_days": 400, "dimension_days": 90, "hourly_days": 7})
    return summary, detail


def publish(state, state_path, out, detail_path, aliases_path, source, interval, flush):
    summary, detail = publications(state, source, interval, flush, read_aliases(aliases_path))
    atomic_write(state_path, state)
    atomic_write(detail_path, detail, public=True)
    atomic_write(out, summary, public=True)


def main():
    parser = argparse.ArgumentParser(description="LocalDNS 代理用量估算采集器")
    parser.add_argument("--controller", default=os.environ.get("PROXY_TRAFFIC_CONTROLLER", ""))
    parser.add_argument("--secret", default=os.environ.get("PROXY_TRAFFIC_SECRET", ""))
    parser.add_argument("--mihomo-config", default="/etc/mihomo/config.yaml")
    parser.add_argument("--source", choices=("mihomo", "sing-box"), default="mihomo")
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--detail", default="")
    parser.add_argument("--state", default=DEFAULT_STATE)
    parser.add_argument("--aliases", default="/opt/localdns/config/settings/client_aliases.json")
    parser.add_argument("--interval", type=float, default=5)
    parser.add_argument("--flush-interval", type=float, default=30)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config_controller, config_secret = read_controller_from_config(args.mihomo_config)
    controller, secret = args.controller or config_controller or DEFAULT_CONTROLLER, args.secret or config_secret
    interval, flush = max(1, args.interval), max(1, args.flush_interval)
    detail_path = args.detail or os.path.join(os.path.dirname(args.out), "traffic-detail.json")
    os.makedirs(os.path.dirname(args.state) or ".", exist_ok=True)
    lock = open(args.state + ".lock", "a", encoding="utf-8")
    if os.name == "posix":
        import fcntl
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("another collector owns this state file")
            return 1
    state = load_state(args.state)
    running, dirty = True, False
    def stop(_signum, _frame):
        nonlocal running
        running = False
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    last_flush = last_log = 0.0
    while running:
        try:
            sample(http_json(controller.rstrip("/") + "/connections", secret), state, interval=interval)
            dirty = True
            monotonic = time.monotonic()
            if args.once or monotonic - last_flush >= flush:
                publish(state, args.state, args.out, detail_path, args.aliases, args.source, interval, flush)
                dirty = False
                last_flush = monotonic
            if monotonic - last_log >= 300:
                log("sampling active; proxied connections=%d" % state["connections"]["proxied"])
                last_log = monotonic
        except (OSError, ValueError, TypeError, KeyError, OverflowError):
            log("sample or publication failed; retaining the last successful data")
            if args.once:
                return 1
        if args.once:
            return 0
        deadline = time.monotonic() + interval
        while running and time.monotonic() < deadline:
            time.sleep(min(0.25, max(0, deadline - time.monotonic())))
    if dirty:
        publish(state, args.state, args.out, detail_path, args.aliases, args.source, interval, flush)
    lock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
