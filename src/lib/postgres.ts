import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const globalForPg = globalThis as unknown as { pool?: Pool; schemaReady?: boolean }

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  })

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool

/**
 * Idempotently brings the database schema up to the version this build
 * expects. Safe to call on every request — uses CREATE TABLE IF NOT EXISTS,
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS, and guards the bootstrap with a
 * `users` row count check.
 *
 * In-process: the first call after server start runs the work, subsequent
 * calls return immediately via `globalForPg.schemaReady`. This avoids
 * hitting the DB on every API request.
 */
export async function ensureSchema(): Promise<void> {
  if (globalForPg.schemaReady) return

  // ---------- users ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);`)

  // ---------- workspaces ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8b5cf6',
      sort_order INTEGER NOT NULL DEFAULT 0,
      facebook_page_url TEXT,
      instagram_page_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  // Idempotent column adds for upgrades from the earlier minimal schema.
  await pool.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS facebook_page_url TEXT;`)
  await pool.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS instagram_page_url TEXT;`)

  // ---------- jobs ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      stage TEXT NOT NULL DEFAULT 'brief',
      priority INTEGER NOT NULL DEFAULT 0,
      due_date TIMESTAMPTZ,
      hashtags TEXT,
      platform TEXT,
      live_url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  // Hosted-safe extensions called out in the brief.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_type TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS brief_url TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS asset_links_json JSONB;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'none';`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_to TEXT;`)
  // Per-platform metric URL fields and cached Facebook post id, so live
  // metrics can ride on top in a later round without another schema bump.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS facebook_live_url TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS instagram_live_url TEXT;`)
  // Custom fields — user-defined per-job key/value pairs of the desktop-app
  // form. Stored as a JSON array of {id, label, type, value} objects so that
  // each job can have a different shape without rigid columns.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS custom_fields_json JSONB;`)

  // ---------- settings ----------
  // Simple key-value store. Phase 6 (Settings/Branding) reads/writes here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // ---------- bootstrap admin ----------
  // If there are no users yet AND ADMIN_EMAIL/ADMIN_PASSWORD are present in
  // the environment, create the first admin user from those values. This
  // gives a safe upgrade path from the previous single-admin model: the
  // operator's existing credentials become the seed for the new users
  // table on first deploy after upgrade.
  const userCountRes = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users')
  const userCount = Number(userCountRes.rows[0]?.count ?? 0)
  if (userCount === 0) {
    const seedEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
    const seedPassword = process.env.ADMIN_PASSWORD || ''
    if (seedEmail && seedPassword) {
      const id = randomUUID()
      const hash = await bcrypt.hash(seedPassword, 10)
      await pool.query(
        `INSERT INTO users (id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, 'admin')
         ON CONFLICT (email) DO NOTHING`,
        [id, seedEmail, hash, 'Admin']
      )

      // Reassign any pre-existing workspaces (which were owned by the
      // string 'admin' under the old single-admin model) to the new
      // real user id, so they show up correctly under the new auth.
      await pool.query(
        `UPDATE workspaces SET owner_id = $1 WHERE owner_id IN ('admin', '')`,
        [id]
      )
    }
  }

  globalForPg.schemaReady = true
}

/** Allow forced re-check on demand (e.g. for tests). Not used in app code. */
export function markSchemaDirty(): void {
  globalForPg.schemaReady = false
}
