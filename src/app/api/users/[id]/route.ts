import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { hashPassword, requireAdmin, getSession } from '@/lib/auth'

/**
 * Round 7.11 — admin can now also change a user's role between
 * admin/member/briefer, and (for briefer) bind/unbind a workspace.
 *
 * Constraint: a briefer must always have a workspace_id; the API
 * enforces this at edit time the same way it does at create time.
 */
const UpdateUserInput = z
  .object({
    name: z.string().trim().nullable().optional(),
    role: z.enum(['admin', 'member', 'briefer']).optional(),
    password: z.string().min(8).optional(),
    workspaceId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/**
 * Self-edit rules (unchanged from Round 7.5 except role union widened):
 *   - admins can update any field on any user
 *   - non-admins can update ONLY their own `name`
 *   - non-admins cannot change role or password through this endpoint
 *
 * Round 7.11 additions:
 *   - briefers can also self-edit their `name` (same allowance as members)
 *   - admin role-change to/from briefer requires a valid workspace_id
 *     state after the change. Specifically: setting role=briefer
 *     requires workspaceId; setting role=admin/member nulls out
 *     workspaceId implicitly.
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

  const parsed = UpdateUserInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 })
  }

  const isAdmin = session.role === 'admin'
  const isSelf = session.userId === id

  if (!isAdmin) {
    if (!isSelf) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (
      parsed.data.role !== undefined ||
      parsed.data.password !== undefined ||
      parsed.data.workspaceId !== undefined
    ) {
      return NextResponse.json(
        { error: 'Only an admin can change roles, passwords, or workspace bindings' },
        { status: 403 },
      )
    }
    if (parsed.data.name === undefined) {
      return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 })
    }
  }

  await ensureSchema()

  // For role transitions, validate the resulting state.
  if (isAdmin && parsed.data.role !== undefined) {
    const newRole = parsed.data.role
    // Look up current state to know what workspaceId would be after the change.
    const currentRes = await pool.query<{ workspace_id: string | null }>(
      `SELECT workspace_id FROM users WHERE id = $1`,
      [id],
    )
    if (currentRes.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const currentWorkspaceId = currentRes.rows[0].workspace_id
    const targetWorkspaceId = parsed.data.workspaceId !== undefined
      ? parsed.data.workspaceId
      : currentWorkspaceId

    if (newRole === 'briefer' && !targetWorkspaceId) {
      return NextResponse.json(
        { error: 'Briefer accounts must have a workspace_id; supply workspaceId in the same PATCH.' },
        { status: 400 },
      )
    }
    if (newRole !== 'briefer' && targetWorkspaceId) {
      // Going from briefer to staff — implicitly null out workspace_id.
      // The UPDATE below handles this if we explicitly set it. To keep
      // the contract simple, force null here.
      // We do this by overriding parsed.data.workspaceId in the update plan.
      // (Mutating parsed.data is fine — it's a local zod-output object.)
      ;(parsed.data as { workspaceId?: string | null }).workspaceId = null
    }
  }

  // Validate workspace exists if a non-null workspaceId is being set.
  if (parsed.data.workspaceId) {
    const ws = await pool.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE id = $1',
      [parsed.data.workspaceId],
    )
    if (ws.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 400 })
    }
  }

  const sets: string[] = []
  const values: unknown[] = []
  let n = 1

  if (parsed.data.name !== undefined) {
    sets.push(`name = $${n++}`)
    values.push(parsed.data.name)
  }
  if (parsed.data.role !== undefined) {
    sets.push(`role = $${n++}`)
    values.push(parsed.data.role)
  }
  if (parsed.data.password !== undefined) {
    sets.push(`password_hash = $${n++}`)
    values.push(await hashPassword(parsed.data.password))
  }
  if (parsed.data.workspaceId !== undefined) {
    sets.push(`workspace_id = $${n++}`)
    values.push(parsed.data.workspaceId)
  }
  sets.push(`updated_at = NOW()`)

  values.push(id)
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${n}`, values)

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  await ensureSchema()

  if (id === admin.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
  }

  const target = await pool.query('SELECT role FROM users WHERE id = $1', [id])
  if (target.rows.length === 0) {
    return NextResponse.json({ ok: true })
  }
  if (target.rows[0].role === 'admin') {
    const adminCountRes = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'"
    )
    const adminCount = Number(adminCountRes.rows[0]?.count ?? 0)
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot delete the last admin user. Promote another user to admin first.' },
        { status: 400 }
      )
    }
  }

  await pool.query('DELETE FROM users WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Round 7.11: briefers can only see their own user record. Even
  // by id-guessing they can't pull another user's profile.
  if (session.role === 'briefer' && session.userId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await ensureSchema()
  const result = await pool.query(
    'SELECT id, email, name, role, workspace_id, created_at, updated_at FROM users WHERE id = $1',
    [id]
  )
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const r = result.rows[0]
  if (session.role === 'admin' || session.userId === id) {
    return NextResponse.json({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      workspaceId: r.workspace_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })
  }
  return NextResponse.json({ id: r.id, email: r.email, name: r.name })
}
