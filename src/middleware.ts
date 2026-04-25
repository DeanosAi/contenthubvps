import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const protectedPath = req.nextUrl.pathname.startsWith('/app') || req.nextUrl.pathname.startsWith('/api/workspaces') || req.nextUrl.pathname.startsWith('/api/jobs')
  if (!protectedPath) return NextResponse.next()

  const isAuthed = req.cookies.get('contenthub_admin')?.value === '1'
  if (isAuthed) return NextResponse.next()

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/app/:path*', '/api/workspaces/:path*', '/api/jobs/:path*'],
}
