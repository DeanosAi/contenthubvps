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

  const newSession = {
    ...session,
    displayName: parsed.data.displayName,
  }
  const token = signSession(newSession)
  await setSessionCookie(token)

  return NextResponse.json({ ok: true, displayName: parsed.data.displayName })
}
