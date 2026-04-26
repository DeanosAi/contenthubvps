"use client"

import type { PlatformTrendRow, TrendDelta } from '@/lib/quarterly'
import { directionGlyph, formatPctChange } from '@/lib/quarterly'
import { formatNumber, formatEngagementRate } from '@/lib/reports'

/** Per-platform comparison table: posts, views, engagement, eng. rate.
 * Each metric column shows the current value with a trend pill underneath
 * that compares to the prior period. */
export function ReportsDeepDivePlatformTable({ rows }: { rows: PlatformTrendRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No posts in this range yet.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Platform</th>
            <th className="text-right px-4 py-3 font-medium">Posts</th>
            <th className="text-right px-4 py-3 font-medium">Views</th>
            <th className="text-right px-4 py-3 font-medium">Engagement</th>
            <th className="text-right px-4 py-3 font-medium">Avg eng. rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.platform}
              className={`border-b last:border-b-0 ${
                r.current.postsCount === 0 ? 'opacity-60' : 'hover:bg-[hsl(var(--accent))]/30'
              } transition-colors`}
            >
              <td className="px-4 py-3 font-medium capitalize">
                {r.platform}
                {r.current.postsCount === 0 && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-red-300">
                    silent
                  </span>
                )}
              </td>
              <Cell value={r.current.postsCount.toString()} delta={r.posts} />
              <Cell value={formatNumber(r.current.totalViews)} delta={r.views} />
              <Cell value={formatNumber(r.current.totalEngagement)} delta={r.engagement} />
              <Cell
                value={formatEngagementRate(r.current.avgEngagementRate)}
                delta={r.avgEngagementRate}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ value, delta }: { value: string; delta: TrendDelta }) {
  return (
    <td className="px-4 py-3 text-right">
      <div className="text-[hsl(var(--foreground))]">{value}</div>
      <div className="mt-0.5">
        <DirectionPill delta={delta} />
      </div>
    </td>
  )
}

function DirectionPill({ delta }: { delta: TrendDelta }) {
  if (delta.pctChange == null) {
    return (
      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">—</span>
    )
  }
  const colorClass =
    delta.direction === 'up'
      ? 'text-emerald-300'
      : delta.direction === 'down'
      ? 'text-red-300'
      : 'text-[hsl(var(--muted-foreground))]'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] ${colorClass}`}>
      <span>{directionGlyph(delta.direction)}</span>
      <span>{formatPctChange(delta)}</span>
    </span>
  )
}
