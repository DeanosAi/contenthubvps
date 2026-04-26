// Rules-based recommendation engine for the quarterly deep-dive.
//
// Why rules instead of AI:
//   - Predictable. Same data → same recommendations. Useful for client-
//     facing reports where "why did the suggestion change?" is a real
//     question with a real answer.
//   - Free. Zero API spend per report.
//   - Auditable. You can read the rules and understand exactly what
//     conditions trigger what suggestion.
//   - Honest. When the data is too thin, the rule doesn't fire — no
//     hallucinated insights.
//
// What rules can do:
//   - Spot patterns ("reels outperform carousels 3:1 in your data")
//   - Spot trends ("engagement down 15% MoM")
//   - Spot gaps ("11 days without posting on Instagram")
//   - Compare across platforms and recommend reallocation
//
// What rules CANNOT do:
//   - Tell you WHY engagement is down (no causal inference)
//   - Suggest creative content topics
//   - Predict future performance
//
// If/when AI recommendations are wanted later (different round), they
// can layer on top of these — the rules establish a "facts" baseline,
// AI can add narrative interpretation.

import type { DeepDive } from './quarterly'
import { formatPctChange } from './quarterly'

export type Severity = 'critical' | 'warning' | 'opportunity' | 'info'

export interface Recommendation {
  /** Stable id so React keys are stable across renders. */
  id: string
  severity: Severity
  /** One-line summary of the issue/opportunity. */
  title: string
  /** Longer explanation with the specific numbers. 1-3 sentences. */
  body: string
}

interface Rule {
  id: string
  /** Returns null when the rule doesn't apply. Keeps the rule list
   * readable — every rule is self-contained. */
  evaluate: (d: DeepDive) => Recommendation | null
}

// =====================================================================
// Rule implementations
// =====================================================================

/** Severity-rank used to sort the final list. Higher = more prominent. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  warning: 3,
  opportunity: 2,
  info: 1,
}

const RULES: Rule[] = [
  // ---- 1. No posts at all (critical) ----
  {
    id: 'no-posts-this-period',
    evaluate: (d) => {
      if (d.current.totalPosts > 0) return null
      return {
        id: 'no-posts-this-period',
        severity: 'critical',
        title: 'No posted activity in this window',
        body:
          'There were zero posts marked as posted in the selected date range. ' +
          'Reports require posted activity to compute meaningful metrics. ' +
          'Verify the date range or the stage of recent jobs.',
      }
    },
  },

  // ---- 2. No metric data (warning) ----
  {
    id: 'no-metrics-yet',
    evaluate: (d) => {
      if (d.current.totalPosts === 0) return null
      if (d.current.jobsWithMetrics > 0) return null
      return {
        id: 'no-metrics-yet',
        severity: 'warning',
        title: 'Posts have not yet been measured',
        body:
          `${d.current.totalPosts} ${d.current.totalPosts === 1 ? 'post was' : 'posts were'} ` +
          `marked as posted, but none have metric snapshots yet. ` +
          `Most performance recommendations require fetched metrics — they will ` +
          `appear here once the metrics fetcher captures data.`,
      }
    },
  },

  // ---- 3. Engagement up substantially MoM ----
  {
    id: 'engagement-up',
    evaluate: (d) => {
      const t = d.trends.totalEngagement
      if (t.pctChange == null) return null
      if (t.pctChange < 0.1) return null // require ≥10%
      if (d.prior.totalEngagement === 0) return null // can't compare
      return {
        id: 'engagement-up',
        severity: 'info',
        title: 'Engagement is up vs prior period',
        body:
          `Total engagement is ${formatPctChange(t)} vs the prior period ` +
          `(${t.current.toLocaleString()} vs ${t.prior.toLocaleString()}). ` +
          `Look at top performers to identify what worked, and document the pattern.`,
      }
    },
  },

  // ---- 4. Engagement down substantially MoM ----
  {
    id: 'engagement-down',
    evaluate: (d) => {
      const t = d.trends.totalEngagement
      if (t.pctChange == null) return null
      if (t.pctChange > -0.1) return null // require ≥10% decline
      if (d.prior.totalEngagement === 0) return null
      return {
        id: 'engagement-down',
        severity: 'warning',
        title: 'Engagement is down vs prior period',
        body:
          `Total engagement is ${formatPctChange(t)} vs the prior period ` +
          `(${t.current.toLocaleString()} vs ${t.prior.toLocaleString()}). ` +
          `Investigate what changed — content type, platform mix, posting cadence — ` +
          `and review top performers from the prior period for what to reinstate.`,
      }
    },
  },

  // ---- 5. Posting frequency dropped ----
  {
    id: 'posting-frequency-dropped',
    evaluate: (d) => {
      const t = d.trends.totalPosts
      if (t.pctChange == null) return null
      if (t.pctChange > -0.2) return null
      if (d.prior.totalPosts < 3) return null // not enough prior to be meaningful
      return {
        id: 'posting-frequency-dropped',
        severity: 'warning',
        title: 'Posting frequency dropped',
        body:
          `Post count fell from ${t.prior} to ${t.current} (${formatPctChange(t)}). ` +
          `Consistency builds audience; consider whether the slowdown is intentional ` +
          `(seasonal) or a process issue worth addressing.`,
      }
    },
  },

  // ---- 6. Posting frequency increased ----
  {
    id: 'posting-frequency-increased',
    evaluate: (d) => {
      const t = d.trends.totalPosts
      if (t.pctChange == null) return null
      if (t.pctChange < 0.2) return null
      if (d.prior.totalPosts < 3) return null
      return {
        id: 'posting-frequency-increased',
        severity: 'info',
        title: 'Posting cadence increased',
        body:
          `Post count rose from ${t.prior} to ${t.current} (${formatPctChange(t)}). ` +
          `Verify engagement scaled with volume — if engagement-per-post fell, ` +
          `the higher cadence may not be paying off.`,
      }
    },
  },

  // ---- 7. Long gap between posts ----
  {
    id: 'long-posting-gap',
    evaluate: (d) => {
      const gap = d.cadence.longestGapDays
      if (gap == null) return null
      if (gap < 14) return null
      return {
        id: 'long-posting-gap',
        severity: 'warning',
        title: `Longest posting gap was ${gap} days`,
        body:
          `Within the selected window, the longest gap between consecutive posts ` +
          `was ${gap} days. Audiences disengage during silence; even a low-effort ` +
          `placeholder post or repost can keep the cadence visible.`,
      }
    },
  },

  // ---- 8. Best-performing platform ----
  {
    id: 'best-platform',
    evaluate: (d) => {
      // Need at least 2 platforms with engagement to make a meaningful comparison.
      const withEng = d.platforms.filter((p) => p.current.totalEngagement > 0)
      if (withEng.length < 2) return null
      const top = withEng[0]
      const second = withEng[1]
      // Only fire if top is clearly ahead — at least 2× second.
      if (top.current.totalEngagement < second.current.totalEngagement * 2) return null
      return {
        id: 'best-platform',
        severity: 'info',
        title: `${top.platform} is your strongest platform`,
        body:
          `${top.platform} drove ${top.current.totalEngagement.toLocaleString()} engagement actions ` +
          `vs ${second.current.totalEngagement.toLocaleString()} on ${second.platform}. ` +
          `Consider whether content effort is allocated proportionally — under-investing ` +
          `in your strongest channel is a common pattern.`,
      }
    },
  },

  // ---- 9. Underperforming platform ----
  {
    id: 'weak-platform',
    evaluate: (d) => {
      // Find platforms that have posts but very low engagement-per-post relative
      // to the average across other platforms.
      const withPosts = d.platforms.filter((p) => p.current.postsCount > 0)
      if (withPosts.length < 2) return null
      const totalEng = withPosts.reduce((sum, p) => sum + p.current.totalEngagement, 0)
      const totalPosts = withPosts.reduce((sum, p) => sum + p.current.postsCount, 0)
      if (totalEng === 0 || totalPosts === 0) return null
      const avgEngPerPost = totalEng / totalPosts

      const candidates = withPosts.filter((p) => {
        if (p.current.postsCount < 3) return false // not enough data
        const platformAvg = p.current.totalEngagement / p.current.postsCount
        return platformAvg < avgEngPerPost * 0.4
      })
      if (candidates.length === 0) return null
      const worst = candidates.sort(
        (a, b) =>
          a.current.totalEngagement / a.current.postsCount -
          b.current.totalEngagement / b.current.postsCount,
      )[0]
      const platformAvg = Math.round(worst.current.totalEngagement / worst.current.postsCount)
      const overallAvg = Math.round(avgEngPerPost)
      return {
        id: 'weak-platform',
        severity: 'opportunity',
        title: `${worst.platform} is underperforming relative to other platforms`,
        body:
          `${worst.platform} averaged ${platformAvg} engagement actions per post vs ` +
          `${overallAvg} across other platforms. Reassess content fit, posting times, ` +
          `or whether the platform deserves the same effort.`,
      }
    },
  },

  // ---- 10. Platform went silent ----
  {
    id: 'platform-went-silent',
    evaluate: (d) => {
      const silent = d.platforms.filter(
        (p) => p.current.postsCount === 0 && (p.prior?.postsCount ?? 0) >= 3,
      )
      if (silent.length === 0) return null
      const names = silent.map((p) => p.platform)
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      return {
        id: 'platform-went-silent',
        severity: 'warning',
        title: `${silent.length === 1 ? 'Platform' : 'Platforms'} went silent`,
        body:
          `You posted on ${list} in the prior period but not this one. ` +
          `Audiences notice silence — confirm whether this was intentional, and ` +
          `consider a re-introduction post if not.`,
      }
    },
  },

  // ---- 11. New platform this period ----
  {
    id: 'platform-new',
    evaluate: (d) => {
      const fresh = d.platforms.filter(
        (p) => p.current.postsCount > 0 && (p.prior == null || p.prior.postsCount === 0),
      )
      if (fresh.length === 0) return null
      const names = fresh.map((p) => p.platform).join(', ')
      return {
        id: 'platform-new',
        severity: 'info',
        title: `First posts on ${fresh.length === 1 ? 'a new platform' : 'new platforms'}`,
        body:
          `${names} ${fresh.length === 1 ? 'is' : 'are'} new this period. ` +
          `Track engagement closely for the first few weeks to decide whether to ` +
          `commit, scale up, or pull back.`,
      }
    },
  },

  // ---- 12. Single platform dominates ----
  {
    id: 'platform-concentration',
    evaluate: (d) => {
      const totalEng = d.platforms.reduce((sum, p) => sum + p.current.totalEngagement, 0)
      if (totalEng === 0) return null
      if (d.platforms.length < 2) return null
      const top = d.platforms[0]
      const share = top.current.totalEngagement / totalEng
      if (share < 0.7) return null
      return {
        id: 'platform-concentration',
        severity: 'opportunity',
        title: 'Engagement is highly concentrated on one platform',
        body:
          `${top.platform} produced ${(share * 100).toFixed(0)}% of total engagement this period. ` +
          `Single-platform reliance is a risk if algorithms or policies shift. ` +
          `Consider whether to invest in diversifying.`,
      }
    },
  },

  // ---- 13. Avg engagement rate up ----
  {
    id: 'eng-rate-up',
    evaluate: (d) => {
      const t = d.trends.avgEngagementRate
      if (t.pctChange == null) return null
      if (t.pctChange < 0.15) return null
      if (d.prior.avgEngagementRate === 0) return null
      return {
        id: 'eng-rate-up',
        severity: 'info',
        title: 'Engagement rate is up',
        body:
          `Average engagement rate rose ${formatPctChange(t)} ` +
          `(${(t.current * 100).toFixed(2)}% vs ${(t.prior * 100).toFixed(2)}%). ` +
          `Growing engagement rate signals improving content quality, not just volume.`,
      }
    },
  },

  // ---- 14. Avg engagement rate down ----
  {
    id: 'eng-rate-down',
    evaluate: (d) => {
      const t = d.trends.avgEngagementRate
      if (t.pctChange == null) return null
      if (t.pctChange > -0.15) return null
      if (d.prior.avgEngagementRate === 0) return null
      return {
        id: 'eng-rate-down',
        severity: 'warning',
        title: 'Engagement rate is down',
        body:
          `Average engagement rate fell ${formatPctChange(t)} ` +
          `(${(t.current * 100).toFixed(2)}% vs ${(t.prior * 100).toFixed(2)}%). ` +
          `Falling rate despite stable volume often signals audience fatigue or ` +
          `algorithm reach changes. Compare top performers across periods.`,
      }
    },
  },

  // ---- 15. Top performer outlier ----
  {
    id: 'top-outlier',
    evaluate: (d) => {
      if (d.topPerformers.length < 4) return null
      const top = d.topPerformers[0]
      const restAvg =
        d.topPerformers.slice(1).reduce((sum, r) => sum + r.engagement, 0) /
        (d.topPerformers.length - 1)
      if (restAvg === 0) return null
      if (top.engagement < restAvg * 4) return null
      return {
        id: 'top-outlier',
        severity: 'info',
        title: 'A standout post drove disproportionate engagement',
        body:
          `Your top post collected ${top.engagement.toLocaleString()} engagement actions — ` +
          `roughly ${(top.engagement / restAvg).toFixed(1)}× the average of the next 9. ` +
          `Identify what made it work (content type, hook, timing) and try to reproduce.`,
      }
    },
  },

  // ---- 16. Bottom performers cluster on one platform ----
  {
    id: 'bottom-platform-cluster',
    evaluate: (d) => {
      if (d.bottomPerformers.length < 5) return null
      const platforms = d.bottomPerformers.map((r) => r.job.platform || 'unspecified')
      const counts = new Map<string, number>()
      for (const p of platforms) counts.set(p, (counts.get(p) ?? 0) + 1)
      const [worst, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]
      if (count < 4) return null
      return {
        id: 'bottom-platform-cluster',
        severity: 'opportunity',
        title: `Most low-engagement posts were on ${worst}`,
        body:
          `${count} of the 5 lowest-engagement posts this period were on ${worst}. ` +
          `Either content type isn't matching that platform's audience, or posting ` +
          `times need testing. Worth a focused review.`,
      }
    },
  },

  // ---- 17. Weekday concentration ----
  {
    id: 'weekday-concentration',
    evaluate: (d) => {
      if (d.cadence.totalPosts < 8) return null
      const max = Math.max(...d.cadence.byWeekday)
      const share = max / d.cadence.totalPosts
      if (share < 0.4) return null
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const dayIdx = d.cadence.byWeekday.indexOf(max)
      return {
        id: 'weekday-concentration',
        severity: 'info',
        title: `${(share * 100).toFixed(0)}% of posts went out on ${dayNames[dayIdx]}`,
        body:
          `Most of this period's posts landed on ${dayNames[dayIdx]} ` +
          `(${max} of ${d.cadence.totalPosts}). Test other weekdays to see whether ` +
          `engagement varies — algorithm reach often differs by day.`,
      }
    },
  },

  // ---- 18. Active-day ratio low ----
  {
    id: 'active-day-ratio-low',
    evaluate: (d) => {
      if (d.cadence.totalPosts < 4) return null
      const days = d.cadence.activeDays
      if (days === 0) return null
      // Compare to total days in the window.
      const fromIso = d.scope.fromIso
      const toIso = d.scope.toIso
      if (!fromIso || !toIso) return null
      const totalDays =
        (new Date(toIso + 'T00:00:00').getTime() -
          new Date(fromIso + 'T00:00:00').getTime()) /
          (24 * 60 * 60 * 1000) +
        1
      if (totalDays < 14) return null // too short to be meaningful
      const ratio = days / totalDays
      if (ratio > 0.25) return null
      return {
        id: 'active-day-ratio-low',
        severity: 'info',
        title: 'Posting activity is bunched on few days',
        body:
          `Posts went out on ${days} of ${Math.round(totalDays)} days ` +
          `(${(ratio * 100).toFixed(0)}%). Spreading the same number of posts across ` +
          `more days tends to keep audience attention warmer.`,
      }
    },
  },
]

// =====================================================================
// Public API
// =====================================================================

/** Run every rule against a deep-dive summary, return the recommendations
 * that fired, sorted by severity (most important first). */
export function generateRecommendations(deepDive: DeepDive): Recommendation[] {
  const results: Recommendation[] = []
  for (const rule of RULES) {
    try {
      const r = rule.evaluate(deepDive)
      if (r) results.push(r)
    } catch (err) {
      // A buggy rule shouldn't kill the whole report. Log and continue.
      console.error(`Recommendation rule "${rule.id}" threw:`, err)
    }
  }
  results.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
  return results
}

/** Total number of rules — useful for "showing 3 of 18 rules fired"
 * type messaging if we ever want to expose it. */
export const TOTAL_RULES = RULES.length
