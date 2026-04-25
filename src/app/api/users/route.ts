import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession, hashPassword, requireAdmin } from '@/lib/auth'
import { rowToUser } from '@/lib/db-mappers'

const CreateUserInput = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8),
  name: z.string().trim().optional(),
  role: z.enum(['admin', 'member']).optional(),
})

/** GET /api/users — list users.
 *
 * Visibility rules:
 *  - admins see everyone (used by the user-management UI)
 *  - members see a name+email-only list (used to populate the "assigned
 *    to" dropdown on jobs without exposing role/email metadata to non-admins).
 *
 * We deliberately never return password hashes from any API. */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const result = await pool.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY created_at ASC'
  )
  const users = result.rows.map(rowToUser)

  if (session.role === 'admin') {
    return NextResponse.json(users)
  }
  // Non-admins get a slim list — id + name + email only — so they can
  // pick assignees but can't see who's an admin.
  return NextResponse.json(
    users.map((u) => ({ id: u.id, email: u.email, name: u.name }))
  )
}

/** POST /api/users — create a new user. Admin only. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateUserInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Email, name, and a password of at least 8 characters are required' },
      { status: 400 }
    )
  }

  await ensureSchema()

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [parsed.data.email])
  if (existing.rows.length > 0) {
    return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 })
  }

  const id = randomUUID()
  const hash = await hashPassword(parsed.data.password)
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, parsed.data.email, hash, parsed.data.name ?? null, parsed.data.role ?? 'member']
  )

  return NextResponse.json({ ok: true, id })
}
