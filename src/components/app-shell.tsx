"use client"

import { useEffect, useMemo, useState } from 'react'
import { KanbanBoard } from '@/components/kanban-board'
import { JobListView } from '@/components/job-list-view'
import { ViewToggle, type JobView } from '@/components/view-toggle'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { DashboardWidgets, type WidgetKey } from '@/components/dashboard-widgets'
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

  // ---------- view + filters ----------
  const [view, setView] = useState<JobView>('kanban')
  const [filter, setFilter] = useState<JobFilterState>(DEFAULT_FILTER_STATE)
  const [sort, setSort] = useState<SortKey>('newest')
  const [activeWidget, setActiveWidget] = useState<WidgetKey | null>(null)

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

  // ---------- workspace mutations (called by HostedSidebar) ----------
  async function createWorkspace(name: string) {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: '#8b5cf6' }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to create workspace')
      return
    }
    await loadWorkspaces()
  }

  async function renameWorkspace(id: string, name: string) {
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to rename workspace')
      return
    }
    await loadWorkspaces()
  }

  async function deleteWorkspace(id: string) {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setErrorMessage('Failed to delete workspace')
      return
    }
    if (selectedWorkspaceId === id) setSelectedWorkspaceId('')
    await refreshAll()
  }

  async function reorderWorkspaces(orderedIds: string[]) {
    // Optimistic reorder — update the local state immediately so the
    // sidebar shows the new order while the API call is in flight.
    const prev = workspaces
    const byId = new Map(prev.map((w) => [w.id, w]))
    const reordered: Workspace[] = []
    for (const id of orderedIds) {
      const w = byId.get(id)
      if (w) reordered.push(w)
    }
    // Re-stamp sortOrder so any other consumer reading w.sortOrder gets
    // the new index without waiting for a refetch.
    setWorkspaces(reordered.map((w, i) => ({ ...w, sortOrder: i })))

    const res = await fetch('/api/workspaces/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
    if (!res.ok) {
      setWorkspaces(prev)
      setErrorMessage('Failed to reorder workspaces')
    }
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
        onCreateWorkspace={createWorkspace}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onReorderWorkspaces={reorderWorkspaces}
        onWorkspaceUpdated={(updated) => {
          // Round 6.4: the settings dialog returns the freshly-saved
          // workspace; splice it into our list. Avoids a refetch round-trip.
          setWorkspaces((prev) =>
            prev.map((w) => (w.id === updated.id ? updated : w)),
          )
        }}
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

        <DashboardWidgets 
          jobs={visibleJobs} 
          activeWidget={activeWidget}
          onSelectWidget={setActiveWidget}
        />

        <DashboardFilters
          filter={filter}
          setFilter={setFilter}
          sort={sort}
          setSort={setSort}
        />


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
