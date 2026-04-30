import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema, seedDefaultKanbanColumns } from '@/lib/postgres'
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

/** GET /api/workspaces — list workspaces visible to the current user.
 *
 * Round 7.11: briefers see ONLY their own workspace (the venue they
 * belong to). Staff (admin/member) continue to see all workspaces.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()

  // Briefer scoping. If a briefer's workspaceId is somehow null
  // (misconfigured account), return empty rather than leaking everything.
  if (session.role === 'briefer') {
    if (!session.workspaceId) return NextResponse.json([])
    const result = await pool.query(
      `SELECT id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url, created_at, updated_at
       FROM workspaces
       WHERE id = $1`,
      [session.workspaceId]
    )
    return NextResponse.json(result.rows.map(rowToWorkspace))
  }

  const result = await pool.query(
    `SELECT id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url, created_at, updated_at
     FROM workspaces
     ORDER BY sort_order ASC, created_at ASC`
  )
  return NextResponse.json(result.rows.map(rowToWorkspace))
}

/** POST /api/workspaces — staff can create workspaces. Briefers cannot.
 * The creator is recorded as the owner_id; preserved for later RBAC. */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: briefers cannot create workspaces.
  if (session.role === 'briefer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  // Round 7.13: seed the five default kanban columns immediately
  // for the new workspace, so the user doesn't see "No kanban
  // columns configured" when they first navigate to it. Previously
  // this only happened via the bulk auto-seed in ensureSchema(),
  // which fires once per app boot and missed any workspaces created
  // since the last boot.
  await seedDefaultKanbanColumns(id)

  const result = await pool.query(
    `SELECT id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url, created_at, updated_at
     FROM workspaces WHERE id = $1`,
    [id]
  )
  return NextResponse.json({ ok: true, workspace: rowToWorkspace(result.rows[0]) })
}
