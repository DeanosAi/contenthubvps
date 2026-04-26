"use client"

import { useState } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import type { Workspace } from '@/lib/types'
import { WorkspaceEditDialog } from '@/components/workspace-edit-dialog'

/** Sidebar listing all workspaces with drag-to-reorder, hover-revealed
 * Edit and Delete buttons, and a footer input to add new ones. This is
 * the only place workspaces appear in the chrome — the duplicate
 * grid that lived in the main panel of Round 2 has been removed.
 *
 * Round 6.4 adds a ⚙ button per row that opens a settings dialog for
 * the deeper fields (color, Facebook page URL, Instagram page URL).
 * The inline ✎ rename stays for quick name-only edits.
 *
 * Data flow: this component is presentational + emits intents via the
 * callbacks below. AppShell still owns the canonical workspace state
 * and is responsible for refetching after each mutation succeeds. */
export function HostedSidebar({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onReorderWorkspaces,
  onWorkspaceUpdated,
}: {
  workspaces: Workspace[]
  selectedWorkspaceId: string
  onSelectWorkspace: (id: string) => void
  onCreateWorkspace: (name: string) => Promise<void>
  onRenameWorkspace: (id: string, name: string) => Promise<void>
  onDeleteWorkspace: (id: string) => Promise<void>
  /** Bulk reorder. Receives the ids in their new order. AppShell calls
   * /api/workspaces/reorder with this list. */
  onReorderWorkspaces: (orderedIds: string[]) => Promise<void>
  /** Round 6.4: called by the settings dialog with the freshly-saved
   * workspace, so AppShell can update its state without a full refetch. */
  onWorkspaceUpdated: (updated: Workspace) => void
}) {
  const [editingId, setEditingId] = useState<string>('')
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')
  const [settingsForId, setSettingsForId] = useState<string>('')

  function startEdit(workspace: Workspace) {
    setEditingId(workspace.id)
    setEditingName(workspace.name)
  }

  function cancelEdit() {
    setEditingId('')
    setEditingName('')
  }

  async function commitEdit() {
    const id = editingId
    const name = editingName.trim()
    if (!id || !name) return cancelEdit()
    await onRenameWorkspace(id, name)
    cancelEdit()
  }

  async function commitCreate() {
    const name = newName.trim()
    if (!name) return
    await onCreateWorkspace(name)
    setNewName('')
  }

  async function handleDelete(workspace: Workspace) {
    if (!confirm(`Delete "${workspace.name}" and all of its jobs?`)) return
    await onDeleteWorkspace(workspace.id)
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    if (result.destination.index === result.source.index) return

    // Compute the new order from the current display order. We don't
    // sort by sortOrder here — we trust the order workspaces[] arrives
    // in (AppShell already sorts by sort_order on load).
    const reordered = Array.from(workspaces)
    const [moved] = reordered.splice(result.source.index, 1)
    reordered.splice(result.destination.index, 0, moved)
    void onReorderWorkspaces(reordered.map((w) => w.id))
  }

  return (
    <aside className="w-72 border-r bg-[hsl(var(--card))] flex flex-col">
      <div className="p-4 border-b flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-[hsl(var(--primary))]/15 flex items-center justify-center">
          <div className="h-4 w-4 rounded bg-[hsl(var(--primary))]" />
        </div>
        <h1 className="text-xl font-bold">Content Hub</h1>
      </div>

      <div className="p-4 border-b">
        <nav className="space-y-2 text-sm">
          <div className="rounded-md bg-[hsl(var(--accent))] px-3 py-2">Dashboard</div>
          <div className="rounded-md px-3 py-2 text-[hsl(var(--muted-foreground))]">Calendar</div>
          <div className="rounded-md px-3 py-2 text-[hsl(var(--muted-foreground))]">Reports</div>
          <div className="rounded-md px-3 py-2 text-[hsl(var(--muted-foreground))]">Settings</div>
        </nav>
      </div>

      <div className="p-4 flex-1 overflow-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">
          Workspaces
        </p>

        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="workspaces">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
                {workspaces.map((workspace, index) => (
                  <Draggable draggableId={workspace.id} index={index} key={workspace.id}>
                    {(prov, snap) => (
                      <div
                        ref={prov.innerRef}
                        {...prov.draggableProps}
                        className={`group rounded-md transition-colors ${
                          selectedWorkspaceId === workspace.id
                            ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                            : 'hover:bg-[hsl(var(--accent))]/50'
                        } ${snap.isDragging ? 'shadow-lg ring-1 ring-[hsl(var(--primary))]/60' : ''}`}
                      >
                        {editingId === workspace.id ? (
                          <div className="px-2 py-1.5 space-y-1.5">
                            <input
                              autoFocus
                              className="w-full rounded border bg-transparent px-2 py-1 text-sm"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void commitEdit()
                                if (e.key === 'Escape') cancelEdit()
                              }}
                            />
                            <div className="flex gap-1">
                              <button
                                className="text-xs px-2 py-0.5 rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold"
                                onClick={commitEdit}
                              >
                                Save
                              </button>
                              <button className="text-xs px-2 py-0.5 rounded border" onClick={cancelEdit}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 px-1">
                            {/* Drag handle is the "·· name" left side. The
                                Edit/Delete icons are NOT inside the handle,
                                so clicking them doesn't trigger a drag. */}
                            <div
                              {...prov.dragHandleProps}
                              onClick={() => onSelectWorkspace(workspace.id)}
                              className="flex-1 flex items-center gap-2 px-2 py-1.5 cursor-pointer min-w-0"
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: workspace.color }}
                              />
                              <span className="text-sm truncate">{workspace.name}</span>
                            </div>

                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEdit(workspace)
                                }}
                                className="text-xs px-1.5 py-1 rounded hover:bg-[hsl(var(--background))]/50"
                                title="Rename workspace"
                                aria-label="Rename"
                              >
                                ✎
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSettingsForId(workspace.id)
                                }}
                                className="text-xs px-1.5 py-1 rounded hover:bg-[hsl(var(--background))]/50"
                                title="Workspace settings (color, page URLs)"
                                aria-label="Settings"
                              >
                                ⚙
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleDelete(workspace)
                                }}
                                className="text-xs px-1.5 py-1 rounded hover:bg-red-500/20 text-red-400"
                                title="Delete workspace"
                                aria-label="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
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

        {workspaces.length === 0 && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
            No workspaces yet. Add one below.
          </p>
        )}
      </div>

      <div className="p-3 border-t">
        <div className="flex gap-1.5">
          <input
            className="flex-1 rounded border bg-transparent px-2 py-1.5 text-sm"
            placeholder="New workspace…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitCreate()
            }}
          />
          <button
            onClick={commitCreate}
            disabled={!newName.trim()}
            className="rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold text-sm px-2.5 disabled:opacity-50"
            aria-label="Add workspace"
          >
            +
          </button>
        </div>
      </div>

      {/* Round 6.4: settings dialog. Rendered inside the sidebar so it
          lives in the same tree as the trigger button — keeps the
          state local to where it's relevant. */}
      {settingsForId && (() => {
        const ws = workspaces.find((w) => w.id === settingsForId)
        if (!ws) return null
        return (
          <WorkspaceEditDialog
            workspace={ws}
            onClose={() => setSettingsForId('')}
            onSaved={(updated) => {
              onWorkspaceUpdated(updated)
              setSettingsForId('')
            }}
          />
        )
      })()}
    </aside>
  )
}
