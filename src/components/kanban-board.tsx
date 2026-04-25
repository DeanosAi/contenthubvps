"use client"

import { useMemo } from 'react'
import type { Job, JobStage } from '@/lib/types'
import { JobEditor } from '@/components/job-editor'

const STAGES: { id: JobStage; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'production', label: 'In Production' },
  { id: 'ready', label: 'Ready' },
  { id: 'posted', label: 'Posted' },
  { id: 'archive', label: 'Archive' },
]

export function KanbanBoard({ jobs, onRefresh }: { jobs: Job[]; onRefresh: () => void }) {
  const grouped = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      jobs: jobs.filter((job) => job.stage === stage.id),
    }))
  }, [jobs])

  return (
    <div className="grid xl:grid-cols-5 md:grid-cols-2 gap-4">
      {grouped.map((column) => (
        <div key={column.id} className="rounded-2xl border border-slate-800 bg-slate-900 min-h-[380px]">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-semibold">{column.label}</h3>
            <span className="text-xs text-slate-400">{column.jobs.length}</span>
          </div>
          <div className="p-3 space-y-3">
            {column.jobs.map((job) => (
              <div key={job.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-sm leading-snug">{job.title}</h4>
                  {job.priority > 0 && <span className="text-[10px] rounded-full bg-cyan-500/15 text-cyan-300 px-2 py-1">P{job.priority}</span>}
                </div>
                {job.description && <p className="text-xs text-slate-400">{job.description}</p>}
                {job.hashtags && <p className="text-[11px] text-slate-500">{job.hashtags}</p>}
                <JobEditor job={job} onSaved={onRefresh} onDeleted={onRefresh} />
              </div>
            ))}
            {column.jobs.length === 0 && <p className="text-xs text-slate-500">No jobs yet</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
