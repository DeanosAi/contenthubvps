// Pure analytics for the quarterly deep-dive report.
// Builds on src/lib/reports.ts — extends rather than replaces it.
// All math is deterministic and runs natively (no AI APIs).
//
// Two big concepts in this file:
//
//  (1) PRIOR-PERIOD COMPARISON: given a date range, the deep-dive
//      automatically computes the immediately-preceding period of equal
//      length and runs the same numbers against it. "This quarter vs
//      last quarter" without making the user specify both windows.
//
//  (2) MONTHLY BUCKETING: jobs and snapshots within the report window
//      are grouped by their month of activity, producing a time-series
//      that the deep-dive UI and PDF can render as month-by-month bars
//      / trend lines.
//
// The "comparison" data is honest about sparsity — when prior-period
// data is missing or too thin, comparison fields are null rather than
// 0, so the UI and rules engine can render "—" / skip rules instead
// of producing misleading "down 100%!" arrows.

import type { Job, MetricSnapshot } from './types'
import {
  computeHeadlineNumbers,
  computePlatformBreakdown,
  jobsInScope,
  snapshotsInScope,
  type HeadlineNumbers,
  type PlatformRow,
  type ReportScope,
} from './reports'

// =====================================================================
// Window arithmetic
// =====================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** ISO local-date helper. Duplicated from reports.ts so this file can
 * stand alone, but they're equivalent. */
function localIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Length of a date range in days, inclusive of both ends.
 * "2026-01-01" to "2026-01-31" = 31 days. */
export function rangeLengthDays(fromIso: string | null, toIso: string | null): number {
  if (!fromIso || !toIso) return 0
  const from = new Date(fromIso + 'T00:00:00').getTime()
  const to = new Date(toIso + 'T00:00:00').getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0
  return Math.round((to - from) / MS_PER_DAY) + 1
}

/** Compute the immediately-preceding equal-length window.
 * For range Jan 1 – March 31 (90 days), prior is Oct 3 – Dec 31. */
export function priorPeriodOf(
  fromIso: string | null,
  toIso: string | null,
): { fromIso: string | null; toIso: string | null } {
  const days = rangeLengthDays(fromIso, toIso)
  if (days === 0 || !fromIso || !toIso) return { fromIso: null, toIso: null }
  const from = new Date(fromIso + 'T00:00:00')
  // Prior period ends the day before the current period starts.
  const priorEnd = new Date(from)
  priorEnd.setDate(from.getDate() - 1)
  // Prior period starts `days - 1` days before that (so total length matches).
  const priorStart = new Date(priorEnd)
  priorStart.setDate(priorEnd.getDate() - (days - 1))
  return {
    fromIso: localIsoDate(priorStart),
    toIso: localIsoDate(priorEnd),
  }
}

// =====================================================================
// Monthly bucketing
// =====================================================================

/** Iterate every month-start (yyyy-mm-01) covering the date range,
 * inclusive. For "2026-01-15" to "2026-03-10" returns [Jan 1, Feb 1, Mar 1]. */
export function monthsInRange(fromIso: string, toIso: string): string[] {
  const from = new Date(fromIso + 'T00:00:00')
  const to = new Date(toIso + 'T00:00:00')
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return []
  const months: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  const last = new Date(to.getFullYear(), to.getMonth(), 1)
  while (cursor.getTime() <= last.getTime()) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    months.push(`${y}-${m}-01`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

export interface MonthlyPoint {
  /** First-of-month ISO date as the bucket key. */
  monthIso: string
  /** Display label, locale-formatted (e.g. "Jan 2026"). */
  label: string
  /** Posts that became `posted` during this month (within the scope). */
  posts: number
  /** Sum of views from snapshots captured this month. */
  views: number
  /** Sum of engagement actions (likes+comments+shares+saves) from snapshots. */
  engagement: number
  /** Mean engagement rate across snapshots in this month, or null if none. */
  avgEngagementRate: number | null
}

/** Build month-by-month rollup of posts + metric snapshots over a date
 * range. Each month is included even if empty (zeros), so the chart has
 * a continuous x-axis. */
export function buildMonthlyTimeSeries(
  jobs: Job[],
  snapshots: MetricSnapshot[],
  fromIso: string,
  toIso: string,
  locale?: string,
): MonthlyPoint[] {
  const months = monthsInRange(fromIso, toIso)
  if (months.length === 0) return []

  // Pre-bucket: month → list of jobs / snapshots.
  const postsByMonth = new Map<string, number>()
  for (const j of jobs) {
    if (!j.postedAt) continue
    const d = new Date(j.postedAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    postsByMonth.set(key, (postsByMonth.get(key) ?? 0) + 1)
  }

  const viewsByMonth = new Map<string, number>()
  const engagementByMonth = new Map<string, number>()
  const ratesByMonth = new Map<string, number[]>()
  for (const s of snapshots) {
    const d = new Date(s.capturedAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    if (s.metrics.views != null) {
      viewsByMonth.set(key, (viewsByMonth.get(key) ?? 0) + s.metrics.views)
    }
    const eng =
      (s.metrics.likes ?? 0) +
      (s.metrics.comments ?? 0) +
      (s.metrics.shares ?? 0) +
      (s.metrics.saves ?? 0)
    if (eng > 0) {
      engagementByMonth.set(key, (engagementByMonth.get(key) ?? 0) + eng)
    }
    if (s.metrics.engagementRate != null) {
      const arr = ratesByMonth.get(key) ?? []
      arr.push(s.metrics.engagementRate)
      ratesByMonth.set(key, arr)
    }
  }

  return months.map((monthIso) => {
    const d = new Date(monthIso + 'T00:00:00')
    const label = d.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
    const rates = ratesByMonth.get(monthIso) ?? []
    return {
      monthIso,
      label,
      posts: postsByMonth.get(monthIso) ?? 0,
      views: viewsByMonth.get(monthIso) ?? 0,
      engagement: engagementByMonth.get(monthIso) ?? 0,
      avgEngagementRate: rates.length
        ? rates.reduce((a, b) => a + b, 0) / rates.length
        : null,
    }
  })
}

// =====================================================================
// Trend deltas
// =====================================================================

export interface TrendDelta {
  /** Current value. */
  current: number
  /** Prior period's equivalent. */
  prior: number
  /** Percentage change from prior to current, as a fraction (0.12 = +12%).
   * Null when prior is 0 (can't divide by zero meaningfully — UI shows "—"). */
  pctChange: number | null
  /** Absolute change. Always defined. */
  absChange: number
  /** Direction tag for UI consumption. 'flat' when within ±2%. */
  direction: 'up' | 'down' | 'flat'
}

/** Build a delta from current and prior values. Honest about division
 * by zero (returns null pctChange when prior is 0). */
export function computeDelta(current: number, prior: number): TrendDelta {
  const absChange = current - prior
  let pctChange: number | null = null
  if (prior > 0) pctChange = (current - prior) / prior
  let direction: TrendDelta['direction']
  if (pctChange == null) {
    direction = current > 0 ? 'up' : 'flat'
  } else if (Math.abs(pctChange) < 0.02) {
    direction = 'flat'
  } else if (pctChange > 0) {
    direction = 'up'
  } else {
    direction = 'down'
  }
  return { current, prior, pctChange, absChange, direction }
}

// =====================================================================
// Per-platform comparison (current vs prior)
// =====================================================================

export interface PlatformTrendRow {
  platform: string
  current: PlatformRow
  prior: PlatformRow | null
  posts: TrendDelta
  views: TrendDelta
  engagement: TrendDelta
  avgEngagementRate: TrendDelta
}

/** Build a comparison table with one row per platform that appears in
 * EITHER the current or prior window. Platforms with no current activity
 * still show up so we can flag "stopped posting on TikTok" type gaps. */
export function computePlatformTrends(
  currentJobs: Job[],
  priorJobs: Job[],
): PlatformTrendRow[] {
  const currentRows = computePlatformBreakdown(currentJobs)
  const priorRows = computePlatformBreakdown(priorJobs)
  const priorByPlatform = new Map(priorRows.map((r) => [r.platform, r]))
  const allPlatforms = new Set<string>()
  for (const r of currentRows) allPlatforms.add(r.platform)
  for (const r of priorRows) allPlatforms.add(r.platform)

  const rows: PlatformTrendRow[] = []
  for (const platform of allPlatforms) {
    const current = currentRows.find((r) => r.platform === platform) ?? {
      platform,
      postsCount: 0,
      totalViews: 0,
      totalEngagement: 0,
      avgEngagementRate: 0,
    }
    const prior = priorByPlatform.get(platform) ?? null
    rows.push({
      platform,
      current,
      prior,
      posts: computeDelta(current.postsCount, prior?.postsCount ?? 0),
      views: computeDelta(current.totalViews, prior?.totalViews ?? 0),
      engagement: computeDelta(
        current.totalEngagement,
        prior?.totalEngagement ?? 0,
      ),
      avgEngagementRate: computeDelta(
        current.avgEngagementRate,
        prior?.avgEngagementRate ?? 0,
      ),
    })
  }
  // Sort by current engagement desc, with platforms that became silent
  // (current=0) at the bottom so they don't crowd the top of the list.
  rows.sort((a, b) => b.current.totalEngagement - a.current.totalEngagement)
  return rows
}

// =====================================================================
// Posting cadence
// =====================================================================

export interface CadenceStats {
  totalPosts: number
  /** Posts per week (totalPosts / weeks-in-range, rounded to 1 decimal). */
  postsPerWeek: number
  /** Longest gap between consecutive posts within the range, in days.
   * Null if there are < 2 posts (gap is undefined). */
  longestGapDays: number | null
  /** Number of distinct days with at least one post. */
  activeDays: number
  /** Weekday distribution. Index 0 = Sunday. */
  byWeekday: number[]
}

export function computeCadence(jobs: Job[], fromIso: string, toIso: string): CadenceStats {
  const days = rangeLengthDays(fromIso, toIso)
  const weeks = Math.max(1, days / 7)

  const dates: number[] = []
  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  const activeDaySet = new Set<string>()
  for (const j of jobs) {
    if (!j.postedAt) continue
    const d = new Date(j.postedAt)
    const t = d.getTime()
    if (Number.isFinite(t)) {
      dates.push(t)
      byWeekday[d.getDay()]++
      activeDaySet.add(localIsoDate(d))
    }
  }
  dates.sort((a, b) => a - b)
  let longestGap: number | null = null
  for (let i = 1; i < dates.length; i++) {
    const gap = (dates[i] - dates[i - 1]) / MS_PER_DAY
    if (longestGap == null || gap > longestGap) longestGap = gap
  }
  return {
    totalPosts: jobs.length,
    postsPerWeek: Math.round((jobs.length / weeks) * 10) / 10,
    longestGapDays: longestGap == null ? null : Math.round(longestGap),
    activeDays: activeDaySet.size,
    byWeekday,
  }
}

// =====================================================================
// Top + bottom performers (deep-dive uses both)
// =====================================================================

export interface PerformerRow {
  job: Job
  views: number
  engagement: number
  engagementRate: number | null
}

function jobToPerformerRow(job: Job): PerformerRow | null {
  if (!job.liveMetrics) return null
  const m = job.liveMetrics
  const engagement =
    (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0)
  return {
    job,
    views: m.views ?? 0,
    engagement,
    engagementRate: m.engagementRate,
  }
}

/** Top N posts overall by engagement. */
export function topPerformers(jobs: Job[], n = 10): PerformerRow[] {
  return jobs
    .map(jobToPerformerRow)
    .filter((r): r is PerformerRow => r != null)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, n)
}

/** Bottom N posts overall — but only those with metrics (we don't include
 * unfetched posts as "bottom performers" because the data isn't there). */
export function bottomPerformers(jobs: Job[], n = 5): PerformerRow[] {
  const withMetrics = jobs
    .map(jobToPerformerRow)
    .filter((r): r is PerformerRow => r != null)
  // Need at least N+1 metric'd posts before showing bottom performers —
  // otherwise "bottom 5 of 5" is everyone, which isn't a useful insight.
  if (withMetrics.length < n + 1) return []
  return withMetrics.sort((a, b) => a.engagement - b.engagement).slice(0, n)
}

// =====================================================================
// The big aggregate the rules engine + UI consume
// =====================================================================

export interface DeepDive {
  scope: ReportScope
  priorScope: ReportScope
  currentJobs: Job[]
  priorJobs: Job[]
  current: HeadlineNumbers
  prior: HeadlineNumbers
  /** Trend deltas on the headline numbers. */
  trends: {
    totalPosts: TrendDelta
    totalViews: TrendDelta
    totalEngagement: TrendDelta
    avgEngagementRate: TrendDelta
  }
  monthly: MonthlyPoint[]
  platforms: PlatformTrendRow[]
  cadence: CadenceStats
  topPerformers: PerformerRow[]
  bottomPerformers: PerformerRow[]
  /** True when the period has zero posts AND zero metric data — most rules
   * shouldn't fire and the UI should render the "no data yet" state. */
  hasAnyData: boolean
}

/** Build the full deep-dive summary from the loaded jobs + snapshots
 * for the report scope. The UI and the rules engine both read from this. */
export function buildDeepDive(
  jobs: Job[],
  snapshots: MetricSnapshot[],
  scope: ReportScope,
): DeepDive {
  const priorScope: ReportScope = {
    workspaceId: scope.workspaceId,
    ...priorPeriodOf(scope.fromIso, scope.toIso),
  }

  // Filter jobs/snapshots to the two windows. The reports.ts helpers
  // already do "stage=posted AND in range" filtering for us.
  const currentJobs = jobsInScope(jobs, scope)
  const priorJobs = jobsInScope(jobs, priorScope)
  const currentSnaps = snapshotsInScope(snapshots, scope)

  const current = computeHeadlineNumbers(currentJobs)
  const prior = computeHeadlineNumbers(priorJobs)

  const monthly =
    scope.fromIso && scope.toIso
      ? buildMonthlyTimeSeries(currentJobs, currentSnaps, scope.fromIso, scope.toIso)
      : []
  const platforms = computePlatformTrends(currentJobs, priorJobs)
  const cadence = computeCadence(
    currentJobs,
    scope.fromIso ?? '',
    scope.toIso ?? '',
  )

  const hasAnyData = current.totalPosts > 0 || current.jobsWithMetrics > 0

  return {
    scope,
    priorScope,
    currentJobs,
    priorJobs,
    current,
    prior,
    trends: {
      totalPosts: computeDelta(current.totalPosts, prior.totalPosts),
      totalViews: computeDelta(current.totalViews, prior.totalViews),
      totalEngagement: computeDelta(current.totalEngagement, prior.totalEngagement),
      avgEngagementRate: computeDelta(
        current.avgEngagementRate,
        prior.avgEngagementRate,
      ),
    },
    monthly,
    platforms,
    cadence,
    topPerformers: topPerformers(currentJobs, 10),
    bottomPerformers: bottomPerformers(currentJobs, 5),
    hasAnyData,
  }
}

// =====================================================================
// Formatting helpers specific to the deep-dive
// =====================================================================

/** Format a TrendDelta's pctChange like "+12.3%" / "-4.1%" / "—". */
export function formatPctChange(d: TrendDelta): string {
  if (d.pctChange == null) return '—'
  const pct = d.pctChange * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

/** Direction arrow glyph for inline use. */
export function directionGlyph(direction: TrendDelta['direction']): string {
  if (direction === 'up') return '▲'
  if (direction === 'down') return '▼'
  return '◆'
}
