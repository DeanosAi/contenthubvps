import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'
import { ALLOWED_JOB_TYPES } from '@/lib/types'
import { assertCanSubmitBrief } from '@/lib/permissions'

/**
 * POST /api/jobs/brief-submit — Round 7.11.
 * Round 7.12: contentTypes replaces contentType (multi-select).
 *
 * The briefer-facing path for creating a new job. Distinct from
 * POST /api/jobs because:
 *   - Workspace is forced to the briefer's session.workspaceId
 *     (they cannot brief into another venue's workspace).
 *   - Stage is forced to 'brief' (briefers cannot start a job at
 *     a later stage).
 *   - Production-side fields are not accepted from the body.
 *   - briefer_display_name is captured from the session at submit
 *     time, snapshotting "who briefed this" for staff visibility.
 */

const BriefSubmitInput = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  hashtags: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  // Round 7.12: contentType deprecated, contentTypes is the
  // active multi-select field.
  contentType: z.string().nullable().optional(),
  contentTypes: z.array(z.string()).optional(),
  campaign: z.string().nullable().optional(),
})

function normaliseCampaign(v: string | null | undefined): string | null {
  if (v == null) return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normaliseContentTypes(arr: readonly string[] | undefined): string[] {
  if (!arr) return []
  const allowed = new Set<string>(ALLOWED_JOB_TYPES as readonly string[])
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of arr) {
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (!allowed.has(trimmed)) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  const order: Map<string, number> = new Map(
    ALLOWED_JOB_TYPES.map((v, i) => [v as string, i])
  )
  out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return out
}

const COLUMN_LIST = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, content_types, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json, campaign,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  briefer_display_name, briefer_display_email,
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

  const brieferName = session.displayName?.trim() || null
  const brieferEmail = session.displayEmail?.trim() || null
  if (session.role === 'briefer' && (!brieferName || !brieferEmail)) {
    return NextResponse.json(
      { error: 'Please set your name and email before submitting a brief' },
      { status: 400 }
    )
  }

  const id = randomUUID()
  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null
  const contentTypes = normaliseContentTypes(parsed.data.contentTypes)

  await pool.query(
    `INSERT INTO jobs (
      id, workspace_id, title, description, stage, priority, due_date,
      hashtags, platform, content_types, campaign,
      briefer_display_name, briefer_display_email
    ) VALUES (
      $1, $2, $3, $4, 'brief', 0, $5,
      $6, $7, $8, $9,
      $10, $11
    )`,
    [
      id,
      workspaceId,
      parsed.data.title,
      parsed.data.description ?? null,
      dueDate,
      parsed.data.hashtags ?? null,
      parsed.data.platform ?? null,
      contentTypes,
      normaliseCampaign(parsed.data.campaign),
      brieferName,
      brieferEmail,
    ]
  )

  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [id])
  return NextResponse.json({ ok: true, job: rowToJob(result.rows[0]) }, { status: 201 })
}
