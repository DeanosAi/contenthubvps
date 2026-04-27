"use client"

import type { HeadlineNumbers } from '@/lib/reports'
import { formatNumber, formatEngagementRate } from '@/lib/reports'

/** Strip of 4 big-number tiles at the top of the reports page. Pure
 * presentational — just formats the numbers from `HeadlineNumbers` and
 * lays them out. The "no data" hint when `jobsWithMetrics === 0` is
 * important: it tells the user the zeros they're seeing are pre-fetch,
 * not actual zero performance.
 *
 * Round 7.3: hardcoded slate colours (was reading from CSS variables
 * which mostly worked but left the big numbers without an explicit
 * text colour, so they inherited from <body> and could read pale if
 * any parent layout ever set a light foreground). Now the numbers
 * are explicitly slate-900, captions slate-600, labels slate-500 —
 * defence in depth against any future cascade changes.
 */
export function ReportsHeadline({ headline }: { headline: HeadlineNumbers }) {
  const noMetrics = headline.totalPosts > 0 && headline.jobsWithMetrics === 0

  const tiles: { label: string; value: string; caption?: string }[] = [
    {
      label: 'Total posts',
      value: formatNumber(headline.totalPosts),
      caption: headline.totalPosts === 1 ? 'post in range' : 'posts in range',
    },
    {
      label: 'Total views',
      value: noMetrics ? '—' : formatNumber(headline.totalViews),
      caption: noMetrics ? 'awaiting first metric fetch' : 'across all in-scope posts',
    },
    {
      label: 'Total engagement',
      value: noMetrics ? '—' : formatNumber(headline.totalEngagement),
      caption: noMetrics ? 'awaiting first metric fetch' : 'likes + comments + shares + saves',
    },
    {
      label: 'Avg engagement rate',
      value: noMetrics
        ? '—'
        : formatEngagementRate(headline.avgEngagementRate),
      caption: noMetrics ? 'awaiting first metric fetch' : 'mean across reporting posts',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-2xl border border-slate-200 bg-white surface-shadow p-4"
        >
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-600">
            {t.label}
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{t.value}</p>
          {t.caption && (
            <p className="mt-1 text-[11px] text-slate-500">{t.caption}</p>
          )}
        </div>
      ))}
    </div>
  )
}
