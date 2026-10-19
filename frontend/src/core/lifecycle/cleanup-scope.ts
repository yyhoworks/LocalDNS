import { throwIfAborted } from './abort';

export class CleanupScope {
  private controller = new AbortController();
  private cleanups = new Set<() => void>();
  get signal(): AbortSignal { return this.controller.signal; }

  add(cleanup: () => void): () => void {
    if (this.signal.aborted) { cleanup(); return () => {}; }
    this.cleanups.add(cleanup);
    return () => { if (this.cleanups.delete(cleanup)) cleanup(); };
  }

  listen(target: EventTarget, event: string, listener: EventListener, options?: AddEventListenerOptions): () => void {
    target.addEventListener(event, listener, options);
    return this.add(() => target.removeEventListener(event, listener, options));
  }

  timeout(callback: () => void, delay: number): () => void {
    const timer = setTimeout(() => { release(); if (!this.signal.aborted) callback(); }, delay);
    const release = this.add(() => clearTimeout(timer));
    return release;
  }

  interval(callback: () => void, delay: number): () => void {
    const timer = setInterval(() => { if (!this.signal.aborted) callback(); }, delay);
    return this.add(() => clearInterval(timer));
  }

  async guard<T>(promise: Promise<T>): Promise<T> {
    throwIfAborted(this.signal);
    const result = await promise;
    throwIfAborted(this.signal);
    return result;
  }

  dispose(): void {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const cleanup of [...this.cleanups].reverse()) { try { cleanup(); } catch { /* Continue releasing other resources. */ } }
    this.cleanups.clear();
  }
}
