import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, signSession, setSessionCookie } from '@/lib/auth'

/**
 * POST /api/auth/set-display-name — Round 7.11.
 *
 * Updates the session's displayName field by re-signing the session
 * JWT with the new value. The cookie is reset; the underlying user
 * row in the database is not touched (this is an EPHEMERAL session
 * setting, not a profile change).
 *
 * Used by:
 *   - The "Who's using this account today?" prompt that appears on
 *     a briefer's first session-start (after login or after explicit
 *     "switch user").
 *   - The "Switch user" link in the briefer header that re-prompts
 *     mid-session.
 *
 * For staff (admin/member) this endpoint exists too but isn't
 * surfaced in the UI — they identify by their profile name. We
 * still allow them to call it (e.g. for testing) but the practical
 * effect is small.
 *
 * The displayName is what gets snapshotted into:
 *   - new comments (job_comments.display_name)
 *   - audit log entries (job_edits.edited_by_name)
 *   - new briefs (jobs.briefer_display_name)
 *
 * Because the session is the only place this value lives between
 * actions, all client-side state should refresh from /api/auth/me
 * after a successful set-display-name call.
 */
const Input = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Name cannot be empty')
    .max(80, 'Name must be 80 characters or less'),
  // Round 7.14: optional email field. The briefer prompt sends
  // both name AND email together. Old callers (any client that
  // still posts only displayName) keep working — email simply
  // doesn't change in that case. The briefer prompt UI enforces
  // email-required client-side; the API is permissive so we don't
  // break any in-progress flows.
  displayEmail: z
    .string()
    .trim()
    .max(200, 'Email must be 200 characters or less')
    .regex(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      'Please enter a valid email address',
    )
    .optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = Input.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  // Round 7.14: only update displayEmail when the caller actually
  // sent one. Allows partial updates: a future "just rename me"
  // path can post displayName alone and leave displayEmail intact.
  const newSession = {
    ...session,
    displayName: parsed.data.displayName,
    displayEmail: parsed.data.displayEmail ?? session.displayEmail,
  }
  const token = signSession(newSession)
  await setSessionCookie(token)

  return NextResponse.json({
    ok: true,
    displayName: parsed.data.displayName,
    displayEmail: newSession.displayEmail,
  })
}
