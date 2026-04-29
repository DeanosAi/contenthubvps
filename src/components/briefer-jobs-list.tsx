"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Job } from '@/lib/types'

/**
 * Round 7.11 — briefer's "my briefs" list view.
 *
 * Shows all jobs in the briefer's workspace, newest first. Each
 * card shows:
 *   - Title
 *   - Briefer's name (the snapshot from the original submit)
 *   - Due date (if set)
 *   - A simple status indicator derived from the kanban stage
 *   - A short snippet of the description
 *
 * Clicking a card navigates to /briefer/jobs/[id] for full detail.
 *
 * Status mapping intentionally collapses the staff kanban into a
 * single user-meaningful label. The full kanban column (which
 * staff may have customised, renamed, added) is hidden — briefers
 * see "In production" not "Sarah's Wednesday slot."
 */

function statusLabel(stage: string): { label: string; tint: string } {
  // Built-in stages map cleanly. Custom stages (cust_*) fall through
  // to a generic "In progress" since we don't expose the staff's
  // kanban configuration to briefers.
  if (stage === 'brief') return { label: 'Brief received', tint: 'bg-slate-100 text-slate-700' }
  if (stage === 'production') return { label: 'In production', tint: 'bg-blue-50 text-blue-700' }
  if (stage === 'ready') return { label: 'Ready for review', tint: 'bg-amber-50 text-amber-700' }
  if (stage === 'posted') return { label: 'Posted', tint: 'bg-emerald-50 text-emerald-700' }
  if (stage === 'archive') return { label: 'Archived', tint: 'bg-slate-100 text-slate-500' }
  return { label: 'In progress', tint: 'bg-slate-100 text-slate-700' }
}

function approvalPill(status: string): { label: string; tint: string } | null {
  if (status === 'awaiting') return { label: 'Awaiting your approval', tint: 'bg-amber-100 text-amber-800' }
  if (status === 'changes_requested') return { label: 'Changes requested', tint: 'bg-rose-100 text-rose-800' }
  if (status === 'approved') return { label: 'Approved', tint: 'bg-emerald-100 text-emerald-800' }
  return null
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

export function BrieferJobsList() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/jobs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (Array.isArray(data)) setJobs(data)
        else setError('Failed to load briefs')
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load briefs')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <p className="text-sm text-slate-600">Loading your briefs…</p>
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    )
  }
  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center space-y-3">
        <h2 className="text-base font-semibold text-slate-900">No briefs yet</h2>
        <p className="text-sm text-slate-600">
          You haven&apos;t submitted any briefs yet. When you do, they&apos;ll appear here
          along with their progress and any messages from the team.
        </p>
        <Link
          href="/briefer/submit"
          className="inline-block rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm"
        >
          Submit your first brief
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">My briefs</h2>
        <Link
          href="/briefer/submit"
          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 text-sm"
        >
          Submit a new brief
        </Link>
      </div>
      <div className="space-y-3">
        {jobs.map((j) => {
          const status = statusLabel(j.stage)
          const approval = approvalPill(j.approvalStatus)
          const due = formatDate(j.dueDate)
          return (
            <Link
              key={j.id}
              href={`/briefer/jobs/${j.id}`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-400 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-colors"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-900 truncate">
                    {j.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {j.brieferDisplayName ? (
                      <>Briefed by <span className="text-slate-700">{j.brieferDisplayName}</span></>
                    ) : (
                      <>Submitted brief</>
                    )}
                    {due && <> · Due {due}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {approval && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${approval.tint}`}>
                      {approval.label}
                    </span>
                  )}
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${status.tint}`}>
                    {status.label}
                  </span>
                </div>
              </div>
              {j.description && (
                <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                  {j.description}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
