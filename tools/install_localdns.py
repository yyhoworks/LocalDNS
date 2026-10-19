#!/usr/bin/env python3
"""Install an official LocalDNS release, or atomically update an existing UI."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import ipaddress
import json
import os
import platform
import re
import shlex
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import ProxyHandler, Request, build_opener, urlopen
from zipfile import BadZipFile, ZipFile

REPO = 'https://github.com/yyhoworks/LocalDNS'
API = 'https://api.github.com/repos/yyhoworks/LocalDNS/releases/'
INSTALLER_VERSION = '1.3.0'
ALPINE_RESOLVER_BRIDGE = '#include <resolv.h>\nint __res_init(void) { return res_init(); }\n'


class InstallError(RuntimeError):
    pass


def log(message):
    print(message, flush=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require_space(path, needed):
    reserve = 16 * 1024 * 1024
    existing = Path(path)
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    free = shutil.disk_usage(existing).free
    if free < needed + reserve:
        raise InstallError('磁盘空间不足：' + str(path) + '，至少需要 ' +
                           str((needed + reserve + 1024 * 1024 - 1) // (1024 * 1024)) + ' MiB 可用空间')


def write_json(path, value, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    path.chmod(mode)


def atomic_json(path, value):
    """Persist a transaction before changing live files."""
    no_symlinks(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as output:
            os.chmod(temporary, 0o600)
            json.dump(value, output, ensure_ascii=False)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def sync_directory(path):
    if os.name != 'nt':
        handle = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)


def run(arguments, **kwargs):
    try:
        return subprocess.run(arguments, check=True, **kwargs)
    except (OSError, subprocess.CalledProcessError) as error:
        raise InstallError('命令失败：' + ' '.join(map(str, arguments))) from error


def choose_arch(value=None):
    value = value or platform.machine().lower()
    choices = {'x86_64': 'amd64-v1', 'amd64': 'amd64-v1', 'amd64-v1': 'amd64-v1',
               'amd64-v3': 'amd64-v3', 'aarch64': 'arm64', 'arm64': 'arm64'}
    if value not in choices:
        raise InstallError('仅支持 Linux x86-64 / ARM64，当前架构：' + value)
    return choices[value]


def safe_name(name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', name):
        raise InstallError('无效的发行文件名')
    return name


def fetch(url, destination=None):
    if not url.startswith('https://'):
        raise InstallError('下载地址必须使用 HTTPS')
    request = Request(url, headers={'User-Agent': 'LocalDNS-installer/' + INSTALLER_VERSION,
                                   'Accept': 'application/vnd.github+json' if url.startswith(API) else '*/*'})
    try:
        with urlopen(request, timeout=60) as response:
            if destination is None:
                return response.read(4 * 1024 * 1024)
            with destination.open('wb') as output:
                shutil.copyfileobj(response, output)
    except HTTPError as error:
        detail = 'GitHub 请求受限' if error.code in (403, 429) else 'HTTP ' + str(error.code)
        raise InstallError('下载失败（' + detail + '）：' + url) from None
    except (OSError, URLError) as error:
        raise InstallError('无法下载，请检查网络及系统 CA 证书：' + url) from error


class Packages:
    def __init__(self, work, version=None, directory=None):
        self.work = work
        self.directory = Path(directory).resolve() if directory else None
        self.release = None
        if self.directory:
            sums = self.directory / 'SHA256SUMS.txt'
            if not sums.is_file():
                raise InstallError('离线目录缺少 SHA256SUMS.txt')
            text = sums.read_text(encoding='utf-8')
        else:
            if version and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}', version):
                raise InstallError('--version 必须是正式发行标签')
            endpoint = API + ('tags/' + quote(version, safe='') if version else 'latest')
            self.release = json.loads(fetch(endpoint))
            if self.release.get('draft') or self.release.get('prerelease'):
                raise InstallError('仅安装正式发行版')
            safe_name(self.release.get('tag_name'))
            self.assets = {safe_name(a['name']): a for a in self.release.get('assets', [])}
            if 'SHA256SUMS.txt' not in self.assets:
                raise InstallError('正式发行版缺少 SHA256SUMS.txt')
            sums = work / 'SHA256SUMS.txt'
            self.download('SHA256SUMS.txt', sums)
            text = sums.read_text(encoding='utf-8')
            log('发行版：' + self.release['tag_name'])
        self.sums = {}
        for line in text.splitlines():
            if not line.strip():
                continue
            fields = line.split('  ', 1)
            if len(fields) != 2 or not re.fullmatch('[a-fA-F0-9]{64}', fields[0]):
                raise InstallError('SHA256SUMS.txt 格式无效')
            name = safe_name(fields[1])
            if name in self.sums:
                raise InstallError('校验文件含重复条目')
            self.sums[name] = fields[0].lower()

    def download(self, name, destination):
        asset = self.assets[name]
        url = asset['browser_download_url']
        expected = REPO + '/releases/download/' + self.release['tag_name'] + '/' + name
        if url != expected:
            raise InstallError('发行文件不属于预期 GitHub 仓库')
        require_space(destination.parent, asset.get('size', 0))
        fetch(url, destination)
        expected_digest = asset.get('digest')
        if expected_digest and expected_digest != 'sha256:' + digest(destination.read_bytes()):
            raise InstallError('GitHub 附件摘要校验失败：' + name)

    def get(self, kind):
        suffix = {'full': '_Full.zip', 'ui': '_Update.zip'}[kind]
        names = [name for name in self.sums if name.startswith('LocalDNS_') and name.endswith(suffix)]
        if len(names) != 1:
            raise InstallError('发行目录必须恰好包含一个 ' + kind + ' 安装包')
        name = names[0]
        destination = self.work / name
        if self.directory:
            source = self.directory / name
            if not source.is_file() or source.is_symlink():
                raise InstallError('离线发行文件缺失或为符号链接：' + name)
            require_space(destination.parent, source.stat().st_size)
            shutil.copyfile(source, destination)
        else:
            log('下载：' + name)
            if name not in self.assets:
                raise InstallError('正式发行版缺少附件：' + name)
            self.download(name, destination)
        if digest(destination.read_bytes()) != self.sums[name]:
            raise InstallError('安装包 SHA-256 校验失败：' + name)
        extracted = self.work / kind
        metadata = extract_verified(destination, extracted)
        log('校验通过：' + name)
        return extracted, metadata


def extract_verified(archive, output):
    try:
        with ZipFile(archive) as source:
            infos = source.infolist()
            names = [i.filename for i in infos]
            if len(names) != len(set(names)) or sum(i.file_size for i in infos) > 512 * 1024 * 1024:
                raise InstallError('安装包含重复文件或解压体积异常')
            for item in infos:
                name = item.filename
                path = PurePosixPath(name)
                mode = item.external_attr >> 16
                if (not name or '\x00' in item.orig_filename or '\\' in name or ':' in name or
                        path.is_absolute() or '..' in path.parts or stat.S_ISLNK(mode) or
                        (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
                    raise InstallError('安装包包含不安全路径或文件类型')
            manifest = {}
            for line in source.read('MANIFEST.sha256').decode('utf-8').splitlines():
                fields = line.split('  ', 1)
                if len(fields) != 2 or not re.fullmatch('[a-fA-F0-9]{64}', fields[0]) or fields[1] in manifest:
                    raise InstallError('包内校验清单无效')
                manifest[fields[1]] = fields[0].lower()
            files = {i.filename for i in infos if not i.is_dir() and i.filename != 'MANIFEST.sha256'}
            if files != set(manifest):
                raise InstallError('包内清单未覆盖全部文件')
            for name, expected in manifest.items():
                if digest(source.read(name)) != expected:
                    raise InstallError('包内文件校验失败：' + name)
            metadata = json.loads(source.read('release.json'))
            if not re.fullmatch(r'\d{4}\.\d+\.\d+\.\d+', metadata.get('uiVersion', '')):
                raise InstallError('安装包版本元数据无效')
            if not re.fullmatch(r'FJG[A-Z0-9]+', metadata.get('backendVersion', '')):
                raise InstallError('安装包核心版本无效')
            require_space(output.parent, sum(i.file_size for i in infos))
            output.mkdir(parents=True)
            for item in infos:
                target = output.joinpath(*PurePosixPath(item.filename).parts)
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read(item))
                    target.chmod(0o755 if (item.external_attr >> 16) & 0o111 else 0o644)
            return metadata
    except (BadZipFile, KeyError, UnicodeError, json.JSONDecodeError) as error:
        raise InstallError('安装包损坏或缺少有效清单 / 版本元数据') from error


def no_symlinks(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise InstallError('拒绝符号链接安装路径：' + str(item))


def install_path(value, stage=None):
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value) or '..' in PurePosixPath(value).parts:
        raise InstallError('--dir 必须是无空格的 Linux 绝对路径')
    logical = PurePosixPath(value)
    if len(logical.parts) < 3 or value in ('/usr/local', '/etc/init.d', '/var/lib', '/var/log'):
        raise InstallError('请使用独立安装目录，例如 /opt/localdns')
    target = Path(value) if stage is None else stage.joinpath(*logical.parts[1:])
    no_symlinks(target)
    return target


@contextlib.contextmanager
def locked(root):
    root.parent.mkdir(parents=True, exist_ok=True)
    path = root.parent / ('.' + root.name + '-installer.lock')
    # A permanent OS lock serializes removal of locks left by a killed new installer.
    # Older installers still participate through the original exclusive lock file.
    guard = path.with_suffix('.guard')
    no_symlinks(guard)
    handle = os.open(str(guard), os.O_CREAT | os.O_RDWR, 0o600)
    acquired = False
    try:
        try:
            if os.name == 'nt':
                import msvcrt
                if os.fstat(handle).st_size == 0:
                    os.write(handle, b'0')
                os.lseek(handle, 0, os.SEEK_SET)
                msvcrt.locking(handle, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError:
            raise InstallError('已有安装任务：' + str(path)) from None
        no_symlinks(path)
        if path.exists():
            try:
                stale = json.loads(path.read_text(encoding='utf-8'))
            except (ValueError, OSError):
                stale = None
            if not isinstance(stale, dict) or stale.get('lockProtocol') != 1:
                raise InstallError('已有安装任务或旧版遗留锁：' + str(path))
            path.unlink()  # Its OS guard has been acquired, so its owner has exited.
        lock_handle = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(lock_handle, 'w') as output:
                json.dump({'lockProtocol': 1, 'pid': os.getpid()}, output)
            yield
        finally:
            path.unlink()
    finally:
        if acquired:
            if os.name == 'nt':
                os.lseek(handle, 0, os.SEEK_SET)
                msvcrt.locking(handle, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)
        os.close(handle)


def installed(root):
    return (root / 'bin/localdns').is_file() and (root / 'config/localdns.json').is_file() and (root / 'ui/index.html').is_file()


def manager(stage=None):
    if stage:
        return 'staging'
    if platform.system() != 'Linux' or os.geteuid() != 0:
        raise InstallError('请在 Linux 上以 root 运行；隔离验证可使用 --stage-root')
    if shutil.which('rc-service') and Path('/sbin/openrc-run').exists():
        return 'openrc'
    if shutil.which('systemctl') and Path('/run/systemd/system').is_dir():
        return 'systemd'
    raise InstallError('需要运行中的 systemd 或 OpenRC')


def check_ports(dns_port, http_port):
    ports = [(dns_port, socket.SOCK_DGRAM), (dns_port, socket.SOCK_STREAM), (http_port, socket.SOCK_STREAM)]
    for port, kind in ports:
        try:
            with socket.socket(socket.AF_INET, kind) as stream:
                stream.bind(('0.0.0.0', port))
        except OSError:
            protocol = 'UDP' if kind == socket.SOCK_DGRAM else 'TCP'
            raise InstallError(f'{protocol} {port} 端口已占用。请调整 --dns-port / --http-port，或先处理端口冲突。') from None


def default_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as stream:
            stream.connect(('1.1.1.1', 53))
            return stream.getsockname()[0]
    except OSError:
        return '127.0.0.1'


def origin(value, http_port):
    value = value or 'http://' + default_ip() + ':' + str(http_port)
    parsed = urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or
            parsed.path or parsed.query or parsed.fragment or not re.fullmatch(r'[A-Za-z0-9.-]+', parsed.hostname)):
        raise InstallError('--origin 需要无路径的 HTTP(S) 地址，例如 http://192.168.1.2:9099')
    try:
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError('port')
    except ValueError:
        raise InstallError('--origin 端口无效') from None
    port = parsed.port
    authority = parsed.hostname
    if port is not None and (parsed.scheme, port) not in [('http', 80), ('https', 443)]:
        authority += ':' + str(port)
    return parsed.scheme + '://' + authority


def fresh_config(root, dns_port, http_port):
    config_path = root / 'config/localdns.json'
    config = json.loads(config_path.read_text(encoding='utf-8'))
    config['api']['http'] = '0.0.0.0:' + str(http_port)
    config['dns'].update(udp_listen=':' + str(dns_port), tcp_listen=':' + str(dns_port))
    write_json(config_path, config)
    domestic = {'upstreams': [
        {'tag': 'AliDNS', 'enabled': True, 'protocol': 'udp', 'addr': '223.5.5.5'},
        {'tag': 'DNSPod', 'enabled': True, 'protocol': 'udp', 'addr': '119.29.29.29'}]}
    foreign = {'upstreams': [
        {'tag': 'Cloudflare', 'enabled': True, 'protocol': 'udp', 'addr': '1.1.1.1'},
        {'tag': 'Quad9', 'enabled': True, 'protocol': 'udp', 'addr': '9.9.9.9'}]}
    write_json(root / 'config/upstreams/domestic.json', domestic)
    write_json(root / 'config/upstreams/foreign.json', foreign)
    write_json(root / 'config/upstreams/proxy.json', foreign)
    ecs_path = root / 'config/upstreams/foreign_ecs.json'
    ecs = json.loads(ecs_path.read_text(encoding='utf-8')) if ecs_path.exists() else {}
    ecs['upstreams'] = foreign['upstreams']
    write_json(ecs_path, ecs)


def api_port(root):
    value = json.loads((root / 'config/localdns.json').read_text(encoding='utf-8'))['api']['http']
    return int(value.rsplit(':', 1)[1])


def local_json(port, path, timeout=3):
    opener = build_opener(ProxyHandler({}))
    with opener.open('http://127.0.0.1:' + str(port) + path, timeout=timeout) as response:
        return json.load(response)


def recover_ui_update(root):
    """Called with the installation lock held; never trust journal paths."""
    journal = root / '.ui-update-transaction.json'
    no_symlinks(journal)
    if not journal.exists():
        return False
    value = json.loads(journal.read_text(encoding='utf-8'))
    paths = {}
    for key, prefix in [('previous', 'ui.previous-'), ('staging', '.ui-stage-')]:
        name = value.get(key, '')
        if not isinstance(name, str) or not re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9._-]+', name):
            raise InstallError('UI 更新事务路径无效，需要手动检查')
        paths[key] = root / name
        no_symlinks(paths[key])
    no_symlinks(root / 'ui')
    if value.get('verified') is not True and paths['previous'].is_dir():
        if (root / 'ui').exists():
            (root / 'ui').rename(root / ('ui.failed-' + uuid.uuid4().hex))
        paths['previous'].rename(root / 'ui')
    elif not (root / 'ui/index.html').is_file():
        raise InstallError('UI 更新事务缺少可恢复的界面，需要手动检查')
    if paths['staging'].exists():
        shutil.rmtree(paths['staging'])
    journal.unlink()
    return True


def update_ui(root, payload, metadata, stage=None, on_step=None):
    report = on_step or (lambda step: None)
    recover_ui_update(root)
    for path in (root / 'ui', root / 'ui/config.js', root / 'bin', root / 'config'):
        no_symlinks(path)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    version = metadata['uiVersion']
    backup = root / ('ui-backup-' + version + '-' + stamp + '.tar.gz')
    previous = root / ('ui.previous-' + version + '-' + stamp)
    staging = root / ('.ui-stage-' + stamp)
    if any(p.exists() for p in (backup, previous, staging)):
        raise InstallError('备份或暂存路径已存在，请稍后重试')
    require_space(root, sum(p.stat().st_size for tree in [payload / 'ui', root / 'ui']
                            for p in tree.rglob('*') if p.is_file()))
    running = False
    port = api_port(root)
    if stage is None:
        try:
            local_json(port, '/api/v1/status')
            running = True
        except (OSError, ValueError, URLError):
            pass
    journal = root / '.ui-update-transaction.json'
    transaction = {'previous': previous.name, 'staging': staging.name, 'verified': False}
    atomic_json(journal, transaction)
    report('backup')
    with tarfile.open(backup, 'w:gz', dereference=False) as archive:
        archive.add(root / 'ui', arcname='ui')
    shutil.copytree(payload / 'ui', staging)
    if (root / 'ui/config.js').is_file():
        shutil.copy2(root / 'ui/config.js', staging / 'config.js')
    custom = root / 'ui/custom'
    if custom.exists():
        no_symlinks(custom)
        if any(p.is_symlink() for p in custom.rglob('*')):
            raise InstallError('共享配置目录包含符号链接')
        shutil.copytree(custom, staging / 'custom', dirs_exist_ok=True)
    # Keep only assets listed by the previous build, so open tabs can finish loading
    # their lazy chunks without retaining every historical release indefinitely.
    old_meta = root / 'ui/build-meta.json'
    if old_meta.is_file():
        outputs = json.loads(old_meta.read_text(encoding='utf-8')).get('files', {})
        for name in outputs:
            if not isinstance(name, str) or not name.startswith('assets/') or '..' in PurePosixPath(name).parts or '\\' in name:
                continue
            source, target = root / 'ui' / name, staging / name
            no_symlinks(source)
            if source.is_file() and not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    moved = False
    try:
        report('install')
        (root / 'ui').rename(previous)
        moved = True
        staging.rename(root / 'ui')
        sync_directory(root)
        report('verify')
        if running:
            current = local_json(port, '/ui/version.json')
            if current['uiVersion'] != version:
                raise InstallError('更新后的 UI 版本校验失败')
            local_json(port, '/api/v1/status')
        atomic_json(journal, dict(transaction, verified=True))
    except Exception:
        if moved:
            if (root / 'ui').exists():
                (root / 'ui').rename(root / ('ui.failed-' + stamp))
            previous.rename(root / 'ui')
        journal.unlink()
        raise
    journal.unlink()
    log('UI 已更新至 ' + version + '；DNS 核心、配置与规则已保留。')
    log('备份：' + str(backup))
    log('上一版 UI：' + str(previous))
    return {'backup': backup.name, 'previous': previous.name, 'serviceChecked': running}


def service_files(logical_root, alpine_compat=False):
    root = str(logical_root)
    systemd_environment = f'Environment=LD_PRELOAD={root}/bin/localdns-compat.so\n' if alpine_compat else ''
    openrc_environment = f'export LD_PRELOAD="{root}/bin/localdns-compat.so"\n' if alpine_compat else ''
    unit = f'''[Unit]
Description=LocalDNS DNS Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={root}
{systemd_environment}ExecStart={root}/bin/localdns --root {root} --config {root}/config/localdns.json
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
'''
    rc = f'''#!/sbin/openrc-run
name="localdns"
description="LocalDNS DNS Service"
supervisor="supervise-daemon"
command="{root}/bin/localdns"
command_args="--root {root} --config {root}/config/localdns.json"
directory="{root}"
output_log="{root}/logs/dns.log"
error_log="{root}/logs/dns.log"
respawn_delay=5
respawn_max=10
respawn_period=60
{openrc_environment}depend() {{
    need net
}}
'''
    return {'etc/systemd/system/localdns.service': unit, 'etc/init.d/localdns': rc}


def manage(action, init):
    if init == 'systemd':
        if action == 'register':
            run(['systemctl', 'daemon-reload'])
            run(['systemctl', 'enable', 'localdns.service'])
        else:
            run(['systemctl', action, 'localdns.service'])
    elif init == 'openrc':
        if action == 'register':
            run(['rc-update', 'add', 'localdns', 'default'])
        elif action == 'disable':
            run(['rc-update', 'del', 'localdns', 'default'])
        else:
            run(['rc-service', 'localdns', action])


def runtime_check(binary):
    compatibility = None
    if Path('/etc/alpine-release').exists():
        log('检查 Alpine 兼容依赖：gcompat / libgcc / gcc / musl-dev')
        dependencies = ['gcompat', 'libgcc', 'gcc', 'musl-dev']
        ready = all(subprocess.run(['apk', 'info', '-e', name], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL).returncode == 0 for name in dependencies)
        if not ready:
            run(['apk', 'add', '--no-cache', *dependencies])
        # FJGAC imports glibc's __res_init; musl exports the equivalent res_init.
        source = binary.parent / 'localdns-compat.c'
        compatibility = binary.parent / 'localdns-compat.so'
        source.write_text(ALPINE_RESOLVER_BRIDGE, encoding='utf-8')
        run(['gcc', '-shared', '-fPIC', '-O2', '-o', str(compatibility), str(source)])
    environment = dict(os.environ)
    if compatibility:
        environment['LD_PRELOAD'] = str(compatibility)
    result = subprocess.run([str(binary), '--help'], capture_output=True, text=True, timeout=15, env=environment)
    if result.returncode:
        raise InstallError('核心运行环境检查失败：' + (result.stderr or result.stdout)[-1200:])
    return compatibility


def install_new(root, logical_root, payload, metadata, arch, dns_port, http_port, init, stage=None):
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise InstallError('新安装目标不是空目录，已停止以保留现有数据')
    prefix = stage or Path('/')
    files = service_files(logical_root)
    if any(prefix.joinpath(*PurePosixPath(name).parts).exists() for name in files):
        raise InstallError('已有 localdns 服务定义；请确认原安装路径后再更新')
    source = payload / 'localdns'
    if not (source / 'ui/index.html').is_file() or not (source / 'config/localdns.json').is_file():
        raise InstallError('完整包缺少 UI 或默认配置')
    binary = payload / ('LocalDNS_' + metadata['backendVersion'] + '_Binaries') / ('localdns-' + arch)
    data = binary.read_bytes()
    expected_machine = 183 if arch == 'arm64' else 62
    if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != expected_machine:
        raise InstallError('核心 ELF 架构不匹配')
    binary.chmod(0o755)
    compatibility = None
    if stage is None:
        compatibility = runtime_check(binary)
        files = service_files(logical_root, bool(compatibility))
        check_ports(dns_port, http_port)
    staging = root.parent / ('.' + root.name + '-stage-' + str(os.getpid()))
    if staging.exists():
        raise InstallError('暂存目录已存在：' + str(staging))
    require_space(root.parent, sum(p.stat().st_size for p in source.rglob('*') if p.is_file()))
    shutil.copytree(source, staging)
    (staging / 'logs').mkdir(exist_ok=True)
    shutil.copy2(binary, staging / 'bin/localdns')
    (staging / 'bin/localdns').chmod(0o755)
    if compatibility:
        shutil.copy2(compatibility, staging / 'bin/localdns-compat.so')
    fresh_config(staging, dns_port, http_port)
    # No pre-existing non-empty target has been accepted above.
    if root.exists():
        root.rmdir()
    staging.rename(root)
    written = []
    try:
        for name, content in files.items():
            path = prefix.joinpath(*PurePosixPath(name).parts)
            no_symlinks(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
            path.chmod(0o755 if name.endswith('/localdns') else 0o644)
            written.append(path)
        if init != 'staging':
            manage('register', init)
            manage('start', init)
            for attempt in range(20):
                try:
                    local_json(http_port, '/api/v1/status')
                    break
                except (OSError, ValueError, URLError):
                    if attempt == 19:
                        raise InstallError('DNS 管理 API 启动检查失败')
                    time.sleep(.5)
    except Exception:
        if init != 'staging':
            with contextlib.suppress(Exception):
                manage('stop', init)
            with contextlib.suppress(Exception):
                manage('disable', init)
        for path in written:
            path.unlink()
        failed = root.with_name(root.name + '.failed-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
        root.rename(failed)
        log('启动失败，已停止新服务；文件保留在：' + str(failed))
        raise
    log('LocalDNS 已安装：' + str(root))


def port_number(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError('端口必须为数字')
    if not 1 <= number <= 65535:
        raise argparse.ArgumentTypeError('端口范围为 1–65535')
    return number


def main(argv=None):
    parser = argparse.ArgumentParser(description='LocalDNS 一键安装：新装 DNS 与静态 UI，已有安装默认只更新 UI。')
    parser.add_argument('--dir', default='/opt/localdns', help='安装目录，默认 /opt/localdns')
    parser.add_argument('--version', help='指定正式发行标签，默认 GitHub 最新正式版')
    parser.add_argument('--mode', choices=['auto', 'install', 'ui'], default='auto')
    parser.add_argument('--arch', choices=['amd64-v1', 'amd64-v3', 'arm64'], help='默认 x86-64 v1 或 ARM64')
    parser.add_argument('--dns-port', type=port_number, default=53)
    parser.add_argument('--http-port', type=port_number, default=9099)
    parser.add_argument('--without-service', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--with-ui-updater', action='store_true', help='同时安装可选的网页 UI 升级执行端')
    parser.add_argument('--ui-updater-url', help='升级执行端的 HTTPS 代理入口（可选）')
    parser.add_argument('--origin', help='UI 地址，例如 http://192.168.1.2:9099')
    parser.add_argument('--package-dir', help='离线发行包目录，必须包含 SHA256SUMS.txt')
    parser.add_argument('--stage-root', type=Path, help='仅向隔离根目录准备文件，不检查宿主端口或启动服务')
    args = parser.parse_args(argv)
    stage = args.stage_root
    if stage:
        stage = stage.absolute()
        if stage == Path(stage.anchor):
            raise InstallError('--stage-root 不能是文件系统根目录')
        no_symlinks(stage)
        stage.mkdir(parents=True, exist_ok=True)
        stage = stage.resolve()
        if stage == Path(stage.anchor):
            raise InstallError('--stage-root 不能解析到文件系统根目录')
    init = manager(stage)
    root = install_path(args.dir, stage)
    if (root / '.ui-update-transaction.json').exists():
        with locked(root):
            recover_ui_update(root)
    arch = choose_arch(args.arch)
    mode = 'ui' if args.mode == 'auto' and installed(root) else 'install' if args.mode == 'auto' else args.mode
    if mode == 'ui' and not installed(root):
        raise InstallError('未找到完整的已有安装，无法执行 UI 更新')
    if mode == 'install' and root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise InstallError('新安装目标不是空目录；已停止以保留现有数据')
    if args.dns_port == args.http_port:
        raise InstallError('DNS 与管理界面端口不能相同')
    http_port = api_port(root) if mode == 'ui' else args.http_port
    origin_value = origin(args.origin, http_port)
    if mode == 'install' and stage is None:
        check_ports(args.dns_port,http_port)
    # Use the installation filesystem instead of small RAM-backed /tmp mounts.
    with locked(root), tempfile.TemporaryDirectory(prefix='.localdns-work-', dir=str(root.parent)) as temporary:
        packages = Packages(Path(temporary), args.version, args.package_dir)
        kind = 'ui' if mode == 'ui' else 'full'
        payload, metadata = packages.get(kind)
        expected_type = 'ui-update' if kind == 'ui' else 'full'
        if metadata.get('packageType') != expected_type:
            raise InstallError('安装包类型不匹配')
        ui_path = payload / ('ui' if kind == 'ui' else 'localdns/ui') / 'version.json'
        ui_metadata = json.loads(ui_path.read_text(encoding='utf-8'))
        if any(ui_metadata.get(key) != metadata.get(key) for key in ('uiVersion', 'backendVersion')):
            raise InstallError('UI 与发行包的版本元数据不一致')
        setup_names = ('install_ui_updater.py', 'ui_updater.py', 'install_localdns.py')
        if args.with_ui_updater and not all((payload / 'ui-updater' / name).is_file() for name in setup_names):
            raise InstallError('此发行包尚未包含网页升级执行端，请选择包含此功能的新发行版')
        log('模式：' + ('保留现有核心的 UI 更新' if mode == 'ui' else '全新安装') + '；架构：' + arch)
        if mode == 'ui':
            update_ui(root, payload, metadata, stage)
        else:
            install_new(root, PurePosixPath(args.dir), payload, metadata, arch, args.dns_port, http_port, init, stage)
        if args.with_ui_updater:
            setup = root / '.ui-updater/setup'
            no_symlinks(setup)
            setup.mkdir(parents=True, exist_ok=True)
            for name in setup_names:
                no_symlinks(setup / name)
                shutil.copyfile(payload / 'ui-updater' / name, setup / name)
                (setup / name).chmod(0o600)
        log(('隔离准备完成（未启动服务）' if stage else '安装完成') + '，UI 版本：' + metadata['uiVersion'])
        log('管理页面：' + origin_value + '/ui/')
        if mode == 'install':
            log('DNS 端口：' + str(args.dns_port) + '；请在 DNS 管理中按网络调整默认上游。')
    if args.with_ui_updater:
        arguments = [sys.executable, str(root / '.ui-updater/setup/install_ui_updater.py'),
                     '--dir', args.dir, '--origin', origin_value]
        if stage:
            arguments.extend(['--stage-root', str(stage)])
        if args.ui_updater_url:
            arguments.extend(['--public-url', args.ui_updater_url])
        run(arguments)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (InstallError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print('安装未完成：' + str(error), file=sys.stderr)
        raise SystemExit(1)
