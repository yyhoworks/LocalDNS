"""Companion service upgrades (ProxyConfig, mihomo-return-guard) driven by the web updater.

Nothing here touches the host: companion_services runs against a temporary
prefix with a fake service manager, and the updater tests use stub upgraders.
"""
import hashlib
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import companion_services as cs
import install_localdns as installer
import install_online_updater as setup
import online_updater as online
import package_ui
import ui_updater as http
import upgrade_localdns as upgrade
from fjgli_config import read_json, write_json
import subprocess
import test_online_updater

REAL_RUN = subprocess.run

TOOLS = Path(__file__).resolve().parent


def elf(arch, marker=b''):
    data = bytearray(b'\x7fELF\x02\x01' + b'\0' * 58)
    struct.pack_into('<H', data, 18, cs.ELF_MACHINE[arch])
    return bytes(data) + marker


def service_payload(marker=b'new', ui_version='2026.11.01.12'):
    """Files of a ProxyConfig Service.zip (relative names), with consistent release.json."""
    files = {'bin/localdns-proxy-config-linux-' + arch: elf(arch, marker) for arch in ('amd64', 'arm64')}
    files.update({'localdns-proxy-config.initd': b'#!/sbin/openrc-run\n# new\n',
                  'localdns-proxy-config.service': b'[Service]\n# new\n',
                  'README.md': b'readme', 'licenses/Go-LICENSE.txt': b'license'})
    files['release.json'] = json.dumps({'uiVersion': ui_version, 'backendVersion': 'FJMOS', 'packageType': 'proxy-config-service',
                                        'serviceVersion': '1.6.0', 'binaries': {
                                            'linux/' + arch: {'sha256': hashlib.sha256(files['bin/localdns-proxy-config-linux-' + arch]).hexdigest()}
                                            for arch in ('amd64', 'arm64')}}).encode()
    return files


class FakeSystem(cs.System):
    def __init__(self, prefix, running=True, healthy=True, restart_ok=True, check_ok=True):
        super().__init__(prefix, init='none')
        self.running = {cs.PROXY_SERVICE: running, cs.GUARD_SERVICE: running}
        self.healthy = healthy
        self.restart_ok = restart_ok
        self.check_ok = check_ok
        self.calls = []
        self.reloads = 0

    def service(self, name, action):
        self.calls.append((name, action))
        if action == 'status':
            return self.running[name]
        return self.restart_ok

    def daemon_reload(self):
        self.reloads += 1

    def http_json(self, host, port, host_header, path, timeout=3):
        self.calls.append(('probe', host, port, host_header, path))
        healthy = self.healthy() if callable(self.healthy) else self.healthy
        if not healthy:
            raise ConnectionRefusedError('refused')
        return {'service': cs.PROXY_SERVICE, 'version': '1.6.0'}

    def guard_check(self, script):
        self.calls.append(('check', Path(script).read_bytes()))
        ok = self.check_ok(Path(script)) if callable(self.check_ok) else self.check_ok
        if not ok:
            raise cs.CompanionError('--check 没有输出约定的 JSON')
        return {'ok': True, 'ready': True, 'ipv4': [], 'ipv6': []}

    def sleep(self, seconds):
        pass


class CompanionServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.prefix = self.work / 'host'
        self.package = self.work / 'package'
        for name, data in service_payload().items():
            path = self.package / 'companion/proxy-config' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        guard = self.package / 'companion/mihomo-return-guard/guard.py'
        guard.parent.mkdir(parents=True)
        guard.write_text('print("new guard")\n')
        self.patch_health_wait()

    def patch_health_wait(self):
        original = cs.proxy_health
        self.enterContext(patch.object(cs, 'proxy_health', side_effect=lambda system, config, wait=20.0: original(system, config, 0)))

    def host(self, *relative):
        return self.prefix.joinpath(*relative)

    def install_proxy(self, binary=b'old binary', units=('init.d',)):
        binary_path = self.host('opt/localdns-proxy-config/bin/localdns-proxy-config')
        binary_path.parent.mkdir(parents=True)
        binary_path.write_bytes(binary)
        binary_path.chmod(0o755)
        write_json(self.host('etc/localdns-proxy-config.json'), {'listen': '0.0.0.0:9198', 'hosts': ['192.0.2.2:9198'],
                                                                  'origins': ['http://192.0.2.2:9099'], 'cores': {}})
        if 'init.d' in units:
            self.host('etc/init.d').mkdir(parents=True, exist_ok=True)
            self.host('etc/init.d/localdns-proxy-config').write_bytes(b'#!/sbin/openrc-run\n# old\n')
        return binary_path

    def install_guard(self, content=b'print("old guard")\n'):
        path = self.host('usr/local/sbin/mihomo-return-guard.py')
        path.parent.mkdir(parents=True)
        path.write_bytes(content)
        path.chmod(0o750)
        return path

    def proxy_result(self, report):
        return next(item for item in report['results'] if item['service'] == 'proxy-config')

    def guard_result(self, report):
        return next(item for item in report['results'] if item['service'] == 'mihomo-return-guard')

    def test_nothing_installed_is_skipped_and_nothing_is_created(self):
        system = FakeSystem(self.prefix)
        report = cs.run(self.package, system, 'x86_64')
        self.assertEqual([item['status'] for item in report['results']], ['skipped', 'skipped'])
        self.assertFalse(self.prefix.exists())
        self.assertEqual(system.calls, [])

    def test_config_without_binary_or_package_without_payload_is_skipped(self):
        write_json(self.host('etc/localdns-proxy-config.json'), {'listen': '127.0.0.1:9098'})
        self.assertEqual(self.proxy_result(cs.run(self.package, FakeSystem(self.prefix), 'amd64'))['status'], 'skipped')
        self.install_proxy_binary_only = self.host('opt/localdns-proxy-config/bin/localdns-proxy-config')
        self.install_proxy_binary_only.parent.mkdir(parents=True)
        self.install_proxy_binary_only.write_bytes(b'old')
        empty = self.work / 'empty-package'
        empty.mkdir()
        result = self.proxy_result(cs.run(empty, FakeSystem(self.prefix), 'amd64'))
        self.assertEqual(result['status'], 'skipped')
        self.assertEqual(self.install_proxy_binary_only.read_bytes(), b'old')

    def test_installed_older_proxy_config_is_upgraded_restarted_and_probed(self):
        binary = self.install_proxy()
        config_before = self.host('etc/localdns-proxy-config.json').read_bytes()
        system = FakeSystem(self.prefix)
        result = self.proxy_result(cs.run(self.package, system, 'aarch64'))
        self.assertEqual(result['status'], 'upgraded', result)
        self.assertEqual(binary.read_bytes(), elf('arm64', b'new'))
        self.assertEqual(binary.stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.host('etc/localdns-proxy-config.json').read_bytes(), config_before)
        # Only the service file that already existed is replaced; no systemd unit appears.
        self.assertEqual(self.host('etc/init.d/localdns-proxy-config').read_bytes(), b'#!/sbin/openrc-run\n# new\n')
        self.assertFalse(self.host('etc/systemd').exists())
        self.assertIn((cs.PROXY_SERVICE, 'restart'), system.calls)
        self.assertIn(('probe', '127.0.0.1', 9198, '192.0.2.2:9198', '/healthz'), system.calls)
        backup = Path(result['backup'])
        self.assertEqual((backup / 'localdns-proxy-config.binary').read_bytes(), b'old binary')
        self.assertEqual((backup / 'localdns-proxy-config').read_bytes(), b'#!/sbin/openrc-run\n# old\n')

    def test_identical_program_is_left_alone(self):
        binary = self.install_proxy(binary=elf('amd64', b'new'))
        system = FakeSystem(self.prefix)
        result = self.proxy_result(cs.run(self.package, system, 'amd64'))
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(system.calls, [])
        self.assertFalse(self.host('opt/localdns-proxy-config/backups').exists())
        self.assertEqual(binary.read_bytes(), elf('amd64', b'new'))

    def test_stopped_service_is_replaced_without_restart(self):
        binary = self.install_proxy()
        system = FakeSystem(self.prefix, running=False)
        result = self.proxy_result(cs.run(self.package, system, 'amd64'))
        self.assertEqual(result['status'], 'upgraded')
        self.assertEqual(binary.read_bytes(), elf('amd64', b'new'))
        self.assertNotIn((cs.PROXY_SERVICE, 'restart'), system.calls)

    def test_failed_health_check_restores_old_program_and_service_file(self):
        binary = self.install_proxy()
        # Unhealthy with the new program, healthy again once the old one is back.
        system = FakeSystem(self.prefix)
        system.healthy = lambda: binary.read_bytes() == b'old binary'
        result = self.proxy_result(cs.run(self.package, system, 'amd64'))
        self.assertEqual(result['status'], 'rolled_back', result)
        self.assertIn('健康检查失败', result['message'])
        self.assertEqual(binary.read_bytes(), b'old binary')
        self.assertEqual(self.host('etc/init.d/localdns-proxy-config').read_bytes(), b'#!/sbin/openrc-run\n# old\n')
        self.assertEqual(system.calls.count((cs.PROXY_SERVICE, 'restart')), 2)

    def test_unconfirmed_restore_is_reported_as_failed_with_backup_path(self):
        binary = self.install_proxy()
        result = self.proxy_result(cs.run(self.package, FakeSystem(self.prefix, healthy=False), 'amd64'))
        self.assertEqual(result['status'], 'failed')
        self.assertIn(result['backup'], result['message'])
        self.assertEqual(binary.read_bytes(), b'old binary')

    def test_tampered_payload_never_replaces_the_program(self):
        binary = self.install_proxy()
        (self.package / 'companion/proxy-config/bin/localdns-proxy-config-linux-amd64').write_bytes(elf('amd64', b'evil'))
        result = self.proxy_result(cs.run(self.package, FakeSystem(self.prefix), 'amd64'))
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(binary.read_bytes(), b'old binary')
        # A wrong-architecture program is rejected as well.
        self.install_arm_as_amd = self.package / 'companion/proxy-config/bin/localdns-proxy-config-linux-amd64'
        self.install_arm_as_amd.write_bytes(elf('arm64', b'new'))
        release = read_json(self.package / 'companion/proxy-config/release.json')
        release['binaries']['linux/amd64']['sha256'] = cs.sha(self.install_arm_as_amd)
        write_json(self.package / 'companion/proxy-config/release.json', release)
        result = self.proxy_result(cs.run(self.package, FakeSystem(self.prefix), 'amd64'))
        self.assertEqual(result['status'], 'failed')
        self.assertIn('架构', result['message'])
        self.assertEqual(binary.read_bytes(), b'old binary')

    def test_symlinked_install_is_refused(self):
        real = self.work / 'elsewhere'
        real.write_bytes(b'old')
        binary = self.host('opt/localdns-proxy-config/bin/localdns-proxy-config')
        binary.parent.mkdir(parents=True)
        binary.symlink_to(real)
        write_json(self.host('etc/localdns-proxy-config.json'), {'listen': '127.0.0.1:9098'})
        result = self.proxy_result(cs.run(self.package, FakeSystem(self.prefix), 'amd64'))
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(real.read_bytes(), b'old')

    def test_backups_are_pruned_to_the_newest_few(self):
        binary = self.install_proxy()
        backups = self.host('opt/localdns-proxy-config/backups')
        for index in range(5):
            (backups / ('upgrade-2026010%d-000000-aaaaaa' % index)).mkdir(parents=True)
        (backups / 'install-20260101-000000-1').mkdir()
        cs.run(self.package, FakeSystem(self.prefix), 'amd64')
        names = sorted(p.name for p in backups.iterdir())
        self.assertEqual(len([n for n in names if n.startswith('upgrade-')]), cs.BACKUP_KEEP)
        self.assertIn('install-20260101-000000-1', names)
        self.assertEqual(binary.read_bytes(), elf('amd64', b'new'))

    def test_guard_is_upgraded_only_when_installed_and_rolled_back_when_unhealthy(self):
        guard = self.install_guard()
        system = FakeSystem(self.prefix)
        result = self.guard_result(cs.run(self.package, system, 'amd64'))
        self.assertEqual(result['status'], 'upgraded', result)
        self.assertEqual(guard.read_text(), 'print("new guard")\n')
        self.assertEqual(guard.stat().st_mode & 0o777, 0o750)
        self.assertIn((cs.GUARD_SERVICE, 'restart'), system.calls)
        # Unhealthy after restart: the previous script comes back.
        guard.write_bytes(b'print("old guard")\n')
        system = FakeSystem(self.prefix, check_ok=lambda script: b'old' in script.read_bytes())
        result = self.guard_result(cs.run(self.package, system, 'amd64'))
        self.assertEqual(result['status'], 'rolled_back', result)
        self.assertEqual(guard.read_bytes(), b'print("old guard")\n')

    def test_guard_that_does_not_compile_is_never_installed(self):
        guard = self.install_guard()
        (self.package / 'companion/mihomo-return-guard/guard.py').write_text('def broken(:\n')
        system = FakeSystem(self.prefix)
        result = self.guard_result(cs.run(self.package, system, 'amd64'))
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(guard.read_bytes(), b'print("old guard")\n')
        self.assertEqual(system.calls, [])

    def test_endpoint_and_command_line_output(self):
        self.assertEqual(cs.proxy_endpoint({'listen': '[::]:9098'}), ('::1', 9098, '[::]:9098'))
        self.assertEqual(cs.proxy_endpoint({'listen': '192.0.2.2:9098', 'hosts': ['dns.lan:9098']}),
                         ('192.0.2.2', 9098, 'dns.lan:9098'))
        output = io.StringIO()
        with patch('sys.stdout', output):
            self.assertEqual(cs.main(['--package', str(self.package), '--prefix', str(self.prefix), '--arch', 'amd64', '--json']), 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report['schema'], 1)
        self.assertEqual([item['status'] for item in report['results']], ['skipped', 'skipped'])


class HookTests(unittest.TestCase):
    """The updater side: run the package's own upgrader, never fail because of it."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.package = Path(self.temporary.name)
        (self.package / 'ui-updater').mkdir()

    def script(self, body):
        (self.package / 'ui-updater/companion_services.py').write_text(body)

    def test_missing_upgrader_is_a_silent_no_op(self):
        report = http.run_companions(self.package)
        self.assertEqual(report['results'], [])
        self.assertEqual(http.companion_summary(report), '')

    def test_crash_timeout_or_garbage_becomes_a_warning(self):
        for body in ('raise SystemExit(3)\n', 'print("not json")\n', 'import sys; sys.stderr.write("boom"); sys.exit(1)\n'):
            with self.subTest(body=body):
                self.script(body)
                report = http.run_companions(self.package)
                self.assertIn('error', report)
                self.assertIn('不影响本次更新', http.companion_summary(report))
        self.script('import time; time.sleep(5)\n')
        with patch.object(http, 'COMPANION_TIMEOUT', 0.5):
            report = http.run_companions(self.package)
        self.assertIn('error', report)

    def test_summary_names_upgrades_and_rollbacks(self):
        self.script('import json; print(json.dumps({"schema": 1, "results": ['
                    '{"service": "proxy-config", "status": "upgraded", "message": "ok", "version": "1.6.0"},'
                    '{"service": "mihomo-return-guard", "status": "rolled_back", "message": "检查失败"}]}))\n')
        report = http.run_companions(self.package)
        summary = http.companion_summary(report)
        self.assertIn('代理配置服务已同步升级', summary)
        self.assertIn('Mihomo 回程守护升级未通过检查，已恢复原程序', summary)
        self.assertEqual(http.companion_brief(report)[0], {'service': 'proxy-config', 'status': 'upgraded',
                                                           'message': 'ok', 'version': '1.6.0'})


STUB_OK = ('import json, pathlib, sys\n'
           'package = pathlib.Path(sys.argv[sys.argv.index("--package") + 1])\n'
           'marker = package / "companion/marker.txt"\n'
           'print(json.dumps({"schema": 1, "results": [{"service": "proxy-config", '
           '"status": "upgraded" if marker.is_file() else "skipped", "message": "stub"}]}))\n')
STUB_ROLLBACK = ('import json\nprint(json.dumps({"schema": 1, "results": [{"service": "proxy-config", '
                 '"status": "rolled_back", "message": "健康检查失败"}]}))\n')
STUB_CRASH = 'raise RuntimeError("companion upgrader crashed")\n'


class UpdaterIntegrationTests(unittest.TestCase):
    """The persistent updater runs the companion step from the verified release package."""

    api = test_online_updater.OnlineTests.api
    manager_at = test_online_updater.OnlineTests.manager_at
    finish = test_online_updater.OnlineTests.finish
    prepare = test_online_updater.OnlineTests.prepare
    preflight = test_online_updater.OnlineTests.preflight
    continue_update = test_online_updater.OnlineTests.continue_update

    def setUp(self):
        test_online_updater.OnlineTests.setUp(self)
        self.addCleanup(self.temporary.cleanup)

    def package(self, version=None, stub=STUB_OK, with_payload=True):
        """Same packages as OnlineTests, plus the new companion upgrader and payload."""
        version = version or self.version
        for path in self.packages.iterdir():
            path.unlink()
        for kind in ('full', 'ui-update'):
            prefix = 'localdns/' if kind == 'full' else ''
            metadata = dict(version, packageType=kind)
            payload = {prefix + 'ui/index.html': b'new UI', prefix + 'ui/config.js': b'default',
                       prefix + 'ui/version.json': json.dumps(version).encode(), 'release.json': json.dumps(metadata).encode()}
            if stub is not None:
                payload['ui-updater/companion_services.py'] = stub.encode()
            if with_payload:
                payload['companion/marker.txt'] = b'payload'
            if kind == 'full':
                payload.update({'localdns/config/localdns.json': b'{}', 'localdns/bin/localdns': b'new core',
                                'LocalDNS_' + version['backendVersion'] + '_Binaries/localdns-amd64-v1': b'new core'})
            name = 'LocalDNS_Test_' + ('Full' if kind == 'full' else 'Update') + '.zip'
            package_ui.write_archive(self.packages / name, payload, metadata,
                                     {n: 0o100755 for n in payload if '/bin/' in n or 'Binaries/' in n})
        (self.packages / 'SHA256SUMS.txt').write_text(''.join(upgrade.sha(p) + '  ' + p.name + '\n' for p in self.packages.glob('*.zip')))

    def test_ui_upgrade_runs_companions_from_the_package(self):
        self.manager.start(self.version['releaseTag'], mode='ui')
        status = self.finish()
        self.assertEqual(status['state'], 'succeeded', status)
        self.assertIn('代理配置服务已同步升级', status['message'])
        self.assertEqual(status['companions'], [{'service': 'proxy-config', 'status': 'upgraded', 'message': 'stub'}])
        self.assertTrue(status['canRollback'])
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), b'new UI')

    def test_companion_rollback_or_crash_still_succeeds_the_ui_upgrade(self):
        for stub, expected in ((STUB_ROLLBACK, '已恢复原程序'), (STUB_CRASH, '配套服务检查未完成')):
            with self.subTest(expected=expected):
                write_json(self.root / 'ui/version.json', dict(self.version, uiVersion='2026.10.30.1', backendVersion='FJH7T'))
                self.package(stub=stub)
                self.manager.start(self.version['releaseTag'], mode='ui')
                status = self.finish()
                self.assertEqual(status['state'], 'succeeded', status)
                self.assertIn(expected, status['message'])
                self.assertIn('不影响本次更新', status['message'])
                self.assertEqual(status['installedVersion'], self.version['uiVersion'])

    def test_old_package_without_upgrader_behaves_exactly_as_before(self):
        self.package(stub=None, with_payload=False)
        self.manager.start(self.version['releaseTag'], mode='ui')
        status = self.finish()
        self.assertEqual(status['state'], 'succeeded')
        self.assertEqual(status['message'], 'UI 更新完成，DNS 核心与设置已保留，可以刷新使用。')
        self.assertEqual(status['companions'], [])

    def test_full_upgrade_runs_companions_after_the_verified_switch_and_core_mode_does_not(self):
        def real_companions(package):
            # continue_update stubs subprocess.run for the core service; the upgrader runs for real.
            with patch.object(subprocess, 'run', REAL_RUN):
                return http.run_companions(package)
        self.enterContext(patch.object(online, 'run_companions', side_effect=real_companions))
        self.prepare('full')
        job = self.manager.job_directory()
        self.assertTrue((job / 'companion-package/ui-updater/companion_services.py').is_file())
        result = self.continue_update()
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertIn('代理配置服务已同步升级', result['message'])
        self.assertFalse((job / 'companion-package').exists())
        # Core-only upgrades keep the UI and the companions as they are.
        write_json(self.root / 'core-version.json', {'backendVersion': 'FJH7T', 'updateCompatibility': online.CONTRACT})
        with patch.object(online, 'run_companions') as companions:
            self.prepare('core')
            result = self.continue_update()
        self.assertEqual(result['state'], 'succeeded', result)
        companions.assert_not_called()
        self.assertNotIn('companions', result)

    def test_legacy_updater_ui_path_runs_companions_too(self):
        manager = http.UpdateManager(self.root, self.work / 'legacy-state')
        write_json(self.root / 'ui/version.json', dict(self.version, uiVersion='2026.10.30.1'))
        manager.start(self.version['releaseTag'])
        manager.thread.join(10)
        status = manager.status()
        self.assertEqual(status['state'], 'succeeded', status)
        self.assertIn('代理配置服务已同步升级', status['message'])

    def test_an_old_engine_accepts_the_new_package_and_only_switches_the_ui(self):
        """Released updaters (2026.10.21.1 - 2026.11.01.12) only call extract_verified + update_ui.

        The extra companion files pass their manifest check and are ignored, so the
        first click from an old device upgrades the UI exactly as before and leaves
        companion services alone until the updater itself has been reinstalled.
        """
        (self.work / 'old-engine').mkdir()
        packages = self.original_factory(self.work / 'old-engine', directory=self.packages)
        payload, metadata = packages.get('ui')
        self.assertTrue((payload / 'ui-updater/companion_services.py').is_file())
        installer.update_ui(self.root, payload, metadata, backend_compatible=True)
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), b'new UI')
        self.assertFalse((self.root / 'companion').exists())

    def test_reinstalling_the_updater_from_an_extracted_package_upgrades_companions(self):
        package = self.work / 'extracted'
        (package / 'ui-updater').mkdir(parents=True)
        (package / 'companion').mkdir()
        (package / 'companion/marker.txt').write_text('payload')
        (package / 'ui-updater/companion_services.py').write_text(STUB_OK)
        calls = []
        with patch.object(setup, 'run_companions', side_effect=lambda p: calls.append(p) or http.run_companions(p)), \
             patch.object(setup, '__file__', str(package / 'ui-updater/install_online_updater.py')), \
             patch.object(installer, 'manager', return_value='openrc'), \
             patch.object(installer, 'run'), patch.object(installer, 'local_json', return_value={'protocol': 'localdns-updater/v2'}), \
             patch('upgrade_localdns.updater', return_value=False), \
             patch.object(installer, 'install_path', side_effect=lambda value, stage=None: self.root if value == '/opt/localdns'
                          else self.work / 'system' / value.strip('/')), \
             patch.object(setup, 'service_files', return_value={}), patch.object(setup, 'MODULES', ()):
            output = io.StringIO()
            with patch('sys.stdout', output):
                self.assertEqual(setup.main(['--origin', 'http://192.0.2.2:9099']), 0)
        self.assertEqual(calls, [package])
        self.assertIn('代理配置服务已同步升级', output.getvalue())


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.version = {'uiVersion': '2026.11.01.12', 'backendVersion': 'FJMOS', 'builtAt': '2026-11-02T15:50:00'}

    def service_zip(self, files):
        path = self.work / 'LocalDNS_ProxyConfig_UI_2026.11.01.12_Service.zip'
        package_ui.write_archive(path, files, self.version,
                                 {n: 0o100755 for n in files if n.startswith('bin/') or n.endswith('.initd')})
        return path

    def test_service_archive_is_embedded_with_executable_programs(self):
        path = self.service_zip(service_payload())
        data, embedded, modes = package_ui.read_proxy_config_service(path, self.version)
        self.assertEqual(data, path.read_bytes())
        self.assertIn('companion/proxy-config/bin/localdns-proxy-config-linux-arm64', embedded)
        self.assertNotIn('companion/proxy-config/MANIFEST.sha256', embedded)
        self.assertEqual(modes['companion/proxy-config/bin/localdns-proxy-config-linux-amd64'], 0o100755)
        # The embedded payload survives the release archive round trip and the engine's checks.
        update = self.work / 'update.zip'
        payload = dict(embedded, **{'release.json': json.dumps(dict(self.version, packageType='ui-update')).encode()})
        package_ui.write_archive(update, payload, self.version, modes)
        extracted = self.work / 'extracted'
        installer.extract_verified(update, extracted)
        self.assertTrue(os.access(extracted / 'companion/proxy-config/bin/localdns-proxy-config-linux-amd64', os.X_OK))
        self.assertEqual(cs.proxy_payload(extracted, 'amd64')[1]['serviceVersion'], '1.6.0')

    def test_wrong_release_tampered_binary_or_digest_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not from this release'):
            package_ui.read_proxy_config_service(self.service_zip(service_payload(ui_version='2026.10.31.1')), self.version)
        files = service_payload()
        files['bin/localdns-proxy-config-linux-amd64'] = elf('amd64', b'other')
        with self.assertRaisesRegex(ValueError, 'does not match'):
            package_ui.read_proxy_config_service(self.service_zip(files), self.version)
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            package_ui.read_proxy_config_service(self.service_zip(service_payload()), self.version, '0' * 64)

    def test_release_packages_ship_the_upgrader_and_guard(self):
        source = (TOOLS / 'package_ui.py').read_text(encoding='utf-8')
        self.assertIn("'companion_services.py'", source)
        for name in package_ui.GUARD_FILES:
            self.assertTrue((TOOLS.parent / 'services/mihomo-return-guard' / name).is_file())


if __name__ == '__main__':
    unittest.main()
