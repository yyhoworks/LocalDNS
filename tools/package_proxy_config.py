"""Build a portable local configuration service package with no device credentials."""
import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
from pathlib import Path

from package_ui import json_bytes, write_archive

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'services/proxy-config'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--go', default=shutil.which('go'), help='Go 1.27+ executable')
    args = parser.parse_args()
    if not args.go:
        parser.error('Specify a Go toolchain using --go')
    version = json.loads((ROOT / 'VERSION.json').read_text(encoding='utf-8'))
    output = ROOT / 'dist' / version['releaseTag']
    build = output / 'service-build'
    build.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, CGO_ENABLED='0', GOOS='linux', GOTOOLCHAIN='local')

    def go(*arguments, arch='amd64'):
        result = subprocess.run([args.go, *arguments], cwd=SOURCE,
                                env=dict(env, GOARCH=arch, GOAMD64='v1'),
                                check=True, capture_output=True, encoding='utf-8')
        return result.stdout.strip()

    go('mod', 'verify')
    payload = {name: (SOURCE / name).read_bytes() for name in
               ('README.md', 'config.example.json', 'localdns-proxy-config.initd',
                'localdns-proxy-config.service', 'install-proxy-config.sh', 'go.mod', 'go.sum')}
    modes = {'install-proxy-config.sh': 0o100755, 'localdns-proxy-config.initd': 0o100755}
    binaries = {}
    for arch, machine in [('amd64', 62), ('arm64', 183)]:
        name = 'localdns-proxy-config-linux-' + arch
        binary = build / name
        go('build', '-trimpath', '-buildvcs=false', '-ldflags', '-s -w', '-o', str(binary), '.', arch=arch)
        data = binary.read_bytes()
        if data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != machine:
            raise RuntimeError('Unexpected service ELF platform: ' + arch)
        payload['bin/' + name] = data
        modes['bin/' + name] = 0o100755
        binaries['linux/' + arch] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    goroot = Path(go('env', 'GOROOT'))
    yaml = Path(go('list', '-m', '-f', '{{.Dir}}', 'gopkg.in/yaml.v3'))
    payload['licenses/Go-LICENSE.txt'] = (goroot / 'LICENSE').read_bytes()
    payload['licenses/yaml-v3-LICENSE.txt'] = (yaml / 'LICENSE').read_bytes()
    payload['release.json'] = json_bytes(dict(version, packageType='proxy-config-service',
                                             serviceVersion='1.5.0', binaries=binaries))
    name = 'LocalDNS_ProxyConfig_UI_' + version['uiVersion'] + '_Service.zip'
    digest = write_archive(output / name, payload, version, modes)
    sums = output / 'SHA256SUMS.txt'
    lines = [line for line in sums.read_text(encoding='utf-8').splitlines() if not line.endswith('  ' + name)] if sums.exists() else []
    lines.append(digest + '  ' + name)
    sums.write_text('\n'.join(sorted(lines)) + '\n', encoding='utf-8')
    print(json.dumps({'package': name, 'sha256': digest, 'binaries': binaries}))


if __name__ == '__main__':
    main()
