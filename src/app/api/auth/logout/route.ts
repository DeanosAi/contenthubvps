import { NextResponse } from 'next/server'
import { clearAdminAuthenticated } from '@/lib/session'

export async function POST() {
  await clearAdminAuthenticated()
  return NextResponse.json({ ok: true })
}
