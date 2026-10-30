"""Prepare FJGLI configuration in a new directory without changing the source."""
import copy
import hashlib
import json
import shutil
import stat
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


class MigrationError(RuntimeError):
    pass


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def safe_tree(root):
    root = Path(root)
    for item in (root, *root.parents):
        if item.is_symlink():
            raise MigrationError('拒绝符号链接路径：' + str(item))
    for item in root.rglob('*'):
        mode = item.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise MigrationError('迁移来源含链接或特殊文件：' + str(item))


def hashes(root):
    safe_tree(root)
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(Path(root).rglob('*')) if p.is_file()}


def replace_tree(source, target):
    safe_tree(source)
    safe_tree(target)
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)


def clean_template(payload):
    """Sanitize only a fresh upstream template. Never use this on user settings."""
    payload = dict(payload)
    public_sources = set()
    for name, data in payload.items():
        if name.startswith('localdns/config/subscriptions/') and name.endswith('.json'):
            for entry in json.loads(data):
                filename = entry.get('files', '')
                path = PurePosixPath(filename)
                if path.parts[:2] == ('rules', 'online') and not path.is_absolute() and '..' not in path.parts:
                    public_sources.add('localdns/' + filename)
    for name in list(payload):
        if name.startswith(('localdns/cache/', 'localdns/logs/',
                            'localdns/rules/compiled/')):
            payload.pop(name)
        elif name.startswith('localdns/rules/online/') and name not in public_sources:
            payload.pop(name)
        elif name.startswith('localdns/generated/') and not name.endswith('/'):
            payload[name] = b''
        elif name.startswith('localdns/rules/manual/') and not name.endswith('/'):
            payload[name] = b''
    def save(name, value):
        payload['localdns/' + name] = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    save('config/settings/client_aliases.json', {})
    path = 'config/settings/route_refresh.json'
    route = json.loads(payload['localdns/' + path])
    route['status'] = {'task_state': 'idle', 'progress': {'processed': 0, 'total': 0},
                       'last_run_domain_count': 0, 'last_run_start_time': '', 'last_run_end_time': ''}
    route['scheduler'].update(enabled=False, start_datetime='')
    save(path, route)
    for name, data in list(payload.items()):
        if name.startswith('localdns/config/subscriptions/') and name.endswith('.json'):
            entries = json.loads(data)
            for entry in entries:
                for key in ('last_updated', 'last_error', 'rule_count', 'line_report'):
                    entry.pop(key, None)
            save(name[len('localdns/'):], entries)
    domestic = {'upstreams': [{'tag': 'AliDNS', 'enabled': True, 'protocol': 'udp', 'addr': '223.5.5.5'},
                              {'tag': 'DNSPod', 'enabled': True, 'protocol': 'udp', 'addr': '119.29.29.29'}]}
    foreign = {'upstreams': [{'tag': 'Cloudflare', 'enabled': True, 'protocol': 'udp', 'addr': '1.1.1.1'},
                             {'tag': 'Quad9', 'enabled': True, 'protocol': 'udp', 'addr': '9.9.9.9'}]}
    for group, config in [('domestic', domestic), ('foreign', foreign), ('proxy', foreign), ('foreign_ecs', foreign)]:
        save('config/upstreams/' + group + '.json', config)
    for folder in ['cache', 'generated', 'logs', 'rules/online', 'rules/compiled']:
        payload['localdns/' + folder + '/'] = b''
    return payload


def migrate_configuration(source, target):
    safe_tree(Path(source) / 'config')
    safe_tree(Path(target) / 'config')
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target or source in target.parents or target in source.parents:
        raise MigrationError('迁移来源和目标必须是独立目录')
    for root in (source / 'config', source / 'rules/manual', target / 'config'):
        if not root.is_dir():
            raise MigrationError('缺少必要目录：' + str(root))
        safe_tree(root)
    report = {'schema': 1, 'targetBackend': 'FJGLI', 'converted': [], 'preserved': {},
              'retired': [], 'missingSubscriptionFiles': []}
    for name in ('overrides.json', 'upstream_overrides.json'):
        if (source / 'config/settings' / name).exists():
            report['retired'].append('settings/' + name + ': 使用 config/upstreams 的实际配置；旧文件保留在完整备份')
    known = {'localdns.json', 'cache.json', 'generated.json', 'settings/cache.json', 'settings/generated.json',
             'settings/client_names.json', 'settings/client_aliases.json', 'settings/audit.json',
             'settings/querylog.json', 'settings/requery.json', 'settings/route_refresh.json',
             'settings/switches.json', 'settings/overrides.json', 'settings/upstream_overrides.json'}
    unknown = [str(p.relative_to(source / 'config')) for p in (source / 'config').rglob('*')
               if p.is_file() and p.relative_to(source / 'config').as_posix() not in known
               and p.relative_to(source / 'config').parts[0] not in ('upstreams', 'subscriptions')]
    if unknown:
        raise MigrationError('存在尚未适配的配置文件：' + ', '.join(unknown))

    def load(relative, default=None):
        p = source / relative
        return read_json(p) if p.is_file() else copy.deepcopy(default)

    def save(relative, value):
        write_json(target / relative, value)
        report['converted'].append(relative)

    for relative in ('config/upstreams', 'rules/manual', 'config/subscriptions'):
        folder = source / relative
        if not folder.is_dir():
            raise MigrationError('缺少保留目录：' + relative)
        replace_tree(folder, target / relative)
        report['preserved'][relative] = hashes(folder)
    # The staged template's public defaults must not survive custom subscriptions.
    for folder in ('rules/online', 'rules/compiled'):
        target_folder = target / folder
        safe_tree(target_folder)
        if target_folder.exists():
            shutil.rmtree(target_folder)
        target_folder.mkdir(parents=True)

    main = load('config/localdns.json')
    if not isinstance(main, dict) or not isinstance(main.get('api'), dict) or not isinstance(main.get('dns'), dict):
        raise MigrationError('原主配置格式无效')
    budget = main.get('cache_memory_mb', main.get('memory_limit_mb', 128))
    if isinstance(budget, bool) or not isinstance(budget, (int, float)) or budget < 0:
        raise MigrationError('原缓存内存预算无效')
    main.pop('memory_limit_mb', None)
    main['cache_memory_mb'] = budget
    save('config/localdns.json', main)

    for name, fields in [('cache', {'size': 'max_entries', 'lazy_cache_ttl': 'stale_ttl', 'dump_interval': 'save_interval'}),
                         ('generated', {'dump_interval': 'save_interval'})]:
        config = load('config/settings/' + name + '.json')
        if config is None:
            config = load('config/' + name + '.json')
        if config is not None:
            for group in config.values():
                for old, new in fields.items():
                    if old in group:
                        if new in group and group[new] != group[old]:
                            raise MigrationError('配置字段冲突：' + name + '/' + old)
                        group[new] = group.pop(old)
            save('config/settings/' + name + '.json', config)

    aliases = load('config/settings/client_aliases.json')
    old_aliases = load('config/settings/client_names.json')
    if aliases is not None and old_aliases is not None and aliases != old_aliases:
        raise MigrationError('两份客户端别名不一致，需要核对生效来源')
    aliases = aliases if aliases is not None else old_aliases or {}
    if not isinstance(aliases, dict) or not all(isinstance(v, str) for v in aliases.values()):
        raise MigrationError('客户端别名格式无效')
    save('config/settings/client_aliases.json', aliases)

    log = load('config/settings/querylog.json')
    if log is None:
        log = load('config/settings/audit.json')
    if log is not None:
        # `persist` arrived with FJH21 (记录存盘); older installs only carry capacity/dir.
        if set(log) - {'capacity', 'dir', 'persist'}:
            raise MigrationError('查询日志存在未知设置字段')
        save('config/settings/querylog.json', log)
    switches = load('config/settings/switches.json')
    if switches is not None:
        save('config/settings/switches.json', switches)

    route = load('config/settings/route_refresh.json')
    if route is None:
        route = load('config/settings/requery.json')
    if route is not None:
        if 'url_actions' in route:
            actions = {}
            for old, new in [('save_rules', 'save'), ('flush_rules', 'flush')]:
                names = []
                for url in route['url_actions'].get(old, []):
                    parsed = urlsplit(url)
                    parts = PurePosixPath(parsed.path).parts
                    if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
                            or parsed.username or parsed.password or parsed.query or parsed.fragment
                            or len(parts) != 4 or parts[1] != 'plugins' or parts[3] != new
                            or parts[2] not in ('cache_main', 'cache_domestic', 'cache_foreign', 'cache_foreign_ecs',
                                                'domain_stats', 'fakeip', 'realip', 'nodata')):
                        raise MigrationError('定时任务含无法迁移的 URL 动作，请检查原配置')
                    names.append(parts[2])
                actions[new] = names
            route.pop('url_actions')
            route['actions'] = actions
        execution = route.get('execution_settings', {})
        if 'url_call_delay_ms' in execution:
            execution.pop('url_call_delay_ms')
            report['retired'].append('execution_settings.url_call_delay_ms: 新版使用内置动作')
        route['status'] = {'task_state': 'idle', 'progress': {'processed': 0, 'total': 0},
                           'last_run_domain_count': 0, 'last_run_start_time': '', 'last_run_end_time': ''}
        save('config/settings/route_refresh.json', route)

    # Standard downloaded source files can be re-read by the new core. Its compiled
    # state is always built afresh, and never copied from the old installation.
    for p in sorted((source / 'config/subscriptions').glob('*.json')):
        entries = read_json(p)
        if not isinstance(entries, list):
            raise MigrationError('订阅配置必须为列表：' + p.name)
        for entry in entries:
            filename = entry.get('files')
            if not filename:
                if entry.get('enabled', True):
                    report['missingSubscriptionFiles'].append(p.name + ': source path missing')
                continue
            path = PurePosixPath(filename)
            if path.is_absolute() or '..' in path.parts or '\\' in filename or ':' in filename or path.parts[:2] != ('rules', 'online'):
                raise MigrationError('订阅文件必须位于 rules/online 内：' + p.name)
            original = source.joinpath(*path.parts)
            if original.is_file():
                safe_tree(original)
                dest = target.joinpath(*path.parts)
                safe_tree(dest)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, dest)
            elif entry.get('enabled', True):
                report['missingSubscriptionFiles'].append(p.name + ': ' + filename)

    for relative in ('ui/custom', 'bin/ui-updater'):
        if (source / relative).is_dir():
            replace_tree(source / relative, target / relative)
    for relative in ('ui/config.js', '.ui-updater/config.json', 'bin/glibc-shim.so', 'bin/localdns-compat.so'):
        original = source / relative
        if original.is_file():
            safe_tree(original)
            dest = target / relative
            safe_tree(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, dest)
    for relative, expected in report['preserved'].items():
        if hashes(target / relative) != expected:
            raise MigrationError('恢复后文件校验不一致：' + relative)
    return report
