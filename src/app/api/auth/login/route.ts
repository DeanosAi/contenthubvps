import { NextRequest, NextResponse } from 'next/server'
import { setAdminAuthenticated } from '@/lib/session'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const email = String(body.email || '')
  const password = String(body.password || '')

  if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  await setAdminAuthenticated()
  return NextResponse.json({ ok: true })
}
