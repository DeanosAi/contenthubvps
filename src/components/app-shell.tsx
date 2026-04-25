"use client"

import { useEffect, useMemo, useState } from 'react'
import { KanbanBoard } from '@/components/kanban-board'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { DashboardStats } from '@/components/dashboard-stats'
import { DashboardFilters } from '@/components/dashboard-filters'
import { JobDetailPanel } from '@/components/job-detail-panel'
import type { Job, Workspace } from '@/lib/types'

export function AppShell() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [newJobTitle, setNewJobTitle] = useState('')
  const [newJobPlatform, setNewJobPlatform] = useState('instagram')
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string>('')
  const [editingWorkspaceName, setEditingWorkspaceName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // The API now returns camelCase, fully-shaped Workspace and Job objects.
  // No inline mapping required — just trust the API response shape.

  async function loadWorkspaces(): Promise<Workspace[]> {
    const res = await fetch('/api/workspaces')
    if (!res.ok) {
      setErrorMessage('Failed to load workspaces')
      return []
    }
    const data: Workspace[] = await res.json()
    setWorkspaces(data)
    return data
  }

  async function loadJobs(workspaceId?: string) {
    const url = workspaceId ? `/api/jobs?workspaceId=${encodeURIComponent(workspaceId)}` : '/api/jobs'
    const res = await fetch(url)
    if (!res.ok) {
      setErrorMessage('Failed to load jobs')
      return
    }
    const data: Job[] = await res.json()
    setJobs(data)
  }

  // First load: pull workspaces, default to the first one if nothing selected.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const ws = await loadWorkspaces()
      if (cancelled) return
      const initial = selectedWorkspaceId || ws[0]?.id || ''
      if (initial && initial !== selectedWorkspaceId) {
        setSelectedWorkspaceId(initial)
      } else if (initial) {
        await loadJobs(initial)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only run on mount — workspace changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedWorkspaceId) void loadJobs(selectedWorkspaceId)
  }, [selectedWorkspaceId])

  // If the currently selected job gets deleted (or its workspace
  // disappears), close the side panel so we don't show stale data.
  useEffect(() => {
    if (!selectedJob) return
    const stillExists = jobs.some((j) => j.id === selectedJob.id)
    if (!stillExists) setSelectedJob(null)
  }, [jobs, selectedJob])

  async function refreshAll() {
    const ws = await loadWorkspaces()
    if (selectedWorkspaceId && !ws.some((w) => w.id === selectedWorkspaceId)) {
      // Selected workspace was deleted somewhere else; pick a new default.
      setSelectedWorkspaceId(ws[0]?.id ?? '')
    } else if (selectedWorkspaceId) {
      await loadJobs(selectedWorkspaceId)
    }
  }

  async function createWorkspace() {
    if (!newWorkspaceName.trim()) return
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newWorkspaceName, color: '#8b5cf6' }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to create workspace')
      return
    }
    setNewWorkspaceName('')
    await loadWorkspaces()
  }

  async function updateWorkspace(id: string) {
    if (!editingWorkspaceName.trim()) return
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editingWorkspaceName }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to update workspace')
      return
    }
    setEditingWorkspaceId('')
    setEditingWorkspaceName('')
    await loadWorkspaces()
  }

  async function deleteWorkspace(id: string) {
    if (!confirm('Delete this workspace and all of its jobs?')) return
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setErrorMessage('Failed to delete workspace')
      return
    }
    if (selectedWorkspaceId === id) setSelectedWorkspaceId('')
    await refreshAll()
  }

  async function createJob() {
    if (!newJobTitle.trim() || !selectedWorkspaceId) return
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: selectedWorkspaceId,
        title: newJobTitle,
        stage: 'brief',
        priority: 0,
        platform: newJobPlatform,
      }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to create job')
      return
    }
    setNewJobTitle('')
    await loadJobs(selectedWorkspaceId)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (selectedWorkspaceId && job.workspaceId !== selectedWorkspaceId) return false
      if (
        keyword &&
        !`${job.title} ${job.description || ''} ${job.hashtags || ''} ${job.notes || ''}`
          .toLowerCase()
          .includes(keyword.toLowerCase())
      )
        return false
      if (stageFilter && job.stage !== stageFilter) return false
      if (platformFilter && job.platform !== platformFilter) return false
      return true
    })
  }, [jobs, selectedWorkspaceId, keyword, stageFilter, platformFilter])

  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)

  return (
    <div className="flex min-h-screen">
      <HostedSidebar
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
      />

      <main className="flex-1 p-8 space-y-8">
        <section className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Hosted Content Hub</p>
            <h1 className="text-4xl font-bold mt-2">Dashboard</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-3 max-w-3xl">
              {activeWorkspace
                ? `Currently viewing ${activeWorkspace.name}.`
                : loading
                ? 'Loading workspaces…'
                : 'Select or create a workspace to manage content jobs.'}
            </p>
          </div>
          <button
            className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))]"
            onClick={logout}
          >
            Log out
          </button>
        </section>

        {errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button className="text-xs underline" onClick={() => setErrorMessage(null)}>
              Dismiss
            </button>
          </div>
        )}

        <DashboardStats jobs={visibleJobs} />

        <DashboardFilters
          keyword={keyword}
          setKeyword={setKeyword}
          stage={stageFilter}
          setStage={setStageFilter}
          platform={platformFilter}
          setPlatform={setPlatformFilter}
        />

        <section className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-[hsl(var(--card))] p-5 space-y-3">
            <h2 className="font-semibold">Create workspace</h2>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border bg-transparent px-3 py-2"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createWorkspace()
                }}
              />
              <button
                className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-[hsl(var(--primary-foreground))] font-semibold"
                onClick={createWorkspace}
              >
                Add
              </button>
            </div>
          </div>
          <div className="rounded-2xl border bg-[hsl(var(--card))] p-5 space-y-3">
            <h2 className="font-semibold">Create job</h2>
            <div className="grid grid-cols-[1fr,160px,auto] gap-2">
              <input
                className="rounded-lg border bg-transparent px-3 py-2"
                value={newJobTitle}
                onChange={(e) => setNewJobTitle(e.target.value)}
                placeholder="Job title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createJob()
                }}
              />
              <select
                className="rounded-lg border bg-transparent px-3 py-2"
                value={newJobPlatform}
                onChange={(e) => setNewJobPlatform(e.target.value)}
              >
                <option value="instagram">instagram</option>
                <option value="facebook">facebook</option>
                <option value="tiktok">tiktok</option>
                <option value="youtube">youtube</option>
              </select>
              <button
                className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-[hsl(var(--primary-foreground))] font-semibold"
                onClick={createJob}
                disabled={!selectedWorkspaceId}
                title={!selectedWorkspaceId ? 'Select a workspace first' : undefined}
              >
                Add
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`rounded-xl border px-4 py-3 min-w-56 ${selectedWorkspaceId === workspace.id ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--card))]'}`}
              >
                {editingWorkspaceId === workspace.id ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg border bg-transparent px-3 py-2"
                      value={editingWorkspaceName}
                      onChange={(e) => setEditingWorkspaceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void updateWorkspace(workspace.id)
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        className="rounded-lg bg-[hsl(var(--primary))] px-3 py-2 text-[hsl(var(--primary-foreground))] text-sm font-semibold"
                        onClick={() => updateWorkspace(workspace.id)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded-lg border px-3 py-2 text-sm"
                        onClick={() => setEditingWorkspaceId('')}
                      >
                        Cancel
                      </button>
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
                      <button
                        className="text-xs text-[hsl(var(--primary))]"
                        onClick={() => {
                          setEditingWorkspaceId(workspace.id)
                          setEditingWorkspaceName(workspace.name)
                        }}
                      >
                        Edit
                      </button>
                      <button className="text-xs text-red-400" onClick={() => deleteWorkspace(workspace.id)}>
                        Delete
                      </button>
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
            <p className="text-[hsl(var(--muted-foreground))] text-sm mt-1">
              Hosted MVP with live workspaces/jobs via the API layer.
            </p>
          </div>
          <KanbanBoard jobs={visibleJobs} onSelectJob={setSelectedJob} />
        </section>
      </main>

      <JobDetailPanel
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onSaved={async () => {
          await refreshAll()
          setSelectedJob(null)
        }}
        onDeleted={async () => {
          await refreshAll()
          setSelectedJob(null)
        }}
      />
    </div>
  )
}
