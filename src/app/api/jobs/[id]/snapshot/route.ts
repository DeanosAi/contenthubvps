import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToMetricSnapshot, rowToJob } from '@/lib/db-mappers'

const PostSnapshotInput = z.object({
  capturedAt: z.string().datetime().optional(),
  platform: z.string().nullable().optional(),
  metrics: z.object({
    views: z.number().int().nullable().optional(),
    likes: z.number().int().nullable().optional(),
    comments: z.number().int().nullable().optional(),
    shares: z.number().int().nullable().optional(),
    saves: z.number().int().nullable().optional(),
    reach: z.number().int().nullable().optional(),
    impressions: z.number().int().nullable().optional(),
    engagementRate: z.number().nullable().optional(),
  }),
  rawJson: z.unknown().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: snapshots are a staff metrics feature.
  if (session.role === 'briefer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: jobId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PostSnapshotInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid snapshot payload' },
      { status: 400 }
    )
  }

  await ensureSchema()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const jobRes = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM jobs WHERE id = $1 FOR UPDATE',
      [jobId]
    )
    if (jobRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const workspaceId = jobRes.rows[0].workspace_id

    const snapshotId = randomUUID()
    const capturedAt = parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : new Date()
    const m = parsed.data.metrics

    await client.query(
      `INSERT INTO metric_snapshots (
        id, job_id, workspace_id, platform, captured_at,
        views, likes, comments, shares, saves, reach, impressions,
        engagement_rate, raw_json
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12,
        $13, $14
      )`,
      [
        snapshotId,
        jobId,
        workspaceId,
        parsed.data.platform ?? null,
        capturedAt,
        m.views ?? null,
        m.likes ?? null,
        m.comments ?? null,
        m.shares ?? null,
        m.saves ?? null,
        m.reach ?? null,
        m.impressions ?? null,
        m.engagementRate ?? null,
        parsed.data.rawJson === undefined ? null : JSON.stringify(parsed.data.rawJson),
      ]
    )

    const liveCache = {
      views: m.views ?? null,
      likes: m.likes ?? null,
      comments: m.comments ?? null,
      shares: m.shares ?? null,
      saves: m.saves ?? null,
      reach: m.reach ?? null,
      impressions: m.impressions ?? null,
      engagementRate: m.engagementRate ?? null,
    }
    await client.query(
      `UPDATE jobs
       SET live_metrics_json = $1,
           last_metrics_fetch_at = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(liveCache), capturedAt, jobId]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const snap = await pool.query(
    `SELECT id, job_id, workspace_id, platform, captured_at,
            views, likes, comments, shares, saves, reach, impressions,
            engagement_rate
     FROM metric_snapshots
     WHERE job_id = $1
     ORDER BY captured_at DESC
     LIMIT 1`,
    [jobId]
  )
  const job = await pool.query(
    `SELECT id, workspace_id, title, description, stage, priority, due_date,
            hashtags, platform, live_url, notes,
            content_type, brief_url, asset_links_json, approval_status, assigned_to,
            custom_fields_json,
            facebook_live_url, facebook_post_id, instagram_live_url,
            posted_at, live_metrics_json, last_metrics_fetch_at,
            created_at, updated_at
     FROM jobs WHERE id = $1`,
    [jobId]
  )

  return NextResponse.json({
    ok: true,
    snapshot: rowToMetricSnapshot(snap.rows[0]),
    job: rowToJob(job.rows[0]),
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: snapshots are a staff metrics feature.
  if (session.role === 'briefer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: jobId } = await params
  await ensureSchema()

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '100') || 100, 1000)

  const result = await pool.query(
    `SELECT id, job_id, workspace_id, platform, captured_at,
            views, likes, comments, shares, saves, reach, impressions,
            engagement_rate
     FROM metric_snapshots
     WHERE job_id = $1
     ORDER BY captured_at DESC
     LIMIT $2`,
    [jobId, limit]
  )

  return NextResponse.json(result.rows.map(rowToMetricSnapshot))
}
