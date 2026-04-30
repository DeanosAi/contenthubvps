import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'
import { ALLOWED_JOB_TYPES } from '@/lib/types'

const STAGES = ['brief', 'production', 'ready', 'posted', 'archive'] as const
const APPROVAL = ['none', 'awaiting', 'approved', 'changes_requested'] as const
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'url'] as const

/**
 * Round 7.12: validate and de-dupe an incoming contentTypes array.
 * Drops any value not in ALLOWED_JOB_TYPES (silently — caller can
 * see what was kept by reading the saved row back). Sorts and dedupes
 * so the stored array is canonical for cleaner diffs in the audit log.
 */
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
  // Sort by ALLOWED_JOB_TYPES order for canonical storage.
  // Map typed Map<string, number> rather than Map<JobType, number>
  // so the Map.get(string) lookup compiles cleanly without a cast.
  const order: Map<string, number> = new Map(
    ALLOWED_JOB_TYPES.map((v, i) => [v as string, i])
  )
  out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return out
}

/** Normalise a free-text campaign value: trim whitespace, treat empty
 * string as null. Prevents "Spring Launch" and "Spring Launch " from
 * being treated as two distinct campaigns because of trailing whitespace
 * from a copy/paste. Used by both POST (create) and PATCH (update). */
function normaliseCampaign(v: string | null | undefined): string | null {
  if (v == null) return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

const CustomFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  value: z.string(),
})

const CreateJobInput = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  title: z.string().trim().min(1, 'title is required').max(300),
  description: z.string().nullable().optional(),
  stage: z.enum(STAGES).default('brief'),
  priority: z.number().int().min(0).max(5).default(0),
  dueDate: z.string().nullable().optional(),
  hashtags: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  liveUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Round 7.12: contentType is deprecated. New code should use
  // contentTypes (array). We still accept contentType in the
  // input for backwards compat with any old clients but ignore it.
  contentType: z.string().nullable().optional(),
  contentTypes: z.array(z.string()).optional(),
  briefUrl: z.string().nullable().optional(),
  assetLinks: z
    .array(z.object({ id: z.string(), label: z.string(), url: z.string() }))
    .optional(),
  customFields: z.array(CustomFieldSchema).optional(),
  campaign: z.string().nullable().optional(),
  approvalStatus: z.enum(APPROVAL).optional(),
  assignedTo: z.string().nullable().optional(),
  facebookLiveUrl: z.string().nullable().optional(),
  instagramLiveUrl: z.string().nullable().optional(),
})

// Includes Round 4.1 additions: posted_at, live_metrics_json, last_metrics_fetch_at.
// Round 6.1: campaign.
// Round 7.11: briefer_display_name (briefer attribution).
// Round 7.12: content_types (multi-select Type of Job).
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

/** GET /api/jobs?workspaceId=... — list jobs, optionally filtered to a
 * single workspace.
 *
 * Round 7.11: briefers see only their own workspace's jobs regardless
 * of any workspaceId query param. If they pass a workspaceId for a
 * different workspace, we 404 (don't leak that workspace exists).
 */
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const queriedWorkspaceId = req.nextUrl.searchParams.get('workspaceId')

  // Round 7.11: briefer scoping. Always filter to their own workspace.
  if (session.role === 'briefer') {
    if (!session.workspaceId) {
      return NextResponse.json({ error: 'Briefer account missing workspace binding' }, { status: 403 })
    }
    if (queriedWorkspaceId && queriedWorkspaceId !== session.workspaceId) {
      // Don't leak the existence of other workspaces — return empty.
      return NextResponse.json([])
    }
    const result = await pool.query(
      `SELECT ${COLUMN_LIST} FROM jobs WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [session.workspaceId]
    )
    return NextResponse.json(result.rows.map(rowToJob))
  }

  // Staff path (admin/member): unchanged.
  const result = queriedWorkspaceId
    ? await pool.query(
        `SELECT ${COLUMN_LIST} FROM jobs WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [queriedWorkspaceId]
      )
    : await pool.query(`SELECT ${COLUMN_LIST} FROM jobs ORDER BY created_at DESC`)
  return NextResponse.json(result.rows.map(rowToJob))
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: briefers cannot create arbitrary jobs via this endpoint.
  // They submit briefs via POST /api/jobs/brief-submit which has a
  // restricted payload and auto-fills workspace from their session.
  if (session.role === 'briefer') {
    return NextResponse.json(
      { error: 'Briefers must submit via the brief form' },
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateJobInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid job payload' },
      { status: 400 }
    )
  }

  await ensureSchema()

  // Verify the workspace exists. Friendlier than a FK violation 500.
  const ws = await pool.query('SELECT id FROM workspaces WHERE id = $1', [parsed.data.workspaceId])
  if (ws.rows.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const id = randomUUID()
  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null

  // If the new job is being created already at stage='posted' (rare but
  // possible when imported / backfilled), stamp posted_at = NOW() so it
  // shows up in date-range reports immediately. PATCH does the same on
  // stage transitions for normal flow.
  const postedAt = parsed.data.stage === 'posted' ? new Date() : null

  await pool.query(
    `INSERT INTO jobs (
      id, workspace_id, title, description, stage, priority, due_date,
      hashtags, platform, live_url, notes,
      content_type, content_types, brief_url, asset_links_json, approval_status, assigned_to,
      custom_fields_json, campaign,
      facebook_live_url, instagram_live_url,
      posted_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17,
      $18, $19,
      $20, $21,
      $22
    )`,
    [
      id,
      parsed.data.workspaceId,
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.stage,
      parsed.data.priority,
      dueDate,
      parsed.data.hashtags ?? null,
      parsed.data.platform ?? null,
      parsed.data.liveUrl ?? null,
      parsed.data.notes ?? null,
      // Round 7.12: legacy content_type left null on inserts. The
      // active field is content_types below.
      null,
      // pg driver natively converts JS string[] to TEXT[]. Validate
      // and canonicalise via normaliseContentTypes first.
      normaliseContentTypes(parsed.data.contentTypes),
      parsed.data.briefUrl ?? null,
      parsed.data.assetLinks ? JSON.stringify(parsed.data.assetLinks) : null,
      parsed.data.approvalStatus ?? 'none',
      parsed.data.assignedTo ?? null,
      parsed.data.customFields ? JSON.stringify(parsed.data.customFields) : null,
      normaliseCampaign(parsed.data.campaign),
      parsed.data.facebookLiveUrl ?? null,
      parsed.data.instagramLiveUrl ?? null,
      postedAt,
    ]
  )

  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [id])
  return NextResponse.json({ ok: true, job: rowToJob(result.rows[0]) })
}
