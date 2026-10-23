import type { Preferences } from './preferences';

/**
 * Copy first; only remove the old key after the destination is persisted successfully.
 *
 * Status: helper with no production caller yet (exercised by infrastructure
 * tests); wire it up only from a startup path that handles failure explicitly.
 * Failures intentionally propagate — a corrupt source or a failed write must
 * surface to the caller instead of being swallowed here — and the source key
 * is always retained, so a failed migration leaves the original data intact.
 */
export function migratePreference(repository: Preferences, from: string, to: string, convert: (value: unknown) => unknown): void {
  if (repository.getItem(to) !== null) return;
  const raw = repository.getItem(from);
  if (raw === null) return;
  repository.set(to, convert(JSON.parse(raw)));
  // Retain the source throughout the rollback window.
}
