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
 * Round 7.11: SessionUser now carries workspaceId + displayName +
 * an expanded role union. We rebuild the payload defensively so
 * old cookies (which may have had only userId/email/role) don't
 * crash the verifier — missing fields default to null.
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

/** Read and verify the current request's session cookie. Returns the
 * decoded session payload or null if missing/invalid. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifySession(token)
}

/** Like getSession() but also fetches the live user record from the DB.
 * Use this when you need to verify the user still exists / hasn't been
 * deleted since the cookie was issued. */
export async function getSessionUser(): Promise<{ session: SessionUser; user: User } | null> {
  const session = await getSession()
  if (!session) return null
  await ensureSchema()
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

/** True if the caller has a valid session AND the admin role. Used to
 * gate user-management endpoints. */
export async function requireAdmin(): Promise<SessionUser | null> {
  const session = await getSession()
  if (!session || session.role !== 'admin') return null
  return session
}

/**
 * Round 7.11: True if the caller is staff (admin or member).
 * Used to gate endpoints that briefers should not be able to call
 * at all (e.g. listing all workspaces, viewing reports).
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
