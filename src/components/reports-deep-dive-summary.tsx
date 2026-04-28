"use client"

import type { DeepDive, TrendDelta } from '@/lib/quarterly'
import { directionGlyph, formatPctChange } from '@/lib/quarterly'
import { formatNumber, formatEngagementRate } from '@/lib/reports'

/** Top tile row for the deep-dive: 4 headline numbers, each with a
 * delta arrow showing change vs the prior period of equal length. */
export function ReportsDeepDiveSummary({ deepDive }: { deepDive: DeepDive }) {
  const tiles: { label: string; value: string; delta: TrendDelta; subline?: string }[] = [
    {
      label: 'Total posts',
      value: formatNumber(deepDive.current.totalPosts),
      delta: deepDive.trends.totalPosts,
      subline: `vs ${deepDive.prior.totalPosts} prior`,
    },
    {
      label: 'Total views',
      value: deepDive.current.jobsWithMetrics === 0
        ? '—'
        : formatNumber(deepDive.current.totalViews),
      delta: deepDive.trends.totalViews,
      subline: deepDive.prior.totalViews > 0
        ? `vs ${formatNumber(deepDive.prior.totalViews)} prior`
        : 'no prior data',
    },
    {
      label: 'Total engagement',
      value: deepDive.current.jobsWithMetrics === 0
        ? '—'
        : formatNumber(deepDive.current.totalEngagement),
      delta: deepDive.trends.totalEngagement,
      subline: deepDive.prior.totalEngagement > 0
        ? `vs ${formatNumber(deepDive.prior.totalEngagement)} prior`
        : 'no prior data',
    },
    {
      label: 'Avg eng. rate',
      value: deepDive.current.jobsWithMetrics === 0
        ? '—'
        : formatEngagementRate(deepDive.current.avgEngagementRate),
      delta: deepDive.trends.avgEngagementRate,
      subline: deepDive.prior.avgEngagementRate > 0
        ? `vs ${formatEngagementRate(deepDive.prior.avgEngagementRate)} prior`
        : 'no prior data',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border bg-white surface-shadow p-4">
          <p className="text-xs uppercase tracking-wider text-slate-600">
            {t.label}
          </p>
          <p className="mt-2 text-3xl font-bold">{t.value}</p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            <DirectionPill delta={t.delta} />
            {t.subline && (
              <span className="text-slate-600">{t.subline}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function DirectionPill({ delta }: { delta: TrendDelta }) {
  if (delta.pctChange == null) {
    return <span className="text-slate-600">—</span>
  }
  const colorClass =
    delta.direction === 'up'
      ? 'text-emerald-700 bg-emerald-500/10'
      : delta.direction === 'down'
      ? 'text-red-700 bg-red-50'
      : 'text-slate-600 bg-indigo-50/40'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${colorClass}`}
    >
      <span className="text-[9px]">{directionGlyph(delta.direction)}</span>
      <span>{formatPctChange(delta)}</span>
    </span>
  )
}
