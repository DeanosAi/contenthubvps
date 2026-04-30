import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pool, ensureSchema } from '@/lib/postgres'
import { getSession, hashPassword, requireAdmin } from '@/lib/auth'
import { rowToUser } from '@/lib/db-mappers'

/**
 * Round 7.11 — accepts the new `briefer` role with a required
 * `workspaceId`. The role validation enforces:
 *   - admin/member: workspaceId must be NULL/absent
 *   - briefer: workspaceId is required and must reference an
 *     existing workspace
 *
 * This invariant matches the schema (briefer-without-workspace is
 * a misconfigured account) and the assertions in lib/permissions.ts.
 */
const CreateUserInput = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8),
  name: z.string().trim().optional(),
  role: z.enum(['admin', 'member', 'briefer']).optional(),
  workspaceId: z.string().nullable().optional(),
})

/** GET /api/users — list users.
 *
 * Visibility rules (Round 7.11 update):
 *  - admins see everyone (used by the user-management UI)
 *  - members see a name+email-only slim list (assignee dropdown)
 *  - briefers see ONLY themselves — they cannot enumerate other
 *    briefers, staff, or anyone else
 *
 * We never return password hashes.
 */
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()

  // Round 7.14: admins call /api/users from two places:
  //   - user management UI: needs ALL users including briefers
  //   - dashboard assignee dropdown: needs only assignable users
  //     (admin + member, NOT briefer — briefers don't do production)
  // The dropdown caller passes ?for=assignee to get the filtered list.
  const forAssignee = new URL(req.url).searchParams.get('for') === 'assignee'

  // Briefer scoping — return only their own user record.
  if (session.role === 'briefer') {
    const result = await pool.query(
      'SELECT id, email, name, role, workspace_id, created_at, updated_at FROM users WHERE id = $1',
      [session.userId],
    )
    return NextResponse.json(result.rows.map(rowToUser))
  }

  const result = await pool.query(
    'SELECT id, email, name, role, workspace_id, created_at, updated_at FROM users ORDER BY created_at ASC'
  )
  const users = result.rows.map(rowToUser)

  if (session.role === 'admin') {
    // Round 7.14: admins see ALL users in the user-management UI
    // (need to manage briefers there) but the assignee dropdown
    // for the dashboard pulls from this same endpoint and should
    // exclude briefers. Resolve via a query param: when ?for=assignee
    // is present, return the slim non-briefer list; otherwise return
    // the full list for admin user management.
    if (forAssignee) {
      return NextResponse.json(
        users
          .filter((u) => u.role !== 'briefer')
          .map((u) => ({ id: u.id, email: u.email, name: u.name }))
      )
    }
    return NextResponse.json(users)
  }
  // Members get the slim list (used for assignee dropdowns).
  // Round 7.11: filter out briefers here too — staff don't assign
  // jobs to briefers, only to themselves and each other.
  return NextResponse.json(
    users
      .filter((u) => u.role !== 'briefer')
      .map((u) => ({ id: u.id, email: u.email, name: u.name }))
  )
}

/** POST /api/users — create a new user. Admin only. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = CreateUserInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Email, name, and a password of at least 8 characters are required' },
      { status: 400 }
    )
  }

  // Round 7.11: validate role + workspaceId combination.
  const role = parsed.data.role ?? 'member'
  const workspaceId = parsed.data.workspaceId ?? null

  if (role === 'briefer') {
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Briefer accounts must be bound to a workspace (venue).' },
        { status: 400 }
      )
    }
  } else {
    if (workspaceId) {
      return NextResponse.json(
        { error: 'Only briefer accounts can be bound to a workspace.' },
        { status: 400 }
      )
    }
  }

  await ensureSchema()

  // Validate workspace exists if provided.
  if (workspaceId) {
    const ws = await pool.query<{ id: string }>('SELECT id FROM workspaces WHERE id = $1', [workspaceId])
    if (ws.rows.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 400 })
    }
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [parsed.data.email])
  if (existing.rows.length > 0) {
    return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 })
  }

  const id = randomUUID()
  const hash = await hashPassword(parsed.data.password)
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, role, workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, parsed.data.email, hash, parsed.data.name ?? null, role, workspaceId]
  )

  return NextResponse.json({ ok: true, id })
}
