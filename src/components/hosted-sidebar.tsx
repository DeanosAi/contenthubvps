"use client"

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import type { Workspace } from '@/lib/types'
import { WorkspaceEditDialog } from '@/components/workspace-edit-dialog'
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog'

/**
 * Sidebar — Round 7.1 layout.
 *
 * Now sits as a self-contained card inside a grid cell rather than a
 * full-bleed left rail. Height is determined by its grid cell, so it
 * naturally aligns to the bottom of whatever's in the right column
 * (header + dashboard widgets + filters). The kanban below extends
 * full-width, taking the freed horizontal space.
 *
 * Layout inside the sidebar:
 *   - Top: branding + nav links (Dashboard / Calendar / Reports / Settings)
 *   - Middle: "Workspaces" header with a [+] icon that opens a creation
 *     modal, then the workspace list (scrolls internally if too tall)
 *
 * Removed in 7.1:
 *   - The bottom name-only create input. Replaced with the modal so
 *     new workspaces start fully configured (name + color + page URLs).
 *
 * Data flow: this component is presentational + emits intents via the
 * callbacks below. Each page-level shell (AppShell, CalendarShell,
 * ReportsShell, SettingsShell) owns its own canonical workspace state.
 * onWorkspaceCreated and onWorkspaceUpdated let the dialogs push the
 * server's canonical record back up without a refetch.
 */
export function HostedSidebar({
  workspaces,
  selectedWorkspaceId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onReorderWorkspaces,
  onWorkspaceUpdated,
  onWorkspaceCreated,
  onColumnsChanged,
}: {
  workspaces: Workspace[]
  selectedWorkspaceId: string
  onSelectWorkspace: (id: string) => void
  /** Legacy name-only create. Kept for backward compatibility — the
   * Round 7.1 modal calls /api/workspaces directly via
   * onWorkspaceCreated, so this callback is no longer triggered from
   * inside the sidebar. Parents may continue to pass it; we accept and
   * ignore. */
  onCreateWorkspace: (name: string) => Promise<void>
  onRenameWorkspace: (id: string, name: string) => Promise<void>
  onDeleteWorkspace: (id: string) => Promise<void>
  /** Bulk reorder. Receives the ids in their new order. AppShell calls
   * /api/workspaces/reorder with this list. */
  onReorderWorkspaces: (orderedIds: string[]) => Promise<void>
  /** Round 6.4: called by the settings dialog with the freshly-saved
   * workspace, so each shell can update its state without a refetch.
   * Optional — if not provided, the sidebar still works but the parent
   * won't know about settings changes until the next reload. */
  onWorkspaceUpdated?: (updated: Workspace) => void
  /** Round 7.1: called by the new creation modal with the freshly-
   * created workspace. Optional for backward compatibility — without
   * it, new workspaces won't appear in the parent's list until reload. */
  onWorkspaceCreated?: (created: Workspace) => void
  /** Round 7.2b: called whenever the workspace edit dialog's
   * "Kanban columns" tab makes a change (rename / recolor / reorder
   * / add / delete). Lets the parent refetch the active workspace's
   * columns so the kanban / filters / list view reflect the change
   * without a full reload. */
  onColumnsChanged?: () => void
}) {
  // onCreateWorkspace is intentionally unused — kept in the prop list
  // for backward compatibility with callers that still pass it.
  void onCreateWorkspace
  const pathname = usePathname()
  const [editingId, setEditingId] = useState<string>('')
  const [editingName, setEditingName] = useState('')
  const [settingsForId, setSettingsForId] = useState<string>('')
  const [createOpen, setCreateOpen] = useState(false)

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
    <aside className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_16px_rgba(15,23,42,0.08)] flex flex-col self-start overflow-hidden">
      {/* Branding row.
          Round 7.6: replaced the "Content Hub" h1 wordmark with a
          PNG/JPEG logo file. The small indigo-square placeholder
          to its left is preserved — that's reserved for an eventual
          per-client logo (the user's own brand mark, when this
          becomes a multi-tenant install where a workspace might
          render a custom logo there). The dual-icon look is
          intentional during this build phase. */}
      <div className="px-4 py-3.5 border-b border-slate-200 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center">
          <div className="h-4 w-4 rounded bg-indigo-600" />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element --
            using plain <img> intentionally. The logo is a tiny static
            asset (~16 KB), the optimisation Next/Image provides
            (responsive variants, lazy loading, blur placeholder) is
            unnecessary for a branding mark that's always above the
            fold and never resizes. */}
        <img
          src="/content-hub-logo.jpg"
          alt="Content Hub"
          className="h-7 w-auto"
        />
      </div>

      {/* Page navigation */}
      <div className="p-3 border-b border-slate-200">
        <nav className="space-y-0.5 text-sm">
          <SidebarLink href="/app" label="Dashboard" pathname={pathname} matchPrefix="/app" />
          <SidebarLink href="/calendar" label="Calendar" pathname={pathname} matchPrefix="/calendar" />
          <SidebarLink href="/reports" label="Reports" pathname={pathname} matchPrefix="/reports" />
          <SidebarLink href="/settings" label="Settings" pathname={pathname} matchPrefix="/settings" />
        </nav>
      </div>

      {/* Workspaces section */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header with "Workspaces" + "+" button. Sticky-ish: stays
            anchored above the scrolling list. */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Workspaces
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-6 w-6 rounded-md flex items-center justify-center text-base font-semibold text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            title="Create a new workspace"
            aria-label="New workspace"
          >
            +
          </button>
        </div>

        {/* Scroll region. max-h means the sidebar's overall height is
            bounded — past ~6-7 workspaces, the list scrolls inside this
            container instead of the sidebar growing. */}
        <div className="flex-1 overflow-y-auto px-3 pb-3 max-h-[28rem]">
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="workspaces">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-0.5">
                  {workspaces.map((workspace, index) => (
                    <Draggable draggableId={workspace.id} index={index} key={workspace.id}>
                      {(prov, snap) => (
                        <div
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          className={`group rounded-md transition-colors ${
                            selectedWorkspaceId === workspace.id
                              ? 'bg-indigo-50'
                              : 'hover:bg-slate-50'
                          } ${snap.isDragging ? 'shadow-lg ring-1 ring-indigo-400' : ''}`}
                        >
                          {editingId === workspace.id ? (
                            <div className="px-2 py-1.5 space-y-1.5">
                              <input
                                autoFocus
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitEdit()
                                  if (e.key === 'Escape') cancelEdit()
                                }}
                              />
                              <div className="flex gap-1">
                                <button
                                  className="text-xs px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                                  onClick={commitEdit}
                                >
                                  Save
                                </button>
                                <button className="text-xs px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={cancelEdit}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 px-1">
                              {/* Drag handle is the "·· name" left side. The
                                  Edit/Settings/Delete icons are NOT inside the
                                  handle, so clicking them doesn't trigger a
                                  drag. */}
                              <div
                                {...prov.dragHandleProps}
                                onClick={() => onSelectWorkspace(workspace.id)}
                                className="flex-1 flex items-center gap-2 px-2 py-1.5 cursor-pointer min-w-0"
                              >
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: workspace.color }}
                                />
                                <span className={`text-sm truncate ${
                                  selectedWorkspaceId === workspace.id
                                    ? 'text-indigo-900 font-semibold'
                                    : 'text-slate-800'
                                }`}>{workspace.name}</span>
                              </div>

                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    startEdit(workspace)
                                  }}
                                  className="text-xs px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
                                  className="text-xs px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
                                  className="text-xs px-1.5 py-1 rounded text-red-500 hover:bg-red-50 hover:text-red-700"
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
            <p className="text-xs text-slate-500 mt-2 px-2">
              No workspaces yet. Click + above to add one.
            </p>
          )}
        </div>
      </div>

      {/* Round 6.4 workspace settings dialog */}
      {settingsForId && (() => {
        const ws = workspaces.find((w) => w.id === settingsForId)
        if (!ws) return null
        return (
          <WorkspaceEditDialog
            workspace={ws}
            onClose={() => setSettingsForId('')}
            onSaved={(updated) => {
              onWorkspaceUpdated?.(updated)
              setSettingsForId('')
            }}
            onColumnsChanged={onColumnsChanged}
          />
        )
      })()}

      {/* Round 7.1 workspace creation dialog */}
      {createOpen && (
        <WorkspaceCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            onWorkspaceCreated?.(created)
            setCreateOpen(false)
          }}
        />
      )}
    </aside>
  )
}

/** Navigation link that renders active styling when the current pathname
 * matches `matchPrefix`. Pulled out of the JSX so the nav stays scannable. */
function SidebarLink({
  href,
  label,
  pathname,
  matchPrefix,
}: {
  href: string
  label: string
  pathname: string | null
  matchPrefix: string
}) {
  const isActive =
    pathname === matchPrefix ||
    (pathname?.startsWith(matchPrefix + '/') ?? false)
  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-2 transition-colors ${
        isActive
          ? 'bg-indigo-50 text-indigo-700 font-medium'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {label}
    </Link>
  )
}
