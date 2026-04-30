import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJobComment } from '@/lib/db-mappers'
import { assertCanViewJob } from '@/lib/permissions'

/**
 * Round 7.10 — per-comment edit/delete endpoints.
 * Round 7.11 — adds workspace-scoped permission checks.
 *
 * PATCH  /api/jobs/:id/comments/:commentId  — edit comment body
 * DELETE /api/jobs/:id/comments/:commentId  — delete the comment
 *
 * Permission model:
 *   - Caller must be able to view the parent job (workspace check
 *     enforced via assertCanViewJob — briefers in another workspace
 *     get 404 to avoid leaking comment existence).
 *   - For PATCH (edit): only the original author. Admins cannot
 *     edit other people's comments — editing someone's words without
 *     their knowledge is worse than deleting.
 *   - For DELETE: original author OR an admin (admin-as-staff only;
 *     a briefer who happens to have role=admin elsewhere doesn't
 *     apply — briefers are always role=briefer in this system).
 *
 * Round 7.11 specific notes:
 *   - The SELECT joins users to pull author_role and reads the
 *     stored display_name on the comment row, so the response shape
 *     matches what the list endpoint returns.
 */

const PatchCommentInput = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
})

const COMMENT_SELECT = `
  c.id, c.job_id, c.author_id, c.body, c.edited,
  c.display_name, c.display_email, c.parent_id,
  c.created_at, c.updated_at,
  u.name  AS author_name,
  u.email AS author_email,
  u.role  AS author_role
`

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId, commentId } = await params

  // Workspace gate: pull the job's workspace id and run the access
  // check before doing any other work. Briefers in the wrong
  // workspace get 404 here, indistinguishable from "comment doesn't
  // exist."
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

  // Fetch the comment to verify authorship.
  const commentRes = await pool.query<{
    id: string
    author_id: string | null
    body: string
  }>(
    `SELECT id, author_id, body FROM job_comments WHERE id = $1 AND job_id = $2`,
    [commentId, jobId],
  )
  if (commentRes.rowCount === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }
  const comment = commentRes.rows[0]

  // Edit permission: original author only.
  if (comment.author_id !== session.userId) {
    return NextResponse.json(
      { error: 'You can only edit your own comments' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = PatchCommentInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  // No-change short-circuit. Avoid writing edited=TRUE if the body
  // is identical to what's already stored — saves a "this was edited"
  // marker from appearing for a no-op save.
  if (parsed.data.body === comment.body) {
    const result = await pool.query(
      `SELECT ${COMMENT_SELECT}
         FROM job_comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.id = $1`,
      [commentId],
    )
    return NextResponse.json({ ok: true, comment: rowToJobComment(result.rows[0]) })
  }

  await pool.query(
    `UPDATE job_comments
        SET body = $1, edited = TRUE, updated_at = NOW()
      WHERE id = $2`,
    [parsed.data.body, commentId],
  )

  const result = await pool.query(
    `SELECT ${COMMENT_SELECT}
       FROM job_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.id = $1`,
    [commentId],
  )
  return NextResponse.json({ ok: true, comment: rowToJobComment(result.rows[0]) })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId, commentId } = await params

  // Workspace gate first.
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

  const commentRes = await pool.query<{ id: string; author_id: string | null }>(
    `SELECT id, author_id FROM job_comments WHERE id = $1 AND job_id = $2`,
    [commentId, jobId],
  )
  if (commentRes.rowCount === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }
  const comment = commentRes.rows[0]

  const isAuthor = comment.author_id === session.userId
  const isAdmin = session.role === 'admin'

  if (!isAuthor && !isAdmin) {
    return NextResponse.json(
      { error: 'You can only delete your own comments' },
      { status: 403 },
    )
  }

  await pool.query(`DELETE FROM job_comments WHERE id = $1`, [commentId])
  return NextResponse.json({ ok: true })
}
