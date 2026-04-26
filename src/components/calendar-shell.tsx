"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { CalendarView } from '@/components/calendar-view'
import { JobDetailPanel } from '@/components/job-detail-panel'
import { JobCreateDialog } from '@/components/job-create-dialog'
import type { Job, Workspace } from '@/lib/types'

/**
 * Page shell for /calendar. Mirrors AppShell's structure but hosts the
 * CalendarView in the main panel and uses its own filter state (workspace +
 * hide-archived). Workspace CRUD is delegated to HostedSidebar exactly like
 * the dashboard page.
 *
 * Why a separate shell rather than reusing AppShell with a "mode" prop:
 * the kanban page and the calendar page have meaningfully different
 * top-level layouts (kanban needs widgets + filter bar + view toggle;
 * calendar needs month nav + view toggle). Trying to merge them under
 * one component would create a giant if-tree. Keeping them separate keeps
 * each shell understandable on its own.
 */
export function CalendarShell() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  /** When empty, the calendar shows ALL workspaces. Different from the
   * kanban page where the sidebar selection always drives the kanban. */
  const [calendarWorkspaceFilter, setCalendarWorkspaceFilter] = useState<string>('')
  const [hideArchived, setHideArchived] = useState(true)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDefaultDate, setCreateDefaultDate] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ---------- data loading ----------
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

  /** Loads ALL jobs across all workspaces. The calendar deliberately does
   * not filter server-side by workspace — users often want to see "what's
   * across all my brands this month." Workspace filtering happens client
   * side via the picker. */
  async function loadJobs() {
    const res = await fetch('/api/jobs')
    if (!res.ok) {
      setErrorMessage('Failed to load jobs')
      return
    }
    const data: Job[] = await res.json()
    setJobs(data)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ws = await loadWorkspaces()
      if (cancelled) return
      // The sidebar's "currently selected workspace" — purely cosmetic on
      // this page (the calendar uses its own filter), but kept consistent
      // so the sidebar highlight makes sense if the user navigates back.
      const initial = ws[0]?.id ?? ''
      if (initial) setSelectedWorkspaceId(initial)
      await loadJobs()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // If a job is selected and then disappears (e.g. deleted in another
  // tab), close the detail panel.
  useEffect(() => {
    if (!selectedJob) return
    if (!jobs.some((j) => j.id === selectedJob.id)) setSelectedJob(null)
  }, [jobs, selectedJob])

  // ---------- workspace mutations (passed to sidebar) ----------
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
    if (calendarWorkspaceFilter === id) setCalendarWorkspaceFilter('')
    await loadWorkspaces()
    await loadJobs()
  }

  async function reorderWorkspaces(orderedIds: string[]) {
    const prev = workspaces
    const byId = new Map(prev.map((w) => [w.id, w]))
    const reordered: Workspace[] = []
    for (const id of orderedIds) {
      const w = byId.get(id)
      if (w) reordered.push(w)
    }
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

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  // ---------- derived data ----------
  const visibleJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (calendarWorkspaceFilter && j.workspaceId !== calendarWorkspaceFilter) return false
      if (hideArchived && j.stage === 'archive') return false
      return true
    })
  }, [jobs, calendarWorkspaceFilter, hideArchived])

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
          setWorkspaces((prev) =>
            prev.map((w) => (w.id === updated.id ? updated : w)),
          )
        }}
      />

      <main className="flex-1 p-8 space-y-6">
        <section className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">
              Hosted Content Hub
            </p>
            <h1 className="text-4xl font-bold mt-2">Calendar</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-3 max-w-3xl">
              Jobs by their due date. Click a date to add, or click a job to edit.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/app"
              className="rounded-lg border px-3 py-2 text-sm hover:bg-[hsl(var(--accent))]/40"
            >
              Back to dashboard
            </Link>
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

        {/* Calendar-specific filter strip — workspace picker + hide-archived */}
        <section className="rounded-2xl border bg-[hsl(var(--card))] p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Workspace</label>
            <select
              className="rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={calendarWorkspaceFilter}
              onChange={(e) => setCalendarWorkspaceFilter(e.target.value)}
            >
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <input
              type="checkbox"
              checked={hideArchived}
              onChange={(e) => setHideArchived(e.target.checked)}
            />
            Hide archived
          </label>
          <span className="text-xs text-[hsl(var(--muted-foreground))] ml-auto">
            {visibleJobs.length} {visibleJobs.length === 1 ? 'job' : 'jobs'} shown
          </span>
        </section>

        <CalendarView
          jobs={visibleJobs}
          workspaces={workspaces}
          onSelectJob={setSelectedJob}
          onCreateOnDate={(iso) => {
            setCreateDefaultDate(iso)
            setCreateOpen(true)
          }}
        />
      </main>

      <JobDetailPanel
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onSaved={(updated) => {
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
        onClose={() => {
          setCreateOpen(false)
          setCreateDefaultDate(null)
        }}
        workspaces={workspaces}
        defaultWorkspaceId={
          // Prefer the calendar's current workspace filter if set; otherwise
          // fall back to the sidebar's selected workspace. If neither, the
          // first workspace.
          calendarWorkspaceFilter || selectedWorkspaceId || workspaces[0]?.id || ''
        }
        defaultDueDate={createDefaultDate}
        onCreated={(newJob) => {
          setJobs((js) => [newJob, ...js])
        }}
      />
    </div>
  )
}
