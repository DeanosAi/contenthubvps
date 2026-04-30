import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth'
import { rowToUser } from '@/lib/db-mappers'

const LoginInput = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
})

/**
 * Round 7.11 — login issues a session payload that carries:
 *   - userId, email, role  (existed)
 *   - workspaceId          (NEW — required for briefer scoping)
 *   - displayName          (NEW — set to the user's profile name
 *                            initially; for briefers this gets
 *                            overridden by the per-session
 *                            "who's using this account today"
 *                            prompt via /api/auth/set-display-name)
 *
 * The response includes a `redirectTo` hint so the login page can
 * route briefers to /briefer and staff to /app without the client
 * needing to know the role-routing logic.
 */
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

  const FAIL_MESSAGE = 'Invalid email or password'

  const result = await pool.query(
    'SELECT id, email, password_hash, name, role, workspace_id, created_at, updated_at FROM users WHERE email = $1 LIMIT 1',
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

  // Validate briefer accounts are workspace-bound. A briefer with a
  // null workspace_id is misconfigured and shouldn't be able to log
  // in successfully — would lead to confusing UX (logged in but can
  // see nothing). Block at the gate.
  if (user.role === 'briefer' && !user.workspaceId) {
    return NextResponse.json(
      { error: 'Briefer account is not bound to a workspace. Contact an admin.' },
      { status: 403 }
    )
  }

  const token = signSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    workspaceId: user.workspaceId,
    // Round 7.11p: briefer logins ALWAYS start with displayName=null
    // so the "Who are you today?" prompt fires reliably on every
    // fresh login. The shared venue login is used by different
    // people on different days — assuming "the last name set is
    // still you" is wrong. Force re-identification.
    //
    // For staff (admin/member), displayName falls back to their
    // profile name as before — staff identify by their own profile
    // and the prompt is only useful for the shared-account case.
    displayName: user.role === 'briefer' ? null : user.name,
    // Round 7.14: same pattern for displayEmail. For briefers, null
    // forces the prompt to ask. For staff, default to profile email
    // — they don't get the prompt and use their own login email.
    displayEmail: user.role === 'briefer' ? null : user.email,
  })
  await setSessionCookie(token)

  // redirectTo: where the login page should send the user.
  const redirectTo = user.role === 'briefer' ? '/briefer' : '/app'

  return NextResponse.json({ ok: true, user, redirectTo })
}
