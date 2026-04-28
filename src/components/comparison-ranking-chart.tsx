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
      <div className="rounded-2xl border bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">
          No metric-bearing posts to rank yet.
        </p>
      </div>
    )
  }

  // Roughly 28-36px per bar, with padding. Caps somewhere readable.
  const height = Math.min(640, 60 + data.length * 32)

  return (
    <div className="rounded-2xl border bg-white surface-shadow p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Ranking by engagement</h3>
        <p className="text-xs text-slate-600 mt-0.5">
          Posts in this set, sorted by total engagement actions.
          {data.length < posts.length && (
            <span className="text-amber-700 ml-1">
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
          {/* Round 7.9: chart colours hardcoded to literal hex/rgba.
              Same reasoning as reports-charts.tsx and reports-deep-
              dive-monthly.tsx — recharts inlines stroke/fill into
              SVG attributes at render, so a hardcoded fallback is
              more robust than CSS-var indirection that could fail
              if globals.css ever changes. Palette matches:
                grid:      #e2e8f0 (slate-200)
                axis:      #64748b (slate-500)
                primary:   #4f46e5 (indigo-600), and rgba 45% alpha
                           for non-winning bars
                tooltip:   white card, slate-200 border, slate-900 text */}
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            stroke="#64748b"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <YAxis
            dataKey="label"
            type="category"
            stroke="#64748b"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={220}
            interval={0}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 12,
              color: '#0f172a',
            }}
            cursor={{ fill: 'rgba(79, 70, 229, 0.08)' }}
            formatter={(value: unknown) => {
              const n = typeof value === 'number' ? value : Number(value ?? 0)
              return [Number.isFinite(n) ? n.toLocaleString() : '—', 'Engagement']
            }}
          />
          <Bar dataKey="engagement" radius={[0, 4, 4, 0]}>
            {data.map((_, idx) => (
              <Cell
                key={idx}
                fill={idx === 0 ? '#4f46e5' : 'rgba(79, 70, 229, 0.45)'}
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
