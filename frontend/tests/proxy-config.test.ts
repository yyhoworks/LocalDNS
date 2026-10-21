import { describe, expect, it } from 'vitest';
import { proxyConfigBase } from '../src/features/proxy-config/api';
import { prepareHTTPDraft, syntaxCheck, differences } from '../src/features/proxy-config/editor.js';
import { parseDocument } from 'yaml';
import { parse as parseJSONC } from 'jsonc-parser';

describe('proxy configuration address', () => {
  it('follows the actual DNS API host and preserves an explicit reverse proxy prefix', () => {
    expect(proxyConfigBase('', 'http://dns.test:9099/backend', 'http://preview.test')).toBe('http://dns.test:9098/api/proxy-config/');
    expect(proxyConfigBase('/_config', '', 'https://dns.test')).toBe('https://dns.test/_config/api/proxy-config/');
    expect(proxyConfigBase('https://dns.test/_config/api/proxy-config/', '', 'https://dns.test')).toBe('https://dns.test/_config/api/proxy-config/');
    expect(() => proxyConfigBase('file:///etc/config', '', 'https://dns.test')).toThrow();
    expect(() => proxyConfigBase('https://user:pass@dns.test', '', 'https://dns.test')).toThrow();
  });
});

describe('HTTP drafts and target management settings', () => {
  it('imports new rules and comments while preserving the selected target controller', () => {
    const current = 'external-controller: 127.0.0.1:9090\nsecret: target-secret\nmode: rule\n';
    const remote = '# subscription comment\nmode: rule\nrules:\n - DOMAIN,example.com,DIRECT\nexternal-controller: 127.0.0.1:9999\n';
    const result = prepareHTTPDraft(remote, current, 'mihomo');
    expect(result.preserved).toBe(true);
    expect(result.content).toContain('# subscription comment');
    expect(parseDocument(result.content).toJS()).toMatchObject({ 'external-controller': '127.0.0.1:9090', secret: 'target-secret', rules: ['DOMAIN,example.com,DIRECT'] });
    expect(prepareHTTPDraft(remote, current, 'mihomo', false)).toEqual({ content: remote, preserved: false });
  });
  it('preserves JSONC comments and route changes while retaining the target Clash API fields', () => {
    const current = '{"experimental":{"clash_api":{"external_controller":"127.0.0.1:9090","secret":"target-secret"}}}';
    const remote = '{\n// subscription\n"route":{"final":"direct"},"experimental":{"clash_api":{"external_controller":"0.0.0.0:9999","external_ui":"dashboard"}},\n}';
    const result = prepareHTTPDraft(remote, current, 'sing-box');
    expect(result.content).toContain('// subscription');
    expect(parseJSONC(result.content)).toMatchObject({ route: { final: 'direct' }, experimental: { clash_api: { external_controller: '127.0.0.1:9090', secret: 'target-secret', external_ui: 'dashboard' } } });
    expect(syntaxCheck(result.content, 'sing-box')).toEqual([]);
  });
  it('accepts valid JSONC, flags malformed configurations and shows changed lines', () => {
    expect(syntaxCheck('{/* c */"route":{"final":"https://example.com/a/*b*/",},}', 'sing-box')).toEqual([]);
    expect(syntaxCheck('{"route":', 'sing-box').length).toBeGreaterThan(0);
    expect(syntaxCheck('[]', 'sing-box').length).toBeGreaterThan(0);
    expect(syntaxCheck('mode: rule\nmode: direct', 'mihomo').length).toBeGreaterThan(0);
    expect(differences('mode: rule\n', 'mode: global\n')).toEqual({ removed: [1], added: [1] });
  });
});
