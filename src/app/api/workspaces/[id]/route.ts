import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema, pool } from '@/lib/postgres'
import { isAdminAuthenticated } from '@/lib/session'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id } = await params
  const body = await req.json()
  const name = String(body.name || '').trim()
  const color = String(body.color || '#8b5cf6').trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  await pool.query('UPDATE workspaces SET name = $1, color = $2, updated_at = NOW() WHERE id = $3', [name, color, id])
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id } = await params
  await pool.query('DELETE FROM workspaces WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
