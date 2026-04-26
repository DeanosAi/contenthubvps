import { NextRequest, NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'

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
