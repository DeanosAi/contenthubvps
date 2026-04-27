import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { hashPassword, requireAdmin, getSession } from '@/lib/auth'

const UpdateUserInput = z
  .object({
    name: z.string().trim().nullable().optional(),
    role: z.enum(['admin', 'member']).optional(),
    password: z.string().min(8).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/**
 * Round 7.5: relaxed authorization to allow a non-admin user to
 * update their OWN display name. Prior to this round only admins
 * could PATCH any user, which left no path for a user to fix their
 * own name — admins could rename others, but a teammate would have
 * to ask the admin to rename them.
 *
 * The rules now are:
 *   - admins can update any field on any user (name, role, password)
 *   - non-admin users can update ONLY their own `name`
 *     - they cannot change their own role (privilege escalation)
 *     - they cannot change their own password through this endpoint
 *       (passwords are reset by an admin via this same endpoint;
 *       a future round may add a self-service password change flow)
 *     - they cannot touch any other user
 *
 * Self-name-edit is a low-risk operation: name is purely cosmetic,
 * has no security implications, and the user can already see their
 * own name everywhere it's displayed.
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

  // Authorization gate — see the comment on this function.
  if (!isAdmin) {
    if (!isSelf) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Self-edit: only `name` is permitted.
    if (parsed.data.role !== undefined || parsed.data.password !== undefined) {
      return NextResponse.json(
        { error: 'Only an admin can change roles or passwords' },
        { status: 403 },
      )
    }
    if (parsed.data.name === undefined) {
      // Only field that's not allowed-or-undefined would be a
      // contradiction with the .refine() check, but defensively:
      return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 })
    }
  }

  await ensureSchema()

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
  await ensureSchema()
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
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
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })
  }
  return NextResponse.json({ id: r.id, email: r.email, name: r.name })
}
