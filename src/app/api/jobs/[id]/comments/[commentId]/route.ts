import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJobComment } from '@/lib/db-mappers'

/**
 * Round 7.10 — per-comment edit/delete endpoints.
 *
 * PATCH  /api/jobs/:id/comments/:commentId  — edit comment body
 * DELETE /api/jobs/:id/comments/:commentId  — delete the comment
 *
 * Permission model:
 *   - The original author can edit or delete their own comment.
 *   - Admins can delete (but NOT edit) anyone's comment. Editing
 *     someone else's comment without their knowledge is a worse
 *     outcome than deleting it — better to remove and let the
 *     author re-post if they choose.
 *   - Nobody else can do anything.
 *
 * The jobId in the URL is validated to exist but otherwise unused
 * (the comment's own job_id FK handles the relationship).
 */

const PatchCommentInput = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId, commentId } = await params

  // Verify the job exists (defensive — prevents orphaned comments)
  const jobRes = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rowCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Fetch the comment and verify authorship
  const commentRes = await pool.query<{
    id: string
    author_id: string
    body: string
    edited: boolean
  }>(
    `SELECT id, author_id, body, edited FROM job_comments WHERE id = $1 AND job_id = $2`,
    [commentId, jobId],
  )
  if (commentRes.rowCount === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }
  const comment = commentRes.rows[0]

  // Only the original author can edit
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

  // No-change detection: if body is identical, just return the comment
  if (parsed.data.body === comment.body) {
    const result = await pool.query(
      `SELECT c.id, c.job_id, c.author_id, u.name AS author_name, u.email AS author_email,
              c.body, c.edited, c.created_at, c.updated_at
         FROM job_comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.id = $1`,
      [commentId],
    )
    return NextResponse.json({ ok: true, comment: rowToJobComment(result.rows[0]) })
  }

  await pool.query(
    `UPDATE job_comments SET body = $1, edited = TRUE, updated_at = NOW()
      WHERE id = $2`,
    [parsed.data.body, commentId],
  )

  const result = await pool.query(
    `SELECT c.id, c.job_id, c.author_id, u.name AS author_name, u.email AS author_email,
            c.body, c.edited, c.created_at, c.updated_at
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

  // Verify the job exists (defensive)
  const jobRes = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rowCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Fetch the comment and verify authorship or admin status
  const commentRes = await pool.query<{ id: string; author_id: string }>(
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
