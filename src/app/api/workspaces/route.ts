import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToWorkspace } from '@/lib/db-mappers'

/**
 * Round 7.1: POST now accepts the same workspace fields the edit
 * dialog already supports (color + facebookPageUrl + instagramPageUrl)
 * so the new creation modal can fully configure a workspace in one
 * step. Backward-compatible: callers that just send `{name}` still
 * work — the optional fields default to existing schema defaults.
 */
const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  color: z.string().trim().default('#8b5cf6'),
  facebookPageUrl: z.string().trim().nullable().optional(),
  instagramPageUrl: z.string().trim().nullable().optional(),
})

/** GET /api/workspaces — list all workspaces visible to the current user.
 *
 * For now (5-person team, 6 brands) the model is "everyone signed in sees
 * every workspace." When per-user access control is needed, this is the
 * place to filter the results. The `owner_id` is preserved for that future
 * use. */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const result = await pool.query(
    `SELECT id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url, created_at, updated_at
     FROM workspaces
     ORDER BY sort_order ASC, created_at ASC`
  )
  return NextResponse.json(result.rows.map(rowToWorkspace))
}

/** POST /api/workspaces — any signed-in user can create a workspace.
 * The creator is recorded as the owner_id; this currently has no
 * per-workspace permission impact but is preserved for later. */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateWorkspaceInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Workspace name is required' }, { status: 400 })
  }

  await ensureSchema()
  const id = randomUUID()

  // Place new workspaces at the end of the sort order so existing pinned
  // workspaces don't move when a new one is added.
  const sortOrderRes = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM workspaces`
  )
  const sortOrder = Number(sortOrderRes.rows[0]?.next ?? 0)

  // Empty strings — common from form inputs — collapse to null so the
  // column is properly empty and not "" (which would later read as
  // "page URL configured but blank" in the metric fetcher).
  const fbUrl = (parsed.data.facebookPageUrl ?? '').trim() || null
  const igUrl = (parsed.data.instagramPageUrl ?? '').trim() || null

  await pool.query(
    `INSERT INTO workspaces (
        id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, session.userId, parsed.data.name, parsed.data.color, sortOrder, fbUrl, igUrl]
  )

  const result = await pool.query(
    `SELECT id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url, created_at, updated_at
     FROM workspaces WHERE id = $1`,
    [id]
  )
  return NextResponse.json({ ok: true, workspace: rowToWorkspace(result.rows[0]) })
}
