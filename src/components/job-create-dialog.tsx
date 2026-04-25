"use client"

import { useEffect, useState } from 'react'
import type { Job, JobStage, Workspace, AssetLink, ApprovalStatus } from '@/lib/types'
import { useUsers } from '@/lib/use-users'
import { AssetLinksEditor } from './asset-links-editor'

const STAGES: JobStage[] = ['brief', 'production', 'ready', 'posted', 'archive']
const PLATFORMS = ['', 'instagram', 'facebook', 'tiktok', 'youtube']
const APPROVALS: { value: ApprovalStatus; label: string }[] = [
  { value: 'none', label: 'No approval needed' },
  { value: 'awaiting', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'changes_requested', label: 'Changes requested' },
]

interface CreatePayload {
  workspaceId: string
  title: string
  description: string | null
  stage: JobStage
  priority: number
  dueDate: string | null
  hashtags: string | null
  platform: string | null
  liveUrl: string | null
  notes: string | null
  contentType: string | null
  briefUrl: string | null
  assetLinks: AssetLink[]
  approvalStatus: ApprovalStatus
  assignedTo: string | null
}

const EMPTY_DRAFT: Omit<CreatePayload, 'workspaceId'> = {
  title: '',
  description: null,
  stage: 'brief',
  priority: 0,
  dueDate: null,
  hashtags: null,
  platform: 'instagram',
  liveUrl: null,
  notes: null,
  contentType: null,
  briefUrl: null,
  assetLinks: [],
  approvalStatus: 'none',
  assignedTo: null,
}

export function JobCreateDialog({
  open,
  onClose,
  workspaces,
  defaultWorkspaceId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  workspaces: Workspace[]
  defaultWorkspaceId: string
  onCreated: (job: Job) => void
}) {
  const { users } = useUsers()
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT, workspaceId: defaultWorkspaceId })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form whenever the dialog re-opens.
  useEffect(() => {
    if (open) {
      setDraft({ ...EMPTY_DRAFT, workspaceId: defaultWorkspaceId })
      setError(null)
    }
  }, [open, defaultWorkspaceId])

  // Close on Escape — small UX touch but expected from a modal.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function patch<K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  async function submit() {
    if (!draft.title.trim()) {
      setError('Title is required')
      return
    }
    if (!draft.workspaceId) {
      setError('Choose a workspace')
      return
    }

    setSubmitting(true)
    setError(null)

    const payload: CreatePayload = {
      ...draft,
      title: draft.title.trim(),
      description: draft.description?.trim() || null,
      hashtags: draft.hashtags?.trim() || null,
      liveUrl: draft.liveUrl?.trim() || null,
      notes: draft.notes?.trim() || null,
      contentType: draft.contentType?.trim() || null,
      briefUrl: draft.briefUrl?.trim() || null,
      platform: draft.platform || null,
    }

    let res: Response
    try {
      res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      setSubmitting(false)
      setError('Network error — please try again.')
      return
    }
    const data = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) {
      setError(data?.error || 'Failed to create job')
      return
    }
    onCreated(data.job as Job)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div
        className="my-8 w-full max-w-2xl rounded-2xl border bg-[hsl(var(--card))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Create</p>
            <h2 className="text-xl font-bold mt-1">New job</h2>
          </div>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm">
            Close
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Title</label>
              <input
                autoFocus
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.title}
                onChange={(e) => patch('title', e.target.value)}
                placeholder="e.g. ANZAC Day recap reel"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
                }}
              />
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Workspace</label>
              <select
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.workspaceId}
                onChange={(e) => patch('workspaceId', e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Stage</label>
              <select
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.stage}
                onChange={(e) => patch('stage', e.target.value as JobStage)}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Platform</label>
              <select
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.platform || ''}
                onChange={(e) => patch('platform', e.target.value)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p || '—'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Content type</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.contentType ?? ''}
                onChange={(e) => patch('contentType', e.target.value || null)}
                placeholder="reel, carousel, story…"
              />
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Priority</label>
              <input
                type="number"
                min={0}
                max={5}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.priority}
                onChange={(e) => patch('priority', Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
              />
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Due date</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.dueDate ?? ''}
                onChange={(e) => patch('dueDate', e.target.value || null)}
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Assigned to</label>
              <select
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.assignedTo ?? ''}
                onChange={(e) => patch('assignedTo', e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Description</label>
              <textarea
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm min-h-20"
                value={draft.description ?? ''}
                onChange={(e) => patch('description', e.target.value || null)}
                placeholder="One-line summary of what's needed."
              />
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Hashtags</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.hashtags ?? ''}
                onChange={(e) => patch('hashtags', e.target.value || null)}
                placeholder="#brand #campaign"
              />
            </div>

            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Brief URL</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={draft.briefUrl ?? ''}
                onChange={(e) => patch('briefUrl', e.target.value || null)}
                placeholder="https://drive.google.com/…"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[hsl(var(--border))]">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm" disabled={submitting}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create job'}
          </button>
        </div>
      </div>
    </div>
  )
}
