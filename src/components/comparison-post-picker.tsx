"use client"

import { useMemo, useState } from 'react'
import type { Job } from '@/lib/types'

/**
 * Multi-select list view for the manual comparison mode.
 *
 * Shows posts from the current workspace whose stage is `posted` or
 * `archive` — i.e. real finished posts, not drafts. Each row has a
 * checkbox; the parent owns the selection state.
 *
 * Soft cap of 50 posts per comparison is enforced by the parent. We
 * surface the cap visually as the user approaches it ("47 of 50") so
 * they aren't surprised when "Generate report" disables.
 *
 * Sorting: by posted date desc by default (newest first); user can
 * switch to engagement desc to find their top performers easily. No
 * "select all" — for a workspace of 200 posts, "all" is a useless
 * comparison. A "Top 10 by engagement" button is far more useful.
 */

const SOFT_CAP = 50

type Sort = 'newestFirst' | 'oldestFirst' | 'engagementDesc'

export function ComparisonPostPicker({
  jobs,
  selectedIds,
  onChange,
}: {
  /** All jobs in the active workspace; we filter to posted+archive here. */
  jobs: Job[]
  selectedIds: string[]
  onChange: (next: string[]) => void
}) {
  const [sort, setSort] = useState<Sort>('newestFirst')
  const [campaignFilter, setCampaignFilter] = useState<string>('')

  const eligible = useMemo(() => {
    return jobs.filter((j) => j.stage === 'posted' || j.stage === 'archive')
  }, [jobs])

  // Distinct campaign tags within the eligible set, for an inline filter.
  // Different from the workspace-wide campaigns endpoint — we only show
  // tags that are actually in this picker's pool, so picking a value
  // never produces an empty list.
  const campaignsInPool = useMemo(() => {
    const set = new Set<string>()
    for (const j of eligible) {
      if (j.campaign) set.add(j.campaign)
    }
    return Array.from(set).sort()
  }, [eligible])

  const visible = useMemo(() => {
    let list = eligible
    if (campaignFilter) {
      list = list.filter((j) => j.campaign === campaignFilter)
    }
    const out = [...list]
    if (sort === 'newestFirst') {
      out.sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
    } else if (sort === 'oldestFirst') {
      out.sort((a, b) => (a.postedAt ?? '').localeCompare(b.postedAt ?? ''))
    } else if (sort === 'engagementDesc') {
      out.sort((a, b) => engagementOf(b) - engagementOf(a))
    }
    return out
  }, [eligible, campaignFilter, sort])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  function toggle(jobId: string) {
    if (selectedSet.has(jobId)) {
      onChange(selectedIds.filter((id) => id !== jobId))
      return
    }
    if (selectedIds.length >= SOFT_CAP) {
      // Refuse silently at the cap. Parent shows the cap message.
      return
    }
    onChange([...selectedIds, jobId])
  }

  function selectTopN(n: number) {
    // Use ENGAGEMENT-sorted full eligible list (not the visible subset),
    // so "Top 10" means top 10 across the workspace, not top 10 of
    // whatever happens to be filtered right now.
    const top = [...eligible]
      .filter((j) => engagementOf(j) > 0)
      .sort((a, b) => engagementOf(b) - engagementOf(a))
      .slice(0, n)
    onChange(top.map((j) => j.id))
  }

  function clear() {
    onChange([])
  }

  const atCap = selectedIds.length >= SOFT_CAP

  return (
    <div className="rounded-2xl border bg-white surface-shadow overflow-hidden">
      {/* Header: count + actions + sort */}
      <div className="flex items-center justify-between gap-3 flex-wrap p-3 border-b border-slate-300">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm">
            <span className="font-semibold">{selectedIds.length}</span>{' '}
            <span className="text-slate-600">
              of up to {SOFT_CAP} selected
            </span>
            {atCap && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700">
                cap reached
              </span>
            )}
          </p>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="text-xs underline text-slate-600 hover:text-slate-900"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => selectTopN(10)}
            disabled={eligible.length === 0}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-indigo-50/40 disabled:opacity-50"
            title="Replace selection with the 10 highest-engagement posts in this workspace"
          >
            Top 10 by engagement
          </button>
          {campaignsInPool.length > 0 && (
            <select
              className="rounded-lg border bg-transparent px-2 py-1.5 text-xs"
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
            >
              <option value="">All campaigns</option>
              {campaignsInPool.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select
            className="rounded-lg border bg-transparent px-2 py-1.5 text-xs"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="newestFirst">Newest first</option>
            <option value="oldestFirst">Oldest first</option>
            <option value="engagementDesc">Highest engagement</option>
          </select>
        </div>
      </div>

      {/* Post list */}
      {visible.length === 0 ? (
        <div className="p-10 text-center text-sm text-slate-600">
          {eligible.length === 0
            ? 'No posted or archived posts in this workspace yet.'
            : 'No posts match the current campaign filter.'}
        </div>
      ) : (
        <ul className="max-h-[28rem] overflow-y-auto divide-y divide-slate-200">
          {visible.map((j) => {
            const checked = selectedSet.has(j.id)
            const eng = engagementOf(j)
            const hasMetrics = eng > 0
            return (
              <li
                key={j.id}
                className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                  checked
                    ? 'bg-indigo-600/10'
                    : 'hover:bg-indigo-50/30'
                } ${!checked && atCap ? 'opacity-60' : ''}`}
                onClick={() => toggle(j.id)}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(j.id)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={!checked && atCap}
                  className="h-4 w-4 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {j.title}
                    {j.stage === 'archive' && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-600">
                        archived
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap text-xs text-slate-600 mt-0.5">
                    {j.postedAt && <span>{formatPostedDate(j.postedAt)}</span>}
                    {j.platform && <span className="capitalize">{j.platform}</span>}
                    {j.contentType && <span>{j.contentType}</span>}
                    {j.campaign && (
                      <span className="rounded-full bg-indigo-600/10 text-indigo-700 px-1.5 py-0.5">
                        {j.campaign}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">
                    {hasMetrics ? eng.toLocaleString() : '—'}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600">
                    {hasMetrics ? 'engagement' : 'no metrics'}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Sum of engagement actions on a job's live metrics, or 0 if none. */
function engagementOf(j: Job): number {
  const m = j.liveMetrics
  if (!m) return 0
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0)
}

function formatPostedDate(stamp: string): string {
  const d = new Date(stamp)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
