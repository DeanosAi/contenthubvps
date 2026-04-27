"use client"

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import type { MonthlyPoint } from '@/lib/quarterly'
import { formatNumber } from '@/lib/reports'

/**
 * Round 7.4: dark-mode CSS-var refs swept to hardcoded slate (matches
 * the rest of /reports). Plus added `maxBarSize={120}` to the Bar so
 * that with sparse data (1-2 months) the bar doesn't auto-stretch to
 * fill half the chart width and look bizarre. Recharts' default
 * behaviour spaces N data points evenly across the chart area, then
 * sizes bars to nearly fill each "slot" — fine for 8+ months but with
 * 2 months that gives bars wider than the eye expects. 120px is a
 * reasonable cap; with many months Recharts shrinks bars below this
 * automatically.
 */
const CHART = {
  grid: '#e2e8f0',
  axis: '#64748b',
  primary: '#4f46e5',
  secondary: '#10b981',
} as const

export function ReportsDeepDiveMonthlyChart({ monthly }: { monthly: MonthlyPoint[] }) {
  if (monthly.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">
          Pick a date range to see month-by-month trends.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Monthly trends</h3>
        <p className="text-xs text-slate-600 mt-0.5">
          Engagement (bars) and post count (line) by month within the selected window.
        </p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke={CHART.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={formatNumber}
            stroke={CHART.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={formatNumber}
            stroke={CHART.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={32}
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
          <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
          <Bar
            yAxisId="left"
            dataKey="engagement"
            name="Engagement"
            fill={CHART.primary}
            radius={[4, 4, 0, 0]}
            maxBarSize={120}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="posts"
            name="Posts"
            stroke={CHART.secondary}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
