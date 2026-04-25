"use client"

import { useMemo } from 'react'
import type { Job, JobStage, Workspace } from '@/lib/types'
import { useUsers } from '@/lib/use-users'

const STAGE_DOT: Record<JobStage, string> = {
  brief: '#64748b',
  production: '#3b82f6',
  ready: '#f59e0b',
  posted: '#10b981',
  archive: '#4b5563',
}

const STAGE_LABEL: Record<JobStage, string> = {
  brief: 'Brief',
  production: 'In Production',
  ready: 'Ready',
  posted: 'Posted',
  archive: 'Archive',
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })
}

function isOverdue(dueDate: string | null, stage: JobStage): boolean {
  if (!dueDate) return false
  if (stage === 'posted' || stage === 'archive') return false
  const due = new Date(dueDate)
  if (isNaN(due.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due.getTime() < today.getTime()
}

export function JobListView({
  jobs,
  workspaces,
  onSelectJob,
}: {
  jobs: Job[]
  workspaces: Workspace[]
  onSelectJob: (job: Job) => void
}) {
  const { users } = useUsers()

  const wsName = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of workspaces) m.set(w.id, w.name)
    return m
  }, [workspaces])

  const userName = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.id, u.name || u.email)
    return m
  }, [users])

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No jobs match the current filters.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border bg-[hsl(var(--card))] overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Title</th>
            <th className="text-left px-4 py-3 font-medium">Workspace</th>
            <th className="text-left px-4 py-3 font-medium">Stage</th>
            <th className="text-left px-4 py-3 font-medium">Platform</th>
            <th className="text-left px-4 py-3 font-medium">Priority</th>
            <th className="text-left px-4 py-3 font-medium">Due</th>
            <th className="text-left px-4 py-3 font-medium">Assigned</th>
            <th className="text-left px-4 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const overdue = isOverdue(job.dueDate, job.stage)
            return (
              <tr
                key={job.id}
                onClick={() => onSelectJob(job)}
                className="border-b last:border-b-0 hover:bg-[hsl(var(--accent))]/30 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium line-clamp-1">{job.title}</div>
                  {job.description && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-1 mt-0.5">
                      {job.description}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">{wsName.get(job.workspaceId) ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_DOT[job.stage] }} />
                    {STAGE_LABEL[job.stage]}
                  </span>
                </td>
                <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">{job.platform || '—'}</td>
                <td className="px-4 py-3">
                  {job.priority > 0 ? (
                    <span className="inline-flex rounded-full bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] px-2 py-0.5 text-[10px] font-semibold">
                      P{job.priority}
                    </span>
                  ) : (
                    <span className="text-[hsl(var(--muted-foreground))]">—</span>
                  )}
                </td>
                <td className={`px-4 py-3 ${overdue ? 'text-red-400 font-medium' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  {formatDate(job.dueDate)}
                </td>
                <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                  {job.assignedTo ? userName.get(job.assignedTo) ?? 'Unknown' : '—'}
                </td>
                <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] text-xs">{formatDate(job.updatedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
