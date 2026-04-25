import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession, requireAdmin } from '@/lib/auth'

const ALLOWED_KEYS = [
  'app.name',
  'app.companyName',
  'app.logoUrl',
  'app.accentColor',
  'jobs.defaultPlatform',
  'jobs.defaultStage',
  'jobs.defaultSort',
  'jobs.archivedVisibility',
] as const

const UpdateSettingInput = z.object({
  key: z.enum(ALLOWED_KEYS),
  value: z.string().nullable(),
})

const BulkUpdateInput = z.array(UpdateSettingInput).min(1).max(50)

/** GET /api/settings — anyone signed in can read settings (for branding /
 * default-value resolution in the UI). */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const result = await pool.query('SELECT key, value, updated_at FROM app_settings')
  const map: Record<string, string | null> = {}
  for (const row of result.rows) {
    map[String(row.key)] = row.value == null ? null : String(row.value)
  }
  return NextResponse.json(map)
}

/** PUT /api/settings — admin only. Accepts either a single
 * { key, value } object or an array of them for bulk updates.
 *
 * Uses INSERT ... ON CONFLICT so callers don't need to know whether
 * a key exists yet — the same payload handles create-or-update. */
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Accept single or array.
  const updates = Array.isArray(body)
    ? BulkUpdateInput.safeParse(body)
    : (() => {
        const single = UpdateSettingInput.safeParse(body)
        return single.success ? { success: true as const, data: [single.data] } : single
      })()

  if (!updates.success) {
    return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 })
  }

  await ensureSchema()

  // Use a single transaction so a partial bulk update is rolled back.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const u of updates.data) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [u.key, u.value]
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
