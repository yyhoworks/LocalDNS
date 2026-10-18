"""Exercise service installation in a temporary staging root without starting services."""
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
            return subprocess.check_output([str(helper), '-u', str(path)], encoding='utf-8').strip()
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

            def install(origin, succeeds=True):
                result = subprocess.run([str(shell), script, origin], env=environment,
                                        capture_output=True, encoding='utf-8')
                if succeeds and result.returncode:
                    raise RuntimeError(result.stderr + result.stdout)
                if not succeeds and result.returncode == 0:
                    raise RuntimeError('Invalid origin accepted')

            install('http://10.0.0.2:9099')
            config_path = stage / 'etc/localdns-proxy-config.json'
            config = json.loads(config_path.read_text(encoding='utf-8'))
            assert config['listen'] == '10.0.0.2:9098'
            assert config['origins'] == ['http://10.0.0.2:9099']
            assert config['hosts'] == ['10.0.0.2:9098']
            assert not any(key.startswith('auth') for key in config)
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
        print(json.dumps({'stagingChecks': checked, 'platforms': ['amd64', 'arm64'],
                          'configurationAndHooksPreserved': True, 'backupBinaryNotOverwritten': True,
                          'servicesStarted': False}))


if __name__ == '__main__':
    main()
