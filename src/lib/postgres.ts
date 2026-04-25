import { Pool } from 'pg'

const globalForPg = globalThis as unknown as { pool?: Pool }

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  })

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8b5cf6',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

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

  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS platform TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS live_url TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notes TEXT;`)
}
