import { redirect } from 'next/navigation'
import { getSession } from './auth'

/**
 * Round 7.11 — server-side role guard.
 *
 * Used by the staff page components (/app, /calendar, /reports,
 * /settings) to redirect briefers away to /briefer. Middleware
 * runs in the Edge runtime which can't decode JWT, so role-based
 * routing has to happen at the page level (Node runtime) where
 * we can verify the session.
 *
 * Behaviour:
 *   - No session: redirect to /login (defence in depth — middleware
 *     should catch this first)
 *   - Briefer session: redirect to /briefer (their home)
 *   - Staff session (admin/member): return — page renders normally
 *
 * Usage (in a page.tsx):
 *
 *   export default async function AppHome() {
 *     await requireStaffPage()
 *     return <AppShell />
 *   }
 */
export async function requireStaffPage(): Promise<void> {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }
  if (session.role === 'briefer') {
    redirect('/briefer')
  }
}

/**
 * Inverse guard: ensure the session is a briefer. Used by
 * /briefer pages to redirect staff (who land there by mistake)
 * back to /app.
 */
export async function requireBrieferPage(): Promise<void> {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }
  if (session.role !== 'briefer') {
    redirect('/app')
  }
}
