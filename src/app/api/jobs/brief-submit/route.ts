import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'
import { assertCanSubmitBrief } from '@/lib/permissions'

/**
 * POST /api/jobs/brief-submit — Round 7.11.
 *
 * The briefer-facing path for creating a new job. Distinct from
 * POST /api/jobs because:
 *   - Workspace is forced to the briefer's session.workspaceId
 *     (they cannot brief into another venue's workspace).
 *   - Stage is forced to 'brief' (briefers cannot start a job at
 *     a later stage).
 *   - Production-side fields (assignedTo, approvalStatus,
 *     facebookPostId, etc.) are not accepted from the body —
 *     those belong to staff workflows.
 *   - briefer_display_name is captured from the session at submit
 *     time, snapshotting "who briefed this" for staff visibility.
 *
 * Staff (admin/member) can also call this endpoint — useful for
 * the staff app to support a "create as briefer-X" flow if needed
 * later. The session.role check inside assertCanSubmitBrief
 * delegates to the standard workspace access rules.
 */

const BriefSubmitInput = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  hashtags: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  campaign: z.string().nullable().optional(),
})

function normaliseCampaign(v: string | null | undefined): string | null {
  if (v == null) return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

const COLUMN_LIST = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json, campaign,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  briefer_display_name,
  created_at, updated_at
`

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BriefSubmitInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid brief payload' },
      { status: 400 }
    )
  }

  await ensureSchema()

  // For briefers: force workspaceId to their own. Reject any other
  // value before it could land in the database.
  let workspaceId = parsed.data.workspaceId
  if (session.role === 'briefer') {
    if (!session.workspaceId) {
      return NextResponse.json(
        { error: 'Briefer account is not bound to a workspace' },
        { status: 403 }
      )
    }
    if (workspaceId !== session.workspaceId) {
      return NextResponse.json(
        { error: 'Briefers can only submit briefs into their own workspace' },
        { status: 403 }
      )
    }
    workspaceId = session.workspaceId
  }

  // Workspace existence + access check.
  const ws = await pool.query<{ id: string }>(
    'SELECT id FROM workspaces WHERE id = $1',
    [workspaceId]
  )
  if (ws.rows.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }
  const accessCheck = assertCanSubmitBrief(session, workspaceId)
  if (!accessCheck.ok) {
    return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
  }

  // Briefers must have set their display name before submitting —
  // otherwise we can't attribute "who briefed this." The UI gates
  // the form behind the prompt, but defensively check here too.
  const brieferName = session.displayName?.trim() || null
  if (session.role === 'briefer' && !brieferName) {
    return NextResponse.json(
      { error: 'Please set your name before submitting a brief' },
      { status: 400 }
    )
  }

  const id = randomUUID()
  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null

  await pool.query(
    `INSERT INTO jobs (
      id, workspace_id, title, description, stage, priority, due_date,
      hashtags, platform, content_type, campaign,
      briefer_display_name
    ) VALUES (
      $1, $2, $3, $4, 'brief', 0, $5,
      $6, $7, $8, $9,
      $10
    )`,
    [
      id,
      workspaceId,
      parsed.data.title,
      parsed.data.description ?? null,
      dueDate,
      parsed.data.hashtags ?? null,
      parsed.data.platform ?? null,
      parsed.data.contentType ?? null,
      normaliseCampaign(parsed.data.campaign),
      brieferName,
    ]
  )

  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [id])
  return NextResponse.json({ ok: true, job: rowToJob(result.rows[0]) }, { status: 201 })
}
