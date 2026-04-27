"use client"

import { useMemo } from 'react'
import type { Job, KanbanColumn, Workspace } from '@/lib/types'
import { useUsers } from '@/lib/use-users'

function formatDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })
}

/**
 * Round 7.2b: stage-overdue exclusion now uses the literal 'posted'
 * and 'archive' built-in keys (not column labels). A job in a custom
 * column is treated as still in progress, so it CAN be overdue. That
 * matches what users would expect — a custom workflow column doesn't
 * mean the post is already live.
 */
function isOverdue(dueDate: string | null, stage: string): boolean {
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
  columns,
  onSelectJob,
}: {
  jobs: Job[]
  workspaces: Workspace[]
  /** Per-workspace columns. Used to look up the stage's user-facing
   *  label and colour. The stage_key on each job maps to a column. */
  columns: KanbanColumn[]
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

  /** stage_key → KanbanColumn. Used to render the dot + label per job. */
  const columnByStage = useMemo(() => {
    const m = new Map<string, KanbanColumn>()
    for (const c of columns) m.set(c.stageKey, c)
    return m
  }, [columns])

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">No jobs match the current filters.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white surface-shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-slate-600 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-semibold">Title</th>
            <th className="text-left px-4 py-3 font-semibold">Workspace</th>
            <th className="text-left px-4 py-3 font-semibold">Stage</th>
            <th className="text-left px-4 py-3 font-semibold">Platform</th>
            <th className="text-left px-4 py-3 font-semibold">Priority</th>
            <th className="text-left px-4 py-3 font-semibold">Due</th>
            <th className="text-left px-4 py-3 font-semibold">Assigned</th>
            <th className="text-left px-4 py-3 font-semibold">Updated</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const overdue = isOverdue(job.dueDate, job.stage)
            const col = columnByStage.get(job.stage)
            return (
              <tr
                key={job.id}
                onClick={() => onSelectJob(job)}
                className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium line-clamp-1 text-slate-900">{job.title}</div>
                  {job.description && (
                    <div className="text-xs text-slate-600 line-clamp-1 mt-0.5">
                      {job.description}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{wsName.get(job.workspaceId) ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: col?.color ?? '#64748b' }}
                    />
                    {col?.label ?? job.stage}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{job.platform || '—'}</td>
                <td className="px-4 py-3">
                  {job.priority > 0 ? (
                    <span className="inline-flex rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[10px] font-semibold">
                      P{job.priority}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className={`px-4 py-3 ${overdue ? 'text-red-700 font-medium' : 'text-slate-600'}`}>
                  {formatDate(job.dueDate)}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {job.assignedTo ? userName.get(job.assignedTo) ?? 'Unknown' : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(job.updatedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
