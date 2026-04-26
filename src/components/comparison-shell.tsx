"use client"

import { useEffect, useMemo, useState } from 'react'
import type { Job, Workspace } from '@/lib/types'
import {
  buildComparison,
  generateComparisonInsights,
  type ComparisonReport,
  type ComparisonInsight,
} from '@/lib/comparison'
import { ComparisonModeToggle, type ComparisonMode } from './comparison-mode-toggle'
import { ComparisonPostPicker } from './comparison-post-picker'
import { ComparisonCampaignPicker } from './comparison-campaign-picker'
import { ComparisonTable } from './comparison-table'
import { ComparisonRankingChart } from './comparison-ranking-chart'
import { ComparisonInsights } from './comparison-insights'

/**
 * Top-level orchestrator for the campaign-report view.
 *
 * Receives data from the parent ReportsShell — we don't refetch jobs
 * here, just fetch the comparison subset on submit. State lives at this
 * level because both modes share the "report below" output.
 *
 * Flow per mode:
 *
 *   manual:
 *     user multi-selects → parent's job array filtered to selected ids
 *     → buildComparison() runs locally → table + chart + insights render.
 *     For PDF, the same in-memory data drives the PDF document. No
 *     server roundtrip needed because we already have the jobs.
 *
 *   campaign:
 *     user picks a campaign + scope → POST /api/reports/comparison
 *     returns the matching jobs → buildComparison() runs locally on
 *     the response. Server roundtrip is required because the comparison
 *     may include posts not present in the parent's loaded jobs (e.g.
 *     archived posts that aren't in the kanban view's typical fetch).
 *
 * The PDF download lazy-loads @react-pdf/renderer + the comparison-PDF
 * component so the initial /reports page load doesn't pay that bundle
 * cost.
 */

const MIN_POSTS = 2

interface ComparisonShellProps {
  /** All jobs loaded by the parent for the current scope. Used by the
   * manual picker to populate its list. */
  jobs: Job[]
  /** Current workspace, drives campaign picker + PDF cover. */
  workspace: Workspace | null
  workspaceId: string
  fromIso: string
  toIso: string
}

export function ComparisonShell({
  jobs,
  workspace,
  workspaceId,
  fromIso,
  toIso,
}: ComparisonShellProps) {
  const [mode, setMode] = useState<ComparisonMode>('manual')

  // Manual mode state
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Campaign mode state
  const [campaign, setCampaign] = useState<string>('')
  const [fullCampaign, setFullCampaign] = useState<boolean>(false)
  const [campaignJobs, setCampaignJobs] = useState<Job[]>([])
  const [campaignLoading, setCampaignLoading] = useState(false)
  const [campaignResultCount, setCampaignResultCount] = useState<number | null>(null)
  const [campaignError, setCampaignError] = useState<string | null>(null)

  const [pdfBusy, setPdfBusy] = useState(false)

  // Reset selection when workspace changes — selecting jobs from one
  // workspace and switching to another would compare jobs from the wrong
  // workspace, which is confusing.
  useEffect(() => {
    setSelectedIds([])
    setCampaign('')
    setCampaignJobs([])
    setCampaignResultCount(null)
    setCampaignError(null)
  }, [workspaceId])

  // ---- jobs feeding the active comparison ----
  const comparisonJobs: Job[] = useMemo(() => {
    if (mode === 'manual') {
      const selectedSet = new Set(selectedIds)
      return jobs.filter((j) => selectedSet.has(j.id))
    }
    return campaignJobs
  }, [mode, selectedIds, jobs, campaignJobs])

  // ---- comparison data + insights ----
  const report: ComparisonReport | null = useMemo(() => {
    if (comparisonJobs.length === 0) return null
    return buildComparison(comparisonJobs)
  }, [comparisonJobs])

  const insights: ComparisonInsight[] = useMemo(() => {
    return report ? generateComparisonInsights(report) : []
  }, [report])

  // ---- campaign-mode auto-fetch ----
  // Refetch when the campaign, fullCampaign toggle, or date range changes.
  // No "Generate" button — the report updates as inputs change, like the
  // standard report. Debounce isn't needed because the inputs are
  // discrete (dropdown + checkbox + date pickers).
  useEffect(() => {
    if (mode !== 'campaign') return
    if (!workspaceId || !campaign) {
      setCampaignJobs([])
      setCampaignResultCount(null)
      setCampaignError(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setCampaignLoading(true)
      setCampaignError(null)
      try {
        const res = await fetch('/api/reports/comparison', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'campaign',
            workspaceId,
            campaign,
            fromIso: fullCampaign ? undefined : fromIso || undefined,
            toIso: fullCampaign ? undefined : toIso || undefined,
            fullCampaign,
          }),
        })
        if (cancelled) return
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setCampaignError((j as { error?: string }).error || 'Failed to load campaign')
          setCampaignJobs([])
          setCampaignResultCount(0)
          return
        }
        const data = (await res.json()) as { jobs: Job[] }
        if (cancelled) return
        setCampaignJobs(data.jobs ?? [])
        setCampaignResultCount(data.jobs?.length ?? 0)
      } catch {
        if (!cancelled) {
          setCampaignError('Network error loading campaign')
          setCampaignJobs([])
          setCampaignResultCount(0)
        }
      } finally {
        if (!cancelled) setCampaignLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mode, workspaceId, campaign, fullCampaign, fromIso, toIso])

  // ---- scope label (for both UI header and PDF) ----
  const scopeLabel = useMemo(() => {
    if (mode === 'manual') {
      return `${selectedIds.length} ${selectedIds.length === 1 ? 'manually-selected post' : 'manually-selected posts'}`
    }
    if (!campaign) return 'No campaign selected'
    return fullCampaign
      ? `Campaign: ${campaign} (full campaign)`
      : `Campaign: ${campaign}`
  }, [mode, selectedIds, campaign, fullCampaign])

  const periodLabel = useMemo(() => {
    if (mode === 'manual') return null
    if (fullCampaign) return null
    if (!fromIso && !toIso) return null
    return `${fromIso || '—'} → ${toIso || '—'}`
  }, [mode, fullCampaign, fromIso, toIso])

  // ---- PDF download ----
  async function downloadPdf() {
    if (!report) return
    setPdfBusy(true)
    try {
      const [{ pdf }, { ComparisonPdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/report-comparison-pdf'),
      ])
      const generatedAt = new Date()
      const doc = (
        <ComparisonPdf
          appName="Content Hub"
          companyName=""
          workspace={workspace}
          generatedAt={generatedAt}
          scopeLabel={scopeLabel}
          periodLabel={periodLabel}
          report={report}
          insights={insights}
        />
      ) as unknown as Parameters<typeof pdf>[0]
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const wsSafe = (workspace?.name || 'all-workspaces')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      a.href = url
      a.download = `comparison-${wsSafe}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Comparison PDF generation failed:', err)
    } finally {
      setPdfBusy(false)
    }
  }

  const enoughPosts = report != null && report.posts.length >= MIN_POSTS
  const tooFewPosts =
    (mode === 'manual' && selectedIds.length > 0 && selectedIds.length < MIN_POSTS) ||
    (mode === 'campaign' &&
      campaignResultCount != null &&
      campaignResultCount > 0 &&
      campaignResultCount < MIN_POSTS)

  return (
    <div className="space-y-4">
      {/* Sub-toggle + PDF action */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ComparisonModeToggle mode={mode} onChange={setMode} />
        <button
          type="button"
          onClick={downloadPdf}
          disabled={pdfBusy || !enoughPosts}
          className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-50"
          title={
            enoughPosts
              ? 'Download a PDF of this comparison'
              : `Need at least ${MIN_POSTS} posts to generate a comparison PDF`
          }
        >
          {pdfBusy ? 'Generating PDF…' : 'Download PDF'}
        </button>
      </div>

      {/* Workspace gate */}
      {!workspaceId ? (
        <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Pick a workspace in the filter bar above to start comparing posts.
        </div>
      ) : mode === 'manual' ? (
        <ComparisonPostPicker
          jobs={jobs}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
      ) : (
        <>
          <ComparisonCampaignPicker
            workspaceId={workspaceId}
            campaign={campaign}
            fullCampaign={fullCampaign}
            fromIso={fromIso}
            toIso={toIso}
            onChange={({ campaign: c, fullCampaign: full }) => {
              setCampaign(c)
              setFullCampaign(full)
            }}
            loading={campaignLoading}
            resultCount={campaignResultCount}
          />
          {campaignError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {campaignError}
            </div>
          )}
        </>
      )}

      {/* Comparison output */}
      {tooFewPosts && (
        <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Pick at least {MIN_POSTS} posts to compare. A comparison of one post
          against itself isn&apos;t meaningful.
        </div>
      )}

      {enoughPosts && report && (
        <>
          <ComparisonRankingChart posts={report.posts} />

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Side-by-side
            </h3>
            <ComparisonTable posts={report.posts} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Observations
              {insights.length > 0 && (
                <span className="ml-1 text-[hsl(var(--muted-foreground))] font-normal normal-case tracking-normal">
                  ({insights.length} triggered)
                </span>
              )}
            </h3>
            <ComparisonInsights insights={insights} />
          </section>
        </>
      )}
    </div>
  )
}
