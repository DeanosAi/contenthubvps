"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { HostedSidebar } from '@/components/hosted-sidebar'
import { ReportsHeadline } from '@/components/reports-headline'
import { ReportsCharts } from '@/components/reports-charts'
import { ReportsPlatformTable } from '@/components/reports-platform-table'
import { ReportsTopPosts } from '@/components/reports-top-posts'
import type { Job, MetricSnapshot, Workspace } from '@/lib/types'
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

  // ---------- PDF download ----------
  /**
   * Lazy-load the PDF generator (and our PDF document component) only
   * when the user actually clicks Download. Avoids paying the
   * @react-pdf/renderer bundle cost on every reports-page visit.
   */
  async function downloadPdf() {
    if (!data) return
    setPdfBusy(true)
    try {
      const [{ pdf }, { ReportPdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/report-pdf'),
      ])

      const generatedAt = new Date()
      const doc = (
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
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const scopeName = data.workspace?.name || 'all-workspaces'
      const safeName = scopeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      a.href = url
      a.download = `report-${safeName}-${fromIso}-to-${toIso}.pdf`
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
  return (
    <div className="flex min-h-screen">
      <HostedSidebar
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
        onCreateWorkspace={createWorkspace}
        onRenameWorkspace={renameWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onReorderWorkspaces={reorderWorkspaces}
      />

      <main className="flex-1 p-8 space-y-6">
        <section className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--muted-foreground))]">
              Hosted Content Hub
            </p>
            <h1 className="text-4xl font-bold mt-2">Reports</h1>
            <p className="text-[hsl(var(--muted-foreground))] mt-3 max-w-3xl">
              Performance over a chosen window. Pick a workspace and date range,
              then download a PDF for sharing with management or clients.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/app"
              className="rounded-lg border px-3 py-2 text-sm hover:bg-[hsl(var(--accent))]/40"
            >
              Back to dashboard
            </Link>
            <button
              className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))]"
              onClick={logout}
            >
              Log out
            </button>
          </div>
        </section>

        {errorMessage && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button className="text-xs underline" onClick={() => setErrorMessage(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* Report-specific filter bar — workspace + date range + PDF action */}
        <section className="rounded-2xl border bg-[hsl(var(--card))] p-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            Workspace
            <select
              className="rounded-lg border bg-transparent px-3 py-2 text-sm min-w-48"
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
          <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            From
            <input
              type="date"
              className="rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={fromIso}
              onChange={(e) => setFromIso(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            To
            <input
              type="date"
              className="rounded-lg border bg-transparent px-3 py-2 text-sm"
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
              className="rounded-lg border px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Reset to last 30 days
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={pdfBusy || loading || !data}
              className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-50"
            >
              {pdfBusy ? 'Generating PDF…' : 'Download PDF'}
            </button>
          </div>
        </section>

        {loading && !data ? (
          <div className="rounded-2xl border bg-[hsl(var(--card))] p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Loading report…
          </div>
        ) : (
          <>
            <ReportsHeadline headline={headline} />
            <ReportsCharts series={series} platformRows={platformRows} />

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Platform breakdown
              </h2>
              <ReportsPlatformTable rows={platformRows} />
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Top performers
              </h2>
              <ReportsTopPosts byPlatform={topByPlatform} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
