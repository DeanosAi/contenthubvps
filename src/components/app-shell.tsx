"use client"

import { useEffect, useMemo, useState } from 'react'
import { KanbanBoard } from '@/components/kanban-board'
import { JobListView } from '@/components/job-list-view'
import { ViewToggle, type JobView } from '@/components/view-toggle'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { DashboardStats } from '@/components/dashboard-stats'
import { DashboardFilters } from '@/components/dashboard-filters'
import { JobDetailPanel } from '@/components/job-detail-panel'
import { JobCreateDialog } from '@/components/job-create-dialog'
import {
  applyJobView,
  DEFAULT_FILTER_STATE,
  type JobFilterState,
  type SortKey,
} from '@/lib/job-filters'
import type { Job, JobStage, Workspace } from '@/lib/types'

export function AppShell() {
  // ---------- top-level data ----------
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)

  // ---------- workspace creation/edit (kept from Round 1) ----------
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string>('')
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('')

  // ---------- view + filters ----------
  const [view, setView] = useState<JobView>('kanban')
  const [filter, setFilter] = useState<JobFilterState>(DEFAULT_FILTER_STATE)
  const [sort, setSort] = useState<SortKey>('newest')

  // ---------- create-dialog state ----------
  const [createOpen, setCreateOpen] = useState(false)

  // ---------- async UX ----------
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // The API returns camelCase, fully-shaped Job/Workspace objects — no
  // inline mapping needed.

  async function loadWorkspaces(): Promise<Workspace[]> {
    const res = await fetch('/api/workspaces')
    if (!res.ok) {
      setErrorMessage('Failed to load workspaces')
      return []
    }
    const data: Workspace[] = await res.json()
    setWorkspaces(data)
    return data
  }

  async function loadJobs(workspaceId?: string) {
    const url = workspaceId
      ? `/api/jobs?workspaceId=${encodeURIComponent(workspaceId)}`
      : '/api/jobs'
    const res = await fetch(url)
    if (!res.ok) {
      setErrorMessage('Failed to load jobs')
      return
    }
    const data: Job[] = await res.json()
    setJobs(data)
  }

  // First load: pull workspaces, default to the first one if nothing selected.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const ws = await loadWorkspaces()
      if (cancelled) return
      const initial = selectedWorkspaceId || ws[0]?.id || ''
      if (initial && initial !== selectedWorkspaceId) {
        setSelectedWorkspaceId(initial)
      } else if (initial) {
        await loadJobs(initial)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only run on mount — workspace changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedWorkspaceId) void loadJobs(selectedWorkspaceId)
  }, [selectedWorkspaceId])

  // If the currently selected job gets deleted (or its workspace
  // disappears), close the side panel so we don't show stale data.
  useEffect(() => {
    if (!selectedJob) return
    const stillExists = jobs.some((j) => j.id === selectedJob.id)
    if (!stillExists) setSelectedJob(null)
  }, [jobs, selectedJob])

  async function refreshAll() {
    const ws = await loadWorkspaces()
    if (selectedWorkspaceId && !ws.some((w) => w.id === selectedWorkspaceId)) {
      // Selected workspace was deleted somewhere else; pick a new default.
      setSelectedWorkspaceId(ws[0]?.id ?? '')
    } else if (selectedWorkspaceId) {
      await loadJobs(selectedWorkspaceId)
    }
  }

  // ---------- workspace mutations ----------
  async function createWorkspace() {
    if (!newWorkspaceName.trim()) return
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newWorkspaceName, color: '#8b5cf6' }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to create workspace')
      return
    }
    setNewWorkspaceName('')
    await loadWorkspaces()
  }

  async function updateWorkspace(id: string) {
    if (!editingWorkspaceName.trim()) return
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editingWorkspaceName }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to update workspace')
      return
    }
    setEditingWorkspaceId('')
    setEditingWorkspaceName('')
    await loadWorkspaces()
  }

  async function deleteWorkspace(id: string) {
    if (!confirm('Delete this workspace and all of its jobs?')) return
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setErrorMessage('Failed to delete workspace')
      return
    }
    if (selectedWorkspaceId === id) setSelectedWorkspaceId('')
    await refreshAll()
  }

  // ---------- job mutations driven from kanban drag-drop ----------
  async function moveJob(jobId: string, newStage: JobStage) {
    // Optimistic update — flip the stage locally first so the card
    // doesn't snap back during the network round-trip. If the PATCH
    // fails we revert and surface an error.
    const prev = jobs
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, stage: newStage } : j)))

    let res: Response
    try {
      res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      })
    } catch {
      setJobs(prev)
      setErrorMessage('Failed to move job (network error)')
      return
    }
    if (!res.ok) {
      setJobs(prev)
      setErrorMessage('Failed to move job')
      return
    }
    const data = await res.json().catch(() => null)
    // If the server returned the canonical job, prefer that — keeps the
    // updatedAt timestamp accurate.
    if (data?.job) {
      const updated = data.job as Job
      setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)))
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  // ---------- derived data ----------
  // Apply workspace filter first (the filter state doesn't include
  // workspace — it's an outer constraint), then run filters/sort.
  const visibleJobs = useMemo(() => {
    const inWorkspace = selectedWorkspaceId
      ? jobs.filter((j) => j.workspaceId === selectedWorkspaceId)
      : jobs
    return applyJobView(inWorkspace, filter, sort)
  }, [jobs, selectedWorkspaceId, filter, sort])

  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)

  // ---------- render ----------
  return (
    <div className="flex min-h-screen">
      <HostedSidebar
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
      />

      <main className="flex-1 p-8 space-y-8">
        <section className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">
              Hosted Content Hub
            </p>
            <h1 className="text-4xl font-bold mt-2">Dashboard</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-3 max-w-3xl">
              {activeWorkspace
                ? `Currently viewing ${activeWorkspace.name}.`
                : loading
                ? 'Loading workspaces…'
                : 'Select or create a workspace to manage content jobs.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-50"
              onClick={() => setCreateOpen(true)}
              disabled={!selectedWorkspaceId}
              title={!selectedWorkspaceId ? 'Select a workspace first' : undefined}
            >
              + New job
            </button>
            <button
              className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))]"
              onClick={logout}
            >
              Log out
            </button>
          </div>
        </section>

        {errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button className="text-xs underline" onClick={() => setErrorMessage(null)}>
              Dismiss
            </button>
          </div>
        )}

        <DashboardStats jobs={visibleJobs} />

        <DashboardFilters
          filter={filter}
          setFilter={setFilter}
          sort={sort}
          setSort={setSort}
        />

        {/* Workspace picker / management — kept from Round 1, lives below
            the filter bar so the kanban is the visual focus of the page. */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Workspaces
            </h2>
            <div className="flex gap-2">
              <input
                className="rounded-lg border bg-transparent px-3 py-1.5 text-sm"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="New workspace name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createWorkspace()
                }}
              />
              <button
                className="rounded-lg border px-3 py-1.5 text-sm"
                onClick={createWorkspace}
                disabled={!newWorkspaceName.trim()}
              >
                Add
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`rounded-xl border px-4 py-3 min-w-56 ${
                  selectedWorkspaceId === workspace.id
                    ? 'bg-[hsl(var(--accent))] ring-1 ring-[hsl(var(--primary))]/40'
                    : 'bg-[hsl(var(--card))]'
                }`}
              >
                {editingWorkspaceId === workspace.id ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg border bg-transparent px-3 py-2"
                      value={editingWorkspaceName}
                      onChange={(e) => setEditingWorkspaceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void updateWorkspace(workspace.id)
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        className="rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-[hsl(var(--primary-foreground))] text-sm font-semibold"
                        onClick={() => updateWorkspace(workspace.id)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded-lg border px-3 py-2 text-sm"
                        onClick={() => setEditingWorkspaceId('')}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setSelectedWorkspaceId(workspace.id)} className="w-full text-left">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: workspace.color }}
                        />
                        <span className="font-medium">{workspace.name}</span>
                      </div>
                    </button>
                    <div className="flex gap-2 mt-3">
                      <button
                        className="text-xs text-[hsl(var(--primary))]"
                        onClick={() => {
                          setEditingWorkspaceId(workspace.id)
                          setEditingWorkspaceName(workspace.name)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="text-xs text-red-400"
                        onClick={() => deleteWorkspace(workspace.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Kanban / list view */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">
                {view === 'kanban' ? 'Kanban' : 'All jobs'}
              </h2>
              <p className="text-[hsl(var(--muted-foreground))] text-sm mt-1">
                {visibleJobs.length} {visibleJobs.length === 1 ? 'job' : 'jobs'} shown
              </p>
            </div>
            <ViewToggle value={view} onChange={setView} />
          </div>

          {view === 'kanban' ? (
            <KanbanBoard
              jobs={visibleJobs}
              onSelectJob={setSelectedJob}
              onMoveJob={moveJob}
            />
          ) : (
            <JobListView
              jobs={visibleJobs}
              workspaces={workspaces}
              onSelectJob={setSelectedJob}
            />
          )}
        </section>
      </main>

      <JobDetailPanel
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onSaved={(updated) => {
          // Replace the job in local state with the server's canonical
          // version. Keeps the UI in sync without re-fetching the whole
          // workspace.
          setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)))
          setSelectedJob(updated)
        }}
        onDeleted={async () => {
          if (selectedJob) {
            setJobs((js) => js.filter((j) => j.id !== selectedJob.id))
          }
          setSelectedJob(null)
        }}
      />

      <JobCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaces={workspaces}
        defaultWorkspaceId={selectedWorkspaceId}
        onCreated={(newJob) => {
          // Prepend the new job so it appears at the top of the list/kanban
          // immediately. The server's ORDER BY created_at DESC matches.
          setJobs((js) => [newJob, ...js])
        }}
      />
    </div>
  )
}
