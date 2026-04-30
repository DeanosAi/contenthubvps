import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'
import { assertCanViewJob, logJobEdits, valueForAudit } from '@/lib/permissions'

/**
 * POST /api/jobs/:id/approval — Round 7.11p.
 *
 * Briefer-facing approval action. Distinct from a generic
 * approval_status PATCH because:
 *   - Briefers don't have approval_status in BRIEFER_EDITABLE_FIELDS
 *     (they shouldn't be able to flip arbitrary states), so
 *     PATCH /api/jobs/:id with approvalStatus would 403.
 *   - This endpoint enforces VALID transitions only:
 *       awaiting → approved
 *       awaiting → changes_requested
 *     Any other current state means "no, you can't change this
 *     right now" — a briefer shouldn't be able to retroactively
 *     un-approve, or approve something not awaiting them.
 *
 * Staff (admin/member) can also call this endpoint — useful for
 * the staff app to log approvals through the same path. They have
 * the regular PATCH route as well, so this is just convenience.
 *
 * The endpoint logs to job_edits the same as PATCH would, so
 * approval transitions appear in the audit history.
 */

const ApprovalInput = z.object({
  decision: z.enum(['approved', 'changes_requested']),
})

const COLUMN_LIST = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json, campaign,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  briefer_display_name, briefer_display_email,
  created_at, updated_at
`

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: jobId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ApprovalInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  await ensureSchema()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const beforeRes = await client.query<{
      id: string
      workspace_id: string
      approval_status: string
    }>(
      `SELECT id, workspace_id, approval_status FROM jobs WHERE id = $1 FOR UPDATE`,
      [jobId],
    )
    if (beforeRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const before = beforeRes.rows[0]

    // Workspace gate — briefers in another workspace get 404.
    const accessCheck = assertCanViewJob(session, before.workspace_id)
    if (!accessCheck.ok) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
    }

    // Transition validation: must be FROM 'awaiting'. Otherwise
    // we tell the caller why so the UI can avoid showing the
    // buttons in the wrong state.
    if (before.approval_status !== 'awaiting') {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { error: 'This brief is not currently awaiting approval.' },
        { status: 409 },
      )
    }

    const newStatus = parsed.data.decision

    await client.query(
      `UPDATE jobs
          SET approval_status = $1, updated_at = NOW()
        WHERE id = $2`,
      [newStatus, jobId],
    )

    // Audit-log the change via the same helper the PATCH endpoint
    // uses, so the approval shows up in the edit history with the
    // briefer's session display name.
    await logJobEdits(client, jobId, [{
      fieldName: 'approval_status',
      oldValue: valueForAudit(before.approval_status),
      newValue: valueForAudit(newStatus),
    }], session)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [jobId])
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, job: rowToJob(result.rows[0]) })
}
