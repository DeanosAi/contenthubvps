import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJobComment } from '@/lib/db-mappers'

/**
 * Round 7.10 — job comments endpoints.
 *
 * GET  /api/jobs/:id/comments        — list, oldest first (UI flips client-side if desired)
 * POST /api/jobs/:id/comments        — create a new comment as the current user
 *
 * Per-comment edit (PATCH body) and delete (DELETE) live in the sibling
 * [commentId]/route.ts file.
 *
 * Permission model:
 *   - Anyone authenticated can list / post comments on any job they
 *     can see. There's currently no per-workspace RBAC in this
 *     codebase, so this matches the broader access model.
 *   - The author_id of new comments comes from the session, not the
 *     request body — clients can't impersonate.
 *
 * The list endpoint JOINs against users to pull author display
 * fields (name, email) so the UI doesn't need a second round-trip
 * to render the thread. A comment whose author was later deleted
 * comes back with author_id NULL via the FK's ON DELETE SET NULL,
 * and the JOIN's LEFT OUTER ensures those still appear in the list.
 */

const CreateCommentInput = z.object({
  body: z.string().trim().min(1, 'Comment body required').max(5000),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId } = await params

  // Verify the job exists. Without this an attacker could probe
  // for valid job ids by counting how many comments are returned.
  const jobRes = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rowCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // LEFT JOIN so deleted-author comments still come back.
  const result = await pool.query(
    `SELECT
       c.id, c.job_id, c.author_id, c.body, c.edited,
       c.created_at, c.updated_at,
       u.name  AS author_name,
       u.email AS author_email
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

  // Verify job exists before insert so the FK doesn't silently 500.
  const jobRes = await pool.query<{ id: string }>(
    `SELECT id FROM jobs WHERE id = $1`,
    [jobId],
  )
  if (jobRes.rowCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const id = randomUUID()
  await pool.query(
    `INSERT INTO job_comments (id, job_id, author_id, body)
     VALUES ($1, $2, $3, $4)`,
    [id, jobId, session.userId, parsed.data.body],
  )

  // Return the freshly-created comment with author fields populated
  // so the client can append it to its in-memory list without a refetch.
  const result = await pool.query(
    `SELECT
       c.id, c.job_id, c.author_id, c.body, c.edited,
       c.created_at, c.updated_at,
       u.name  AS author_name,
       u.email AS author_email
     FROM job_comments c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.id = $1`,
    [id],
  )

  return NextResponse.json(rowToJobComment(result.rows[0]), { status: 201 })
}
