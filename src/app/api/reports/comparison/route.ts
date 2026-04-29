import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJob, rowToWorkspace } from '@/lib/db-mappers'

/**
 * POST /api/reports/comparison
 *
 * Returns the data bundle for a comparison report. Two modes:
 *
 *   1. Manual selection — body: { jobIds: string[], workspaceId?: string }
 *      Returns jobs whose id is in the list. Filtered to posted+archive
 *      stages so the comparison only includes "real" finished posts.
 *
 *   2. Campaign mode — body: { workspaceId, campaign, fromIso?, toIso?, fullCampaign? }
 *      Returns jobs in the workspace with the matching campaign tag.
 *      If fullCampaign === true, ignores fromIso/toIso. Otherwise the
 *      date range (if any) filters by posted_at, with no date range
 *      meaning "all time within this workspace + campaign".
 *
 * Why POST not GET: jobIds for the manual mode can be long (up to 50
 * UUIDs) and pushing that through a GET querystring is fragile across
 * proxies. POST keeps the body shape consistent across both modes.
 *
 * Response shape: { jobs: Job[], workspace: Workspace | null,
 *                   mode: 'manual' | 'campaign', appliedRange: {...} }
 *
 * The `appliedRange` echoes back what was actually applied — useful for
 * the UI to confirm "Full campaign was applied" in its display.
 */

const ManualInput = z.object({
  mode: z.literal('manual'),
  jobIds: z.array(z.string().min(1)).min(1).max(50),
  /** Optional — when present, jobs not in this workspace are filtered out
   * server-side as a defence against the client mis-selecting cross-workspace
   * jobs. The UI should only ever pass ids from one workspace. */
  workspaceId: z.string().optional(),
})

const CampaignInput = z.object({
  mode: z.literal('campaign'),
  workspaceId: z.string().min(1),
  campaign: z.string().min(1),
  fromIso: z.string().optional(),
  toIso: z.string().optional(),
  /** When true, fromIso/toIso are ignored. */
  fullCampaign: z.boolean().optional(),
})

const ComparisonInput = z.discriminatedUnion('mode', [ManualInput, CampaignInput])

const JOB_COLUMNS = `
  id, workspace_id, title, description, stage, priority, due_date,
  hashtags, platform, live_url, notes,
  content_type, brief_url, asset_links_json, approval_status, assigned_to,
  custom_fields_json, campaign,
  facebook_live_url, facebook_post_id, instagram_live_url,
  posted_at, live_metrics_json, last_metrics_fetch_at,
  created_at, updated_at
`

const WORKSPACE_COLUMNS = `
  id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url,
  created_at, updated_at
`

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: comparison reports are a staff feature.
  if (session.role === 'briefer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ComparisonInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid comparison payload' },
      { status: 400 },
    )
  }

  await ensureSchema()

  // Resolve workspace context for both modes — used by the PDF cover
  // and the UI header. Manual mode may pass workspaceId; campaign mode
  // requires it.
  const workspaceId =
    parsed.data.mode === 'campaign'
      ? parsed.data.workspaceId
      : parsed.data.workspaceId
  let workspace = null
  if (workspaceId) {
    const wsRes = await pool.query(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = $1`,
      [workspaceId],
    )
    if (wsRes.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    workspace = rowToWorkspace(wsRes.rows[0])
  }

  let appliedRange: { fromIso: string | null; toIso: string | null } = {
    fromIso: null,
    toIso: null,
  }

  if (parsed.data.mode === 'manual') {
    // Manual mode: SELECT … WHERE id = ANY($1) AND stage IN ('posted','archive')
    // Optionally filter by workspaceId as a defensive check.
    const conditions: string[] = [
      `id = ANY($1)`,
      `stage IN ('posted', 'archive')`,
    ]
    const values: unknown[] = [parsed.data.jobIds]
    if (parsed.data.workspaceId) {
      conditions.push(`workspace_id = $${values.length + 1}`)
      values.push(parsed.data.workspaceId)
    }
    const jobsRes = await pool.query(
      `SELECT ${JOB_COLUMNS} FROM jobs WHERE ${conditions.join(' AND ')} ORDER BY posted_at DESC NULLS LAST`,
      values,
    )
    return NextResponse.json({
      mode: 'manual',
      jobs: jobsRes.rows.map(rowToJob),
      workspace,
      appliedRange,
    })
  }

  // Campaign mode.
  const conditions: string[] = [
    `workspace_id = $1`,
    `campaign = $2`,
    `stage IN ('posted', 'archive')`,
  ]
  const values: unknown[] = [parsed.data.workspaceId, parsed.data.campaign]
  if (!parsed.data.fullCampaign) {
    if (parsed.data.fromIso) {
      conditions.push(`posted_at >= $${values.length + 1}`)
      values.push(new Date(parsed.data.fromIso + 'T00:00:00'))
      appliedRange.fromIso = parsed.data.fromIso
    }
    if (parsed.data.toIso) {
      // Exclusive upper bound: include everything posted on the picked end day.
      const d = new Date(parsed.data.toIso + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      conditions.push(`posted_at < $${values.length + 1}`)
      values.push(d)
      appliedRange.toIso = parsed.data.toIso
    }
  }
  const jobsRes = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM jobs WHERE ${conditions.join(' AND ')} ORDER BY posted_at DESC NULLS LAST`,
    values,
  )
  return NextResponse.json({
    mode: 'campaign',
    jobs: jobsRes.rows.map(rowToJob),
    workspace,
    appliedRange,
    fullCampaign: parsed.data.fullCampaign === true,
    campaign: parsed.data.campaign,
  })
}
