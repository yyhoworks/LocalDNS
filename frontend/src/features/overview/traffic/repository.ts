/** One raw counter snapshot per five-second slot; isolated by DNS API address. */
export class TrafficRepository {
  constructor(private factory: () => IDBFactory = () => globalThis.indexedDB) {}

  private transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false, database: IDBDatabase | undefined, transaction: IDBTransaction | undefined;
      let value: T;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); database?.close();
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => {
        try { transaction?.abort(); } catch { /* Already closed. */ }
        finish(new Error('浏览器历史存储响应超时'));
      }, 8000);
      let request: IDBOpenDBRequest;
      try { request = this.factory().open('localdns-dns-trends', 1); }
      catch (error) { finish(error); return; }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('samples', { keyPath: ['source', 'slot'] });
        store.createIndex('time', 'time');
      };
      request.onerror = () => finish(request.error || new Error('无法打开浏览器历史存储'));
      request.onblocked = () => finish(new Error('浏览器历史存储被其他标签页占用'));
      request.onsuccess = () => {
        database = request.result;
        if (settled) { database.close(); return; }
        try {
          transaction = database.transaction('samples', mode);
          transaction.oncomplete = () => finish();
          transaction.onabort = () => finish(transaction?.error || new Error('浏览器未能保存采样'));
          transaction.onerror = () => finish(transaction?.error || new Error('浏览器历史读取失败'));
          run(transaction.objectStore('samples'), result => { value = result; });
        } catch (error) { finish(error); }
      };
    });
  }

  load(source: string, now = Date.now()): Promise<Record<string, unknown>[]> {
    return this.transaction('readonly', (store, done) => {
      const rows: Record<string, unknown>[] = [];
      const query = IDBKeyRange.bound([source, Math.floor((now - 604800000) / 5000)], [source, Math.floor(now / 5000)]);
      const cursor = store.openCursor(query);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) { done(rows.sort((a, b) => Number(a.time) - Number(b.time))); return; }
        if (Number(item.value.time) >= now - 604800000 && Number(item.value.time) <= now && rows.length < 121000) rows.push(item.value);
        item.continue();
      };
    });
  }

  save(source: string, sample: Record<string, unknown>, now = Date.now()): Promise<void> {
    const time = Number(sample.time);
    return this.transaction('readwrite', (store, done) => {
      const slot = Math.floor(time / 5000), existing = store.get([source, slot]);
      existing.onsuccess = () => {
        if (!existing.result || Number(existing.result.time) < time) store.put({ ...sample, source, slot });
      };
      // Indexed deletion also cleans expired data from previously visited API addresses.
      const expired = store.index('time').openCursor(IDBKeyRange.upperBound(now - 604800000, true));
      expired.onsuccess = () => { const item = expired.result; if (item) { item.delete(); item.continue(); } };
      done(undefined);
    });
  }
}

export const trafficRepository = new TrafficRepository();
