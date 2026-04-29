// Pure analytics computations for the reports page. NO React, NO async,
// NO AI APIs — just deterministic functions over Job and MetricSnapshot
// arrays. Reusable from the on-screen report, the PDF, and (later) the
// quarterly deep-dive.
//
// Design principle: every number on the page comes from a function in
// this file. The component just renders. That makes the math testable,
// auditable, and consistent between the screen and the PDF.

import type { Job, LiveMetrics, MetricSnapshot } from './types'

// =====================================================================
// Date helpers
// =====================================================================

/** Local-midnight ISO date string (yyyy-mm-dd). Used as bucket keys. */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** First day of the month a date belongs to, as ISO yyyy-mm-01. */
export function monthBucket(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/** Inclusive lower-bound (start-of-day) and exclusive upper-bound (start
 * of the day AFTER the picker's end date) for a date range filter.
 * Returns null if the input strings are missing/invalid. */
export function dateRangeBoundsMs(
  fromIso: string | null,
  toIso: string | null,
): { fromMs: number | null; toMs: number | null } {
  function parseStart(s: string | null): number | null {
    if (!s) return null
    const d = new Date(s)
    if (isNaN(d.getTime())) return null
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  function parseEndExclusive(s: string | null): number | null {
    if (!s) return null
    const d = new Date(s)
    if (isNaN(d.getTime())) return null
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1) // exclusive end
    return d.getTime()
  }
  return { fromMs: parseStart(fromIso), toMs: parseEndExclusive(toIso) }
}

// =====================================================================
// Filtering
// =====================================================================

export interface ReportScope {
  workspaceId: string | null // null = all workspaces
  fromIso: string | null
  toIso: string | null
}

/** Jobs in the report scope: filtered to workspace + posted within range.
 * "Posted" specifically — drafts and in-progress jobs don't count toward
 * report metrics. We use `posted_at` (not `created_at`) so a job created
 * months ago but posted recently shows up in the recent report. */
export function jobsInScope(jobs: Job[], scope: ReportScope): Job[] {
  const { fromMs, toMs } = dateRangeBoundsMs(scope.fromIso, scope.toIso)
  return jobs.filter((j) => {
    if (scope.workspaceId && j.workspaceId !== scope.workspaceId) return false
    if (j.stage !== 'posted') return false
    if (!j.postedAt) return false
    const postedMs = new Date(j.postedAt).getTime()
    if (!Number.isFinite(postedMs)) return false
    if (fromMs != null && postedMs < fromMs) return false
    if (toMs != null && postedMs >= toMs) return false
    return true
  })
}

/** Snapshots in the report scope: filtered to workspace + captured within
 * range. Used for time-series charts where we want raw fetch points. */
export function snapshotsInScope(
  snapshots: MetricSnapshot[],
  scope: ReportScope,
): MetricSnapshot[] {
  const { fromMs, toMs } = dateRangeBoundsMs(scope.fromIso, scope.toIso)
  return snapshots.filter((s) => {
    if (scope.workspaceId && s.workspaceId !== scope.workspaceId) return false
    const ms = new Date(s.capturedAt).getTime()
    if (!Number.isFinite(ms)) return false
    if (fromMs != null && ms < fromMs) return false
    if (toMs != null && ms >= toMs) return false
    return true
  })
}

// =====================================================================
// Headline numbers
// =====================================================================

export interface HeadlineNumbers {
  /** Number of jobs that went to `posted` within the range. */
  totalPosts: number
  /** Sum of views across all in-scope jobs' liveMetrics. */
  totalViews: number
  /** Sum of all engagement actions (likes + comments + shares + saves). */
  totalEngagement: number
  /** Average engagement rate across in-scope jobs that have a rate. */
  avgEngagementRate: number
  /** How many of the in-scope jobs have at least one metric reading.
   * When 0, the rest of the numbers are "no data yet" rather than "0". */
  jobsWithMetrics: number
}

/** Sum a metric across an array of jobs, treating null as 0 but tracking
 * how many jobs actually contributed (so we can distinguish "0 because
 * everyone got 0 views" from "0 because nobody has metrics yet"). */
function sumMetric(jobs: Job[], pick: (m: LiveMetrics) => number | null): {
  sum: number
  contributors: number
} {
  let sum = 0
  let contributors = 0
  for (const j of jobs) {
    if (!j.liveMetrics) continue
    const v = pick(j.liveMetrics)
    if (v == null) continue
    sum += v
    contributors++
  }
  return { sum, contributors }
}

export function computeHeadlineNumbers(jobs: Job[]): HeadlineNumbers {
  const totalPosts = jobs.length

  const views = sumMetric(jobs, (m) => m.views)
  const likes = sumMetric(jobs, (m) => m.likes)
  const comments = sumMetric(jobs, (m) => m.comments)
  const shares = sumMetric(jobs, (m) => m.shares)
  const saves = sumMetric(jobs, (m) => m.saves)

  const totalEngagement = likes.sum + comments.sum + shares.sum + saves.sum
  const jobsWithMetrics = jobs.filter((j) => j.liveMetrics != null).length

  // Average engagement rate across jobs that report one. We use the
  // arithmetic mean of per-job rates rather than a weighted average,
  // which matches how the desktop app computed it and is what "average
  // engagement" intuitively means to non-analyst readers.
  const ratesPresent: number[] = []
  for (const j of jobs) {
    if (!j.liveMetrics) continue
    const r = j.liveMetrics.engagementRate
    if (r != null && Number.isFinite(r)) ratesPresent.push(r)
  }
  const avgEngagementRate = ratesPresent.length
    ? ratesPresent.reduce((a, b) => a + b, 0) / ratesPresent.length
    : 0

  return {
    totalPosts,
    totalViews: views.sum,
    totalEngagement,
    avgEngagementRate,
    jobsWithMetrics,
  }
}

// =====================================================================
// Platform breakdown
// =====================================================================

export interface PlatformRow {
  platform: string
  postsCount: number
  totalViews: number
  totalEngagement: number
  avgEngagementRate: number
}

/** Group in-scope jobs by their `platform` field, summing metrics per
 * platform. Platform-less jobs go into a synthetic 'unspecified' bucket. */
export function computePlatformBreakdown(jobs: Job[]): PlatformRow[] {
  const buckets = new Map<string, Job[]>()
  for (const j of jobs) {
    const key = j.platform || 'unspecified'
    const arr = buckets.get(key) ?? []
    arr.push(j)
    buckets.set(key, arr)
  }
  const rows: PlatformRow[] = []
  for (const [platform, group] of buckets) {
    const headline = computeHeadlineNumbers(group)
    rows.push({
      platform,
      postsCount: group.length,
      totalViews: headline.totalViews,
      totalEngagement: headline.totalEngagement,
      avgEngagementRate: headline.avgEngagementRate,
    })
  }
  // Sort by total engagement desc — most active platforms first.
  rows.sort((a, b) => b.totalEngagement - a.totalEngagement)
  return rows
}

// =====================================================================
// Round 7.12 — Jobs by Type breakdown
// =====================================================================

export interface JobTypeRow {
  /** The type label, e.g. "Video", "Graphic Design", or "Uncategorised" */
  type: string
  /** How many jobs include this type. A single job with multiple
   *  types is counted once in EACH bucket — this is intentional and
   *  the way the report explains team workload. The total across
   *  buckets will exceed the total number of jobs. */
  count: number
  /** Percentage of total jobs (rounded). Used for visual bars in
   *  the report UI. */
  percentage: number
}

/**
 * Round 7.12 — count jobs per type for the date range.
 *
 * IMPORTANT: a job with multiple types contributes +1 to each bucket.
 * So if the team did 100 jobs and they all had Video + Social Post,
 * Video would show 100 and Social Post would also show 100, totalling
 * 200 across buckets. This is the right answer when the question is
 * "how much VIDEO work did we do" — a single multi-type job DID
 * involve doing video work.
 *
 * Jobs with empty contentTypes are bucketed as "Uncategorised" so
 * the report shows the gap rather than hiding it.
 *
 * Percentages are computed as `count / total_jobs * 100` (NOT
 * count / sum_of_counts, which would always sum to 100% across buckets
 * even when most jobs are multi-type). This means the percentages
 * can sum to >100% — that's the right read.
 */
export function computeJobTypeBreakdown(jobs: Job[]): JobTypeRow[] {
  const counts = new Map<string, number>()
  for (const j of jobs) {
    const types = j.contentTypes ?? []
    if (types.length === 0) {
      counts.set('Uncategorised', (counts.get('Uncategorised') ?? 0) + 1)
      continue
    }
    for (const t of types) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }

  const totalJobs = jobs.length
  const rows: JobTypeRow[] = []
  for (const [type, count] of counts) {
    rows.push({
      type,
      count,
      percentage: totalJobs > 0 ? Math.round((count / totalJobs) * 100) : 0,
    })
  }

  // Sort by count desc — most-frequent types first. "Uncategorised"
  // sinks to the bottom regardless so it's visually separated from
  // the main categories.
  rows.sort((a, b) => {
    if (a.type === 'Uncategorised') return 1
    if (b.type === 'Uncategorised') return -1
    return b.count - a.count
  })
  return rows
}

// =====================================================================
// Top performers
// =====================================================================

export interface TopPostRow {
  job: Job
  views: number
  engagement: number
  engagementRate: number | null
}

/** Convert a job to a top-post row, or null if it has no metrics
 * (filtered out at a higher level). */
function jobToTopRow(job: Job): TopPostRow | null {
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

/** Top N posts overall, sorted by engagement (count of actions). */
export function topPostsOverall(jobs: Job[], n = 5): TopPostRow[] {
  return jobs
    .map(jobToTopRow)
    .filter((r): r is TopPostRow => r != null)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, n)
}

/** Top N posts per platform, returned as a map of platform → rows. */
export function topPostsPerPlatform(
  jobs: Job[],
  n = 5,
): Map<string, TopPostRow[]> {
  const buckets = new Map<string, Job[]>()
  for (const j of jobs) {
    const key = j.platform || 'unspecified'
    const arr = buckets.get(key) ?? []
    arr.push(j)
    buckets.set(key, arr)
  }
  const result = new Map<string, TopPostRow[]>()
  for (const [platform, group] of buckets) {
    const top = group
      .map(jobToTopRow)
      .filter((r): r is TopPostRow => r != null)
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, n)
    if (top.length > 0) result.set(platform, top)
  }
  return result
}

// =====================================================================
// Time-series for charts
// =====================================================================

export interface TimeSeriesPoint {
  /** ISO date (yyyy-mm-dd) — bucket label. */
  date: string
  /** Posts that became `posted` on this day (inclusive). */
  posts: number
  /** Sum of views across snapshots captured on this day. */
  views: number
  /** Sum of engagement actions across snapshots captured on this day. */
  engagement: number
}

/** Build a daily time-series of posts + cumulative metrics over a date
 * range. Iterates each day in the range so days without data still appear
 * (as zeros), giving the chart a smooth axis. */
export function buildDailyTimeSeries(
  jobs: Job[],
  snapshots: MetricSnapshot[],
  scope: ReportScope,
): TimeSeriesPoint[] {
  if (!scope.fromIso || !scope.toIso) return []

  // Bucket jobs by their posted-on day.
  const postsByDay = new Map<string, number>()
  for (const j of jobs) {
    if (!j.postedAt) continue
    const day = localIsoDate(new Date(j.postedAt))
    postsByDay.set(day, (postsByDay.get(day) ?? 0) + 1)
  }

  // Bucket snapshots by their captured-on day, summing metrics.
  const viewsByDay = new Map<string, number>()
  const engagementByDay = new Map<string, number>()
  for (const s of snapshots) {
    const day = localIsoDate(new Date(s.capturedAt))
    if (s.metrics.views != null) {
      viewsByDay.set(day, (viewsByDay.get(day) ?? 0) + s.metrics.views)
    }
    const eng =
      (s.metrics.likes ?? 0) +
      (s.metrics.comments ?? 0) +
      (s.metrics.shares ?? 0) +
      (s.metrics.saves ?? 0)
    if (eng > 0) {
      engagementByDay.set(day, (engagementByDay.get(day) ?? 0) + eng)
    }
  }

  // Walk the date range day by day, emitting a point for each.
  const start = new Date(scope.fromIso)
  start.setHours(0, 0, 0, 0)
  const end = new Date(scope.toIso)
  end.setHours(0, 0, 0, 0)
  const points: TimeSeriesPoint[] = []
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const day = localIsoDate(d)
    points.push({
      date: day,
      posts: postsByDay.get(day) ?? 0,
      views: viewsByDay.get(day) ?? 0,
      engagement: engagementByDay.get(day) ?? 0,
    })
  }
  return points
}

// =====================================================================
// Formatting helpers (used by both the page and the PDF)
// =====================================================================

/** Format a number compactly: 1234 → "1,234", 12345 → "12.3k", 1234567 → "1.2M". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString()
}

/** Format a fractional engagement rate as a percentage with one decimal. */
export function formatEngagementRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return (rate * 100).toFixed(2) + '%'
}

/** Short day label "Mon 5 May" / "5 May 2026" depending on year. */
export function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Default range: trailing 30 days ending today (inclusive). */
export function defaultRange(): { fromIso: string; toIso: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - 29)
  return {
    fromIso: localIsoDate(start),
    toIso: localIsoDate(today),
  }
}
