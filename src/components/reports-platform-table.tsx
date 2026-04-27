"use client"

import type { PlatformRow } from '@/lib/reports'
import { formatNumber, formatEngagementRate } from '@/lib/reports'

/** Tabular breakdown of metrics per platform. Sorted by total engagement
 * desc (best-performing platforms at the top).
 *
 * Round 7.3: dark-mode CSS-var references swept to hardcoded slate
 * for consistency and defence in depth.
 */
export function ReportsPlatformTable({ rows }: { rows: PlatformRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">
          No posts in this range yet.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white surface-shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-slate-600 border-b border-slate-200 font-semibold">
          <tr>
            <th className="text-left px-4 py-3">Platform</th>
            <th className="text-right px-4 py-3">Posts</th>
            <th className="text-right px-4 py-3">Views</th>
            <th className="text-right px-4 py-3">Engagement</th>
            <th className="text-right px-4 py-3">Avg eng. rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.platform}
              className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50 transition-colors"
            >
              <td className="px-4 py-3 font-medium capitalize text-slate-900">{r.platform}</td>
              <td className="px-4 py-3 text-right text-slate-700">
                {r.postsCount}
              </td>
              <td className="px-4 py-3 text-right text-slate-700">
                {formatNumber(r.totalViews)}
              </td>
              <td className="px-4 py-3 text-right text-slate-700">
                {formatNumber(r.totalEngagement)}
              </td>
              <td className="px-4 py-3 text-right text-slate-700">
                {formatEngagementRate(r.avgEngagementRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
