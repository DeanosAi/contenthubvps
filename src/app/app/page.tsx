import { AppShell } from '@/components/app-shell'

export default function AppHome() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-cyan-400">Hosted App Area</p>
            <h1 className="text-4xl font-bold mt-2">Content Hub SaaS</h1>
            <p className="text-slate-300 mt-3 max-w-3xl">
              First hosted MVP with a simple admin login and a Postgres-backed API layer for workspaces and jobs.
            </p>
          </div>
        </div>

        <AppShell />
      </div>
    </main>
  )
}
