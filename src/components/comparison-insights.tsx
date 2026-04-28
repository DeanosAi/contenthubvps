"use client"

import type {
  ComparisonInsight,
  InsightSeverity,
} from '@/lib/comparison'

/**
 * Insight cards from the comparison rules engine. Severity drives the
 * visual weight (caution > highlight > note) but every card is calm
 * enough to read in bulk without feeling alarmist.
 */

const STYLE: Record<InsightSeverity, { dot: string; ring: string; label: string }> = {
  caution: {
    dot: 'bg-amber-500',
    ring: 'ring-amber-500/30',
    label: 'Caution',
  },
  highlight: {
    dot: 'bg-cyan-500',
    ring: 'ring-cyan-500/30',
    label: 'Highlight',
  },
  note: {
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-500/30',
    label: 'Note',
  },
}

export function ComparisonInsights({
  insights,
}: {
  insights: ComparisonInsight[]
}) {
  if (insights.length === 0) {
    return (
      <div className="rounded-2xl border bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">
          No insights triggered for this comparison — the numbers look stable
          across the set.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {insights.map((i) => {
        const s = STYLE[i.severity]
        return (
          <div
            key={i.id}
            className={`rounded-2xl border bg-white surface-shadow p-4 ring-1 ${s.ring}`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">{i.title}</h4>
                  <span className="text-[10px] uppercase tracking-wider text-slate-600">
                    {s.label}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {i.body}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
