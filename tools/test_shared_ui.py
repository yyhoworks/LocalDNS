"""Static config imports are validated and keep a recoverable previous directory."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from unittest.mock import patch

import configure_ui as ui


class SharedUITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'localdns'
        (self.root / 'ui').mkdir(parents=True)
        (self.root / 'ui/index.html').write_text('UI')

    def tearDown(self):
        self.temp.cleanup()

    def run_config(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            ui.main(['--dir', str(self.root), *map(str, args)])
        return json.loads((self.root / 'ui/custom/settings.json').read_text(encoding='utf-8'))

    def test_names_fonts_deduplication_and_backup(self):
        font = Path(self.temp.name) / 'sample.woff2'
        font.write_bytes(b'wOF2' + b'font fixture' * 3)
        value = self.run_config('--name', '共享 DNS', '--font', 'heading=' + str(font), '--font', 'body=' + str(font))
        self.assertEqual(value['localdns']['name'], '共享 DNS')
        self.assertEqual(len(value['fonts']), 1)
        self.assertEqual(value['typography']['heading'], value['typography']['body'])
        self.assertEqual((self.root / 'ui' / value['fonts'][0]['path']).read_bytes(), font.read_bytes())
        self.run_config('--proxy-url', 'http://192.0.2.2:9090/ui/')
        backups = list(self.root.glob('custom-backup-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads((backups[0] / 'settings.json').read_text(encoding='utf-8')), value)

    def test_invalid_font_does_not_replace_saved_settings(self):
        value = self.run_config('--name', '保留的名称')
        font = Path(self.temp.name) / 'bad.woff2'
        font.write_bytes(b'<html>not a font</html>')
        with self.assertRaises(ValueError):
            self.run_config('--font', 'heading=' + str(font))
        self.assertEqual(json.loads((self.root / 'ui/custom/settings.json').read_text(encoding='utf-8')), value)

    def test_old_service_settings_migrate_and_proxy_logo_is_ignored(self):
        old = Path(self.temp.name) / 'interface.json'
        old.write_text(json.dumps({'localdns': {'name': '原服务器名称', 'logo': ''},
                                   'proxy': {'name': '面板', 'url': 'http://192.0.2.2/ui', 'logo': 'https://example.test/old.png'}}), encoding='utf-8')
        value = self.run_config('--import-interface', old)
        self.assertEqual(value['localdns']['name'], '原服务器名称')
        self.assertNotIn('logo', value['proxy'])
        self.assertNotIn('companionService',value)

    def test_unexpected_zip_files_and_traversal_are_rejected(self):
        archive = Path(self.temp.name) / 'bad.zip'
        for name in ('../outside', 'C:/outside', '/outside', 'unexpected.js'):
            with ZipFile(archive, 'w') as z:
                z.writestr('settings.json', json.dumps(ui.DEFAULTS))
                z.writestr(name, 'data')
            with self.subTest(name=name), self.assertRaises(ValueError):
                ui.read_bundle(archive)
        self.assertFalse((self.root / 'ui/custom').exists())

    def test_rename_failure_restores_previous_settings(self):
        value = self.run_config('--name', '原配置')
        rename = Path.rename
        def fail_stage(path, target):
            if '.custom-stage-' in str(path):
                raise OSError('simulated rename failure')
            return rename(path, target)
        with patch.object(Path, 'rename', fail_stage), self.assertRaises(OSError):
            self.run_config('--name', '未写入的配置')
        self.assertEqual(json.loads((self.root / 'ui/custom/settings.json').read_text(encoding='utf-8')), value)

    def test_font_selection_must_exist(self):
        value = json.loads(json.dumps(ui.DEFAULTS))
        value['typography']['heading'] = 'upmissing'
        with self.assertRaises(ValueError):
            ui.validate(value, {})


if __name__ == '__main__':
    unittest.main()
