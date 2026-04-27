"use client"

import { useEffect, useState } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import type { KanbanColumn } from '@/lib/types'

/**
 * Kanban columns editor — Round 7.2b.
 *
 * Lives inside the workspace edit dialog as the "Kanban columns" tab.
 * Lets users:
 *   - rename ANY column (built-ins included)
 *   - recolor ANY column
 *   - reorder via drag-and-drop
 *   - add a custom column
 *   - delete a custom column (built-ins cannot be deleted, the API
 *     enforces this server-side; we hide the delete button for them)
 *
 * Custom columns show the caption "Posts here are excluded from
 * reports" so the user knows the trade-off.
 *
 * State strategy:
 *   - The editor manages its own optimistic state. Edits are sent to
 *     the API immediately on blur (rename) / dropdown close (color) /
 *     drop (reorder). If the server rejects, we revert and show the
 *     error inline.
 *   - When ANY change persists, onColumnsChanged fires so the parent
 *     can refetch in the kanban view.
 *   - We refetch on mount to get the latest state.
 */
export function KanbanColumnsEditor({
  workspaceId,
  onColumnsChanged,
}: {
  workspaceId: string
  /** Fired after any successful mutation so the parent (app-shell)
   *  can refresh its column-driven views. */
  onColumnsChanged: () => void
}) {
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ---------- load ----------
  async function loadColumns() {
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/columns`,
      )
      if (!res.ok) {
        setError(`Failed to load columns (${res.status})`)
        return
      }
      const data = (await res.json()) as KanbanColumn[]
      setColumns(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void loadColumns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // ---------- patch (rename / recolor) ----------
  async function patchColumn(
    columnId: string,
    patch: { label?: string; color?: string },
  ) {
    const prev = columns
    // Optimistic update
    setColumns((cs) =>
      cs.map((c) => (c.id === columnId ? { ...c, ...patch } : c)),
    )
    setSavingId(columnId)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/columns/${encodeURIComponent(columnId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Save failed (${res.status})`)
        setColumns(prev)
        return
      }
      const data = (await res.json()) as { column: KanbanColumn }
      setColumns((cs) => cs.map((c) => (c.id === columnId ? data.column : c)))
      onColumnsChanged()
    } catch (err) {
      setColumns(prev)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  // ---------- create custom column ----------
  async function addCustomColumn() {
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/columns`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'New column', color: '#a855f7' }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Create failed (${res.status})`)
        return
      }
      const data = (await res.json()) as { column: KanbanColumn }
      setColumns((cs) => [...cs, data.column])
      onColumnsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // ---------- delete custom column ----------
  async function deleteColumn(columnId: string) {
    const prev = columns
    setColumns((cs) => cs.filter((c) => c.id !== columnId))
    setSavingId(columnId)
    setError(null)
    setConfirmDeleteId(null)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/columns/${encodeURIComponent(columnId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Delete failed (${res.status})`)
        setColumns(prev)
        return
      }
      onColumnsChanged()
    } catch (err) {
      setColumns(prev)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  // ---------- reorder ----------
  async function onDragEnd(result: DropResult) {
    if (!result.destination) return
    if (result.source.index === result.destination.index) return

    const reordered = [...columns]
    const [moved] = reordered.splice(result.source.index, 1)
    reordered.splice(result.destination.index, 0, moved)

    const prev = columns
    setColumns(reordered.map((c, i) => ({ ...c, sortOrder: i })))
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/columns?action=reorder`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds: reordered.map((c) => c.id) }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Reorder failed (${res.status})`)
        setColumns(prev)
        return
      }
      const data = (await res.json()) as { columns: KanbanColumn[] }
      setColumns(data.columns)
      onColumnsChanged()
    } catch (err) {
      setColumns(prev)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-slate-600">Loading columns…</p>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Drag to reorder. Built-in columns (the five reserved stages)
          can be renamed and recoloured but not deleted. Custom columns
          are excluded from reports.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            className="text-xs underline"
            onClick={() => setError(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="columns-editor">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="space-y-2"
            >
              {columns.map((col, index) => (
                <Draggable draggableId={col.id} index={index} key={col.id}>
                  {(prov, snap) => (
                    <div
                      ref={prov.innerRef}
                      {...prov.draggableProps}
                      className={`rounded-lg border bg-white p-3 ${
                        snap.isDragging
                          ? 'border-indigo-400 shadow-lg'
                          : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Drag handle */}
                        <span
                          {...prov.dragHandleProps}
                          className="cursor-grab text-slate-400 hover:text-slate-600 select-none px-1 text-lg leading-none"
                          aria-label="Drag to reorder"
                          title="Drag to reorder"
                        >
                          ⋮⋮
                        </span>

                        {/* Color swatch */}
                        <input
                          type="color"
                          value={col.color}
                          onChange={(e) => {
                            const newColor = e.target.value
                            setColumns((cs) =>
                              cs.map((c) =>
                                c.id === col.id ? { ...c, color: newColor } : c,
                              ),
                            )
                          }}
                          onBlur={(e) => {
                            // Only save when the user actually changes
                            // the color and closes the picker. The
                            // blur fires once the picker UI dismisses.
                            const finalColor = e.target.value
                            const original = columns.find((c) => c.id === col.id)
                            if (original && original.color !== finalColor) {
                              void patchColumn(col.id, { color: finalColor })
                            }
                          }}
                          className="h-8 w-10 rounded border border-slate-300 bg-white cursor-pointer flex-shrink-0"
                          aria-label="Column color"
                          disabled={savingId === col.id}
                        />

                        {/* Label input */}
                        <input
                          type="text"
                          value={col.label}
                          onChange={(e) => {
                            const newLabel = e.target.value
                            setColumns((cs) =>
                              cs.map((c) =>
                                c.id === col.id ? { ...c, label: newLabel } : c,
                              ),
                            )
                          }}
                          onBlur={(e) => {
                            const finalLabel = e.target.value.trim()
                            if (finalLabel.length === 0) {
                              // Revert to the previous (server-side) label.
                              void loadColumns()
                              return
                            }
                            // Find the server-side state to compare.
                            // Since `columns` may already reflect this
                            // change, we just send and let the server
                            // be canonical.
                            void patchColumn(col.id, { label: finalLabel })
                          }}
                          maxLength={60}
                          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          disabled={savingId === col.id}
                          aria-label="Column label"
                        />

                        {/* Built-in badge or delete button */}
                        {col.isBuiltin ? (
                          <span
                            className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 px-2"
                            title="Built-in stage — cannot be deleted"
                          >
                            Built-in
                          </span>
                        ) : confirmDeleteId === col.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => deleteColumn(col.id)}
                              className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-2 py-1.5"
                              disabled={savingId === col.id}
                            >
                              Delete?
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs px-2 py-1.5"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(col.id)}
                            className="text-xs text-slate-500 hover:text-red-600 px-2 py-1"
                            title="Delete this custom column"
                            disabled={savingId === col.id}
                          >
                            Delete
                          </button>
                        )}
                      </div>

                      {/* Custom-column caption */}
                      {!col.isBuiltin && (
                        <p className="text-[11px] text-slate-500 mt-2 ml-9">
                          Posts here are excluded from reports.
                        </p>
                      )}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <button
        type="button"
        onClick={addCustomColumn}
        className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-600 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors px-4 py-3 text-sm font-medium"
      >
        + Add custom column
      </button>
    </div>
  )
}
