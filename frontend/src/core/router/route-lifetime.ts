import { CleanupScope } from '../lifecycle/cleanup-scope';

let active = new CleanupScope();
export function currentScope(): CleanupScope { return active; }
export function beginRoute(): CleanupScope {
  active.dispose();
  active = new CleanupScope();
  return active;
}
