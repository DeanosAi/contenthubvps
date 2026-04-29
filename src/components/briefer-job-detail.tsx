"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Job, AssetLink } from '@/lib/types'
import { CommentsThread } from './comments-thread'
import { BrieferEditHistoryButton } from './briefer-edit-history-button'

/**
 * Round 7.11 — briefer's view of one of their jobs.
 *
 * Fields the briefer CAN edit:
 *   - Title, description, due date, hashtags, platform, content type, campaign
 *   (matches BRIEFER_EDITABLE_FIELDS in lib/permissions.ts)
 *
 * Fields the briefer can SEE but not edit:
 *   - Asset links (deliverables produced by the staff team)
 *   - Live URLs (final posted links)
 *   - Status (a friendly label derived from stage)
 *   - Approval status (so they know if their input is wanted)
 *
 * Fields the briefer NEVER sees:
 *   - notes (staff-internal)
 *   - custom fields (staff-internal tracking)
 *   - assigned_to (which staff member is on it)
 *   - priority (staff workflow)
 *   - kanban stage as the raw column name (we map to a friendly label)
 *
 * Editing flow:
 *   1. Briefer changes a field
 *   2. We track the dirty state per-field
 *   3. Save button PATCHes the changed fields
 *   4. Server logs each change to job_edits with the briefer's
 *      session display name attribution
 *   5. UI surfaces an inline "edited by {name} on {when}" note
 *      via the BrieferEditHistoryButton
 */

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  due_date: 'Due date',
  hashtags: 'Hashtags',
  platform: 'Platform',
  content_type: 'Content type',
  campaign: 'Campaign',
}

function statusLabel(stage: string): string {
  if (stage === 'brief') return 'Brief received — your team will pick it up shortly'
  if (stage === 'production') return 'In production'
  if (stage === 'ready') return 'Ready for review'
  if (stage === 'posted') return 'Posted'
  if (stage === 'archive') return 'Archived'
  return 'In progress'
}

function approvalLabel(status: string): { label: string; help: string; tint: string } | null {
  if (status === 'awaiting') {
    return {
      label: 'Awaiting your approval',
      help: 'The team has produced this and would like you to confirm before posting. Use the comments below to approve, or request changes.',
      tint: 'bg-amber-50 border-amber-200 text-amber-900',
    }
  }
  if (status === 'changes_requested') {
    return {
      label: 'Changes requested',
      help: 'You\'ve asked for revisions. The team is working on them.',
      tint: 'bg-rose-50 border-rose-200 text-rose-900',
    }
  }
  if (status === 'approved') {
    return {
      label: 'Approved by you',
      help: 'You\'ve approved this. The team is now scheduling/posting.',
      tint: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    }
  }
  return null
}

function formatDateForInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // YYYY-MM-DD for date input
  return d.toISOString().slice(0, 10)
}

export function BrieferJobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Local form state for editable fields
  const [form, setForm] = useState<{
    title: string
    description: string
    dueDate: string
    hashtags: string
    platform: string
    contentType: string
    campaign: string
  }>({
    title: '',
    description: '',
    dueDate: '',
    hashtags: '',
    platform: '',
    contentType: '',
    campaign: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  function applyJobToForm(j: Job) {
    setForm({
      title: j.title,
      description: j.description ?? '',
      dueDate: formatDateForInput(j.dueDate),
      hashtags: j.hashtags ?? '',
      platform: j.platform ?? '',
      contentType: j.contentType ?? '',
      campaign: j.campaign ?? '',
    })
  }

  async function loadJob() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('Brief not found, or you don\'t have access to it.')
        } else {
          setError('Failed to load brief')
        }
        return
      }
      const j: Job = await res.json()
      setJob(j)
      applyJobToForm(j)
    } catch {
      setError('Failed to load brief')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  // Compute dirty state per field
  const dirty = useMemo(() => {
    if (!job) return false
    return (
      form.title !== job.title ||
      form.description !== (job.description ?? '') ||
      form.dueDate !== formatDateForInput(job.dueDate) ||
      form.hashtags !== (job.hashtags ?? '') ||
      form.platform !== (job.platform ?? '') ||
      form.contentType !== (job.contentType ?? '') ||
      form.campaign !== (job.campaign ?? '')
    )
  }, [form, job])

  async function save() {
    if (!job || !dirty || saving) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const payload: Record<string, unknown> = {}
      if (form.title !== job.title) payload.title = form.title.trim()
      if (form.description !== (job.description ?? '')) payload.description = form.description.trim() || null
      if (form.dueDate !== formatDateForInput(job.dueDate)) {
        payload.dueDate = form.dueDate
          ? new Date(form.dueDate + 'T00:00:00').toISOString()
          : null
      }
      if (form.hashtags !== (job.hashtags ?? '')) payload.hashtags = form.hashtags.trim() || null
      if (form.platform !== (job.platform ?? '')) payload.platform = form.platform.trim() || null
      if (form.contentType !== (job.contentType ?? '')) payload.contentType = form.contentType.trim() || null
      if (form.campaign !== (job.campaign ?? '')) payload.campaign = form.campaign.trim() || null

      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveError(j?.error || 'Save failed')
        return
      }
      const data = await res.json()
      const updated: Job = data?.job ?? data
      setJob(updated)
      applyJobToForm(updated)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Loading…</p>
  if (error || !job) {
    return (
      <div className="space-y-3">
        <Link href="/briefer" className="text-sm text-indigo-700 hover:underline">
          ← Back to my briefs
        </Link>
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error ?? 'Brief not found'}
        </div>
      </div>
    )
  }

  const status = statusLabel(job.stage)
  const approval = approvalLabel(job.approvalStatus)
  const liveLinks: Array<{ label: string; url: string }> = []
  if (job.facebookLiveUrl) liveLinks.push({ label: 'Facebook', url: job.facebookLiveUrl })
  if (job.instagramLiveUrl) liveLinks.push({ label: 'Instagram', url: job.instagramLiveUrl })
  if (job.liveUrl && !job.facebookLiveUrl && !job.instagramLiveUrl) {
    liveLinks.push({ label: 'Live URL', url: job.liveUrl })
  }
  const visibleAssets: AssetLink[] = job.assetLinks ?? []

  return (
    <div className="space-y-6">
      <div>
        <Link href="/briefer" className="text-sm text-indigo-700 hover:underline">
          ← Back to my briefs
        </Link>
      </div>

      {/* Status banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] uppercase tracking-wider text-slate-500">Status</p>
        <p className="text-base font-medium text-slate-900 mt-1">{status}</p>
        {approval && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${approval.tint}`}>
            <p className="font-semibold">{approval.label}</p>
            <p className="mt-0.5">{approval.help}</p>
          </div>
        )}
      </div>

      {/* Editable brief fields */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Your brief</h2>
          <BrieferEditHistoryButton jobId={jobId} />
        </div>
        <p className="text-xs text-slate-500">
          You can edit any of these fields below. The team will see your changes
          along with a record of what was changed and when.
        </p>

        <Field label="Title">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={5}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-y"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Due date">
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
          <Field label="Platform">
            <input
              type="text"
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
              placeholder="e.g. Instagram, Facebook"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
          <Field label="Content type">
            <input
              type="text"
              value={form.contentType}
              onChange={(e) => setForm({ ...form, contentType: e.target.value })}
              placeholder="e.g. Reel, post, story"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
          <Field label="Campaign">
            <input
              type="text"
              value={form.campaign}
              onChange={(e) => setForm({ ...form, campaign: e.target.value })}
              placeholder="e.g. Spring Launch"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
        </div>

        <Field label="Hashtags">
          <input
            type="text"
            value={form.hashtags}
            onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
            placeholder="#yourtag #another"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          {saveError && <span className="text-sm text-red-700">{saveError}</span>}
          {saveSuccess && <span className="text-sm text-emerald-700">Saved</span>}
          {dirty && !saveSuccess && (
            <button
              type="button"
              onClick={() => job && applyJobToForm(job)}
              className="text-sm text-slate-600 hover:text-slate-900"
              disabled={saving}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>

      {/* Deliverables (read-only) */}
      {(visibleAssets.length > 0 || liveLinks.length > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Deliverables</h2>
          <p className="text-xs text-slate-500">
            Files and live links produced by the team for this brief.
          </p>
          {liveLinks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Live</p>
              {liveLinks.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block text-sm text-indigo-700 hover:text-indigo-900 underline truncate"
                >
                  {l.label}: {l.url}
                </a>
              ))}
            </div>
          )}
          {visibleAssets.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Files</p>
              {visibleAssets.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block text-sm text-indigo-700 hover:text-indigo-900 underline truncate"
                >
                  {a.label || a.url}
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Comments thread (already exists from Round 7.10) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <CommentsThread jobId={jobId} />
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

// Re-export FIELD_LABELS so the edit history button can render
// the same labels.
export { FIELD_LABELS }
