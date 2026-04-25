export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8 text-center">
      <div className="max-w-3xl space-y-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--primary))]">Content Hub SaaS</p>
          <h1 className="text-5xl font-bold mt-2">Hosted Content Workflow Platform</h1>
          <p className="text-[hsl(var(--muted-foreground))] mt-4">
            The hosted web version of Content Hub is now live on the VPS. This product is being shaped to match the desktop Content Hub design language, not Mission Control.
          </p>
        </div>

        <div className="rounded-2xl border bg-[hsl(var(--card))] p-6 text-left">
          <h2 className="text-xl font-semibold">Current hosted MVP scope</h2>
          <ul className="mt-4 space-y-2 text-[hsl(var(--muted-foreground))] list-disc list-inside">
            <li>Login flow</li>
            <li>Workspace creation</li>
            <li>Job creation</li>
            <li>Kanban dashboard</li>
            <li>Basic edit/delete actions</li>
          </ul>
        </div>

        <a href="/login" className="inline-flex rounded-lg bg-[hsl(var(--primary))] px-5 py-3 font-semibold text-[hsl(var(--primary-foreground))]">Open Login</a>
      </div>
    </main>
  )
}
