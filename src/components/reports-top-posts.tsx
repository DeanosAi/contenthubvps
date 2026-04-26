"use client"

import type { TopPostRow } from '@/lib/reports'
import { formatNumber, formatEngagementRate, formatDateShort } from '@/lib/reports'

/** Top performers section — one card per platform listing its top 5 posts.
 * Each row shows title, posted-on date, views, engagement, eng. rate. */
export function ReportsTopPosts({
  byPlatform,
}: {
  byPlatform: Map<string, TopPostRow[]>
}) {
  const entries = Array.from(byPlatform.entries())
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No posts have metrics yet — top performers will appear once metrics are fetched.
        </p>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {entries.map(([platform, rows]) => (
        <div key={platform} className="rounded-2xl border bg-[hsl(var(--card))] p-4">
          <h3 className="text-sm font-semibold capitalize mb-3">
            Top performers: {platform}
          </h3>
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.job.id}
                className="flex items-start gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3"
              >
                <span className="text-xs font-bold text-[hsl(var(--muted-foreground))] mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={r.job.title}>
                    {r.job.title}
                  </p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    Posted {formatDateShort(r.job.postedAt)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{formatNumber(r.engagement)}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    {formatNumber(r.views)} views · {formatEngagementRate(r.engagementRate)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
