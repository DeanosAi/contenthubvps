import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// IMPORTANT: this middleware runs in the Next.js Edge runtime, which does
// not have access to Node's `crypto` module. Cryptographic JWT verification
// (which depends on `jsonwebtoken` / Node crypto) cannot be done here.
//
// What we do instead: only check whether a session cookie EXISTS. That's
// enough to redirect unauthenticated users to /login and prevent the
// flash-of-protected-page on the way.
//
// Real cryptographic verification happens inside each API route and inside
// the protected pages via `getSession()` from `src/lib/auth.ts` (which runs
// in the Node runtime). So a forged or stale cookie will pass middleware
// but fail at the API/route level — exactly the right defense layer.

const PROTECTED_PREFIXES = [
  '/app',
  '/calendar',
  '/reports',
  '/settings',
  '/api/workspaces',
  '/api/jobs',
  '/api/users',
  '/api/settings',
]

const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
]

const SESSION_COOKIE = 'contenthub_session'

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  if (PUBLIC_API_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next()
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')
  )
  if (!isProtected) return NextResponse.next()

  // Cookie presence check — the existence of a non-empty value is enough
  // to let the request through. The downstream route then does the real
  // jwt.verify() in Node.
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token && token.length > 0) return NextResponse.next()

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', path)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/app/:path*',
    '/calendar/:path*',
    '/reports/:path*',
    '/settings/:path*',
    '/api/workspaces/:path*',
    '/api/jobs/:path*',
    '/api/users/:path*',
    '/api/settings/:path*',
  ],
}
