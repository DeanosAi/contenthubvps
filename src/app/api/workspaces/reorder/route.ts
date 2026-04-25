import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession } from '@/lib/auth'

const ReorderInput = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(200),
})

/**
 * POST /api/workspaces/reorder
 *
 * Bulk-update the `sort_order` of every workspace in `orderedIds` to its
 * position in the array (0-indexed). Done in a single transaction so the
 * sidebar never sees a partial reorder if the request fails mid-flight.
 *
 * Why a dedicated endpoint instead of N individual PATCH calls: a drag-drop
 * reorder of 6 workspaces would otherwise be 6 separate HTTP requests, each
 * with its own round-trip latency. One bulk endpoint = one round trip.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ReorderInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid reorder payload' }, { status: 400 })
  }

  await ensureSchema()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await client.query(
        'UPDATE workspaces SET sort_order = $1, updated_at = NOW() WHERE id = $2',
        [i, parsed.data.orderedIds[i]]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true })
}
