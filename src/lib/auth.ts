import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import { pool, ensureSchema } from './postgres'
import { rowToUser } from './db-mappers'
import type { SessionUser, User, UserRole } from './types'

const COOKIE_NAME = 'contenthub_session'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14 // 14 days

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('NEXTAUTH_SECRET is missing or too short. Set a long random value in .env.')
  }
  return secret
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function signSession(payload: SessionUser): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '14d' })
}

/**
 * Decode the JWT and return the session payload, or null if the
 * token is missing/invalid. This does NOT verify the user still
 * exists in the database — for that, use getSession().
 *
 * Used internally by getSession() and by callers that explicitly
 * just need the JWT contents (rare).
 *
 * Round 7.11: SessionUser carries workspaceId + displayName + an
 * expanded role union. We rebuild the payload defensively so old
 * cookies (which may have had only userId/email/role) don't crash
 * the verifier — missing fields default to null.
 */
export function verifySession(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, getSecret())
    if (typeof decoded === 'string' || decoded == null) return null
    const obj = decoded as Record<string, unknown>
    const userId = obj.userId
    const email = obj.email
    const rawRole = obj.role
    if (typeof userId !== 'string' || typeof email !== 'string') return null
    const role: UserRole =
      rawRole === 'admin' ? 'admin'
      : rawRole === 'briefer' ? 'briefer'
      : 'member'
    const workspaceId = typeof obj.workspaceId === 'string' && obj.workspaceId.length > 0
      ? obj.workspaceId
      : null
    const displayName = typeof obj.displayName === 'string' && obj.displayName.length > 0
      ? obj.displayName
      : null
    return { userId, email, role, workspaceId, displayName }
  } catch {
    return null
  }
}

/**
 * Round 7.11p — defensive session check.
 *
 * Returns the active session ONLY if:
 *   1. The session cookie is present and the JWT verifies
 *   2. The user still exists in the database
 *   3. The user's current role matches the JWT's role
 *   4. (For briefers) the user's current workspace_id matches
 *      the JWT's workspaceId
 *
 * If any of these fail, returns null. The caller should treat
 * this as "no session" (return 401, redirect to login, etc.).
 *
 * Why this is necessary:
 *   - Pre-7.11p: a deleted user kept their JWT cookie working
 *     until the 14-day expiry. They could still navigate the
 *     app, view data, submit briefs, etc. Real security bug.
 *   - This function adds one indexed primary-key SELECT per
 *     authenticated request. At our scale (5-person team) the
 *     cost is sub-millisecond and the pool is already warm.
 *
 * Why we also check role/workspaceId match:
 *   - If admin demotes a staff member from admin → member,
 *     their old "admin" JWT would still grant admin access
 *     until expiry. Same issue, smaller blast radius.
 *   - If a briefer is reassigned to a different workspace,
 *     their old JWT would still scope them to the old workspace.
 *   - Tying the JWT's role/workspaceId to the live DB row means
 *     ANY auth-relevant change forces a re-login. Predictable.
 *
 * NOTE: `email` is NOT checked because admins may legitimately
 * change a user's email and we don't want to log them out.
 * `userId` is the stable identifier.
 */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null

  const decoded = verifySession(token)
  if (!decoded) return null

  // Live DB check. The row we want is keyed on PRIMARY KEY id —
  // this is a fast lookup. We pull just the fields we need to
  // confirm role/workspace haven't drifted from the JWT.
  await ensureSchema()
  const result = await pool.query<{
    id: string
    role: string
    workspace_id: string | null
  }>(
    'SELECT id, role, workspace_id FROM users WHERE id = $1',
    [decoded.userId]
  )
  if (result.rows.length === 0) {
    // User was deleted. Their session is dead. Don't bother
    // clearing the cookie here — clearing it requires the
    // response to have access to set-cookie headers, and
    // getSession() is called from many contexts (page render,
    // API route, etc.). Letting the cookie linger is harmless;
    // every getSession() call will continue to return null
    // until the user logs in again (which sets a new cookie).
    return null
  }

  const liveRow = result.rows[0]
  const liveRole: UserRole =
    liveRow.role === 'admin' ? 'admin'
    : liveRow.role === 'briefer' ? 'briefer'
    : 'member'

  // Role drift — user's role was changed since the JWT was
  // issued. Force re-login by returning null.
  if (liveRole !== decoded.role) {
    return null
  }

  // Briefer workspace drift — for briefers only, confirm the
  // workspace they're bound to matches what the JWT claims.
  // Staff (admin/member) have NULL workspace_id and the JWT
  // also stores null, so the check is just liveRow.workspace_id
  // === decoded.workspaceId.
  if (liveRow.workspace_id !== decoded.workspaceId) {
    return null
  }

  // Live data agrees with the JWT. Session is valid.
  return decoded
}

/** Like getSession() but also returns the full user record. Use
 * when you need fields beyond what's in the JWT payload (e.g. the
 * profile name for an audit log fallback). */
export async function getSessionUser(): Promise<{ session: SessionUser; user: User } | null> {
  const session = await getSession()
  if (!session) return null
  // getSession already confirmed the user exists; we re-query
  // here to get the full row including name/email/timestamps.
  const result = await pool.query(
    'SELECT id, email, name, role, workspace_id, created_at, updated_at FROM users WHERE id = $1',
    [session.userId]
  )
  if (result.rows.length === 0) return null
  return { session, user: rowToUser(result.rows[0]) }
}

/** True if the caller has a valid session (any role). */
export async function requireSession(): Promise<SessionUser | null> {
  return getSession()
}

/** True if the caller has a valid session AND the admin role. Used
 * to gate user-management endpoints. */
export async function requireAdmin(): Promise<SessionUser | null> {
  const session = await getSession()
  if (!session || session.role !== 'admin') return null
  return session
}

/**
 * Round 7.11: True if the caller is staff (admin or member). Used
 * to gate endpoints that briefers should not be able to call at
 * all (e.g. listing all workspaces, viewing reports).
 */
export async function requireStaff(): Promise<SessionUser | null> {
  const session = await getSession()
  if (!session) return null
  if (session.role !== 'admin' && session.role !== 'member') return null
  return session
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
