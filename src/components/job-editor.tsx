"use client"

import { useState } from 'react'
import type { Job, JobStage } from '@/lib/types'

const STAGES: JobStage[] = ['brief', 'production', 'ready', 'posted', 'archive']

export function JobEditor({ job, onSaved, onDeleted }: { job: Job; onSaved: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(job.title)
  const [description, setDescription] = useState(job.description || '')
  const [stage, setStage] = useState<JobStage>(job.stage)
  const [priority, setPriority] = useState(job.priority)
  const [hashtags, setHashtags] = useState(job.hashtags || '')
  const [editing, setEditing] = useState(false)

  async function save() {
    await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, stage, priority, hashtags }),
    })
    setEditing(false)
    onSaved()
  }

  async function remove() {
    await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    onDeleted()
  }

  if (!editing) {
    return (
      <div className="mt-3 flex gap-3 text-xs">
        <button className="text-cyan-300" onClick={() => setEditing(true)}>Edit</button>
        <button className="text-red-400" onClick={remove}>Delete</button>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <select className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={stage} onChange={(e) => setStage(e.target.value as JobStage)}>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <input type="number" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
        <input className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#tags" />
      </div>
      <div className="flex gap-2">
        <button className="rounded-lg bg-cyan-500 px-3 py-2 text-slate-950 text-sm font-semibold" onClick={save}>Save</button>
        <button className="rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  )
}
