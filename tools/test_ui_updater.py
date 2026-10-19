"""Exercise real update transactions and authenticated HTTP against isolated files."""
import contextlib
import io
import json
import secrets
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import install_localdns as installer
import install_ui_updater as setup
import ui_updater as updater
from package_ui import json_bytes, write_archive
import test_oneclick_installer as fixtures

VERSION = fixtures.VERSION


class _UpdateFixture(unittest.TestCase):
    archive = fixtures.InstallerTests.archive
    refresh_sums = fixtures.InstallerTests.refresh_sums
    install = fixtures.InstallerTests.install
    tearDown = fixtures.InstallerTests.tearDown

    def setUp(self):
        fixtures.InstallerTests.setUp(self)
        # The updater tests begin with an existing installation. Fresh installation
        # is covered separately; avoid repeating Windows scans of renamed ELF trees.
        for name, data in self.payload.items():
            if name.startswith('localdns/'):
                file = self.root / name[len('localdns/'):]
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(data)
        self.metadata = dict(VERSION, uiVersion='2026.10.19.6', packageType='ui-update')
        for file in self.packages.glob('*_Update.zip'):
            file.unlink()
        self.archive_path = self.packages / 'LocalDNS_UI_2026.10.19.6_Update.zip'
        payload = {'ui/index.html': b'<html>upgraded UI</html>',
                   'ui/config.js': b'package default config',
                   'ui/version.json': json_bytes(self.metadata),
                   'release.json': json_bytes(self.metadata)}
        write_archive(self.archive_path, payload, self.metadata, {})
        self.refresh_sums()
        self.manager = updater.UpdateManager(self.root)
        self.factory = installer.Packages

    def package(self, work, _tag):
        return self.factory(work, directory=self.packages)

    def core(self, _port, path):
        return self.manager.installed_version() if path == '/ui/version.json' else {'ok': True}

    def finish(self):
        self.manager.thread.join(timeout=8)
        self.assertFalse(self.manager.thread.is_alive())
        return self.manager.status()


class UIUpdaterTests(_UpdateFixture):
    def test_web_upgrade_and_rollback_preserve_current_customization_and_core(self):
        original = (self.root / 'bin/localdns').read_bytes()
        site = self.root / 'ui/config.js'
        site.write_text('private site config', encoding='utf-8')
        custom = self.root / 'ui/custom/settings.json'
        custom.parent.mkdir()
        custom.write_bytes(b'shared settings')
        with patch.object(installer, 'Packages', side_effect=self.package), patch.object(installer, 'local_json', side_effect=self.core):
            self.manager.start('fjgac-ui-v2026.10.19.6')
            state = self.finish()
            self.assertEqual(state['state'], 'succeeded', state)
            self.assertEqual(state['installedVersion'], '2026.10.19.6')
            self.assertTrue(state['canRollback'])
            self.assertEqual(site.read_text(), 'private site config')
            custom.write_bytes(b'newest shared settings')
            self.manager.start(rollback=True)
            self.assertEqual(self.finish()['installedVersion'], VERSION['uiVersion'])
        self.assertEqual(custom.read_bytes(), b'newest shared settings')
        self.assertEqual((self.root / 'bin/localdns').read_bytes(), original)

    def test_bad_checksum_does_not_replace_ui(self):
        old = (self.root / 'ui/index.html').read_bytes()
        self.archive_path.write_bytes(self.archive_path.read_bytes() + b'tampered')
        with patch.object(installer, 'Packages', side_effect=self.package):
            self.manager.start('fjgac-ui-v2026.10.19.6')
            result = self.finish()
        self.assertEqual(result['state'], 'failed')
        self.assertIn('SHA-256', result['message'])
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), old)

    def test_rejects_downgrade_different_core_and_client_selected_paths(self):
        for tag in ['fjgac-ui-v2026.10.19.5', 'fjgad-ui-v2026.10.19.6', '../outside', 'https://example.com/update.zip']:
            with self.subTest(tag=tag), self.assertRaises(updater.UpdateError):
                self.manager.start(tag)
        self.assertFalse(self.manager.status()['canRollback'])

    def test_duplicate_request_returns_same_task_and_cli_shares_lock(self):
        entered, release = threading.Event(), threading.Event()
        def waiting(work, tag):
            entered.set()
            release.wait(5)
            return self.package(work, tag)
        with patch.object(installer, 'Packages', side_effect=waiting), patch.object(installer, 'local_json', side_effect=self.core):
            first = self.manager.start('fjgac-ui-v2026.10.19.6')
            try:
                self.assertTrue(entered.wait(3))
                self.assertEqual(self.manager.start('fjgac-ui-v2026.10.19.6')['jobId'], first['jobId'])
                with self.assertRaises(updater.UpdateError):
                    self.manager.start(rollback=True)
                with self.assertRaises(installer.InstallError), installer.locked(self.root):
                    self.fail('CLI overlapped the update')
            finally:
                release.set()
            self.assertEqual(self.finish()['state'], 'succeeded')

    def test_restart_recovers_an_unverified_directory_switch(self):
        old = (self.root / 'ui/index.html').read_bytes()
        (self.root / 'ui').rename(self.root / 'ui.previous-interrupted')
        (self.root / 'ui').mkdir()
        (self.root / 'ui/index.html').write_bytes(b'unverified')
        installer.atomic_json(self.root / '.ui-update-transaction.json',
                              {'previous': 'ui.previous-interrupted', 'staging': '.ui-stage-interrupted', 'verified': False})
        self.manager.save(state='running')
        recovered = updater.UpdateManager(self.root)
        self.assertEqual(recovered.status()['state'], 'failed')
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), old)
        self.assertFalse((self.root / '.ui-update-transaction.json').exists())

    def test_transaction_paths_cannot_escape_installation(self):
        installer.atomic_json(self.root / '.ui-update-transaction.json',
                              {'previous': '../outside', 'staging': '.ui-stage-interrupted'})
        with self.assertRaises(installer.InstallError):
            installer.recover_ui_update(self.root)
        self.assertTrue((self.root / 'ui/index.html').is_file())

    def test_killed_installer_releases_os_guard_and_stale_lock_is_recovered(self):
        code = ('import os,sys;from pathlib import Path;import install_localdns as i;'
                'c=i.locked(Path(sys.argv[1]));c.__enter__();os._exit(0)')
        subprocess.run([sys.executable, '-c', code, str(self.root)], cwd=Path(installer.__file__).parent, check=True)
        with installer.locked(self.root):
            self.assertTrue((self.root.parent / '.localdns-installer.lock').exists())

    def test_setup_is_optional_and_preserves_site_settings_and_password_on_reinstall(self):
        output = io.StringIO()
        arguments = ['--stage-root', str(self.stage), '--origin', 'http://dns.example:9099']
        before = (self.root / 'config/localdns.json').read_bytes()
        with contextlib.redirect_stdout(output):
            self.assertEqual(setup.main(arguments), 0)
        config = json.loads((self.root / '.ui-updater/config.json').read_text())
        self.assertNotIn('password', config)
        self.assertIn('http://dns.example:9100', (self.root / 'ui/config.js').read_text())
        self.assertTrue((self.root / 'bin/ui-updater/ui_updater.py').is_file())
        with contextlib.redirect_stdout(io.StringIO()):
            setup.main(arguments)
        again = json.loads((self.root / '.ui-updater/config.json').read_text())
        self.assertEqual(config['passwordHash'], again['passwordHash'])
        self.assertEqual((self.root / 'ui/config.js').read_text().count(setup.START), 1)
        self.assertEqual((self.root / 'config/localdns.json').read_bytes(), before)
        with self.assertRaises(installer.InstallError):
            setup.main(['--stage-root', str(self.stage), '--origin', 'https://dns.example'])

    def test_previous_build_assets_survive_one_update_without_retaining_older_extras(self):
        assets = self.root / 'ui/assets'
        assets.mkdir()
        (assets / 'old-hash.js').write_bytes(b'old lazy module')
        (assets / 'obsolete.js').write_bytes(b'older unlisted module')
        (self.root / 'ui/build-meta.json').write_bytes(json_bytes({'files': {'assets/old-hash.js': 'digest'}}))
        with patch.object(installer, 'Packages', side_effect=self.package), patch.object(installer, 'local_json', side_effect=self.core):
            self.manager.start('fjgac-ui-v2026.10.19.6')
            self.assertEqual(self.finish()['state'], 'succeeded')
        self.assertTrue((assets / 'old-hash.js').is_file())
        self.assertFalse((assets / 'obsolete.js').exists())

    def test_cli_can_bootstrap_updater_from_verified_package(self):
        from zipfile import ZipFile
        with ZipFile(self.archive_path) as archive:
            payload = {name: archive.read(name) for name in archive.namelist()}
        for name in ('install_ui_updater.py', 'ui_updater.py', 'install_localdns.py'):
            payload['ui-updater/' + name] = (Path(installer.__file__).parent / name).read_bytes()
        write_archive(self.archive_path, payload, self.metadata, {})
        self.refresh_sums()
        def run(arguments):
            return subprocess.run(arguments, check=True, stdout=subprocess.DEVNULL)
        with patch.object(installer, 'run', side_effect=run):
            self.assertEqual(self.install('--with-ui-updater'), 0)
        self.assertTrue((self.root / 'bin/ui-updater/ui_updater.py').is_file())
        self.assertIn('uiUpdaterBase', (self.root / 'ui/config.js').read_text())

    def test_old_package_cannot_silently_enable_missing_updater(self):
        before = (self.root / 'ui/index.html').read_bytes()
        with self.assertRaisesRegex(installer.InstallError, '尚未包含'):
            self.install('--with-ui-updater')
        self.assertEqual((self.root / 'ui/index.html').read_bytes(), before)


class UIUpdaterHTTPTests(_UpdateFixture):
    def setUp(self):
        super().setUp()
        self.password = 'test-only-' + secrets.token_hex(8)
        salt = secrets.token_hex(16)
        self.origin = 'http://127.0.0.1:9099'
        self.server = updater.UpdateServer(('127.0.0.1', 0), {
            'allowedOrigins': [self.origin], 'passwordSalt': salt,
            'passwordHash': updater.password_hash(self.password, salt)}, self.manager)
        self.serving = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.serving.start()
        self.base_url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.opener = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.serving.join(2)
        super().tearDown()

    def request(self, path, body=None, token=None, origin=None, host=None):
        headers = {'Origin': origin or self.origin, 'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if host:
            headers['Host'] = host
        request = Request(self.base_url + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            response = self.opener.open(request, timeout=4)
        except HTTPError as error:
            response = error
        with response:
            return response.code, json.load(response), response.headers

    def test_http_authorization_origin_host_and_expiry(self):
        self.assertEqual(self.request('/upgrade/ui')[1]['protocol'], updater.PROTOCOL)
        self.assertEqual(self.request('/upgrade/ui/status')[0], 401)
        self.assertEqual(self.request('/session', {'password': self.password}, origin='https://evil.example')[0], 403)
        self.assertEqual(self.request('/upgrade/ui', host='evil.example')[0], 403)
        status, data, headers = self.request('/session', {'password': self.password})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], self.origin)
        token = data['token']
        self.assertEqual(self.request('/upgrade/ui/status', token=token)[0], 200)
        for key in self.server.sessions:
            self.server.sessions[key] = time.monotonic() - 1
        self.assertEqual(self.request('/upgrade/ui/status', token=token)[0], 401)

    def test_http_runs_real_package_update_and_rejects_arbitrary_parameters(self):
        token = self.request('/session', {'password': self.password})[1]['token']
        self.assertEqual(self.request('/upgrade/ui', {'releaseTag': 'fjgac-ui-v2026.10.19.6', 'url': 'https://evil.example'}, token)[0], 400)
        with patch.object(installer, 'Packages', side_effect=self.package), patch.object(installer, 'local_json', side_effect=self.core):
            self.assertEqual(self.request('/upgrade/ui', {'releaseTag': 'fjgac-ui-v2026.10.19.6'}, token)[0], 202)
            self.assertEqual(self.finish()['state'], 'succeeded')
        state = self.request('/upgrade/ui/status', token=token)[1]
        self.assertEqual(state['installedVersion'], '2026.10.19.6')

    def test_password_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.request('/session', {'password': 'incorrect'})[0], 401)
        self.assertEqual(self.request('/session', {'password': self.password})[0], 429)


if __name__ == '__main__':
    import unittest
    unittest.main()
