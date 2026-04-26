// Pure date and job-grouping helpers used by the calendar view AND
// the dashboard widgets. No React, no DOM — testable as plain
// functions and reusable across pages.

import type { Job } from './types'

/** A single cell in the month grid. */
export interface CalendarCell {
  /** ISO date (yyyy-mm-dd) — local time, NOT UTC. */
  iso: string
  /** Day of month, 1-31. */
  day: number
  /** True if the cell belongs to the displayed month (vs leading/trailing
   * filler days from adjacent months). */
  inMonth: boolean
  /** True if this cell is today (in the user's local time). */
  isToday: boolean
  /** Jobs whose dueDate falls on this calendar day. */
  jobs: Job[]
}

/** Same as CalendarCell but without a jobs array — used while building
 * the grid before jobs are bucketed in. */
type CalendarCellSkeleton = Omit<CalendarCell, 'jobs'>

/** Format a Date as a local-time ISO date string (yyyy-mm-dd). Used as
 * the canonical key for "this day" comparisons. We deliberately avoid
 * .toISOString() because that converts to UTC, which breaks date
 * comparisons for users east/west of UTC near midnight. */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Returns the local-time ISO date of an arbitrary date string, or null
 * if the input is missing/invalid. The DB stores dueDate as UTC midnight;
 * we want to render it in the user's local-timezone day. */
export function jobDueIso(job: Job): string | null {
  if (!job.dueDate) return null
  const d = new Date(job.dueDate)
  if (isNaN(d.getTime())) return null
  return localIsoDate(d)
}

/** Build the 6-row month grid (42 cells) for a given year+month. Always
 * starts on the configured week-start day (default Monday) and pads with
 * trailing days from the previous and next month so the grid is rectangular. */
export function buildMonthGrid(
  year: number,
  monthIndex: number, // 0-11
  weekStartsOn: 0 | 1 = 1, // 0 = Sunday, 1 = Monday
): CalendarCellSkeleton[] {
  const firstOfMonth = new Date(year, monthIndex, 1)
  const firstWeekday = firstOfMonth.getDay() // 0..6, 0 = Sunday
  // How many leading days from the previous month to include.
  const leadingDays = (firstWeekday - weekStartsOn + 7) % 7
  const start = new Date(year, monthIndex, 1 - leadingDays)
  const todayIso = localIsoDate(new Date())

  const cells: CalendarCellSkeleton[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push({
      iso: localIsoDate(d),
      day: d.getDate(),
      inMonth: d.getMonth() === monthIndex && d.getFullYear() === year,
      isToday: localIsoDate(d) === todayIso,
    })
  }
  return cells
}

/** Returns the 0-indexed weekday names starting at `weekStartsOn`,
 * rendered in the user's locale. Used for the column headers. */
export function weekdayLabels(weekStartsOn: 0 | 1 = 1, locale?: string): string[] {
  // Pick a known Sunday-aligned reference and shift by weekStartsOn.
  const ref = new Date(2024, 0, 7) // Sunday Jan 7 2024
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(ref)
    d.setDate(ref.getDate() + i + weekStartsOn)
    labels.push(d.toLocaleDateString(locale, { weekday: 'short' }))
  }
  return labels
}

/** Group an array of jobs into a Map keyed by their local-time due-date ISO.
 * Jobs without a due date are dropped — they don't appear on the calendar. */
export function groupJobsByDueDate(jobs: Job[]): Map<string, Job[]> {
  const out = new Map<string, Job[]>()
  for (const job of jobs) {
    const iso = jobDueIso(job)
    if (!iso) continue
    const arr = out.get(iso) ?? []
    arr.push(job)
    out.set(iso, arr)
  }
  return out
}

/** Populate the `jobs` field on each cell in a grid. */
export function attachJobsToGrid(
  grid: CalendarCellSkeleton[],
  byDate: Map<string, Job[]>,
): CalendarCell[] {
  return grid.map((cell) => ({
    ...cell,
    jobs: byDate.get(cell.iso) ?? [],
  }))
}

/** Month-name + year display label, in the user's locale. */
export function monthLabel(year: number, monthIndex: number, locale?: string): string {
  const d = new Date(year, monthIndex, 1)
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

// =====================================================================
// Predicates used by the dashboard widgets. Each takes a Job and returns
// a boolean. Centralised here so the widgets and the kanban filter bar
// stay aligned on what "overdue" or "due this week" means.
// =====================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Today's local-midnight as ms — used as the cutoff for overdue. */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** True iff the job has a due date in the past AND it isn't already
 * posted/archived (which we don't consider "overdue" — the work is done). */
export function isOverdue(job: Job): boolean {
  if (!job.dueDate) return false
  if (job.stage === 'posted' || job.stage === 'archive') return false
  const d = new Date(job.dueDate).getTime()
  if (!Number.isFinite(d)) return false
  return d < startOfToday()
}

/** True iff the job is due within the next 7 days (inclusive of today
 * but exclusive of overdue — overdue jobs go in the overdue bucket). */
export function isDueThisWeek(job: Job): boolean {
  if (!job.dueDate) return false
  if (job.stage === 'posted' || job.stage === 'archive') return false
  const d = new Date(job.dueDate).getTime()
  if (!Number.isFinite(d)) return false
  const today = startOfToday()
  return d >= today && d < today + 7 * MS_PER_DAY
}

/** True iff the job is awaiting client approval. */
export function isAwaitingApproval(job: Job): boolean {
  return job.approvalStatus === 'awaiting'
}

/** True iff the job moved to "posted" in the last 7 days. We approximate
 * "moved to posted" via updatedAt — the row's most recent change. Imperfect
 * (any subsequent edit moves it out of the window), but good enough for an
 * at-a-glance widget. */
export function isRecentlyPosted(job: Job): boolean {
  if (job.stage !== 'posted') return false
  const t = new Date(job.updatedAt).getTime()
  if (!Number.isFinite(t)) return false
  return t >= startOfToday() - 7 * MS_PER_DAY
}

/** True iff the job is "in flight" — i.e. actively being worked on
 * (anything not in archive). Used as the headline total. */
export function isInFlight(job: Job): boolean {
  return job.stage !== 'archive'
}

/** Count helpers for the dashboard widgets — wraps the predicates so
 * the widget component stays declarative. */
export interface DashboardCounts {
  overdue: number
  dueThisWeek: number
  awaitingApproval: number
  recentlyPosted: number
  inFlight: number
}

export function computeDashboardCounts(jobs: Job[]): DashboardCounts {
  const counts: DashboardCounts = {
    overdue: 0,
    dueThisWeek: 0,
    awaitingApproval: 0,
    recentlyPosted: 0,
    inFlight: 0,
  }
  for (const job of jobs) {
    if (isOverdue(job)) counts.overdue++
    if (isDueThisWeek(job)) counts.dueThisWeek++
    if (isAwaitingApproval(job)) counts.awaitingApproval++
    if (isRecentlyPosted(job)) counts.recentlyPosted++
    if (isInFlight(job)) counts.inFlight++
  }
  return counts
}
