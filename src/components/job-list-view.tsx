"use client"

import { useMemo } from 'react'
import type { Job, KanbanColumn, Workspace } from '@/lib/types'
import { useUsers } from '@/lib/use-users'
import { ApprovalStatusPill } from './approval-status-pill'

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
      {/*
        Round 7.16: column sizing fix.

        Previously the table used the default `table-auto` layout,
        which sizes columns based on content. Because the Title
        cell contains a multi-line stack (title + optional approval
        pill + description), the browser kept giving Title 50%+ of
        the width and squeezing every other column — dates wrapped
        to 3 lines, platform lists stacked vertically, the whole
        thing pushed past the viewport.

        Switching to `table-fixed` + an explicit <colgroup> gives us
        deterministic widths that don't depend on content. The Title
        column gets the largest share (it carries the most text)
        but the other columns are guaranteed enough room to stay
        on a single line.

        Percentages chosen to total ~100% on a typical desktop
        viewport. The container retains overflow-x-auto so on
        narrower screens (mobile, narrow side-by-side) the table
        scrolls horizontally rather than collapsing.
      */}
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col style={{ width: '28%' }} />{/* Title */}
          <col style={{ width: '11%' }} />{/* Workspace */}
          <col style={{ width: '12%' }} />{/* Stage */}
          <col style={{ width: '14%' }} />{/* Platform */}
          <col style={{ width: '7%' }} />{/* Priority */}
          <col style={{ width: '9%' }} />{/* Due */}
          <col style={{ width: '10%' }} />{/* Assigned */}
          <col style={{ width: '9%' }} />{/* Updated */}
        </colgroup>
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
                  {/* Round 7.13: approval status pill renders only
                      when status is not 'none'. Sits under the title
                      so the eye lands on it after the title — same
                      pattern as kanban cards. */}
                  {job.approvalStatus !== 'none' && (
                    <div className="mt-1">
                      <ApprovalStatusPill status={job.approvalStatus} size="sm" />
                    </div>
                  )}
                  {job.description && (
                    <div className="text-xs text-slate-600 line-clamp-1 mt-0.5">
                      {job.description}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 truncate" title={wsName.get(job.workspaceId) ?? ''}>
                  {wsName.get(job.workspaceId) ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {/* Round 7.16: whitespace-nowrap so two-word stage
                      labels like "In Production" or "Posted/Live"
                      stay on one line. The dot + label sits in a
                      flex row that truncates with ellipsis if even
                      the label is too long for the column. */}
                  <span className="inline-flex items-center gap-2 max-w-full">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: col?.color ?? '#64748b' }}
                    />
                    <span className="truncate" title={col?.label ?? job.stage}>
                      {col?.label ?? job.stage}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {/* Round 7.16: platform value can be a comma-list
                      ("facebook, instagram, tiktok, ..."). Truncate
                      to one line with the full value in a tooltip
                      so it doesn't blow the row height. */}
                  <span className="block truncate" title={job.platform ?? ''}>
                    {job.platform || '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {job.priority > 0 ? (
                    <span className="inline-flex rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[10px] font-semibold">
                      P{job.priority}
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-700 font-medium' : 'text-slate-600'}`}>
                  {formatDate(job.dueDate)}
                </td>
                <td className="px-4 py-3 text-slate-600 truncate" title={job.assignedTo ? userName.get(job.assignedTo) ?? '' : ''}>
                  {job.assignedTo ? userName.get(job.assignedTo) ?? 'Unknown' : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(job.updatedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
