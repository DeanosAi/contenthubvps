"use client"

import { useState } from 'react'
import type { JobEdit } from '@/lib/types'

/**
 * Round 7.11 — edit history button + modal.
 *
 * Used on the briefer detail page (and importable into the staff
 * detail panel). Shows the full timeline of changes recorded in
 * job_edits, newest first, with old → new diff for each.
 *
 * Lazy-loads the timeline only when the button is clicked, so we
 * don't hit /api/jobs/:id/edits on every detail-page mount for
 * jobs that have no edit history anyway.
 */

const FIELD_LABELS_LOCAL: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  due_date: 'Due date',
  hashtags: 'Hashtags',
  platform: 'Platform',
  content_type: 'Content type',
  campaign: 'Campaign',
  assigned_to: 'Assigned to',
  approval_status: 'Approval status',
  stage: 'Stage',
}

function fieldLabel(name: string): string {
  return FIELD_LABELS_LOCAL[name] ?? name
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  })
}

function truncate(s: string | null, max = 200): string {
  if (s == null) return '(empty)'
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

export function BrieferEditHistoryButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [edits, setEdits] = useState<JobEdit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function openModal() {
    setOpen(true)
    if (edits === null && !loading) {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/edits`)
        if (!res.ok) {
          setError('Failed to load edit history')
          return
        }
        const data: JobEdit[] = await res.json()
        setEdits(data)
      } catch {
        setError('Failed to load edit history')
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs text-slate-600 hover:text-indigo-700 underline"
      >
        View edit history
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-white border border-slate-200 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Edit history</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-slate-900 text-sm"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loading && (
                <p className="text-sm text-slate-600">Loading…</p>
              )}
              {error && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {!loading && !error && edits && edits.length === 0 && (
                <p className="text-sm text-slate-600 italic">
                  No edits recorded yet. The original brief is the latest version.
                </p>
              )}
              {!loading && !error && edits && edits.map((e) => (
                <div
                  key={e.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                    <span className="font-medium text-slate-900">
                      {fieldLabel(e.fieldName)}
                    </span>
                    <span className="text-slate-600">
                      {e.editedByName}
                      {e.editedByRole === 'briefer' && (
                        <span className="ml-1 text-amber-700">(briefer)</span>
                      )}
                      {' · '}
                      {formatTimestamp(e.editedAt)}
                    </span>
                  </div>
                  <div className="text-sm space-y-1">
                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-slate-500">
                        Was:
                      </span>{' '}
                      <span className="text-slate-700 whitespace-pre-wrap break-words">
                        {truncate(e.oldValue)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] uppercase tracking-wider text-slate-500">
                        Now:
                      </span>{' '}
                      <span className="text-slate-900 whitespace-pre-wrap break-words">
                        {truncate(e.newValue)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
