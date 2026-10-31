"""Read one architecture from an upstream ZIP; never extract its scripts or settings."""
import re
import stat
import struct
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

from ui_updater import UpdateError

MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024


def read_kernel(package, architecture):
    try:
        with ZipFile(package) as archive:
            infos = archive.infolist()
            if len(infos) > 20000 or sum(item.file_size for item in infos) > MAX_EXPANDED_BYTES:
                raise UpdateError('内核 ZIP 文件过多或解压体积超过 512 MB')
            names = set()
            directories = set()
            for item in infos:
                name, path = item.filename, PurePosixPath(item.filename)
                mode = item.external_attr >> 16
                if (not name or '\x00' in item.orig_filename or '\\' in item.orig_filename or ':' in name
                        or path.is_absolute() or '..' in path.parts
                        or path.as_posix() != name.rstrip('/')
                        or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise UpdateError('内核 ZIP 包含不安全路径或文件类型')
                if name in names:
                    raise UpdateError('内核 ZIP 包含重复文件')
                names.add(name)
                match = re.match(r'((?:[^/]+/)*LocalDNS_(FJ[A-Z][A-Z0-9]+)_Binaries/)', name)
                if match:
                    directories.add((match[1], match[2]))
            if len(directories) != 1:
                raise UpdateError('请选择原作者提供的内核 ZIP，包内需有唯一的 LocalDNS_版本_Binaries 目录')
            prefix, backend = directories.pop()
            candidates = [name for name in (prefix + 'localdns-' + architecture,
                          prefix + 'localdns-' + backend + '/localdns-' + architecture) if name in names]
            if len(candidates) != 1:
                raise UpdateError('内核 ZIP 缺少或包含重复的 localdns-' + architecture)
            info = archive.getinfo(candidates[0])
            if info.file_size < 64 or info.file_size > MAX_UPLOAD_BYTES:
                raise UpdateError('内核二进制文件大小无效')
            data = archive.read(info)
            machine = 183 if architecture == 'arm64' else 62
            if data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != machine:
                raise UpdateError('内核二进制不是匹配服务器架构的 64 位 Linux ELF 文件')
            return backend, data
    except (BadZipFile, RuntimeError, NotImplementedError, EOFError) as error:
        raise UpdateError('内核 ZIP 损坏、加密或压缩格式不受支持，请重新选择原始 ZIP') from error
