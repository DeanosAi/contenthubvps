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
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      name            TEXT,
      role            TEXT NOT NULL DEFAULT 'member',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);`)

  // NOTE: the workspace_id column on users is added AFTER the
  // workspaces table is created, since it has an FK to workspaces.
  // See "Round 7.11 — briefer role + workspace scoping" below.

  // ---------- workspaces ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id                   TEXT PRIMARY KEY,
      owner_id             TEXT NOT NULL,
      name                 TEXT NOT NULL,
      color                TEXT NOT NULL DEFAULT '#8b5cf6',
      sort_order           INTEGER NOT NULL DEFAULT 0,
      facebook_page_url    TEXT,
      instagram_page_url   TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS facebook_page_url TEXT;`)
  await pool.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS instagram_page_url TEXT;`)

  // ---------- Round 7.11 — briefer role + workspace scoping ----------
  // Adds an optional workspace_id to users so a "briefer" role can be
  // bound to a single workspace (their venue). NULL for admin/member;
  // required at the API layer for the briefer role.
  //
  // ON DELETE CASCADE on workspace_id: if a venue/workspace is deleted,
  // its briefer login goes with it. That's the right behaviour — a
  // briefer login is meaningless without its workspace.
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_id TEXT
       REFERENCES workspaces(id) ON DELETE CASCADE;`
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS users_workspace_idx ON users (workspace_id)
       WHERE workspace_id IS NOT NULL;`
  )

  // ---------- jobs ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      description     TEXT,
      stage           TEXT NOT NULL DEFAULT 'brief',
      priority        INTEGER NOT NULL DEFAULT 0,
      due_date        TIMESTAMPTZ,
      hashtags        TEXT,
      platform        TEXT,
      live_url        TEXT,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS live_metrics_json JSONB;`)
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_metrics_fetch_at TIMESTAMPTZ;`)

  // ---------- Round 6.1 additions ----------
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS campaign TEXT;`)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS jobs_workspace_campaign_idx
    ON jobs (workspace_id, campaign)
    WHERE campaign IS NOT NULL;
  `)

  // ---------- Round 7.11 — briefer attribution on jobs ----------
  // When a brief is submitted by a briefer, we capture the actual
  // person's name from their session at submit time. Stored on the
  // job so the staff team can see "Tracy briefed this" even when
  // the venue's shared login is later used by Sarah.
  //
  // Independent of any user FK — preserves attribution across
  // session changes and across staff renaming/deleting briefer
  // accounts. The shared venue login provides the WORKSPACE binding;
  // briefer_display_name provides the WHO binding.
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS briefer_display_name TEXT;`)

  // ---------- Round 7.12 — Type of Job (multi-select) ----------
  // Replaces the free-text content_type with a constrained multi-
  // select. Stored as Postgres TEXT[] so a single job can have
  // multiple types (a "video that's also a social post" gets both).
  //
  // Allowed values are validated at the API layer (see
  // ALLOWED_JOB_TYPES in lib/types.ts). The column itself is
  // unconstrained TEXT[] — keeps schema flexible for adding new
  // values without ALTER TABLE.
  //
  // The legacy `content_type TEXT` column is left in place but
  // unused by application code. It can be dropped in a later
  // round once we're confident nothing reads it.
  //
  // Default value: empty array (NOT NULL with DEFAULT '{}'). This
  // means existing rows automatically get an empty array, no
  // backfill required.
  await pool.query(
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_types TEXT[] NOT NULL DEFAULT '{}'`
  )
  // Index on content_types for fast filtering. GIN is the right
  // index for array containment queries (`'Video' = ANY(content_types)`).
  await pool.query(
    `CREATE INDEX IF NOT EXISTS jobs_content_types_gin_idx ON jobs USING GIN (content_types)`
  )

  // ---------- Round 7.2: kanban_columns ----------
  // Per-workspace kanban column configuration. Lets users rename built-in
  // columns (e.g. "Posted" → "Posted/Live"), reorder them, and add
  // entirely new columns for their own workflow needs.
  //
  // Design notes:
  //
  // - `stage_key` is the literal value stored in `jobs.stage`. For the
  //   five reserved stages this is one of brief/production/ready/
  //   posted/archive — those keys are immutable forever because
  //   reports filter on them. For user-added columns the key is
  //   generated as `cust_<short-uuid>` so it can never collide with a
  //   future built-in stage we might introduce.
  //
  // - `label` is the user-facing column header. Editable for ALL
  //   columns. Built-ins start with the historical defaults; the user
  //   can rename them freely without affecting reports.
  //
  // - `is_builtin` distinguishes the five reserved stages from
  //   user-added ones. Built-ins can be renamed and reordered but NOT
  //   deleted (the column is a safety hatch enforced by the API).
  //   User-added columns can be deleted.
  //
  // - Existing workspaces get auto-seeded with the five built-in rows
  //   below so the migration is invisible — every workspace ends up
  //   with the same default board it had before.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanban_columns (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      stage_key     TEXT NOT NULL,
      label         TEXT NOT NULL,
      color         TEXT NOT NULL DEFAULT '#64748b',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_builtin    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, stage_key)
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS kanban_columns_workspace_sort_idx
    ON kanban_columns (workspace_id, sort_order);
  `)

  // Auto-seed: any workspace with no kanban_columns rows gets the five
  // built-ins inserted at the historical default labels and order.
  // This is the migration path for existing data — no manual step
  // required, just runs once per workspace on first hit after deploy.
  //
  // The default for the 'posted' column is "Posted/Live" per Round 7.2
  // brief; existing teams can rename in either direction freely.
  await pool.query(`
    WITH workspaces_needing_seed AS (
      SELECT w.id AS workspace_id
      FROM workspaces w
      LEFT JOIN kanban_columns kc ON kc.workspace_id = w.id
      WHERE kc.id IS NULL
      GROUP BY w.id
    ),
    defaults AS (
      SELECT * FROM (VALUES
        ('brief',      'Brief',             '#64748b', 0),
        ('production', 'In Production',     '#3b82f6', 1),
        ('ready',      'Ready for Posting', '#f59e0b', 2),
        ('posted',     'Posted/Live',       '#10b981', 3),
        ('archive',    'Archive',           '#4b5563', 4)
      ) AS d(stage_key, label, color, sort_order)
    )
    INSERT INTO kanban_columns (id, workspace_id, stage_key, label, color, sort_order, is_builtin)
    SELECT
      gen_random_uuid()::text,
      w.workspace_id,
      d.stage_key,
      d.label,
      d.color,
      d.sort_order,
      TRUE
    FROM workspaces_needing_seed w
    CROSS JOIN defaults d;
  `)

  // ---------- metric_snapshots ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id                TEXT PRIMARY KEY,
      job_id            TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      platform          TEXT,
      captured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      views             INTEGER,
      likes             INTEGER,
      comments          INTEGER,
      shares            INTEGER,
      saves             INTEGER,
      reach             INTEGER,
      impressions       INTEGER,
      engagement_rate   NUMERIC(8, 4),
      raw_json          JSONB
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS metric_snapshots_workspace_captured_idx
    ON metric_snapshots (workspace_id, captured_at DESC);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS metric_snapshots_job_captured_idx
    ON metric_snapshots (job_id, captured_at DESC);
  `)

  // ---------- backfill posted_at for existing posted jobs ----------
  await pool.query(`
    UPDATE jobs
       SET posted_at = updated_at
     WHERE stage = 'posted' AND posted_at IS NULL;
  `)

  // ---------- settings ----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // ---------- job comments (Round 7.10) ----------
  // Per-job discussion thread. Comments are flat (no nested replies),
  // append-only (with per-comment edit/delete by author or admin),
  // and persist if the author user is later deleted (author_id goes
  // NULL and the UI renders "Former user").
  //
  // ON DELETE CASCADE on job_id: deleting a job removes its comments.
  // ON DELETE SET NULL on author_id: deleting a user preserves their
  // historical comments rather than losing the audit trail.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_comments (
      id          TEXT PRIMARY KEY,
      job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      body        TEXT NOT NULL,
      edited      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS job_comments_job_created_idx
    ON job_comments (job_id, created_at DESC);
  `)

  // ---------- Round 7.11 — display_name on job_comments ----------
  // Comments now carry a display_name captured from the session at
  // post time. For staff comments this defaults to the user's name
  // field, but for briefer comments it's the venue session's
  // current "who's using this account today" answer. Lets the UI
  // render "Tracy from Mt Druitt: ..." even though the underlying
  // user record is just the shared venue login.
  await pool.query(
    `ALTER TABLE job_comments ADD COLUMN IF NOT EXISTS display_name TEXT;`
  )

  // ---------- Round 7.11 — job_edits audit log ----------
  // Per-field edit history. Logs every PATCH that touches a tracked
  // field on a job. Fed by the jobs PATCH endpoint via the
  // logJobEdits() helper. Surfaces in the UI as inline indicators
  // ("edited by X on Y") next to fields, plus a full timeline
  // accessible from the detail panel.
  //
  // Design notes:
  //
  // - One row per (job, field, edit). Multiple field changes in a
  //   single PATCH produce multiple rows so each field's history
  //   can be viewed independently.
  // - old_value and new_value store full text. For long descriptions
  //   this means duplicate storage, but at our scale the cost is
  //   negligible (~MB/year for the whole team).
  // - edited_by_name snapshots the session display_name at edit
  //   time. Preserves "Tracy edited this" across user renames and
  //   shared-login user changes.
  // - ON DELETE CASCADE on job_id: deleting a job removes its edit
  //   history. ON DELETE SET NULL on edited_by_user_id: deleting a
  //   user preserves the edit log (we still have the snapshotted
  //   name).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_edits (
      id                  TEXT PRIMARY KEY,
      job_id              TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      field_name          TEXT NOT NULL,
      old_value           TEXT,
      new_value           TEXT,
      edited_by_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
      edited_by_name      TEXT NOT NULL,
      edited_by_role      TEXT NOT NULL,
      edited_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS job_edits_job_idx
    ON job_edits (job_id, edited_at DESC);
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS job_edits_job_field_idx
    ON job_edits (job_id, field_name, edited_at DESC);
  `)

  // ---------- bootstrap admin ----------
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

/**
 * The five reserved stage keys. Reports filter on these literal values,
 * so they are immutable forever. Custom user-added columns get keys of
 * the form `cust_<short-uuid>` to guarantee no collision.
 */
export const BUILTIN_STAGE_KEYS = ['brief', 'production', 'ready', 'posted', 'archive'] as const

/** Default seed data — exported so the API can re-create defaults if the
 *  user manages to delete all their columns somehow (defensive). */
export const BUILTIN_COLUMN_DEFAULTS: Array<{
  stage_key: (typeof BUILTIN_STAGE_KEYS)[number]
  label: string
  color: string
  sort_order: number
}> = [
  { stage_key: 'brief',      label: 'Brief',             color: '#64748b', sort_order: 0 },
  { stage_key: 'production', label: 'In Production',     color: '#3b82f6', sort_order: 1 },
  { stage_key: 'ready',      label: 'Ready for Posting', color: '#f59e0b', sort_order: 2 },
  { stage_key: 'posted',     label: 'Posted/Live',       color: '#10b981', sort_order: 3 },
  { stage_key: 'archive',    label: 'Archive',           color: '#4b5563', sort_order: 4 },
]
