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
        self.assertFalse((target / 'bin/ui-updater/online_updater.py').exists())
        self.assertEqual(read_json(stage / 'var/lib/localdns-updater/config.json')['protocol'], 'localdns-updater/v2')
        self.assertIn('localdns-updater', (stage / 'etc/init.d/localdns-updater').read_text())
        self.assertIn('http://dns.example:9100', (target / 'ui/config.js').read_text())


if __name__ == '__main__': unittest.main()
