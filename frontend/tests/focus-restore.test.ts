// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { focusSelectors, restoreFocus } from '../src/core/router/focus-restore.js';

let root: HTMLElement;
const render = (html: string) => { root.innerHTML = html; };
const focused = () => document.activeElement;

beforeEach(() => {
  document.body.innerHTML = '<main id="page-content" tabindex="-1"></main><nav><button id="outside">nav</button></nav>';
  root = document.getElementById('page-content')!;
});

describe('silent refresh focus restore', () => {
  it('returns no selectors when focus is outside the page or on the page root', () => {
    expect(focusSelectors(document.getElementById('outside'), root)).toEqual([]);
    expect(focusSelectors(root, root)).toEqual([]);
    expect(focusSelectors(null, root)).toEqual([]);
  });

  it('restores by id after the DOM is replaced', () => {
    render('<button id="log-pause">pause</button>');
    const selectors = focusSelectors(root.querySelector('#log-pause'), root);
    render('<button id="log-pause">pause</button>');
    expect(restoreFocus(selectors, root)).toBe(true);
    expect(focused()?.id).toBe('log-pause');
  });

  it('restores by data attribute when there is no id', () => {
    render('<div><button data-chart-range="15">15</button><button data-chart-range="60">60</button></div>');
    const selectors = focusSelectors(root.querySelector('[data-chart-range="60"]'), root);
    render('<div><button data-chart-range="15">15</button><button data-chart-range="60">60</button></div>');
    restoreFocus(selectors, root);
    expect((focused() as HTMLElement).dataset.chartRange).toBe('60');
  });

  it('falls back to a structural path for anonymous controls', () => {
    render('<section><button>a</button><button>b</button></section>');
    const selectors = focusSelectors(root.querySelectorAll('button')[1], root);
    render('<section><button>a</button><button>b</button></section>');
    restoreFocus(selectors, root);
    expect(focused()?.textContent).toBe('b');
  });

  it('never steals focus the user already moved elsewhere', () => {
    render('<button id="a">a</button>');
    const selectors = focusSelectors(root.querySelector('#a'), root);
    render('<button id="a">a</button>');
    (document.getElementById('outside') as HTMLButtonElement).focus();
    expect(restoreFocus(selectors, root)).toBe(false);
    expect(focused()?.id).toBe('outside');
  });

  it('quotes attribute values safely', () => {
    render('<button data-key=\'a"b\\c\'>x</button>');
    const selectors = focusSelectors(root.querySelector('button'), root);
    render('<button data-key=\'a"b\\c\'>x</button>');
    expect(restoreFocus(selectors, root)).toBe(true);
  });
});
