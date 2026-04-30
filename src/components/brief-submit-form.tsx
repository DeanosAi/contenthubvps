"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { JobTypePicker } from './job-type-picker'

/**
 * Round 7.11 — briefer brief submission form.
 * Round 7.12 — Type of Job is now multi-select via JobTypePicker.
 *
 * Posts to /api/jobs/brief-submit, which forces:
 *   - workspace_id = the briefer's own workspace
 *   - stage = 'brief'
 *   - briefer_display_name = the session's displayName
 *
 * The user's session must have a displayName before they can submit.
 * The BrieferShell enforces this by gating all children behind the
 * "Who's using this account today?" prompt — by the time this form
 * renders, displayName is set.
 *
 * After successful submit, redirects to /briefer/jobs/[id] so the
 * briefer can immediately see their new brief and start adding
 * comments / details if needed.
 */

interface MeResponse {
  workspaceId: string | null
  displayName: string | null
  displayEmail: string | null
}

export function BriefSubmitForm() {
  const router = useRouter()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [campaign, setCampaign] = useState('')
  const [platform, setPlatform] = useState('')
  // Round 7.12: contentTypes is now a multi-select array.
  const [contentTypes, setContentTypes] = useState<string[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setMe(m))
      .finally(() => setLoadingMe(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!title.trim()) {
      setError('Please give the brief a title.')
      return
    }
    if (!me?.workspaceId) {
      setError('Your account is not bound to a workspace. Contact an admin.')
      return
    }
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/jobs/brief-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: me.workspaceId,
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate
            ? new Date(dueDate + 'T00:00:00').toISOString()
            : null,
          platform: platform.trim() || null,
          contentTypes,
          campaign: campaign.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || 'Submit failed')
        return
      }
      const data = await res.json()
      const newJobId = data?.job?.id
      if (newJobId) {
        router.push(`/briefer/jobs/${newJobId}`)
      } else {
        router.push('/briefer')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingMe) {
    return <p className="text-sm text-slate-600">Loading…</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/briefer" className="text-sm text-indigo-700 hover:underline">
          ← Back to my briefs
        </Link>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Submit a new brief</h2>
          <p className="text-sm text-slate-600 mt-1">
            Give the team enough detail to get started. You can keep editing
            this brief or add comments after you submit.
            {me?.displayName && (
              <>
                {' '}
                <span className="text-slate-700">
                  This brief will be credited to <span className="font-medium">{me.displayName}</span>.
                </span>
              </>
            )}
          </p>
        </div>

        <Field label="Title" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            required
            placeholder="Short title for this brief"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder="What do you need? Tone, audience, key messages, constraints, anything else the team should know."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-y"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
          <Field label="Platform">
            <input
              type="text"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="e.g. Instagram, Facebook, TikTok"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
          <Field label="Type of Job">
            <p className="text-[11px] text-slate-500 -mt-1 mb-1">
              What kind of job is this? Pick one or more.
            </p>
            <JobTypePicker
              value={contentTypes}
              onChange={setContentTypes}
            />
          </Field>
          <Field label="Campaign">
            {/* Round 7.17: matching helper line so the input box on
                this side lines up vertically with the Type of Job
                picker on the other side of the two-column grid.
                Without it, this row's input sits higher than the
                picker — visually unaligned. */}
            <p className="text-[11px] text-slate-500 -mt-1 mb-1">
              Part of a bigger marketing push? (Optional)
            </p>
            <input
              type="text"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="e.g. Spring Launch, Member Drive"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </Field>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/briefer"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit brief'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
