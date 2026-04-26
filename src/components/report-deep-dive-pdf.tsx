"use client"

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { Workspace } from '@/lib/types'
import type { DeepDive, TrendDelta, MonthlyPoint } from '@/lib/quarterly'
import type { Recommendation, Severity } from '@/lib/recommendations'
import { directionGlyph, formatPctChange } from '@/lib/quarterly'
import { formatNumber, formatEngagementRate, formatDateShort } from '@/lib/reports'

/**
 * Quarterly deep-dive PDF — richer than the standard report.
 *
 * Layout (page-by-page, but page-breaks are dynamic — sections will flow
 * across pages naturally):
 *
 *  1. Cover: brand, title, scope, period vs prior period, accent bar
 *  2. Executive summary: 4 trend tiles (current vs prior with deltas)
 *  3. Monthly trends: bar values shown as a small table (charts as
 *     vector images would require pre-rendering; keeping it text-based
 *     ensures the PDF is robust across browsers)
 *  4. Platform comparison: per-platform table with delta arrows
 *  5. Recommendations: numbered list, severity-coded
 *  6. Top performers: top 10 posts overall by engagement
 *  7. Methodology: a short footer page explaining how numbers were computed
 *
 * Why this is honest about no-data: every section gracefully degrades
 * when the data is sparse. No charts that go to zero look bad — we'd
 * rather show "—" or skip a section than produce a misleading visual.
 */

const PAGE_PADDING = 40

const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_PADDING,
    paddingBottom: PAGE_PADDING + 20,
    paddingLeft: PAGE_PADDING,
    paddingRight: PAGE_PADDING,
    fontSize: 10,
    color: '#111827',
    fontFamily: 'Helvetica',
    lineHeight: 1.4,
  },
  // ---- Cover ----
  coverEyebrow: {
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#6b7280',
    marginBottom: 16,
  },
  coverTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  coverSubtitle: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  coverMeta: {
    fontSize: 10,
    color: '#6b7280',
  },
  accentBar: {
    height: 4,
    width: 80,
    marginTop: 24,
    marginBottom: 24,
  },
  // ---- Section ----
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
    marginTop: 16,
  },
  sectionCaption: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 12,
  },
  // ---- Trend tiles ----
  tileRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  tile: {
    flex: 1,
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderStyle: 'solid',
  },
  tileLabel: {
    fontSize: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#6b7280',
    marginBottom: 6,
  },
  tileValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  tileDelta: {
    fontSize: 9,
    marginTop: 4,
    fontWeight: 'bold',
  },
  tileSubline: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 1,
  },
  // ---- Tables ----
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
    borderBottomStyle: 'solid',
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableHeadCell: {
    fontSize: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#6b7280',
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    borderBottomStyle: 'solid',
  },
  tableCell: {
    fontSize: 10,
    color: '#111827',
  },
  tableCellMuted: {
    fontSize: 10,
    color: '#6b7280',
  },
  tableDelta: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  // ---- Recommendations ----
  recList: {
    marginBottom: 16,
  },
  recItem: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'solid',
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
    marginRight: 10,
  },
  recBody: {
    flex: 1,
  },
  recTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 3,
  },
  recSeverity: {
    fontSize: 7,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#6b7280',
    marginBottom: 4,
  },
  recText: {
    fontSize: 9,
    color: '#374151',
    lineHeight: 1.4,
  },
  // ---- Top performers ----
  topPost: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    borderBottomStyle: 'solid',
  },
  topRank: {
    width: 18,
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: 'bold',
  },
  topTitle: {
    flex: 1,
    fontSize: 10,
    color: '#111827',
  },
  topMeta: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 2,
  },
  topStat: {
    width: 70,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#111827',
  },
  // ---- Methodology ----
  methodologyText: {
    fontSize: 9,
    color: '#374151',
    marginBottom: 8,
    lineHeight: 1.5,
  },
  methodologyHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 12,
    marginBottom: 4,
  },
  // ---- Empty state notice ----
  noticeBox: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderStyle: 'solid',
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
  },
  noticeText: {
    fontSize: 9,
    color: '#92400e',
  },
  // ---- Footer ----
  pageNumber: {
    position: 'absolute',
    bottom: PAGE_PADDING,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    fontSize: 8,
    color: '#9ca3af',
    textAlign: 'center',
  },
})

const SEVERITY_PDF_COLORS: Record<Severity, { dot: string; border: string; bg: string }> = {
  critical: { dot: '#dc2626', border: '#fecaca', bg: '#fef2f2' },
  warning: { dot: '#f59e0b', border: '#fde68a', bg: '#fffbeb' },
  opportunity: { dot: '#06b6d4', border: '#a5f3fc', bg: '#ecfeff' },
  info: { dot: '#10b981', border: '#a7f3d0', bg: '#f0fdf4' },
}

interface DeepDivePdfProps {
  appName: string
  companyName: string
  workspace: Workspace | null
  generatedAt: Date
  deepDive: DeepDive
  recommendations: Recommendation[]
}

export function DeepDivePdf(props: DeepDivePdfProps) {
  const accentColor = props.workspace?.color || '#6366f1'
  const scopeLabel = props.workspace ? props.workspace.name : 'All workspaces'
  const periodLabel =
    props.deepDive.scope.fromIso && props.deepDive.scope.toIso
      ? `${formatDateShort(props.deepDive.scope.fromIso)} – ${formatDateShort(props.deepDive.scope.toIso)}`
      : 'All time'
  const priorLabel =
    props.deepDive.priorScope.fromIso && props.deepDive.priorScope.toIso
      ? `${formatDateShort(props.deepDive.priorScope.fromIso)} – ${formatDateShort(props.deepDive.priorScope.toIso)}`
      : null
  const noMetrics = props.deepDive.current.totalPosts > 0 && props.deepDive.current.jobsWithMetrics === 0

  return (
    <Document
      title={`${scopeLabel} – Quarterly Deep Dive`}
      author={props.companyName || props.appName}
      creator={props.appName}
    >
      {/* ---- Page 1: Cover ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverEyebrow}>{props.companyName || props.appName}</Text>
        <Text style={styles.coverTitle}>Quarterly Deep Dive</Text>
        <Text style={styles.coverSubtitle}>{scopeLabel}</Text>
        <Text style={styles.coverMeta}>
          {periodLabel}
          {priorLabel ? ` · Compared with ${priorLabel}` : ''}
        </Text>
        <Text style={styles.coverMeta}>
          Generated {formatDateShort(props.generatedAt.toISOString())}
        </Text>
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        {!props.deepDive.hasAnyData && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              No posted activity in this window. The selected date range contains zero
              posts. Verify the date range or the stage of recent jobs.
            </Text>
          </View>
        )}
        {props.deepDive.hasAnyData && noMetrics && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              Posts in this period have not yet been measured. View, engagement, and rate
              comparisons will populate once metrics are captured. Recommendations that
              require metric data are skipped until then.
            </Text>
          </View>
        )}

        <Text style={styles.sectionHeader}>Executive summary</Text>
        <Text style={styles.sectionCaption}>
          Headline numbers for the period, with change vs the equivalent prior window.
        </Text>

        <View style={styles.tileRow}>
          <SummaryTile
            label="Total posts"
            value={formatNumber(props.deepDive.current.totalPosts)}
            delta={props.deepDive.trends.totalPosts}
            priorValue={props.deepDive.prior.totalPosts.toString()}
          />
          <SummaryTile
            label="Total views"
            value={
              noMetrics ? '—' : formatNumber(props.deepDive.current.totalViews)
            }
            delta={props.deepDive.trends.totalViews}
            priorValue={
              props.deepDive.prior.totalViews > 0
                ? formatNumber(props.deepDive.prior.totalViews)
                : '—'
            }
          />
          <SummaryTile
            label="Total engagement"
            value={
              noMetrics ? '—' : formatNumber(props.deepDive.current.totalEngagement)
            }
            delta={props.deepDive.trends.totalEngagement}
            priorValue={
              props.deepDive.prior.totalEngagement > 0
                ? formatNumber(props.deepDive.prior.totalEngagement)
                : '—'
            }
          />
          <SummaryTile
            label="Avg eng. rate"
            value={
              noMetrics ? '—' : formatEngagementRate(props.deepDive.current.avgEngagementRate)
            }
            delta={props.deepDive.trends.avgEngagementRate}
            priorValue={
              props.deepDive.prior.avgEngagementRate > 0
                ? formatEngagementRate(props.deepDive.prior.avgEngagementRate)
                : '—'
            }
          />
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${scopeLabel} · Deep Dive · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ---- Page 2: Monthly trends + platform comparison ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeader}>Monthly trends</Text>
        <Text style={styles.sectionCaption}>
          Activity within the selected window, broken out by month.
        </Text>
        <MonthlyTable monthly={props.deepDive.monthly} />

        <Text style={styles.sectionHeader}>Platform comparison</Text>
        <Text style={styles.sectionCaption}>
          Per-platform performance with change vs the prior window. Platforms shown as
          "silent" had posts in the prior window but not this one.
        </Text>
        <PlatformComparisonTable rows={props.deepDive.platforms} />

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${scopeLabel} · Deep Dive · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ---- Page 3+: Recommendations ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeader}>Recommendations</Text>
        <Text style={styles.sectionCaption}>
          Generated natively from the data in this window. Recommendations only fire
          when their data conditions are met — when fewer recommendations appear,
          the underlying numbers are stable.
        </Text>
        {props.recommendations.length === 0 ? (
          <Text style={styles.tableCellMuted}>
            No recommendations triggered for this period — your numbers look stable.
          </Text>
        ) : (
          <View style={styles.recList}>
            {props.recommendations.map((r) => {
              const c = SEVERITY_PDF_COLORS[r.severity]
              return (
                <View
                  key={r.id}
                  style={[
                    styles.recItem,
                    { borderColor: c.border, backgroundColor: c.bg },
                  ]}
                  wrap={false}
                >
                  <View style={[styles.recDot, { backgroundColor: c.dot }]} />
                  <View style={styles.recBody}>
                    <Text style={styles.recSeverity}>{r.severity}</Text>
                    <Text style={styles.recTitle}>{r.title}</Text>
                    <Text style={styles.recText}>{r.body}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${scopeLabel} · Deep Dive · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ---- Top performers + methodology ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeader}>Top performers</Text>
        <Text style={styles.sectionCaption}>
          The top 10 posts by total engagement actions in this window.
        </Text>
        {props.deepDive.topPerformers.length === 0 ? (
          <Text style={styles.tableCellMuted}>
            No posts have metrics yet. Top performers will appear here once measured.
          </Text>
        ) : (
          props.deepDive.topPerformers.map((r, idx) => (
            <View key={r.job.id} style={styles.topPost}>
              <Text style={styles.topRank}>{idx + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.topTitle}>{r.job.title}</Text>
                <Text style={styles.topMeta}>
                  {(r.job.platform || 'unspecified').toLowerCase()} · Posted{' '}
                  {formatDateShort(r.job.postedAt)} · {formatNumber(r.views)} views ·{' '}
                  {formatEngagementRate(r.engagementRate)}
                </Text>
              </View>
              <Text style={styles.topStat}>{formatNumber(r.engagement)}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionHeader}>Methodology</Text>
        <Text style={styles.methodologyHeader}>How "posted" is defined</Text>
        <Text style={styles.methodologyText}>
          A job counts toward this report only if its workflow stage is "posted" AND
          its posted_at timestamp falls within the selected window. The posted_at
          timestamp is set automatically when a job's stage is moved to "posted" and
          is preserved across later edits, so it represents when the post actually
          went live rather than when the row was last touched.
        </Text>
        <Text style={styles.methodologyHeader}>How metrics are aggregated</Text>
        <Text style={styles.methodologyText}>
          View, engagement, and rate figures come from metric snapshots — point-in-time
          captures recorded by the metrics fetcher. Total views and total engagement
          are summed across all in-scope posts. Average engagement rate is the
          arithmetic mean of per-post rates (not a weighted average), matching the
          desktop app's convention.
        </Text>
        <Text style={styles.methodologyHeader}>How the prior period is chosen</Text>
        <Text style={styles.methodologyText}>
          Trend deltas compare the selected window to the immediately-preceding window
          of equal length. For a 30-day window ending today, the comparison window is
          the 30 days before that. This keeps comparisons calendar-anchored to
          whatever the user picked.
        </Text>
        <Text style={styles.methodologyHeader}>How recommendations are generated</Text>
        <Text style={styles.methodologyText}>
          Recommendations come from a fixed set of rules evaluated against the data,
          run natively on the server. Each rule has a clear precondition — when the
          data is too sparse, the rule does not fire. No language model, no API spend,
          no variability between runs of the same data.
        </Text>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${scopeLabel} · Deep Dive · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}

function SummaryTile({
  label,
  value,
  delta,
  priorValue,
}: {
  label: string
  value: string
  delta: TrendDelta
  priorValue: string
}) {
  const deltaColor =
    delta.pctChange == null
      ? '#9ca3af'
      : delta.direction === 'up'
      ? '#059669'
      : delta.direction === 'down'
      ? '#dc2626'
      : '#6b7280'
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={[styles.tileDelta, { color: deltaColor }]}>
        {directionGlyph(delta.direction)} {formatPctChange(delta)}
      </Text>
      <Text style={styles.tileSubline}>vs {priorValue} prior</Text>
    </View>
  )
}

function MonthlyTable({ monthly }: { monthly: MonthlyPoint[] }) {
  if (monthly.length === 0) {
    return (
      <Text style={styles.tableCellMuted}>
        No months in the selected range.
      </Text>
    )
  }
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadCell, { flex: 2 }]}>Month</Text>
        <Text style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Posts</Text>
        <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Views</Text>
        <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Engagement</Text>
        <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Avg rate</Text>
      </View>
      {monthly.map((m) => (
        <View key={m.monthIso} style={styles.tableRow}>
          <Text style={[styles.tableCell, { flex: 2 }]}>{m.label}</Text>
          <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>{m.posts}</Text>
          <Text style={[styles.tableCellMuted, { flex: 1.2, textAlign: 'right' }]}>
            {formatNumber(m.views)}
          </Text>
          <Text style={[styles.tableCellMuted, { flex: 1.2, textAlign: 'right' }]}>
            {formatNumber(m.engagement)}
          </Text>
          <Text style={[styles.tableCellMuted, { flex: 1.2, textAlign: 'right' }]}>
            {m.avgEngagementRate == null
              ? '—'
              : formatEngagementRate(m.avgEngagementRate)}
          </Text>
        </View>
      ))}
    </View>
  )
}

function PlatformComparisonTable({ rows }: { rows: DeepDive['platforms'] }) {
  if (rows.length === 0) {
    return (
      <Text style={styles.tableCellMuted}>
        No posts in this range.
      </Text>
    )
  }
  return (
    <View>
      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadCell, { flex: 1.5 }]}>Platform</Text>
        <Text style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Posts</Text>
        <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Views</Text>
        <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Engagement</Text>
        <Text style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Eng. rate</Text>
      </View>
      {rows.map((r) => (
        <View key={r.platform} style={styles.tableRow}>
          <Text
            style={[
              styles.tableCell,
              { flex: 1.5, textTransform: 'capitalize' },
            ]}
          >
            {r.platform}
            {r.current.postsCount === 0 && (
              <Text style={{ color: '#dc2626', fontSize: 8 }}> · silent</Text>
            )}
          </Text>
          <CellWithDelta value={r.current.postsCount.toString()} delta={r.posts} />
          <CellWithDelta value={formatNumber(r.current.totalViews)} delta={r.views} />
          <CellWithDelta
            value={formatNumber(r.current.totalEngagement)}
            delta={r.engagement}
          />
          <CellWithDelta
            value={formatEngagementRate(r.current.avgEngagementRate)}
            delta={r.avgEngagementRate}
          />
        </View>
      ))}
    </View>
  )
}

function CellWithDelta({
  value,
  delta,
}: {
  value: string
  delta: TrendDelta
}) {
  const color =
    delta.pctChange == null
      ? '#9ca3af'
      : delta.direction === 'up'
      ? '#059669'
      : delta.direction === 'down'
      ? '#dc2626'
      : '#6b7280'
  return (
    <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
      <Text style={styles.tableCell}>{value}</Text>
      <Text style={[styles.tableDelta, { color }]}>
        {directionGlyph(delta.direction)} {formatPctChange(delta)}
      </Text>
    </View>
  )
}
