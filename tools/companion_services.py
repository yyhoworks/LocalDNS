#!/usr/bin/env python3
"""Upgrade companion services that are already installed, from a verified LocalDNS release package.

The web updater runs this script from the release package it has just downloaded
and verified (SHA256SUMS.txt plus the in-package MANIFEST.sha256), so the
upgrade logic always comes from the release being installed, not from the
updater copy on the device. The persistent updater reinstalled from an
extracted package runs it the same way.

Rules:
- A service that is not installed is never installed; only its program is
  replaced. Configuration files (/etc/localdns-proxy-config.json, the Mihomo
  conf.d files) are never touched.
- An identical program is left alone, compared by SHA-256.
- The previous program is backed up first. A running service is restarted and
  must pass a health check; otherwise the backup is put back and the service is
  restarted again.
- Every outcome is reported, never raised: the script prints one JSON object and
  exits 0, so a companion failure can never fail the UI upgrade that called it.

Only the Python standard library is used.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import http.client
import json
import os
import platform
import py_compile
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path

SCHEMA = 1
BACKUP_KEEP = 3

PROXY = 'proxy-config'
PROXY_SERVICE = 'localdns-proxy-config'
PROXY_BINARY = '/opt/localdns-proxy-config/bin/localdns-proxy-config'
PROXY_CONFIG = '/etc/localdns-proxy-config.json'
PROXY_BACKUPS = '/opt/localdns-proxy-config/backups'
# (file in the package, installed path, mode). Only service files that already
# exist on the host are replaced, so the active init system keeps its own one.
PROXY_UNITS = (('localdns-proxy-config.initd', '/etc/init.d/localdns-proxy-config', 0o755),
               ('localdns-proxy-config.service', '/etc/systemd/system/localdns-proxy-config.service', 0o644))

GUARD = 'mihomo-return-guard'
GUARD_SERVICE = 'mihomo-return-guard'
GUARD_SCRIPT = '/usr/local/sbin/mihomo-return-guard.py'
GUARD_BACKUPS = '/var/backups/localdns-companions/mihomo-return-guard'

ELF_MACHINE = {'amd64': 62, 'arm64': 183}


class CompanionError(RuntimeError):
    pass


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def service_arch(value=None):
    value = (value or platform.machine()).lower()
    return {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(value)


def detect_init():
    if shutil.which('rc-service') and Path('/sbin/openrc-run').exists():
        return 'openrc'
    if shutil.which('systemctl') and Path('/run/systemd/system').is_dir():
        return 'systemd'
    return 'none'


class System:
    """Host operations. Tests replace the service, probe, check and sleep methods."""

    def __init__(self, prefix='/', init=None):
        self.prefix = Path(prefix).absolute()
        self.init = init or (detect_init() if self.prefix == Path(self.prefix.anchor) else 'none')

    def path(self, absolute):
        return self.prefix.joinpath(*Path(absolute).parts[1:])

    def _command(self, name, action):
        if self.init == 'openrc':
            return ['rc-service', name, action]
        if self.init == 'systemd':
            if action == 'status':
                return ['systemctl', 'is-active', '--quiet', name + '.service']
            return ['systemctl', action, name + '.service']
        return None

    def service(self, name, action):
        """status / restart; True when the command succeeded."""
        command = self._command(name, action)
        if command is None:
            return False
        try:
            return subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  timeout=150).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def daemon_reload(self):
        if self.init == 'systemd':
            with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                subprocess.run(['systemctl', 'daemon-reload'], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=60)

    def http_json(self, host, port, host_header, path, timeout=3):
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
        try:
            connection.request('GET', path, headers={'Host': host_header, 'Accept': 'application/json'})
            response = connection.getresponse()
            body = response.read(65536)
            if response.status != 200:
                raise CompanionError('HTTP ' + str(response.status))
            return json.loads(body)
        finally:
            connection.close()

    def guard_check(self, script):
        """Run the read-only --check; return its JSON object (healthy or not)."""
        output = subprocess.run([sys.executable, str(script), '--check'], capture_output=True, text=True,
                                errors='replace', timeout=60).stdout.strip()
        value = json.loads(output.splitlines()[-1]) if output else None
        if not isinstance(value, dict) or 'ok' not in value:
            raise CompanionError('--check 没有输出约定的 JSON')
        return value

    def sleep(self, seconds):
        time.sleep(seconds)


def stamp():
    return datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]


def atomic_copy(source, target, mode):
    temporary = target.with_name('.' + target.name + '.next-' + uuid.uuid4().hex[:8])
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, mode)
        os.replace(temporary, target)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def refuse_links(*paths):
    for path in paths:
        if path.is_symlink():
            raise CompanionError('拒绝符号链接路径：' + str(path))


def prune(directory, keep=BACKUP_KEEP):
    with contextlib.suppress(OSError):
        entries = sorted((p for p in directory.iterdir()
                          if p.name.startswith('upgrade-') and p.is_dir() and not p.is_symlink()),
                         key=lambda p: p.name, reverse=True)
        for old in entries[keep:]:
            shutil.rmtree(old, ignore_errors=True)


def result(service, status, message, **extra):
    value = {'service': service, 'status': status, 'message': message}
    value.update(extra)
    return value


# --- proxy-config -----------------------------------------------------------

def proxy_endpoint(config):
    listen = str(config.get('listen') or '127.0.0.1:9098')
    host, _, port = listen.rpartition(':')
    host = host.strip('[]')
    if host in ('', '0.0.0.0'):
        host = '127.0.0.1'
    elif host == '::':
        host = '::1'
    hosts = config.get('hosts')
    header = hosts[0] if isinstance(hosts, list) and hosts and isinstance(hosts[0], str) else listen
    return host, int(port), header


def proxy_health(system, config, wait=20.0):
    host, port, header = proxy_endpoint(config)
    deadline = time.monotonic() + wait
    error = '未响应'
    while True:
        try:
            value = system.http_json(host, port, header, '/healthz')
            if isinstance(value, dict) and value.get('service') == PROXY_SERVICE:
                return value
            error = '返回内容不是配置服务'
        except (OSError, ValueError, CompanionError, http.client.HTTPException) as failure:
            error = str(failure) or type(failure).__name__
        if time.monotonic() >= deadline:
            raise CompanionError('健康检查失败（' + host + ':' + str(port) + '/healthz）：' + error)
        system.sleep(0.5)


def proxy_payload(package, arch):
    source = Path(package) / 'companion/proxy-config'
    if not (source / 'release.json').is_file():
        return None, None
    metadata = json.loads((source / 'release.json').read_text(encoding='utf-8'))
    if metadata.get('packageType') != 'proxy-config-service':
        raise CompanionError('配置服务载荷类型无效')
    binary = source / 'bin' / ('localdns-proxy-config-linux-' + arch)
    expected = (metadata.get('binaries') or {}).get('linux/' + arch, {}).get('sha256')
    if not binary.is_file() or not expected or sha(binary) != expected:
        raise CompanionError('配置服务程序缺失或与载荷清单不一致：' + arch)
    with binary.open('rb') as stream:
        head = stream.read(64)
    if len(head) < 64 or head[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', head, 18)[0] != ELF_MACHINE[arch]:
        raise CompanionError('配置服务程序架构不匹配：' + arch)
    return source, metadata


def upgrade_proxy_config(system, package, arch):
    binary = system.path(PROXY_BINARY)
    config_path = system.path(PROXY_CONFIG)
    if not binary.is_file() or not config_path.is_file():
        return result(PROXY, 'skipped', '未安装，不处理')
    refuse_links(binary, binary.parent, config_path)
    if arch not in ELF_MACHINE:
        return result(PROXY, 'skipped', '不支持的架构，未处理')
    source, metadata = proxy_payload(package, arch)
    if source is None:
        return result(PROXY, 'skipped', '发行包未附带配置服务程序')
    new = source / 'bin' / ('localdns-proxy-config-linux-' + arch)
    old_sha, new_sha = sha(binary), sha(new)
    version = metadata.get('serviceVersion')
    if old_sha == new_sha:
        return result(PROXY, 'unchanged', '已是发行包中的程序', version=version, sha256=new_sha)
    config = json.loads(config_path.read_text(encoding='utf-8'))
    units = []
    for name, target, mode in PROXY_UNITS:
        path = system.path(target)
        refuse_links(path)
        if path.is_file() and (source / name).is_file() and sha(path) != sha(source / name):
            units.append((source / name, path, mode))
    running = system.service(PROXY_SERVICE, 'status')
    backups = system.path(PROXY_BACKUPS)
    refuse_links(backups)
    backup = backups / ('upgrade-' + stamp())
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(binary, backup / 'localdns-proxy-config.binary')
    for _source, path, _mode in units:
        shutil.copy2(path, backup / path.name)
    binary_mode = binary.stat().st_mode & 0o7777 or 0o755
    extra = {'version': version, 'fromSha256': old_sha, 'sha256': new_sha, 'backup': str(backup),
             'restarted': running}
    try:
        atomic_copy(new, binary, 0o755)
        for unit_source, path, mode in units:
            atomic_copy(unit_source, path, mode)
        if units:
            system.daemon_reload()
        if running:
            if not system.service(PROXY_SERVICE, 'restart'):
                raise CompanionError('重启服务失败')
            proxy_health(system, config)
        with contextlib.suppress(OSError):
            home = binary.parent.parent
            for license_file in (source / 'licenses').glob('*'):
                if license_file.is_file():
                    (home / 'licenses').mkdir(exist_ok=True)
                    shutil.copyfile(license_file, home / 'licenses' / license_file.name)
            if (source / 'README.md').is_file():
                shutil.copyfile(source / 'README.md', home / 'README.md')
        prune(backups)
        return result(PROXY, 'upgraded', '已升级' + ('并通过健康检查' if running else '（服务未运行，未重启）'), **extra)
    except Exception as error:
        restored = False
        detail = str(error) or type(error).__name__
        with contextlib.suppress(Exception):
            atomic_copy(backup / 'localdns-proxy-config.binary', binary, binary_mode)
            for _source, path, mode in units:
                atomic_copy(backup / path.name, path, mode)
            if units:
                system.daemon_reload()
            if running:
                if not system.service(PROXY_SERVICE, 'restart'):
                    raise CompanionError('恢复后重启失败')
                proxy_health(system, config)
            restored = True
        if restored:
            return result(PROXY, 'rolled_back', '升级失败，已恢复原程序：' + detail, **extra)
        return result(PROXY, 'failed', '升级失败且未能确认恢复，请检查服务；原程序备份：' + str(backup) + '。' + detail, **extra)


# --- mihomo-return-guard ----------------------------------------------------

def guard_health(system, script):
    system.sleep(3)
    if not system.service(GUARD_SERVICE, 'status'):
        raise CompanionError('重启后服务未保持运行')
    system.guard_check(script)


def upgrade_guard(system, package):
    target = system.path(GUARD_SCRIPT)
    if not target.is_file():
        return result(GUARD, 'skipped', '未安装，不处理')
    refuse_links(target, target.parent)
    new = Path(package) / 'companion/mihomo-return-guard/guard.py'
    if not new.is_file():
        return result(GUARD, 'skipped', '发行包未附带守护脚本')
    old_sha, new_sha = sha(target), sha(new)
    if old_sha == new_sha:
        return result(GUARD, 'unchanged', '已是发行包中的脚本', sha256=new_sha)
    with tempfile.TemporaryDirectory() as temporary:
        try:
            py_compile.compile(str(new), cfile=str(Path(temporary) / 'guard.pyc'), doraise=True)
        except py_compile.PyCompileError as error:
            return result(GUARD, 'failed', '新守护脚本无法编译，未替换：' + str(error))
    running = system.service(GUARD_SERVICE, 'status')
    backups = system.path(GUARD_BACKUPS)
    refuse_links(backups)
    backup = backups / ('upgrade-' + stamp())
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(target, backup / 'mihomo-return-guard.py')
    mode = target.stat().st_mode & 0o7777 or 0o750
    extra = {'fromSha256': old_sha, 'sha256': new_sha, 'backup': str(backup), 'restarted': running}
    try:
        atomic_copy(new, target, mode)
        if running:
            if not system.service(GUARD_SERVICE, 'restart'):
                raise CompanionError('重启服务失败')
            guard_health(system, target)
        prune(backups)
        return result(GUARD, 'upgraded', '已升级' + ('并通过运行检查' if running else '（服务未运行，未重启）'), **extra)
    except Exception as error:
        restored = False
        detail = str(error) or type(error).__name__
        with contextlib.suppress(Exception):
            atomic_copy(backup / 'mihomo-return-guard.py', target, mode)
            if running:
                if not system.service(GUARD_SERVICE, 'restart'):
                    raise CompanionError('恢复后重启失败')
                guard_health(system, target)
            restored = True
        if restored:
            return result(GUARD, 'rolled_back', '升级失败，已恢复原脚本：' + detail, **extra)
        return result(GUARD, 'failed', '升级失败且未能确认恢复，请检查服务；原脚本备份：' + str(backup) + '。' + detail, **extra)


def run(package, system=None, arch=None):
    system = system or System()
    package = Path(package).absolute()
    report = {'schema': SCHEMA, 'results': []}
    for name, function in ((PROXY, lambda: upgrade_proxy_config(system, package, service_arch(arch))),
                           (GUARD, lambda: upgrade_guard(system, package))):
        try:
            report['results'].append(function())
        except Exception as error:  # Never let one service stop the others or the caller.
            report['results'].append(result(name, 'failed', str(error) or type(error).__name__))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='升级已安装的 LocalDNS 配套服务（不会新装）')
    parser.add_argument('--package', required=True, type=Path, help='已解压并校验的发行包目录')
    parser.add_argument('--prefix', default='/', help=argparse.SUPPRESS)
    parser.add_argument('--arch', help='默认按本机架构选择 amd64 / arm64')
    parser.add_argument('--json', action='store_true', help='只输出一行 JSON 结果')
    args = parser.parse_args(argv)
    report = run(args.package, System(args.prefix), args.arch)
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        for item in report['results']:
            print(item['service'] + '：' + item['status'] + ' — ' + item['message'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
