"use client"

import { useMemo, useState } from 'react'
import type { ComparisonPost } from '@/lib/comparison'

/**
 * Side-by-side post comparison table. Each row is one selected post with
 * its key metrics. Sortable by any column.
 *
 * Posts without metrics show "—" rather than 0 so the user can tell
 * "fetched and got zero" apart from "never fetched."
 */

type SortCol = 'engagement' | 'views' | 'engagementRate' | 'postedAt'
type SortDir = 'asc' | 'desc'

export function ComparisonTable({ posts }: { posts: ComparisonPost[] }) {
  const [sortCol, setSortCol] = useState<SortCol>('engagement')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    const out = [...posts]
    out.sort((a, b) => {
      const sign = sortDir === 'desc' ? -1 : 1
      switch (sortCol) {
        case 'engagement':
          return sign * (a.engagement - b.engagement)
        case 'views':
          return sign * (a.views - b.views)
        case 'engagementRate':
          return (
            sign *
            ((a.engagementRate ?? -Infinity) - (b.engagementRate ?? -Infinity))
          )
        case 'postedAt':
          return sign * (a.job.postedAt ?? '').localeCompare(b.job.postedAt ?? '')
      }
    })
    return out
  }, [posts, sortCol, sortDir])

  function clickHeader(col: SortCol) {
    if (col === sortCol) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No posts to compare yet.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Rank</th>
            <th className="text-left px-4 py-3 font-medium">Post</th>
            <SortableTh
              col="postedAt"
              label="Posted"
              sortCol={sortCol}
              sortDir={sortDir}
              onClick={clickHeader}
            />
            <th className="text-left px-4 py-3 font-medium">Platform</th>
            <SortableTh
              col="views"
              label="Views"
              sortCol={sortCol}
              sortDir={sortDir}
              onClick={clickHeader}
              align="right"
            />
            <SortableTh
              col="engagement"
              label="Engagement"
              sortCol={sortCol}
              sortDir={sortDir}
              onClick={clickHeader}
              align="right"
            />
            <SortableTh
              col="engagementRate"
              label="Eng. rate"
              sortCol={sortCol}
              sortDir={sortDir}
              onClick={clickHeader}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, idx) => (
            <tr
              key={p.job.id}
              className="border-b last:border-b-0 hover:bg-[hsl(var(--accent))]/30"
            >
              <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] tabular-nums">
                {idx + 1}
              </td>
              <td className="px-4 py-3 max-w-md">
                <div className="font-medium truncate">{p.job.title}</div>
                <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  {p.job.contentType && <span>{p.job.contentType}</span>}
                  {p.job.campaign && (
                    <span className="rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] px-1.5 py-0.5">
                      {p.job.campaign}
                    </span>
                  )}
                  {!p.hasMetrics && (
                    <span className="text-amber-300">no metrics yet</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                {formatDate(p.job.postedAt)}
              </td>
              <td className="px-4 py-3 capitalize">
                {p.job.platform || '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {p.hasMetrics ? p.views.toLocaleString() : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold">
                {p.hasMetrics ? p.engagement.toLocaleString() : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {p.engagementRate == null
                  ? '—'
                  : (p.engagementRate * 100).toFixed(2) + '%'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortableTh({
  col,
  label,
  sortCol,
  sortDir,
  onClick,
  align = 'left',
}: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortDir: SortDir
  onClick: (c: SortCol) => void
  align?: 'left' | 'right'
}) {
  const active = col === sortCol
  return (
    <th className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 ${
          active ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'
        } hover:text-[hsl(var(--foreground))]`}
      >
        <span>{label}</span>
        {active && (
          <span className="text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span>
        )}
      </button>
    </th>
  )
}

function formatDate(stamp: string | null): string {
  if (!stamp) return '—'
  const d = new Date(stamp)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}
