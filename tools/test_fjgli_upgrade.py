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


if __name__ == '__main__':
    unittest.main()
