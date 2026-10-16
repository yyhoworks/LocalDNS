"""Build UI updates and optionally a full package from a verified published ZIP."""
import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def verify_manifest(payload):
    manifest = dict(line.split('  ', 1)[::-1]
                    for line in payload['MANIFEST.sha256'].decode().splitlines())
    expected = {name: sha(data) for name, data in payload.items()
                if name != 'MANIFEST.sha256' and not name.endswith('/')}
    if manifest != expected:
        raise ValueError('Manifest does not match every packaged file')


def write_archive(path, payload, version, modes=None):
    modes = modes or {}
    payload = dict(payload)
    payload.pop('MANIFEST.sha256', None)
    payload['MANIFEST.sha256'] = ''.join(
        f'{sha(data)}  {name}\n' for name, data in sorted(payload.items())
        if not name.endswith('/')).encode()
    verify_manifest(payload)
    stamp = datetime.fromisoformat(version['builtAt']).timetuple()[:6]
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            info = ZipInfo(name, date_time=stamp)
            info.create_system = 3
            info.compress_type = ZIP_DEFLATED
            mode = modes.get(name, 0o40755 if name.endswith('/') else
                             0o100755 if name.endswith('.sh') else 0o100644)
            info.external_attr = mode << 16
            if name.endswith('/'):
                info.external_attr |= 0x10
            archive.writestr(info, data)
    with ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('ZIP CRC verification failed')
        actual = {name: archive.read(name) for name in archive.namelist()}
        if actual != payload:
            raise RuntimeError('ZIP contents differ from source payload')
        verify_manifest(actual)
        for info in archive.infolist():
            if info.filename.endswith('.sh') or '/bin/' in info.filename or info.filename.startswith('LocalDNS_FJG4O_Binaries/localdns-'):
                if not info.is_dir() and not (info.external_attr >> 16) & 0o111:
                    raise RuntimeError('Executable permission missing: ' + info.filename)
    return sha(path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--full-base', type=Path, help='Previously published FJG4O full ZIP')
    parser.add_argument('--base-sha256', help='SHA-256 verified against the published Release')
    args = parser.parse_args()
    if bool(args.full_base) != bool(args.base_sha256):
        parser.error('--full-base and --base-sha256 must be supplied together')

    version = json.loads((ROOT / 'VERSION.json').read_text(encoding='utf-8'))
    if json.loads((ROOT / '_src/ui/version.json').read_text(encoding='utf-8')) != version:
        raise ValueError('Root and UI version metadata differ')
    ui = {file.relative_to(ROOT / '_src/ui').as_posix(): file.read_bytes()
          for file in sorted((ROOT / '_src/ui').rglob('*')) if file.is_file()}
    common = {name: (ROOT / name).read_bytes() for name in
              ['AUTHORS.md', 'THIRD_PARTY_NOTICES.md', 'INSTALL.md', 'CHANGELOG.md']}
    common['README.md'] = common['INSTALL.md']
    common['VERSION.txt'] = f"LocalDNS UI {version['uiVersion']}\nBackend {version['backendVersion']}\n".encode()
    for file in (ROOT / 'docs/licenses').rglob('*'):
        if file.is_file():
            common[file.relative_to(ROOT).as_posix()] = file.read_bytes()
    release_notes = ROOT / 'docs/releases' / f"ui-v{version['uiVersion']}.md"
    if release_notes.exists():
        common['RELEASE_NOTES.md'] = release_notes.read_bytes()
    update = dict(common)
    update['THIRD_PARTY_NOTICES.md'] = common['THIRD_PARTY_NOTICES.md'].replace(b'%5Fsrc/ui/', b'ui/').replace(b'_src/ui/', b'ui/')
    update.update({'ui/' + name: data for name, data in ui.items()})
    update['install-ui.sh'] = (ROOT / 'tools/install-ui.sh').read_bytes()
    update['release.json'] = json_bytes(dict(version, packageType='ui-update'))
    packages = [(f"LocalDNS_UI_{version['uiVersion']}_Update.zip", update, {})]

    if args.full_base:
        base_digest = sha(args.full_base.read_bytes())
        if base_digest != args.base_sha256.lower():
            raise ValueError('Published base archive SHA-256 mismatch')
        with ZipFile(args.full_base) as archive:
            if archive.testzip() is not None:
                raise ValueError('Base archive CRC failure')
            if len(archive.namelist()) != len(set(archive.namelist())):
                raise ValueError('Duplicate base archive paths')
            for info in archive.infolist():
                path = PurePosixPath(info.filename)
                if path.is_absolute() or '..' in path.parts or ':' in info.filename or '\\' in info.filename:
                    raise ValueError('Unsafe base archive path')
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Symlinks not allowed in base archive')
            base = {name: archive.read(name) for name in archive.namelist()}
            modes = {info.filename: info.external_attr >> 16 for info in archive.infolist()}
        verify_manifest(base)
        meta = json.loads(base['release.json'])
        binary_sha = sha(base['localdns/bin/localdns'])
        if meta['backendVersion'] != version['backendVersion'] or binary_sha != meta['backendBinarySha256']:
            raise ValueError('Backend version or binary hash mismatch')
        full = {name: data for name, data in base.items() if not name.startswith('localdns/ui/')}
        full.update(common)
        full['THIRD_PARTY_NOTICES.md'] = common['THIRD_PARTY_NOTICES.md'].replace(b'%5Fsrc/ui/', b'localdns/ui/').replace(b'_src/ui/', b'localdns/ui/')
        full.update({'localdns/ui/' + name: data for name, data in ui.items()})
        full['localdns/UI-VERSION'] = (version['uiVersion'] + '\n').encode()
        full['release.json'] = json_bytes(dict(
            version, packageType='full', baseArchive=args.full_base.name,
            baseArchiveSha256=base_digest, backendBinarySha256=binary_sha,
            configurationSource=meta['configurationSource'],
            templateCleanup=meta.get('templateCleanup', ''),
            uiFiles={name: sha(data) for name, data in ui.items()}))
        for name, data in base.items():
            protected = (name.startswith(('localdns/', 'LocalDNS_FJG4O_Binaries/'))
                         and not name.startswith('localdns/ui/') and name != 'localdns/UI-VERSION')
            if (protected or name == 'localdns.service') and full[name] != data:
                raise ValueError('Protected base content changed: ' + name)
        packages.append((f"LocalDNS_{version['backendVersion']}_UI_{version['uiVersion']}_Full.zip", full, modes))

    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    sums = []
    for name, payload, modes in packages:
        digest = write_archive(output / name, payload, version, modes)
        sums.append(f'{digest}  {name}\n')
        print(name, digest)
    (output / 'SHA256SUMS.txt').write_text(''.join(sorted(sums)), encoding='utf-8')


if __name__ == '__main__':
    main()
