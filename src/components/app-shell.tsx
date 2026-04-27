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
  /** When a dashboard widget drives the filter, we record which one so the
   * widget can render an "active" state. Setting filter via the filter bar
   * directly clears this. */
  const [activeWidget, setActiveWidget] = useState<WidgetKey | null>(null)

  // ---------- create-dialog state ----------
  const [createOpen, setCreateOpen] = useState(false)

  // ---------- batch-refresh state ----------
  /** When non-null, a workspace-wide metrics refresh is in progress.
   * `done` and `total` drive the progress UI in the header button. */
  const [refreshState, setRefreshState] = useState<
    { done: number; total: number; failures: number } | null
  >(null)

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

  /**
   * Refresh metrics for every posted job in the current workspace.
   *
   * Strategy: client-driven serial loop calling /api/jobs/:id/fetch-metrics
   * one job at a time. Why serial rather than parallel:
   *   - Apify charges per actor run regardless of concurrency, so there's
   *     no cost reason to parallelise.
   *   - Some Apify accounts have low concurrency limits — running 10 in
   *     parallel would queue most of them anyway.
   *   - Serial gives clean progress reporting: "12 of 47" feels right.
   *   - One failure doesn't poison the batch — we record the failure and
   *     continue.
   *
   * The user can navigate away mid-run; the loop checks the cancellation
   * flag between requests and exits cleanly. Already-completed snapshots
   * are kept (they were committed atomically), so partial progress isn't
   * lost.
   */
  async function refreshWorkspaceMetrics() {
    if (!selectedWorkspaceId) return
    if (refreshState) return // already running

    // Only posted jobs with a fetchable URL are eligible.
    const eligible = jobs.filter(
      (j) =>
        j.workspaceId === selectedWorkspaceId &&
        j.stage === 'posted' &&
        (j.facebookLiveUrl || j.instagramLiveUrl || j.liveUrl),
    )
    if (eligible.length === 0) {
      setErrorMessage(
        'No posted jobs with live URLs to refresh in this workspace.',
      )
      return
    }
    if (
      !confirm(
        `Refresh metrics for ${eligible.length} ${
          eligible.length === 1 ? 'job' : 'jobs'
        }? This may take a few minutes; you can keep using the app while it runs.`,
      )
    ) {
      return
    }

    setRefreshState({ done: 0, total: eligible.length, failures: 0 })
    let failures = 0
    for (let i = 0; i < eligible.length; i++) {
      const job = eligible[i]
      try {
        const res = await fetch(`/api/jobs/${job.id}/fetch-metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { job?: Job }
            | null
          if (data?.job) {
            const updated = data.job
            setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)))
          }
        } else {
          failures++
        }
      } catch {
        failures++
      }
      setRefreshState({ done: i + 1, total: eligible.length, failures })
    }

    // Surface a one-line summary.
    if (failures > 0) {
      setErrorMessage(
        `Refresh finished with ${failures} ${
          failures === 1 ? 'failure' : 'failures'
        }. Open individual jobs to retry.`,
      )
    }
    // Clear the in-progress state after a brief delay so the user can
    // see the final "47 of 47" before it disappears.
    setTimeout(() => setRefreshState(null), 1500)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  /** Translate a dashboard widget click into a JobFilterState. Each widget
   * corresponds to a filter preset:
   *
   *  - overdue: due before today, not posted/archived
   *  - dueThisWeek: due in next 7 days, not posted/archived
   *  - awaitingApproval: approval_status='awaiting'
   *  - recentlyPosted: stage='posted', updated in last 7 days
   *  - inFlight: not archived (this is the headline total — clears most filters)
   *
   * Some of these can't be expressed exactly with our current JobFilterState
   * (e.g. "approvalStatus" isn't a top-level filter field). We approximate
   * with the closest available controls — the kanban view will show the
   * intended bucket plus possibly a few near-misses that the user can
   * clear with the kanban filter bar. */
  function applyWidgetFilter(key: WidgetKey | null) {
    setActiveWidget(key)
    if (key === null) {
      setFilter(DEFAULT_FILTER_STATE)
      setSort('newest')
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const inSevenDays = new Date(today)
    inSevenDays.setDate(today.getDate() + 7)
    const inSevenIso = `${inSevenDays.getFullYear()}-${String(inSevenDays.getMonth() + 1).padStart(2, '0')}-${String(inSevenDays.getDate()).padStart(2, '0')}`

    switch (key) {
      case 'overdue':
        setFilter({
          ...DEFAULT_FILTER_STATE,
          dueTo: todayIso,
          hideArchived: true,
        })
        setSort('dueDateAsc')
        break
      case 'dueThisWeek':
        setFilter({
          ...DEFAULT_FILTER_STATE,
          dueFrom: todayIso,
          dueTo: inSevenIso,
          hideArchived: true,
        })
        setSort('dueDateAsc')
        break
      case 'awaitingApproval':
        // Round 5 adds a first-class approvalStatus field on JobFilterState,
        // so this widget now applies a precise filter rather than just
        // clearing all filters.
        setFilter({
          ...DEFAULT_FILTER_STATE,
          approvalStatus: 'awaiting',
          hideArchived: true,
        })
        setSort('newest')
        break
      case 'recentlyPosted':
        setFilter({
          ...DEFAULT_FILTER_STATE,
          stage: 'posted',
          hideArchived: false,
        })
        setSort('recentlyUpdated')
        break
      case 'inFlight':
        setFilter({ ...DEFAULT_FILTER_STATE, hideArchived: true })
        setSort('newest')
        break
    }
  }

  /** When the user changes filters via the filter bar, the widget-driven
   * "active" indicator is no longer accurate — clear it. */
  function setFilterFromBar(next: JobFilterState) {
    setFilter(next)
    setActiveWidget(null)
  }

  function setSortFromBar(next: SortKey) {
    setSort(next)
    setActiveWidget(null)
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

  /** Workspace-scoped jobs list, NOT filtered. The widgets compute counts
   * from this — we don't want the widgets to react to the filters they
   * themselves apply, otherwise applying "overdue" zeros out every other
   * widget. */
  const workspaceJobs = useMemo(() => {
    return selectedWorkspaceId
      ? jobs.filter((j) => j.workspaceId === selectedWorkspaceId)
      : jobs
  }, [jobs, selectedWorkspaceId])

  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)

  // ---------- render ----------
  /*
   * Round 7.1 layout — CSS grid with two columns.
   *
   *   ┌───────────┬─────────────────────────────────────────┐
   *   │           │  Header + actions                       │
   *   │  SIDEBAR  ├─────────────────────────────────────────┤
   *   │           │  Dashboard widgets                      │
   *   │           ├─────────────────────────────────────────┤
   *   │           │  Filters (priority/approval/sort)       │
   *   ├───────────┴─────────────────────────────────────────┤
   *   │  Kanban / list view (full width)                    │
   *   └─────────────────────────────────────────────────────┘
   *
   * The sidebar's height naturally matches the right column's content.
   * The kanban row uses `col-span-2` so it extends from the sidebar's
   * left edge all the way to the right edge of the page — no wrapping,
   * no floats, no JS-driven height calculations.
   *
   * Internal scroll on the workspace list inside the sidebar (handled
   * inside HostedSidebar) keeps the sidebar from growing if there are
   * many workspaces.
   */
  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6 max-w-[1600px] mx-auto">
        <HostedSidebar
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={setSelectedWorkspaceId}
          onCreateWorkspace={createWorkspace}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onReorderWorkspaces={reorderWorkspaces}
          onWorkspaceUpdated={(updated) => {
            // Round 6.4: settings dialog returns the saved workspace;
            // splice into local state without a refetch round-trip.
            setWorkspaces((prev) =>
              prev.map((w) => (w.id === updated.id ? updated : w)),
            )
          }}
          onWorkspaceCreated={(created) => {
            // Round 7.1: the new workspace creation modal returns the
            // freshly-created workspace. Append to the list and select it
            // so the user lands on it ready to add jobs.
            setWorkspaces((prev) => [...prev, created])
            setSelectedWorkspaceId(created.id)
          }}
        />

        {/* Row 1, Col 2 — header + widgets + filters. Determines the
            sidebar's height. */}
        <div className="space-y-4 min-w-0">
          <section className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              {/* Round 7.1: removed the "Hosted Content Hub" eyebrow and
                 the "Select or create a workspace…" subtitle. The
                 workspace name now sits next to the Dashboard title as
                 a colored badge so the page still tells you which
                 workspace you're viewing. */}
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
                {activeWorkspace && (
                  <span
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium border border-slate-200 bg-white text-slate-700"
                    title="Currently selected workspace"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: activeWorkspace.color }}
                    />
                    {activeWorkspace.name}
                  </span>
                )}
              </div>
              {!activeWorkspace && !loading && (
                <p className="text-slate-600 text-sm mt-2">
                  Select a workspace from the sidebar to get started.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setCreateOpen(true)}
                disabled={!selectedWorkspaceId}
                title={!selectedWorkspaceId ? 'Select a workspace first' : undefined}
              >
                + New job
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors px-4 py-2 text-sm disabled:opacity-50"
                onClick={refreshWorkspaceMetrics}
                disabled={!selectedWorkspaceId || refreshState != null}
                title={
                  !selectedWorkspaceId
                    ? 'Select a workspace first'
                    : 'Fetch latest metrics from Apify for every posted job in this workspace'
                }
              >
                {refreshState
                  ? `Refreshing ${refreshState.done}/${refreshState.total}…`
                  : 'Refresh metrics'}
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors px-4 py-2 text-sm"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          </section>

          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
              <span>{errorMessage}</span>
              <button className="text-xs underline" onClick={() => setErrorMessage(null)}>
                Dismiss
              </button>
            </div>
          )}

          <DashboardWidgets
            jobs={workspaceJobs}
            activeWidget={activeWidget}
            onSelectWidget={applyWidgetFilter}
          />

          <DashboardFilters
            filter={filter}
            setFilter={setFilterFromBar}
            sort={sort}
            setSort={setSortFromBar}
          />
        </div>

        {/* Row 2 — kanban / list view, full width below the sidebar */}
        <section className="col-span-2 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                {view === 'kanban' ? 'Kanban' : 'All jobs'}
              </h2>
              <p className="text-slate-600 text-sm mt-1">
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
      </div>

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
