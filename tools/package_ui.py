"""Build UI updates and optionally a full package from a verified published ZIP."""
import argparse
import hashlib
import json
import re
import struct
from datetime import datetime
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def read_built_ui(directory, version, source_root=ROOT):
    """Require a complete, current Vite build; never package a partial source tree."""
    if not (directory / 'build-meta.json').is_file():
        raise ValueError('Built UI is missing. Run npm ci --prefix frontend and npm run --prefix frontend build')
    ui = {}
    for file in sorted(directory.rglob('*')):
        if file.is_symlink():
            raise ValueError('Symlinks not allowed in built UI')
        if file.is_file():
            ui[file.relative_to(directory).as_posix()] = file.read_bytes()
    metadata = json.loads(ui['build-meta.json'])
    if metadata.get('schema') != 1 or metadata.get('version') != version:
        raise ValueError('Built UI version metadata is stale')
    if json.loads(ui.get('version.json', b'null')) != version:
        raise ValueError('Built UI version.json is stale')
    if metadata.get('files') != {name: sha(data) for name, data in ui.items() if name != 'build-meta.json'}:
        raise ValueError('Built UI integrity check failed; rebuild the frontend')
    inputs = metadata.get('inputs')
    if not isinstance(inputs, dict) or not inputs or not metadata.get('sourceDigest'):
        raise ValueError('Built UI input manifest is missing')
    actual_inputs = set()
    for folder in ['frontend/src', '_src/ui']:
        for file in (source_root / folder).rglob('*'):
            if file.is_symlink():
                raise ValueError('Symlinks not allowed in frontend inputs')
            if file.is_file():
                actual_inputs.add(file.relative_to(source_root).as_posix())
    actual_inputs.update(['frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json',
                          'frontend/vite.config.ts', 'frontend/tsconfig.json', 'frontend/scripts/build-integrity.ts', 'frontend/scripts/build-inputs.mjs', 'VERSION.json'])
    if set(inputs) != actual_inputs:
        raise ValueError('Built UI inputs changed; rebuild the frontend')
    for name, expected in inputs.items():
        # Only paths in the enumerated source set are read.
        file = source_root / name
        if not file.is_file() or sha(file.read_bytes()) != expected:
            raise ValueError('Built UI source is stale: ' + name)
    if not re.search(rb'assets/app-[A-Za-z0-9_-]+\.js', ui.get('index.html', b'')):
        raise ValueError('Built UI entry must reference the hashed app')
    return ui


def read_kernel_bundle(archive, backend):
    """Read only known ELF binaries, with or without the upstream wrapper directory."""
    names = archive.namelist()
    if archive.testzip() is not None or len(names) != len(set(names)):
        raise ValueError('Invalid upstream kernel archive')
    for info in archive.infolist():
        path = PurePosixPath(info.filename)
        # ZipInfo may legitimately replace a legacy name via the Unicode Path extra field.
        if '\0' in info.orig_filename or (info.filename != info.orig_filename and info.orig_filename.replace(chr(92), '/') == info.filename):
            raise ValueError('Unsafe upstream kernel archive path')
        if path.is_absolute() or '..' in path.parts or ':' in info.filename or '\\' in info.filename:
            raise ValueError('Unsafe upstream kernel archive path')
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('Symlinks not allowed in kernel archive')
    prefix = f'LocalDNS_{backend}_Binaries/'
    layouts = [prefix, prefix + f'localdns-{backend}/']
    anchors = [(name, directory) for directory in layouts for name in names
               if name == directory + 'localdns-amd64-v3' or name.endswith('/' + directory + 'localdns-amd64-v3')]
    if len(anchors) != 1:
        raise ValueError('Expected exactly one kernel binary directory')
    anchor, directory = anchors[0]
    wrapper = anchor[:-len(directory + 'localdns-amd64-v3')]
    suffix = prefix + 'localdns-amd64-v3'
    kernels = {}
    for platform, machine in [('amd64-v1', 62), ('amd64-v3', 62), ('arm64', 183)]:
        name = prefix + 'localdns-' + platform
        data = archive.read(wrapper + directory + 'localdns-' + platform)
        if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != machine:
            raise ValueError('Unexpected ELF architecture: ' + platform)
        kernels[name] = data
    default_paths = [wrapper + f'LocalDNS_{backend}/localdns/bin/localdns',
                     wrapper + 'localdns/bin/localdns',
                     wrapper + '保留原设置/localdns/bin/localdns',
                     wrapper + '不保留原设置/localdns/bin/localdns']
    defaults = [name for name in default_paths if name in names]
    if not defaults or any(archive.read(name) != kernels[suffix] for name in defaults):
        raise ValueError('Default binary differs from amd64-v3 or is missing')
    return kernels


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
            if info.filename.endswith('.sh') or '/bin/' in info.filename or re.match(r'LocalDNS_[A-Z0-9]+_Binaries/localdns-', info.filename):
                if not info.is_dir() and not (info.external_attr >> 16) & 0o111:
                    raise RuntimeError('Executable permission missing: ' + info.filename)
    return sha(path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ui-dir', type=Path, default=ROOT / 'dist/ui', help='Verified Vite UI build directory')
    parser.add_argument('--full-base', type=Path, help='Previously published full ZIP with clean default configuration')
    parser.add_argument('--base-sha256', help='SHA-256 verified against the published Release')
    parser.add_argument('--kernel-archive', type=Path, help='Upstream kernel ZIP; import only the three platform binaries')
    parser.add_argument('--kernel-sha256', help='SHA-256 of the separately verified upstream kernel archive')
    args = parser.parse_args()
    if bool(args.full_base) != bool(args.base_sha256):
        parser.error('--full-base and --base-sha256 must be supplied together')
    if bool(args.kernel_archive) != bool(args.kernel_sha256) or (args.kernel_archive and not args.full_base):
        parser.error('--kernel-archive requires --kernel-sha256 and a verified --full-base')

    version = json.loads((ROOT / 'VERSION.json').read_text(encoding='utf-8'))
    if json.loads((ROOT / '_src/ui/version.json').read_text(encoding='utf-8')) != version:
        raise ValueError('Root and UI version metadata differ')
    ui = read_built_ui(args.ui_dir.resolve(), version)
    common = {name: (ROOT / name).read_bytes() for name in
              ['AUTHORS.md', 'THIRD_PARTY_NOTICES.md', 'INSTALL.md', 'CHANGELOG.md']}
    common['README.md'] = common['INSTALL.md']
    common['configure-ui.py'] = (ROOT / 'tools/configure_ui.py').read_bytes()
    common['VERSION.txt'] = f"LocalDNS UI {version['uiVersion']}\nBackend {version['backendVersion']}\n".encode()
    for file in (ROOT / 'docs/licenses').rglob('*'):
        if file.is_file():
            common[file.relative_to(ROOT).as_posix()] = file.read_bytes()
    for name in ['docs/SHARED_UI.md', 'docs/ONECLICK.md',
                 'docs/validation/oneclick-installer-1.0.0.md',
                 'docs/validation/static-ui-2026.10.19.6.md',
                 'docs/validation/static-ui-cleanup-2026.10.19.7.md']:
        common[name] = (ROOT / name).read_bytes()
    release_tag = version.get('releaseTag', f"ui-v{version['uiVersion']}")
    if not re.fullmatch(r'[A-Za-z0-9._-]+', release_tag):
        raise ValueError('Invalid release tag')
    release_notes = ROOT / 'docs/releases' / (release_tag + '.md')
    if release_notes.exists():
        common['RELEASE_NOTES.md'] = release_notes.read_bytes()
    update = dict(common)
    update['THIRD_PARTY_NOTICES.md'] = common['THIRD_PARTY_NOTICES.md'].replace(b'%5Fsrc/ui/', b'ui/').replace(b'_src/ui/', b'ui/')
    update.update({'ui/' + name: data for name, data in ui.items()})
    update['install-ui.sh'] = (ROOT / 'tools/install-ui.sh').read_bytes()
    update['configure-ui.py'] = (ROOT / 'tools/configure_ui.py').read_bytes()
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
                if '\0' in info.orig_filename or (info.filename != info.orig_filename and info.orig_filename.replace(chr(92), '/') == info.filename):
                    raise ValueError('Unsafe base archive path')
                if path.is_absolute() or '..' in path.parts or ':' in info.filename or '\\' in info.filename:
                    raise ValueError('Unsafe base archive path')
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Symlinks not allowed in base archive')
            base = {name: archive.read(name) for name in archive.namelist()}
            modes = {info.filename: info.external_attr >> 16 for info in archive.infolist()}
        verify_manifest(base)
        meta = json.loads(base['release.json'])
        binary_sha = sha(base['localdns/bin/localdns'])
        if (not args.kernel_archive and meta['backendVersion'] != version['backendVersion']) or binary_sha != meta['backendBinarySha256']:
            raise ValueError('Backend version or binary hash mismatch')
        full = {name: data for name, data in base.items() if not name.startswith('localdns/ui/')}
        kernel_metadata = {}
        if args.kernel_archive:
            kernel_digest = sha(args.kernel_archive.read_bytes())
            if kernel_digest != args.kernel_sha256.lower():
                raise ValueError('Upstream kernel archive SHA-256 mismatch')
            backend = version['backendVersion']
            if not re.fullmatch(r'FJG[A-Z0-9]+', backend):
                raise ValueError('Invalid kernel version')
            kernel_prefix = f'LocalDNS_{backend}_Binaries/'
            with ZipFile(args.kernel_archive) as archive:
                kernels = read_kernel_bundle(archive, backend)
            # Do not import upstream UI, personal settings, subscriptions or rules.
            full = {name: data for name, data in full.items()
                    if not re.match(r'LocalDNS_[A-Z0-9]+_Binaries/', name)}
            full.update(kernels)
            for name in kernels:
                modes[name] = 0o100755
            full['localdns/bin/localdns'] = kernels[kernel_prefix + 'localdns-amd64-v3']
            modes['localdns/bin/localdns'] = 0o100755
            binary_sha = sha(full['localdns/bin/localdns'])
            kernel_metadata = {'kernelArchive': args.kernel_archive.name,
                               'kernelArchiveSha256': kernel_digest,
                               'kernelBinaries': {name: sha(data) for name, data in kernels.items()}}
        full.update(common)
        full['THIRD_PARTY_NOTICES.md'] = common['THIRD_PARTY_NOTICES.md'].replace(b'%5Fsrc/ui/', b'localdns/ui/').replace(b'_src/ui/', b'localdns/ui/')
        full.update({'localdns/ui/' + name: data for name, data in ui.items()})
        full['localdns/bin/configure-ui.py'] = (ROOT / 'tools/configure_ui.py').read_bytes()
        modes['localdns/bin/configure-ui.py'] = 0o100755
        full['localdns/UI-VERSION'] = (version['uiVersion'] + '\n').encode()
        full['release.json'] = json_bytes(dict(
            version, packageType='full', baseArchive=args.full_base.name,
            baseArchiveSha256=base_digest, backendBinarySha256=binary_sha,
            configurationSource=meta['configurationSource'],
            templateCleanup=meta.get('templateCleanup', ''),
            uiFiles={name: sha(data) for name, data in ui.items()}, **kernel_metadata))
        for name, data in base.items():
            protected = ((name.startswith('localdns/') or re.match(r'LocalDNS_[A-Z0-9]+_Binaries/', name))
                         and not name.startswith('localdns/ui/') and name not in ('localdns/UI-VERSION','localdns/bin/configure-ui.py'))
            if args.kernel_archive and (name == 'localdns/bin/localdns' or re.match(r'LocalDNS_[A-Z0-9]+_Binaries/', name)):
                protected = False
            if (protected or name == 'localdns.service') and full[name] != data:
                raise ValueError('Protected base content changed: ' + name)
        packages.append((f"LocalDNS_{version['backendVersion']}_UI_{version['uiVersion']}_Full.zip", full, modes))

    output = ROOT / 'dist' / release_tag if 'releaseTag' in version else ROOT / 'dist'
    output.mkdir(parents=True, exist_ok=True)
    sums = []
    for name, payload, modes in packages:
        digest = write_archive(output / name, payload, version, modes)
        sums.append(f'{digest}  {name}\n')
        print(name, digest)
    (output / 'SHA256SUMS.txt').write_text(''.join(sorted(sums)), encoding='utf-8')


if __name__ == '__main__':
    main()
