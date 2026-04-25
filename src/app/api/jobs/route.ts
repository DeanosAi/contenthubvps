import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'

const STAGES = ['brief', 'production', 'ready', 'posted', 'archive'] as const
const APPROVAL = ['none', 'awaiting', 'approved', 'changes_requested'] as const

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
  contentType: z.string().nullable().optional(),
  briefUrl: z.string().nullable().optional(),
  assetLinks: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        url: z.string(),
      })
    )
    .optional(),
  approvalStatus: z.enum(APPROVAL).optional(),
  assignedTo: z.string().nullable().optional(),
  facebookLiveUrl: z.string().nullable().optional(),
  instagramLiveUrl: z.string().nullable().optional(),
})

const COLUMN_LIST = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, brief_url, asset_links_json, approval_status, assigned_to,
  facebook_live_url, facebook_post_id, instagram_live_url,
  created_at, updated_at
`

/** GET /api/jobs?workspaceId=... — list jobs, optionally filtered to a
 * single workspace. Workspace filter is the common UI case. */
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  const result = workspaceId
    ? await pool.query(
        `SELECT ${COLUMN_LIST} FROM jobs WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [workspaceId]
      )
    : await pool.query(`SELECT ${COLUMN_LIST} FROM jobs ORDER BY created_at DESC`)
  return NextResponse.json(result.rows.map(rowToJob))
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  await pool.query(
    `INSERT INTO jobs (
      id, workspace_id, title, description, stage, priority, due_date,
      hashtags, platform, live_url, notes,
      content_type, brief_url, asset_links_json, approval_status, assigned_to,
      facebook_live_url, instagram_live_url
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18
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
      parsed.data.contentType ?? null,
      parsed.data.briefUrl ?? null,
      parsed.data.assetLinks ? JSON.stringify(parsed.data.assetLinks) : null,
      parsed.data.approvalStatus ?? 'none',
      parsed.data.assignedTo ?? null,
      parsed.data.facebookLiveUrl ?? null,
      parsed.data.instagramLiveUrl ?? null,
    ]
  )

  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [id])
  return NextResponse.json({ ok: true, job: rowToJob(result.rows[0]) })
}
