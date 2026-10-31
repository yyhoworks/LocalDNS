"""Persistent release updates and explicitly uploaded upstream core updates."""
import contextlib
import hashlib
import json
import re
import secrets
import shutil
import threading
from pathlib import Path

import install_localdns as installer
import upgrade_localdns as upgrade
from fjgli_config import hashes, read_json, safe_tree, write_json
from ui_updater import UpdateError, TAG, now, version_parts
from core_upload import MAX_UPLOAD_BYTES, read_kernel

CONTRACT = {'schema': 1, 'apiFamily': 'localdns-v1', 'configSchema': 1}
ACTIVE = {'queued', 'running', 'awaiting_backup', 'rolling_back'}
MODES = {'ui', 'core', 'full'}


def contract(metadata):
    value = metadata.get('updateCompatibility')
    if value is None and metadata.get('backendVersion') in upgrade.SUPPORTED_BACKENDS:
        return dict(CONTRACT)
    return value


def check_contract(metadata):
    if contract(metadata) != CONTRACT:
        raise UpdateError('此版本的接口或配置格式尚不兼容，请先更新升级服务；现网不会被替换。', 409)


class OnlineUpdateManager:
    def __init__(self, root, directory, init=None, arch=None, service_name='localdns', test_ports=(0, 0)):
        self.root = Path(root).absolute()
        self.directory = Path(directory).absolute()
        installer.no_symlinks(self.root)
        installer.no_symlinks(self.directory)
        if self.directory == self.root or self.root in self.directory.parents:
            raise UpdateError('完整更新服务的状态目录必须位于核心目录外')
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state_file = self.directory / 'state.json'
        installer.no_symlinks(self.state_file)
        self.mutex = threading.RLock()
        self.thread = None
        self.init = init
        self.arch = installer.choose_arch(arch)
        self.service_name = service_name
        if not re.fullmatch(r'localdns(?:-[a-zA-Z0-9-]+)?', service_name):
            raise UpdateError('核心服务名称无效')
        self.test_ports = test_ports
        self.state = read_json(self.state_file) if self.state_file.exists() else {}
        with installer.locked(self.root):
            recovered = installer.recover_ui_update(self.root)
            if upgrade.journal_path(self.root).exists():
                upgrade.recover(self.root, self.init or installer.manager())
                recovered = True
            if not (self.root / 'core-version.json').exists():
                original = dict(self.installed_version())
                original['backendVersion'] = self.current()['backendVersion']
                installer.atomic_json(self.root / 'core-version.json', original)
        if self.state.get('state') in {'queued', 'running', 'rolling_back'}:
            self.save(state='rolled_back' if recovered else 'failed', step='interrupted', finishedAt=now(),
                      message='上次升级被中断，已恢复原版本。' if recovered else '上次升级被中断；请核对当前版本后重新准备。')

    def save(self, **values):
        with self.mutex:
            self.state.update(values)
            installer.atomic_json(self.state_file, self.state)

    def installed_version(self):
        return read_json(self.root / 'ui/version.json')

    def core_metadata(self):
        marker = self.root / 'core-version.json'
        installer.no_symlinks(marker)
        return read_json(marker) if marker.is_file() else self.installed_version()

    def current(self):
        ui = self.installed_version()
        core = self.core_metadata()
        backend = core.get('backendVersion')
        try:
            running = installer.local_json(installer.api_port(self.root), '/api/v1/status')
            backend = running['version']
        except (OSError, ValueError, KeyError):
            pass
        return {'uiVersion': ui['uiVersion'], 'backendVersion': backend}

    def job_directory(self):
        job_id = self.state.get('jobId', '')
        if not isinstance(job_id, str) or not re.fullmatch(r'[a-f0-9]{24}', job_id):
            raise UpdateError('升级任务标识无效', 409)
        path = self.directory / ('job-' + job_id)
        installer.no_symlinks(path)
        return path

    def stage_path(self):
        path = self.root.parent / ('.' + self.root.name + '-online-stage-' + self.state['jobId'])
        installer.no_symlinks(path)
        return path

    def previous_path(self):
        ref = self.state.get('previous')
        if not isinstance(ref, dict):
            return None
        name = ref.get('name', '')
        if ref.get('kind') == 'ui' and re.fullmatch(r'job-[a-f0-9]{24}', name):
            path = self.directory / name / 'previous-ui'
        elif ref.get('kind') == 'full' and re.fullmatch(re.escape(self.root.name) + r'\.previous-fjgli-[a-f0-9]{32}', name):
            path = self.root.parent / name
        else:
            raise UpdateError('回退记录的目录无效', 409)
        installer.no_symlinks(path)
        return path if path.is_dir() else None

    def status(self):
        with self.mutex:
            previous = self.previous_path()
            result = {k: self.state[k] for k in ('state', 'jobId', 'action', 'mode', 'step', 'message',
                      'targetTag', 'targetVersion', 'targetBackend', 'source', 'startedAt', 'finishedAt', 'backupDownloaded') if k in self.state}
            result.update(state=self.state.get('state', 'idle'), canRollback=previous is not None,
                          rollbackKind=(self.state.get('previous') or {}).get('kind'), protocol='localdns-updater/v2')
            current = self.current()
            result.update(installedVersion=current['uiVersion'], installedBackend=current['backendVersion'])
            backup = self.state.get('backup')
            if backup:
                result['backup'] = dict(backup)
            return result

    def capabilities(self):
        return {'protocol': 'localdns-updater/v2', 'repository': installer.REPO,
                'modes': sorted(MODES), 'architecture': self.arch, 'compatibility': CONTRACT,
                'backupRequired': ['core', 'full', 'rollback'], 'installed': self.current(),
                'coreUpload': {'format': 'upstream-zip', 'maxBytes': MAX_UPLOAD_BYTES, 'architecture': self.arch}}

    def _launch(self, function):
        self.thread = threading.Thread(target=function, daemon=True)
        self.thread.start()

    def start(self, tag=None, rollback=False, mode='ui'):
        with self.mutex:
            if self.state.get('state') in ACTIVE:
                if not rollback and self.state.get('targetTag') == tag and self.state.get('mode') == mode:
                    return self.status()
                raise UpdateError('已有升级任务，请先完成或取消备份准备。', 409)
            if mode not in MODES:
                raise UpdateError('请选择 UI、内核或 UI 与内核升级')
            current = self.current()
            if rollback:
                previous = self.previous_path()
                if previous is None:
                    raise UpdateError('没有可恢复的上一版本', 409)
                check_contract(self.core_metadata())
                mode = 'rollback'
            else:
                match = TAG.fullmatch(tag or '')
                if not match:
                    raise UpdateError('请选择本项目的正式发行标签')
                target_ui = match[1]
                target_backend = tag.split('-ui-v')[0].upper()
                if mode == 'ui' and version_parts(target_ui) <= version_parts(current['uiVersion']):
                    raise UpdateError('目标 UI 没有高于当前版本', 409)
                if mode == 'core' and target_backend == current['backendVersion']:
                    raise UpdateError('当前已运行此内核，无需重复更换', 409)
                if mode in {'core', 'full'} and version_parts(target_ui) < version_parts(current['uiVersion']):
                    raise UpdateError('目标发行版早于当前界面，请使用明确的回退操作。', 409)
                if mode == 'full' and target_backend == current['backendVersion'] and version_parts(target_ui) <= version_parts(current['uiVersion']):
                    raise UpdateError('当前 UI 与内核均已是此版本', 409)
                check_contract(self.core_metadata())
                check_contract(self.installed_version())
            self.begin_job(current, mode, targetTag=tag, action='rollback' if rollback else 'upgrade')
            self._launch(self.prepare_job)
            return self.status()

    def begin_job(self, current, mode, **values):
        old_previous = self.state.get('previous')
        self.state = {'previous': old_previous} if old_previous else {}
        self.save(state='queued', jobId=secrets.token_hex(12), action='upgrade', mode=mode,
                  startedAt=now(), finishedAt=None, step='queued',
                  message='任务已提交，正在准备；关闭页面后仍可查看进度。', sourceVersion=current)
        self.save(**values)
        self.job_directory().mkdir(mode=0o700)

    def receive_core(self, stream, length, expected):
        if not 0 < length <= MAX_UPLOAD_BYTES:
            raise UpdateError('内核 ZIP 需大于 0 且不超过 256 MB', 413)
        if not re.fullmatch(r'[a-f0-9]{64}', expected or ''):
            raise UpdateError('内核 ZIP 的 SHA-256 格式无效')
        with self.mutex:
            if self.state.get('state') in ACTIVE:
                raise UpdateError('已有升级任务，请先完成或取消备份准备。', 409)
            check_contract(self.core_metadata())
            check_contract(self.installed_version())
            installer.require_space(self.directory, length)
            self.begin_job(self.current(), 'core', source='upload', uploadSha256=expected)
            self.step('upload', '正在接收内核 ZIP，上传完成后准备备份…')
        try:
            work = self.job_directory() / 'download'
            work.mkdir(mode=0o700)
            digest, remaining = hashlib.sha256(), length
            with (work / 'core.zip').open('xb') as output:
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise UpdateError('内核 ZIP 上传不完整，请重新上传')
                    output.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
            if digest.hexdigest() != expected:
                raise UpdateError('内核 ZIP 上传摘要不一致，请重新上传')
            with self.mutex:
                self.save(state='queued', step='queued', message='内核 ZIP 已接收，正在校验并准备备份…')
                self._launch(self.prepare_job)
                return self.status()
        except Exception as error:
            self.fail(error)
            raise

    def step(self, name, message):
        self.save(state='running', step=name, message=message)

    def _validate_package(self, payload, metadata):
        kind = 'ui-update' if self.state['mode'] == 'ui' else 'full'
        ui = read_json(payload / ('ui' if kind == 'ui-update' else 'localdns/ui') / 'version.json')
        if metadata.get('packageType') != kind or any(ui.get(k) != metadata.get(k) for k in ('uiVersion', 'backendVersion', 'updateCompatibility')):
            raise UpdateError('发行包类型或界面元数据不一致')
        if metadata.get('releaseTag', self.state['targetTag']) != self.state['targetTag']:
            raise UpdateError('发行包标签与请求不一致')
        match = TAG.fullmatch(self.state['targetTag'])
        if metadata.get('uiVersion') != match[1] or metadata.get('backendVersion') != self.state['targetTag'].split('-ui-v')[0].upper():
            raise UpdateError('发行包版本与请求不一致')
        check_contract(metadata)
        self.save(targetVersion=metadata['uiVersion'], targetBackend=metadata['backendVersion'])

    def prepare_job(self):
        try:
            with installer.locked(self.root):
                work = self.job_directory() / 'download'
                work.mkdir(exist_ok=True)
                mode = self.state['mode']
                if mode == 'rollback':
                    self.prepare_restore(work)
                    return
                if self.state.get('source') == 'upload':
                    self.prepare_uploaded_core(work)
                    return
                self.step('download', '正在下载并校验正式发行包…')
                packages = installer.Packages(work, self.state['targetTag'])
                payload, metadata = packages.get('ui' if mode == 'ui' else 'full')
                self._validate_package(payload, metadata)
                if mode == 'ui':
                    result = installer.update_ui(self.root, payload, metadata, backend_compatible=True,
                        on_step=lambda step: self.step(step, {'backup': '正在备份原界面与共享设置…',
                            'install': '正在切换界面，DNS 继续运行…', 'verify': '正在检查新版界面与管理接口…'}[step]))
                    previous = self.job_directory() / 'previous-ui'
                    shutil.copytree(self.root / result['previous'], previous)
                    self.save(state='succeeded', step='done', finishedAt=now(),
                              previous={'kind': 'ui', 'name': self.job_directory().name, 'hashes': hashes(previous)},
                              message='UI 更新完成，DNS 核心与设置已保留，可以刷新使用。')
                    shutil.rmtree(work)
                    return
                self.step('backup', '正在生成完整备份并准备新目录，现网仍在运行…')
                archive = self.make_backup()
                names = [name for name in packages.sums if name.endswith('_Full.zip')]
                package = work / names[0]
                shutil.rmtree(payload)
                upgrade.prepare(self.root, package, packages.sums[names[0]], self.stage_path(), self.arch, mode=mode)
                marker = read_json(self.stage_path() / upgrade.MARKER)
                if marker['report']['missingSubscriptionFiles']:
                    raise UpdateError('已启用订阅的来源文件缺失，请先补齐规则再升级。')
                self.wait_for_backup(archive)
                shutil.rmtree(work)
        except Exception as error:
            self.fail(error)

    def prepare_uploaded_core(self, work):
        self.step('validate', '正在校验内核 ZIP 与服务器架构…')
        package = work / 'core.zip'
        if upgrade.sha(package) != self.state['uploadSha256']:
            raise UpdateError('已上传的内核 ZIP 内容发生变化，请重新上传')
        backend, binary = read_kernel(package, self.arch)
        if installer.digest(binary) == upgrade.sha(self.root / 'bin/localdns'):
            raise UpdateError('当前内核文件与上传文件一致，无需重复更新', 409)
        self.save(targetBackend=backend)
        self.step('backup', '正在备份现有版本并准备上传的内核，现网仍在运行…')
        archive = self.make_backup()
        safe_tree(self.root)
        installer.require_space(self.root.parent, sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file()) + len(binary))
        stage = self.stage_path()
        shutil.copytree(self.root, stage)
        saved = read_json(self.job_directory() / 'backup/backup.json')
        if upgrade.fingerprint(stage) != saved['sourceFingerprint']:
            raise UpdateError('准备期间设置发生变化，请重新上传并准备')
        (stage / 'bin/localdns').write_bytes(binary)
        (stage / 'bin/localdns').chmod(0o755)
        write_json(stage / 'core-version.json', {'backendVersion': backend, 'updateCompatibility': CONTRACT,
                   'source': 'upload', 'archiveSha256': self.state['uploadSha256']})
        record = {'schema': 1, 'sourceRoot': str(self.root), 'sourceFingerprint': saved['sourceFingerprint'],
                  'packageSha256': self.state['uploadSha256'], 'preflight': None,
                  'targetFingerprint': upgrade.fingerprint(stage),
                  'report': {'targetBackend': backend, 'missingSubscriptionFiles': [],
                             'preserved': {name: hashes(stage / name) for name in
                                           ('config/upstreams', 'rules/manual', 'config/subscriptions')}}}
        installer.atomic_json(stage / upgrade.MARKER, record)
        shutil.rmtree(work)
        self.wait_for_backup(archive)

    def make_backup(self):
        result = upgrade.backup(self.root, self.job_directory() / 'backup')
        self.save(sourceRuntime={name: hashes(self.root / name) for name in ('ui', 'bin')})
        return {'name': 'localdns-original-' + self.state['jobId'] + '.tar.gz',
                'sha256': result['sha256'], 'bytes': result['bytes']}

    def wait_for_backup(self, archive):
        self.save(state='awaiting_backup', step='backup', backup=archive, backupDownloaded=False,
                  preparedHashes=upgrade.stage_fingerprint(self.stage_path()),
                  message='备份已就绪。请下载到本机，并选择下载文件校验后继续。')

    def backup_file(self, job_id):
        with self.mutex:
            if job_id != self.state.get('jobId') or not self.state.get('backup'):
                raise UpdateError('备份任务不存在', 404)
            path = self.job_directory() / 'backup/localdns-original.tar.gz'
            installer.no_symlinks(path)
            if not path.is_file() or upgrade.sha(path) != self.state['backup']['sha256']:
                raise UpdateError('备份文件校验失败，请重新准备升级', 409)
            return path, self.state['backup']['name']

    def downloaded(self, job_id):
        with self.mutex:
            if job_id == self.state.get('jobId'):
                self.save(backupDownloaded=True)

    def continue_job(self, job_id, sha256):
        with self.mutex:
            if job_id != self.state.get('jobId') or self.state.get('state') != 'awaiting_backup':
                raise UpdateError('没有等待继续的此项任务', 409)
            if not isinstance(sha256, str) or not re.fullmatch('[a-f0-9]{64}', sha256):
                raise UpdateError('本机文件的 SHA-256 格式无效')
            if not self.state.get('backupDownloaded') or sha256 != self.state['backup']['sha256']:
                raise UpdateError('请先完整下载备份并校验本机文件', 409)
            self.backup_file(job_id)
            self.save(state='running', step='preflight', confirmedBackupSha256=sha256,
                      message='本机备份校验一致，正在隔离预检…')
            self._launch(self.apply_job)
            return self.status()

    def apply_job(self):
        switching = False
        try:
            with installer.locked(self.root):
                backup = self.job_directory() / 'backup/localdns-original.tar.gz'
                saved = read_json(backup.parent / 'backup.json')
                if upgrade.fingerprint(self.root) != saved['sourceFingerprint']:
                    raise UpdateError('下载备份后设置发生变化，已停止升级，请重新准备。', 409)
                if self.state.get('sourceRuntime') != {name: hashes(self.root / name) for name in ('ui', 'bin')}:
                    raise UpdateError('下载备份后 UI 或内核文件发生变化，请重新准备。', 409)
                if self.state.get('preparedHashes') != upgrade.stage_fingerprint(self.stage_path()):
                    raise UpdateError('暂存版本内容已改变，请重新准备升级。', 409)
                self.step('preflight', '正在独立目录与回环端口验证新内核和 DNS，现网继续运行…')
                upgrade.preflight(self.stage_path(), *self.test_ports)
                self.step('switch', '预检通过，正在短暂停服并切换目录…')
                switching = True
                result = upgrade.apply(self.root, self.stage_path(), backup,
                    self.state['confirmedBackupSha256'], self.init or installer.manager(), self.service_name)
                previous = Path(result['previousDirectory'])
                self.save(state='succeeded', step='done', finishedAt=now(),
                          previous={'kind': 'full', 'name': previous.name, 'hashes': upgrade.stage_fingerprint(previous)},
                          message='内核已升级，当前 UI 保持原样；DNS 与原设置检查通过。' if self.state['mode'] == 'core'
                          else 'UI、内核与设置验收通过，升级完成，可以刷新使用。')
        except Exception as error:
            restored = False
            if switching and not upgrade.journal_path(self.root).exists():
                with contextlib.suppress(Exception):
                    restored = upgrade.fingerprint(self.root) == read_json(self.job_directory() / 'backup/backup.json')['sourceFingerprint']
                    running = installer.local_json(installer.api_port(self.root), '/api/v1/status')
                    restored = restored and running['version'] == self.state['sourceVersion']['backendVersion']
            self.fail(error, restored)

    def prepare_restore(self, work):
        previous = self.previous_path()
        if previous is None:
            raise UpdateError('上一版本快照已不存在', 409)
        ref = self.state['previous']
        safe_tree(previous)
        if ref.get('hashes') != upgrade.stage_fingerprint(previous) and ref['kind'] == 'full':
            raise UpdateError('上一版本快照内容已改变，已停止恢复')
        if ref['kind'] == 'ui':
            if hashes(previous) != ref['hashes']:
                raise UpdateError('上一界面快照内容已改变，已停止恢复')
            check_contract(read_json(previous / 'version.json'))
            payload = work / 'restore'
            shutil.copytree(previous, payload / 'ui')
            metadata = read_json(previous / 'version.json')
            installer.update_ui(self.root, payload, metadata, backend_compatible=True)
            self.save(state='succeeded', step='done', finishedAt=now(), previous=None,
                      message='上一版 UI 已恢复，当前 Logo、字体和 DNS 设置保持不变。')
            shutil.rmtree(work)
            return
        self.step('backup', '正在备份当前状态，再准备上一整套版本…')
        archive = self.make_backup()
        stage = self.stage_path()
        installer.require_space(stage.parent, sum(p.stat().st_size for p in previous.rglob('*') if p.is_file()))
        shutil.copytree(previous, stage)
        record = {'schema': 1, 'sourceRoot': str(self.root), 'sourceFingerprint': upgrade.fingerprint(self.root),
                  'targetFingerprint': upgrade.fingerprint(stage), 'preflight': None,
                  'report': {'missingSubscriptionFiles': [], 'preserved': {name: hashes(stage / name)
                             for name in ['config/upstreams', 'rules/manual', 'config/subscriptions']}}}
        write_json(stage / upgrade.MARKER, record)
        self.wait_for_backup(archive)
        shutil.rmtree(work)

    def cancel(self, job_id):
        with self.mutex:
            if job_id != self.state.get('jobId') or self.state.get('state') != 'awaiting_backup':
                raise UpdateError('仅可取消等待备份确认的准备任务', 409)
            self.cleanup()
            self.save(state='failed', step='cancelled', finishedAt=now(), message='准备已取消，现网没有切换；完整备份仍保留。')
            return self.status()

    def fail(self, error, restored=False):
        with contextlib.suppress(Exception):
            self.cleanup()
        self.save(state='rolled_back' if restored else 'failed', step='failed', finishedAt=now(),
                  message=('验收失败，已恢复原版本。' if restored else '升级已停止，未继续切换。') + str(error))

    def cleanup(self):
        # Paths derive only from the validated, server-generated job id. Keep backups.
        self.job_directory()
        for path in (self.stage_path(), self.job_directory() / 'download'):
            installer.no_symlinks(path)
            expected = self.root.parent if path == self.stage_path() else self.job_directory()
            if path.resolve().parent != expected.resolve():
                raise UpdateError('临时目录超出升级工作区')
            if path.exists():
                safe_tree(path)
                shutil.rmtree(path)
