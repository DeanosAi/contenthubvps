import { pool } from './postgres'
import type { SettingKey } from './types'

/**
 * Look up a single setting value from app_settings. Returns null if the
 * key isn't present. Keep this server-only — settings include things like
 * the Apify token which must never be exposed to the browser.
 *
 * Why a tiny helper rather than inlining: every endpoint that reads
 * settings ends up writing the same SELECT, and fixing a bug here
 * (e.g. caching, defaults) is one place vs N.
 */
export async function getSetting(key: SettingKey): Promise<string | null> {
  const res = await pool.query<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = $1',
    [key],
  )
  return res.rows[0]?.value ?? null
}
