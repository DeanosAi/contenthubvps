"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import type { ComparisonPost } from '@/lib/comparison'

/**
 * Horizontal bar chart of posts ranked by engagement.
 *
 * Why horizontal: post titles are typically too long to read on a
 * vertical-axis x-label, and horizontal makes the ranking literally
 * read top-to-bottom, which matches how people scan comparison data.
 *
 * The top bar is highlighted in the primary colour so the winner is
 * immediately obvious — the rest fade to a quiet neutral.
 */

const TITLE_TRUNCATE = 38

interface ChartDatum {
  jobId: string
  label: string
  engagement: number
  hasMetrics: boolean
}

export function ComparisonRankingChart({ posts }: { posts: ComparisonPost[] }) {
  const data: ChartDatum[] = posts
    .filter((p) => p.hasMetrics)
    .map((p) => ({
      jobId: p.job.id,
      label: truncate(p.job.title, TITLE_TRUNCATE),
      engagement: p.engagement,
      hasMetrics: p.hasMetrics,
    }))
    // Highest at top — the data array order maps to the y-axis order
    // top-to-bottom in horizontal recharts BarChart.
    .sort((a, b) => b.engagement - a.engagement)

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No metric-bearing posts to rank yet.
        </p>
      </div>
    )
  }

  // Roughly 28-36px per bar, with padding. Caps somewhere readable.
  const height = Math.min(640, 60 + data.length * 32)

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Ranking by engagement</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
          Posts in this set, sorted by total engagement actions.
          {data.length < posts.length && (
            <span className="text-amber-300 ml-1">
              {posts.length - data.length} post(s) without metrics omitted.
            </span>
          )}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
        >
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <YAxis
            dataKey="label"
            type="category"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={220}
            interval={0}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            cursor={{ fill: 'hsl(var(--accent) / 0.3)' }}
            formatter={(value: unknown) => {
              const n = typeof value === 'number' ? value : Number(value ?? 0)
              return [Number.isFinite(n) ? n.toLocaleString() : '—', 'Engagement']
            }}
          />
          <Bar dataKey="engagement" radius={[0, 4, 4, 0]}>
            {data.map((_, idx) => (
              <Cell
                key={idx}
                fill={idx === 0 ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.45)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}
