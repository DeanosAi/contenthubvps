"use client"

import type { Job } from '@/lib/types'
import { computeDashboardCounts } from '@/lib/calendar'

/** Identifier for each dashboard widget. The parent maps these to the
 * appropriate filter state when a widget is clicked. */
export type WidgetKey =
  | 'overdue'
  | 'dueThisWeek'
  | 'awaitingApproval'
  | 'recentlyPosted'
  | 'inFlight'

interface WidgetDef {
  key: WidgetKey
  label: string
  /** Tone for the count (red for warnings, etc). */
  accent: 'red' | 'amber' | 'cyan' | 'emerald' | 'slate'
  /** Optional one-line caption shown under the count. */
  caption?: string
}

const WIDGETS: WidgetDef[] = [
  { key: 'overdue', label: 'Overdue', accent: 'red', caption: 'Past due, not yet posted' },
  { key: 'dueThisWeek', label: 'Due this week', accent: 'amber', caption: 'Next 7 days' },
  { key: 'awaitingApproval', label: 'Awaiting approval', accent: 'cyan', caption: 'Needs client sign-off' },
  { key: 'recentlyPosted', label: 'Recently posted', accent: 'emerald', caption: 'Last 7 days' },
  { key: 'inFlight', label: 'In flight', accent: 'slate', caption: 'Excluding archive' },
]

const ACCENT_RING: Record<WidgetDef['accent'], string> = {
  red: 'ring-red-500/30 hover:ring-red-500/60',
  amber: 'ring-amber-500/30 hover:ring-amber-500/60',
  cyan: 'ring-cyan-500/30 hover:ring-cyan-500/60',
  emerald: 'ring-emerald-500/30 hover:ring-emerald-500/60',
  slate: 'ring-slate-500/30 hover:ring-slate-500/60',
}

const ACCENT_TEXT: Record<WidgetDef['accent'], string> = {
  red: 'text-red-300',
  amber: 'text-amber-300',
  cyan: 'text-cyan-300',
  emerald: 'text-emerald-300',
  slate: 'text-slate-300',
}

const ACCENT_DOT: Record<WidgetDef['accent'], string> = {
  red: 'bg-red-400',
  amber: 'bg-amber-400',
  cyan: 'bg-cyan-400',
  emerald: 'bg-emerald-400',
  slate: 'bg-slate-400',
}

/**
 * Strip of clickable summary cards rendered above the kanban. Each card
 * shows a count of jobs in some interesting bucket; clicking applies the
 * matching filter to the kanban below.
 *
 * The widgets compute their counts from the FULL job list (not the
 * already-filtered one) — otherwise applying a filter would zero-out
 * the other widgets, which is confusing. The "in flight" total includes
 * everything not archived and is the headline metric on the right.
 */
export function DashboardWidgets({
  jobs,
  activeWidget,
  onSelectWidget,
}: {
  /** Full job list for the current workspace selection (NOT filtered). */
  jobs: Job[]
  /** Which widget is currently driving the kanban filter, if any.
   * Used to highlight the active card. Pass null when filters are at default. */
  activeWidget: WidgetKey | null
  /** Click handler. Pass `null` when the same widget is clicked again to
   * reset. The parent translates the key into a JobFilterState patch. */
  onSelectWidget: (next: WidgetKey | null) => void
}) {
  const counts = computeDashboardCounts(jobs)
  const valueByKey: Record<WidgetKey, number> = {
    overdue: counts.overdue,
    dueThisWeek: counts.dueThisWeek,
    awaitingApproval: counts.awaitingApproval,
    recentlyPosted: counts.recentlyPosted,
    inFlight: counts.inFlight,
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {WIDGETS.map((w) => {
        const isActive = activeWidget === w.key
        const value = valueByKey[w.key]
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => onSelectWidget(isActive ? null : w.key)}
            className={`text-left rounded-2xl border bg-[hsl(var(--card))] p-4 ring-1 ring-transparent transition-all ${
              isActive
                ? `${ACCENT_RING[w.accent]} ring-2`
                : `${ACCENT_RING[w.accent]} hover:ring-1`
            }`}
            aria-pressed={isActive}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${ACCENT_DOT[w.accent]}`} />
              <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {w.label}
              </span>
            </div>
            <p className={`mt-2 text-3xl font-bold ${ACCENT_TEXT[w.accent]}`}>{value}</p>
            {w.caption && (
              <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{w.caption}</p>
            )}
            {isActive && (
              <p className="mt-2 text-[10px] uppercase tracking-wider text-[hsl(var(--primary))]">
                Filtering kanban — click again to clear
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
