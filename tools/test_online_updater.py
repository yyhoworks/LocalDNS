"""Three-mode filesystem transactions, persistent backup gate and HTTP restrictions."""
import json
import contextlib
import io
import shutil
import subprocess
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, ProxyHandler, build_opener

import install_localdns as installer
import install_online_updater as setup
import online_updater as online
import ui_updater as http
import upgrade_localdns as upgrade
from fjgli_config import hashes, read_json, write_json, MigrationError
from package_ui import write_archive
from test_core_upload import bundle, zipped, elf
import test_fjgli_upgrade as migration_fixtures


class OnlineTests(unittest.TestCase):
    def setUp(self):
        migration_fixtures.MigrationTests.setUp(self)
        self.root = self.old
        self.packages = self.work / 'packages'
        self.packages.mkdir()
        self.version = dict(uiVersion='2026.10.31.3', backendVersion='FJHAI', builtAt='2026-10-31T20:00:00+08:00',
                            releaseTag='fjhai-ui-v2026.10.31.3', updateCompatibility=online.CONTRACT)
        (self.root / 'ui').mkdir()
        (self.root / 'ui/index.html').write_bytes(b'old UI')
        (self.root / 'ui/config.js').write_bytes(b'private site config')
        write_json(self.root / 'ui/version.json', dict(self.version, uiVersion='2026.10.30.1', backendVersion='FJH7T'))
        self.original_factory = installer.Packages
        self.enterContext(patch.object(installer, 'local_json', side_effect=self.api))
        self.enterContext(patch.object(installer, 'Packages', side_effect=lambda work, tag: self.original_factory(work, directory=self.packages)))
        self.manager = self.manager_at()
        self.package()

    def api(self, _port, path):
        if path == '/ui/version.json':
            return read_json(self.root / 'ui/version.json')
        metadata = self.root / 'core-version.json'
        return {'version': read_json(metadata if metadata.exists() else self.root / 'ui/version.json')['backendVersion']}

    def manager_at(self):
        return online.OnlineUpdateManager(self.root, self.work / 'state', init='openrc', arch='amd64-v1', service_name='localdns-online-check')

    def package(self, version=None):
        version = version or self.version
        for path in self.packages.iterdir():
            path.unlink()
        for kind in ('full', 'ui-update'):
            prefix = 'localdns/' if kind == 'full' else ''
            metadata = dict(version, packageType=kind)
            payload = {prefix + 'ui/index.html': b'new UI', prefix + 'ui/config.js': b'default',
                       prefix + 'ui/version.json': json.dumps(version).encode(), 'release.json': json.dumps(metadata).encode()}
            if kind == 'full':
                payload.update({'localdns/config/localdns.json': b'{}', 'localdns/bin/localdns': b'new core',
                                'LocalDNS_' + version['backendVersion'] + '_Binaries/localdns-amd64-v1': b'new core'})
            name = 'LocalDNS_Test_' + ('Full' if kind == 'full' else 'Update') + '.zip'
            write_archive(self.packages / name, payload, metadata, {name: 0o100755 for name in payload if '/bin/' in name or 'Binaries/' in name})
        (self.packages / 'SHA256SUMS.txt').write_text(''.join(upgrade.sha(p) + '  ' + p.name + '\n' for p in self.packages.glob('*.zip')))

    def finish(self):
        self.manager.thread.join(10)
        self.assertFalse(self.manager.thread.is_alive())
        return self.manager.status()

    def prepare(self, mode='full'):
        self.manager.start(self.version['releaseTag'], mode=mode)
        result = self.finish()
        self.assertEqual(result['state'], 'awaiting_backup', result)
        return result

    def preflight(self, stage, *_ports):
        record = read_json(stage / upgrade.MARKER)
        record['preflight'] = {'stageFingerprint': upgrade.stage_fingerprint(stage)}
        write_json(stage / upgrade.MARKER, record)

    def continue_update(self):
        status = self.manager.status()
        self.manager.downloaded(status['jobId'])
        with patch.object(upgrade, 'preflight', side_effect=self.preflight), \
             patch.object(upgrade, 'updater', return_value=False), patch.object(upgrade, 'core_service'), \
             patch.object(upgrade.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(upgrade, 'verify', return_value={'ok': True}):
            self.manager.continue_job(status['jobId'], status['backup']['sha256'])
            return self.finish()

    def test_ui_changes_only_ui_and_preserves_actual_core_then_rolls_back(self):
        before = hashes(self.root / 'config')
        self.manager.start(self.version['releaseTag'], mode='ui')
        status = self.finish()
        self.assertEqual(status['state'], 'succeeded', status)
        self.assertEqual(status['installedBackend'], 'FJH7T')
        self.assertEqual((self.root / 'ui/config.js').read_bytes(), b'private site config')
        self.assertEqual(hashes(self.root / 'config'), before)
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')
        self.manager.start(rollback=True)
        self.assertEqual(self.finish()['state'], 'succeeded')
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), b'old UI')
        self.assertFalse(self.manager.status()['canRollback'])

    def test_core_and_full_preserve_settings_and_support_snapshot_restore(self):
        for mode in ('core', 'full'):
            with self.subTest(mode=mode):
                original = hashes(self.root / 'ui')
                before = hashes(self.root / 'config/upstreams')
                self.prepare(mode)
                result = self.continue_update()
                self.assertEqual(result['state'], 'succeeded', result)
                self.assertEqual(result['installedBackend'], 'FJHAI')
                self.assertEqual(hashes(self.root / 'config/upstreams'), before)
                self.assertEqual((self.root / 'ui/index.html').read_bytes(), b'old UI' if mode == 'core' else b'new UI')
                if mode == 'core': self.assertEqual(hashes(self.root / 'ui'), original)
                self.manager.start(rollback=True)
                self.assertEqual(self.finish()['state'], 'awaiting_backup')
                self.assertEqual(self.continue_update()['state'], 'succeeded')
                self.assertEqual(self.manager.current()['backendVersion'], 'FJH7T')

    def test_gate_rejects_missing_download_wrong_hash_and_settings_changed(self):
        status = self.prepare()
        for digest in ('0' * 64, status['backup']['sha256']):
            with self.assertRaises(http.UpdateError): self.manager.continue_job(status['jobId'], digest)
        with self.assertRaises(http.UpdateError): self.manager.backup_file('0' * 24)
        self.manager.downloaded(status['jobId'])
        (self.root / 'rules/manual/direct_domains.txt').write_bytes(b'changed')
        result = self.continue_update()
        self.assertEqual(result['state'], 'failed')
        self.assertIn('设置发生变化', result['message'])
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')
        self.assertFalse(self.manager.stage_path().exists())
        self.assertTrue(self.manager.backup_file(status['jobId'])[0].is_file())

    def test_waiting_job_survives_restart_serializes_requests_and_cancels_cleanly(self):
        status = self.prepare('core')
        self.manager = self.manager_at()
        self.assertEqual(self.manager.status()['state'], 'awaiting_backup')
        self.assertEqual(self.manager.start(self.version['releaseTag'], mode='core')['jobId'], status['jobId'])
        with self.assertRaises(http.UpdateError): self.manager.start(self.version['releaseTag'], mode='full')
        self.manager.cancel(status['jobId'])
        self.assertFalse(self.manager.stage_path().exists())
        self.assertTrue(self.manager.backup_file(status['jobId'])[0].is_file())
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')

    def test_rejects_changed_stage_and_incompatible_or_corrupt_package(self):
        self.prepare()
        (self.manager.stage_path() / 'bin/localdns').write_bytes(b'tampered')
        self.assertIn('暂存版本内容已改变', self.continue_update()['message'])
        self.package(dict(self.version, updateCompatibility={'schema': 2}))
        self.manager.start(self.version['releaseTag'], mode='full')
        self.assertEqual(self.finish()['state'], 'failed')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')

    def test_future_core_same_contract_is_supported(self):
        self.version = dict(self.version, backendVersion='FJNEW', releaseTag='fjnew-ui-v2026.10.31.3')
        self.package()
        self.prepare('core')
        self.assertEqual(self.continue_update()['installedBackend'], 'FJNEW')

    def test_preflight_failure_and_real_switch_health_failure_keep_old_runtime(self):
        status = self.prepare()
        self.manager.downloaded(status['jobId'])
        with patch.object(upgrade, 'preflight', side_effect=MigrationError('预检失败')):
            self.manager.continue_job(status['jobId'], status['backup']['sha256'])
            self.assertEqual(self.finish()['state'], 'failed')
        self.prepare()
        with patch.object(upgrade, 'verify', side_effect=MigrationError('health failed')):
            # Apply the real transaction, with service control isolated.
            status = self.manager.status(); self.manager.downloaded(status['jobId'])
            with patch.object(upgrade, 'preflight', side_effect=self.preflight), patch.object(upgrade, 'updater', return_value=False), \
                 patch.object(upgrade, 'core_service'), patch.object(upgrade.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                self.manager.continue_job(status['jobId'], status['backup']['sha256'])
                self.assertEqual(self.finish()['state'], 'rolled_back')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')

    def test_http_stream_gate_and_fixed_operations(self):
        status = self.prepare()
        config = {'allowedOrigins': ['http://127.0.0.1:9099']}
        server = http.UpdateServer(('127.0.0.1', 0), config, self.manager)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(path, body=None, origin='http://127.0.0.1:9099'):
            headers = {'Origin': origin, 'Content-Type': 'application/json'} if origin else {}
            req = Request('http://127.0.0.1:' + str(server.server_port) + path, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
            return build_opener(ProxyHandler({})).open(req, timeout=5)
        try:
            with request('/upgrade') as response: self.assertEqual(json.load(response)['protocol'], 'localdns-updater/v2')
            for path, body, origin in [('/upgrade/backup/' + status['jobId'], None, None), ('/upgrade/cancel', {'jobId': status['jobId']}, 'http://evil.test'), ('/upgrade', {'releaseTag': self.version['releaseTag'], 'mode': 'ui', 'path': '/tmp'}, config['allowedOrigins'][0])]:
                with self.assertRaises(HTTPError): request(path, body, origin)
            with request('/upgrade/backup/' + status['jobId']) as response:
                self.assertEqual(response.read(), self.manager.backup_file(status['jobId'])[0].read_bytes())
            # The final body bytes can reach the client before the handler's
            # following durable state write has finished.
            deadline = time.monotonic() + 3
            while not self.manager.status()['backupDownloaded'] and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(self.manager.status()['backupDownloaded'])
        finally:
            server.shutdown(); server.server_close(); thread.join(5)

    def test_independent_installer_stages_outside_core_without_changing_dns(self):
        stage = self.work / 'installer-stage'
        target = stage / 'opt/localdns'
        shutil.copytree(self.root, target)
        before = hashes(target / 'config')
        with contextlib.redirect_stdout(io.StringIO()):
            setup.main(['--stage-root', str(stage), '--origin', 'http://dns.example:9099'])
        self.assertEqual(hashes(target / 'config'), before)
        self.assertTrue((stage / 'opt/localdns-updater/online_updater.py').is_file())
        self.assertTrue((stage / 'opt/localdns-updater/core_upload.py').is_file())
        self.assertFalse((target / 'bin/ui-updater/online_updater.py').exists())
        self.assertEqual(read_json(stage / 'var/lib/localdns-updater/config.json')['protocol'], 'localdns-updater/v2')
        self.assertIn('localdns-updater', (stage / 'etc/init.d/localdns-updater').read_text())
        self.assertIn('http://dns.example:9100', (target / 'ui/config.js').read_text())

    def prepare_upload(self, backend='FJNEW'):
        # Uploaded cores retain the installed layout. Use the current config schema.
        from fjgli_config import migrate_configuration, replace_tree
        migrate_configuration(self.root, self.new)
        replace_tree(self.new / 'config', self.root / 'config')
        data = zipped(bundle(backend))
        self.manager.receive_core(io.BytesIO(data), len(data), installer.digest(data))
        result = self.finish()
        self.assertEqual(result['state'], 'awaiting_backup', result)
        return result

    def test_uploaded_core_works_without_release_tag_preserves_files_and_restores(self):
        status = self.prepare_upload()
        original_ui, original_config = hashes(self.root / 'ui'), hashes(self.root / 'config')
        self.assertEqual(status['targetBackend'], 'FJNEW')
        self.assertEqual(status['source'], 'upload')
        self.assertEqual(hashes(self.manager.stage_path() / 'ui'), original_ui)
        self.assertEqual(hashes(self.manager.stage_path() / 'config'), original_config)
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')
        self.assertEqual((self.manager.stage_path() / 'bin/localdns').read_bytes(), elf())
        self.assertFalse((self.manager.stage_path() / 'install.sh').exists())
        self.manager = self.manager_at()
        self.assertEqual(self.manager.status()['jobId'], status['jobId'])
        with self.assertRaises(http.UpdateError):
            self.manager.receive_core(io.BytesIO(b'abc'), 3, installer.digest(b'abc'))
        with self.assertRaises(http.UpdateError):
            self.manager.continue_job(status['jobId'], status['backup']['sha256'])
        self.assertEqual(self.continue_update()['state'], 'succeeded')
        self.assertEqual(self.manager.current()['backendVersion'], 'FJNEW')
        self.assertEqual(hashes(self.root / 'ui'), original_ui)
        self.assertEqual(hashes(self.root / 'config'), original_config)
        self.manager.start(rollback=True)
        self.assertEqual(self.finish()['state'], 'awaiting_backup')
        self.assertEqual(self.continue_update()['state'], 'succeeded')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')

    def test_uploaded_same_version_uses_binary_identity_and_preflight_failure_keeps_old_core(self):
        self.prepare_upload('FJH7T')
        self.manager.downloaded(self.manager.status()['jobId'])
        with patch.object(upgrade, 'preflight', side_effect=MigrationError('接口不兼容')):
            status = self.manager.status()
            self.manager.continue_job(status['jobId'], status['backup']['sha256'])
            self.assertEqual(self.finish()['state'], 'failed')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')
        data = zipped(bundle('FJH7T'))
        (self.root / 'bin/localdns').write_bytes(elf())
        self.manager.receive_core(io.BytesIO(data), len(data), installer.digest(data))
        self.assertIn('无需重复更新', self.finish()['message'])

    def test_uploaded_corrupt_incomplete_or_changed_bytes_never_touch_runtime(self):
        before = hashes(self.root)
        for data, length, digest in [(b'not zip', 7, installer.digest(b'not zip')),
                                     (b'abc', 6, installer.digest(b'abcdef')),
                                     (b'abc', 3, '0' * 64)]:
            with self.subTest(length=length):
                try:
                    self.manager.receive_core(io.BytesIO(data), length, digest)
                    self.finish()
                except http.UpdateError:
                    pass
                self.assertEqual(self.manager.status()['state'], 'failed')
                self.assertEqual(hashes(self.root), before)
                self.assertFalse(self.manager.stage_path().exists())
                self.assertFalse((self.manager.job_directory() / 'download').exists())

    def test_upload_http_content_limits_origin_and_checksum(self):
        config = {'allowedOrigins': ['http://127.0.0.1:9099']}
        server = http.UpdateServer(('127.0.0.1', 0), config, self.manager)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        data = zipped(bundle())
        def request(headers):
            req = Request('http://127.0.0.1:' + str(server.server_port) + '/upgrade/core/upload',
                          data=data, headers=headers, method='POST')
            return build_opener(ProxyHandler({})).open(req, timeout=5)
        headers = {'Origin': config['allowedOrigins'][0], 'Content-Type': 'application/zip',
                   'X-Content-SHA256': installer.digest(data)}
        try:
            preflight = Request('http://127.0.0.1:' + str(server.server_port) + '/upgrade/core/upload',
                                headers={'Origin': config['allowedOrigins'][0],
                                         'Access-Control-Request-Method': 'POST',
                                         'Access-Control-Request-Headers': 'content-type,x-content-sha256'}, method='OPTIONS')
            with build_opener(ProxyHandler({})).open(preflight, timeout=5) as response:
                self.assertIn('X-Content-SHA256', response.headers['Access-Control-Allow-Headers'])
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], config['allowedOrigins'][0])
            for extra, code in [({'Origin': 'http://evil.test'}, 403), ({'Origin': ''}, 403),
                                ({'Content-Type': 'application/json'}, 415), ({'X-Content-SHA256': ''}, 400),
                                ({'Content-Length': '0'}, 413), ({'Content-Length': str(online.MAX_UPLOAD_BYTES + 1)}, 413)]:
                with self.subTest(extra=extra), self.assertRaises(HTTPError) as error:
                    request(dict(headers, **extra))
                self.assertEqual(error.exception.code, code)
            with request(headers) as response:
                self.assertEqual(response.status, 202)
            self.assertEqual(self.finish()['state'], 'awaiting_backup')
            self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')
            status = self.manager.status()
            self.manager.cancel(status['jobId'])
            self.assertFalse(self.manager.stage_path().exists())
            self.assertTrue(self.manager.backup_file(status['jobId'])[0].is_file())
        finally:
            server.shutdown(); server.server_close(); thread.join(5)


if __name__ == '__main__': unittest.main()
