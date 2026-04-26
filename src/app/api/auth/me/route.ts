import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/** GET /api/auth/me — returns the signed-in user's session payload, or
 * 401 if there isn't one. Used by client components that need to know
 * the user's role for gated UI (e.g. the Settings page hiding admin-only
 * controls from members). */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    userId: session.userId,
    email: session.email,
    role: session.role,
  })
}
