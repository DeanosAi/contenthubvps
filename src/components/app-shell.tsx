"use client"

import { useEffect, useMemo, useState } from 'react'
import { KanbanBoard } from '@/components/kanban-board'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { DashboardStats } from '@/components/dashboard-stats'
import type { Job, Workspace } from '@/lib/types'

export function AppShell() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newJobTitle, setNewJobTitle] = useState('')
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string>('')
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('')

  async function loadWorkspaces() {
    const res = await fetch('/api/workspaces')
    if (!res.ok) return
    const data = await res.json()
    setWorkspaces(data.map((w: any) => ({ id: w.id, ownerId: w.owner_id, name: w.name, color: w.color, sortOrder: w.sort_order, createdAt: w.created_at, updatedAt: w.updated_at })))
    if (!selectedWorkspaceId && data[0]?.id) setSelectedWorkspaceId(data[0].id)
  }

  async function loadJobs(workspaceId?: string) {
    const url = workspaceId ? `/api/jobs?workspaceId=${workspaceId}` : '/api/jobs'
    const res = await fetch(url)
    if (!res.ok) return
    const data = await res.json()
    setJobs(data.map((j: any) => ({ id: j.id, workspaceId: j.workspace_id, title: j.title, description: j.description, stage: j.stage, priority: j.priority, dueDate: j.due_date, hashtags: j.hashtags, createdAt: j.created_at, updatedAt: j.updated_at })))
  }

  useEffect(() => { void loadWorkspaces() }, [])
  useEffect(() => { if (selectedWorkspaceId) void loadJobs(selectedWorkspaceId) }, [selectedWorkspaceId])

  async function refreshAll() {
    await loadWorkspaces()
    if (selectedWorkspaceId) await loadJobs(selectedWorkspaceId)
  }

  async function createWorkspace() {
    if (!newWorkspaceName.trim()) return
    await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newWorkspaceName, color: '#8b5cf6' }) })
    setNewWorkspaceName('')
    await loadWorkspaces()
  }

  async function updateWorkspace(id: string) {
    if (!editingWorkspaceName.trim()) return
    await fetch(`/api/workspaces/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editingWorkspaceName, color: '#8b5cf6' }) })
    setEditingWorkspaceId('')
    setEditingWorkspaceName('')
    await loadWorkspaces()
  }

  async function deleteWorkspace(id: string) {
    await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (selectedWorkspaceId === id) setSelectedWorkspaceId('')
    await loadWorkspaces()
    await loadJobs()
  }

  async function createJob() {
    if (!newJobTitle.trim() || !selectedWorkspaceId) return
    await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: selectedWorkspaceId, title: newJobTitle, stage: 'brief', priority: 0 }) })
    setNewJobTitle('')
    await loadJobs(selectedWorkspaceId)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const visibleJobs = useMemo(() => jobs.filter((job) => !selectedWorkspaceId || job.workspaceId === selectedWorkspaceId), [jobs, selectedWorkspaceId])
  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)

  return (
    <div className="flex min-h-screen">
      <HostedSidebar workspaces={workspaces} selectedWorkspaceId={selectedWorkspaceId} onSelectWorkspace={setSelectedWorkspaceId} />

      <main className="flex-1 p-8 space-y-8">
        <section className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Hosted Content Hub</p>
            <h1 className="text-4xl font-bold mt-2">Dashboard</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-3 max-w-3xl">
              {activeWorkspace ? `Currently viewing ${activeWorkspace.name}.` : 'Select a workspace to manage content jobs.'}
            </p>
          </div>
          <button className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))]" onClick={logout}>Log out</button>
        </section>

        <DashboardStats jobs={visibleJobs} />

        <section className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-[hsl(var(--card))] p-5 space-y-3">
            <h2 className="font-semibold">Create workspace</h2>
            <div className="flex gap-2">
              <input className="flex-1 rounded-lg border bg-transparent px-3 py-2" value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} placeholder="Workspace name" />
              <button className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-[hsl(var(--primary-foreground))] font-semibold" onClick={createWorkspace}>Add</button>
            </div>
          </div>
          <div className="rounded-2xl border bg-[hsl(var(--card))] p-5 space-y-3">
            <h2 className="font-semibold">Create job</h2>
            <div className="flex gap-2">
              <input className="flex-1 rounded-lg border bg-transparent px-3 py-2" value={newJobTitle} onChange={(e) => setNewJobTitle(e.target.value)} placeholder="Job title" />
              <button className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-[hsl(var(--primary-foreground))] font-semibold" onClick={createJob}>Add</button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {workspaces.map((workspace) => (
              <div key={workspace.id} className={`rounded-xl border px-4 py-3 min-w-56 ${selectedWorkspaceId === workspace.id ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--card))]'}`}>
                {editingWorkspaceId === workspace.id ? (
                  <div className="space-y-2">
                    <input className="w-full rounded-lg border bg-transparent px-3 py-2" value={editingWorkspaceName} onChange={(e) => setEditingWorkspaceName(e.target.value)} />
                    <div className="flex gap-2">
                      <button className="rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-[hsl(var(--primary-foreground))] text-sm font-semibold" onClick={() => updateWorkspace(workspace.id)}>Save</button>
                      <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setEditingWorkspaceId('')}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setSelectedWorkspaceId(workspace.id)} className="w-full text-left">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: workspace.color }} />
                        <span className="font-medium">{workspace.name}</span>
                      </div>
                    </button>
                    <div className="flex gap-2 mt-3">
                      <button className="text-xs text-[hsl(var(--primary))]" onClick={() => { setEditingWorkspaceId(workspace.id); setEditingWorkspaceName(workspace.name) }}>Edit</button>
                      <button className="text-xs text-red-400" onClick={() => deleteWorkspace(workspace.id)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold">Kanban Dashboard</h2>
            <p className="text-[hsl(var(--muted-foreground))] text-sm mt-1">Hosted MVP with live workspaces/jobs via the API layer.</p>
          </div>
          <KanbanBoard jobs={visibleJobs} onRefresh={refreshAll} />
        </section>
      </main>
    </div>
  )
}
