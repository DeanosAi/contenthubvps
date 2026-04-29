"use client"

import type { JobTypeRow } from '@/lib/reports'

/**
 * Round 7.12 — Jobs by Type breakdown for the reports page.
 *
 * Renders the result of computeJobTypeBreakdown() as a simple
 * bar chart styled as horizontal rows (no chart library — just
 * styled divs, matches the rest of the reports surface).
 *
 * Important caveat shown to the user: a job with multiple types
 * is counted in EACH bucket. So percentages can sum to >100% and
 * total of bucket counts can exceed total jobs. The component
 * shows a small explanation note so this isn't surprising.
 */
export function ReportsJobsByType({
  rows,
  totalJobs,
}: {
  rows: JobTypeRow[]
  /** The total number of jobs in scope (denominator for percentages). */
  totalJobs: number
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        No jobs in this date range.
      </div>
    )
  }

  // Largest count for bar normalisation. We don't want bars all
  // looking maxed out at 100% — normalise to the biggest bucket
  // so the visual comparison is meaningful.
  const maxCount = Math.max(...rows.map((r) => r.count), 1)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="space-y-1">
        {rows.map((row) => {
          const widthPct = Math.round((row.count / maxCount) * 100)
          const isUncategorised = row.type === 'Uncategorised'
          const tint = isUncategorised
            ? 'bg-slate-300'
            : row.type === 'Other'
              ? 'bg-slate-500'
              : 'bg-indigo-500'
          return (
            <div key={row.type} className="flex items-center gap-3">
              <div className="w-32 text-xs text-slate-700 truncate">
                {row.type}
              </div>
              <div className="flex-1 relative h-6 bg-slate-100 rounded">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${tint} transition-all`}
                  style={{ width: `${widthPct}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-end px-2 text-xs font-medium text-slate-900">
                  {row.count} <span className="text-slate-500 ml-1">({row.percentage}%)</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
        Counted by job creation date in this range.
        {totalJobs > 0 && (
          <> Total jobs: {totalJobs}.</>
        )}
        {' '}A single job that has multiple types is counted in each bucket
        — totals across types can exceed total jobs and percentages can sum
        above 100%.
      </p>
    </div>
  )
}
