"use client"

import type { PlatformRow } from '@/lib/reports'
import { formatNumber, formatEngagementRate } from '@/lib/reports'

/** Tabular breakdown of metrics per platform. Sorted by total engagement
 * desc (best-performing platforms at the top). */
export function ReportsPlatformTable({ rows }: { rows: PlatformRow[] }) {
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
              className="border-b last:border-b-0 hover:bg-[hsl(var(--accent))]/30 transition-colors"
            >
              <td className="px-4 py-3 font-medium capitalize">{r.platform}</td>
              <td className="px-4 py-3 text-right text-[hsl(var(--muted-foreground))]">
                {r.postsCount}
              </td>
              <td className="px-4 py-3 text-right text-[hsl(var(--muted-foreground))]">
                {formatNumber(r.totalViews)}
              </td>
              <td className="px-4 py-3 text-right text-[hsl(var(--muted-foreground))]">
                {formatNumber(r.totalEngagement)}
              </td>
              <td className="px-4 py-3 text-right text-[hsl(var(--muted-foreground))]">
                {formatEngagementRate(r.avgEngagementRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
