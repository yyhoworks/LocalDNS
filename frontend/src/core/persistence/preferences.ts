import { appEvents } from '../events/event-bus';

/** Preserve existing keys and storage exceptions; callers choose their fallback and feedback. */
export class Preferences {
  constructor(private storage: () => Storage) {}
  getItem(key: string): string | null { return this.storage().getItem(key); }
  setItem(key: string, value: string): void {
    try { this.storage().setItem(key, String(value)); }
    catch (error) {
      appEvents.emit('preferences:error', { key, message: '浏览器未能保存设置，本次修改不会在刷新后保留。' });
      throw error;
    }
  }
  removeItem(key: string): void { this.storage().removeItem(key); }
  get<T>(key: string, fallback: T): T {
    try { const raw = this.getItem(key); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
  }
  set(key: string, value: unknown): void { this.setItem(key, JSON.stringify(value)); }
}

export const preferences = new Preferences(() => globalThis.localStorage);
export const sessionPreferences = new Preferences(() => globalThis.sessionStorage);
