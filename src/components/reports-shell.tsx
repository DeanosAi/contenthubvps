"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { ReportsHeadline } from '@/components/reports-headline'
import { ReportsCharts } from '@/components/reports-charts'
import { ReportsPlatformTable } from '@/components/reports-platform-table'
import { ReportsTopPosts } from '@/components/reports-top-posts'
import { ReportsDeepDiveSummary } from '@/components/reports-deep-dive-summary'
import { ReportsDeepDiveMonthlyChart } from '@/components/reports-deep-dive-monthly'
import { ReportsDeepDivePlatformTable } from '@/components/reports-deep-dive-platforms'
import { ReportsDeepDiveRecommendations } from '@/components/reports-deep-dive-recommendations'
import { ComparisonShell } from '@/components/comparison-shell'
import type { Job, MetricSnapshot, Workspace } from '@/lib/types'
import { buildDeepDive } from '@/lib/quarterly'
import { generateRecommendations } from '@/lib/recommendations'
import {
  buildDailyTimeSeries,
  computeHeadlineNumbers,
  computePlatformBreakdown,
  defaultRange,
  jobsInScope,
  snapshotsInScope,
  topPostsPerPlatform,
  type ReportScope,
} from '@/lib/reports'

/** PDF generation is a meaningfully heavy bundle (@react-pdf/renderer
 * pulls in pdfkit, font loaders, etc). Lazy-loading it via dynamic import
 * keeps the initial /reports page load fast — the bundle is only fetched
 * when the user actually clicks Download. The component below uses a
 * useState toggle so React can re-render once the lazy module is ready. */

interface ReportsApiResponse {
  workspace: Workspace | null
  jobs: Job[]
  snapshots: MetricSnapshot[]
  range: { from: string | null; to: string | null }
}

export function ReportsShell() {
  // ---------- workspaces (sidebar) ----------
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')

  // ---------- report filter state ----------
  const initialRange = defaultRange()
  const [reportWorkspaceId, setReportWorkspaceId] = useState<string>('')
  const [fromIso, setFromIso] = useState<string>(initialRange.fromIso)
  const [toIso, setToIso] = useState<string>(initialRange.toIso)
  /** Standard = the 4.2 layout (single window, simple numbers).
   *  Deep dive = the 4.3 layout (current vs prior, monthly trends,
   *  recommendations engine output). Campaign = the 6.2 layout
   *  (manual or campaign-filtered comparison of selected posts).
   *  All three modes use the same /api/reports data for the parent
   *  context (workspace + date range); only the body of the page changes. */
  const [reportType, setReportType] = useState<
    'standard' | 'deepDive' | 'campaign'
  >('standard')

  // ---------- report data ----------
  const [data, setData] = useState<ReportsApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // ---------- pdf state ----------
  const [pdfBusy, setPdfBusy] = useState(false)

  // ---- workspaces (sidebar) ----
  async function loadWorkspaces(): Promise<Workspace[]> {
    const res = await fetch('/api/workspaces')
    if (!res.ok) {
      setErrorMessage('Failed to load workspaces')
      return []
    }
    const data: Workspace[] = await res.json()
    setWorkspaces(data)
    return data
  }

  async function loadReport(scope: ReportScope) {
    setLoading(true)
    setErrorMessage(null)
    const params = new URLSearchParams()
    if (scope.workspaceId) params.set('workspaceId', scope.workspaceId)
    if (scope.fromIso) params.set('from', scope.fromIso)
    if (scope.toIso) params.set('to', scope.toIso)
    let res: Response
    try {
      res = await fetch(`/api/reports?${params.toString()}`)
    } catch {
      setLoading(false)
      setErrorMessage('Network error loading report')
      return
    }
    if (!res.ok) {
      setLoading(false)
      const j = await res.json().catch(() => ({}))
      setErrorMessage(j?.error || 'Failed to load report')
      return
    }
    const body: ReportsApiResponse = await res.json()
    setData(body)
    setLoading(false)
  }

  // First load.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ws = await loadWorkspaces()
      if (cancelled) return
      // Default reports to the first workspace if there is one, else
      // "all workspaces" for an agency-wide overview. Keep the sidebar
      // selection in sync so the highlight matches.
      const first = ws[0]?.id ?? ''
      setSelectedWorkspaceId(first)
      setReportWorkspaceId(first)
      await loadReport({
        workspaceId: first || null,
        fromIso: initialRange.fromIso,
        toIso: initialRange.toIso,
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload whenever the report filter changes.
  useEffect(() => {
    void loadReport({
      workspaceId: reportWorkspaceId || null,
      fromIso,
      toIso,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportWorkspaceId, fromIso, toIso])

  // ---------- workspace mutations (passed to sidebar) ----------
  async function createWorkspace(name: string) {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: '#8b5cf6' }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to create workspace')
      return
    }
    await loadWorkspaces()
  }

  async function renameWorkspace(id: string, name: string) {
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      setErrorMessage('Failed to rename workspace')
      return
    }
    await loadWorkspaces()
  }

  async function deleteWorkspace(id: string) {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setErrorMessage('Failed to delete workspace')
      return
    }
    if (selectedWorkspaceId === id) setSelectedWorkspaceId('')
    if (reportWorkspaceId === id) setReportWorkspaceId('')
    await loadWorkspaces()
  }

  async function reorderWorkspaces(orderedIds: string[]) {
    const prev = workspaces
    const byId = new Map(prev.map((w) => [w.id, w]))
    const reordered: Workspace[] = []
    for (const id of orderedIds) {
      const w = byId.get(id)
      if (w) reordered.push(w)
    }
    setWorkspaces(reordered.map((w, i) => ({ ...w, sortOrder: i })))
    const res = await fetch('/api/workspaces/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
    if (!res.ok) {
      setWorkspaces(prev)
      setErrorMessage('Failed to reorder workspaces')
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  // ---------- derived values for the report ----------
  const scope: ReportScope = useMemo(
    () => ({
      workspaceId: reportWorkspaceId || null,
      fromIso,
      toIso,
    }),
    [reportWorkspaceId, fromIso, toIso],
  )

  const inScopeJobs = useMemo(
    () => (data ? jobsInScope(data.jobs, scope) : []),
    [data, scope],
  )
  const inScopeSnaps = useMemo(
    () => (data ? snapshotsInScope(data.snapshots, scope) : []),
    [data, scope],
  )

  const headline = useMemo(() => computeHeadlineNumbers(inScopeJobs), [inScopeJobs])
  const platformRows = useMemo(
    () => computePlatformBreakdown(inScopeJobs),
    [inScopeJobs],
  )
  const topByPlatform = useMemo(
    () => topPostsPerPlatform(inScopeJobs, 5),
    [inScopeJobs],
  )
  const series = useMemo(
    () => buildDailyTimeSeries(inScopeJobs, inScopeSnaps, scope),
    [inScopeJobs, inScopeSnaps, scope],
  )

  // ---------- deep-dive computations (only used when reportType === 'deepDive') ----------
  // We compute these unconditionally so a toggle into deep-dive view is
  // instant. The math is fast; no need to gate on reportType.
  const deepDive = useMemo(
    () => (data ? buildDeepDive(data.jobs, data.snapshots, scope) : null),
    [data, scope],
  )
  const recommendations = useMemo(
    () => (deepDive ? generateRecommendations(deepDive) : []),
    [deepDive],
  )

  // ---------- PDF download ----------
  /**
   * Lazy-load the PDF generator (and our PDF document component) only
   * when the user actually clicks Download. Avoids paying the
   * @react-pdf/renderer bundle cost on every reports-page visit.
   *
   * The downloaded PDF reflects the currently-selected report type:
   * Standard → ReportPdf (4.2 layout)
   * Deep-dive → DeepDivePdf (4.3 layout, ~4 pages, includes recommendations)
   */
  async function downloadPdf() {
    if (!data) return
    setPdfBusy(true)
    try {
      const { pdf } = await import('@react-pdf/renderer')
      const generatedAt = new Date()
      const scopeName = data.workspace?.name || 'all-workspaces'
      const safeName = scopeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      let doc: React.ReactElement
      let filename: string

      if (reportType === 'deepDive') {
        if (!deepDive) {
          setErrorMessage('Deep-dive data not ready yet. Try again in a moment.')
          return
        }
        const { DeepDivePdf } = await import('@/components/report-deep-dive-pdf')
        doc = (
          <DeepDivePdf
            appName="Content Hub"
            companyName=""
            workspace={data.workspace}
            generatedAt={generatedAt}
            deepDive={deepDive}
            recommendations={recommendations}
          />
        )
        filename = `deep-dive-${safeName}-${fromIso}-to-${toIso}.pdf`
      } else {
        const { ReportPdf } = await import('@/components/report-pdf')
        doc = (
          <ReportPdf
            appName="Content Hub"
            companyName=""
            workspace={data.workspace}
            fromIso={fromIso}
            toIso={toIso}
            generatedAt={generatedAt}
            headline={headline}
            platformRows={platformRows}
            topByPlatform={topByPlatform}
          />
        )
        filename = `report-${safeName}-${fromIso}-to-${toIso}.pdf`
      }

      const blob = await pdf(doc as any).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF generation failed:', err)
      setErrorMessage('PDF generation failed. Try again or check the browser console.')
    } finally {
      setPdfBusy(false)
    }
  }

  // ---------- render ----------
  /*
   * Round 7.1.4: switched to the same grid layout as app-shell. Sidebar
   * sits as a card in row 1 col 1; main content in row 1 col 2. No more
   * full-bleed left rail + dark page background.
   */
  return (
    <div className="min-h-screen p-4 lg:p-8 bg-slate-100 text-slate-900">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6 max-w-[1600px] mx-auto">
        <HostedSidebar
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={setSelectedWorkspaceId}
          onCreateWorkspace={createWorkspace}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onReorderWorkspaces={reorderWorkspaces}
          onWorkspaceUpdated={(updated) => {
            setWorkspaces((prev) =>
              prev.map((w) => (w.id === updated.id ? updated : w)),
            )
          }}
          onWorkspaceCreated={(created) => {
            setWorkspaces((prev) => [...prev, created])
            setSelectedWorkspaceId(created.id)
          }}
        />

        <main className="space-y-6 min-w-0">
          <section className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
              <p className="text-slate-600 mt-2 max-w-3xl">
                Performance over a chosen window. Pick a workspace and date range,
                then download a PDF for sharing with management or clients.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/app"
                className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-3 py-2 text-sm transition-colors"
              >
                Back to dashboard
              </Link>
              <button
                className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-4 py-2 text-sm transition-colors"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          </section>

          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
              <span>{errorMessage}</span>
              <button className="text-xs underline" onClick={() => setErrorMessage(null)}>
                Dismiss
              </button>
            </div>
          )}

          {/* Report type pill toggle — Standard or Quarterly Deep-Dive or Campaign. */}
          <section className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-600">
              Report type
            </span>
            <div className="inline-flex items-center rounded-lg border border-slate-200 p-0.5 bg-white">
              {([
                { value: 'standard', label: 'Standard' },
                { value: 'deepDive', label: 'Quarterly deep-dive' },
                { value: 'campaign', label: 'Campaign report' },
              ] as const).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setReportType(t.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    reportType === t.value
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
          </div>
        </section>

        {/* Report-specific filter bar — workspace + date range + PDF action */}
        <section className="rounded-2xl border border-slate-200 bg-white surface-shadow p-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Workspace
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 min-w-48"
              value={reportWorkspaceId}
              onChange={(e) => setReportWorkspaceId(e.target.value)}
            >
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            From
            <input
              type="date"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={fromIso}
              onChange={(e) => setFromIso(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            To
            <input
              type="date"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={toIso}
              onChange={(e) => setToIso(e.target.value)}
            />
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const r = defaultRange()
                setFromIso(r.fromIso)
                setToIso(r.toIso)
              }}
              className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-3 py-2 text-sm transition-colors"
            >
              Reset to last 30 days
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={pdfBusy || loading || !data}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm disabled:opacity-50"
            >
              {pdfBusy ? 'Generating PDF…' : 'Download PDF'}
            </button>
          </div>
        </section>

        {loading && !data ? (
          <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center text-sm text-slate-600">
            Loading report…
          </div>
        ) : reportType === 'campaign' ? (
          <ComparisonShell
            jobs={data?.jobs ?? []}
            workspace={data?.workspace ?? null}
            workspaceId={reportWorkspaceId}
            fromIso={fromIso}
            toIso={toIso}
          />
        ) : reportType === 'standard' ? (
          <>
            <ReportsHeadline headline={headline} />
            <ReportsCharts series={series} platformRows={platformRows} />

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
                Platform breakdown
              </h2>
              <ReportsPlatformTable rows={platformRows} />
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
                Top performers
              </h2>
              <ReportsTopPosts byPlatform={topByPlatform} />
            </section>
          </>
        ) : deepDive ? (
          <>
            <ReportsDeepDiveSummary deepDive={deepDive} />
            <ReportsDeepDiveMonthlyChart monthly={deepDive.monthly} />

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
                Platform comparison
              </h2>
              <ReportsDeepDivePlatformTable rows={deepDive.platforms} />
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
                Recommendations{' '}
                {recommendations.length > 0 && (
                  <span className="ml-1 text-slate-600 font-normal normal-case tracking-normal">
                    ({recommendations.length} triggered)
                  </span>
                )}
              </h2>
              <ReportsDeepDiveRecommendations recommendations={recommendations} />
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white surface-shadow p-10 text-center text-sm text-slate-600">
            Preparing deep-dive…
          </div>
        )}
      </main>
      </div>
    </div>
  )
}
