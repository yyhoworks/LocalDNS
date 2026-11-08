"""Exercise real configuration preservation and directory rollback without services."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fjgli_config import MigrationError, clean_template, hashes, migrate_configuration, read_json, write_json
import upgrade_localdns as upgrade
from package_ui import write_archive


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.old, self.new = self.work / 'localdns', self.work / 'stage'
        for root in (self.old, self.new):
            (root / 'config/upstreams').mkdir(parents=True)
            (root / 'config/subscriptions').mkdir()
            (root / 'rules/manual').mkdir(parents=True)
            (root / 'bin').mkdir()
            (root / 'bin/localdns').write_bytes(b'original' if root == self.old else b'FJGLI')
        write_json(self.old / 'config/localdns.json', {'memory_limit_mb': 150, 'api': {'http': '127.0.0.1:19000'},
                   'dns': {'udp_listen': ':1053', 'tcp_listen': ':1053'}})
        write_json(self.old / 'config/upstreams/domestic.json', {'upstreams': [{'tag': 'personal', 'addr': '192.0.2.53'}]})
        write_json(self.old / 'config/cache.json', {'main': {'size': 200, 'lazy_cache_ttl': 400, 'dump_interval': 300}})
        write_json(self.old / 'config/generated.json', {'realip': {'max_entries': 20, 'dump_interval': 50}})
        write_json(self.old / 'config/settings/client_names.json', {'192.0.2.1': '我的电脑'})
        write_json(self.old / 'config/settings/audit.json', {'capacity': 2000, 'dir': '/var/log/mydns'})
        write_json(self.old / 'config/settings/switches.json', {'adguard': True})
        write_json(self.old / 'config/settings/requery.json', {'scheduler': {'enabled': True, 'interval_minutes': 25},
                   'execution_settings': {'queries_per_second': 3, 'url_call_delay_ms': 50},
                   'status': {'task_state': 'running'}, 'url_actions': {
                       'save_rules': ['http://127.0.0.1:19000/plugins/cache_main/save'],
                       'flush_rules': ['http://localhost:19000/plugins/realip/flush']}})
        (self.old / 'rules/manual/direct_domains.txt').write_bytes(b'example.com\n')
        (self.old / 'rules/online/custom_cn').mkdir(parents=True)
        (self.old / 'rules/online/custom_cn/personal.srs').write_bytes(b'standard-source')
        write_json(self.old / 'config/subscriptions/custom_cn.json', [{'name': 'personal', 'url': 'https://example.test/rules',
                   'files': 'rules/online/custom_cn/personal.srs', 'enabled': True, 'auto_update': False}])

    def test_migrates_all_settings_and_retains_source_bytes(self):
        before = hashes(self.old)
        report = migrate_configuration(self.old, self.new)
        self.assertEqual(hashes(self.old), before)
        main = read_json(self.new / 'config/localdns.json')
        self.assertEqual(main['cache_memory_mb'], 150)
        self.assertEqual(main['api']['http'], '127.0.0.1:19000')
        self.assertNotIn('memory_limit_mb', main)
        self.assertEqual(read_json(self.new / 'config/settings/cache.json')['main'],
                         {'max_entries': 200, 'stale_ttl': 400, 'save_interval': 300})
        self.assertEqual(read_json(self.new / 'config/settings/generated.json')['realip']['save_interval'], 50)
        self.assertEqual(read_json(self.new / 'config/settings/client_aliases.json'), {'192.0.2.1': '我的电脑'})
        self.assertEqual(read_json(self.new / 'config/settings/querylog.json')['dir'], '/var/log/mydns')
        route = read_json(self.new / 'config/settings/route_refresh.json')
        self.assertEqual(route['actions'], {'save': ['cache_main'], 'flush': ['realip']})
        self.assertTrue(route['scheduler']['enabled'])
        self.assertEqual(route['status']['task_state'], 'idle')
        for relative in ('config/upstreams', 'config/subscriptions', 'rules/manual'):
            self.assertEqual(hashes(self.old / relative), hashes(self.new / relative))
        self.assertFalse(report['missingSubscriptionFiles'])
        self.assertEqual((self.new / 'rules/online/custom_cn/personal.srs').read_bytes(), b'standard-source')

    def test_alias_conflict_unknown_configuration_and_external_actions_stop_migration(self):
        write_json(self.old / 'config/settings/client_aliases.json', {'192.0.2.1': 'different'})
        with self.assertRaisesRegex(MigrationError, '别名'):
            migrate_configuration(self.old, self.new)
        (self.old / 'config/settings/client_aliases.json').unlink()
        write_json(self.old / 'config/settings/unrecognized.json', {'value': 1})
        with self.assertRaisesRegex(MigrationError, '尚未适配'):
            migrate_configuration(self.old, self.new)
        (self.old / 'config/settings/unrecognized.json').unlink()
        route = read_json(self.old / 'config/settings/requery.json')
        route['url_actions']['save_rules'] = ['https://external.test/reload']
        write_json(self.old / 'config/settings/requery.json', route)
        with self.assertRaisesRegex(MigrationError, 'URL'):
            migrate_configuration(self.old, self.new)

    def test_keeps_the_querylog_persist_switch_from_fjh21_onwards(self):
        write_json(self.old / 'config/settings/querylog.json', {'capacity': 5000, 'persist': True})
        migrate_configuration(self.old, self.new)
        self.assertEqual(read_json(self.new / 'config/settings/querylog.json'), {'capacity': 5000, 'persist': True})
        write_json(self.old / 'config/settings/querylog.json', {'capacity': 5000, 'unknown': 1})
        with self.assertRaisesRegex(MigrationError, '查询日志'):
            migrate_configuration(self.old, self.new)

    def test_rejects_subscription_paths_outside_runtime_and_flags_missing_sources(self):
        p = self.old / 'config/subscriptions/custom_cn.json'
        entries = read_json(p)
        entries[0]['files'] = '../outside'
        write_json(p, entries)
        with self.assertRaisesRegex(MigrationError, 'rules/online'):
            migrate_configuration(self.old, self.new)
        entries[0]['files'] = 'rules/online/missing.srs'
        write_json(p, entries)
        self.assertTrue(migrate_configuration(self.old, self.new)['missingSubscriptionFiles'])

    def test_template_removes_personal_data_and_keeps_required_generated_files(self):
        raw = {'localdns/config/settings/route_refresh.json': json.dumps({'scheduler': {'enabled': True}, 'status': {}}).encode(),
               'localdns/config/subscriptions/adguard.json': b'[]', 'localdns/generated/realip_rules.txt': b'private',
               'localdns/rules/manual/block_domains.txt': b'private', 'localdns/rules/compiled/old.srs': b'old'}
        result = clean_template(raw)
        self.assertEqual(result['localdns/generated/realip_rules.txt'], b'')
        self.assertEqual(result['localdns/rules/manual/block_domains.txt'], b'')
        self.assertNotIn('localdns/rules/compiled/old.srs', result)
        self.assertEqual(json.loads(result['localdns/config/settings/client_aliases.json']), {})

    def test_prepare_uses_verified_package_and_a_new_directory(self):
        version = {'uiVersion': '2026.10.22.1', 'backendVersion': 'FJGLI', 'builtAt': '2026-10-22T16:45:00+08:00'}
        package = self.work / 'Full.zip'
        payload = {'release.json': json.dumps(dict(version, packageType='full')).encode(),
                   'localdns/config/localdns.json': b'{}', 'localdns/rules/manual/': b'',
                   'localdns/ui/index.html': b'new UI', 'localdns/bin/localdns': b'new',
                   'LocalDNS_FJGLI_Binaries/localdns-amd64-v1': b'new'}
        modes = {name: 0o100755 for name in payload if 'localdns-' in name or '/bin/' in name}
        write_archive(package, payload, version, modes)
        target = self.work / 'prepared'
        result = upgrade.prepare(self.old, package, upgrade.sha(package), target, 'amd64-v1')
        self.assertEqual(result['stage'], str(target))
        self.assertTrue((target / upgrade.MARKER).is_file())
        self.assertEqual((target / 'ui/index.html').read_bytes(), b'new UI')
        self.assertEqual(read_json(target / 'config/localdns.json')['cache_memory_mb'], 150)

    def ready(self):
        report = migrate_configuration(self.old, self.new)
        metadata = {'schema': 1, 'sourceRoot': str(self.old), 'sourceFingerprint': upgrade.fingerprint(self.old), 'report': report}
        metadata['preflight'] = {'stageFingerprint': upgrade.stage_fingerprint(self.new)}
        write_json(self.new / upgrade.MARKER, metadata)
        self.archive = self.work / 'backup/old.tar.gz'
        self.archive.parent.mkdir()
        self.archive.write_bytes(b'verified downloaded archive')
        self.sha = upgrade.sha(self.archive)
        write_json(self.archive.parent / 'backup.json', {'sourceRoot': str(self.old), 'sha256': self.sha,
                                                        'sourceFingerprint': metadata['sourceFingerprint']})

    def test_missing_architecture_binary_reports_error_before_creating_stage(self):
        version = {'uiVersion': '2026.10.31.5', 'backendVersion': 'FJHAI', 'builtAt': '2026-10-31T22:00:00+08:00'}
        package = self.work / 'missing-binary.zip'
        payload = {'release.json': json.dumps(dict(version, packageType='full')).encode(),
                   'localdns/config/localdns.json': b'{}'}
        write_archive(package, payload, version, {})
        before = hashes(self.old)
        target = self.work / 'missing-stage'
        with self.assertRaisesRegex(MigrationError, '发行包缺少二进制文件 localdns-amd64-v1'):
            upgrade.prepare(self.old, package, upgrade.sha(package), target, 'amd64-v1')
        self.assertFalse(target.exists())
        self.assertEqual(hashes(self.old), before)

    def test_fjhai_prepare_preserves_user_settings_and_reports_the_target_core(self):
        version = {'uiVersion': '2026.10.31.3', 'backendVersion': 'FJHAI', 'builtAt': '2026-10-31T16:00:00+08:00'}
        package = self.work / 'FJHAI-Full.zip'
        payload = {'release.json': json.dumps(dict(version, packageType='full')).encode(),
                   'localdns/config/localdns.json': b'{}', 'localdns/rules/manual/': b'',
                   'localdns/ui/index.html': b'FJHAI UI', 'localdns/bin/localdns': b'new v3',
                   'LocalDNS_FJHAI_Binaries/localdns-amd64-v1': b'new v1'}
        write_archive(package, payload, version, {name: 0o100755 for name in payload if '/bin/' in name or 'Binaries/' in name})
        before = hashes(self.old)
        target = self.work / 'fjhai-stage'
        upgrade.prepare(self.old, package, upgrade.sha(package), target, 'amd64-v1')
        self.assertEqual(hashes(self.old), before)
        self.assertEqual(read_json(target / upgrade.MARKER)['report']['targetBackend'], 'FJHAI')
        self.assertEqual((target / 'bin/localdns').read_bytes(), b'new v1')
        for relative in ('config/upstreams', 'config/subscriptions', 'rules/manual'):
            self.assertEqual(hashes(self.old / relative), hashes(target / relative))
        self.assertEqual(read_json(target / 'config/settings/client_aliases.json'), {'192.0.2.1': '我的电脑'})

    def test_rejects_unverified_backup_or_settings_changed_since_backup(self):
        self.ready()
        with self.assertRaisesRegex(MigrationError, '备份摘要'):
            upgrade.apply(self.old, self.new, self.archive, '0' * 64, 'openrc')
        (self.old / 'rules/manual/direct_domains.txt').write_bytes(b'changed\n')
        with self.assertRaisesRegex(MigrationError, '原设置已变化'):
            upgrade.apply(self.old, self.new, self.archive, self.sha, 'openrc')

    def test_health_failure_restores_whole_old_directory(self):
        self.ready()
        before = hashes(self.old)
        with patch.object(upgrade.installer, 'manage') as service, patch.object(upgrade, 'updater', return_value=False), \
             patch.object(upgrade.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(upgrade, 'verify', side_effect=MigrationError('health failed')):
            with self.assertRaisesRegex(MigrationError, 'health failed'):
                upgrade.apply(self.old, self.new, self.archive, self.sha, 'openrc')
        self.assertEqual(hashes(self.old), before)
        self.assertFalse(upgrade.journal_path(self.old).exists())
        self.assertTrue(list(self.work.glob('localdns.failed-fjgli-*')))
        self.assertGreaterEqual(service.call_count, 4)


class TrafficFingerprintTests(unittest.TestCase):
    """Runtime traffic statistics must not invalidate the settings fingerprint."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for folder in ('config', 'rules/manual', 'ui/custom'):
            (self.root / folder).mkdir(parents=True)
        write_json(self.root / 'config/settings/switches.json', {'adguard': True})
        write_json(self.root / 'ui/custom/settings.json', {'localdns': {'name': 'LocalDNS'}})
        self.traffic = {'version': 2, 'updated': '2026-11-06T06:54:21+08:00', 'date': '2026-11-06',
                        'source': 'mihomo', 'publish_interval_seconds': 30.0,
                        'today': {'down': 412418177, 'up': 11258303}, 'total': {'down': 8595891730, 'up': 261876867},
                        'days': 5, 'connections': {'active': 95, 'proxied': 23}}
        write_json(self.root / 'ui/custom/traffic.json', self.traffic)
        write_json(self.root / 'ui/custom/traffic-detail.json', dict(self.traffic, daily=[{'down': 2032502437}]))

    def republish(self, **changes):
        """Simulate the core republishing the traffic statistics."""
        updated = dict(self.traffic, **changes)
        write_json(self.root / 'ui/custom/traffic.json', updated)
        write_json(self.root / 'ui/custom/traffic-detail.json', dict(updated, daily=[{'down': 999}]))

    def test_fingerprint_ignores_republished_traffic_statistics(self):
        before = upgrade.fingerprint(self.root)
        self.republish(updated='2026-11-06T06:55:21+08:00', today={'down': 1}, total={'down': 2},
                       connections={'active': 120})
        self.assertEqual(upgrade.fingerprint(self.root), before)

    def test_hashes_detect_republished_traffic_statistics(self):
        before = hashes(self.root / 'ui')
        self.republish(updated='2026-11-06T06:55:21+08:00', today={'down': 1})
        after = hashes(self.root / 'ui')
        for name in ('custom/traffic.json', 'custom/traffic-detail.json'):
            self.assertNotEqual(after[name], before[name])

    def test_source_runtime_ignores_republished_traffic_statistics(self):
        before = upgrade.source_runtime_fingerprint(self.root)
        self.republish(updated='2026-11-06T06:55:21+08:00', today={'down': 1})
        self.assertEqual(upgrade.source_runtime_fingerprint(self.root), before)

    def test_settings_and_source_runtime_ignore_midnight_rollover(self):
        settings = upgrade.fingerprint(self.root)
        runtime = upgrade.source_runtime_fingerprint(self.root)
        self.republish(updated='2026-11-07T00:00:01+08:00', date='2026-11-07', days=6)
        self.assertEqual(upgrade.fingerprint(self.root), settings)
        self.assertEqual(upgrade.source_runtime_fingerprint(self.root), runtime)

    def test_unknown_traffic_fields_are_still_detected(self):
        settings = upgrade.fingerprint(self.root)
        runtime = upgrade.source_runtime_fingerprint(self.root)
        self.republish(future_setting='changed')
        self.assertNotEqual(upgrade.fingerprint(self.root), settings)
        self.assertNotEqual(upgrade.source_runtime_fingerprint(self.root), runtime)

    def test_only_exact_publication_paths_are_normalized(self):
        path = self.root / 'ui/custom/nested/custom/traffic.json'
        write_json(path, {'total': {'down': 1}})
        settings = upgrade.fingerprint(self.root)
        runtime = upgrade.source_runtime_fingerprint(self.root)
        write_json(path, {'total': {'down': 2}})
        self.assertNotEqual(upgrade.fingerprint(self.root), settings)
        self.assertNotEqual(upgrade.source_runtime_fingerprint(self.root), runtime)

    def test_invalid_traffic_data_stops_live_comparison(self):
        path = self.root / 'ui/custom/traffic.json'
        for data in ('{invalid', '[]'):
            with self.subTest(data=data):
                path.write_text(data, encoding='utf-8')
                for compare in (upgrade.fingerprint, upgrade.source_runtime_fingerprint):
                    with self.assertRaises(MigrationError):
                        compare(self.root)
                self.assertIn('custom/traffic.json', hashes(self.root / 'ui'))

    def test_real_user_changes_are_still_detected(self):
        before = upgrade.fingerprint(self.root)
        write_json(self.root / 'ui/custom/settings.json', {'localdns': {'name': '我的 DNS'}})
        write_json(self.root / 'config/settings/switches.json', {'adguard': False})
        after = upgrade.fingerprint(self.root)
        self.assertNotEqual(after['ui/custom/settings.json'], before['ui/custom/settings.json'])
        self.assertNotEqual(after['config/settings/switches.json'], before['config/settings/switches.json'])


class VerifyVersionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        write_json(self.root / 'config/localdns.json', {'cache_memory_mb': 150})
        write_json(self.root / 'config/upstreams/domestic.json', {'upstreams': ['192.0.2.53']})
        write_json(self.root / 'config/settings/client_aliases.json', {})
        write_json(self.root / 'config/settings/switches.json', {'full_cache': True})
        self.contract = {'schema': 1, 'apiFamily': 'localdns-v1', 'configSchema': 1}

    def check(self, running):
        responses = {
            '/api/v1/status': {'version': running},
            '/api/v1/upstream/config': {'domestic': ['192.0.2.53']},
            '/api/v1/client-aliases': {},
            '/api/v1/features': {'full_cache': True},
            '/api/v1/cache/settings': {'cache_memory_mb': 150},
        }
        with patch.object(upgrade, 'api', side_effect=lambda port, path: responses.get(path, {})), \
             patch.object(upgrade.time, 'sleep'), \
             patch.object(upgrade, 'dns', side_effect=lambda port, protocol: {'protocol': protocol, 'answers': 1}) as dns:
            result = upgrade.verify(self.root, 19000, 1053, 1053)
        self.assertEqual(result['version'], running)
        self.assertEqual(result['cacheMemoryMb'], 150)
        self.assertEqual([call.args for call in dns.call_args_list], [(1053, 'udp'), (1053, 'tcp')])
        return result

    def test_fjn01_without_marker_accepts_ui_version_with_or_without_contract(self):
        for metadata in ({'backendVersion': 'FJN01'},
                         {'backendVersion': 'FJN01', 'updateCompatibility': self.contract}):
            with self.subTest(metadata=metadata):
                write_json(self.root / 'ui/version.json', metadata)
                self.assertFalse((self.root / 'core-version.json').exists())
                self.check('FJN01')

    def test_future_compatible_ui_without_marker_uses_its_exact_version(self):
        write_json(self.root / 'ui/version.json', {'backendVersion': 'FJNEW', 'updateCompatibility': self.contract})
        self.check('FJNEW')
        with self.assertRaisesRegex(MigrationError, 'FJNEW 管理接口未就绪'):
            self.check('FJMOS')

    def test_unknown_ui_without_valid_contract_does_not_accept_unknown_core(self):
        for contract in (None, dict(self.contract, configSchema=2)):
            with self.subTest(contract=contract):
                metadata = {'backendVersion': 'FJNEW'}
                if contract is not None:
                    metadata['updateCompatibility'] = contract
                write_json(self.root / 'ui/version.json', metadata)
                with self.assertRaisesRegex(MigrationError, '管理接口未就绪'):
                    self.check('FJNEW')

    def test_core_marker_takes_precedence_after_ui_only_upgrade(self):
        write_json(self.root / 'core-version.json', {'backendVersion': 'FJMOS'})
        write_json(self.root / 'ui/version.json', {'backendVersion': 'FJN01', 'updateCompatibility': self.contract})
        self.check('FJMOS')
        with self.assertRaisesRegex(MigrationError, 'FJMOS 管理接口未就绪'):
            self.check('FJN01')

    def test_fjn01_ui_fallback_rejects_a_different_running_core(self):
        write_json(self.root / 'ui/version.json', {'backendVersion': 'FJN01', 'updateCompatibility': self.contract})
        with self.assertRaisesRegex(MigrationError, 'FJN01 管理接口未就绪'):
            self.check('FJMOS')


if __name__ == '__main__':
    unittest.main()
