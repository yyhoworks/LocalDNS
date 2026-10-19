/** Existing database and keys are retained for rollback compatibility. Writes resolve on commit. */
export class AppearanceRepository {
  constructor(private factory: () => IDBFactory = () => globalThis.indexedDB) {}

  private transaction(mode: IDBTransactionMode, keys: string[], value?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let settled = false, database: IDBDatabase | undefined, transaction: IDBTransaction | undefined;
      const result: Record<string, unknown> = {};
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); database?.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => { try { transaction?.abort(); } catch { /* Already completed. */ } finish(new Error('浏览器存储响应超时')); }, 8000);
      let request: IDBOpenDBRequest;
      try { request = this.factory().open('localdns-appearance', 1); }
      catch (error) { finish(error); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('settings')) request.result.createObjectStore('settings'); };
      request.onerror = () => finish(request.error);
      request.onblocked = () => finish(new Error('请关闭其他 LocalDNS 标签页后重试'));
      request.onsuccess = () => {
        database = request.result;
        if (settled) { database.close(); return; }
        try {
          transaction = database.transaction('settings', mode);
          const store = transaction.objectStore('settings');
          for (const key of keys) {
            const operation = mode === 'readonly' ? store.get(key) : store.put(value, key);
            operation.onsuccess = () => { result[key] = operation.result; };
          }
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish(transaction?.error || new Error('浏览器未能保存设置'));
          transaction.onerror = () => {};
        } catch (error) { finish(error); }
      };
    });
  }

  read(keys: string[]): Promise<Record<string, unknown>> { return this.transaction('readonly', keys); }
  async write(key: string, value: unknown): Promise<void> { await this.transaction('readwrite', [key], value); }
}

export const appearanceRepository = new AppearanceRepository();
