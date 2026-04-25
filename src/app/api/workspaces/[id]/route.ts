import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'
import { rowToWorkspace } from '@/lib/db-mappers'

const UpdateWorkspaceInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    color: z.string().trim().optional(),
    sortOrder: z.number().int().optional(),
    facebookPageUrl: z.string().trim().nullable().optional(),
    instagramPageUrl: z.string().trim().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UpdateWorkspaceInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 })
  }

  await ensureSchema()

  const fieldMap: Record<string, string> = {
    name: 'name',
    color: 'color',
    sortOrder: 'sort_order',
    facebookPageUrl: 'facebook_page_url',
    instagramPageUrl: 'instagram_page_url',
  }

  const sets: string[] = []
  const values: unknown[] = []
  let n = 1
  for (const [k, v] of Object.entries(parsed.data)) {
    const col = fieldMap[k]
    if (!col) continue
    sets.push(`${col} = $${n++}`)
    values.push(v)
  }
  sets.push(`updated_at = NOW()`)
  values.push(id)

  await pool.query(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = $${n}`, values)

  const result = await pool.query(
    `SELECT id, owner_id, name, color, sort_order, facebook_page_url, instagram_page_url, created_at, updated_at
     FROM workspaces WHERE id = $1`,
    [id]
  )
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, workspace: rowToWorkspace(result.rows[0]) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await ensureSchema()
  await pool.query('DELETE FROM workspaces WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
