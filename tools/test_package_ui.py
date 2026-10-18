"""Kernel bundle tests: upstream wrappers, architecture and ambiguous/unsafe paths."""
import io
import struct
import unittest
import warnings
from zipfile import ZipFile, ZipInfo

from package_ui import read_kernel_bundle


class KernelBundleTests(unittest.TestCase):
    backend = 'FJGA7'

    def payload(self, wrapper=''):
        result = {}
        for platform, machine in [('amd64-v1', 62), ('amd64-v3', 62), ('arm64', 183)]:
            data = bytearray(64)
            data[:6] = b'\x7fELF\x02\x01'
            struct.pack_into('<H', data, 18, machine)
            result[wrapper + f'LocalDNS_FJGA7_Binaries/localdns-{platform}'] = bytes(data)
        default = wrapper + ('localdns/bin/localdns' if wrapper else 'LocalDNS_FJGA7/localdns/bin/localdns')
        result[default] = result[wrapper + 'LocalDNS_FJGA7_Binaries/localdns-amd64-v3']
        return result

    def read(self, payload):
        buffer = io.BytesIO()
        with ZipFile(buffer, 'w') as archive:
            for name, data in payload.items():
                info = ZipInfo(name)
                info.filename = name
                archive.writestr(info, data)
        with ZipFile(buffer) as archive:
            return read_kernel_bundle(archive, self.backend)

    def test_flat_and_wrapped_bundles_have_same_three_outputs(self):
        self.assertEqual(self.read(self.payload()), self.read(self.payload('LocalDNS_FJGA7/')))
        self.assertEqual(len(self.read(self.payload())), 3)

    def test_non_kernel_files_are_not_imported(self):
        source = self.payload()
        source['LocalDNS_FJGA7/localdns/config/localdns.json'] = b'private'
        source['LocalDNS_FJGA7/localdns/ui/index.html'] = b'old-ui'
        self.assertEqual(self.read(source), self.read(self.payload()))

    def test_nested_binaries_and_two_installation_variants(self):
        source = self.payload('LocalDNS_FJGA7/')
        nested = {key.replace('Binaries/localdns-', 'Binaries/localdns-FJGA7/localdns-'): value
                  for key, value in source.items() if not key.endswith('/bin/localdns')}
        default = source['LocalDNS_FJGA7/localdns/bin/localdns']
        for variant in ['保留原设置', '不保留原设置']:
            nested['LocalDNS_FJGA7/' + variant + '/localdns/bin/localdns'] = default
        self.assertEqual(self.read(nested), self.read(source))
        nested['LocalDNS_FJGA7/不保留原设置/localdns/bin/localdns'] = b'wrong'
        with self.assertRaisesRegex(ValueError, 'Default binary'):
            self.read(nested)

    def test_ambiguous_binary_directories_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.read(dict(self.payload(), **self.payload('wrapper/')))

    def test_wrong_architecture_is_rejected(self):
        source = self.payload()
        source['LocalDNS_FJGA7_Binaries/localdns-arm64'] = source['LocalDNS_FJGA7_Binaries/localdns-amd64-v3']
        with self.assertRaisesRegex(ValueError, 'architecture'):
            self.read(source)

    def test_default_binary_must_match(self):
        source = self.payload()
        source['LocalDNS_FJGA7/localdns/bin/localdns'] = b'other'
        with self.assertRaisesRegex(ValueError, 'Default binary'):
            self.read(source)

    def test_unsafe_paths_are_rejected(self):
        for path in ['../outside', '/outside', 'C:/outside', 'folder\\outside']:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'Unsafe'):
                self.read(dict(self.payload(), **{path: b'x'}))

    def test_duplicate_entries_are_rejected(self):
        buffer = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with ZipFile(buffer, 'w') as archive:
                for name, data in self.payload().items():
                    archive.writestr(name, data)
                archive.writestr('LocalDNS_FJGA7/localdns/bin/localdns', b'duplicate')
        with ZipFile(buffer) as archive, self.assertRaisesRegex(ValueError, 'Invalid'):
            read_kernel_bundle(archive, self.backend)


if __name__ == '__main__':
    unittest.main()
