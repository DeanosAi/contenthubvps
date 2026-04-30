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
import type { Job, KanbanColumn, Workspace } from '@/lib/types'
import { useUsers } from '@/lib/use-users'

/**
 * Round 7.13: format the "Updated N min ago" indicator next to
 * the refresh button. Returns a short, scannable string.
 *
 * Buckets:
 *   - <10 seconds: "just now"
 *   - <60 seconds: "<N>s ago"
 *   - <60 minutes: "<N>m ago"
 *   - <24 hours:   "<N>h ago"
 *   - older:       a date stamp
 *
 * Tight ranges keep the indicator visually punchy. We don't need
 * "1 minute ago" full-words — the indicator is supplementary, not
 * the headline copy.
 */
function formatRelativeTime(stampMs: number | null, nowMs: number): string {
  if (stampMs == null) return '—'
  const diffSec = Math.max(0, Math.floor((nowMs - stampMs) / 1000))
  if (diffSec < 10) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return new Date(stampMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

export function AppShell() {
  // ---------- top-level data ----------
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  /** Round 7.2b: per-workspace kanban column config. Loaded
   *  whenever the selected workspace changes. The kanban,
   *  dashboard filters, list view, and detail panel all consume
   *  this for their stage rendering. */
  const [columns, setColumns] = useState<KanbanColumn[]>([])
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

  /**
   * Round 7.13: timestamp of the last successful data refresh.
   * Updated by the initial load, the workspace-change reload,
   * and the new tab-focus / manual refresh paths. Powers the
   * "Updated N min ago" indicator next to the refresh button.
   *
   * `refreshTick` is a counter that increments on a 30-second
   * interval to force the indicator to re-render — without it,
   * "Updated 1 min ago" would stay frozen at "1 min ago" forever
   * because the underlying timestamp doesn't change between
   * refreshes.
   */
  const [lastDataRefreshAt, setLastDataRefreshAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [, setRefreshTick] = useState(0)

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
    // Round 7.13: mark this as the latest data-refresh moment.
    // Used by the "Updated N min ago" indicator near the refresh
    // button so the user has a sense of how fresh the view is.
    setLastDataRefreshAt(Date.now())
  }

  /** Round 7.2b: load the per-workspace kanban column config.
   *  Failures are non-fatal — we surface an error but the UI degrades
   *  gracefully (kanban shows an empty state, list view shows raw
   *  stage_keys as fallback labels). */
  async function loadColumns(workspaceId: string) {
    if (!workspaceId) {
      setColumns([])
      return
    }
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/columns`,
    )
    if (!res.ok) {
      setErrorMessage('Failed to load kanban columns')
      return
    }
    const data: KanbanColumn[] = await res.json()
    setColumns(data)
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
        await Promise.all([loadJobs(initial), loadColumns(initial)])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only run on mount — workspace changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Workspace change: load both jobs and columns.
  useEffect(() => {
    if (selectedWorkspaceId) {
      void loadJobs(selectedWorkspaceId)
      void loadColumns(selectedWorkspaceId)
    }
  }, [selectedWorkspaceId])

  // If the currently selected job gets deleted (or its workspace
  // disappears), close the side panel so we don't show stale data.
  useEffect(() => {
    if (!selectedJob) return
    const stillExists = jobs.some((j) => j.id === selectedJob.id)
    if (!stillExists) setSelectedJob(null)
  }, [jobs, selectedJob])

  /**
   * Round 7.13: refresh data on demand or when the tab regains
   * focus. Reloads workspaces (a teammate may have created or
   * renamed one) AND the current workspace's jobs (status updates,
   * comments, edits made elsewhere).
   *
   * NOT a polling loop — that wastes bandwidth for the 95% of the
   * time nothing changed. Tab focus is when user attention is
   * actually back on the page; that's the right moment.
   */
  async function refreshData() {
    if (refreshing) return // de-dupe rapid focus events
    setRefreshing(true)
    try {
      const ws = await loadWorkspaces()
      if (selectedWorkspaceId && !ws.some((w) => w.id === selectedWorkspaceId)) {
        // Workspace was deleted from elsewhere — fall back to first
        // remaining one. The downstream useEffect on workspace change
        // will trigger jobs/columns reload.
        setSelectedWorkspaceId(ws[0]?.id ?? '')
      } else if (selectedWorkspaceId) {
        await loadJobs(selectedWorkspaceId)
      }
    } finally {
      setRefreshing(false)
    }
  }

  /**
   * Round 7.13: re-fetch data when the browser tab regains focus.
   * Skipping this on `loading` (initial-load path already running)
   * avoids a double-fetch race on first mount.
   */
  useEffect(() => {
    function onFocus() {
      if (loading) return
      void refreshData()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // refreshData is recreated on every render but we don't want this
    // useEffect to recreate the listener constantly. The listener
    // closes over the fresh refreshData each call via React's render
    // semantics — no stale-closure issue here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedWorkspaceId, refreshing])

  /**
   * Round 7.13: tick the "Updated N min ago" indicator forward
   * every 30 seconds, so the displayed text drifts naturally
   * (1 min ago → 2 min ago → ...). Without this, the text would
   * stay frozen until the next actual refresh.
   */
  useEffect(() => {
    if (lastDataRefreshAt == null) return
    const interval = window.setInterval(() => {
      setRefreshTick((t) => t + 1)
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [lastDataRefreshAt])

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
  async function moveJob(jobId: string, newStage: string) {
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
  // Round 7.13: pull users to support the new "Sort by Assignee"
  // option which needs to resolve user IDs to names.
  const { users } = useUsers()
  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of users) {
      map.set(u.id, u.name || u.email)
    }
    return (id: string): string | null => map.get(id) ?? null
  }, [users])
  const sortOptions = useMemo(() => ({ userNameById }), [userNameById])

  const visibleJobs = useMemo(() => {
    const inWorkspace = selectedWorkspaceId
      ? jobs.filter((j) => j.workspaceId === selectedWorkspaceId)
      : jobs
    return applyJobView(inWorkspace, filter, sort, sortOptions)
  }, [jobs, selectedWorkspaceId, filter, sort, sortOptions])

  /** Workspace-scoped jobs list, NOT filtered. The widgets compute counts
   * from this — we don't want the widgets to react to the filters they
   * themselves apply, otherwise applying "overdue" zeros out every other
   * widget. */
  const workspaceJobs = useMemo(() => {
    return selectedWorkspaceId
      ? jobs.filter((j) => j.workspaceId === selectedWorkspaceId)
      : jobs
  }, [jobs, selectedWorkspaceId])

  /**
   * Round 7.12: archive count for the kanban header. We want this to
   * always reflect the actual count of archived jobs in the workspace,
   * even when the user has "Hide archived" toggled on — because the
   * point of the header count is "how many archived jobs are in this
   * workspace" not "how many archived jobs are currently visible."
   *
   * We DO still respect other filters though, so a user filtering
   * by assignee=Alice sees Alice's archived count specifically.
   * Only `hideArchived` is overridden.
   */
  const archiveTrueCount = useMemo(() => {
    const filterWithoutHideArchived = { ...filter, hideArchived: false, stage: '' }
    return applyJobView(workspaceJobs, filterWithoutHideArchived, sort, sortOptions).filter(
      (j) => j.stage === 'archive'
    ).length
  }, [workspaceJobs, filter, sort, sortOptions])

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
    <div className="min-h-screen p-4 lg:p-8 bg-slate-100 text-slate-900">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6 max-w-[1600px] mx-auto">
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
          onColumnsChanged={() => {
            // Round 7.2b: the workspace edit dialog's "Kanban columns"
            // tab fired a change. Refetch the columns for the selected
            // workspace so the kanban / filters / list view all reflect
            // the new state immediately.
            if (selectedWorkspaceId) void loadColumns(selectedWorkspaceId)
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
            columns={columns}
          />
        </div>

        {/* Row 2 — kanban / list view, full width below the sidebar */}
        <section className="col-span-2 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                {view === 'kanban' ? 'Kanban' : 'All jobs'}
              </h2>
              <p className="text-slate-600 text-sm mt-1">
                {visibleJobs.length} {visibleJobs.length === 1 ? 'job' : 'jobs'} shown
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Round 7.13: manual refresh + freshness indicator.
                  Sits to the left of the view toggle — same group of
                  view-level controls. The relative-time text is
                  read by screen readers via title; visually it's a
                  small slate label. The button shows "Refreshing…"
                  while in-flight. */}
              <span
                className="text-xs text-slate-500"
                title={
                  lastDataRefreshAt
                    ? new Date(lastDataRefreshAt).toLocaleString()
                    : 'Not yet loaded'
                }
              >
                Updated {formatRelativeTime(lastDataRefreshAt, Date.now())}
              </span>
              <button
                type="button"
                onClick={() => {
                  void refreshData()
                }}
                disabled={refreshing}
                className="rounded-lg border border-slate-300 bg-white hover:border-indigo-400 hover:text-indigo-700 text-slate-700 text-xs font-medium px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>

          {view === 'kanban' ? (
            <KanbanBoard
              jobs={visibleJobs}
              columns={columns}
              onSelectJob={setSelectedJob}
              onMoveJob={moveJob}
              archiveTrueCount={archiveTrueCount}
            />
          ) : (
            <JobListView
              jobs={visibleJobs}
              workspaces={workspaces}
              columns={columns}
              onSelectJob={setSelectedJob}
            />
          )}
        </section>
      </div>

      <JobDetailPanel
        job={selectedJob}
        columns={columns}
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
