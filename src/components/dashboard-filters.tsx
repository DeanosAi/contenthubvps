"use client"

import type { JobFilterState, SortKey } from '@/lib/job-filters'
import {
  DEFAULT_FILTER_STATE,
  hasActiveFilters,
  ASSIGNED_TO_UNASSIGNED,
} from '@/lib/job-filters'
import type { ApprovalStatus, KanbanColumn } from '@/lib/types'
import { ALLOWED_JOB_TYPES } from '@/lib/types'
import { useUsers } from '@/lib/use-users'

const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube']

const APPROVAL_OPTIONS: { value: ApprovalStatus; label: string }[] = [
  { value: 'none', label: 'No approval needed' },
  { value: 'awaiting', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'changes_requested', label: 'Changes requested' },
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recentlyUpdated', label: 'Recently updated' },
  { value: 'dueDateAsc', label: 'Due date (soonest)' },
  { value: 'dueDateDesc', label: 'Due date (latest)' },
  { value: 'priorityDesc', label: 'Priority (highest)' },
  { value: 'priorityAsc', label: 'Priority (lowest)' },
  // Round 7.13: categorical sorts — group jobs by attribute.
  { value: 'assignee', label: 'Assigned to (A → Z)' },
  { value: 'jobType', label: 'Type of Job' },
  { value: 'approvalStatus', label: 'Approval status (action first)' },
  { value: 'stage', label: 'Stage' },
  { value: 'platform', label: 'Platform' },
]

/**
 * Round 7.2b: stage dropdown is now driven by the columns prop, so
 * custom user-added columns appear as filterable options alongside
 * the built-ins. The values stored in JobFilterState.stage match the
 * stage_key strings used in jobs.stage.
 *
 * Round 7.12 additions:
 *   - Assignee dropdown — first option is "Unassigned" (sentinel
 *     value ASSIGNED_TO_UNASSIGNED), then each team member by name
 *   - Type of Job dropdown — single-select filter; pick one type
 *     and see all jobs that include it (since jobs can have
 *     multiple types). Briefers don't see this filter (they don't
 *     see this component at all).
 */
export function DashboardFilters({
  filter,
  setFilter,
  sort,
  setSort,
  columns,
}: {
  filter: JobFilterState
  setFilter: (next: JobFilterState) => void
  sort: SortKey
  setSort: (next: SortKey) => void
  /** Per-workspace columns. The stage dropdown lists these in order. */
  columns: KanbanColumn[]
}) {
  const active = hasActiveFilters(filter)
  // Round 7.12: pull team members for the assignee dropdown.
  // The slim user list — id + name + email — is what we need.
  const { users } = useUsers()

  function patch(next: Partial<JobFilterState>) {
    setFilter({ ...filter, ...next })
  }

  const inputClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          className={inputClass}
          placeholder="Search title / description / hashtags..."
          value={filter.keyword}
          onChange={(e) => patch({ keyword: e.target.value })}
        />
        <select
          className={inputClass}
          value={filter.stage}
          onChange={(e) => patch({ stage: e.target.value })}
        >
          <option value="">All stages</option>
          {columns.map((c) => (
            <option key={c.id} value={c.stageKey}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={filter.platform}
          onChange={(e) => patch({ platform: e.target.value })}
        >
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        {/* Round 7.12: Assignee dropdown with Unassigned option.
            Round 7.14: label renamed to "Assigned to" per Dean's
            preference — matches the column-style noun in list view. */}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Assigned to
          <select
            className={inputClass}
            value={filter.assignedTo}
            onChange={(e) => patch({ assignedTo: e.target.value })}
          >
            <option value="">Anyone</option>
            <option value={ASSIGNED_TO_UNASSIGNED}>Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
        </label>
        {/* Round 7.12: Type of Job filter */}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Type of Job
          <select
            className={inputClass}
            value={filter.contentType}
            onChange={(e) => patch({ contentType: e.target.value })}
          >
            <option value="">Any type</option>
            {ALLOWED_JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Min priority
          <select
            className={inputClass}
            value={filter.priorityMin == null ? '' : String(filter.priorityMin)}
            onChange={(e) =>
              patch({ priorityMin: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                P{n}+
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Approval
          <select
            className={inputClass}
            value={filter.approvalStatus}
            onChange={(e) =>
              patch({
                approvalStatus: (e.target.value || '') as JobFilterState['approvalStatus'],
              })
            }
          >
            <option value="">Any approval</option>
            {APPROVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Due from
          <input
            type="date"
            className={inputClass}
            value={filter.dueFrom ?? ''}
            onChange={(e) => patch({ dueFrom: e.target.value || null })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Due to
          <input
            type="date"
            className={inputClass}
            value={filter.dueTo ?? ''}
            onChange={(e) => patch({ dueTo: e.target.value || null })}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={filter.hideArchived}
            onChange={(e) => patch({ hideArchived: e.target.checked })}
          />
          Hide archived
        </label>
        {active && (
          <button
            type="button"
            className="text-xs text-indigo-700 hover:underline"
            onClick={() => setFilter(DEFAULT_FILTER_STATE)}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
