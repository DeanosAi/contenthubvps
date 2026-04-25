import type { Job } from '@/lib/types'

export function DashboardStats({ jobs }: { jobs: Job[] }) {
  const total = jobs.length
  const brief = jobs.filter((j) => j.stage === 'brief').length
  const production = jobs.filter((j) => j.stage === 'production').length
  const ready = jobs.filter((j) => j.stage === 'ready').length
  const posted = jobs.filter((j) => j.stage === 'posted').length

  const stats = [
    { label: 'Total Jobs', value: total },
    { label: 'In Brief', value: brief },
    { label: 'In Production', value: production },
    { label: 'Ready to Post', value: ready },
    { label: 'Posted', value: posted },
  ]

  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-2xl border bg-[hsl(var(--card))] p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">{stat.label}</p>
          <p className="text-3xl font-bold mt-3">{stat.value}</p>
        </div>
      ))}
    </div>
  )
}
