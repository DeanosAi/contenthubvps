"use client"

import type { Recommendation, Severity } from '@/lib/recommendations'

/** Visual treatment per severity. Designed to read calmly on screen
 * even when many recommendations fire at once. */
const SEVERITY_STYLE: Record<
  Severity,
  { dot: string; label: string; ring: string }
> = {
  critical: {
    dot: 'bg-red-500',
    label: 'Critical',
    ring: 'ring-red-500/30',
  },
  warning: {
    dot: 'bg-amber-500',
    label: 'Warning',
    ring: 'ring-amber-500/30',
  },
  opportunity: {
    dot: 'bg-cyan-500',
    label: 'Opportunity',
    ring: 'ring-cyan-500/30',
  },
  info: {
    dot: 'bg-emerald-500',
    label: 'Info',
    ring: 'ring-emerald-500/30',
  },
}

export function ReportsDeepDiveRecommendations({
  recommendations,
}: {
  recommendations: Recommendation[]
}) {
  if (recommendations.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No recommendations triggered for this period — your numbers look stable.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {recommendations.map((r) => {
        const s = SEVERITY_STYLE[r.severity]
        return (
          <div
            key={r.id}
            className={`rounded-2xl border bg-[hsl(var(--card))] p-4 ring-1 ${s.ring}`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">{r.title}</h4>
                  <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {s.label}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                  {r.body}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
