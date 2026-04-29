import { CalendarShell } from '@/components/calendar-shell'
import { requireStaffPage } from '@/lib/page-guards'

export default async function CalendarPage() {
  // Round 7.11: redirect briefers to /briefer.
  await requireStaffPage()
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <CalendarShell />
    </main>
  )
}
