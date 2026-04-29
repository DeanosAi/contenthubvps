// Pure functions for filtering and sorting Job arrays. Centralised here so
// the Kanban, List, and (later) Calendar / Reports views all apply the same
// rules without duplicating logic.
//
// All inputs are immutable — these never mutate the input array.

import type { ApprovalStatus, Job } from './types'

export type SortKey =
  | 'newest'
  | 'oldest'
  | 'dueDateAsc'
  | 'dueDateDesc'
  | 'priorityDesc'
  | 'priorityAsc'
  | 'recentlyUpdated'

/**
 * Round 7.12: special sentinel value for the assignedTo filter that
 * means "show only jobs with no one assigned." Stored as a string
 * (not null) so the filter state stays a flat object and doesn't
 * need a discriminated union. The picked sentinel is unlikely to
 * collide with any real user id (no UUID would ever be this value).
 *
 * Use the helper `isUnassignedFilter()` rather than comparing the
 * literal — keeps the magic-string contained.
 */
export const ASSIGNED_TO_UNASSIGNED = '__unassigned__'

export function isUnassignedFilter(v: string): boolean {
  return v === ASSIGNED_TO_UNASSIGNED
}

export interface JobFilterState {
  keyword: string
  /** Round 7.2b: widened from `JobStage | ''` to `string` so custom
   *  per-workspace stage keys can be filter-selected from the
   *  Dashboard's stage dropdown (which is now driven by the
   *  workspace's KanbanColumn config rather than hardcoded). */
  stage: string
  platform: string
  priorityMin: number | null
  dueFrom: string | null // ISO date string (yyyy-mm-dd or full ISO)
  dueTo: string | null
  /** When true, jobs in the `archive` stage are hidden unless `stage === 'archive'`. */
  hideArchived: boolean
  /**
   * Round 7.12: '' = no filter, ASSIGNED_TO_UNASSIGNED = unassigned only,
   * any other string = a specific user id.
   */
  assignedTo: string | ''
  /** Approval status filter. Empty string = no filter. Added in Round 5
   * so the dashboard "Awaiting approval" widget can apply a precise
   * filter rather than just clearing all filters. */
  approvalStatus: ApprovalStatus | ''
  /**
   * Round 7.12: filter by Type of Job. Single-select — pick one type
   * and see all jobs that include it (since jobs can have multiple
   * types). Empty string = no filter.
   */
  contentType: string | ''
}

export const DEFAULT_FILTER_STATE: JobFilterState = {
  keyword: '',
  stage: '',
  platform: '',
  priorityMin: null,
  dueFrom: null,
  dueTo: null,
  hideArchived: true,
  assignedTo: '',
  approvalStatus: '',
  contentType: '',
}

/** Lower bound of a date filter — start of day in local time, returned as ms. */
function dayStart(s: string | null): number | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Upper bound of a date filter — end of day in local time, returned as ms. */
function dayEnd(s: string | null): number | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function applyJobFilters(jobs: Job[], filter: JobFilterState): Job[] {
  const kw = filter.keyword.trim().toLowerCase()
  const fromMs = dayStart(filter.dueFrom)
  const toMs = dayEnd(filter.dueTo)

  return jobs.filter((job) => {
    // Hide archived unless the user explicitly filters TO archive.
    if (filter.hideArchived && job.stage === 'archive' && filter.stage !== 'archive') {
      return false
    }

    if (kw) {
      // Concat searchable fields once and check substring. Cheap, no regex.
      // Round 7.12: contentTypes joined into haystack so search
      // matches "Video" / "Graphic Design" etc.
      const types = (job.contentTypes ?? []).join(' ')
      const haystack = `${job.title} ${job.description ?? ''} ${job.hashtags ?? ''} ${job.notes ?? ''} ${types}`.toLowerCase()
      if (!haystack.includes(kw)) return false
    }

    if (filter.stage && job.stage !== filter.stage) return false
    if (filter.platform && job.platform !== filter.platform) return false
    if (filter.priorityMin != null && job.priority < filter.priorityMin) return false

    // Round 7.12: Unassigned filter is a sentinel; a normal user id
    // matches by equality. Empty string = no filter.
    if (filter.assignedTo) {
      if (isUnassignedFilter(filter.assignedTo)) {
        if (job.assignedTo) return false
      } else {
        if (job.assignedTo !== filter.assignedTo) return false
      }
    }

    if (filter.approvalStatus && job.approvalStatus !== filter.approvalStatus) return false

    // Round 7.12: contentType filter matches if the selected type is
    // ONE OF the job's types. Job with ['Video', 'Social Post']
    // matches filter='Video' AND filter='Social Post'.
    if (filter.contentType) {
      if (!(job.contentTypes ?? []).includes(filter.contentType)) return false
    }

    if (fromMs != null || toMs != null) {
      if (!job.dueDate) return false
      const d = new Date(job.dueDate).getTime()
      if (isNaN(d)) return false
      if (fromMs != null && d < fromMs) return false
      if (toMs != null && d > toMs) return false
    }

    return true
  })
}

/** Sort jobs by the selected key. `newest` is the default and matches the
 * server's existing ORDER BY. */
export function applyJobSort(jobs: Job[], sort: SortKey): Job[] {
  const out = [...jobs]
  switch (sort) {
    case 'newest':
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
    case 'oldest':
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      break
    case 'dueDateAsc':
      // Jobs without a due date sink to the bottom.
      out.sort((a, b) => {
        const ad = a.dueDate ?? '\uffff'
        const bd = b.dueDate ?? '\uffff'
        return ad.localeCompare(bd)
      })
      break
    case 'dueDateDesc':
      out.sort((a, b) => {
        const ad = a.dueDate ?? ''
        const bd = b.dueDate ?? ''
        return bd.localeCompare(ad)
      })
      break
    case 'priorityDesc':
      out.sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt))
      break
    case 'priorityAsc':
      out.sort((a, b) => a.priority - b.priority || b.createdAt.localeCompare(a.createdAt))
      break
    case 'recentlyUpdated':
      out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      break
  }
  return out
}

/** Convenience: filter then sort in one call. */
export function applyJobView(jobs: Job[], filter: JobFilterState, sort: SortKey): Job[] {
  return applyJobSort(applyJobFilters(jobs, filter), sort)
}

/** Detect whether the user has any non-default filter active. Used by the
 * filter bar to show a "clear" hint when something is applied. */
export function hasActiveFilters(filter: JobFilterState): boolean {
  return (
    filter.keyword.trim().length > 0 ||
    filter.stage !== '' ||
    filter.platform !== '' ||
    filter.priorityMin != null ||
    filter.dueFrom != null ||
    filter.dueTo != null ||
    filter.assignedTo !== '' ||
    filter.approvalStatus !== '' ||
    filter.contentType !== ''
  )
}
