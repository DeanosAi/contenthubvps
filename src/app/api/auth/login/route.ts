import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth'
import { rowToUser } from '@/lib/db-mappers'

const LoginInput = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = LoginInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  await ensureSchema()

  // Generic auth-failure message for both "no such user" and "wrong
  // password" cases so we don't leak which emails exist on the system.
  const FAIL_MESSAGE = 'Invalid email or password'

  const result = await pool.query(
    'SELECT id, email, password_hash, name, role, created_at, updated_at FROM users WHERE email = $1 LIMIT 1',
    [parsed.data.email]
  )
  if (result.rows.length === 0) {
    return NextResponse.json({ error: FAIL_MESSAGE }, { status: 401 })
  }

  const row = result.rows[0]
  const ok = await verifyPassword(parsed.data.password, String(row.password_hash))
  if (!ok) {
    return NextResponse.json({ error: FAIL_MESSAGE }, { status: 401 })
  }

  const user = rowToUser(row)
  const token = signSession({ userId: user.id, email: user.email, role: user.role })
  await setSessionCookie(token)

  return NextResponse.json({ ok: true, user })
}
