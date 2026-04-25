import { NextRequest, NextResponse } from 'next/server'
import { ensureSchema, pool } from '@/lib/postgres'
import { isAdminAuthenticated } from '@/lib/session'
import { randomUUID } from 'crypto'

export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const result = await pool.query('SELECT id, owner_id, name, color, sort_order, created_at, updated_at FROM workspaces ORDER BY sort_order ASC, created_at ASC')
  return NextResponse.json(result.rows)
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await ensureSchema()
  const body = await req.json()
  const id = randomUUID()
  const name = String(body.name || '').trim()
  const color = String(body.color || '#8b5cf6').trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  await pool.query('INSERT INTO workspaces (id, owner_id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)', [id, 'admin', name, color, 0])
  return NextResponse.json({ ok: true, id })
}
