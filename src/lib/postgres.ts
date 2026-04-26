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
  // Hosted-safe extensions added in earlier rounds.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_type TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS brief_url TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS asset_links_json JSONB;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'none';`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_to TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS facebook_live_url TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS facebook_post_id TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS instagram_live_url TEXT;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS custom_fields_json JSONB;`)

  // ---------- Round 4.1 additions ----------
  // posted_at: stable timestamp of when a job's stage transitioned to
  // 'posted'. Distinct from updated_at (which moves with any later edit)
  // and from due_date (which is the planned date, not actual). Reports
  // use this to compute "posts in date range".
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;`)

  // live_metrics_json: latest cached metric snapshot for at-a-glance
  // display on cards / detail panel. Always reflects the most recent
  // fetch. Historical values live in metric_snapshots (below).
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS live_metrics_json JSONB;`)
  // last_metrics_fetch_at: when the live_metrics_json was last refreshed.
  // Used by the UI to show "fetched 3 hours ago" hints and by background
  // jobs to decide when to re-fetch.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_metrics_fetch_at TIMESTAMPTZ;`)

  // ---------- Round 6.1 additions ----------
  // campaign: free-text campaign name. Lets users group posts under a
  // shared label (e.g. "Spring Launch 2026") and later filter the
  // campaign-comparison report to that group. Per-workspace conceptually
  // — the autocomplete endpoint only returns distinct values within
  // the calling workspace, so the same string under two workspaces is
  // treated as two unrelated campaigns.
  //
  // No separate `campaigns` table: campaigns are essentially tags for a
  // small team. If management features become important later (rename
  // a campaign across many posts at once, share a campaign across
  // workspaces, etc.) we can normalise then.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS campaign TEXT;`)
  // Partial index — only rows that actually have a campaign value are
  // indexed. Most jobs probably won't, so this stays small. Speeds up
  // both the autocomplete query (DISTINCT campaign WHERE workspace_id=X)
  // and the campaign-filtered reports.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS jobs_workspace_campaign_idx
    ON jobs (workspace_id, campaign)
    WHERE campaign IS NOT NULL;
  `)

  // ---------- metric_snapshots ----------
  // Append-only history of every metric fetch we record. One row per
  // fetch per platform. Reports query this for trend analysis (month-
  // over-month growth, engagement-rate over time, etc).
  //
  // Why we keep BOTH live_metrics_json on the job AND a snapshots table:
  //   - jobs.live_metrics_json answers "what's the current state?" cheaply,
  //     no JOIN needed for kanban cards.
  //   - metric_snapshots answers "how did this evolve?" — slower per-row
  //     but only relevant for reports.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      platform TEXT,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      views INTEGER,
      likes INTEGER,
      comments INTEGER,
      shares INTEGER,
      saves INTEGER,
      reach INTEGER,
      impressions INTEGER,
      engagement_rate NUMERIC(8, 4),
      raw_json JSONB
    );
  `)
  // Reports filter heavily by workspace_id + captured_at range — this
  // index makes those queries fast.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS metric_snapshots_workspace_captured_idx
    ON metric_snapshots (workspace_id, captured_at DESC);
  `)
  // Lookups for "all snapshots of this job" (used when rendering the
  // metric history on the detail panel later).
  await pool.query(`
    CREATE INDEX IF NOT EXISTS metric_snapshots_job_captured_idx
    ON metric_snapshots (job_id, captured_at DESC);
  `)

  // ---------- backfill posted_at for existing posted jobs ----------
  // Jobs that are already in stage='posted' but predate this column
  // would otherwise be invisible to date-range reports. We backfill
  // their posted_at from updated_at as a one-time approximation. This
  // runs once (subsequent calls are no-ops because posted_at IS NOT NULL).
  await pool.query(`
    UPDATE jobs
    SET posted_at = updated_at
    WHERE stage = 'posted' AND posted_at IS NULL;
  `)

  // ---------- settings ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // ---------- bootstrap admin ----------
  // If there are no users yet AND ADMIN_EMAIL/ADMIN_PASSWORD are present in
  // the environment, create the first admin user from those values.
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
