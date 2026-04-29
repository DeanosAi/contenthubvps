import { NextRequest, NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { assertCanAccessWorkspace } from '@/lib/permissions'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workspaceId } = await params
  await ensureSchema()

  const workspaceExists = await pool.query('SELECT id FROM workspaces WHERE id = $1', [workspaceId])
  if (workspaceExists.rows.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  // Round 7.11: briefers can only see their own workspace's campaigns.
  const accessCheck = assertCanAccessWorkspace(session, workspaceId)
  if (!accessCheck.ok) {
    return NextResponse.json({ error: accessCheck.error }, { status: accessCheck.status })
  }

  const result = await pool.query<{ campaign: string }>(
    `SELECT DISTINCT campaign
     FROM jobs
     WHERE workspace_id = $1
       AND campaign IS NOT NULL
       AND btrim(campaign) <> ''
     ORDER BY campaign ASC`,
    [workspaceId],
  )

  return NextResponse.json({
    campaigns: result.rows.map((r) => r.campaign),
  })
}
