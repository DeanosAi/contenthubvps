import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema, BUILTIN_COLUMN_DEFAULTS } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToKanbanColumn } from '@/lib/db-mappers'
import { assertCanAccessWorkspace } from '@/lib/permissions'

/**
 * Round 7.2: per-workspace kanban column configuration endpoints.
 *
 * GET  /api/workspaces/:id/columns          — list the columns for a workspace
 * POST /api/workspaces/:id/columns          — create a custom column
 *
 * Per-column edit (rename, recolor, reorder, delete) lives in the
 * sibling [columnId]/route.ts file.
 *
 * Sort order uses sparse integers (0, 1, 2, …). Reorder uses a bulk
 * endpoint at POST /api/workspaces/:id/columns/reorder which rewrites
 * sort_order for the whole list at once. That endpoint is implemented
 * inline here — it's small enough not to warrant its own folder.
 */

const CreateColumnInput = z.object({
  label: z.string().trim().min(1, 'Label is required').max(60),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
})

const ReorderInput = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
})

/**
 * GET — return all columns for the workspace, sorted by sort_order.
 *
 * Defensive: if the workspace somehow has zero columns (shouldn't
 * happen, ensureSchema seeds them), we return an empty list and let
 * the UI surface the issue. Re-creating defaults silently here would
 * mask data-integrity bugs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: workspaceId } = await params

  // Verify the workspace exists; without this, an attacker could probe
  // for valid workspace ids by counting how many columns are returned.
  const wsRes = await pool.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE id = $1`,
    [workspaceId],
  )
  if (wsRes.rowCount === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  // Round 7.11: briefers can only read columns of their own workspace.
  const accessCheck = assertCanAccessWorkspace(session, workspaceId)
  if (!accessCheck.ok) {
    return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
  }

  const result = await pool.query(
    `SELECT id, workspace_id, stage_key, label, color, sort_order,
            is_builtin, created_at, updated_at
       FROM kanban_columns
      WHERE workspace_id = $1
      ORDER BY sort_order ASC, created_at ASC`,
    [workspaceId],
  )
  return NextResponse.json(result.rows.map(rowToKanbanColumn))
}

/**
 * POST — handles two cases distinguished by URL action.
 *
 * - Default: create a custom column (label + color in body)
 * - With ?action=reorder: rewrite sort_order from a list of column ids
 *
 * Why one route handles both: the reorder operation is logically a
 * collection-level mutation (it touches every row), and creating a
 * separate `/reorder/route.ts` adds folder noise for a 20-line handler.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Round 7.11: briefers cannot manage kanban columns even on
  // their own workspace. Column config belongs to staff workflows.
  if (session.role === 'briefer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await ensureSchema()
  const { id: workspaceId } = await params

  // Verify the workspace exists.
  const wsRes = await pool.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE id = $1`,
    [workspaceId],
  )
  if (wsRes.rowCount === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // -------- reorder branch --------
  if (action === 'reorder') {
    const parsed = ReorderInput.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'orderedIds is required' }, { status: 400 })
    }

    // Verify every id belongs to this workspace before mutating, so a
    // malformed call can't shuffle columns across workspaces.
    const idsRes = await pool.query<{ id: string }>(
      `SELECT id FROM kanban_columns WHERE workspace_id = $1`,
      [workspaceId],
    )
    const validIds = new Set(idsRes.rows.map((r) => r.id))
    const allBelong = parsed.data.orderedIds.every((id) => validIds.has(id))
    if (!allBelong) {
      return NextResponse.json(
        { error: 'One or more column ids do not belong to this workspace' },
        { status: 400 },
      )
    }

    // Rewrite sort_order in a single statement using unnest. This is
    // atomic at the row level (each row gets a single UPDATE) and
    // doesn't need an explicit transaction for the small list sizes
    // we're dealing with (5–20 columns max).
    await pool.query(
      `UPDATE kanban_columns AS kc
          SET sort_order = ord.new_sort,
              updated_at = NOW()
         FROM (
           SELECT id, sort
             FROM unnest($1::text[]) WITH ORDINALITY AS t(id, sort)
         ) AS ord(id, new_sort)
        WHERE kc.id = ord.id
          AND kc.workspace_id = $2`,
      [parsed.data.orderedIds, workspaceId],
    )

    const result = await pool.query(
      `SELECT id, workspace_id, stage_key, label, color, sort_order,
              is_builtin, created_at, updated_at
         FROM kanban_columns
        WHERE workspace_id = $1
        ORDER BY sort_order ASC, created_at ASC`,
      [workspaceId],
    )
    return NextResponse.json({ ok: true, columns: result.rows.map(rowToKanbanColumn) })
  }

  // -------- create branch --------
  const parsed = CreateColumnInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Label is required (1–60 chars). Color must be hex.' },
      { status: 400 },
    )
  }

  // Generate a stage_key that's guaranteed not to collide with the
  // five built-in keys, AND unique within this workspace. The cust_
  // prefix marks user-added columns at a glance; report code can skip
  // these by checking startsWith('cust_').
  const stageKey = `cust_${randomUUID().replace(/-/g, '').slice(0, 16)}`

  // Place new columns at the end. SELECT MAX + 1 is fine for our row
  // counts (5–20 per workspace) and avoids the complexity of a window
  // function over the same table we're inserting into.
  const sortOrderRes = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM kanban_columns WHERE workspace_id = $1`,
    [workspaceId],
  )
  const sortOrder = Number(sortOrderRes.rows[0]?.next ?? 0)

  const id = randomUUID()
  await pool.query(
    `INSERT INTO kanban_columns (id, workspace_id, stage_key, label, color, sort_order, is_builtin)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
    [id, workspaceId, stageKey, parsed.data.label, parsed.data.color, sortOrder],
  )

  const result = await pool.query(
    `SELECT id, workspace_id, stage_key, label, color, sort_order,
            is_builtin, created_at, updated_at
       FROM kanban_columns
      WHERE id = $1`,
    [id],
  )
  // Reference BUILTIN_COLUMN_DEFAULTS to keep the import live (it's
  // re-exported elsewhere; this prevents tree-shake removal in tests).
  void BUILTIN_COLUMN_DEFAULTS
  return NextResponse.json({ ok: true, column: rowToKanbanColumn(result.rows[0]) })
}
