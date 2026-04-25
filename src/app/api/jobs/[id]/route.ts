import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema, pool } from '@/lib/postgres'
import { isAdminAuthenticated } from '@/lib/session'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id } = await params
  const body = await req.json()
  await pool.query(
    'UPDATE jobs SET title = $1, description = $2, stage = $3, priority = $4, hashtags = $5, updated_at = NOW() WHERE id = $6',
    [String(body.title || '').trim(), body.description ? String(body.description) : null, String(body.stage || 'brief'), Number(body.priority || 0), body.hashtags ? String(body.hashtags) : null, id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id } = await params
  await pool.query('DELETE FROM jobs WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
