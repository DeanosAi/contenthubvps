import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob, rowToMetricSnapshot } from '@/lib/db-mappers'
import { getSetting } from '@/lib/settings-server'
import { fetchMetricsForUrl } from '@/lib/apify'

/**
 * POST /api/jobs/:id/fetch-metrics
 *
 * Triggers a live metric fetch for one job:
 *
 *   1. Resolves the URL to fetch from. Preference order:
 *      - request body's `url` field (manual override)
 *      - the job's facebookLiveUrl
 *      - the job's instagramLiveUrl
 *      - the job's generic liveUrl
 *
 *   2. Calls Apify via src/lib/apify.ts.
 *
 *   3. On success, writes a row to metric_snapshots AND updates the job's
 *      live cache (live_metrics_json, last_metrics_fetch_at). On Facebook
 *      we also cache the post id so future fetches can be faster.
 *
 *   4. Returns the snapshot + updated job, mirroring the shape of
 *      /api/jobs/:id/snapshot for client convenience.
 *
 * Why this lives separately from /api/jobs/:id/snapshot:
 *   - /snapshot accepts pre-computed metrics and writes them. Used by
 *     scripts, manual entry, future schedulers.
 *   - /fetch-metrics actually GOES OUT and calls Apify. Network-bound,
 *     can fail in ways /snapshot can't, takes ~10-30 seconds. Different
 *     responsibility, different failure surface.
 *
 * Note: this endpoint is intentionally synchronous — the request blocks
 * for the full duration of the Apify call. For batch-refresh of many
 * jobs, the workspace-level endpoint loops through serially and
 * streams progress. A real background queue is a future-round concern.
 */

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

  // ---- Resolve URL ----
  // Manual override from request body, falling back to whichever live
  // URL the job has stored. Order matters: facebook before instagram
  // before generic, since the job model has separate fields for each.
  let body: { url?: string } = {}
  try {
    body = (await req.json()) as { url?: string }
  } catch {
    // Empty body is fine — fall through to the job's stored URL.
  }

  const jobRes = await pool.query(
    `SELECT j.${COLUMN_LIST.split(',').map((c) => c.trim()).join(', j.')},
            w.facebook_page_url AS w_facebook_page_url
       FROM jobs j
       LEFT JOIN workspaces w ON w.id = j.workspace_id
       WHERE j.id = $1`,
    [jobId],
  )
  if (jobRes.rows.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  const job = rowToJob(jobRes.rows[0])
  // The workspace's Facebook page URL drives the via-page fetch path.
  // Round 1 added the column; Round 6.4 wires it to the fetcher and to
  // the workspace edit dialog. Empty string treated as null.
  const rawFbPageUrl = jobRes.rows[0].w_facebook_page_url as string | null
  const facebookPageUrl =
    rawFbPageUrl && rawFbPageUrl.trim() ? rawFbPageUrl.trim() : null

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

  // ---- Apify token ----
  const apifyToken = (await getSetting('apify.token')) || ''
  if (!apifyToken) {
    return NextResponse.json(
      {
        error:
          'No Apify token configured. An admin can set it under /settings.',
      },
      { status: 400 },
    )
  }

  // ---- Run the fetch ----
  // facebookPageUrl is loaded from the workspace; it's null for
  // Instagram URLs and for Facebook workspaces that haven't set a page
  // URL yet. The Apify lib detects the platform and only uses
  // facebookPageUrl when relevant.
  const outcome = await fetchMetricsForUrl(url, apifyToken, facebookPageUrl)
  if (!outcome.ok) {
    // Bubble the structured error to the client; the UI will format
    // appropriately.
    return NextResponse.json(
      { error: outcome.error.message, kind: outcome.error.kind },
      { status: outcome.error.kind === 'no-token' ? 400 : 502 },
    )
  }

  // ---- Persist: snapshot + live cache update + facebook post id cache ----
  const snapshotId = randomUUID()
  const capturedAt = new Date()
  const m = outcome.result.metrics

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // FOR UPDATE so we can't race with a concurrent job delete.
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

    // Live cache shape mirrors the LiveMetrics interface exactly so
    // mapLiveMetrics in db-mappers.ts can read it back without translation.
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

    // Build the UPDATE dynamically because facebook_post_id only exists
    // for FB fetches AND only when Apify surfaced it; we don't want to
    // clobber an existing cached value with NULL.
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

  // ---- Return the freshly-stored snapshot + updated job ----
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
