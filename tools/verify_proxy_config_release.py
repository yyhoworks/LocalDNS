"""Verify the UI, clean full package and optional local configuration service archive."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

from package_ui import verify_manifest

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    with ZipFile(path) as archive:
        if archive.testzip() or len(archive.namelist()) != len(set(archive.namelist())):
            raise RuntimeError('Archive CRC failure or duplicate entries')
        for entry in archive.infolist():
            part = PurePosixPath(entry.filename)
            if part.is_absolute() or '..' in part.parts or ':' in entry.filename or '\\' in entry.filename:
                raise RuntimeError('Unsafe archive path')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError('Unexpected archive symbolic link')
        payload = {name: archive.read(name) for name in archive.namelist()}
        verify_manifest(payload)
        return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--base-sha256', required=True)
    parser.add_argument('--write-record', action='store_true')
    args = parser.parse_args()
    version = json.loads((ROOT / 'VERSION.json').read_text(encoding='utf-8'))
    directory = ROOT / 'dist' / version['releaseTag']
    base_sha = hashlib.sha256(args.base.read_bytes()).hexdigest()
    if base_sha != args.base_sha256:
        raise RuntimeError('Published base hash mismatch')
    base = load(args.base)
    source_ui = {file.relative_to(ROOT / '_src/ui').as_posix(): file.read_bytes()
                 for file in (ROOT / '_src/ui').rglob('*') if file.is_file()}
    sums = dict(line.split('  ', 1)[::-1] for line in (directory / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines())
    expected = {'LocalDNS_FJGAC_UI_' + version['uiVersion'] + '_Full.zip',
                'LocalDNS_UI_' + version['uiVersion'] + '_Update.zip',
                'LocalDNS_ProxyConfig_UI_' + version['uiVersion'] + '_Service.zip'}
    if set(sums) != expected or {p.name for p in directory.glob('*.zip')} != expected:
        raise RuntimeError('Expected exactly three release archives')
    packages = {}
    for name in sorted(expected):
        path = directory / name
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != sums[name]:
            raise RuntimeError('Release hash mismatch: ' + name)
        payload = load(path)
        if json.loads(payload['release.json'])['uiVersion'] != version['uiVersion']:
            raise RuntimeError('Wrong package version')
        if name.endswith('_Service.zip'):
            for relative in ('README.md', 'install-proxy-config.sh', 'config.example.json',
                             'localdns-proxy-config.initd', 'localdns-proxy-config.service'):
                if payload[relative] != (ROOT / 'services/proxy-config' / relative).read_bytes():
                    raise RuntimeError('Service archive differs from source')
            metadata = json.loads(payload['release.json'])
            for arch, spec in metadata['binaries'].items():
                binary = payload['bin/localdns-proxy-config-' + arch.replace('/', '-')]
                if hashlib.sha256(binary).hexdigest() != spec['sha256']:
                    raise RuntimeError('Service binary checksum mismatch')
        else:
            prefix = 'localdns/ui/' if name.endswith('_Full.zip') else 'ui/'
            actual = {key.removeprefix(prefix): value for key, value in payload.items() if key.startswith(prefix)}
            if actual != source_ui:
                raise RuntimeError('Packaged UI differs from current source')
            if payload['INSTALL.md'] != (ROOT / 'INSTALL.md').read_bytes():
                raise RuntimeError('Outdated installation instructions')
            if payload['RELEASE_NOTES.md'] != (ROOT / 'docs/releases' / (version['releaseTag'] + '.md')).read_bytes():
                raise RuntimeError('Outdated release notes')
            if name.endswith('_Full.zip'):
                for key, value in base.items():
                    protected = key == 'localdns.service' or key.startswith('LocalDNS_FJGAC_Binaries/') or (
                        key.startswith('localdns/') and not key.startswith('localdns/ui/') and key != 'localdns/UI-VERSION')
                    if protected and payload.get(key) != value:
                        raise RuntimeError('Full package changed a protected kernel/config/rule file')
        packages[name] = {'bytes': path.stat().st_size, 'sha256': sha, 'manifestVerified': True, 'crcVerified': True}
    record = {'packages': packages, 'baseArchive': {'name': args.base.name, 'sha256': base_sha,
              'matchesPublishedAsset': True}, 'kernelConfigurationAndRulesUnchanged': True,
              'uiFilesMatched': len(source_ui),
              'arm64RuntimeVerified': False}
    if args.write_record:
        target = ROOT / 'docs/validation' / ('fjgac-' + version['uiVersion'] + '.json')
        target.parent.mkdir(parents=True, exist_ok=True)
        data = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {
            'uiVersion': version['uiVersion'], 'backendVersion': version['backendVersion']}
        data.update(record)
        data.setdefault('scope', 'Verified release archive contents')
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False))


if __name__ == '__main__':
    main()
