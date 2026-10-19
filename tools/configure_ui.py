#!/usr/bin/env python3
"""Import static UI preferences without a resident server or DNS restart."""
import argparse
import base64
import contextlib
import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from zipfile import BadZipFile, ZipFile

MAX_FONT = 64 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
DEFAULTS = {'version': 1, 'localdns': {'name': 'LocalDNS', 'logo': ''},
            'proxy': {'name': '代理面板', 'url': ''},
            'typography': {'heading': 'serif', 'numeral': 'serif', 'body': 'plex'},
            'fonts': []}
BUILTINS = {'heading': {'serif', 'sans', 'system'}, 'numeral': {'serif', 'sans', 'mono'},
            'body': {'plex', 'noto', 'system'}}


def no_links(path):
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError('拒绝符号链接路径：' + str(parent))


def web_url(value, empty=False):
    if not value and empty:
        return
    u = urlsplit(value)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or len(value) > 4096:
        raise ValueError('请使用不含账号密码的 HTTP(S) 地址')


def validate(value, files):
    if value.get('version') != 1:
        raise ValueError('不支持的共享配置版本')
    for section in ('localdns', 'proxy'):
        name = value[section]['name']
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 32 or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise ValueError('名称需为 1–32 个字符')
    web_url(value['proxy']['url'], empty=True)
    logo = value['localdns']['logo']
    allowed = set()
    if logo.startswith('custom/assets/'):
        path = logo[7:]
        if not re.fullmatch(r'assets/[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|gif)', path):
            raise ValueError('Logo 文件路径无效')
        data = files[path]
        if len(data) > 2 * 1024 * 1024 or not image_extension(data):
            raise ValueError('Logo 需为不超过 2 MB 的 PNG / JPEG / WebP / GIF')
        allowed.add(path)
    else:
        web_url(logo, empty=True)
    ids = set()
    total = 0
    if not isinstance(value['fonts'], list) or len(value['fonts']) > 128:
        raise ValueError('字体清单无效')
    for font in value['fonts']:
        identifier, path = font['id'], font['path']
        if not re.fullmatch(r'up[a-zA-Z0-9_-]+', identifier) or identifier in ids:
            raise ValueError('字体标识无效或重复')
        if not isinstance(font['name'], str) or len(font['name']) > 200:
            raise ValueError('字体名称无效')
        if not re.fullmatch(r'custom/fonts/[A-Za-z0-9._-]+\.(ttf|otf|woff|woff2)', path):
            raise ValueError('字体路径无效')
        data = files[path[7:]]
        if not 0 < len(data) <= MAX_FONT or data[:4] not in (b'\x00\x01\x00\x00', b'OTTO', b'wOFF', b'wOF2', b'ttcf'):
            raise ValueError('字体文件格式或大小无效')
        if font['size'] != len(data):
            raise ValueError('字体大小与清单不符')
        total += len(data)
        ids.add(identifier)
        allowed.add(path[7:])
    if total > MAX_TOTAL:
        raise ValueError('字体总量不能超过 128 MB')
    for role, choices in BUILTINS.items():
        if value['typography'][role] not in choices | ids:
            raise ValueError('字体选择不存在：' + role)
    if set(files) - {'settings.json'} != allowed:
        raise ValueError('配置包包含清单外的文件')


def image_extension(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if data.startswith((b'GIF87a', b'GIF89a')):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    return None


def read_bundle(path):
    with ZipFile(path) as z:
        infos = z.infolist()
        if len(infos) != len({i.filename for i in infos}) or len(infos) > 132:
            raise ValueError('配置包有重复文件或文件过多')
        if sum(i.file_size for i in infos) > MAX_TOTAL + 3 * 1024 * 1024:
            raise ValueError('配置包体积过大')
        for info in infos:
            name = info.filename
            if (not re.fullmatch(r'(settings\.json|(assets|fonts)/[A-Za-z0-9._-]+)', name)
                    or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError('配置包含不安全路径或文件类型')
        files = {i.filename: z.read(i) for i in infos}
    value = json.loads(files['settings.json'])
    validate(value, files)
    return value, files


def install(root, value, files):
    no_links(root)
    if not (root / 'ui/index.html').is_file():
        raise ValueError('未找到 LocalDNS UI')
    target = root / 'ui/custom'
    no_links(target)
    validate(value, files)
    value = json.loads(json.dumps(value))
    value.pop('companionService',None)
    original = files
    files = {}
    logo = value['localdns']['logo']
    if logo.startswith('custom/assets/'):
        data = original[logo[7:]]
        path = 'assets/' + hashlib.sha256(data).hexdigest() + '.' + image_extension(data)
        files[path] = data
        value['localdns']['logo'] = 'custom/' + path
    for font in value['fonts']:
        source = font['path'][7:]
        data = original[source]
        path = 'fonts/' + hashlib.sha256(data).hexdigest() + PurePosixPath(source).suffix
        files[path] = data
        font['path'] = 'custom/' + path
    stamp = uuid.uuid4().hex[:12]
    previous = root / ('custom-backup-' + stamp)
    with tempfile.TemporaryDirectory(prefix='.custom-stage-', dir=root / 'ui') as temp:
        stage = Path(temp) / 'custom'
        stage.mkdir()
        for name, data in files.items():
            if name == 'settings.json':
                continue
            dest = stage.joinpath(*PurePosixPath(name).parts)
            dest.parent.mkdir(exist_ok=True)
            dest.write_bytes(data)
            dest.chmod(0o644)
        (stage / 'settings.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for folder in (stage, stage / 'assets', stage / 'fonts'):
            if folder.exists():
                folder.chmod(0o755)
        if target.exists():
            target.rename(previous)
        try:
            stage.rename(target)
        except Exception:
            if previous.exists():
                previous.rename(target)
            raise
    print('共享配置已保存，其他设备刷新页面并选择“跟随服务器”即可使用。')
    print('配置：' + str(target / 'settings.json'))
    if previous.exists():
        print('原配置备份：' + str(previous))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dir', default='/opt/localdns', type=Path)
    p.add_argument('--import', dest='bundle', type=Path, help='导入网页导出的 localdns-ui-settings.zip')
    p.add_argument('--import-interface', type=Path, help='一次性迁移旧服务的 interface.json')
    p.add_argument('--name')
    logos = p.add_mutually_exclusive_group()
    logos.add_argument('--logo-file', type=Path)
    logos.add_argument('--logo-url')
    p.add_argument('--proxy-url')
    p.add_argument('--proxy-name')
    p.add_argument('--font', action='append', default=[], help='ROLE=字体路径，ROLE 为 heading/numeral/body')
    args = p.parse_args(argv)
    root = args.dir.absolute()
    no_links(root)
    if args.bundle:
        value, files = read_bundle(args.bundle)
    else:
        config = root / 'ui/custom/settings.json'
        value = json.loads(config.read_text(encoding='utf-8')) if config.exists() else json.loads(json.dumps(DEFAULTS))
        files = {}
        for font in value['fonts']:
            source = root / 'ui' / font['path']
            no_links(source)
            files[font['path'][7:]] = source.read_bytes()
        if value['localdns']['logo'].startswith('custom/assets/'):
            source = root / 'ui' / value['localdns']['logo']
            no_links(source)
            files[value['localdns']['logo'][7:]] = source.read_bytes()
    if args.import_interface:
        old = json.loads(args.import_interface.read_text(encoding='utf-8'))
        for section in ('localdns', 'proxy'):
            if old.get(section):
                value[section] = {key: old[section].get(key, '') for key in (('name', 'logo') if section == 'localdns' else ('name', 'url'))}
        logo = value['localdns']['logo']
        if logo.startswith('data:image/png;base64,'):
            data = base64.b64decode(logo.split(',', 1)[1], validate=True)
            files['assets/logo.png'] = data
            value['localdns']['logo'] = 'custom/assets/logo.png'
    if args.name is not None:
        value['localdns']['name'] = args.name
    if args.logo_url is not None or args.logo_file:
        for name in list(files):
            if name.startswith('assets/'):
                files.pop(name)
        if args.logo_file:
            data = args.logo_file.read_bytes()
            ext = image_extension(data)
            if not ext:
                raise ValueError('Logo 请使用 PNG / JPEG / WebP / GIF')
            path = 'assets/' + hashlib.sha256(data).hexdigest()[:24] + '.' + ext
            files[path] = data
            value['localdns']['logo'] = 'custom/' + path
        else:
            value['localdns']['logo'] = args.logo_url
    for rolefile in args.font:
        role, filename = rolefile.split('=', 1)
        if role not in BUILTINS:
            raise ValueError('字体用途需为 heading / numeral / body')
        source = Path(filename)
        data = source.read_bytes()
        identifier = 'up' + hashlib.sha256(data).hexdigest()
        path = 'fonts/' + identifier + source.suffix.lower()
        if not any(f['id'] == identifier for f in value['fonts']):
            files[path] = data
            value['fonts'].append({'id': identifier, 'name': source.name, 'size': len(data), 'path': 'custom/' + path})
        value['typography'][role] = identifier
    if args.proxy_url is not None:
        value['proxy']['url'] = args.proxy_url
    if args.proxy_name is not None:
        value['proxy']['name'] = args.proxy_name
    references = {font['path'][7:] for font in value['fonts']}
    if value['localdns']['logo'].startswith('custom/assets/'):
        references.add(value['localdns']['logo'][7:])
    files = {name: data for name, data in files.items() if name in references or name == 'settings.json'}
    install(root, value, files)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, BadZipFile) as error:
        raise SystemExit('共享配置未修改：' + str(error))
