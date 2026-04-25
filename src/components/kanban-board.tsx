"use client"

import { useMemo } from 'react'
import type { Job, JobStage } from '@/lib/types'

const STAGES: { id: JobStage; label: string; dot: string; bg: string }[] = [
  { id: 'brief', label: 'Brief', dot: '#64748b', bg: 'rgba(100,116,139,0.10)' },
  { id: 'production', label: 'In Production', dot: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  { id: 'ready', label: 'Ready for Posting', dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  { id: 'posted', label: 'Posted', dot: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  { id: 'archive', label: 'Archive', dot: '#4b5563', bg: 'rgba(75,85,99,0.10)' },
]

export function KanbanBoard({ jobs, onSelectJob }: { jobs: Job[]; onSelectJob: (job: Job) => void }) {
  const grouped = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      jobs: jobs.filter((job) => job.stage === stage.id),
    }))
  }, [jobs])

  return (
    <div className="grid xl:grid-cols-5 md:grid-cols-2 gap-4">
      {grouped.map((column) => (
        <div key={column.id} className="rounded-2xl border min-h-[460px] flex flex-col" style={{ backgroundColor: column.bg }}>
          <div className="p-4 border-b bg-[hsl(var(--card))]/70 backdrop-blur-sm flex items-center justify-between rounded-t-2xl">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.dot }} />
              <h3 className="font-semibold text-sm">{column.label}</h3>
            </div>
            <span className="text-xs text-[hsl(var(--muted-foreground))] rounded-full border px-2 py-1">{column.jobs.length}</span>
          </div>
          <div className="p-3 space-y-3 flex-1">
            {column.jobs.map((job) => (
              <button key={job.id} onClick={() => onSelectJob(job)} className="w-full text-left rounded-xl border bg-[hsl(var(--background))] p-3 space-y-2 shadow-sm hover:border-[hsl(var(--primary))]/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-sm leading-snug">{job.title}</h4>
                  {job.priority > 0 && <span className="text-[10px] rounded-full bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] px-2 py-1">P{job.priority}</span>}
                </div>
                {job.description && <p className="text-xs text-[hsl(var(--muted-foreground))]">{job.description}</p>}
                <div className="flex flex-wrap gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                  {job.platform && <span className="rounded-full border px-2 py-1">{job.platform}</span>}
                  {job.hashtags && <span>{job.hashtags}</span>}
                </div>
              </button>
            ))}
            {column.jobs.length === 0 && <p className="text-xs text-[hsl(var(--muted-foreground))]">No jobs yet</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
