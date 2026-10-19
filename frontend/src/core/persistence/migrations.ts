import type { Preferences } from './preferences';

/** Copy first; only remove the old key after the destination is persisted successfully. */
export function migratePreference(repository: Preferences, from: string, to: string, convert: (value: unknown) => unknown): void {
  if (repository.getItem(to) !== null) return;
  const raw = repository.getItem(from);
  if (raw === null) return;
  repository.set(to, convert(JSON.parse(raw)));
  // Retain the source throughout the rollback window.
}
