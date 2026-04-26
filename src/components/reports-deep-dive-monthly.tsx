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

export function ReportsDeepDiveMonthlyChart({ monthly }: { monthly: MonthlyPoint[] }) {
  if (monthly.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Pick a date range to see month-by-month trends.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Monthly trends</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
          Engagement (bars) and post count (line) by month within the selected window.
        </p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={formatNumber}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={formatNumber}
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => [formatNumber(typeof value === 'number' ? value : Number(value ?? 0)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            yAxisId="left"
            dataKey="engagement"
            name="Engagement"
            fill="hsl(var(--primary))"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="posts"
            name="Posts"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
