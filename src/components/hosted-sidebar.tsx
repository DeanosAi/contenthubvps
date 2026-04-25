"use client"

import type { Workspace } from '@/lib/types'

export function HostedSidebar({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  workspaces: Workspace[]
  selectedWorkspaceId: string
  onSelectWorkspace: (id: string) => void
}) {
  return (
    <aside className="w-72 border-r bg-[hsl(var(--card))] flex flex-col">
      <div className="p-4 border-b flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-[hsl(var(--primary))]/15 flex items-center justify-center">
          <div className="h-4 w-4 rounded bg-[hsl(var(--primary))]" />
        </div>
        <h1 className="text-xl font-bold">Content Hub</h1>
      </div>

      <div className="p-4 border-b">
        <nav className="space-y-2 text-sm">
          <div className="rounded-md bg-[hsl(var(--accent))] px-3 py-2">Dashboard</div>
          <div className="rounded-md px-3 py-2 text-[hsl(var(--muted-foreground))]">Calendar</div>
          <div className="rounded-md px-3 py-2 text-[hsl(var(--muted-foreground))]">Reports</div>
          <div className="rounded-md px-3 py-2 text-[hsl(var(--muted-foreground))]">Settings</div>
        </nav>
      </div>

      <div className="p-4 space-y-3 flex-1 overflow-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Workspaces</p>
        <div className="space-y-2">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left transition-colors ${selectedWorkspaceId === workspace.id ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'hover:bg-[hsl(var(--accent))]/50'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: workspace.color }} />
              <span className="truncate">{workspace.name}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
