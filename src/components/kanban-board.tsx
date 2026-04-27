"use client"

import { useMemo } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import type { Job, JobStage } from '@/lib/types'
import { useUsers } from '@/lib/use-users'

const STAGES: { id: JobStage; label: string; dot: string; bg: string }[] = [
  { id: 'brief', label: 'Brief', dot: '#64748b', bg: 'rgba(100,116,139,0.10)' },
  { id: 'production', label: 'In Production', dot: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  { id: 'ready', label: 'Ready for Posting', dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  { id: 'posted', label: 'Posted', dot: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  { id: 'archive', label: 'Archive', dot: '#4b5563', bg: 'rgba(75,85,99,0.10)' },
]

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

export function KanbanBoard({
  jobs,
  onSelectJob,
  onMoveJob,
}: {
  jobs: Job[]
  onSelectJob: (job: Job) => void
  /** Called when a card is dragged to a new stage. The parent is
   * responsible for the API PATCH and any optimistic UI. */
  onMoveJob: (jobId: string, newStage: JobStage) => void
}) {
  const { users } = useUsers()
  const userById = useMemo(() => {
    const m = new Map<string, { name: string | null; email: string }>()
    for (const u of users) m.set(u.id, { name: u.name, email: u.email })
    return m
  }, [users])

  const grouped = useMemo(() => {
    return STAGES.map((stage) => ({
      ...stage,
      jobs: jobs.filter((job) => job.stage === stage.id),
    }))
  }, [jobs])

  function onDragEnd(result: DropResult) {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId) return
    const newStage = destination.droppableId as JobStage
    if (!STAGES.some((s) => s.id === newStage)) return
    onMoveJob(draggableId, newStage)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid xl:grid-cols-5 md:grid-cols-2 gap-4">
        {grouped.map((column) => (
          <Droppable droppableId={column.id} key={column.id}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`rounded-2xl border border-slate-200 kanban-shadow min-h-[460px] flex flex-col transition-colors ${
                  snapshot.isDraggingOver ? 'ring-2 ring-indigo-400' : ''
                }`}
                style={{ backgroundColor: column.bg }}
              >
                <div className="p-4 border-b border-slate-200/60 bg-white/70 backdrop-blur-sm flex items-center justify-between rounded-t-2xl">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.dot }} />
                    <h3 className="font-semibold text-sm text-slate-900">{column.label}</h3>
                  </div>
                  <span className="text-xs text-slate-600 rounded-full border border-slate-300 bg-white px-2 py-1">
                    {column.jobs.length}
                  </span>
                </div>

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
                          // Round 7.1.5: cards now use bg-white (was the
                          // page background) so they have proper depth
                          // against the column's tinted backdrop.
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectJob(job)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                // Don't intercept the spacebar during a
                                // drag — dnd uses spacebar to lift/drop.
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
                            {job.description && (
                              <p className="text-xs text-slate-600 line-clamp-2">{job.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-600">
                              {job.platform && (
                                <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5">{job.platform}</span>
                              )}
                              {job.contentType && (
                                <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5">{job.contentType}</span>
                              )}
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
