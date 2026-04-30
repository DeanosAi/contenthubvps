"use client"

import { useMemo } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import type { Job, KanbanColumn } from '@/lib/types'
import { useUsers } from '@/lib/use-users'
import { ApprovalStatusPill } from './approval-status-pill'

/** Two-letter initials from a name or email — used for the assignee avatar
 * dot on cards. */
function initialsFor(input: string | null | undefined): string {
  if (!input) return '?'
  const parts = input.split(/[@\s]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Formats a due date as "Mon 5 May" if same year, otherwise "5 May 2026". */
function formatDue(dateStr: string | null): { text: string; overdue: boolean } | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const overdue = d.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  return { text: d.toLocaleDateString(undefined, opts), overdue }
}

/**
 * Convert a column's hex color into a translucent rgba() so it can
 * tint the column backdrop without crowding out the white cards.
 *
 * 6-char hex assumed (the API validates this). If a malformed color
 * sneaks through we fall back to slate-500 at 10% alpha.
 */
function tintBackground(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 'rgba(100,116,139,0.10)'
  const num = parseInt(m[1], 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  return `rgba(${r},${g},${b},0.10)`
}

export function KanbanBoard({
  jobs,
  columns,
  onSelectJob,
  onMoveJob,
  archiveTrueCount,
}: {
  jobs: Job[]
  /** Per-workspace column configuration, sorted by sortOrder. */
  columns: KanbanColumn[]
  onSelectJob: (job: Job) => void
  /** Called when a card is dragged to a new stage. The parent is
   * responsible for the API PATCH and any optimistic UI. */
  onMoveJob: (jobId: string, newStage: string) => void
  /**
   * Round 7.12: when set, overrides the displayed count for the
   * archive column so it shows the TRUE number of archived jobs
   * even when the hideArchived filter is excluding them from view.
   * For non-archive columns, count is derived from `jobs` as
   * before. The parent computes this from workspace-scoped (but
   * otherwise filtered) data.
   */
  archiveTrueCount?: number
}) {
  const { users } = useUsers()
  const userById = useMemo(() => {
    const m = new Map<string, { name: string | null; email: string }>()
    for (const u of users) m.set(u.id, { name: u.name, email: u.email })
    return m
  }, [users])

  const grouped = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      jobs: jobs.filter((job) => job.stage === column.stageKey),
    }))
  }, [jobs, columns])

  // The stage_keys we know about, used to validate drops. Anything
  // dropped on a droppable whose key isn't here is ignored — defends
  // against a stale UI where the user has the dialog open with old
  // columns and a teammate just deleted one.
  const validStageKeys = useMemo(
    () => new Set(columns.map((c) => c.stageKey)),
    [columns],
  )

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId) return
    const newStage = destination.droppableId
    if (!validStageKeys.has(newStage)) return
    onMoveJob(draggableId, newStage)
  }

  // Choose a responsive grid: 1 col on small, 2 on md, then dynamic
  // on xl based on actual column count. Tailwind compiles classes at
  // build time, so we use a switch to pick a static class string —
  // a template literal would NOT survive Tailwind's purge.
  //
  // Beyond 6 columns we just keep grid-cols-6 and let the rightmost
  // columns spill onto a 2nd row. The columns editor doesn't enforce
  // an upper bound, but in practice teams won't go past 7-8.
  const colCount = columns.length
  const gridCols =
    colCount <= 1 ? 'xl:grid-cols-1 md:grid-cols-1 grid-cols-1' :
    colCount === 2 ? 'xl:grid-cols-2 md:grid-cols-2 grid-cols-1' :
    colCount === 3 ? 'xl:grid-cols-3 md:grid-cols-2 grid-cols-1' :
    colCount === 4 ? 'xl:grid-cols-4 md:grid-cols-2 grid-cols-1' :
    colCount === 5 ? 'xl:grid-cols-5 md:grid-cols-2 grid-cols-1' :
    'xl:grid-cols-6 md:grid-cols-2 grid-cols-1'

  if (columns.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center">
        <p className="text-sm text-slate-600">
          No kanban columns configured for this workspace. Open Workspace
          settings → Kanban columns to add some.
        </p>
      </div>
    )
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className={`grid gap-4 ${gridCols}`}>
        {grouped.map((column) => (
          <Droppable droppableId={column.stageKey} key={column.id}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`rounded-2xl border border-slate-200 kanban-shadow min-h-[460px] flex flex-col transition-colors ${
                  snapshot.isDraggingOver ? 'ring-2 ring-indigo-400' : ''
                }`}
                style={{ backgroundColor: tintBackground(column.color) }}
              >
                <div className="p-4 border-b border-slate-200/60 bg-white/70 backdrop-blur-sm flex items-center justify-between rounded-t-2xl">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: column.color }}
                    />
                    <h3 className="font-semibold text-sm text-slate-900 truncate">
                      {column.label}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-600 rounded-full border border-slate-300 bg-white px-2 py-1 flex-shrink-0">
                    {column.stageKey === 'archive' && typeof archiveTrueCount === 'number'
                      ? archiveTrueCount
                      : column.jobs.length}
                  </span>
                </div>

                {/* Custom-column caption */}
                {!column.isBuiltin && (
                  <p className="px-4 py-2 text-[11px] text-slate-500 italic border-b border-slate-200/40 bg-white/30">
                    Posts here are excluded from reports
                  </p>
                )}

                <div className="p-3 space-y-3 flex-1">
                  {column.jobs.map((job, index) => {
                    const due = formatDue(job.dueDate)
                    const assignee = job.assignedTo ? userById.get(job.assignedTo) : null
                    return (
                      <Draggable draggableId={job.id} index={index} key={job.id}>
                        {(prov, snap) => (
                          // KEY DRAG-DROP FIX: this MUST be a <div> with
                          // role="button", not an actual <button> element.
                          // @hello-pangea/dnd installs HTML5 drag handlers
                          // via dragHandleProps. Browsers handle native
                          // <button> drag events differently than div drag
                          // events — drops don't fire reliably on buttons,
                          // which manifests as "card visually drags but
                          // doesn't move on drop." The library docs
                          // explicitly recommend div + role="button" +
                          // tabIndex + keyboard handler for accessibility.
                          //
                          // Round 7.1.5: cards use bg-white (was the page
                          // background) so they have proper depth against
                          // the column's tinted backdrop.
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectJob(job)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                if (snap.isDragging) return
                                e.preventDefault()
                                onSelectJob(job)
                              }
                            }}
                            className={`w-full text-left rounded-xl border border-slate-200 bg-white p-3 space-y-2 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer ${
                              snap.isDragging ? 'shadow-xl ring-2 ring-indigo-400' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-medium text-sm leading-snug line-clamp-2 text-slate-900">{job.title}</h4>
                              {job.priority > 0 && (
                                <span className="shrink-0 text-[10px] rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 font-semibold">
                                  P{job.priority}
                                </span>
                              )}
                            </div>
                            {/* Round 7.13: approval status pill renders
                                only when status is not 'none'. Sits
                                directly under the title, left-aligned,
                                so it's the first thing the eye lands
                                on after the title. */}
                            {job.approvalStatus !== 'none' && (
                              <div className="-mt-1">
                                <ApprovalStatusPill status={job.approvalStatus} size="sm" />
                              </div>
                            )}
                            {job.description && (
                              <p className="text-xs text-slate-600 line-clamp-2">{job.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-600">
                              {job.platform && (
                                <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5">{job.platform}</span>
                              )}
                              {(job.contentTypes ?? []).map((t) => (
                                <span key={t} className="rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 px-2 py-0.5">
                                  {t}
                                </span>
                              ))}
                              {due && (
                                <span
                                  className={`rounded-full border px-2 py-0.5 ${
                                    due.overdue && job.stage !== 'posted' && job.stage !== 'archive'
                                      ? 'border-red-300 bg-red-50 text-red-700 font-medium'
                                      : 'border-slate-300 bg-slate-50'
                                  }`}
                                >
                                  {due.text}
                                </span>
                              )}
                              {job.assetLinks.length > 0 && (
                                <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5">
                                  📎 {job.assetLinks.length}
                                </span>
                              )}
                            </div>
                            {assignee && (
                              <div className="flex items-center gap-2 pt-1">
                                <span
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700"
                                  title={assignee.name || assignee.email}
                                >
                                  {initialsFor(assignee.name || assignee.email)}
                                </span>
                                <span className="text-[10px] text-slate-600 truncate">
                                  {assignee.name || assignee.email}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}
                  {column.jobs.length === 0 && !snapshot.isDraggingOver && (
                    <p className="text-xs text-slate-500">No jobs</p>
                  )}
                </div>
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  )
}
