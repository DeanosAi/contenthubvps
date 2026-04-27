"use client"

import type { TopPostRow } from '@/lib/reports'
import { formatNumber, formatEngagementRate, formatDateShort } from '@/lib/reports'

/** Top performers section — one card per platform listing its top 5 posts.
 * Each row shows title, posted-on date, views, engagement, eng. rate.
 *
 * Round 7.3: dark-mode CSS-var references swept to hardcoded slate.
 * Inner row "cards" now use bg-slate-50 (was --background which
 * resolves to a near-white off-tone) so they sit visibly against
 * the white outer card.
 */
export function ReportsTopPosts({
  byPlatform,
}: {
  byPlatform: Map<string, TopPostRow[]>
}) {
  const entries = Array.from(byPlatform.entries())
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">
          No posts have metrics yet — top performers will appear once metrics are fetched.
        </p>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {entries.map(([platform, rows]) => (
        <div key={platform} className="rounded-2xl border border-slate-200 bg-white surface-shadow p-4">
          <h3 className="text-sm font-semibold capitalize mb-3 text-slate-900">
            Top performers: {platform}
          </h3>
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.job.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <span className="text-xs font-bold text-slate-500 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-slate-900" title={r.job.title}>
                    {r.job.title}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Posted {formatDateShort(r.job.postedAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-slate-900">{formatNumber(r.engagement)}</p>
                  <p className="text-[10px] text-slate-500">
                    {formatNumber(r.views)} views · {formatEngagementRate(r.engagementRate)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
