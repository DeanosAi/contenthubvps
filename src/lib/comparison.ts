// Comparison-specific analytics for the campaign-report.
// Scope: a hand-picked or campaign-filtered SET of posts. The math
// answers "which post performed best, and what differs between them?"
// — different from reports.ts (whole-workspace-over-time) and
// quarterly.ts (current-period vs prior-period).
//
// Both the on-screen comparison UI and the comparison PDF read from
// the same buildComparison() output, so the numbers stay consistent.
// All deterministic, all native, no AI.

import type { Job, LiveMetrics } from './types'

// =====================================================================
// Per-post derived metrics
// =====================================================================

export interface ComparisonPost {
  job: Job
  /** Sum of engagement actions on this post. 0 if no metrics yet
   * (vs null for "no data" — we use 0 here so sorting works
   * predictably; the UI distinguishes via `hasMetrics`). */
  engagement: number
  views: number
  /** Engagement rate as a fraction (0.0234 = 2.34%) or null if not
   * surfaced. */
  engagementRate: number | null
  /** True iff the underlying job has at least one substantive metric
   * value. Used to show "no data" badges in the table. */
  hasMetrics: boolean
}

function buildPost(job: Job): ComparisonPost {
  const m: LiveMetrics | null = job.liveMetrics
  if (!m) {
    return { job, engagement: 0, views: 0, engagementRate: null, hasMetrics: false }
  }
  const engagement =
    (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0)
  const views = m.views ?? 0
  const hasMetrics =
    (m.views ?? 0) > 0 ||
    (m.likes ?? 0) > 0 ||
    (m.comments ?? 0) > 0 ||
    (m.shares ?? 0) > 0 ||
    (m.saves ?? 0) > 0
  return {
    job,
    engagement,
    views,
    engagementRate: m.engagementRate,
    hasMetrics,
  }
}

// =====================================================================
// Headline summary across the comparison set
// =====================================================================

export interface ComparisonSummary {
  totalPosts: number
  postsWithMetrics: number
  totalViews: number
  totalEngagement: number
  meanEngagement: number
  medianEngagement: number
  /** Best (highest-engagement) post. Null if zero posts. */
  best: ComparisonPost | null
  /** Worst (lowest-engagement, but only counting posts with metrics).
   * Null if fewer than 2 metric-bearing posts (one is best, no "worst"). */
  worst: ComparisonPost | null
  /** Useful inverse-callout: post with highest engagement RATE, which
   * isn't always the post with highest raw engagement. */
  bestByRate: ComparisonPost | null
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function summariseComparison(posts: ComparisonPost[]): ComparisonSummary {
  const withMetrics = posts.filter((p) => p.hasMetrics)
  const engagements = withMetrics.map((p) => p.engagement)
  const totalEngagement = engagements.reduce((a, b) => a + b, 0)
  const totalViews = withMetrics.reduce((sum, p) => sum + p.views, 0)
  const meanEngagement =
    engagements.length > 0 ? totalEngagement / engagements.length : 0
  const medianEngagement = median(engagements)

  // Sort copies for best/worst — don't mutate the input.
  const byEng = [...posts].sort((a, b) => b.engagement - a.engagement)
  const best = byEng.find((p) => p.hasMetrics) ?? null

  const byEngAsc = [...withMetrics].sort((a, b) => a.engagement - b.engagement)
  const worst = withMetrics.length >= 2 ? byEngAsc[0] : null

  // Best by rate — only meaningful when at least one post reports a rate.
  const withRate = withMetrics.filter((p) => p.engagementRate != null)
  const bestByRate = withRate.length > 0
    ? [...withRate].sort(
        (a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0),
      )[0]
    : null

  return {
    totalPosts: posts.length,
    postsWithMetrics: withMetrics.length,
    totalViews,
    totalEngagement,
    meanEngagement,
    medianEngagement,
    best,
    worst,
    bestByRate,
  }
}

// =====================================================================
// Feature breakdowns — how does each axis (platform, content type,
// weekday) contribute to engagement within this set?
// =====================================================================

export interface FeatureBreakdownRow {
  /** Feature value, e.g. "instagram" or "Monday". */
  value: string
  postsCount: number
  totalEngagement: number
  meanEngagement: number
  /** Share of total engagement attributable to this feature value
   * (0.0 to 1.0). Useful for "X% of engagement came from instagram". */
  shareOfEngagement: number
}

function breakdownBy(
  posts: ComparisonPost[],
  picker: (p: ComparisonPost) => string | null,
): FeatureBreakdownRow[] {
  // Only count posts with metrics — including no-metric posts would
  // distort means and shares unfairly.
  const withMetrics = posts.filter((p) => p.hasMetrics)
  const totalEng = withMetrics.reduce((sum, p) => sum + p.engagement, 0)
  if (withMetrics.length === 0) return []

  const buckets = new Map<string, ComparisonPost[]>()
  for (const p of withMetrics) {
    const v = picker(p)
    if (v == null || v === '') continue
    const arr = buckets.get(v) ?? []
    arr.push(p)
    buckets.set(v, arr)
  }
  const rows: FeatureBreakdownRow[] = []
  for (const [value, group] of buckets) {
    const eng = group.reduce((sum, p) => sum + p.engagement, 0)
    rows.push({
      value,
      postsCount: group.length,
      totalEngagement: eng,
      meanEngagement: eng / group.length,
      shareOfEngagement: totalEng > 0 ? eng / totalEng : 0,
    })
  }
  rows.sort((a, b) => b.totalEngagement - a.totalEngagement)
  return rows
}

export function platformBreakdown(posts: ComparisonPost[]): FeatureBreakdownRow[] {
  return breakdownBy(posts, (p) => p.job.platform)
}

export function contentTypeBreakdown(posts: ComparisonPost[]): FeatureBreakdownRow[] {
  return breakdownBy(posts, (p) => p.job.contentType)
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export function weekdayBreakdown(posts: ComparisonPost[]): FeatureBreakdownRow[] {
  return breakdownBy(posts, (p) => {
    if (!p.job.postedAt) return null
    const d = new Date(p.job.postedAt)
    if (isNaN(d.getTime())) return null
    return WEEKDAY_NAMES[d.getDay()]
  })
}

// =====================================================================
// The big aggregate that the UI + PDF + rules engine consume
// =====================================================================

export interface ComparisonReport {
  /** Posts in the comparison set, sorted by engagement desc. */
  posts: ComparisonPost[]
  summary: ComparisonSummary
  byPlatform: FeatureBreakdownRow[]
  byContentType: FeatureBreakdownRow[]
  byWeekday: FeatureBreakdownRow[]
}

export function buildComparison(jobs: Job[]): ComparisonReport {
  const posts = jobs.map(buildPost).sort((a, b) => b.engagement - a.engagement)
  return {
    posts,
    summary: summariseComparison(posts),
    byPlatform: platformBreakdown(posts),
    byContentType: contentTypeBreakdown(posts),
    byWeekday: weekdayBreakdown(posts),
  }
}

// =====================================================================
// Comparison rules engine — descriptive, not prescriptive
// =====================================================================

export type InsightSeverity = 'highlight' | 'note' | 'caution'

export interface ComparisonInsight {
  id: string
  severity: InsightSeverity
  title: string
  body: string
}

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  caution: 3,
  highlight: 2,
  note: 1,
}

interface ComparisonRule {
  id: string
  evaluate: (report: ComparisonReport) => ComparisonInsight | null
}

/** Format a number as readable, with locale separators. */
function fmtN(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

/** Format an engagement rate fraction as a percentage. */
function fmtR(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return (rate * 100).toFixed(2) + '%'
}

const RULES: ComparisonRule[] = [
  // ---- 1. Empty / single set ----
  {
    id: 'too-few-posts',
    evaluate: (r) => {
      if (r.posts.length >= 2) return null
      return {
        id: 'too-few-posts',
        severity: 'caution',
        title: 'Comparison needs at least 2 posts',
        body:
          `Only ${r.posts.length} post in this set. Add more posts to surface comparisons.`,
      }
    },
  },

  // ---- 2. No metric data at all ----
  {
    id: 'no-metrics',
    evaluate: (r) => {
      if (r.posts.length === 0) return null
      if (r.summary.postsWithMetrics > 0) return null
      return {
        id: 'no-metrics',
        severity: 'caution',
        title: 'No metrics fetched for any selected post',
        body:
          `Selected ${r.posts.length} ${r.posts.length === 1 ? 'post has' : 'posts have'} no metric snapshots yet. ` +
          `Comparisons will be meaningful once metrics have been captured. ` +
          `You can fetch them per-post or via "Refresh metrics" on the dashboard.`,
      }
    },
  },

  // ---- 3. Partial metrics (some have, some don't) ----
  {
    id: 'partial-metrics',
    evaluate: (r) => {
      if (r.summary.postsWithMetrics === 0) return null
      if (r.summary.postsWithMetrics === r.posts.length) return null
      const missing = r.posts.length - r.summary.postsWithMetrics
      return {
        id: 'partial-metrics',
        severity: 'note',
        title: `${missing} of ${r.posts.length} posts have no metrics yet`,
        body:
          `Comparison numbers below are computed from the ${r.summary.postsWithMetrics} ` +
          `posts that do have metrics. Posts without metrics show "—" in the table.`,
      }
    },
  },

  // ---- 4. Best performer is a clear standout ----
  {
    id: 'best-standout',
    evaluate: (r) => {
      if (!r.summary.best || r.summary.postsWithMetrics < 3) return null
      const best = r.summary.best
      const others = r.posts.filter(
        (p) => p.hasMetrics && p.job.id !== best.job.id,
      )
      if (others.length === 0) return null
      const otherMean =
        others.reduce((sum, p) => sum + p.engagement, 0) / others.length
      if (otherMean === 0) return null
      const ratio = best.engagement / otherMean
      if (ratio < 2.5) return null
      return {
        id: 'best-standout',
        severity: 'highlight',
        title: 'A standout post drove most of the engagement',
        body:
          `"${best.job.title}" collected ${fmtN(best.engagement)} engagement actions — ` +
          `roughly ${ratio.toFixed(1)}× the average of the other ${others.length} posts in this set. ` +
          `Worth identifying what made it different (timing, hook, content type, platform).`,
      }
    },
  },

  // ---- 5. Engagement rate winner is different from raw engagement winner ----
  {
    id: 'rate-vs-raw-winner',
    evaluate: (r) => {
      if (!r.summary.best || !r.summary.bestByRate) return null
      if (r.summary.best.job.id === r.summary.bestByRate.job.id) return null
      return {
        id: 'rate-vs-raw-winner',
        severity: 'note',
        title: 'Top engagement and top engagement-rate are different posts',
        body:
          `Highest raw engagement: "${r.summary.best.job.title}" (${fmtN(r.summary.best.engagement)} actions). ` +
          `Highest engagement rate: "${r.summary.bestByRate.job.title}" (${fmtR(r.summary.bestByRate.engagementRate)}). ` +
          `Rate-leading posts have a more loyal-feeling audience for their reach. ` +
          `Both signals matter for different reasons.`,
      }
    },
  },

  // ---- 6. Platform skew ----
  {
    id: 'platform-skew',
    evaluate: (r) => {
      if (r.byPlatform.length < 2) return null
      const top = r.byPlatform[0]
      if (top.shareOfEngagement < 0.6) return null
      return {
        id: 'platform-skew',
        severity: 'highlight',
        title: `${top.value} drove most of the engagement in this set`,
        body:
          `${(top.shareOfEngagement * 100).toFixed(0)}% of total engagement came from ${top.value} ` +
          `(${top.postsCount} ${top.postsCount === 1 ? 'post' : 'posts'} averaging ${fmtN(top.meanEngagement)} actions). ` +
          `Other platforms in this comparison underperformed by comparison.`,
      }
    },
  },

  // ---- 7. Content type winner ----
  {
    id: 'content-type-winner',
    evaluate: (r) => {
      if (r.byContentType.length < 2) return null
      const top = r.byContentType[0]
      const second = r.byContentType[1]
      if (top.meanEngagement < second.meanEngagement * 1.5) return null
      if (top.postsCount < 2) return null // need at least 2 to call it a pattern
      return {
        id: 'content-type-winner',
        severity: 'highlight',
        title: `${top.value} content outperformed other types in this set`,
        body:
          `${top.value} posts averaged ${fmtN(top.meanEngagement)} engagement actions, ` +
          `vs ${fmtN(second.meanEngagement)} for ${second.value}. ` +
          `${top.postsCount} ${top.value} ${top.postsCount === 1 ? 'post' : 'posts'} in this set.`,
      }
    },
  },

  // ---- 8. Weekday skew ----
  {
    id: 'weekday-skew',
    evaluate: (r) => {
      if (r.byWeekday.length < 2) return null
      if (r.summary.postsWithMetrics < 5) return null // not enough data
      const top = r.byWeekday[0]
      if (top.shareOfEngagement < 0.4) return null
      return {
        id: 'weekday-skew',
        severity: 'note',
        title: `${top.value} posts drove ${(top.shareOfEngagement * 100).toFixed(0)}% of engagement`,
        body:
          `Posts on ${top.value} (${top.postsCount} in this set) carried disproportionately ` +
          `high engagement — averaging ${fmtN(top.meanEngagement)} actions. ` +
          `Either the day genuinely matters for this audience, or those particular posts ` +
          `had other strengths worth investigating.`,
      }
    },
  },

  // ---- 9. Wide spread between best and worst ----
  {
    id: 'wide-spread',
    evaluate: (r) => {
      if (!r.summary.best || !r.summary.worst) return null
      if (r.summary.worst.engagement === 0) return null
      const ratio = r.summary.best.engagement / r.summary.worst.engagement
      if (ratio < 10) return null
      return {
        id: 'wide-spread',
        severity: 'note',
        title: 'Engagement varied widely across the set',
        body:
          `Top post had ${ratio.toFixed(0)}× the engagement of the bottom post in this comparison. ` +
          `That spread suggests material differences in content quality, audience fit, or platform algorithm reach. ` +
          `Worth a closer read of the top vs bottom posts side by side.`,
      }
    },
  },

  // ---- 10. Posts cluster tightly (low variance) ----
  {
    id: 'tight-cluster',
    evaluate: (r) => {
      if (r.summary.postsWithMetrics < 4) return null
      const eng = r.posts.filter((p) => p.hasMetrics).map((p) => p.engagement)
      const mean = eng.reduce((a, b) => a + b, 0) / eng.length
      if (mean < 50) return null // too noisy at low absolute levels
      const variance =
        eng.reduce((sum, v) => sum + (v - mean) ** 2, 0) / eng.length
      const stdDev = Math.sqrt(variance)
      const cv = stdDev / mean // coefficient of variation
      if (cv > 0.35) return null
      return {
        id: 'tight-cluster',
        severity: 'note',
        title: 'Posts performed similarly to each other',
        body:
          `Engagement was consistent across this set (within ${(cv * 100).toFixed(0)}% of the mean). ` +
          `Consistency can mean the strategy is repeatable; it can also mean nothing in this set ` +
          `is breaking out. Compare against other periods for context.`,
      }
    },
  },
]

export function generateComparisonInsights(
  report: ComparisonReport,
): ComparisonInsight[] {
  const insights: ComparisonInsight[] = []
  for (const rule of RULES) {
    try {
      const r = rule.evaluate(report)
      if (r) insights.push(r)
    } catch (err) {
      console.error(`Comparison rule "${rule.id}" threw:`, err)
    }
  }
  insights.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  )
  return insights
}
