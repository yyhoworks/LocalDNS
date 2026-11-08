"""Three-mode filesystem transactions, persistent backup gate and HTTP restrictions."""
import json
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import os
import shutil
import subprocess
import threading
import time
import unittest
from pathlib import Path, PurePosixPath
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

collector_spec = importlib.util.spec_from_file_location(
    'traffic_collector', Path(__file__).resolve().parents[1] / 'services/proxy-traffic/traffic_collector.py')
collector = importlib.util.module_from_spec(collector_spec)
collector_spec.loader.exec_module(collector)


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

    def publish_traffic(self, stamp, state=None):
        if state is None:
            state = collector.load_state(self.work / 'traffic-state.json', stamp)
        collector.sample({'connections': []}, state, stamp)
        summary, detail = collector.publications(state)
        write_json(self.root / 'ui/custom/traffic.json', summary)
        write_json(self.root / 'ui/custom/traffic-detail.json', detail)
        return state

    def traffic_upgrade(self, mode, *, midnight=False, uploaded=False):
        stamp = dt.datetime(2026, 11, 7, 23, 59, 40, tzinfo=dt.timezone(dt.timedelta(hours=8)))
        state = self.publish_traffic(stamp)
        if uploaded:
            self.prepare_upload()
        else:
            self.prepare(mode)
        self.publish_traffic(stamp + dt.timedelta(seconds=40 if midnight else 5), state)
        self.manager = self.manager_at()
        self.assertEqual(self.manager.status()['state'], 'awaiting_backup')
        result = self.continue_update()
        self.assertEqual(result['state'], 'succeeded', result)

    def test_full_upgrade_accepts_midnight_traffic_publication_after_restart(self):
        self.traffic_upgrade('full', midnight=True)

    def test_core_upgrade_accepts_traffic_publication(self):
        self.traffic_upgrade('core')

    def test_uploaded_core_accepts_midnight_traffic_publication(self):
        self.traffic_upgrade('core', midnight=True, uploaded=True)

    def test_staged_traffic_change_blocks_upgrade(self):
        self.publish_traffic(dt.datetime.now().astimezone())
        self.prepare()
        path = self.manager.stage_path() / 'ui/custom/traffic.json'
        value = read_json(path)
        value['total']['down'] = 987654321
        write_json(path, value)
        result = self.continue_update()
        self.assertEqual(result['state'], 'failed', result)
        self.assertIn('暂存版本内容已改变', result['message'])
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')

    def test_legacy_snapshot_with_traffic_supports_rollback_after_restart(self):
        self.publish_traffic(dt.datetime.now().astimezone())
        self.prepare()
        self.assertEqual(self.continue_update()['state'], 'succeeded')
        reference = dict(self.manager.state['previous'])
        previous = self.root.parent / reference['name']
        # Persist the byte-level SHA-256 map used by the released updater.
        reference['hashes'] = {
            path.relative_to(previous).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in previous.rglob('*')
            if path.is_file() and path.relative_to(previous).as_posix() != upgrade.MARKER
        }
        self.manager.save(previous=reference)
        self.manager = self.manager_at()
        self.manager.start(rollback=True)
        result = self.finish()
        self.assertEqual(result['state'], 'awaiting_backup', result)
        self.assertEqual(self.continue_update()['state'], 'succeeded')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')

    def test_snapshot_traffic_change_blocks_rollback(self):
        self.publish_traffic(dt.datetime.now().astimezone())
        self.prepare()
        self.assertEqual(self.continue_update()['state'], 'succeeded')
        previous = self.root.parent / self.manager.state['previous']['name']
        path = previous / 'ui/custom/traffic.json'
        value = read_json(path)
        value['total']['down'] = 987654321
        write_json(path, value)
        self.manager = self.manager_at()
        self.manager.start(rollback=True)
        result = self.finish()
        self.assertEqual(result['state'], 'failed', result)
        self.assertIn('上一版本快照内容已改变', result['message'])

    def test_source_ui_and_core_changes_still_block_upgrade(self):
        for relative in ('ui/index.html', 'bin/localdns'):
            with self.subTest(relative=relative):
                self.prepare()
                (self.root / relative).write_bytes(b'changed runtime')
                result = self.continue_update()
                self.assertEqual(result['state'], 'failed', result)
                self.assertIn('UI 或内核文件发生变化', result['message'])

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
        # 重装升级服务不能把手动指定的 CPU 基线悄悄降级成自动探测结果。
        config_path = stage / 'var/lib/localdns-updater/config.json'
        write_json(config_path, dict(read_json(config_path), architecture='amd64-v3'))
        with contextlib.redirect_stdout(io.StringIO()):
            setup.main(['--stage-root', str(stage), '--origin', 'http://dns.example:9099'])
        self.assertEqual(read_json(config_path)['architecture'], 'amd64-v3')

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
        def request(headers, body=data):
            req = Request('http://127.0.0.1:' + str(server.server_port) + '/upgrade/core/upload',
                          data=body, headers={'Content-Length': str(len(data)), **headers}, method='POST')
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
                with self.subTest(extra=extra):
                    # These headers must be rejected before reading the ZIP.
                    # Sending the full body anyway races the early close and
                    # causes a TCP reset on Windows instead of an HTTP error.
                    with self.assertRaises(HTTPError) as error:
                        request(dict(headers, **extra), body=None)
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


    # ---- Snapshot retention -------------------------------------------------

    def aged(self, path, age):
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        return path

    def old_snapshots(self):
        """Leftovers of earlier updates, oldest last: in the root, beside it and in the state dir."""
        for index in range(4):
            stamp = '2026010%d-000000' % (index + 1)
            previous = self.root / ('ui.previous-2026.01.0%d-%s-abcd' % (index + 1, stamp))
            previous.mkdir()
            (previous / 'index.html').write_bytes(b'old snapshot %d' % index)
            (self.root / ('ui-backup-2026.01.0%d-%s-abcd.tar.gz' % (index + 1, stamp))).write_bytes(b'tar')
            failed = self.root / ('ui.failed-%032x' % index); failed.mkdir()
            self.aged(failed, 4000 - index * 100)
        full = []
        for index in range(3):
            path = self.work / ('localdns.previous-fjgli-%032x' % index)
            (path / 'ui.previous-nested').mkdir(parents=True)
            full.append(self.aged(path, 3000 - index * 100))
        jobs = []
        for index in range(3):
            path = self.work / 'state' / ('job-%024x' % index)
            (path / 'backup').mkdir(parents=True)
            (path / 'backup/localdns-original.tar.gz').write_bytes(b'old backup')
            jobs.append(self.aged(path, 3000 - index * 100))
        return full, jobs

    def test_core_update_stages_without_snapshots_and_keeps_only_recent_ones(self):
        full, jobs = self.old_snapshots()
        status = self.prepare_upload()
        stage_names = {p.name for p in self.manager.stage_path().iterdir()}
        self.assertFalse([n for n in stage_names if installer.is_snapshot_name(n)], stage_names)
        archive = self.manager.backup_file(status['jobId'])[0]
        import tarfile
        with tarfile.open(archive) as tar:
            top = {PurePosixPath(n).parts[1] for n in tar.getnames() if len(PurePosixPath(n).parts) > 1}
        self.assertFalse([n for n in top if installer.is_snapshot_name(n)], top)
        self.assertIn('config', top)
        result = self.continue_update()
        self.assertEqual(result['state'], 'succeeded', result)
        previous = self.manager.state['previous']['name']
        kept = sorted(p.name for p in self.work.glob('localdns.previous-fjgli-*'))
        self.assertEqual(len(kept), online.RETENTION)
        self.assertIn(previous, kept)
        self.assertIn(full[-1].name, kept)
        kept_jobs = sorted(p.name for p in (self.work / 'state').glob('job-*'))
        self.assertEqual(len(kept_jobs), online.RETENTION)
        self.assertIn('job-' + status['jobId'], kept_jobs)
        self.assertTrue(self.manager.backup_file(status['jobId'])[0].is_file())
        self.assertFalse([p.name for p in self.root.iterdir() if installer.is_snapshot_name(p.name)])
        # The rollback snapshot still holds the earlier UI snapshots, but restoring it never copies them back.
        self.assertTrue(list((self.work / previous).glob('ui.previous-*')))
        self.manager.start(rollback=True)
        self.assertEqual(self.finish()['state'], 'awaiting_backup')
        self.assertFalse([p.name for p in self.manager.stage_path().iterdir() if installer.is_snapshot_name(p.name)])
        self.assertEqual(self.continue_update()['state'], 'succeeded')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), b'original')
        self.assertEqual(len(list(self.work.glob('localdns.previous-fjgli-*'))), online.RETENTION)

    def test_prune_never_removes_what_status_or_rollback_references(self):
        full, jobs = self.old_snapshots()
        for index in range(3, 6):
            path = self.work / 'state' / ('job-%024x' % index)
            path.mkdir()
            self.aged(path, 100 - index)
        self.manager.save(state='awaiting_backup', jobId='%024x' % 0, backup={'sha256': '0' * 64, 'bytes': 1},
                          previous={'kind': 'full', 'name': full[0].name, 'hashes': {}})
        self.manager.prune()
        jobs_left = {p.name for p in (self.work / 'state').glob('job-*')}
        self.assertEqual(jobs_left, {'job-%024x' % 0, 'job-%024x' % 4, 'job-%024x' % 5})
        self.assertEqual({p.name for p in self.work.glob('localdns.previous-fjgli-*')}, {f.name for f in full})
        # The oldest job stays while the UI rollback points at it; the old full snapshot no longer does.
        self.manager.save(jobId='%024x' % 5, previous={'kind': 'ui', 'name': 'job-%024x' % 0, 'hashes': {}})
        self.manager.prune()
        self.assertEqual({p.name for p in (self.work / 'state').glob('job-*')}, jobs_left)
        self.assertEqual({p.name for p in self.work.glob('localdns.previous-fjgli-*')}, {full[1].name, full[2].name})

    def test_ui_update_keeps_recent_root_snapshots_and_the_legacy_rollback_target(self):
        self.old_snapshots()
        (self.root / '.ui-updater').mkdir()
        legacy = 'ui.previous-2026.01.01-20260101-000000-abcd'
        write_json(self.root / '.ui-updater/state.json', {'state': 'succeeded', 'previous': legacy})
        self.manager.start(self.version['releaseTag'], mode='ui')
        status = self.finish()
        self.assertEqual(status['state'], 'succeeded', status)
        self.assertTrue(status['canRollback'])
        previous = sorted(p.name for p in self.root.glob('ui.previous-*'))
        self.assertEqual(len(previous), online.RETENTION + 1, previous)
        self.assertIn(legacy, previous)
        self.assertIn('ui.previous-2026.01.04-20260104-000000-abcd', previous)
        self.assertEqual(len(list(self.root.glob('ui-backup-*.tar.gz'))), online.RETENTION)
        self.assertEqual(len(list(self.root.glob('ui.failed-*'))), online.RETENTION)
        self.manager.start(rollback=True)
        self.assertEqual(self.finish()['state'], 'succeeded')
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), b'old UI')

    # ---- Startup recovery failure ----------------------------------------------

    def test_failed_startup_recovery_keeps_serving_status_and_refuses_changes(self):
        self.manager.save(state='running', step='switch', jobId='%024x' % 7, mode='full')
        with patch.object(installer, 'recover_ui_update', side_effect=installer.InstallError('UI 更新事务路径无效，需要手动检查')), \
             contextlib.redirect_stderr(io.StringIO()) as log:
            manager = self.manager_at()
        self.assertIn('UI 更新事务路径无效', log.getvalue())
        status = manager.status()
        self.assertEqual(status['state'], 'failed')
        self.assertEqual(status['step'], online.NEEDS_ATTENTION)
        self.assertTrue(status['needsAttention'])
        self.assertFalse(status['canRollback'])
        self.assertIn('UI 更新事务路径无效', status['message'])
        self.assertEqual(read_json(self.work / 'state/state.json')['step'], online.NEEDS_ATTENTION)
        self.assertTrue(manager.capabilities()['needsAttention'])
        for call in (lambda: manager.start(self.version['releaseTag'], mode='ui'), lambda: manager.start(rollback=True),
                     lambda: manager.receive_core(io.BytesIO(b'abc'), 3, installer.digest(b'abc')),
                     lambda: manager.continue_job('%024x' % 7, '0' * 64), lambda: manager.cancel('%024x' % 7)):
            with self.assertRaises(http.UpdateError) as error:
                call()
            self.assertEqual(error.exception.status, 409)
        config = {'allowedOrigins': ['http://127.0.0.1:9099']}
        server = http.UpdateServer(('127.0.0.1', 0), config, manager)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(path, body=None):
            req = Request('http://127.0.0.1:' + str(server.server_port) + path,
                          headers={'Origin': config['allowedOrigins'][0], 'Content-Type': 'application/json'},
                          data=json.dumps(body).encode() if body is not None else None)
            return build_opener(ProxyHandler({})).open(req, timeout=5)
        try:
            with request('/upgrade/status') as response:
                self.assertEqual(json.load(response)['step'], online.NEEDS_ATTENTION)
            with request('/upgrade/ui') as response:
                self.assertEqual(json.load(response)['capabilities']['protocol'], 'localdns-updater/v2')
            with self.assertRaises(HTTPError) as error:
                request('/upgrade', {'releaseTag': self.version['releaseTag'], 'mode': 'ui'})
            self.assertEqual(error.exception.code, 409)
        finally:
            server.shutdown(); server.server_close(); thread.join(5)
        # A second failed start keeps the original job state for later.
        with patch.object(installer, 'recover_ui_update', side_effect=installer.InstallError('still broken')), \
             contextlib.redirect_stderr(io.StringIO()):
            self.assertTrue(self.manager_at().status()['needsAttention'])
        # Once the cause is gone, the next start recovers normally.
        manager = self.manager_at()
        status = manager.status()
        self.assertFalse(status['needsAttention'])
        self.assertEqual(status['step'], 'interrupted')
        self.assertEqual(status['state'], 'failed')
        self.assertNotIn('attentionPrevious', read_json(self.work / 'state/state.json'))
        manager.start(self.version['releaseTag'], mode='ui')
        manager.thread.join(10)
        self.assertEqual(manager.status()['state'], 'succeeded')

    def test_waiting_job_survives_a_failed_start_once_recovery_works(self):
        status = self.prepare('core')
        with patch.object(installer, 'recover_ui_update', side_effect=installer.InstallError('broken')), \
             contextlib.redirect_stderr(io.StringIO()):
            self.manager = self.manager_at()
        self.assertTrue(self.manager.status()['needsAttention'])
        self.manager = self.manager_at()
        restored = self.manager.status()
        self.assertEqual((restored['state'], restored['jobId']), ('awaiting_backup', status['jobId']))
        self.assertEqual(self.continue_update()['state'], 'succeeded')

    def test_startup_with_unreadable_install_or_state_still_serves_status(self):
        (self.root / 'ui/version.json').unlink()
        (self.root / 'core-version.json').unlink()
        with contextlib.redirect_stderr(io.StringIO()):
            manager = self.manager_at()
        status = manager.status()
        self.assertTrue(status['needsAttention'])
        self.assertIsNone(status['installedVersion'])
        self.assertIsNone(manager.capabilities()['installed']['uiVersion'])
        (self.work / 'state/state.json').write_text('{not json', encoding='utf-8')
        with contextlib.redirect_stderr(io.StringIO()):
            manager = self.manager_at()
        self.assertEqual(manager.status()['step'], online.NEEDS_ATTENTION)
        # A corrupt state file is kept for inspection, not overwritten.
        self.assertEqual((self.work / 'state/state.json').read_text(encoding='utf-8'), '{not json')


    def test_legacy_marker_of_a_supported_backend_passes_the_contract_gate(self):
        # 手动换内核留下过只含 backendVersion 的 core-version.json；白名单兜底
        # 必须覆盖当前内核家族，否则三个升级入口都会被契约检查 409 拦下。
        self.assertEqual(online.contract({'backendVersion': 'FJMOS'}), online.CONTRACT)
        self.assertIsNone(online.contract({'backendVersion': 'FJUNKNOWN'}))

    def test_marker_without_contract_is_repaired_when_the_ui_requires_the_same_core(self):
        write_json(self.root / 'ui/version.json', dict(self.version, backendVersion='FJNEW'))
        write_json(self.root / 'core-version.json', {'backendVersion': 'FJNEW'})
        manager = self.manager_at()
        self.assertEqual(manager.core_metadata()['updateCompatibility'], online.CONTRACT)
        online.check_contract(manager.core_metadata())

    def test_marker_contract_is_not_invented_when_the_ui_requires_another_core(self):
        write_json(self.root / 'ui/version.json', dict(self.version, backendVersion='FJHAI'))
        write_json(self.root / 'core-version.json', {'backendVersion': 'FJNEW'})
        manager = self.manager_at()
        self.assertIsNone(online.contract(manager.core_metadata()))
        with self.assertRaises(http.UpdateError) as error:
            manager.start('fjnew-ui-v2026.11.01.5', mode='ui')
        self.assertEqual(error.exception.status, 409)


if __name__ == '__main__': unittest.main()
