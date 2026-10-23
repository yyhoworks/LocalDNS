"""Exercise service installation in a temporary staging root without starting services.

Installer contract (as implemented by install-proxy-config.sh): the
arguments are ``origin [port] [host]``. Without a host argument the service
keeps the loopback listen address 127.0.0.1; passing a non-loopback host
rewrites listen/hosts to that host. On first install the script always
generates a random access token into the configuration's ``token`` field.
"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile

from package_ui import verify_manifest

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shell', default=shutil.which('sh'))
    args = parser.parse_args()
    if not args.shell:
        parser.error('Provide a POSIX shell using --shell')
    version = json.loads((ROOT / 'VERSION.json').read_text(encoding='utf-8'))
    archive = ROOT / 'dist' / version['releaseTag'] / ('LocalDNS_ProxyConfig_UI_' + version['uiVersion'] + '_Service.zip')
    with ZipFile(archive) as source:
        payload = {name: source.read(name) for name in source.namelist()}
    verify_manifest(payload)
    shell = Path(args.shell)

    def posix(path):
        if os.name == 'nt':
            helper = shell.parent / 'cygpath.exe'
            if helper.exists():
                return subprocess.check_output([str(helper), '-u', str(path)], encoding='utf-8').strip()
            return subprocess.check_output([str(shell), '-c', 'cygpath -u "$1"', 'cygpath', str(path)], encoding='utf-8').strip()
        return str(path)

    with tempfile.TemporaryDirectory(prefix='service-installer-test-', dir=ROOT / 'dist') as name:
        temporary = Path(name).resolve()
        assert temporary.parent == (ROOT / 'dist').resolve()
        package = temporary / 'package'
        package.mkdir()
        for relative, data in payload.items():
            destination = package / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        script = posix(package / 'install-proxy-config.sh')
        subprocess.run([str(shell), '-n', script], check=True, capture_output=True)
        checked = 0
        for arch in ('amd64', 'arm64'):
            stage = temporary / arch
            stage.mkdir()
            environment = dict(os.environ, DESTDIR=posix(stage), LOCALDNS_PROXY_CONFIG_ARCH=arch)
            if os.name == 'nt':
                environment['PATH'] = str(shell.parent) + os.pathsep + os.environ.get('PATH', '')

            def install(origin, succeeds=True, port=None, host=None):
                arguments = [str(shell), script, origin]
                if port is not None or host is not None:
                    arguments.append(str(port if port is not None else 9098))
                if host is not None:
                    arguments.append(str(host))
                result = subprocess.run(arguments, env=environment,
                                        capture_output=True, encoding='utf-8')
                if succeeds and result.returncode:
                    raise RuntimeError(result.stderr + result.stdout)
                if not succeeds and result.returncode == 0:
                    raise RuntimeError('Invalid origin accepted')

            install('http://10.0.0.2:9099')
            config_path = stage / 'etc/localdns-proxy-config.json'
            config = json.loads(config_path.read_text(encoding='utf-8'))
            assert config['listen'] == '127.0.0.1:9098'
            assert config['origins'] == ['http://10.0.0.2:9099']
            assert config['hosts'] == ['127.0.0.1:9098']
            generated = config.get('token', '')
            assert len(generated) == 64 and all(c in '0123456789abcdef' for c in generated)
            binary = stage / 'opt/localdns-proxy-config/bin/localdns-proxy-config'
            assert binary.read_bytes() == payload['bin/localdns-proxy-config-linux-' + arch]
            config['cores']['mihomo']['postReload'] = ['/opt/example/post-reload.sh']
            config_path.write_text(json.dumps(config), encoding='utf-8')
            saved = config_path.read_bytes()
            install('http://10.0.0.3:9099')
            assert config_path.read_bytes() == saved
            backups = list((stage / 'opt/localdns-proxy-config/backups').glob('install-*/localdns-proxy-config.binary'))
            assert len(backups) == 1 and backups[0].read_bytes() == binary.read_bytes()
            assert (stage / 'etc/init.d/localdns-proxy-config').exists()
            assert (stage / 'etc/systemd/system/localdns-proxy-config.service').exists()
            checked += 1
            for invalid in ('http://user:password@10.0.0.2:9099', 'http://10.0.0.2:9099/ui/',
                            'http://10.0.0.2:65536', 'http://10.0.0.2:0',
                            'http://10.0.0.2:9099?x=1', 'http://10.0.0.2;echo-bad:9099'):
                install(invalid, succeeds=False)
                assert config_path.read_bytes() == saved
                checked += 1
            for port in ('0', '65536', 'invalid'):
                install('http://10.0.0.2:9099', succeeds=False, port=port)
                assert config_path.read_bytes() == saved
                checked += 1
            lan_stage = temporary / (arch + '-lan')
            lan_stage.mkdir()
            environment['DESTDIR'] = posix(lan_stage)
            install('http://10.0.0.2:9099', host='10.0.0.2')
            lan = json.loads((lan_stage / 'etc/localdns-proxy-config.json').read_text(encoding='utf-8'))
            assert lan['listen'] == '10.0.0.2:9098'
            assert lan['hosts'] == ['10.0.0.2:9098']
            lan_token = lan.get('token', '')
            assert len(lan_token) == 64 and all(c in '0123456789abcdef' for c in lan_token)
            checked += 1
            custom_stage = temporary / (arch + '-custom')
            custom_stage.mkdir()
            environment['DESTDIR'] = posix(custom_stage)
            install('http://10.0.0.2:9099', port=9198, host='10.0.0.2')
            custom = json.loads((custom_stage / 'etc/localdns-proxy-config.json').read_text(encoding='utf-8'))
            assert custom['listen'] == '10.0.0.2:9198'
            assert custom['hosts'] == ['10.0.0.2:9198']
            custom_token = custom.get('token', '')
            assert len(custom_token) == 64 and all(c in '0123456789abcdef' for c in custom_token)
            checked += 1
        print(json.dumps({'stagingChecks': checked, 'platforms': ['amd64', 'arm64'],
                          'configurationAndHooksPreserved': True, 'backupBinaryNotOverwritten': True,
                          'servicesStarted': False}))


if __name__ == '__main__':
    main()
