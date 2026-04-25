"use client"

import { useEffect, useState } from 'react'
import type { Job, JobStage } from '@/lib/types'

const STAGES: JobStage[] = ['brief', 'production', 'ready', 'posted', 'archive']

export function JobDetailPanel({ job, onClose, onSaved, onDeleted }: { job: Job | null; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const [form, setForm] = useState<Job | null>(job)

  useEffect(() => {
    setForm(job)
  }, [job])

  if (!job || !form) return null

  async function save() {
    if (!form) return
    await fetch(`/api/jobs/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    onSaved()
  }

  async function remove() {
    if (!form) return
    await fetch(`/api/jobs/${form.id}`, { method: 'DELETE' })
    onDeleted()
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] p-6 overflow-y-auto z-50 shadow-2xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Job Detail</p>
          <h2 className="text-2xl font-bold mt-2">{job.title}</h2>
        </div>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={onClose}>Close</button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Title</label>
          <input className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>

        <div>
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Description</label>
          <textarea className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2 min-h-28" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">Stage</label>
            <select className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as JobStage })}>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">Priority</label>
            <input type="number" className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">Platform</label>
            <input className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.platform || ''} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
          </div>
          <div>
            <label className="text-sm text-[hsl(var(--muted-foreground))]">Due Date</label>
            <input type="date" className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.dueDate ? String(form.dueDate).slice(0, 10) : ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value || null })} />
          </div>
        </div>

        <div>
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Hashtags</label>
          <input className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.hashtags || ''} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} />
        </div>

        <div>
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Live URL</label>
          <input className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2" value={form.liveUrl || ''} onChange={(e) => setForm({ ...form, liveUrl: e.target.value })} />
        </div>

        <div>
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Notes</label>
          <textarea className="mt-2 w-full rounded-lg border bg-transparent px-3 py-2 min-h-36" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <div className="flex gap-3 pt-4">
          <button className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 font-semibold text-[hsl(var(--primary-foreground))]" onClick={save}>Save Changes</button>
          <button className="rounded-lg border px-4 py-2 text-red-400" onClick={remove}>Delete Job</button>
        </div>
      </div>
    </div>
  )
}
