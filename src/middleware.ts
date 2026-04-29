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
// Real cryptographic verification (and ROLE-based redirects, which are
// new in Round 7.11) happen inside each API route and inside the
// protected pages via `getSession()` from `src/lib/auth.ts` (which runs
// in the Node runtime). So:
//   - middleware: "is there ANY session cookie?" → if not, redirect/401
//   - page-level: "is this session a briefer trying to access /app?"
//     → server component does redirect to /briefer
//   - api-level: "is this session allowed to do this thing?"
//     → permission helpers in lib/permissions.ts decide
//
// Round 7.11 additions:
//   - /briefer is now a protected prefix (briefer's home)
//   - /api/auth/set-display-name added to PUBLIC_API_PREFIXES is WRONG
//     — that endpoint REQUIRES a valid session — so it stays under
//     PROTECTED_PREFIXES (specifically: anything under /api/auth that's
//     not login/logout is protected)

const PROTECTED_PREFIXES = [
  '/app',
  '/calendar',
  '/reports',
  '/settings',
  '/briefer',
  '/api/workspaces',
  '/api/jobs',
  '/api/users',
  '/api/settings',
  '/api/auth/me',
  '/api/auth/set-display-name',
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
    '/briefer/:path*',
    '/api/workspaces/:path*',
    '/api/jobs/:path*',
    '/api/users/:path*',
    '/api/settings/:path*',
    '/api/auth/me',
    '/api/auth/set-display-name',
  ],
}
