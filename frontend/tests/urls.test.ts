import { expect, it } from 'vitest';
import { panelIconCandidates, validPanelURL } from '../src/features/proxy-panel/url';

it.each(['javascript:alert(1)', 'data:text/html,test', 'http://user:pass@example.test', '//example.test', 'https://'])('rejects unsafe or incomplete panel URLs: %s', value => {
  expect(() => validPanelURL(value)).toThrow();
});
it('preserves the panel subdirectory and excludes secrets from favicon requests', () => {
  const urls = panelIconCandidates('http://panel.test/ui/#/setup?secret=private', true);
  expect(urls[0]).toBe('http://panel.test/ui/favicon-dark.svg');
  expect(urls.every(value => !value.includes('secret') && !value.includes('#'))).toBe(true);
  expect(panelIconCandidates('https://panel.test/path/index.html?q=private', false)[0]).toBe('https://panel.test/path/favicon.svg');
});
