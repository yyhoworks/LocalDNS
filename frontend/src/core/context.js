import { createLogQuery } from '../features/logs/query';
import { preferences } from './persistence/preferences.ts';
const CONFIG = Object.assign({
    apiBase: '', title: 'LocalDNS 控制台', refreshInterval: 30,
    requestTimeout: 10000, demoOnApiFailure: false
  }, window.LOCALDNS_UI_CONFIG || {});

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const API_BASE = String(CONFIG.apiBase || '').replace(/\/$/, '');

  const $ = (s, root = document) => root.querySelector(s);

  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const page = $('#page-content');

  const storage = { get(k){ try { return preferences.getItem(k); } catch { return null; } }, set(k,v){ try { preferences.setItem(k,String(v)); } catch {} } };

  const state = {
    route: 'overview',
    logs: createLogQuery(matchMedia('(max-width:600px)').matches),
    ruleTag: 'whitelist',
    mobileMoreOpen: false, renderSeq: 0,
    overviewSlowPage: 0, overviewDomainPage: 0,
    overviewSlowLimit: [5,10,20].includes(Number(storage.get('localdns-overview-slow-limit:' + (API_BASE || location.host)))) ? Number(storage.get('localdns-overview-slow-limit:' + (API_BASE || location.host))) : 10
  };
export { CONFIG, reduceMotion, API_BASE, $, $$, page, storage, state };
