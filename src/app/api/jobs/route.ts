import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema, pool } from '@/lib/postgres'
import { isAdminAuthenticated } from '@/lib/session'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  const result = workspaceId
    ? await pool.query('SELECT * FROM jobs WHERE workspace_id = $1 ORDER BY created_at DESC', [workspaceId])
    : await pool.query('SELECT * FROM jobs ORDER BY created_at DESC')
  return NextResponse.json(result.rows)
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = await req.json()
  const id = randomUUID()
  const title = String(body.title || '').trim()
  const workspaceId = String(body.workspaceId || '').trim()
  const description = body.description ? String(body.description) : null
  const stage = String(body.stage || 'brief')
  const priority = Number(body.priority || 0)
  const hashtags = body.hashtags ? String(body.hashtags) : null
  const platform = body.platform ? String(body.platform) : null
  const liveUrl = body.liveUrl ? String(body.liveUrl) : null
  const notes = body.notes ? String(body.notes) : null
  if (!title || !workspaceId) return NextResponse.json({ error: 'workspaceId and title are required' }, { status: 400 })
  await pool.query('INSERT INTO jobs (id, workspace_id, title, description, stage, priority, hashtags, platform, live_url, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [id, workspaceId, title, description, stage, priority, hashtags, platform, liveUrl, notes])
  return NextResponse.json({ ok: true, id })
}
