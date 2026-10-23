#!/usr/bin/env python3
"""Back up, prepare, test and switch an existing installation to FJGLI."""
import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

# Release packages place the shared installer support beside the UI updater.
sys.path.insert(0, str(Path(__file__).resolve().parent / 'ui-updater'))
import install_localdns as installer
from fjgli_config import MigrationError, hashes, migrate_configuration, read_json, safe_tree, write_json

MARKER = '.localdns-migration.json'


def sha(path):
    with Path(path).open('rb') as stream:
        value = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
        return value.hexdigest()


def fingerprint(root):
    """Watch user settings, excluding counters and automatically updated timestamps."""
    result = {}
    for folder in ('config', 'rules/manual', 'ui/custom'):
        safe_tree(root / folder)
        for path in sorted((root / folder).rglob('*')):
            if not path.is_file():
                continue
            data = path.read_bytes()
            if path.suffix == '.json' and folder == 'config':
                value = json.loads(data)
                if path.name in ('requery.json', 'route_refresh.json'):
                    value.pop('status', None)
                if path.parent.name == 'subscriptions' and isinstance(value, list):
                    value = [{k: v for k, v in entry.items() if k not in ('last_updated', 'last_error', 'rule_count', 'line_report')}
                             for entry in value]
                data = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
            result[path.relative_to(root).as_posix()] = hashlib.sha256(data).hexdigest()
    for name in ('ui/config.js', 'bin/glibc-shim.so', 'bin/localdns-compat.so', '.ui-updater/config.json'):
        if (root / name).is_file():
            installer.no_symlinks(root / name)
            result[name] = sha(root / name)
    return result


def stage_fingerprint(stage):
    return {name: value for name, value in hashes(stage).items() if name != MARKER}


def api(port, path, method='GET', value=None):
    data = None if value is None else json.dumps(value).encode()
    request = Request('http://127.0.0.1:' + str(port) + path, data=data, method=method,
                      headers={'Content-Type': 'application/json'})
    with build_opener(ProxyHandler({})).open(request, timeout=8) as response:
        raw = response.read()
        return json.loads(raw) if 'json' in response.headers.get('Content-Type', '') else raw.decode()


def dns(port, protocol):
    ident = int.from_bytes(os.urandom(2), 'big')
    packet = struct.pack('!HHHHHH', ident, 0x100, 1, 0, 0, 0) + b'\x07example\x03com\0' + struct.pack('!HH', 1, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM if protocol == 'tcp' else socket.SOCK_DGRAM) as stream:
        stream.settimeout(8)
        stream.connect(('127.0.0.1', port))
        if protocol == 'udp':
            stream.send(packet)
            reply = stream.recv(65535)
        else:
            stream.sendall(struct.pack('!H', len(packet)) + packet)
            def receive(count):
                data = b''
                while len(data) < count:
                    chunk = stream.recv(count - len(data))
                    if not chunk:
                        raise MigrationError('DNS TCP 应答被截断')
                    data += chunk
                return data
            reply = receive(struct.unpack('!H', receive(2))[0])
    rid, flags, _, answers = struct.unpack('!HHHH', reply[:8])
    if rid != ident or not flags & 0x8000 or flags & 15 or not answers:
        raise MigrationError('DNS ' + protocol + ' 检查失败')
    return {'protocol': protocol, 'answers': answers}


SUPPORTED_BACKENDS = ('FJGLI', 'FJGOE')


def verify(root, http_port, udp_port, tcp_port):
    expected_versions = SUPPORTED_BACKENDS
    if (root / 'ui/version.json').is_file():
        v = read_json(root / 'ui/version.json').get('backendVersion')
        if v in SUPPORTED_BACKENDS:
            expected_versions = (v,)
    status = None
    for _ in range(40):
        try:
            status = api(http_port, '/api/v1/status')
            if status.get('version') in expected_versions:
                break
        except (OSError, ValueError):
            pass
        time.sleep(.25)
    if not status or status.get('version') not in expected_versions:
        raise MigrationError(f"{'/'.join(expected_versions)} 管理接口未就绪")
    upstreams = api(http_port, '/api/v1/upstream/config')
    expected = {p.stem: read_json(p)['upstreams'] for p in (root / 'config/upstreams').glob('*.json')}
    if upstreams != expected:
        raise MigrationError('新版实际生效的上游与恢复文件不同')
    if api(http_port, '/api/v1/client-aliases') != read_json(root / 'config/settings/client_aliases.json'):
        raise MigrationError('客户端别名不一致')
    if api(http_port, '/api/v1/features') != read_json(root / 'config/settings/switches.json'):
        raise MigrationError('功能开关不一致')
    budget = api(http_port, '/api/v1/cache/settings')['cache_memory_mb']
    if budget != read_json(root / 'config/localdns.json')['cache_memory_mb']:
        raise MigrationError('缓存内存预算不一致')
    for path in ('/api/v1/querylog/status', '/api/v1/querylog/capacity', '/api/v1/querylog/settings',
                 '/api/v1/querylog/stats', '/api/v1/querylog/entries?limit=2',
                 '/api/v1/route-refresh/status', '/api/v1/route-refresh/schedule', '/api/v1/route-refresh/counts'):
        api(http_port, path)
    return {'version': status.get('version'), 'upstreamGroups': len(upstreams), 'cacheMemoryMb': budget,
            'dns': [dns(udp_port, 'udp'), dns(tcp_port, 'tcp')]}


def backup(root, output):
    installer.no_symlinks(output)
    if output.resolve() == root or root in output.resolve().parents or output.exists():
        raise MigrationError('备份目录必须是安装目录外尚不存在的目录')
    safe_tree(root)
    output.mkdir(parents=True, mode=0o700)
    archive = output / 'localdns-original.tar.gz'
    before = fingerprint(root)
    installer.require_space(output, sum(p.stat().st_size for p in root.rglob('*') if p.is_file()))
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(root, arcname=root.name)
        for path in ('/etc/init.d/localdns', '/etc/conf.d/localdns', '/etc/init.d/localdns-ui-updater',
                     '/etc/conf.d/localdns-ui-updater', '/etc/systemd/system/localdns.service',
                     '/etc/systemd/system/localdns-ui-updater.service'):
            if Path(path).is_file():
                tar.add(path, arcname=path.lstrip('/'))
    archive.chmod(0o600)
    if fingerprint(root) != before:
        raise MigrationError('备份期间设置发生变化，请重新备份')
    record = {'schema': 1, 'sourceRoot': str(root), 'archive': archive.name,
              'sha256': sha(archive), 'sourceFingerprint': before}
    installer.atomic_json(output / 'backup.json', record)
    return {'archive': str(archive), 'sha256': record['sha256'], 'bytes': archive.stat().st_size,
            'next': '下载归档到本机并校验摘要后，再执行 prepare、preflight、apply'}


def prepare(root, package, expected, stage, arch):
    installer.no_symlinks(stage)
    if stage.exists() or stage.resolve() == root or root in stage.resolve().parents:
        raise MigrationError('暂存目录必须是安装目录外尚不存在的目录')
    if sha(package) != expected:
        raise MigrationError('完整发行包 SHA-256 不一致')
    before = fingerprint(root)
    stage.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.fjgli-package-', dir=stage.parent) as temporary:
        payload = Path(temporary) / 'payload'
        metadata = installer.extract_verified(package, payload)
        backend = metadata.get('backendVersion')
        if metadata.get('packageType') != 'full' or backend not in SUPPORTED_BACKENDS:
            raise MigrationError('需要 FJGLI/FJGOE 完整发行包')
        installer.require_space(stage.parent, sum(p.stat().st_size for p in payload.rglob('*') if p.is_file()))
        shutil.copytree(payload / 'localdns', stage)
        binary = payload / f'LocalDNS_{backend}_Binaries' / ('localdns-' + installer.choose_arch(arch))
        shutil.copy2(binary, stage / 'bin/localdns')
        (stage / 'bin/localdns').chmod(0o755)
    report = migrate_configuration(root, stage)
    if fingerprint(root) != before:
        raise MigrationError('准备期间原设置发生变化，请重新准备')
    record = {'schema': 1, 'sourceRoot': str(root), 'sourceFingerprint': before,
              'packageSha256': expected, 'report': report, 'preflight': None}
    installer.atomic_json(stage / MARKER, record)
    return {'stage': str(stage), 'preservedDirectories': list(report['preserved']),
            'missingSubscriptionFiles': report['missingSubscriptionFiles']}


def preflight_failure_hint(error, process, log_path):
    """Explain the port-probe race instead of reporting a bare failure.

    The free-port probe is only true at the instant it runs (TOCTOU): the
    isolated core binds the same ports a moment later, and another process
    can win the gap. When the core died with a bind/listen failure in its
    log, say so explicitly so the failure is not mistaken for corrupt
    migration content.
    """
    try:
        tail = log_path.read_bytes()[-4096:].decode('utf-8', 'replace').lower()
    except OSError:
        tail = ''
    if (process is not None and process.poll() is not None
            and ('bind' in tail or 'listen' in tail or 'address already in use' in tail)):
        return MigrationError(str(error) + '；隔离核心未能绑定预检端口（端口可能在预检后被其他进程占用），'
                                           '请关闭占用进程后重试')
    return error


def preflight(stage, http_port, dns_port):
    safe_tree(stage)
    record = read_json(stage / MARKER)
    before = stage_fingerprint(stage)
    with tempfile.TemporaryDirectory(prefix='.fjgli-test-', dir=stage.parent) as directory:
        test = Path(directory) / 'runtime'
        shutil.copytree(stage, test)
        # Hold the probe sockets open until the core is about to start: this
        # shrinks (but cannot fully eliminate) the window in which another
        # process can claim a port between the probe and the core's bind.
        probes = []
        try:
            for port, kind in [(http_port, socket.SOCK_STREAM), (dns_port, socket.SOCK_STREAM), (dns_port, socket.SOCK_DGRAM)]:
                probe = socket.socket(socket.AF_INET, kind)
                probe.bind(('127.0.0.1', port))
                probes.append(probe)
        except OSError:
            for probe in probes:
                probe.close()
            raise
        for path in (test / 'config').rglob('*.json'):
            value = read_json(path)
            def isolate(item):
                if isinstance(item, dict):
                    for key, child in item.items():
                        if key == 'auto_update':
                            item[key] = False
                        elif key == 'scheduler' and isinstance(child, dict):
                            child['enabled'] = False
                        elif key == 'dir':
                            item[key] = str(test / 'logs')
                        elif isinstance(child, str) and child.startswith(record['sourceRoot'] + '/'):
                            item[key] = str(test) + child[len(record['sourceRoot']):]
                        else:
                            isolate(child)
                elif isinstance(item, list):
                    for child in item:
                        isolate(child)
            isolate(value)
            write_json(path, value)
        config = read_json(test / 'config/localdns.json')
        config['api']['http'] = '127.0.0.1:' + str(http_port)
        config['dns'].update(udp_listen='127.0.0.1:' + str(dns_port), tcp_listen='127.0.0.1:' + str(dns_port),
                             reuse_address=False, reuse_port=False)
        write_json(test / 'config/localdns.json', config)
        environment = dict(os.environ)
        for name in ('glibc-shim.so', 'localdns-compat.so'):
            if (test / 'bin' / name).is_file():
                environment['LD_PRELOAD'] = str(test / 'bin' / name)
                break
        for probe in probes:
            probe.close()
        process = None
        with (Path(directory) / 'core.log').open('w+b') as output:
            try:
                process = subprocess.Popen([str(test / 'bin/localdns'), '--root', str(test), '--config', str(test / 'config/localdns.json')],
                                           cwd=test, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
                try:
                    result = verify(test, http_port, dns_port, dns_port)
                except MigrationError as error:
                    raise preflight_failure_hint(error, process, Path(directory) / 'core.log') from error
            finally:
                if process is not None:
                    process.terminate()
                    try:
                        process.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
        if stage_fingerprint(stage) != before:
            raise MigrationError('隔离验证期间暂存内容发生变化')
    record['preflight'] = {'stageFingerprint': before, 'result': result}
    installer.atomic_json(stage / MARKER, record)
    return result


def updater(action, init):
    command = ['rc-service', 'localdns-ui-updater', action] if init == 'openrc' else ['systemctl', action, 'localdns-ui-updater.service']
    return subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def journal_path(root):
    return root.parent / ('.' + root.name + '-core-upgrade.json')


def recover(root, init):
    journal = journal_path(root)
    installer.no_symlinks(journal)
    value = read_json(journal)
    if value.get('sourceRoot') != str(root):
        raise MigrationError('更新事务的目标目录无效')
    name = value.get('previous', '')
    if not re.fullmatch(re.escape(root.name) + r'\.previous-fjgli-[a-f0-9]{32}', name):
        raise MigrationError('更新事务的回退路径无效')
    previous = root.parent / name
    installer.no_symlinks(previous)
    if previous.exists():
        with contextlib.suppress(Exception):
            installer.manage('stop', init)
        if root.exists():
            root.rename(root.parent / (root.name + '.failed-fjgli-' + uuid.uuid4().hex))
        previous.rename(root)
        installer.sync_directory(root.parent)
    if value['wasRunning']:
        installer.manage('start', init)
    if value['updaterRunning'] and not updater('start', init):
        raise MigrationError('旧目录已恢复，但 UI 更新服务未能启动，请检查服务')
    journal.unlink()
    return {'recovered': True, 'root': str(root)}


def apply(root, stage, backup_file, downloaded_sha, init):
    safe_tree(stage)
    record = read_json(stage / MARKER)
    saved = read_json(backup_file.parent / 'backup.json')
    if record.get('schema') != 1 or record.get('sourceRoot') != str(root):
        raise MigrationError('暂存记录与目标目录不匹配')
    if saved.get('sourceRoot') != str(root) or sha(backup_file) != downloaded_sha or saved.get('sha256') != downloaded_sha:
        raise MigrationError('本机下载的备份摘要与原备份不一致')
    if not record.get('preflight') or stage_fingerprint(stage) != record['preflight']['stageFingerprint']:
        raise MigrationError('必须先通过隔离验证，且验证后不能修改暂存目录')
    if saved.get('archive') and backup_file.name != saved['archive']:
        raise MigrationError('备份文件名与备份记录不同')
    if saved['sourceFingerprint'] != record['sourceFingerprint'] or fingerprint(root) != record['sourceFingerprint']:
        raise MigrationError('原设置已变化，请重新备份、准备和验证')
    if record['report']['missingSubscriptionFiles']:
        raise MigrationError('存在缺失的已启用订阅文件，请补齐后重新验证')
    if root.stat().st_dev != stage.stat().st_dev or root in stage.parents or root == stage:
        raise MigrationError('暂存目录必须位于安装目录外的同一文件系统')
    previous = root.parent / (root.name + '.previous-fjgli-' + uuid.uuid4().hex)
    was_running = subprocess.run(['rc-service', 'localdns', 'status'] if init == 'openrc' else
                                 ['systemctl', 'is-active', '--quiet', 'localdns.service'],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    state = {'schema': 1, 'sourceRoot': str(root), 'previous': previous.name,
             'wasRunning': was_running, 'updaterRunning': updater('status', init)}
    installer.atomic_json(journal_path(root), state)
    try:
        if state['updaterRunning'] and not updater('stop', init):
            raise MigrationError('无法暂停 UI 更新服务')
        if was_running:
            installer.manage('stop', init)
        if fingerprint(root) != record['sourceFingerprint']:
            raise MigrationError('停服前设置发生变化，已取消切换')
        root.rename(previous)
        installer.sync_directory(root.parent)
        stage.rename(root)
        installer.sync_directory(root.parent)
        installer.manage('start', init)
        config = read_json(root / 'config/localdns.json')
        result = verify(root, int(config['api']['http'].rsplit(':', 1)[1]),
                        int(config['dns']['udp_listen'].rsplit(':', 1)[1]), int(config['dns']['tcp_listen'].rsplit(':', 1)[1]))
        for relative, expected in record['report']['preserved'].items():
            if relative == 'config/subscriptions':
                current = {k: v for k, v in fingerprint(root).items() if k.startswith('config/subscriptions/')}
                original = {k: v for k, v in record['sourceFingerprint'].items() if k.startswith('config/subscriptions/')}
                if current != original:
                    raise MigrationError('切换后订阅设置校验失败')
                continue
            if hashes(root / relative) != expected:
                raise MigrationError('切换后配置或手工规则校验失败：' + relative)
        if state['updaterRunning'] and not updater('start', init):
            raise MigrationError('UI 更新服务恢复失败')
    except BaseException:
        recover(root, init)
        raise
    journal_path(root).unlink()
    result['previousDirectory'] = str(previous)
    result['backupDownloadedSha256'] = downloaded_sha
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['backup', 'prepare', 'preflight', 'apply', 'recover'])
    parser.add_argument('--dir', default='/opt/localdns')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--stage', type=Path)
    parser.add_argument('--package', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--arch', choices=['amd64-v1', 'amd64-v2', 'amd64-v3', 'arm64'])
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--downloaded-backup-sha256')
    parser.add_argument('--http-test-port', type=installer.port_number, default=19098)
    parser.add_argument('--dns-test-port', type=installer.port_number, default=2054)
    args = parser.parse_args(argv)
    init = installer.manager()
    root = installer.install_path(args.dir)
    required = {'backup': ['output'], 'prepare': ['stage', 'package', 'sha256'], 'preflight': ['stage'],
                'apply': ['stage', 'backup', 'downloaded_backup_sha256'], 'recover': []}
    for field in required[args.action]:
        if getattr(args, field) is None:
            parser.error('缺少 --' + field.replace('_', '-'))
    for name in ('stage', 'output', 'package', 'backup'):
        path = getattr(args, name)
        if path is not None:
            installer.no_symlinks(path)
            if not path.is_absolute():
                parser.error('--' + name + ' 必须为绝对路径')
    with installer.locked(root):
        if journal_path(root).exists() and args.action != 'recover':
            raise MigrationError('发现未完成的核心更新事务，请先执行 recover')
        if args.action == 'backup':
            result = backup(root, args.output)
        elif args.action == 'prepare':
            result = prepare(root, args.package, args.sha256, args.stage, args.arch)
        elif args.action == 'preflight':
            result = preflight(args.stage, args.http_test_port, args.dns_test_port)
        elif args.action == 'apply':
            result = apply(root, args.stage, args.backup, args.downloaded_backup_sha256, init)
        else:
            result = recover(root, init)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (MigrationError, installer.InstallError, OSError, ValueError, KeyError) as error:
        print('完整更新未完成：' + str(error), file=sys.stderr)
        raise SystemExit(1)
