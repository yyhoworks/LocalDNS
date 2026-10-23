import { describe, expect, it, vi } from 'vitest';
import { initialize, ruleConversionService } from '../src/features/rules/conversion.js';

initialize();

describe('subscription save completion', () => {
  it.each([true, false])('accepts FJGLI changed=%s without optional format or count metadata', async changed => {
    const source = { name: '新订阅', files: 'rules/online/custom_cn/test.srs', changed };
    const refresh = vi.fn().mockResolvedValue(source);
    expect(await ruleConversionService.finishSave({ name: source.name }, refresh)).toBe(source);
    expect(refresh).toHaveBeenCalledOnce();
    expect(ruleConversionService.message(source)).toBe(changed ? '规则更新完成' : '规则未变化');
    expect(ruleConversionService.label(source)).toBe('格式未记录');
  });

  it('accepts wrapped completion and retains existing conversion metadata', async () => {
    const source = { name: 'existing', detected_format: 'txt', rule_count: 0 };
    const refresh = vi.fn();
    expect(await ruleConversionService.finishSave(source, refresh)).toBe(source);
    expect(refresh).not.toHaveBeenCalled();
    expect(ruleConversionService.message(source)).toBe('TXT → SRS · 0 条规则');
    const pending = { name: 'pending' };
    expect(await ruleConversionService.finishSave(pending, async () => ({ source: pending, changed: false }))).toBe(pending);
  });

  it('keeps legacy pending and malformed responses as failures', async () => {
    for (const response of [{ name: 'pending' }, { changed: false }, { name: 'pending', changed: 'false' }]) {
      await expect(ruleConversionService.finishSave({ name: 'pending' }, async () => response)).rejects.toThrow('尚未识别');
    }
  });

  it('propagates dataset and network failures once', async () => {
    for (const error of [Object.assign(new Error('choose dataset'), { body: { code: 'dataset_required', datasets: ['cn'] } }), new Error('offline')]) {
      const refresh = vi.fn().mockRejectedValue(error);
      await expect(ruleConversionService.finishSave({ name: 'pending' }, refresh)).rejects.toBe(error);
      expect(refresh).toHaveBeenCalledOnce();
    }
  });

  it('never triggers the subscription update for lightweight config-only saves', async () => {
    // 启停开关等轻量保存走 configOnly：PUT 响应未带 detected_format 时
    // 也绝不能调用 refresh（refresh 会对订阅源发起真实更新请求）。
    const refresh = vi.fn().mockResolvedValue({ name: 'pending', changed: true });
    const pending = { name: 'pending' };
    expect(await ruleConversionService.finishSave(pending, refresh, { configOnly: true })).toBe(pending);
    expect(refresh).not.toHaveBeenCalled();
    const known = { name: 'known', detected_format: 'txt' };
    expect(await ruleConversionService.finishSave(known, refresh, { configOnly: true })).toBe(known);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retries deleting the renamed rule once and reports persistent failure', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    await expect(ruleConversionService.deleteOriginalWithRetry(ok)).resolves.toBe(true);
    expect(ok).toHaveBeenCalledOnce();
    const flaky = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(undefined);
    await expect(ruleConversionService.deleteOriginalWithRetry(flaky)).resolves.toBe(true);
    expect(flaky).toHaveBeenCalledTimes(2);
    const failing = vi.fn().mockRejectedValue(new Error('gone wrong'));
    await expect(ruleConversionService.deleteOriginalWithRetry(failing)).resolves.toBe(false);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('does not invent a zero count or claim a format from the filename', () => {
    expect(ruleConversionService.message({ name: 'new', files: 'test.srs' })).toBe('规则更新完成');
    expect(ruleConversionService.message({ name: 'new', rule_count: null })).toBe('规则更新完成');
    expect(ruleConversionService.label({ url: 'https://example.com/test.srs' })).toBe('格式未记录');
  });
});
