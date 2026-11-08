"""Installer transactions run under a temporary root; no host service is started."""
import contextlib
import hashlib
import io
import json
import os
import re
import socket
import ssl
import stat
import struct
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

import install_localdns as installer
from package_ui import json_bytes, write_archive

ROOT = Path(__file__).resolve().parents[1]
VERSION = {'uiVersion': '2026.10.19.5', 'backendVersion': 'FJGAC',
           'builtAt': '2026-10-19T13:00:00+08:00'}


def elf(machine):
    value = bytearray(64)
    value[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', value, 18, machine)
    return bytes(value)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'dist').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='oneclick-test-', dir=ROOT / 'dist')
        self.base = Path(self.temp.name)
        self.packages = self.base / 'packages'
        self.packages.mkdir()
        self.stage = self.base / 'stage'
        self.stage.mkdir()
        self.root = self.stage / 'opt/localdns'
        self.ui = {'index.html': b'<html>new UI</html>', 'version.json': json_bytes(VERSION),
                   'config.js': b'window.LOCALDNS_UI_CONFIG={apiBase:""};\n'}
        self.config = {'api': {'http': '0.0.0.0:9099'},
                       'dns': {'udp_listen': ':53', 'tcp_listen': ':53'}}
        self.payload = {'localdns/config/localdns.json': json_bytes(self.config),
                        'localdns/config/upstreams/foreign_ecs.json': json_bytes({'ecs': '203.0.113.0'}),
                        'localdns/bin/localdns': elf(62), 'localdns/rules/manual/whitelist.txt': b'original rule\n'}
        self.payload.update({'localdns/ui/' + name: data for name, data in self.ui.items()})
        for arch, machine in [('amd64-v1', 62), ('amd64-v3', 62), ('arm64', 183)]:
            self.payload['LocalDNS_FJGAC_Binaries/localdns-' + arch] = elf(machine)
        self.archive('Full', self.payload, 'full')
        self.archive('Update', {'ui/' + k: v for k, v in self.ui.items()}, 'ui-update')
        self.refresh_sums()

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, suffix, payload, kind):
        name = 'LocalDNS_' + suffix + '_' + VERSION['uiVersion'] + '_' + suffix + '.zip'
        value = dict(payload, **{'release.json': json_bytes(dict(VERSION, packageType=kind))})
        modes = {name: 0o100755 for name in value if '/bin/' in name or name.startswith('LocalDNS_FJGAC_Binaries/')}
        write_archive(self.packages / name, value, VERSION, modes)
        return self.packages / name

    def refresh_sums(self):
        values = [hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name for p in self.packages.glob('*.zip')]
        (self.packages / 'SHA256SUMS.txt').write_text('\n'.join(sorted(values)) + '\n', encoding='utf-8')

    def install(self, *arguments):
        with contextlib.redirect_stdout(io.StringIO()):
            return installer.main(['--stage-root', str(self.stage), '--package-dir', str(self.packages),
                                   '--origin', 'http://192.0.2.2:19099', *arguments])

    def test_fresh_staging_selects_architecture_and_writes_units_and_ports(self):
        self.assertEqual(self.install('--arch', 'arm64', '--dns-port', '19553', '--http-port', '19099'), 0)
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), elf(183))
        config = json.loads((self.root / 'config/localdns.json').read_text())
        self.assertEqual(config['api']['http'], '0.0.0.0:19099')
        self.assertEqual(config['dns']['udp_listen'], ':19553')
        self.assertEqual(config['dns']['tcp_listen'], ':19553')
        ecs = json.loads((self.root / 'config/upstreams/foreign_ecs.json').read_text())
        self.assertEqual(ecs['ecs'], '203.0.113.0')
        self.assertTrue(all('socks5' not in u for u in ecs['upstreams']))
        proxy = json.loads((self.root / 'config/upstreams/proxy.json').read_text())
        self.assertTrue(all('socks5' not in u and not u['addr'].startswith('127.') for u in proxy['upstreams']))
        self.assertIn('/opt/localdns/bin/localdns --root /opt/localdns',
                      (self.stage / 'etc/systemd/system/localdns.service').read_text())
        self.assertTrue((self.stage / 'etc/init.d/localdns').is_file())

    def test_auto_ui_update_preserves_core_rules_dns_and_site_config(self):
        self.install('--arch', 'amd64-v1')
        site = self.root / 'ui/config.js'
        site.write_bytes(b'private site API settings\n')
        shared = self.root / 'ui/custom/settings.json'
        shared.parent.mkdir()
        shared.write_bytes(b'{"version":1,"name":"shared"}\n')
        font = shared.parent / 'fonts/keep.woff2'
        font.parent.mkdir()
        font.write_bytes(b'private font bytes')
        (self.root / 'bin/localdns').write_bytes(b'existing kernel')
        protected = {p: p.read_bytes() for p in [site, shared, font, self.root / 'bin/localdns',
                     self.root / 'config/localdns.json', self.root / 'rules/manual/whitelist.txt']}
        self.install('--arch', 'amd64-v1')
        for path, data in protected.items():
            self.assertEqual(path.read_bytes(), data)
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), self.ui['index.html'])
        self.assertEqual(len(list(self.root.glob('ui-backup-*.tar.gz'))), 1)
        self.assertEqual(len(list(self.root.glob('ui.previous-*'))), 1)
        self.install('--arch', 'amd64-v1')
        self.assertEqual(len(list(self.root.glob('ui-backup-*.tar.gz'))), 2)

    def updater_payload(self, omit=()):
        names = installer.UPDATER_SETUP_FILES
        files = {'ui-updater/' + name: (ROOT / 'tools' / name).read_bytes() for name in names if name not in omit}
        self.archive('Full', dict(self.payload, **files), 'full')
        self.archive('Update', dict({'ui/' + name: value for name, value in self.ui.items()}, **files), 'ui-update')
        self.refresh_sums()

    def test_real_oneclick_setup_installs_and_refreshes_all_updater_modules(self):
        self.updater_payload()
        self.install('--arch', 'amd64-v1', '--with-ui-updater')
        runtime = self.stage / 'opt/localdns-updater'
        for name in ('core_upload.py', 'online_updater.py', 'fjgli_config.py', 'upgrade_localdns.py'):
            self.assertEqual((runtime / name).read_bytes(), (ROOT / 'tools' / name).read_bytes())
        state = self.stage / 'var/lib/localdns-updater'
        (state / 'state.json').write_text('{"state":"succeeded","previous":{"kind":"ui","name":"keep"}}')
        original = (self.root / 'bin/localdns').read_bytes()
        (runtime / 'core_upload.py').write_text('# old module\n')
        self.install('--arch', 'amd64-v1', '--with-ui-updater')
        self.assertEqual((runtime / 'core_upload.py').read_bytes(), (ROOT / 'tools/core_upload.py').read_bytes())
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), original)
        self.assertEqual(json.loads((state / 'state.json').read_text())['previous']['name'], 'keep')

    def test_missing_upload_module_is_rejected_before_installing_anything(self):
        self.updater_payload(omit=('core_upload.py',))
        with self.assertRaisesRegex(installer.InstallError, '网页升级执行端'):
            self.install('--arch', 'amd64-v1', '--with-ui-updater')
        self.assertFalse(self.root.exists())

    def test_oneclick_refresh_preserves_an_active_task_and_current_files(self):
        self.updater_payload()
        self.install('--arch', 'amd64-v1', '--with-ui-updater')
        state = self.stage / 'var/lib/localdns-updater/state.json'
        state.write_text('{"state":"awaiting_backup","jobId":"keep"}')
        protected = {p: p.read_bytes() for p in [state, self.root / 'ui/index.html', self.root / 'bin/localdns']}
        with self.assertRaisesRegex(installer.InstallError, '已有升级任务'):
            self.install('--arch', 'amd64-v1', '--with-ui-updater')
        for path, value in protected.items():
            self.assertEqual(path.read_bytes(), value)

    def test_cross_core_ui_update_stops_before_creating_backups_or_changing_files(self):
        self.install('--arch', 'amd64-v1')
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(installer.InstallError, '不同的 DNS 核心'):
            installer.update_ui(self.root, self.base / 'unused-payload', dict(VERSION, backendVersion='FJGLI'), self.stage)
        self.assertEqual({p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}, before)

    def test_checksum_failure_makes_no_installation(self):
        archive = next(self.packages.glob('*_Full.zip'))
        archive.write_bytes(archive.read_bytes() + b'changed')
        with self.assertRaisesRegex(installer.InstallError, 'SHA-256'):
            self.install('--arch', 'amd64-v1')
        self.assertFalse(self.root.exists())

    def test_low_disk_space_is_rejected_before_installation(self):
        with patch.object(installer.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 0})()):
            with self.assertRaisesRegex(installer.InstallError, '磁盘空间不足'):
                self.install('--arch', 'amd64-v1')
        self.assertFalse(self.root.exists())
        self.assertFalse(list(self.root.parent.glob('.localdns-work-*')))

    def test_nonempty_unrecognized_target_is_preserved(self):
        self.root.mkdir(parents=True)
        (self.root / 'important').write_text('keep')
        with self.assertRaisesRegex(installer.InstallError, '空目录'):
            self.install('--arch', 'amd64-v1')
        self.assertEqual((self.root / 'important').read_text(), 'keep')

    def test_path_rejections(self):
        for value in ['/', '/opt', '/usr/local', '/etc/init.d', '/opt/../etc', 'relative', '/opt/bad path']:
            with self.subTest(value=value), self.assertRaises(installer.InstallError):
                installer.install_path(value, self.stage)

    def test_origin_and_architecture_rejections(self):
        for value in ['file:///tmp/x', 'http://user:pass@host', 'http://host/ui/', 'http://host:0',
                      'http://host:65536', 'http://host?x=1']:
            with self.subTest(value=value), self.assertRaises(installer.InstallError):
                installer.origin(value, 9099)
        self.assertEqual(installer.choose_arch('x86_64'), 'amd64-v1')
        self.assertEqual(installer.choose_arch('amd64-v2'), 'amd64-v2')
        self.assertEqual(installer.choose_arch('aarch64'), 'arm64')
        self.assertEqual(installer.origin('http://example.com:80', 9099), 'http://example.com')
        self.assertEqual(installer.origin('https://example.com:443', 9099), 'https://example.com')
        with self.assertRaises(installer.InstallError):
            installer.choose_arch('armv7l')

    def test_ui_failure_restores_previous_directory(self):
        self.install('--arch', 'amd64-v1')
        (self.root / 'ui/index.html').write_bytes(b'old UI')
        out = self.base / 'unpacked'
        installer.extract_verified(next(self.packages.glob('*_Update.zip')), out)
        with patch.object(installer, 'local_json', side_effect=[{'running': True}, {'uiVersion': 'unexpected'}]):
            with self.assertRaisesRegex(installer.InstallError, '版本校验失败'):
                installer.update_ui(self.root, out, VERSION)
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), b'old UI')
        self.assertEqual(len(list(self.root.glob('ui.failed-*'))), 1)

    def test_fresh_start_failure_stops_service_and_retains_failed_files(self):
        out = self.base / 'unpacked'
        installer.extract_verified(next(self.packages.glob('*_Full.zip')), out)
        with patch.object(installer, 'manage') as manage, patch.object(installer, 'time') as clock:
            with patch.object(installer, 'local_json', side_effect=OSError('offline')):
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(installer.InstallError):
                    installer.install_new(self.root, '/opt/localdns', out, VERSION, 'amd64-v1',
                                          19553, 19099, 'systemd', self.stage)
        self.assertIn(('stop', 'systemd'), [c.args for c in manage.call_args_list])
        self.assertIn(('disable', 'systemd'), [c.args for c in manage.call_args_list])
        self.assertFalse((self.stage / 'etc/systemd/system/localdns.service').exists())
        self.assertFalse(self.root.exists())
        self.assertEqual(len(list(self.root.parent.glob('localdns.failed-*'))), 1)

    def test_lock_prevents_concurrent_installs(self):
        with installer.locked(self.root):
            with self.assertRaisesRegex(installer.InstallError, '安装任务'):
                with installer.locked(self.root):
                    self.fail('acquired a second lock')
        self.assertFalse((self.root.parent / '.localdns-installer.lock').exists())

    def test_alpine_service_loads_compatibility_from_permanent_install_path(self):
        files = installer.service_files('/opt/custom-dns', alpine_compat=True)
        self.assertIn('Environment=LD_PRELOAD=/opt/custom-dns/bin/localdns-compat.so\nExecStart=',
                      files['etc/systemd/system/localdns.service'])
        self.assertIn('export LD_PRELOAD="/opt/custom-dns/bin/localdns-compat.so"\ndepend()',
                      files['etc/init.d/localdns'])
        self.assertNotIn('LD_PRELOAD', installer.service_files('/opt/localdns')['etc/init.d/localdns'])

    def test_port_conflict_is_reported(self):
        with socket.socket() as stream:
            if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
                stream.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            stream.bind(('0.0.0.0', 0))
            stream.listen()
            with self.assertRaisesRegex(installer.InstallError, '端口已占用'):
                installer.check_ports(stream.getsockname()[1], stream.getsockname()[1])

    def test_unsafe_and_unlisted_zip_entries_are_rejected(self):
        for name, mode in [('../outside', 0o100644), ('/absolute', 0o100644),
                           ('C:/windows', 0o100644), ('link', stat.S_IFLNK | 0o777)]:
            archive = self.base / 'unsafe.zip'
            with ZipFile(archive, 'w') as z:
                info = ZipInfo(name)
                info.external_attr = mode << 16
                z.writestr(info, b'data')
            with self.subTest(name=name), self.assertRaises(installer.InstallError):
                installer.extract_verified(archive, self.base / 'unsafe-output')
        archive = self.base / 'unlisted.zip'
        with ZipFile(archive, 'w') as z:
            z.writestr('MANIFEST.sha256', '')
            z.writestr('unlisted', b'data')
        with self.assertRaisesRegex(installer.InstallError, '覆盖全部文件'):
            installer.extract_verified(archive, self.base / 'unlisted-output')

    def test_package_verification_accepts_fjh21_backend(self):
        version = dict(VERSION, backendVersion='FJH21')
        archive = self.base / 'fjh21-update.zip'
        write_archive(archive, {'ui/index.html': b'<html>new UI</html>',
                                'release.json': json_bytes(dict(version, packageType='ui-update'))},
                      version)
        metadata = installer.extract_verified(archive, self.base / 'fjh21-output')
        self.assertEqual(metadata['backendVersion'], 'FJH21')
        rejected = self.base / 'bad-backend.zip'
        write_archive(rejected, {'ui/index.html': b'<html>new UI</html>',
                                 'release.json': json_bytes(dict(version, packageType='ui-update',
                                                                  backendVersion='XJGOE'))},
                      version)
        with self.assertRaisesRegex(installer.InstallError, '核心版本无效'):
            installer.extract_verified(rejected, self.base / 'bad-backend-output')

    def test_bootstrap_pins_the_engine_hash(self):
        script = (ROOT / 'tools/install.sh').read_text(encoding='utf-8')
        pinned = re.search(r'^ENGINE_SHA256=([a-f0-9]{64})$', script, re.M)
        self.assertIsNotNone(pinned)
        self.assertEqual(pinned.group(1), hashlib.sha256((ROOT / 'tools/install_localdns.py').read_bytes()).hexdigest())

    def release_fetch(self, corrupt=False):
        def fetch(url, destination=None):
            if url.startswith(installer.API):
                raise installer.GitHubRateLimitError('fixture API rate limit')
            self.assertTrue(url.startswith(installer.REPO + '/releases/download/fjgac-ui-v2026.10.19.5/'))
            data = (self.packages / url.rsplit('/', 1)[1]).read_bytes()
            destination.write_bytes(data + (b'corrupt' if corrupt and url.endswith('.zip') else b''))
        return fetch

    def test_known_tag_uses_release_downloads_when_api_is_rate_limited(self):
        work = self.base / 'download'; work.mkdir()
        with patch.object(installer, 'fetch', side_effect=self.release_fetch()) as fetch:
            packages = installer.Packages(work, 'fjgac-ui-v2026.10.19.5')
            extracted, metadata = packages.get('ui')
        self.assertEqual(metadata['uiVersion'], VERSION['uiVersion'])
        self.assertEqual((extracted / 'ui/index.html').read_bytes(), self.ui['index.html'])
        self.assertEqual(fetch.call_count, 3)

    def test_rate_limit_fallback_still_rejects_corrupt_archives_and_unsafe_manifests(self):
        work = self.base / 'download'; work.mkdir()
        with patch.object(installer, 'fetch', side_effect=self.release_fetch(corrupt=True)):
            packages = installer.Packages(work, 'fjgac-ui-v2026.10.19.5')
            with self.assertRaisesRegex(installer.InstallError, 'SHA-256'):
                packages.get('ui')
        (self.packages / 'SHA256SUMS.txt').write_text('a' * 64 + '  ../evil.zip\n')
        with patch.object(installer, 'fetch', side_effect=self.release_fetch()):
            with self.assertRaises(installer.InstallError):
                installer.Packages(work, 'fjgac-ui-v2026.10.19.5')

    def test_latest_and_prerelease_tags_do_not_guess_a_release_during_rate_limit(self):
        for tag in [None, 'fjgac-ui-v2026.10.19.5-beta', 'main']:
            with self.subTest(tag=tag), patch.object(installer, 'fetch', side_effect=installer.GitHubRateLimitError('limited')) as fetch:
                with self.assertRaises(installer.GitHubRateLimitError):
                    installer.Packages(self.base, tag)
                self.assertEqual(fetch.call_count, 1)

    def test_permission_failure_does_not_trigger_rate_limit_fallback(self):
        with patch.object(installer, 'fetch', side_effect=installer.InstallError('HTTP 403')) as fetch:
            with self.assertRaisesRegex(installer.InstallError, 'HTTP 403'):
                installer.Packages(self.base, 'fjgac-ui-v2026.10.19.5')
            self.assertEqual(fetch.call_count, 1)

    def test_fetch_explains_rate_limit_reset_but_not_every_forbidden_response(self):
        url = installer.API + 'latest'
        for code, headers, body, expected in [
                (403, {'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1793538000'}, b'{}', installer.GitHubRateLimitError),
                (429, {'Retry-After': '120'}, b'{}', installer.GitHubRateLimitError),
                (403, {}, b'{"message":"API rate limit exceeded"}', installer.GitHubRateLimitError),
                (403, {}, b'{"message":"Forbidden"}', installer.InstallError)]:
            with self.subTest(code=code, headers=headers), patch.object(installer, 'build_opener') as build:
                build.return_value.open.side_effect = HTTPError(url, code, 'fixture', headers, io.BytesIO(body))
                with self.assertRaises(expected) as caught:
                    installer.fetch(url)
                self.assertIs(type(caught.exception), expected)

    def test_download_failures_distinguish_timeout_certificates_dns_and_gateway(self):
        url = 'https://github.com/yyhoworks/LocalDNS/releases/download/tag/SHA256SUMS.txt'
        cases = [
            (URLError(TimeoutError('fixture')), '超时', 'CA 证书'),
            (TimeoutError('fixture'), '超时', 'CA 证书'),
            (URLError(ssl.SSLCertVerificationError(1, 'fixture')), '证书校验失败', '下载连接或读取超时'),
            (URLError(socket.gaierror(-2, 'fixture')), '域名解析失败', 'CA 证书'),
            (HTTPError(url, 504, 'fixture', {}, io.BytesIO()), 'HTTP 504', 'CA 证书'),
        ]
        for failure, expected, unwanted in cases:
            with self.subTest(failure=failure), patch.object(installer, 'build_opener') as build:
                build.return_value.open.side_effect = failure
                with self.assertRaises(installer.InstallError) as error:
                    installer.fetch(url)
                self.assertIn(expected, str(error.exception))
                self.assertNotIn(unwanted, str(error.exception))
                self.assertIn(url, str(error.exception))


if __name__ == '__main__':
    unittest.main()
