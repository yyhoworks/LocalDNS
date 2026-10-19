export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason || new DOMException('Request cancelled', 'AbortError');
}
