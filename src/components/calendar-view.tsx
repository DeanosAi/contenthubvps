"use client"

import { useMemo, useState } from 'react'
import type { Job, Workspace } from '@/lib/types'
import {
  buildMonthGrid,
  groupJobsByDueDate,
  attachJobsToGrid,
  monthLabel,
  weekdayLabels,
  jobDueIso,
  localIsoDate,
  type CalendarCell,
} from '@/lib/calendar'

export type CalendarView = 'month' | 'agenda'

/** Calendar view that shows jobs by their dueDate. Two display modes:
 *
 *  - month: a 6x7 grid of days. Jobs appear as colored chips (workspace
 *    color dot + truncated title). Clicking a job opens the detail panel
 *    via `onSelectJob`. Clicking an empty day opens the create dialog
 *    pre-filled to that date via `onCreateOnDate`.
 *
 *  - agenda: a chronological list grouped by date. Same click affordances.
 *    Easier to scan when there are lots of jobs on few days.
 *
 *  All filtering (workspace selection, hide-archived) is the parent's
 *  responsibility — this component renders whatever `jobs` array it gets. */
export function CalendarView({
  jobs,
  workspaces,
  onSelectJob,
  onCreateOnDate,
}: {
  jobs: Job[]
  workspaces: Workspace[]
  onSelectJob: (job: Job) => void
  /** Called when the user clicks an empty day (or the "+ on date" affordance).
   * Receives a local-time ISO date string (yyyy-mm-dd). */
  onCreateOnDate: (iso: string) => void
}) {
  const today = new Date()
  const [view, setView] = useState<CalendarView>('month')
  const [year, setYear] = useState(today.getFullYear())
  const [monthIndex, setMonthIndex] = useState(today.getMonth())

  // Workspace color lookup for dots on each chip.
  const workspaceColor = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of workspaces) m.set(w.id, w.color)
    return m
  }, [workspaces])

  const byDate = useMemo(() => groupJobsByDueDate(jobs), [jobs])

  const grid: CalendarCell[] = useMemo(() => {
    return attachJobsToGrid(buildMonthGrid(year, monthIndex), byDate)
  }, [year, monthIndex, byDate])

  const headerLabels = useMemo(() => weekdayLabels(), [])

  function goToPrev() {
    if (monthIndex === 0) {
      setYear(year - 1)
      setMonthIndex(11)
    } else {
      setMonthIndex(monthIndex - 1)
    }
  }
  function goToNext() {
    if (monthIndex === 11) {
      setYear(year + 1)
      setMonthIndex(0)
    } else {
      setMonthIndex(monthIndex + 1)
    }
  }
  function goToToday() {
    const t = new Date()
    setYear(t.getFullYear())
    setMonthIndex(t.getMonth())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrev}
            className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-[hsl(var(--accent))]/40"
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            onClick={goToToday}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-[hsl(var(--accent))]/40"
          >
            Today
          </button>
          <button
            onClick={goToNext}
            className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-[hsl(var(--accent))]/40"
            aria-label="Next month"
          >
            →
          </button>
          <h2 className="text-xl font-semibold ml-2">{monthLabel(year, monthIndex)}</h2>
        </div>

        <div className="inline-flex items-center rounded-lg border border-[hsl(var(--border))] p-0.5 bg-[hsl(var(--card))]">
          {(['month', 'agenda'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === v
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              }`}
            >
              {v === 'month' ? 'Month' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <MonthGrid
          grid={grid}
          headerLabels={headerLabels}
          workspaceColor={workspaceColor}
          onSelectJob={onSelectJob}
          onCreateOnDate={onCreateOnDate}
        />
      ) : (
        <AgendaList
          grid={grid}
          workspaceColor={workspaceColor}
          onSelectJob={onSelectJob}
          onCreateOnDate={onCreateOnDate}
        />
      )}
    </div>
  )
}

/** Inner component for the month grid view. Pulled out so the main
 * component stays scannable. */
function MonthGrid({
  grid,
  headerLabels,
  workspaceColor,
  onSelectJob,
  onCreateOnDate,
}: {
  grid: CalendarCell[]
  headerLabels: string[]
  workspaceColor: Map<string, string>
  onSelectJob: (job: Job) => void
  onCreateOnDate: (iso: string) => void
}) {
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] overflow-hidden">
      <div className="grid grid-cols-7 text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b">
        {headerLabels.map((label) => (
          <div key={label} className="px-3 py-2 font-medium">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((cell) => (
          <div
            key={cell.iso}
            className={`group relative border-b border-r last:border-r-0 min-h-[120px] p-2 transition-colors ${
              cell.inMonth ? 'bg-[hsl(var(--card))]' : 'bg-[hsl(var(--background))]/40'
            } ${cell.isToday ? 'ring-1 ring-inset ring-[hsl(var(--primary))]/40' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-xs font-medium ${
                  cell.isToday
                    ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : cell.inMonth
                    ? 'text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {cell.day}
              </span>
              {cell.inMonth && (
                <button
                  onClick={() => onCreateOnDate(cell.iso)}
                  title={`Add job for ${cell.iso}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 rounded hover:bg-[hsl(var(--accent))]/50"
                  aria-label={`Add job for ${cell.iso}`}
                >
                  +
                </button>
              )}
            </div>

            <div className="space-y-1">
              {cell.jobs.slice(0, 3).map((job) => {
                const dot = workspaceColor.get(job.workspaceId) ?? '#8b5cf6'
                return (
                  <button
                    key={job.id}
                    onClick={() => onSelectJob(job)}
                    className="group/chip w-full flex items-center gap-1.5 text-left rounded px-1.5 py-1 hover:bg-[hsl(var(--accent))]/40 transition-colors"
                    title={job.title}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: dot }}
                    />
                    <span className="text-[11px] truncate">{job.title}</span>
                  </button>
                )
              })}
              {cell.jobs.length > 3 && (
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] px-1.5">
                  +{cell.jobs.length - 3} more
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Chronological list of jobs grouped by day. Skips empty in-month days
 * by default — only days with jobs (or the current/upcoming days) are
 * shown. We DO show today even if empty so users can quickly create. */
function AgendaList({
  grid,
  workspaceColor,
  onSelectJob,
  onCreateOnDate,
}: {
  grid: CalendarCell[]
  workspaceColor: Map<string, string>
  onSelectJob: (job: Job) => void
  onCreateOnDate: (iso: string) => void
}) {
  const todayIso = localIsoDate(new Date())
  // Show in-month days that have at least one job, plus today (whether or not
  // it has jobs) so the user has a clear "click here to add a job for today"
  // anchor.
  const visible = grid.filter(
    (c) => c.inMonth && (c.jobs.length > 0 || c.iso === todayIso),
  )

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No jobs in this month yet.
        </p>
      </div>
    )
  }

  return (
    <ul className="rounded-2xl border bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))]">
      {visible.map((cell) => {
        const d = new Date(cell.iso + 'T00:00:00')
        const dateLabel = d.toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
        return (
          <li key={cell.iso} className="p-4 flex items-start gap-4">
            <div className="w-32 shrink-0">
              <p
                className={`text-sm font-medium ${
                  cell.isToday ? 'text-[hsl(var(--primary))]' : ''
                }`}
              >
                {dateLabel}
              </p>
              {cell.isToday && (
                <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--primary))]">Today</p>
              )}
            </div>
            <div className="flex-1 space-y-1">
              {cell.jobs.length === 0 ? (
                <button
                  onClick={() => onCreateOnDate(cell.iso)}
                  className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  + Add a job for today
                </button>
              ) : (
                cell.jobs.map((job) => {
                  const dot = workspaceColor.get(job.workspaceId) ?? '#8b5cf6'
                  return (
                    <button
                      key={job.id}
                      onClick={() => onSelectJob(job)}
                      className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-[hsl(var(--accent))]/40"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: dot }}
                      />
                      <span className="text-sm font-medium truncate flex-1">{job.title}</span>
                      {job.priority > 0 && (
                        <span className="text-[10px] rounded-full bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] px-2 py-0.5 font-semibold">
                          P{job.priority}
                        </span>
                      )}
                      {job.platform && (
                        <span className="text-[10px] rounded-full border px-2 py-0.5 text-[hsl(var(--muted-foreground))]">
                          {job.platform}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
