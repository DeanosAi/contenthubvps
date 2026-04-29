import { AppShell } from '@/components/app-shell'
import { requireStaffPage } from '@/lib/page-guards'

export default async function AppHome() {
  // Round 7.11: redirect briefers to /briefer.
  await requireStaffPage()
  return <AppShell />
}
