"use client"

import { useEffect, useState } from 'react'
import type { Job, KanbanColumn, ApprovalStatus, AssetLink, CustomField } from '@/lib/types'
import { useUsers } from '@/lib/use-users'
import { AssetLinksEditor } from './asset-links-editor'
import { CustomFieldsEditor } from './custom-fields-editor'
import { CampaignField } from './campaign-field'
import { CommentsThread } from './comments-thread'
import { BrieferEditHistoryButton } from './briefer-edit-history-button'
import { JobTypePicker } from './job-type-picker'

const APPROVALS: { value: ApprovalStatus; label: string; tone: string }[] = [
  { value: 'none', label: 'No approval needed', tone: 'text-slate-600' },
  { value: 'awaiting', label: 'Awaiting approval', tone: 'text-amber-700' },
  { value: 'approved', label: 'Approved', tone: 'text-emerald-700' },
  { value: 'changes_requested', label: 'Changes requested', tone: 'text-red-700' },
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
  | 'contentTypes'
  | 'briefUrl'
  | 'assetLinks'
  | 'customFields'
  | 'campaign'
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
  columns,
  onClose,
  onSaved,
  onDeleted,
}: {
  job: Job | null
  /** Per-workspace columns. The stage dropdown lists these. The
   *  same prop is used to look up the user-facing column label
   *  for the "Move the job to {label} to enable metric fetching"
   *  helper text. Falls back to internal stage_keys if the active
   *  job's workspace columns aren't available. */
  columns: KanbanColumn[]
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
      contentTypes: form.contentTypes,
      briefUrl: form.briefUrl,
      assetLinks: form.assetLinks,
      customFields: form.customFields,
      campaign: form.campaign,
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
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white border-l border-slate-300 overflow-y-auto z-40 shadow-2xl flex flex-col">
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-300 sticky top-0 bg-white z-10">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-600">Job detail</p>
          <h2 className="text-2xl font-bold mt-1 line-clamp-2">{job.title}</h2>
          <p className="text-xs text-slate-600 mt-2">
            Created {formatStamp(job.createdAt)} · Updated {formatStamp(job.updatedAt)}
          </p>
        </div>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={attemptClose}>
          Close
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex-1 px-6 py-5 space-y-6">
        {/* Section: core */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Overview</h3>
            <BrieferEditHistoryButton jobId={form.id} />
          </div>

          {/* Round 7.11: briefer attribution. Shown only when this
              job was actually submitted by a briefer (the field is
              null for staff-created jobs). */}
          {form.brieferDisplayName && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              <span className="font-medium">Briefed by:</span>{' '}
              {form.brieferDisplayName}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-600">Title</label>
            <input
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.title}
              onChange={(e) => patch('title', e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-slate-600">Description</label>
            <textarea
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm min-h-24"
              value={form.description ?? ''}
              onChange={(e) => patch('description', e.target.value || null)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">Stage</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={form.stage}
                onChange={(e) => patch('stage', e.target.value)}
              >
                {/* Round 7.2b: dropdown is now driven by the workspace's
                    columns config. If the job is sitting in a stage that
                    no longer exists in columns (rare — only happens if
                    a teammate just deleted a custom column), still show
                    the current value as a fallback option so the form
                    isn't immediately invalid. */}
                {!columns.some((c) => c.stageKey === form.stage) && form.stage && (
                  <option value={form.stage}>{form.stage} (unknown)</option>
                )}
                {columns.map((c) => (
                  <option key={c.id} value={c.stageKey}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-600">Priority</label>
              <input
                type="number"
                min={0}
                max={5}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                value={form.priority}
                onChange={(e) => patch('priority', Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Platform</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.platform ?? ''}
                onChange={(e) => patch('platform', e.target.value || null)}
                placeholder="instagram, facebook, …"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Type of Job</label>
              <p className="text-[11px] text-slate-500 mb-1">
                What kind of job is this? Used to track how much of each type we do.
              </p>
              <JobTypePicker
                value={form.contentTypes ?? []}
                onChange={(types) => patch('contentTypes', types)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Due date</label>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.dueDate ? String(form.dueDate).slice(0, 10) : ''}
                onChange={(e) => patch('dueDate', e.target.value || null)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Assigned to</label>
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
            <label className="text-xs text-slate-600">Hashtags</label>
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
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Workflow</h3>
          <div>
            <label className="text-xs text-slate-600">Approval status</label>
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
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Brief & assets</h3>

          <div>
            <label className="text-xs text-slate-600">Brief URL</label>
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
                className="text-xs text-indigo-700 hover:underline mt-1 inline-block"
              >
                Open brief ↗
              </a>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-600">Campaign</label>
            <CampaignField
              value={form.campaign}
              workspaceId={form.workspaceId}
              onChange={(next) => patch('campaign', next)}
            />
            <p className="text-[11px] text-slate-600 mt-1">
              Group related posts under a shared campaign name. Used by the
              Campaign report (coming in Round 6.2) to compare performance.
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-600 block mb-2">Asset links</label>
            <AssetLinksEditor
              links={form.assetLinks}
              onChange={(next: AssetLink[]) => patch('assetLinks', next)}
            />
          </div>
        </section>

        {/* Section: live URLs (used by metrics fetching in later rounds) */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Live posts</h3>

          <div>
            <label className="text-xs text-slate-600">Generic live URL</label>
            <input
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={form.liveUrl ?? ''}
              onChange={(e) => patch('liveUrl', e.target.value || null)}
              placeholder="https://…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600">Instagram URL</label>
              <input
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={form.instagramLiveUrl ?? ''}
                onChange={(e) => patch('instagramLiveUrl', e.target.value || null)}
                placeholder="https://www.instagram.com/p/…"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Facebook URL</label>
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
            Pulls from Apify on demand; requires the apify.token setting.
            
            Round 7.2b: the literal `'posted'` stage_key is unchanged
            (it's the immutable internal key the metric-fetch logic
            depends on), but the user-facing label is whatever the
            workspace's `posted` column has been renamed to. */}
        {(() => {
          const postedColumn = columns.find((c) => c.stageKey === 'posted')
          const postedLabel = postedColumn?.label ?? 'Posted'
          return (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
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
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  title={
                    form.stage !== 'posted'
                      ? `Move the job to ${postedLabel} to enable metric fetching`
                      : !(form.facebookLiveUrl || form.instagramLiveUrl || form.liveUrl)
                      ? 'Add a Facebook or Instagram URL above first'
                      : 'Fetch metrics from Apify'
                  }
                >
                  {metricsBusy ? 'Fetching…' : 'Fetch metrics'}
                </button>
              </div>

              {metricsError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
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
                  {/* Engagement rate gets its own tile so it stays visible
                      and harder to drop in future edits. Renders even when
                      null (shows "—") so the slot is always there. */}
                  <div className="mt-2">
                    <EngagementRateTile rate={form.liveMetrics.engagementRate} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Last fetched: {formatStamp(form.lastMetricsFetchAt)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-600">
                  {form.stage === 'posted'
                    ? 'No metrics fetched yet. Click "Fetch metrics" once a Facebook or Instagram URL is set.'
                    : `Metrics become available once the job is moved to ${postedLabel} and a public URL is added.`}
                </p>
              )}
            </section>
          )
        })()}

        {/* Section: custom fields */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Custom fields</h3>
          <CustomFieldsEditor
            fields={form.customFields}
            onChange={(next: CustomField[]) => patch('customFields', next)}
          />
        </section>

        {/* Section: notes */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">Notes</h3>
          <textarea
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm min-h-32"
            value={form.notes ?? ''}
            onChange={(e) => patch('notes', e.target.value || null)}
            placeholder="Production notes, internal context, anything else…"
          />
        </section>

        {/* Section: comments thread (Round 7.10).
            Renders independently of the form-dirty state — comments
            POST/PATCH/DELETE go straight to the API and don't pile
            into the parent form's unsaved changes. So a user can
            post a comment and then later save (or discard) form
            edits separately. */}
        <CommentsThread jobId={form.id} />
      </div>

      <div className="px-6 py-4 border-t border-slate-300 sticky bottom-0 bg-white flex items-center justify-between gap-3">
        <button
          className="rounded-lg border px-4 py-2 text-sm text-red-700 border-red-300 hover:bg-red-50"
          onClick={remove}
          disabled={saving}
        >
          Delete job
        </button>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-slate-600">Unsaved changes</span>}
          <button
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={attemptClose}
            disabled={saving}
          >
            Close
          </button>
          <button
            className="rounded-lg bg-indigo-600 text-white font-semibold px-4 py-2 text-sm disabled:opacity-60"
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
    <div className="rounded-lg border border-slate-300 bg-white p-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-600">
        {label}
      </p>
      <p className="text-base font-semibold mt-0.5">
        {value == null ? '—' : value.toLocaleString()}
      </p>
    </div>
  )
}

/** Engagement rate tile — full-width row beneath the four metric tiles.
 * Stored on disk as a fraction (0.0234 = 2.34%); rendered as a percentage
 * to two decimals. Null renders "—" so the slot is always present. */
function EngagementRateTile({ rate }: { rate: number | null }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-indigo-600/5 p-2.5 flex items-center justify-between">
      <p className="text-[11px] uppercase tracking-wider text-slate-600">
        Engagement rate
      </p>
      <p className="text-base font-semibold text-slate-900">
        {rate == null ? '—' : (rate * 100).toFixed(2) + '%'}
      </p>
    </div>
  )
}
