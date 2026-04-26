"use client"

import type { JobFilterState, SortKey } from '@/lib/job-filters'
import { DEFAULT_FILTER_STATE, hasActiveFilters } from '@/lib/job-filters'
import type { ApprovalStatus, JobStage } from '@/lib/types'

const STAGES: { id: JobStage; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'production', label: 'Production' },
  { id: 'ready', label: 'Ready' },
  { id: 'posted', label: 'Posted' },
  { id: 'archive', label: 'Archive' },
]

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
]

export function DashboardFilters({
  filter,
  setFilter,
  sort,
  setSort,
}: {
  filter: JobFilterState
  setFilter: (next: JobFilterState) => void
  sort: SortKey
  setSort: (next: SortKey) => void
}) {
  const active = hasActiveFilters(filter)

  function patch(next: Partial<JobFilterState>) {
    setFilter({ ...filter, ...next })
  }

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          className="rounded-lg border bg-transparent px-3 py-2 text-sm"
          placeholder="Search title / description / hashtags..."
          value={filter.keyword}
          onChange={(e) => patch({ keyword: e.target.value })}
        />
        <select
          className="rounded-lg border bg-transparent px-3 py-2 text-sm"
          value={filter.stage}
          onChange={(e) => patch({ stage: (e.target.value || '') as JobFilterState['stage'] })}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border bg-transparent px-3 py-2 text-sm"
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
          className="rounded-lg border bg-transparent px-3 py-2 text-sm"
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
          Min priority
          <select
            className="rounded-lg border bg-transparent px-3 py-2 text-sm"
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

        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
          Approval
          <select
            className="rounded-lg border bg-transparent px-3 py-2 text-sm"
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

        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
          Due from
          <input
            type="date"
            className="rounded-lg border bg-transparent px-3 py-2 text-sm"
            value={filter.dueFrom ?? ''}
            onChange={(e) => patch({ dueFrom: e.target.value || null })}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
          Due to
          <input
            type="date"
            className="rounded-lg border bg-transparent px-3 py-2 text-sm"
            value={filter.dueTo ?? ''}
            onChange={(e) => patch({ dueTo: e.target.value || null })}
          />
        </label>

        <div className="flex items-center justify-end gap-3">
          <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
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
              className="text-xs text-[hsl(var(--primary))] hover:underline"
              onClick={() => setFilter(DEFAULT_FILTER_STATE)}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
