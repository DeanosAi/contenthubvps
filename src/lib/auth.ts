import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'contenthub_session'

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export function signSession(payload: { userId: string; email: string }) {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('Missing NEXTAUTH_SECRET')
  return jwt.sign(payload, secret, { expiresIn: '14d' })
}

export function verifySession(token: string): { userId: string; email: string } | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) throw new Error('Missing NEXTAUTH_SECRET')
    return jwt.verify(token, secret) as { userId: string; email: string }
  } catch {
    return null
  }
}

export async function getSession() {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifySession(token)
}

export async function setSessionCookie(token: string) {
  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}
