/**
 * Round 7.11 — Permission helpers.
 *
 * Single source of truth for access control across all API endpoints.
 * Every handler that touches workspace-scoped data calls one of these
 * helpers BEFORE returning data. Centralising the logic here makes it:
 *
 *   - greppable: search the codebase for `assertBrieferCanAccess` to
 *     find every enforcement point
 *   - testable: one function to verify, not 20
 *   - consistent: the same 404/403 semantics everywhere
 *
 * SECURITY NOTE: do not rewrite the `briefer` checks at endpoint level.
 * Always go through this module. If a new endpoint needs a new check,
 * add it here and call it from the endpoint.
 */

import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'
import { pool } from './postgres'
import type { SessionUser, UserRole } from './types'

/**
 * The set of fields a briefer is allowed to edit on a job they
 * have access to. Anything outside this list → 403.
 *
 * Kept in sync with what a briefer originally entered when
 * submitting the brief (see brief-submit endpoint). Briefers
 * cannot edit production-side fields (stage, assignee, notes,
 * asset links, custom fields, etc.) — those belong to staff.
 */
export const BRIEFER_EDITABLE_FIELDS = [
  'title',
  'description',
  'due_date',
  'hashtags',
  'platform',
  'content_type',
  'campaign',
] as const

export type BrieferEditableField = (typeof BRIEFER_EDITABLE_FIELDS)[number]

/**
 * Fields tracked in the audit log. A subset of all updatable fields
 * — we don't log every staff field change (e.g. metric refreshes,
 * automated stage transitions), only the human-meaningful ones.
 *
 * For staff: we log changes to brief fields + a few production
 * fields where attribution matters (assignee, due_date, approval
 * status). For briefers: we log every field they touched.
 */
export const AUDIT_TRACKED_FIELDS = [
  'title',
  'description',
  'due_date',
  'hashtags',
  'platform',
  'content_type',
  'campaign',
  'assigned_to',
  'approval_status',
  'stage',
] as const

export type AuditTrackedField = (typeof AUDIT_TRACKED_FIELDS)[number]

/**
 * Standard "permission denied" result. Routes return one of:
 *   - 401 if no session at all (handled before reaching this module)
 *   - 404 if the resource is hidden from this user (don't leak existence)
 *   - 403 if the resource is visible but the action is forbidden
 *
 * For workspace-scoping we use 404 — a briefer probing for other
 * venues' job IDs should see "not found" identically to a missing
 * job, not "forbidden" which would confirm the ID exists.
 */
export type AccessResult =
  | { ok: true }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 403; error: string }

/**
 * Assert that the session can ACCESS the given workspace at all.
 * Used by any endpoint where the URL contains a workspace id.
 *
 * - admin/member: yes (no workspace scoping for staff)
 * - briefer: only if their session.workspaceId matches
 *
 * Returns 404 (not 403) for briefers attempting to access another
 * workspace, to avoid leaking workspace existence.
 */
export function assertCanAccessWorkspace(
  session: SessionUser,
  workspaceId: string,
): AccessResult {
  if (session.role === 'admin' || session.role === 'member') return { ok: true }
  if (session.role === 'briefer') {
    if (!session.workspaceId) {
      // Briefer with no workspace_id is a misconfigured account —
      // shouldn't be possible if user creation was done through the
      // proper path, but guard against it.
      return { ok: false, status: 403, error: 'Briefer account missing workspace binding' }
    }
    if (session.workspaceId !== workspaceId) {
      return { ok: false, status: 404, error: 'Workspace not found' }
    }
    return { ok: true }
  }
  return { ok: false, status: 403, error: 'Forbidden' }
}

/**
 * Assert that the session can VIEW the given job. Includes the
 * workspace check above plus any future job-level rules.
 *
 * Pass the job's workspace_id (typically from a SELECT before this
 * call). For not-found cases, the route should already have returned
 * 404 before reaching here.
 */
export function assertCanViewJob(
  session: SessionUser,
  jobWorkspaceId: string,
): AccessResult {
  return assertCanAccessWorkspace(session, jobWorkspaceId)
}

/**
 * Assert that the session can EDIT the given job AND the specific
 * field being edited.
 *
 * - admin/member: can edit any field on any workspace's job
 * - briefer: can edit only fields in BRIEFER_EDITABLE_FIELDS, on a
 *   job in their own workspace
 *
 * Pass the field name in snake_case (matches DB column name).
 */
export function assertCanEditJobField(
  session: SessionUser,
  jobWorkspaceId: string,
  fieldName: string,
): AccessResult {
  const accessCheck = assertCanAccessWorkspace(session, jobWorkspaceId)
  if (!accessCheck.ok) return accessCheck

  if (session.role === 'admin' || session.role === 'member') return { ok: true }

  if (session.role === 'briefer') {
    if (!(BRIEFER_EDITABLE_FIELDS as readonly string[]).includes(fieldName)) {
      return {
        ok: false,
        status: 403,
        error: `Briefers cannot edit '${fieldName}'`,
      }
    }
    return { ok: true }
  }
  return { ok: false, status: 403, error: 'Forbidden' }
}

/**
 * Assert that the session can DELETE the given job.
 * Currently: only admin/member. Briefers cannot delete jobs even
 * if they submitted them — once briefed, the staff team owns the
 * job's lifecycle.
 */
export function assertCanDeleteJob(
  session: SessionUser,
  jobWorkspaceId: string,
): AccessResult {
  if (session.role === 'briefer') {
    return { ok: false, status: 403, error: 'Briefers cannot delete jobs' }
  }
  return assertCanAccessWorkspace(session, jobWorkspaceId)
}

/**
 * Assert that the session can SUBMIT a new brief into the given
 * workspace. Both briefers (into their own workspace) and staff
 * (any workspace) can do this.
 */
export function assertCanSubmitBrief(
  session: SessionUser,
  workspaceId: string,
): AccessResult {
  return assertCanAccessWorkspace(session, workspaceId)
}

// ============================================================
// Edit logging
// ============================================================

/**
 * Round 7.11 — log a single field-change to the job_edits audit
 * table. Called from the jobs PATCH endpoint after a successful
 * UPDATE. Pass an array of changes; this function inserts them
 * all in one round-trip.
 *
 * Only fields in AUDIT_TRACKED_FIELDS get logged. Other fields
 * (e.g. live_metrics_json, last_metrics_fetch_at) generate noise
 * not signal — they're skipped silently.
 *
 * `oldValue` and `newValue` are stringified at the call site.
 * For NULL values we store NULL (not the string "null").
 */
export interface FieldChange {
  fieldName: string
  oldValue: string | null
  newValue: string | null
}

export async function logJobEdits(
  client: PoolClient | typeof pool,
  jobId: string,
  changes: FieldChange[],
  session: SessionUser,
): Promise<void> {
  // Filter to tracked fields only.
  const tracked = changes.filter((c) =>
    (AUDIT_TRACKED_FIELDS as readonly string[]).includes(c.fieldName)
  )
  if (tracked.length === 0) return

  // Snapshot the editor identity at edit time. For briefers this
  // is the session displayName ("Tracy"), not the user's profile
  // email (which is the shared venue login like
  // briefer-mt-druitt@...). For staff it falls back to
  // the session displayName, then their email.
  const editorName = session.displayName?.trim() || session.email
  const editorRole: UserRole = session.role

  // Build a multi-row INSERT. Postgres handles arbitrary numbers
  // of rows in a single VALUES clause cleanly.
  const values: unknown[] = []
  const tuples: string[] = []
  let p = 1
  for (const change of tracked) {
    values.push(
      randomUUID(),
      jobId,
      change.fieldName,
      change.oldValue,
      change.newValue,
      session.userId,
      editorName,
      editorRole,
    )
    tuples.push(`($${p}, $${p+1}, $${p+2}, $${p+3}, $${p+4}, $${p+5}, $${p+6}, $${p+7})`)
    p += 8
  }

  await client.query(
    `INSERT INTO job_edits
       (id, job_id, field_name, old_value, new_value,
        edited_by_user_id, edited_by_name, edited_by_role)
     VALUES ${tuples.join(', ')}`,
    values,
  )
}

/**
 * Coerce a value to a string for audit log storage. Handles the
 * common shapes we see in PATCH bodies: strings, numbers, dates,
 * booleans. Returns null for null/undefined/empty-string.
 */
export function valueForAudit(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.length > 0 ? v : null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}
