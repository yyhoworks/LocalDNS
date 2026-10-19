import { HttpClient } from './http-client';
import { currentScope } from '../router/route-lifetime';

export const assetHttp = new HttpClient();
export const backendHttp = new HttpClient({
  base: String((globalThis as typeof globalThis & { LOCALDNS_UI_CONFIG?: { apiBase?: string } }).LOCALDNS_UI_CONFIG?.apiBase || '').replace(/\/$/, ''),
  timeout: (globalThis as typeof globalThis & { LOCALDNS_UI_CONFIG?: { requestTimeout?: number } }).LOCALDNS_UI_CONFIG?.requestTimeout || 10000,
  signal: () => currentScope().signal,
});
