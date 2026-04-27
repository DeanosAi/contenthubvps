import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToKanbanColumn } from '@/lib/db-mappers'

/**
 * Round 7.2: per-column edits.
 *
 * PATCH  /api/workspaces/:id/columns/:columnId  — rename and/or recolor
 * DELETE /api/workspaces/:id/columns/:columnId  — delete (custom only)
 *
 * Built-in columns cannot be deleted. Reports filter on the literal
 * `posted` and `archive` stage keys, so removing those columns would
 * silently break reporting. The DELETE handler enforces this by
 * checking is_builtin server-side.
 *
 * When a custom column is deleted, any jobs sitting in that stage are
 * moved to `brief` so they don't become invisible. This is preferable
 * to refusing the delete when there are jobs in the column — the user
 * would have to drag every card out manually.
 */

const PatchColumnInput = z
  .object({
    label: z.string().trim().min(1, 'Label is required').max(60).optional(),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .refine((d) => d.label !== undefined || d.color !== undefined, {
    message: 'At least one of label or color must be provided',
  })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; columnId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: workspaceId, columnId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PatchColumnInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  // Verify the column exists and belongs to this workspace.
  const existing = await pool.query<{
    id: string
    workspace_id: string
    is_builtin: boolean
  }>(
    `SELECT id, workspace_id, is_builtin
       FROM kanban_columns
      WHERE id = $1`,
    [columnId],
  )
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'Column not found' }, { status: 404 })
  }
  if (existing.rows[0].workspace_id !== workspaceId) {
    return NextResponse.json(
      { error: 'Column does not belong to this workspace' },
      { status: 400 },
    )
  }

  // Build the SET clause dynamically based on what was provided.
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1
  if (parsed.data.label !== undefined) {
    updates.push(`label = $${i++}`)
    values.push(parsed.data.label)
  }
  if (parsed.data.color !== undefined) {
    updates.push(`color = $${i++}`)
    values.push(parsed.data.color)
  }
  updates.push(`updated_at = NOW()`)
  values.push(columnId)

  await pool.query(
    `UPDATE kanban_columns SET ${updates.join(', ')} WHERE id = $${i}`,
    values,
  )

  const result = await pool.query(
    `SELECT id, workspace_id, stage_key, label, color, sort_order,
            is_builtin, created_at, updated_at
       FROM kanban_columns
      WHERE id = $1`,
    [columnId],
  )
  return NextResponse.json({ ok: true, column: rowToKanbanColumn(result.rows[0]) })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; columnId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: workspaceId, columnId } = await params

  const existing = await pool.query<{
    id: string
    workspace_id: string
    is_builtin: boolean
    stage_key: string
  }>(
    `SELECT id, workspace_id, is_builtin, stage_key
       FROM kanban_columns
      WHERE id = $1`,
    [columnId],
  )
  if (existing.rowCount === 0) {
    return NextResponse.json({ error: 'Column not found' }, { status: 404 })
  }
  const col = existing.rows[0]
  if (col.workspace_id !== workspaceId) {
    return NextResponse.json(
      { error: 'Column does not belong to this workspace' },
      { status: 400 },
    )
  }
  if (col.is_builtin) {
    return NextResponse.json(
      { error: 'Built-in columns cannot be deleted. You can rename them instead.' },
      { status: 400 },
    )
  }

  // Move any jobs in this stage to 'brief' so they don't become
  // invisible (the kanban only renders columns it knows about).
  // Done before the column delete so a transient client refetch in
  // between doesn't miss jobs.
  await pool.query(
    `UPDATE jobs SET stage = 'brief', updated_at = NOW()
      WHERE workspace_id = $1 AND stage = $2`,
    [workspaceId, col.stage_key],
  )

  await pool.query(`DELETE FROM kanban_columns WHERE id = $1`, [columnId])

  return NextResponse.json({ ok: true })
}
