import { SettingsShell } from '@/components/settings-shell'
import { requireStaffPage } from '@/lib/page-guards'

export default async function SettingsPage() {
  // Round 7.11: redirect briefers to /briefer.
  await requireStaffPage()
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <SettingsShell />
    </main>
  )
}
