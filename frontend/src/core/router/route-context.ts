import type { CleanupScope } from '../lifecycle/cleanup-scope';

export interface RouteContext {
  signal: AbortSignal;
  scope: CleanupScope;
  navigate(route: string): void;
  notify(message: string, type?: 'success' | 'error' | 'info'): void;
}

export interface RouteModule {
  mount(container: HTMLElement, context: RouteContext): void | (() => void) | Promise<void | (() => void)>;
  canLeave?(): boolean | Promise<boolean>;
}
