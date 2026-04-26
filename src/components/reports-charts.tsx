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
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={formatNumber}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(label) => formatDateShort(typeof label === 'string' ? label : null)}
                formatter={(value, name) => [formatNumber(typeof value === 'number' ? value : Number(value ?? 0)), String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="engagement"
                name="Engagement"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="posts"
                name="Posts"
                stroke="#10b981"
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
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="platform"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={formatNumber}
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={40}
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
              <Bar dataKey="totalEngagement" name="Engagement" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
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
    <div className="rounded-2xl border bg-[hsl(var(--card))] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {caption && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{caption}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[260px] flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))]">
      {message}
    </div>
  )
}
