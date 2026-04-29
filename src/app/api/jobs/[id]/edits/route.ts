import { NextRequest, NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToJobEdit } from '@/lib/db-mappers'
import { assertCanViewJob } from '@/lib/permissions'

/**
 * GET /api/jobs/:id/edits — Round 7.11.
 *
 * Returns the full edit history for a job, newest first. Anyone
 * who can view the job can view its edit history (so briefers
 * see edits to fields they might have made themselves, plus any
 * edits staff made). The audit log is intentionally transparent —
 * the point is accountability.
 *
 * Response shape: an array of JobEdit objects sorted by edited_at
 * descending. Empty array if the job has no recorded edits.
 *
 * Implementation note: edited_by_user_id may be NULL (FK was set
 * to NULL when the editor was deleted). The mapper handles this
 * by returning null for editedByUserId; the snapshotted
 * editedByName preserves attribution.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const { id: jobId } = await params

  // Look up the job's workspace_id to gate access.
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
    `SELECT id, job_id, field_name, old_value, new_value,
            edited_by_user_id, edited_by_name, edited_by_role, edited_at
       FROM job_edits
      WHERE job_id = $1
      ORDER BY edited_at DESC`,
    [jobId],
  )

  return NextResponse.json(result.rows.map(rowToJobEdit))
}
