import { CleanupScope } from './cleanup-scope';

/** A route can replace a tab/list without replacing the whole route. */
export class LatestView {
  private active?: CleanupScope;
  private release?: () => void;
  constructor(private parent: CleanupScope) {}

  begin(): CleanupScope {
    this.release?.();
    const scope = new CleanupScope();
    this.active = scope;
    this.release = this.parent.add(() => scope.dispose());
    return scope;
  }

  get signal(): AbortSignal | undefined { return this.active?.signal; }
}
