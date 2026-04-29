import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJobComment } from '@/lib/db-mappers'
import { assertCanViewJob } from '@/lib/permissions'

/**
 * Round 7.10 — job comments endpoints. Round 7.11 — workspace-scoped
 * permissions plus display_name attribution.
 *
 * GET  /api/jobs/:id/comments        — list, oldest first
 * POST /api/jobs/:id/comments        — create as the current user
 *
 * Per-comment edit/delete live in the sibling [commentId]/route.ts file.
 *
 * Round 7.11 changes:
 *   - Briefers can only see/post comments on jobs in their own
 *     workspace. Cross-workspace returns 404 (no leakage of the
 *     other workspace's existence).
 *   - Each comment captures display_name from the session at post
 *     time. For staff this is their profile name. For briefers this
 *     is the "who's using this venue account today" answer set via
 *     the set-display-name endpoint.
 *   - The list response includes author_role and display_name so
 *     the UI can render "Tracy from Mt Druitt (briefer)" alongside
 *     staff names.
 */

const CreateCommentInput = z.object({
  body: z.string().trim().min(1, 'Comment body required').max(5000),
})

const COMMENT_SELECT = `
  c.id, c.job_id, c.author_id, c.body, c.edited, c.display_name,
  c.created_at, c.updated_at,
  u.name  AS author_name,
  u.email AS author_email,
  u.role  AS author_role
`

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId } = await params

  // Verify job exists AND check workspace access in one query.
  const jobRes = await pool.query<{ id: string; workspace_id: string }>(
    `SELECT id, workspace_id FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rowCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const accessCheck = assertCanViewJob(session, jobRes.rows[0].workspace_id)
  if (!accessCheck.ok) {
    return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
  }

  const result = await pool.query(
    `SELECT ${COMMENT_SELECT}
     FROM job_comments c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.job_id = $1
     ORDER BY c.created_at ASC`,
    [jobId],
  )

  return NextResponse.json(result.rows.map(rowToJobComment))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateCommentInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const jobRes = await pool.query<{ id: string; workspace_id: string }>(
    `SELECT id, workspace_id FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rowCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const accessCheck = assertCanViewJob(session, jobRes.rows[0].workspace_id)
  if (!accessCheck.ok) {
    return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
  }

  // Round 7.12p2: snapshot display_name from session, with a
  // briefer-specific guardrail.
  //
  // For briefers (shared venue logins), session.displayName is the
  // per-session "who's using the app today" answer. If it's null
  // here, the prompt either didn't fire or was bypassed somehow —
  // and we MUST NOT silently fall back to the profile name (which
  // for shared accounts is the venue's name like "Mt Druitt Login",
  // not a person's name). Refuse the post and tell the client to
  // refresh; the briefer-shell will re-fire the prompt.
  //
  // For staff (admin/member), session.displayName is set at login
  // to their profile name — falling back to a profile lookup is
  // safe and helpful.
  let displayName = session.displayName?.trim() || null
  if (!displayName) {
    if (session.role === 'briefer') {
      return NextResponse.json(
        {
          error:
            'Please set your name before commenting. Refresh the page to be prompted again.',
        },
        { status: 400 },
      )
    }
    // Staff fallback: look up the user's profile name.
    const profile = await pool.query<{ name: string | null }>(
      `SELECT name FROM users WHERE id = $1`,
      [session.userId],
    )
    displayName = profile.rows[0]?.name?.trim() || null
  }

  const id = randomUUID()
  await pool.query(
    `INSERT INTO job_comments (id, job_id, author_id, body, display_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, jobId, session.userId, parsed.data.body, displayName],
  )

  const result = await pool.query(
    `SELECT ${COMMENT_SELECT}
     FROM job_comments c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.id = $1`,
    [id],
  )

  return NextResponse.json(rowToJobComment(result.rows[0]), { status: 201 })
}
