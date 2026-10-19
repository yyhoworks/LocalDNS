#!/usr/bin/env python3
"""Restricted UI update endpoint. No shell execution or client-selected paths/URLs."""
from __future__ import annotations

import argparse
import contextlib
import json
import re
import secrets
import shutil
import socket
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import install_localdns as installer

PROTOCOL = 'localdns-ui-updater/v1'
TAG = re.compile(r'fjg[a-z0-9]+-ui-v(\d{4}\.\d+\.\d+\.\d+)', re.I)
ACTIVE = {'queued', 'running'}


class UpdateError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat()


def version_parts(value):
    match = re.fullmatch(r'(\d{4}\.\d+\.\d+\.\d+)(?:-local[\w.-]*)?', str(value))
    if not match:
        raise UpdateError('当前 UI 版本无效，请先使用安装脚本修复')
    return tuple(map(int, match[1].split('.')))


def canonical_origin(value):
    try:
        url = urlsplit(value)
        if (url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password
                or url.path not in ('', '/') or url.query or url.fragment):
            raise ValueError()
        port = url.port
        host = '[' + url.hostname + ']' if ':' in url.hostname else url.hostname
        default = 443 if url.scheme == 'https' else 80
        return url.scheme + '://' + host + (':' + str(port) if port and port != default else '')
    except ValueError:
        raise UpdateError('网页来源必须是无路径的 HTTP(S) 地址') from None


class UpdateManager:
    def __init__(self, root, state_dir=None):
        self.root = Path(root).absolute()
        installer.no_symlinks(self.root)
        self.directory = state_dir or self.root / '.ui-updater'
        installer.no_symlinks(self.directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.state_file = self.directory / 'state.json'
        installer.no_symlinks(self.state_file)
        self.mutex = threading.RLock()
        self.thread = None
        self.state = json.loads(self.state_file.read_text(encoding='utf-8')) if self.state_file.exists() else {}
        with installer.locked(self.root):
            recovered = installer.recover_ui_update(self.root)
        if self.state.get('state') in ACTIVE:
            self.save(state='failed', step='interrupted', finishedAt=now(),
                      message='上次更新被中断，旧 UI 已恢复，请重新发起升级。' if recovered
                      else '上次更新被中断，请检查当前版本后重新发起升级。')

    def save(self, **values):
        with self.mutex:
            self.state.update(values)
            installer.atomic_json(self.state_file, self.state)

    def installed_version(self):
        file = self.root / 'ui/version.json'
        installer.no_symlinks(file)
        return json.loads(file.read_text(encoding='utf-8'))

    def backup_path(self):
        name = self.state.get('previous', '')
        if not isinstance(name, str) or not re.fullmatch(r'ui\.previous-[A-Za-z0-9._-]+', name):
            return None
        backup = self.root / name
        installer.no_symlinks(backup)
        return backup if (backup / 'index.html').is_file() and (backup / 'version.json').is_file() else None

    def status(self):
        with self.mutex:
            result = {key: value for key, value in self.state.items() if key != 'previous'}
            result.update(state=self.state.get('state', 'idle'), canRollback=self.backup_path() is not None)
            try:
                result['installedVersion'] = self.installed_version().get('uiVersion')
            except (OSError, ValueError):
                result['installedVersion'] = None
            return result

    def start(self, tag=None, rollback=False):
        with self.mutex:
            if self.state.get('state') in ACTIVE:
                if not rollback and self.state.get('action') == 'upgrade' and self.state.get('targetTag') == tag:
                    return self.status()
                raise UpdateError('已有 UI 更新任务，请等待完成', 409)
            installed = self.installed_version()
            if rollback:
                if self.backup_path() is None:
                    raise UpdateError('没有可恢复的上一版 UI', 409)
            else:
                match = TAG.fullmatch(tag or '')
                if not match:
                    raise UpdateError('请选择本项目的正式 UI 发行版')
                if tuple(map(int, match[1].split('.'))) <= version_parts(installed.get('uiVersion')):
                    raise UpdateError('目标版本没有高于当前 UI，不执行重复升级或降级', 409)
                backend = tag.split('-ui-v')[0].upper()
                if backend != str(installed.get('backendVersion', '')).upper():
                    raise UpdateError('目标发行版需要不同的 DNS 核心，请先按发行说明升级核心', 409)
            self.save(jobId=secrets.token_hex(12), action='rollback' if rollback else 'upgrade',
                      state='queued', step='queued', targetTag=tag, startedAt=now(), finishedAt=None,
                      message='任务已提交；关闭页面后仍会继续执行。')
            self.thread = threading.Thread(target=self.run, args=(tag, rollback), daemon=True)
            self.thread.start()
            return self.status()

    def step(self, step):
        messages = {'download': '正在下载并校验正式发行包…', 'backup': '正在备份当前界面与共享设置…',
                    'install': '正在切换 UI 文件，DNS 服务继续运行…', 'verify': '正在核对新版 UI 与管理接口…'}
        self.save(state='running', step=step, message=messages[step])

    def run(self, tag, rollback):
        try:
            with installer.locked(self.root):
                installer.recover_ui_update(self.root)
                with tempfile.TemporaryDirectory(prefix='work-', dir=str(self.directory)) as temporary:
                    work = Path(temporary)
                    if rollback:
                        backup = self.backup_path()
                        if backup is None:
                            raise UpdateError('上一版 UI 已不存在')
                        for file in backup.rglob('*'):
                            installer.no_symlinks(file)
                        payload = work / 'restore'
                        shutil.copytree(backup, payload / 'ui')
                        metadata = json.loads((payload / 'ui/version.json').read_text(encoding='utf-8'))
                        if metadata.get('backendVersion') != self.installed_version().get('backendVersion'):
                            raise UpdateError('上一版 UI 的核心要求不同，已停止恢复')
                    else:
                        self.step('download')
                        packages = installer.Packages(work, tag)
                        payload, metadata = packages.get('ui')
                        match = TAG.fullmatch(tag)
                        installed = self.installed_version()
                        ui = json.loads((payload / 'ui/version.json').read_text(encoding='utf-8'))
                        if (metadata.get('packageType') != 'ui-update' or metadata.get('uiVersion') != match[1]
                                or metadata.get('backendVersion') != installed.get('backendVersion')
                                or any(ui.get(key) != metadata.get(key) for key in ('uiVersion', 'backendVersion'))):
                            raise UpdateError('下载包类型、版本或核心要求不匹配，已停止升级')
                        if version_parts(metadata['uiVersion']) <= version_parts(installed.get('uiVersion')):
                            raise UpdateError('当前 UI 已改变，请重新检查版本')
                    result = installer.update_ui(self.root, payload, metadata, on_step=self.step)
                    self.save(state='succeeded', step='done', finishedAt=now(), previous=result['previous'],
                              message=('已恢复 UI ' if rollback else 'UI 已升级至 ') + metadata['uiVersion'] +
                              ('。管理接口检查通过，可刷新使用。' if result['serviceChecked']
                               else '。文件已更新，DNS 管理接口当前离线，请检查服务后刷新。'))
        except Exception as error:
            self.save(state='failed', step='failed', finishedAt=now(), message=str(error))


class UpdateServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, config, manager):
        self.config = config
        self.manager = manager
        self.origins = {canonical_origin(value) for value in config['allowedOrigins']}
        self.hosts = {urlsplit(value).hostname for value in self.origins}
        self.hosts.update(config.get('allowedHosts', []))
        self.connections = threading.BoundedSemaphore(24)
        if ':' in address[0]:
            self.address_family = socket.AF_INET6
        super().__init__(address, UpdateHandler)

    def process_request(self, request, client_address):
        if not self.connections.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connections.release()


class UpdateHandler(BaseHTTPRequestHandler):
    server_version = 'LocalDNS-UI-Updater'

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        pass  # Request bodies are never logged.

    def respond(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Vary', 'Origin')
        origin = self.headers.get('Origin')
        if origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(payload)

    def check_request(self):
        try:
            host = urlsplit('http://' + self.headers.get('Host', '')).hostname
        except ValueError:
            host = None
        if host not in self.server.hosts:
            raise UpdateError('访问主机未被允许', 403)
        origin = self.headers.get('Origin')
        if origin and origin not in self.server.origins:
            raise UpdateError('网页来源未被允许', 403)
        if self.command == 'POST' and origin not in self.server.origins:
            raise UpdateError('更新请求必须来自已配置的网页', 403)
        if self.headers.get('Transfer-Encoding'):
            raise UpdateError('不支持此请求编码')

    def body(self):
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            raise UpdateError('请求必须使用 JSON', 415)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError()
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeError):
            raise UpdateError('请求内容无效或过大') from None

    def handle_request(self):
        try:
            self.check_request()
            path = self.path
            if self.command == 'OPTIONS':
                if self.headers.get('Origin') not in self.server.origins:
                    raise UpdateError('网页来源未被允许', 403)
                self.respond(200, {})
            elif self.command == 'GET' and path == '/upgrade/ui':
                self.respond(200, {'protocol': PROTOCOL, 'repository': installer.REPO, 'requiresAuth': False})
            elif self.command == 'GET' and path == '/upgrade/ui/status':
                self.respond(200, self.server.manager.status())
            elif self.command == 'POST' and path in ('/upgrade/ui', '/upgrade/ui/rollback'):
                body = self.body()
                rollback = path.endswith('/rollback')
                if set(body) != (set() if rollback else {'releaseTag'}):
                    raise UpdateError('只接受固定的 UI 升级操作')
                if not rollback and not isinstance(body['releaseTag'], str):
                    raise UpdateError('发行版本无效')
                self.respond(202, self.server.manager.start(body.get('releaseTag'), rollback))
            else:
                raise UpdateError('接口不存在', 404)
        except UpdateError as error:
            self.respond(error.status, {'error': str(error)})
        except (OSError, ValueError, installer.InstallError):
            self.respond(500, {'error': '更新执行端状态读取失败，请检查服务日志或安装配置'})

    do_GET = do_POST = do_OPTIONS = handle_request


def main():
    parser = argparse.ArgumentParser(description='LocalDNS UI 更新执行端')
    parser.add_argument('--config', required=True, type=Path)
    args = parser.parse_args()
    installer.no_symlinks(args.config)
    config = json.loads(args.config.read_text(encoding='utf-8'))
    root = installer.install_path(config['installDir'])
    manager = UpdateManager(root)
    server = UpdateServer((config['listenHost'], int(config['port'])), config, manager)
    with contextlib.closing(server):
        server.serve_forever()


if __name__ == '__main__':
    main()
