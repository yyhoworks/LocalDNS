"""Upstream ZIP layouts, architecture selection and hostile/corrupt input."""
import io
import struct
import unittest
import warnings
from zipfile import ZipFile, ZipInfo

from core_upload import read_kernel
from ui_updater import UpdateError


def elf(machine=62):
    data = bytearray(64)
    data[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', data, 18, machine)
    return bytes(data)


def bundle(backend='FJNEW', wrapper='', nested=False):
    prefix = wrapper + 'LocalDNS_' + backend + '_Binaries/'
    if nested:
        prefix += 'localdns-' + backend + '/'
    return {prefix + 'localdns-amd64-v1': elf(), prefix + 'localdns-amd64-v3': elf() + b'v3',
            prefix + 'localdns-arm64': elf(183), wrapper + 'install.sh': b'do not execute',
            wrapper + 'localdns/config/localdns.json': b'private defaults to ignore'}


def zipped(payload):
    output = io.BytesIO()
    with ZipFile(output, 'w') as archive:
        for name, data in payload.items():
            info = ZipInfo(name)
            info.filename = name  # Preserve intentionally unsafe raw names on Windows.
            archive.writestr(info, data)
    return output.getvalue()


class CoreUploadTests(unittest.TestCase):
    def test_selects_architecture_in_flat_wrapped_and_nested_upstream_packages(self):
        for wrapper, nested in [('', False), ('LocalDNS_FJNEW/', False), ('LocalDNS_FJNEW/', True)]:
            for arch, expected in [('amd64-v1', elf()), ('amd64-v3', elf() + b'v3'), ('arm64', elf(183))]:
                with self.subTest(wrapper=wrapper, nested=nested, arch=arch):
                    backend, data = read_kernel(io.BytesIO(zipped(bundle(wrapper=wrapper, nested=nested))), arch)
                    self.assertEqual(backend, 'FJNEW')
                    self.assertEqual(data, expected)

    def test_missing_architecture_wrong_machine_and_invalid_elf_stop_before_staging(self):
        for data in [b'not an ELF', elf(183)]:
            payload = bundle()
            payload['LocalDNS_FJNEW_Binaries/localdns-amd64-v1'] = data
            with self.assertRaises(UpdateError): read_kernel(io.BytesIO(zipped(payload)), 'amd64-v1')
        with self.assertRaisesRegex(UpdateError, 'localdns-amd64-v2'):
            read_kernel(io.BytesIO(zipped(bundle())), 'amd64-v2')

    def test_rejects_ambiguous_versions_and_architecture_locations(self):
        for extra in [bundle('FJHAI'), bundle(wrapper='other/'), bundle(nested=True)]:
            with self.assertRaises(UpdateError):
                read_kernel(io.BytesIO(zipped(dict(bundle(), **extra))), 'amd64-v1')

    def test_rejects_unsafe_paths_special_files_and_duplicates_even_when_unused(self):
        for name in ['../outside', '/absolute', 'C:/drive', 'a\\bad', 'a/../bad', './alias', 'a//alias']:
            with self.subTest(name=name), self.assertRaises(UpdateError):
                read_kernel(io.BytesIO(zipped(dict(bundle(), **{name: b'bad'}))), 'amd64-v1')
        for mode in [0o120777, 0o020600]:
            output = io.BytesIO(zipped(bundle()))
            with ZipFile(output, 'a') as archive:
                item = ZipInfo('unused'); item.external_attr = mode << 16
                archive.writestr(item, b'target')
            with self.assertRaises(UpdateError): read_kernel(io.BytesIO(output.getvalue()), 'amd64-v1')
        output = io.BytesIO(zipped(bundle()))
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with ZipFile(output, 'a') as archive:
                archive.writestr('LocalDNS_FJNEW_Binaries/localdns-amd64-v1', elf())
        with self.assertRaises(UpdateError): read_kernel(io.BytesIO(output.getvalue()), 'amd64-v1')

    def test_rejects_corrupt_crc_non_zip_and_excessive_expansion(self):
        data = zipped(bundle())
        corrupt = data.replace(elf(), elf()[:-1] + b'X', 1)
        for content in [b'not zip', data[:20], corrupt]:
            with self.assertRaises(UpdateError): read_kernel(io.BytesIO(content), 'amd64-v1')
        from unittest.mock import patch
        with patch('core_upload.MAX_EXPANDED_BYTES', 10), self.assertRaises(UpdateError):
            read_kernel(io.BytesIO(data), 'amd64-v1')


if __name__ == '__main__': unittest.main()
