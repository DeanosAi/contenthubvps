"use client"

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import type { TimeSeriesPoint, PlatformRow } from '@/lib/reports'
import { formatNumber, formatDateShort } from '@/lib/reports'

/**
 * Round 7.3: chart strokes/fills hardcoded to literal hex values
 * (was reading from `hsl(var(--*))` CSS variables). The variables
 * resolve correctly via globals.css but recharts inlines these
 * values into SVG attributes at render time — the lookup happens
 * once. If anything ever fails to resolve at the moment recharts
 * renders, the chart goes blank. Hardcoded hex is robust.
 *
 * Colour palette:
 *   - grid lines: #e2e8f0 (slate-200) — soft, doesn't fight the data
 *   - axis text:  #64748b (slate-500) — readable but subordinate
 *   - primary line / bar fill: #4f46e5 (indigo-600) — matches the
 *     app's primary accent
 *   - secondary line: #10b981 (emerald-500) — distinct from indigo
 */
const CHART = {
  grid: '#e2e8f0',
  axis: '#64748b',
  primary: '#4f46e5',
  secondary: '#10b981',
} as const

export function ReportsCharts({
  series,
  platformRows,
}: {
  series: TimeSeriesPoint[]
  platformRows: PlatformRow[]
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <ChartCard
        title="Engagement over time"
        caption="Daily engagement actions across all in-scope posts"
      >
        {series.length === 0 ? (
          <EmptyChart message="Pick a date range to see the time series" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                stroke={CHART.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={formatNumber}
                stroke={CHART.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#0f172a',
                }}
                labelFormatter={(label) => formatDateShort(typeof label === 'string' ? label : null)}
                formatter={(value, name) => [formatNumber(typeof value === 'number' ? value : Number(value ?? 0)), String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
              <Line
                type="monotone"
                dataKey="engagement"
                name="Engagement"
                stroke={CHART.primary}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="posts"
                name="Posts"
                stroke={CHART.secondary}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard
        title="Platform breakdown"
        caption="Engagement actions per platform"
      >
        {platformRows.length === 0 ? (
          <EmptyChart message="No posts in this range" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={platformRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="platform"
                stroke={CHART.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={formatNumber}
                stroke={CHART.axis}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#0f172a',
                }}
                formatter={(value, name) => [formatNumber(typeof value === 'number' ? value : Number(value ?? 0)), String(name)]}
              />
              <Bar dataKey="totalEngagement" name="Engagement" fill={CHART.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  )
}

function ChartCard({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {caption && (
          <p className="text-xs text-slate-600 mt-0.5">{caption}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[260px] flex items-center justify-center text-xs text-slate-500">
      {message}
    </div>
  )
}
