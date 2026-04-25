export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Content Hub SaaS</p>
          <h1 className="text-5xl font-bold mt-2">Hosted Content Workflow Platform</h1>
          <p className="text-slate-300 mt-4 max-w-3xl">
            This is the new hosted foundation for Content Hub, intended to run at contenthub.missioncontroldb.online
            on the same VPS as Mission Control, but as a separate app.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">Planned first hosted scope</h2>
            <ul className="mt-4 space-y-2 text-slate-300 list-disc list-inside">
              <li>Account login</li>
              <li>Workspaces</li>
              <li>Content jobs</li>
              <li>Kanban dashboard</li>
              <li>Calendar shell</li>
              <li>Reports shell</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">Desktop features to rework for web</h2>
            <ul className="mt-4 space-y-2 text-slate-300 list-disc list-inside">
              <li>Tauri commands</li>
              <li>SQLite local persistence</li>
              <li>Local file path attachments</li>
              <li>Native file dialogs</li>
              <li>EXE-first deployment assumptions</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  )
}
