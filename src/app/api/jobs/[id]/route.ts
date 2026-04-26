import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'

const STAGES = ['brief', 'production', 'ready', 'posted', 'archive'] as const
const APPROVAL = ['none', 'awaiting', 'approved', 'changes_requested'] as const
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'url'] as const

const CustomFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  value: z.string(),
})

const UpdateJobInput = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().nullable().optional(),
    stage: z.enum(STAGES).optional(),
    priority: z.number().int().min(0).max(5).optional(),
    dueDate: z.string().nullable().optional(),
    hashtags: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    liveUrl: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    contentType: z.string().nullable().optional(),
    briefUrl: z.string().nullable().optional(),
    assetLinks: z.array(z.object({ id: z.string(), label: z.string(), url: z.string() })).nullable().optional(),
    customFields: z.array(CustomFieldSchema).nullable().optional(),
    approvalStatus: z.enum(APPROVAL).optional(),
    assignedTo: z.string().nullable().optional(),
    facebookLiveUrl: z.string().nullable().optional(),
    facebookPostId: z.string().nullable().optional(),
    instagramLiveUrl: z.string().nullable().optional(),
    workspaceId: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

const COLUMN_LIST = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  created_at, updated_at
`

const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  description: 'description',
  stage: 'stage',
  priority: 'priority',
  dueDate: 'due_date',
  hashtags: 'hashtags',
  platform: 'platform',
  liveUrl: 'live_url',
  notes: 'notes',
  contentType: 'content_type',
  briefUrl: 'brief_url',
  assetLinks: 'asset_links_json',
  customFields: 'custom_fields_json',
  approvalStatus: 'approval_status',
  assignedTo: 'assigned_to',
  facebookLiveUrl: 'facebook_live_url',
  facebookPostId: 'facebook_post_id',
  instagramLiveUrl: 'instagram_live_url',
  workspaceId: 'workspace_id',
}

const JSONB_KEYS = new Set(['assetLinks', 'customFields'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UpdateJobInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid job payload' },
      { status: 400 }
    )
  }

  await ensureSchema()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const before = await client.query<{ stage: string; posted_at: Date | null }>(
      'SELECT stage, posted_at FROM jobs WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (before.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const oldStage = before.rows[0].stage
    const oldPostedAt = before.rows[0].posted_at

    const sets: string[] = []
    const values: unknown[] = []
    let n = 1
    for (const [k, v] of Object.entries(parsed.data)) {
      const col = COLUMN_MAP[k]
      if (!col) continue
      sets.push(`${col} = $${n++}`)
      if (k === 'dueDate') {
        values.push(v ? new Date(v as string) : null)
      } else if (JSONB_KEYS.has(k)) {
        values.push(v == null ? null : JSON.stringify(v))
      } else {
        values.push(v)
      }
    }

    if (parsed.data.stage !== undefined && parsed.data.stage !== oldStage) {
      if (parsed.data.stage === 'posted' && oldPostedAt == null) {
        sets.push(`posted_at = NOW()`)
      } else if (parsed.data.stage !== 'posted') {
        sets.push(`posted_at = NULL`)
      }
    }

    sets.push(`updated_at = NOW()`)
    values.push(id)

    await client.query(`UPDATE jobs SET ${sets.join(', ')} WHERE id = $${n}`, values)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [id])
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, job: rowToJob(result.rows[0]) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await ensureSchema()
  await pool.query('DELETE FROM jobs WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await ensureSchema()
  const result = await pool.query(`SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`, [id])
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rowToJob(result.rows[0]))
}
