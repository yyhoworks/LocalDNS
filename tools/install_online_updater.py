#!/usr/bin/env python3
"""Install the persistent updater outside the replaceable LocalDNS directory."""
import argparse
import contextlib
import json
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import install_localdns as installer
from install_ui_updater import configure_script
from ui_updater import canonical_origin

MODULES = ('ui_updater.py', 'online_updater.py', 'install_localdns.py', 'upgrade_localdns.py', 'fjgli_config.py')


def service_files():
    command = '/usr/bin/python3 /opt/localdns-updater/ui_updater.py --config /var/lib/localdns-updater/config.json'
    return {
        'etc/systemd/system/localdns-updater.service':
            '[Unit]\nDescription=LocalDNS online updater\nAfter=network-online.target\n\n'
            '[Service]\nType=simple\nExecStart=' + command + '\nRestart=on-failure\nRestartSec=3\n'
            'UMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target\n',
        'etc/init.d/localdns-updater':
            '#!/sbin/openrc-run\nname="LocalDNS online updater"\ncommand="/usr/bin/python3"\n'
            'command_args="/opt/localdns-updater/ui_updater.py --config /var/lib/localdns-updater/config.json"\n'
            'supervisor="supervise-daemon"\nrespawn_delay=3\nrespawn_max=5\n'
            'output_log="/var/log/localdns-updater.log"\nerror_log="/var/log/localdns-updater.log"\n'
            'depend() { need net; }\nstart_pre() { umask 077; }\n'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', default='/opt/localdns')
    parser.add_argument('--origin', required=True)
    parser.add_argument('--listen', default='0.0.0.0')
    parser.add_argument('--port', type=installer.port_number, default=9100)
    parser.add_argument('--public-url')
    parser.add_argument('--stage-root', type=Path)
    args = parser.parse_args(argv)
    stage = args.stage_root.absolute() if args.stage_root else None
    if stage:
        installer.no_symlinks(stage)
        if stage == Path(stage.anchor):
            raise installer.InstallError('隔离准备目录不能是根目录')
    init = installer.manager(stage)
    root = installer.install_path(args.dir, stage)
    if not installer.installed(root):
        raise installer.InstallError('请先安装 LocalDNS 核心与 UI')
    if installer.api_port(root) == args.port:
        raise installer.InstallError('升级服务端口不能与管理端口相同')
    origin = canonical_origin(args.origin)
    host = urlsplit(origin).hostname
    public = args.public_url or 'http://' + ('[' + host + ']' if ':' in host else host) + ':' + str(args.port)
    address = urlsplit(public)
    if (address.scheme not in ('http', 'https') or not address.hostname or address.username or address.password
            or address.query or address.fragment or '..' in address.path.split('/')
            or (origin.startswith('https:') and address.scheme != 'https')):
        raise installer.InstallError('升级服务地址无效，HTTPS 页面需要 HTTPS 入口')
    runtime = installer.install_path('/opt/localdns-updater', stage)
    private = installer.install_path('/var/lib/localdns-updater', stage)
    source = Path(__file__).resolve().parent
    site = root / 'ui/config.js'
    installer.no_symlinks(site)
    before = site.read_bytes() if site.exists() else b'window.LOCALDNS_UI_CONFIG = {};\n'
    with installer.locked(root):
        state_path = private / 'state.json'
        installer.no_symlinks(state_path)
        if state_path.exists() and json.loads(state_path.read_text()).get('state') in ('queued', 'running', 'awaiting_backup', 'rolling_back'):
            raise installer.InstallError('已有升级任务，请先完成或取消，再重新安装升级服务')
        installer.recover_ui_update(root)
        runtime.mkdir(parents=True, exist_ok=True)
        private.mkdir(parents=True, exist_ok=True, mode=0o700)
        private.chmod(0o700)
        for name in MODULES:
            installer.no_symlinks(runtime / name)
            shutil.copyfile(source / name, runtime / name)
            (runtime / name).chmod(0o644)
        config_path = private / 'config.json'
        installer.no_symlinks(config_path)
        existing = json.loads(config_path.read_text()) if config_path.exists() else {}
        origins = sorted(set(existing.get('allowedOrigins', []) + [origin]))
        config = dict(protocol='localdns-updater/v2', installDir=args.dir, stateDir='/var/lib/localdns-updater',
                      listenHost=args.listen, port=args.port, allowedOrigins=origins,
                      allowedHosts=[urlsplit(x).hostname for x in origins] + [address.hostname, '127.0.0.1', 'localhost'])
        installer.atomic_json(config_path, config)
        for relative, contents in service_files().items():
            file = stage / relative if stage else Path('/') / relative
            installer.no_symlinks(file)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(contents, encoding='utf-8')
            file.chmod(0o755 if relative.startswith('etc/init.d/') else 0o644)
    old_running = False
    if init != 'staging':
        from upgrade_localdns import updater
        old_running = updater('status', init)
        try:
            if old_running and not updater('stop', init):
                raise installer.InstallError('无法暂停旧升级服务')
            if init == 'systemd':
                installer.run(['systemctl', 'daemon-reload'])
                installer.run(['systemctl', 'enable', 'localdns-updater'])
                installer.run(['systemctl', 'restart', 'localdns-updater'])
                installer.run(['systemctl', 'is-active', '--quiet', 'localdns-updater'])
            else:
                installer.run(['rc-update', 'add', 'localdns-updater', 'default'])
                installer.run(['rc-service', 'localdns-updater', 'restart'])
                installer.run(['rc-service', 'localdns-updater', 'status'])
            for attempt in range(20):
                try:
                    probe = installer.local_json(args.port, '/upgrade')
                    break
                except OSError:
                    if attempt == 19: raise
                    time.sleep(.25)
            if probe.get('protocol') != 'localdns-updater/v2':
                raise installer.InstallError('独立升级服务验收失败')
            if old_running:
                command = ['rc-update', 'del', 'localdns-ui-updater', 'default'] if init == 'openrc' else ['systemctl', 'disable', 'localdns-ui-updater']
                installer.run(command)
        except Exception:
            with contextlib.suppress(Exception):
                installer.run(['rc-service', 'localdns-updater', 'stop'] if init == 'openrc' else ['systemctl', 'stop', 'localdns-updater'])
            if old_running:
                updater('start', init)
            raise
    with installer.locked(root):
        site.write_text(configure_script(before.decode('utf-8'), public), encoding='utf-8')
    print('独立升级服务已' + ('准备' if stage else '启用') + '：' + public)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (installer.InstallError, OSError, ValueError) as error:
        print('安装未完成：' + str(error), file=sys.stderr)
        raise SystemExit(1)
