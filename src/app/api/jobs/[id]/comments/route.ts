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
  // Round 7.14: optional parent comment id for replies. When set,
  // the new comment is a reply to that comment. Server validates
  // the parent exists on the same job before accepting.
  parentId: z.string().nullable().optional(),
})

const COMMENT_SELECT = `
  c.id, c.job_id, c.author_id, c.body, c.edited,
  c.display_name, c.display_email, c.parent_id,
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
  //
  // Round 7.14: same shape for displayEmail. Briefers MUST have
  // entered an email at the prompt; staff fall back to their
  // profile email (set at login).
  let displayName = session.displayName?.trim() || null
  let displayEmail = session.displayEmail?.trim() || null
  if (!displayName || (session.role === 'briefer' && !displayEmail)) {
    if (session.role === 'briefer') {
      return NextResponse.json(
        {
          error:
            'Please set your name and email before commenting. Refresh the page to be prompted again.',
        },
        { status: 400 },
      )
    }
    // Staff fallback: look up the user's profile name + email.
    const profile = await pool.query<{ name: string | null; email: string | null }>(
      `SELECT name, email FROM users WHERE id = $1`,
      [session.userId],
    )
    if (!displayName) displayName = profile.rows[0]?.name?.trim() || null
    if (!displayEmail) displayEmail = profile.rows[0]?.email?.trim() || null
  }

  // Round 7.14: validate parentId — when a reply is posted, the
  // parent comment must exist on this same job. Prevents threading
  // across jobs (an attack vector if a briefer in workspace A could
  // reply to a comment on a job in workspace B). Permissive on
  // missing parent: if it's null/undefined, this is a top-level
  // comment, no validation needed.
  const parentId = parsed.data.parentId?.trim() || null
  if (parentId) {
    const parentRes = await pool.query<{ id: string; job_id: string }>(
      `SELECT id, job_id FROM job_comments WHERE id = $1`,
      [parentId],
    )
    if (parentRes.rowCount === 0 || parentRes.rows[0].job_id !== jobId) {
      return NextResponse.json(
        { error: 'Parent comment not found on this job' },
        { status: 400 },
      )
    }
  }

  const id = randomUUID()
  await pool.query(
    `INSERT INTO job_comments
       (id, job_id, author_id, body, display_name, display_email, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, jobId, session.userId, parsed.data.body, displayName, displayEmail, parentId],
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
