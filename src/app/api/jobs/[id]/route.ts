import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob } from '@/lib/db-mappers'
import { ALLOWED_JOB_TYPES } from '@/lib/types'
import {
  assertCanViewJob,
  assertCanEditJobField,
  assertCanDeleteJob,
  logJobEdits,
  valueForAudit,
  type FieldChange,
} from '@/lib/permissions'

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
    // Round 7.12: contentType deprecated, contentTypes is the
    // active multi-select field.
    contentType: z.string().nullable().optional(),
    contentTypes: z.array(z.string()).optional(),
    briefUrl: z.string().nullable().optional(),
    assetLinks: z
      .array(z.object({ id: z.string(), label: z.string(), url: z.string() }))
      .nullable()
      .optional(),
    customFields: z.array(CustomFieldSchema).nullable().optional(),
    campaign: z.string().nullable().optional(),
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
  content_type, content_types, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json, campaign,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  briefer_display_name,
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
  contentTypes: 'content_types',
  briefUrl: 'brief_url',
  assetLinks: 'asset_links_json',
  customFields: 'custom_fields_json',
  campaign: 'campaign',
  approvalStatus: 'approval_status',
  assignedTo: 'assigned_to',
  facebookLiveUrl: 'facebook_live_url',
  facebookPostId: 'facebook_post_id',
  instagramLiveUrl: 'instagram_live_url',
  workspaceId: 'workspace_id',
}

const JSONB_KEYS = new Set(['assetLinks', 'customFields'])

function normaliseCampaign(v: string | null | undefined): string | null {
  if (v == null) return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Round 7.12: validate, dedupe and canonicalise an incoming
 * contentTypes array. Drops values not in ALLOWED_JOB_TYPES so
 * stored data stays clean. Sorted by ALLOWED_JOB_TYPES order so
 * audit-log diffs are stable (not "Video,Print" vs "Print,Video").
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
  const order: Map<string, number> = new Map(
    ALLOWED_JOB_TYPES.map((v, i) => [v as string, i])
  )
  out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return out
}

/**
 * Round 7.11: PATCH with permission enforcement + edit logging.
 *
 * Flow:
 *   1. Look up the job (in a transaction). 404 if not found.
 *   2. For each field in the payload, check assertCanEditJobField()
 *      against the job's workspace_id. If any field is forbidden,
 *      return 403 — we don't do partial updates.
 *   3. Run the UPDATE.
 *   4. For each field actually changed (where new value != old value),
 *      log to job_edits.
 *   5. Commit.
 */
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

    const beforeRes = await client.query(
      `SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1 FOR UPDATE`,
      [id]
    )
    if (beforeRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const beforeRow = beforeRes.rows[0] as Record<string, unknown>
    const beforeWorkspaceId = String(beforeRow.workspace_id)

    const viewCheck = assertCanViewJob(session, beforeWorkspaceId)
    if (!viewCheck.ok) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: viewCheck.error }, { status: viewCheck.status })
    }

    for (const k of Object.keys(parsed.data)) {
      const col = COLUMN_MAP[k]
      if (!col) continue
      const editCheck = assertCanEditJobField(session, beforeWorkspaceId, col)
      if (!editCheck.ok) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: editCheck.error }, { status: editCheck.status })
      }
    }

    const oldStage = String(beforeRow.stage)
    const oldPostedAt = beforeRow.posted_at as Date | null

    const sets: string[] = []
    const values: unknown[] = []
    let n = 1

    const audit: FieldChange[] = []

    for (const [k, v] of Object.entries(parsed.data)) {
      const col = COLUMN_MAP[k]
      if (!col) continue

      let newDbValue: unknown
      if (k === 'dueDate') {
        newDbValue = v ? new Date(v as string) : null
      } else if (JSONB_KEYS.has(k)) {
        newDbValue = v == null ? null : JSON.stringify(v)
      } else if (k === 'campaign') {
        newDbValue = normaliseCampaign(v as string | null | undefined)
      } else if (k === 'contentTypes') {
        // Round 7.12: canonicalise + validate. The pg driver will
        // serialise the resulting JS string[] as PG TEXT[].
        newDbValue = normaliseContentTypes(v as readonly string[] | undefined)
      } else {
        newDbValue = v
      }

      sets.push(`${col} = $${n++}`)
      values.push(newDbValue)

      if (!JSONB_KEYS.has(k)) {
        // For audit log comparison, render arrays as a stable
        // comma-joined string so old/new values are comparable.
        // Other fields just stringify directly.
        let oldStr: string | null
        let newStr: string | null
        if (k === 'contentTypes') {
          const oldArr = Array.isArray(beforeRow[col]) ? (beforeRow[col] as unknown[]) : []
          oldStr = oldArr.length === 0 ? null : oldArr.join(', ')
          const newArr = Array.isArray(newDbValue) ? (newDbValue as string[]) : []
          newStr = newArr.length === 0 ? null : newArr.join(', ')
        } else {
          oldStr = valueForAudit(beforeRow[col])
          newStr = valueForAudit(
            k === 'dueDate' ? (newDbValue as Date | null)?.toISOString() ?? null : newDbValue
          )
        }
        if (oldStr !== newStr) {
          audit.push({ fieldName: col, oldValue: oldStr, newValue: newStr })
        }
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

    if (audit.length > 0) {
      await logJobEdits(client, id, audit, session)
    }

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

  const lookup = await pool.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM jobs WHERE id = $1',
    [id]
  )
  if (lookup.rows.length === 0) {
    return NextResponse.json({ ok: true })
  }

  const accessCheck = assertCanDeleteJob(session, lookup.rows[0].workspace_id)
  if (!accessCheck.ok) {
    return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
  }

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

  const job = rowToJob(result.rows[0])
  const viewCheck = assertCanViewJob(session, job.workspaceId)
  if (!viewCheck.ok) {
    return NextResponse.json({ error: viewCheck.error }, { status: viewCheck.status })
  }
  return NextResponse.json(job)
}
