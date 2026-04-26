import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob, rowToMetricSnapshot } from '@/lib/db-mappers'
import { getSetting } from '@/lib/settings-server'
import { fetchMetricsForUrl } from '@/lib/apify'

const COLUMN_LIST = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  created_at, updated_at
`

const SNAPSHOT_COLUMNS = `
  id, job_id, workspace_id, platform, captured_at,
  views, likes, comments, shares, saves, reach, impressions,
  engagement_rate
`

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: jobId } = await params

  await ensureSchema()

  let body: { url?: string } = {}
  try {
    body = (await req.json()) as { url?: string }
  } catch {
    // empty body is fine
  }

  const jobRes = await pool.query(
    `SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rows.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  const job = rowToJob(jobRes.rows[0])

  const url =
    body.url?.trim() ||
    job.facebookLiveUrl ||
    job.instagramLiveUrl ||
    job.liveUrl
  if (!url) {
    return NextResponse.json(
      {
        error:
          'No live URL on this job. Add a Facebook or Instagram post URL in the detail panel before fetching.',
      },
      { status: 400 },
    )
  }

  const apifyToken = (await getSetting('apify.token')) || ''
  if (!apifyToken) {
    return NextResponse.json(
      {
        error: 'No Apify token configured. An admin can set it under /settings.',
      },
      { status: 400 },
    )
  }

  const outcome = await fetchMetricsForUrl(url, apifyToken)
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error.message, kind: outcome.error.kind },
      { status: outcome.error.kind === 'no-token' ? 400 : 502 },
    )
  }

  const snapshotId = randomUUID()
  const capturedAt = new Date()
  const m = outcome.result.metrics

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const wsRes = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM jobs WHERE id = $1 FOR UPDATE',
      [jobId],
    )
    if (wsRes.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const workspaceId = wsRes.rows[0].workspace_id

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
        outcome.result.platform,
        capturedAt,
        m.views,
        m.likes,
        m.comments,
        m.shares,
        m.saves,
        m.reach,
        m.impressions,
        m.engagementRate,
        JSON.stringify(outcome.result.raw),
      ],
    )

    const liveCache = {
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      reach: m.reach,
      impressions: m.impressions,
      engagementRate: m.engagementRate,
    }

    const sets: string[] = [
      `live_metrics_json = $1`,
      `last_metrics_fetch_at = $2`,
      `updated_at = NOW()`,
    ]
    const values: unknown[] = [JSON.stringify(liveCache), capturedAt]
    if (outcome.result.facebookPostId) {
      sets.push(`facebook_post_id = $${values.length + 1}`)
      values.push(outcome.result.facebookPostId)
    }
    values.push(jobId)
    await client.query(
      `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${values.length}`,
      values,
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const snap = await pool.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM metric_snapshots WHERE id = $1`,
    [snapshotId],
  )
  const updatedJob = await pool.query(
    `SELECT ${COLUMN_LIST} FROM jobs WHERE id = $1`,
    [jobId],
  )

  return NextResponse.json({
    ok: true,
    snapshot: rowToMetricSnapshot(snap.rows[0]),
    job: rowToJob(updatedJob.rows[0]),
  })
}
