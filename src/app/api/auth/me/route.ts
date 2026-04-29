import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/**
 * GET /api/auth/me — returns the signed-in user's session payload,
 * or 401 if there isn't one. Used by client components that need
 * to know the user's role + identity for gated UI.
 *
 * Round 7.11: now includes workspaceId and displayName so client
 * components (the comments thread, the briefer "who are you"
 * prompt, the edit-history attribution) can render the right
 * identity without an extra round-trip to /api/users/[id].
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    userId: session.userId,
    email: session.email,
    role: session.role,
    workspaceId: session.workspaceId,
    displayName: session.displayName,
  })
}
