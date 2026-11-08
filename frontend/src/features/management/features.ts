import { ApiError } from '../../core/api/api-error';
import { parseFeatures } from '../../core/api/backend-client';
import { switchProfiles } from './feature-profiles.js';

type Read = (path: string) => Promise<unknown>;
export type FeatureSwitches = { profiles: typeof switchProfiles; status: Record<string, string> };

/** A successful response without an optional field means unsupported; read failures remain unknown. */
export async function readFeatureSwitches(read: Read): Promise<FeatureSwitches> {
  try {
    const raw = await read('/api/v1/features');
    if (typeof raw === 'string' && /^\s*(?:<!doctype html|<html)/i.test(raw)) return readLegacy(read);
    const data = parseFeatures(raw);
    const profiles = switchProfiles.filter(profile => !profile.optional || profile.key in data);
    const status = Object.fromEntries(profiles.map(profile => [profile.tag,
      (profile.value ? data[profile.key] === profile.value : data[profile.key] === true) ? 'A' : 'B']));
    return { profiles, status };
  } catch (error) {
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return readLegacy(read);
    return { profiles: switchProfiles, status: {} };
  }
}

async function readLegacy(read: Read): Promise<FeatureSwitches> {
  const profiles = switchProfiles.filter(profile => !profile.optional);
  const states = await Promise.all(profiles.map(async profile => {
    try { return String(await read(`/plugins/${profile.tag}/show`)).trim(); }
    catch { return 'error'; }
  }));
  return { profiles, status: Object.fromEntries(profiles.map((profile, index) => [profile.tag, states[index]])) };
}
