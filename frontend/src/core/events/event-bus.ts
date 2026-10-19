export function createEventBus<Events extends Record<string, unknown>>() {
  const target = new EventTarget();
  return {
    emit<K extends keyof Events & string>(type: K, detail: Events[K]) { target.dispatchEvent(new CustomEvent(type, { detail })); },
    on<K extends keyof Events & string>(type: K, listener: (detail: Events[K]) => void, signal?: AbortSignal) {
      const handler = (event: Event) => listener((event as CustomEvent<Events[K]>).detail);
      const off = () => target.removeEventListener(type, handler);
      if (!signal?.aborted) {
        target.addEventListener(type, handler);
        signal?.addEventListener('abort', off, { once: true });
      }
      return () => { off(); signal?.removeEventListener('abort', off); };
    },
  };
}

export const appEvents = createEventBus<{
  'preferences:error': { key: string; message: string };
}>();
