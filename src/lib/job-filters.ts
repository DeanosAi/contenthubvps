// Pure functions for filtering and sorting Job arrays. Centralised here so
// the Kanban, List, and (later) Calendar / Reports views all apply the same
// rules without duplicating logic.
//
// All inputs are immutable — these never mutate the input array.

import type { ApprovalStatus, Job } from './types'
import { ALLOWED_JOB_TYPES } from './types'

export type SortKey =
  | 'newest'
  | 'oldest'
  | 'dueDateAsc'
  | 'dueDateDesc'
  | 'priorityDesc'
  | 'priorityAsc'
  | 'recentlyUpdated'
  // Round 7.13: categorical sorts. Each groups jobs by the named
  // attribute, sorted alphabetically (or by a meaningful order),
  // with empty/null values sinking to the bottom.
  | 'assignee'
  | 'jobType'
  | 'approvalStatus'
  | 'stage'
  | 'platform'

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

/**
 * Round 7.13: optional context for sorts that need external info to
 * sort meaningfully. Currently only the assignee sort uses this —
 * we want to sort by the user's NAME, not the opaque user ID. The
 * caller passes a lookup function (typically wrapped over the user
 * list cached in `useUsers()`).
 *
 * If not provided, the assignee sort falls back to sorting by user
 * ID — still groups jobs by assignee but the visual order is
 * meaningless.
 */
export interface SortOptions {
  userNameById?: (id: string) => string | null
}

/**
 * Round 7.13: stage display order — built-in stages by their natural
 * left-to-right order on the kanban, then any custom stages
 * alphabetically after. Used by the 'stage' sort.
 */
const STAGE_ORDER: Record<string, number> = {
  brief: 0,
  production: 1,
  ready: 2,
  posted: 3,
  archive: 4,
}

/**
 * Round 7.13: approval status order — most-pressing first.
 * "awaiting" surfaces top because it needs an action; "changes_requested"
 * is also actionable; "approved" is settled; "none" sinks to the bottom.
 */
const APPROVAL_ORDER: Record<ApprovalStatus, number> = {
  awaiting: 0,
  changes_requested: 1,
  approved: 2,
  none: 3,
}

/** Sort jobs by the selected key. `newest` is the default and matches the
 * server's existing ORDER BY. */
export function applyJobSort(
  jobs: Job[],
  sort: SortKey,
  options?: SortOptions,
): Job[] {
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
    case 'assignee': {
      // Sort alphabetically by assignee NAME. Unassigned jobs last.
      // Tie-break on createdAt so within one assignee, newer jobs
      // come first (matches the default "newest" within group).
      const lookup = options?.userNameById
      const nameFor = (j: Job): string => {
        if (!j.assignedTo) return '\uffff' // unassigned sinks
        if (lookup) return (lookup(j.assignedTo) || j.assignedTo).toLowerCase()
        return j.assignedTo.toLowerCase()
      }
      out.sort((a, b) => {
        const cmp = nameFor(a).localeCompare(nameFor(b))
        if (cmp !== 0) return cmp
        return b.createdAt.localeCompare(a.createdAt)
      })
      break
    }
    case 'jobType': {
      // Group by Type of Job. Multi-type jobs sort by their FIRST
      // type (in ALLOWED_JOB_TYPES canonical order). Untyped jobs
      // sink to the bottom. Tie-break on createdAt newest-first.
      const orderOf = (t: string): number => {
        const idx = (ALLOWED_JOB_TYPES as readonly string[]).indexOf(t)
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
      }
      const firstTypeOrder = (j: Job): number => {
        const types = j.contentTypes ?? []
        if (types.length === 0) return Number.MAX_SAFE_INTEGER + 1
        return Math.min(...types.map(orderOf))
      }
      out.sort((a, b) => {
        const ao = firstTypeOrder(a)
        const bo = firstTypeOrder(b)
        if (ao !== bo) return ao - bo
        return b.createdAt.localeCompare(a.createdAt)
      })
      break
    }
    case 'approvalStatus':
      // Surface jobs needing attention first: awaiting →
      // changes_requested → approved → none.
      out.sort((a, b) => {
        const ao = APPROVAL_ORDER[a.approvalStatus] ?? 99
        const bo = APPROVAL_ORDER[b.approvalStatus] ?? 99
        if (ao !== bo) return ao - bo
        return b.createdAt.localeCompare(a.createdAt)
      })
      break
    case 'stage':
      // Built-in stages by their natural left-to-right kanban order,
      // then custom stages alphabetically after.
      out.sort((a, b) => {
        const ao = STAGE_ORDER[a.stage] ?? 100
        const bo = STAGE_ORDER[b.stage] ?? 100
        if (ao !== bo) return ao - bo
        // Within the same stage bucket (or both custom): alpha by stage key
        if (a.stage !== b.stage) return a.stage.localeCompare(b.stage)
        return b.createdAt.localeCompare(a.createdAt)
      })
      break
    case 'platform':
      // Group by platform alphabetically. Platform-less jobs last.
      out.sort((a, b) => {
        const ap = (a.platform ?? '\uffff').toLowerCase()
        const bp = (b.platform ?? '\uffff').toLowerCase()
        const cmp = ap.localeCompare(bp)
        if (cmp !== 0) return cmp
        return b.createdAt.localeCompare(a.createdAt)
      })
      break
  }
  return out
}

/** Convenience: filter then sort in one call. */
export function applyJobView(
  jobs: Job[],
  filter: JobFilterState,
  sort: SortKey,
  options?: SortOptions,
): Job[] {
  return applyJobSort(applyJobFilters(jobs, filter), sort, options)
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
