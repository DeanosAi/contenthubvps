import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob, rowToMetricSnapshot, rowToWorkspace } from '@/lib/db-mappers'

/**
 * GET /api/reports?workspaceId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the full data bundle the reports page needs for one render:
 *   - workspace: the selected workspace (or null if scope is "all")
 *   - jobs:      jobs with stage='posted' AND posted_at within range
 *   - snapshots: metric_snapshots captured within range, scoped to the
 *                workspace if one was specified
 *
 * Doing this in one round-trip keeps the page snappy and avoids the
 * race where jobs and snapshots are loaded independently and end up
 * spanning slightly different windows.
 *
 * Note: workspaceId is optional — when omitted, reports span ALL
 * workspaces (the "agency-wide overview" mode). The clients filter
 * defaults to a single workspace because mixing brand metrics is
 * usually not what people want, but the underlying API supports it.
 */

const QuerySchema = z.object({
  workspaceId: z.string().min(1).nullable().optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
})

const JOB_COLUMNS = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, content_types, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json, campaign,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  briefer_display_name,
  created_at, updated_at
`

const SNAPSHOT_COLUMNS = `
  id, job_id, workspace_id, platform, captured_at,
  views, likes, comments, shares, saves, reach, impressions,
  engagement_rate
`

const WORKSPACE_COLUMNS = `
  id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url,
  created_at, updated_at
`

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: reports are a staff feature.
  if (session.role === 'briefer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = QuerySchema.safeParse({
    workspaceId: req.nextUrl.searchParams.get('workspaceId') ?? undefined,
    from: req.nextUrl.searchParams.get('from') ?? undefined,
    to: req.nextUrl.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  await ensureSchema()

  const { workspaceId, from, to } = parsed.data

  // Convert date strings to Date objects. The "to" date is upper-bound
  // EXCLUSIVE here at the SQL layer (we add a day at query time) so the
  // user-friendly "to=2026-04-30" includes everything posted on April 30.
  const fromDate = from ? new Date(from + 'T00:00:00') : null
  const toDateExclusive = to ? (() => {
    const d = new Date(to + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return d
  })() : null

  // ---- Workspace context (for the PDF header / branding) ----
  let workspace = null
  if (workspaceId) {
    const wsRes = await pool.query(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = $1`,
      [workspaceId]
    )
    if (wsRes.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    workspace = rowToWorkspace(wsRes.rows[0])
  }

  // ---- Jobs: only posted, only within range ----
  const jobConditions: string[] = [`stage = 'posted'`, `posted_at IS NOT NULL`]
  const jobValues: unknown[] = []
  if (workspaceId) {
    jobConditions.push(`workspace_id = $${jobValues.length + 1}`)
    jobValues.push(workspaceId)
  }
  if (fromDate) {
    jobConditions.push(`posted_at >= $${jobValues.length + 1}`)
    jobValues.push(fromDate)
  }
  if (toDateExclusive) {
    jobConditions.push(`posted_at < $${jobValues.length + 1}`)
    jobValues.push(toDateExclusive)
  }
  const jobsRes = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM jobs WHERE ${jobConditions.join(' AND ')} ORDER BY posted_at DESC`,
    jobValues
  )
  const jobs = jobsRes.rows.map(rowToJob)

  // ---- Round 7.12: All jobs in range (not just posted) ----
  // For the "Jobs by Type" breakdown we want to count ALL work
  // done in the range, including in-progress jobs and jobs that
  // never get a "posted" status (e.g. design jobs, reports, website
  // updates). Date anchor is created_at — when was the brief
  // submitted/job created.
  //
  // We deliberately keep this as a separate query rather than
  // expanding the main `jobs` query: every other report metric
  // (headline, top posts, time series, etc.) is keyed on
  // posted_at and shouldn't change.
  const allJobsConditions: string[] = []
  const allJobsValues: unknown[] = []
  if (workspaceId) {
    allJobsConditions.push(`workspace_id = $${allJobsValues.length + 1}`)
    allJobsValues.push(workspaceId)
  }
  if (fromDate) {
    allJobsConditions.push(`created_at >= $${allJobsValues.length + 1}`)
    allJobsValues.push(fromDate)
  }
  if (toDateExclusive) {
    allJobsConditions.push(`created_at < $${allJobsValues.length + 1}`)
    allJobsValues.push(toDateExclusive)
  }
  const allJobsWhere = allJobsConditions.length
    ? `WHERE ${allJobsConditions.join(' AND ')}`
    : ''
  const allJobsRes = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM jobs ${allJobsWhere} ORDER BY created_at DESC`,
    allJobsValues
  )
  const allJobsInRange = allJobsRes.rows.map(rowToJob)

  // ---- Snapshots: within range, scoped if a workspace was given ----
  const snapConditions: string[] = []
  const snapValues: unknown[] = []
  if (workspaceId) {
    snapConditions.push(`workspace_id = $${snapValues.length + 1}`)
    snapValues.push(workspaceId)
  }
  if (fromDate) {
    snapConditions.push(`captured_at >= $${snapValues.length + 1}`)
    snapValues.push(fromDate)
  }
  if (toDateExclusive) {
    snapConditions.push(`captured_at < $${snapValues.length + 1}`)
    snapValues.push(toDateExclusive)
  }
  const snapWhere = snapConditions.length ? `WHERE ${snapConditions.join(' AND ')}` : ''
  const snapsRes = await pool.query(
    `SELECT ${SNAPSHOT_COLUMNS} FROM metric_snapshots ${snapWhere} ORDER BY captured_at ASC`,
    snapValues
  )
  const snapshots = snapsRes.rows.map(rowToMetricSnapshot)

  return NextResponse.json({
    workspace,
    jobs,
    allJobsInRange,
    snapshots,
    range: {
      from: from ?? null,
      to: to ?? null,
    },
  })
}
