"use client"

import { useEffect, useState } from 'react'
import type { Job, JobStage, ApprovalStatus, AssetLink, CustomField } from '@/lib/types'
import { useUsers } from '@/lib/use-users'
import { AssetLinksEditor } from './asset-links-editor'
import { CustomFieldsEditor } from './custom-fields-editor'

const STAGES: JobStage[] = ['brief', 'production', 'ready', 'posted', 'archive']
const APPROVALS: { value: ApprovalStatus; label: string; tone: string }[] = [
  { value: 'none', label: 'No approval needed', tone: 'text-[hsl(var(--muted-foreground))]' },
  { value: 'awaiting', label: 'Awaiting approval', tone: 'text-amber-300' },
  { value: 'approved', label: 'Approved', tone: 'text-emerald-300' },
  { value: 'changes_requested', label: 'Changes requested', tone: 'text-red-300' },
]

/** Fields the user can edit through this panel. Sent verbatim as the
 * PATCH payload — the API tolerates unknown fields, but we whitelist
 * here for clarity. */
type Editable = Pick<
  Job,
  | 'title'
  | 'description'
  | 'stage'
  | 'priority'
  | 'dueDate'
  | 'hashtags'
  | 'platform'
  | 'liveUrl'
  | 'notes'
  | 'contentType'
  | 'briefUrl'
  | 'assetLinks'
  | 'customFields'
  | 'approvalStatus'
  | 'assignedTo'
  | 'facebookLiveUrl'
  | 'instagramLiveUrl'
>

function formatStamp(stamp: string | null): string {
  if (!stamp) return '—'
  const d = new Date(stamp)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function JobDetailPanel({
  job,
  onClose,
  onSaved,
  onDeleted,
}: {
  job: Job | null
  onClose: () => void
  onSaved: (updated: Job) => void
  onDeleted: () => void
}) {
  const { users } = useUsers()

  // Local form state — initialised from the incoming job, replaced
  // wholesale whenever the parent passes a different job.
  const [form, setForm] = useState<Job | null>(job)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // Metric fetch is a separate concern from save — its busy/error state
  // shouldn't block other edits, and an Apify failure shouldn't look
  // like a "couldn't save" failure.
  const [metricsBusy, setMetricsBusy] = useState(false)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  useEffect(() => {
    setForm(job)
    setError(null)
    setDirty(false)
  }, [job])

  if (!job || !form) return null

  function patch<K extends keyof Job>(k: K, v: Job[K]) {
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev))
    setDirty(true)
  }

  async function save() {
    if (!form) return
    setSaving(true)
    setError(null)
    const payload: Editable = {
      title: form.title,
      description: form.description,
      stage: form.stage,
      priority: form.priority,
      dueDate: form.dueDate,
      hashtags: form.hashtags,
      platform: form.platform,
      liveUrl: form.liveUrl,
      notes: form.notes,
      contentType: form.contentType,
      briefUrl: form.briefUrl,
      assetLinks: form.assetLinks,
      customFields: form.customFields,
      approvalStatus: form.approvalStatus,
      assignedTo: form.assignedTo,
      facebookLiveUrl: form.facebookLiveUrl,
      instagramLiveUrl: form.instagramLiveUrl,
    }
    let res: Response
    try {
      res = await fetch(`/api/jobs/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      setSaving(false)
      setError('Network error — please try again.')
      return
    }
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setError(data?.error || 'Failed to save')
      return
    }
    setDirty(false)
    onSaved((data.job as Job) ?? form)
  }

  /** Trigger a live metric fetch via Apify. Synchronous from the user's
   * perspective — request blocks until Apify finishes (~10-30s). On
   * success the parent's onSaved updates the job state, which through
   * the useEffect[job] above re-syncs `form` with the new live cache.
   *
   * If the user has unsaved edits in `form`, we DON'T want to clobber
   * those. We block the fetch in that case and ask them to save first. */
  async function fetchMetrics() {
    if (!form) return
    if (dirty) {
      setMetricsError('Save your changes before fetching metrics.')
      return
    }
    setMetricsBusy(true)
    setMetricsError(null)
    let res: Response
    try {
      res = await fetch(`/api/jobs/${form.id}/fetch-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    } catch {
      setMetricsBusy(false)
      setMetricsError('Network error — please try again.')
      return
    }
    const data = await res.json().catch(() => ({}))
    setMetricsBusy(false)
    if (!res.ok) {
      setMetricsError(data?.error || 'Failed to fetch metrics')
      return
    }
    onSaved((data.job as Job) ?? form)
  }

  async function remove() {
    if (!form) return
    if (!confirm('Delete this job? This cannot be undone.')) return
    setSaving(true)
    setError(null)
    let res: Response
    try {
      res = await fetch(`/api/jobs/${form.id}`, { method: 'DELETE' })
    } catch {
      setSaving(false)
      setError('Network error — please try again.')
      return
    }
    setSaving(false)
    if (!res.ok) {
      setError('Failed to delete')
      return
    }
    onDeleted()
  }

  function attemptClose() {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return
    onClose()
  }

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-[hsl(var(--card))] border-l border-[hsl(var(--border))] overflow-y-auto z-40 shadow-2xl flex flex-col">
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-[hsl(var(--border))] sticky top-0 bg-[hsl(var(--card))] z-10">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">Job detail</p>
          <h2 className="text-2xl font-bold mt-1 line-clamp-2">{job.title}</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
            Created {formatStamp(job.createdAt)} · Updated {formatStamp(job.updatedAt)}
          </p>
        </div>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={attemptClose}>
          Close
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex-1 px-6 py-5 space-y-6">
        {/* Section: core */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Overview</h3>

          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Title</label>
            <input
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.title}
              onChange={(e) => patch('title', e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Description</label>
            <textarea
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm min-h-24"
              value={form.description ?? ''}
              onChange={(e) => patch('description', e.target.value || null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Stage</label>
              <select
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.stage}
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
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Priority</label>
              <input
                type="number"
                min={0}
                max={5}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.priority}
                onChange={(e) => patch('priority', Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
              />
            </div>
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Platform</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.platform ?? ''}
                onChange={(e) => patch('platform', e.target.value || null)}
                placeholder="instagram, facebook, …"
              />
            </div>
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Content type</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.contentType ?? ''}
                onChange={(e) => patch('contentType', e.target.value || null)}
                placeholder="reel, carousel, story…"
              />
            </div>
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Due date</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.dueDate ? String(form.dueDate).slice(0, 10) : ''}
                onChange={(e) => patch('dueDate', e.target.value || null)}
              />
            </div>
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Assigned to</label>
              <select
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.assignedTo ?? ''}
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
          </div>

          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Hashtags</label>
            <input
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.hashtags ?? ''}
              onChange={(e) => patch('hashtags', e.target.value || null)}
              placeholder="#brand #campaign"
            />
          </div>
        </section>

        {/* Section: workflow / approvals */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Workflow</h3>
          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Approval status</label>
            <select
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.approvalStatus}
              onChange={(e) => patch('approvalStatus', e.target.value as ApprovalStatus)}
            >
              {APPROVALS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Section: brief + assets */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Brief & assets</h3>

          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Brief URL</label>
            <input
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.briefUrl ?? ''}
              onChange={(e) => patch('briefUrl', e.target.value || null)}
              placeholder="https://drive.google.com/… (the source brief doc)"
            />
            {form.briefUrl && (
              <a
                href={form.briefUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[hsl(var(--primary))] hover:underline mt-1 inline-block"
              >
                Open brief ↗
              </a>
            )}
          </div>

          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))] block mb-2">Asset links</label>
            <AssetLinksEditor
              links={form.assetLinks}
              onChange={(next: AssetLink[]) => patch('assetLinks', next)}
            />
          </div>
        </section>

        {/* Section: live URLs (used by metrics fetching in later rounds) */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Live posts</h3>

          <div>
            <label className="text-xs text-[hsl(var(--muted-foreground))]">Generic live URL</label>
            <input
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.liveUrl ?? ''}
              onChange={(e) => patch('liveUrl', e.target.value || null)}
              placeholder="https://…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Instagram URL</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.instagramLiveUrl ?? ''}
                onChange={(e) => patch('instagramLiveUrl', e.target.value || null)}
                placeholder="https://www.instagram.com/p/…"
              />
            </div>
            <div>
              <label className="text-xs text-[hsl(var(--muted-foreground))]">Facebook URL</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.facebookLiveUrl ?? ''}
                onChange={(e) => patch('facebookLiveUrl', e.target.value || null)}
                placeholder="https://www.facebook.com/reel/…"
              />
            </div>
          </div>
        </section>

        {/* Section: live metrics — only meaningful for posted jobs with a URL.
            Pulls from Apify on demand; requires the apify.token setting. */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Live metrics
            </h3>
            <button
              type="button"
              onClick={fetchMetrics}
              disabled={
                metricsBusy ||
                form.stage !== 'posted' ||
                !(form.facebookLiveUrl || form.instagramLiveUrl || form.liveUrl)
              }
              className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-3 py-1.5 text-xs disabled:opacity-50"
              title={
                form.stage !== 'posted'
                  ? 'Move the job to Posted to enable metric fetching'
                  : !(form.facebookLiveUrl || form.instagramLiveUrl || form.liveUrl)
                  ? 'Add a Facebook or Instagram URL above first'
                  : 'Fetch metrics from Apify'
              }
            >
              {metricsBusy ? 'Fetching…' : 'Fetch metrics'}
            </button>
          </div>

          {metricsError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {metricsError}
            </div>
          )}

          {form.liveMetrics ? (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MetricTile label="Views" value={form.liveMetrics.views} />
                <MetricTile label="Likes" value={form.liveMetrics.likes} />
                <MetricTile label="Comments" value={form.liveMetrics.comments} />
                <MetricTile label="Shares" value={form.liveMetrics.shares} />
              </div>
              {form.liveMetrics.engagementRate != null && (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2">
                  Engagement rate:{' '}
                  <span className="text-[hsl(var(--foreground))] font-medium">
                    {(form.liveMetrics.engagementRate * 100).toFixed(2)}%
                  </span>
                </p>
              )}
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1">
                Last fetched: {formatStamp(form.lastMetricsFetchAt)}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {form.stage === 'posted'
                ? 'No metrics fetched yet. Click "Fetch metrics" once a Facebook or Instagram URL is set.'
                : 'Metrics become available once the job is moved to Posted and a public URL is added.'}
            </p>
          )}
        </section>

        {/* Section: custom fields */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">Custom fields</h3>
          <CustomFieldsEditor
            fields={form.customFields}
            onChange={(next: CustomField[]) => patch('customFields', next)}
          />
        </section>

        {/* Section: notes */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">Notes</h3>
          <textarea
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm min-h-32"
            value={form.notes ?? ''}
            onChange={(e) => patch('notes', e.target.value || null)}
            placeholder="Production notes, internal context, anything else…"
          />
        </section>
      </div>

      <div className="px-6 py-4 border-t border-[hsl(var(--border))] sticky bottom-0 bg-[hsl(var(--card))] flex items-center justify-between gap-3">
        <button
          className="rounded-lg border px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
          onClick={remove}
          disabled={saving}
        >
          Delete job
        </button>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-[hsl(var(--muted-foreground))]">Unsaved changes</span>}
          <button
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={attemptClose}
            disabled={saving}
          >
            Close
          </button>
          <button
            className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-60"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Small tile used inside the Live metrics section. Null values render
 * "—" rather than 0 — "no data" and "zero engagement" are different
 * stories and shouldn't look the same. */
function MetricTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2">
      <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      <p className="text-base font-semibold mt-0.5">
        {value == null ? '—' : value.toLocaleString()}
      </p>
    </div>
  )
}
