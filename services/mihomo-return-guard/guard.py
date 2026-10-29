#!/usr/bin/python3
"""Check the existing Mihomo host bypass/return design and repair missing rules.

This host integration delegates mutations to the existing mihomo-return and
mihomo-ipv6 scripts. It never creates Mihomo's own IPv4 interception chains.
"""
import argparse
import contextlib
import json
import os
import shlex
import subprocess
import time

if os.name == "posix":
    import fcntl
else:
    fcntl = None


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=12)
    if result.returncode:
        raise RuntimeError("Command failed: " + " ".join(args))
    return result.stdout


def configuration():
    # These are the existing root-owned OpenRC configuration files.
    values = command([
        "/bin/sh", "-ec",
        '. /etc/conf.d/mihomo-return; printf "%s\\n" "$IFACE" "$GATEWAY" "$LAN_CIDR"; '
        '. /etc/conf.d/mihomo-ipv6; printf "%s\\n" "$IFACE" "$RETURN_GATEWAY6" "$TPROXY_PORT" "$FAKEIP6"',
    ]).splitlines()
    if len(values) != 7 or any(not item for item in values):
        raise RuntimeError("Incomplete return routing configuration")
    return dict(zip(("iface4", "gateway4", "lan4", "iface6", "gateway6", "port6", "fake6"), values))


def parse_tables(text):
    tables, table = {}, None
    for line in text.splitlines():
        if line.startswith("*"):
            table = tables.setdefault(line[1:], {})
        elif line.startswith(":") and table is not None:
            table.setdefault(line.split()[0][1:], [])
        elif line.startswith("-A ") and table is not None:
            fields = shlex.split(line)
            table.setdefault(fields[1], []).append(fields[2:])
    return tables


def core_running():
    try:
        with open("/run/mihomo.pid", encoding="ascii") as stream:
            pid = int(stream.read().strip())
        with open("/proc/%d/comm" % pid, encoding="ascii") as stream:
            return stream.read().strip() == "mihomo"
    except (OSError, ValueError):
        return False


def routing_table(family, table):
    result = subprocess.run(["/sbin/ip", family, "route", "show", "table", str(table)],
                            capture_output=True, text=True, timeout=12)
    if result.returncode == 2 and "FIB table does not exist" in result.stderr:
        return ""
    if result.returncode:
        raise RuntimeError("Cannot inspect routing table: " + family + " " + str(table))
    return result.stdout


def snapshot():
    return {
        "running": core_running(),
        "v4": parse_tables(command(["/usr/sbin/iptables-save"])),
        "v6": parse_tables(command(["/usr/sbin/ip6tables-save", "-t", "mangle"])),
        "rule4": command(["/sbin/ip", "-4", "rule", "show"]),
        "route4": routing_table("-4", 104),
        "rule6": command(["/sbin/ip", "-6", "rule", "show"]),
        "route6": routing_table("-6", 104),
        "local6": routing_table("-6", 720),
    }


def target(rule):
    return rule[rule.index("-j") + 1] if "-j" in rule else None


def position(rules, rule):
    return rules.index(rule) if rule in rules else len(rules)


def has_route(text, prefix):
    return any(shlex.split(line)[:len(prefix)] == prefix for line in text.splitlines())


def has_policy(text, preference, selector):
    return sum(line.startswith(str(preference) + ":") and selector in line for line in text.splitlines()) == 1


def assess(state, config):
    m4 = state["v4"].get("mangle", {})
    pre, out = m4.get("mihomo_prerouting", []), m4.get("mihomo_output", [])
    ready = state["running"] and "mihomo_output" in m4 and all(
        any(target(rule) == "TPROXY" and rule[:2] == ["-p", proto] for rule in pre)
        for proto in ("tcp", "udp")
    )
    issues4, issues6 = [], []
    if not ready:
        return {"ready": False, "ipv4": ["core chains not ready"], "ipv6": []}

    if ["-o", config["iface4"], "-j", "mihomo_output"] not in m4.get("OUTPUT", []):
        # Mihomo owns this hook; do not invent it in a partially built ruleset.
        return {"ready": False, "ipv4": ["core OUTPUT hook not ready"], "ipv6": []}
    if ["-j", "mihomo_prerouting"] not in m4.get("PREROUTING", []):
        return {"ready": False, "ipv4": ["core PREROUTING hook not ready"], "ipv6": []}
    for proto in ("tcp", "udp"):
        conn = ["-p", proto, "-j", "CONNMARK", "--set-xmark", "0x4/0x4"]
        tproxy = next(i for i, rule in enumerate(pre) if target(rule) == "TPROXY" and rule[:2] == ["-p", proto])
        if pre.count(conn) != 1 or position(pre, conn) >= tproxy:
            issues4.append(proto + " connection mark missing or misplaced")
        if ["-p", proto, "-j", "MARK", "--set-xmark", "0x2d0/0xffffffff"] in out:
            issues4.append(proto + " host interception enabled")
    restore = ["-m", "connmark", "--mark", "0x4/0x4", "-j", "MARK", "--set-xmark", "0x4/0xffffffff"]
    leave = ["-m", "connmark", "--mark", "0x4/0x4", "-j", "RETURN"]
    if out[:2] != [restore, leave] or out.count(restore) != 1 or out.count(leave) != 1:
        issues4.append("response mark/return missing or misplaced")
    nat = state["v4"].get("nat", {}).get("POSTROUTING", [])
    accept = ["-m", "connmark", "--mark", "0x4/0x4", "-j", "ACCEPT"]
    if nat.count(accept) != 1 or any(target(rule) == "MASQUERADE" for rule in nat[:position(nat, accept)]):
        issues4.append("marked response NAT exemption missing or misplaced")
    if not has_policy(state["rule4"], 104, "fwmark 0x4/0x4 lookup 104"):
        issues4.append("IPv4 return policy missing")
    for destination in ("default", config["lan4"]):
        if not has_route(state["route4"], [destination, "via", config["gateway4"], "dev", config["iface4"]]):
            issues4.append("IPv4 return route missing: " + destination)

    m6 = state["v6"].get("mangle", {})
    if ["-i", config["iface6"], "-j", "mihomo6_pre"] not in m6.get("PREROUTING", []):
        issues6.append("IPv6 interception hook missing")
    if ["-o", config["iface6"], "-j", "mihomo6_out"] not in m6.get("OUTPUT", []):
        issues6.append("IPv6 response hook missing")
    if m6.get("mihomo6_out", []) != [restore, leave]:
        issues6.append("IPv6 response mark/return missing")
    conn6 = ["-j", "CONNMARK", "--set-xmark", "0x4/0x4"]
    divert = [conn6, ["-j", "MARK", "--set-xmark", "0x2d0/0xffffffff"], ["-j", "ACCEPT"]]
    if m6.get("mihomo6_divert", []) != divert:
        issues6.append("IPv6 socket diversion missing")
    capture = m6.get("mihomo6_capture", [])
    if capture[:1] != [conn6]:
        issues6.append("IPv6 connection mark missing")
    for proto in ("tcp", "udp"):
        expected = ["-p", proto, "-j", "TPROXY", "--on-port", config["port6"], "--on-ip", "::1", "--tproxy-mark", "0x2d0/0xffffffff"]
        if expected not in capture:
            issues6.append("IPv6 " + proto + " capture missing")
        pre6 = m6.get("mihomo6_pre", [])
        for rule in (["-d", config["fake6"], "-p", proto, "-j", "mihomo6_capture"],
                     ["-p", proto, "-m", "socket", "--transparent", "-j", "mihomo6_divert"],
                     ["-p", proto, "-j", "mihomo6_capture"]):
            if rule not in pre6:
                issues6.append("IPv6 " + proto + " ingress capture missing")
    for preference, selector in ((104, "fwmark 0x4 lookup 104"), (32765, "fwmark 0x2d0 lookup 720")):
        if not has_policy(state["rule6"], preference, selector):
            issues6.append("IPv6 policy missing: " + str(preference))
    if not has_route(state["route6"], ["default", "via", config["gateway6"], "dev", config["iface6"]]):
        issues6.append("IPv6 return route missing")
    if not has_route(state["local6"], ["local", "default", "dev", "lo"]):
        issues6.append("IPv6 capture route missing")
    return {"ready": True, "ipv4": issues4, "ipv6": issues6}


def healthy(report):
    return report["ready"] and not report["ipv4"] and not report["ipv6"]


@contextlib.contextmanager
def repair_lock():
    if fcntl is None:
        raise RuntimeError("Firewall recovery requires Linux")
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open("/run/mihomo-return-guard.lock", flags, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        os.close(descriptor)


def ensure():
    with repair_lock():
        config = configuration()
        before = assess(snapshot(), config)
        repaired = []
        if before["ready"] and before["ipv4"]:
            command(["/bin/sh", "-ec", ". /etc/conf.d/mihomo-return; . /etc/init.d/mihomo-return; apply_rules"])
            repaired.append("ipv4")
        if before["ready"] and before["ipv6"]:
            command(["/usr/local/sbin/mihomo-ipv6", "up"])
            repaired.append("ipv6")
        after = assess(snapshot(), config) if repaired else before
        return {"ok": healthy(after), "repaired": repaired, "before": before, "after": after}


def log(event, **fields):
    print(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event, **fields}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="inspect without mutations")
    mode.add_argument("--ensure", action="store_true", help="repair and verify once")
    mode.add_argument("--watch", action="store_true", help="repair missing rules in the background")
    parser.add_argument("--wait", type=float, default=0, help="retry time for --ensure")
    parser.add_argument("--interval", type=float, default=2)
    args = parser.parse_args()
    if args.check:
        try:
            config = configuration()
            result = assess(snapshot(), config)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            print(json.dumps({"ok": False, "error": str(error)}))
            return 1
        print(json.dumps({"ok": healthy(result), **result}))
        return 0 if healthy(result) else 1
    deadline, previous, last_error = time.monotonic() + args.wait, None, 0.0
    while True:
        try:
            result = ensure()
            if args.watch:
                if result["repaired"] or result["ok"] != previous:
                    log("repaired" if result["repaired"] else "healthy" if result["ok"] else "waiting", **result)
                previous = result["ok"]
            elif result["ok"] or time.monotonic() >= deadline:
                print(json.dumps(result))
                return 0 if result["ok"] else 1
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            if not args.watch and time.monotonic() >= deadline:
                log("error", detail=str(error))
                return 1
            if time.monotonic() - last_error >= 60:
                log("error", detail=str(error))
                last_error = time.monotonic()
        time.sleep(max(args.interval, 0.5) if args.watch else 0.5)


if __name__ == "__main__":
    raise SystemExit(main())
