#!/usr/bin/env python3
"""Install the optional UI updater once on an existing Linux LocalDNS host."""
from __future__ import annotations

import argparse
import json
import re
import secrets
import shlex
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit

import install_localdns as installer
from ui_updater import UpdateError, canonical_origin

START = '/* localdns-ui-updater:start */'
END = '/* localdns-ui-updater:end */'


def configure_script(source, base):
    if source.count(START) != source.count(END) or source.count(START) > 1:
        raise installer.InstallError('config.js 中的更新设置标记不完整，请先检查文件')
    source = re.sub(re.escape(START) + r'.*?' + re.escape(END) + r'\s*', '', source, flags=re.S)
    return source.rstrip() + '\n\n' + START + '\n' + \
        'window.LOCALDNS_UI_CONFIG = window.LOCALDNS_UI_CONFIG || {};\n' + \
        'window.LOCALDNS_UI_CONFIG.uiUpdaterBase = ' + json.dumps(base) + ';\n' + END + '\n'


def service_files(directory):
    script = directory + '/bin/ui-updater/ui_updater.py'
    config = directory + '/.ui-updater/config.json'
    command = '/usr/bin/python3 ' + script + ' --config ' + config
    return {
        'etc/systemd/system/localdns-ui-updater.service': (
            '[Unit]\nDescription=LocalDNS UI updater\nAfter=network-online.target\n\n'
            '[Service]\nType=simple\nExecStart=' + command + '\nRestart=on-failure\nRestartSec=3\n'
            'UMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\n\n'
            '[Install]\nWantedBy=multi-user.target\n'),
        'etc/init.d/localdns-ui-updater': (
            '#!/sbin/openrc-run\nname="LocalDNS UI updater"\ncommand="/usr/bin/python3"\n'
            'command_args=' + shlex.quote(script + ' --config ' + config) + '\n'
            'supervisor="supervise-daemon"\nrespawn_delay=3\nrespawn_max=5\n'
            'output_log="/var/log/localdns-ui-updater.log"\n'
            'error_log="/var/log/localdns-ui-updater.log"\n'
            'depend() { need net; }\nstart_pre() { umask 077; }\n')
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description='为已有 LocalDNS 安装网页 UI 升级执行端')
    parser.add_argument('--dir', default='/opt/localdns')
    parser.add_argument('--origin', required=True, help='实际打开网页的来源，例如 http://192.168.1.2:9099')
    parser.add_argument('--listen', default='0.0.0.0')
    parser.add_argument('--port', type=installer.port_number, default=9100)
    parser.add_argument('--public-url', help='通过 HTTPS 同源代理时设置，例如 https://dns.example/_updater')
    parser.add_argument('--stage-root', type=Path, help='仅准备隔离安装文件，不启停宿主服务')
    args = parser.parse_args(argv)
    stage = args.stage_root.absolute() if args.stage_root else None
    if stage:
        installer.no_symlinks(stage)
        if stage == Path(stage.anchor):
            raise installer.InstallError('隔离准备目录不能是文件系统根目录')
    init = installer.manager(stage)
    root = installer.install_path(args.dir, stage)
    ui_origin = canonical_origin(args.origin)
    if not installer.installed(root):
        raise installer.InstallError('请先安装 LocalDNS 核心与 UI')
    if args.port == installer.api_port(root):
        raise installer.InstallError('更新执行端端口不能与 DNS 管理端口相同')
    host = urlsplit(ui_origin).hostname
    host_text = '[' + host + ']' if ':' in host else host
    public = args.public_url or 'http://' + host_text + ':' + str(args.port)
    address = urlsplit(public)
    if (address.scheme not in ('http', 'https') or not address.hostname or address.username or address.password
            or address.query or address.fragment or '..' in address.path.split('/')):
        raise installer.InstallError('--public-url 必须是有效的 HTTP(S) 地址')
    if ui_origin.startswith('https:') and address.scheme != 'https':
        raise installer.InstallError('HTTPS 网页需要 --public-url 指向 HTTPS 代理入口')
    public = public.rstrip('/')
    private = root / '.ui-updater'
    for path in (private, root / 'bin/ui-updater', root / 'ui/config.js'):
        installer.no_symlinks(path)
    private.mkdir(mode=0o700, exist_ok=True)
    config_path = private / 'config.json'
    installer.no_symlinks(config_path)
    existing = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    # Migrate installations created before password-free web updates.
    for key in ('passwordSalt', 'passwordHash'):
        existing.pop(key, None)
    config = dict(existing, installDir=args.dir, listenHost=args.listen, port=args.port,
                  allowedOrigins=[ui_origin], allowedHosts=[host, address.hostname, '127.0.0.1', 'localhost'])
    runtime = root / 'bin/ui-updater'
    source = Path(__file__).resolve().parent
    site = root / 'ui/config.js'
    site_before = site.read_bytes() if site.exists() else b'window.LOCALDNS_UI_CONFIG = {};\n'
    with installer.locked(root):
        installer.recover_ui_update(root)
        runtime.mkdir(parents=True, exist_ok=True)
        for name in ('ui_updater.py', 'install_localdns.py'):
            installer.no_symlinks(runtime / name)
            shutil.copyfile(source / name, runtime / name)
            (runtime / name).chmod(0o644)
        installer.atomic_json(config_path, config)
        backup = private / ('config.js.before-setup-' + secrets.token_hex(6))
        backup.write_bytes(site_before)
        backup.chmod(0o600)
        site.write_text(configure_script(site_before.decode('utf-8'), public), encoding='utf-8')
        for relative, contents in service_files(args.dir).items():
            file = (stage / relative) if stage else Path('/') / relative
            installer.no_symlinks(file)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(contents, encoding='utf-8')
            file.chmod(0o755 if relative.startswith('etc/init.d/') else 0o644)
    if init != 'staging':
        try:
            if init == 'systemd':
                installer.run(['systemctl', 'daemon-reload'])
                installer.run(['systemctl', 'enable', 'localdns-ui-updater'])
                installer.run(['systemctl', 'restart', 'localdns-ui-updater'])
                installer.run(['systemctl', 'is-active', '--quiet', 'localdns-ui-updater'])
            else:
                installer.run(['rc-update', 'add', 'localdns-ui-updater', 'default'])
                installer.run(['rc-service', 'localdns-ui-updater', 'restart'])
                installer.run(['rc-service', 'localdns-ui-updater', 'status'])
        except Exception:
            site.write_bytes(site_before)
            raise
    print('更新执行端已' + ('准备（未启动服务）' if stage else '安装') + '：' + public)
    print('刷新 ' + ui_origin + '/ui/，打开“版本与更新”即可升级 UI。')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (installer.InstallError, UpdateError, OSError, ValueError) as error:
        print('安装未完成：' + str(error), file=sys.stderr)
        raise SystemExit(1)
