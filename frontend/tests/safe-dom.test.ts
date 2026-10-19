// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { setHTML } from '../src/core/security/safe-dom';

it('rejects scripts, handlers and executable URLs while keeping escaped text and icons', () => {
  const target = document.createElement('div');
  setHTML(target, '<img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">name</a><svg><path d="M0 0h4"/></svg>&lt;script&gt;');
  expect(target.querySelector('script')).toBeNull(); expect(target.querySelector('[onerror]')).toBeNull();
  expect(target.querySelector('a')?.hasAttribute('href')).toBe(false); expect(target.querySelector('svg path')).not.toBeNull();
  expect(target.textContent).toContain('<script>');
});

it('preserves table rows in their real parsing context', () => {
  const target = document.createElement('tbody');
  setHTML(target, '<tr data-log="safe"><td>DNS</td></tr>');
  expect(target.querySelector('tr td')?.textContent).toBe('DNS');
});

it('preserves selectedness when moving options out of the sanitized staging select', () => {
  const target = document.createElement('select');
  setHTML(target, '<option value="">none</option><option value="one">one</option>');
  expect(target.value).toBe('');
  setHTML(target, '<option value="">none</option><option value="one" selected>one</option>');
  expect(target.value).toBe('one');
});
