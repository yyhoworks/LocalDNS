// @ts-check
import { createLogQuery } from '../features/logs/query';
import { preferences } from './persistence/preferences.ts';
const CONFIG = Object.assign({
    apiBase: '', title: 'LocalDNS 控制台', refreshInterval: 30,
    requestTimeout: 10000, demoOnApiFailure: false
  }, /** @type {any} */ (window).LOCALDNS_UI_CONFIG || {});

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const API_BASE = String(CONFIG.apiBase || '').replace(/\/$/, '');

  /** @param {string} s @param {ParentNode} [root] @returns {Element | null} */
  const $ = (s, root = document) => root.querySelector(s);

  /** @param {string} s @param {ParentNode} [root] @returns {Element[]} */
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  // #page-content is part of the static shell in index.html, so it always exists.
  const page = /** @type {HTMLElement} */ ($('#page-content'));

  /** @type {{ get: (k: string) => string | null, set: (k: string, v: unknown) => void }} */
  const storage = { get(k){ try { return preferences.getItem(k); } catch { return null; } }, set(k,v){ try { preferences.setItem(k,String(v)); } catch {} } };

  /** @type {{ route: string, logs: any, ruleTag: string, mobileMoreOpen: boolean, renderSeq: number, overviewSlowPage: number, overviewDomainPage: number, overviewSlowLimit: number, silent?: boolean, logsPaused?: boolean }} */
  const state = {
    route: 'overview',
    logs: createLogQuery(matchMedia('(max-width:600px)').matches),
    ruleTag: 'whitelist',
    mobileMoreOpen: false, renderSeq: 0,
    overviewSlowPage: 0, overviewDomainPage: 0,
    overviewSlowLimit: [5,10,20].includes(Number(storage.get('localdns-overview-slow-limit:' + (API_BASE || location.host)))) ? Number(storage.get('localdns-overview-slow-limit:' + (API_BASE || location.host))) : 10
  };
export { CONFIG, reduceMotion, API_BASE, $, $$, page, storage, state };
