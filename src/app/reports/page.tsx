import { ReportsShell } from '@/components/reports-shell'
import { requireStaffPage } from '@/lib/page-guards'

export default async function ReportsPage() {
  // Round 7.11: redirect briefers to /briefer.
  await requireStaffPage()
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <ReportsShell />
    </main>
  )
}
