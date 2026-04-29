"use client"

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { Workspace } from '@/lib/types'
import type {
  ComparisonReport,
  ComparisonInsight,
  InsightSeverity,
} from '@/lib/comparison'
import { formatDateShort } from '@/lib/reports'

/**
 * Comparison-report PDF.
 *
 * Layout:
 *   1. Cover: brand, title, scope (mode + period or campaign), accent bar
 *   2. Summary tiles: total posts, total engagement, mean, median, best
 *   3. Ranked table: every selected post with its key metrics
 *   4. Insights: descriptive rule outputs, colour-coded
 *   5. Methodology: short footer page explaining how things were computed
 *
 * No chart-as-image — same tradeoff as the deep-dive PDF: rendering a
 * Recharts figure to PDF needs a separate pre-render step. The ranked
 * table is the comparison's clearest single artefact anyway.
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
  // Cover
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
    // Round 7.4: explicit lineHeight prevents the next element from
    // overlapping the title. See report-pdf.tsx for full reasoning.
    lineHeight: 1.2,
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
  // Sections
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
  // Summary tiles
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
  tileSubline: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 4,
  },
  // Tables
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
    fontSize: 9,
    color: '#111827',
  },
  tableCellMuted: {
    fontSize: 9,
    color: '#6b7280',
  },
  // Insights
  insightItem: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'solid',
  },
  insightDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
    marginRight: 10,
  },
  insightSeverity: {
    fontSize: 7,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#6b7280',
    marginBottom: 4,
  },
  insightTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 3,
  },
  insightBody: {
    fontSize: 9,
    color: '#374151',
    lineHeight: 1.4,
  },
  // Methodology
  methodologyHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 12,
    marginBottom: 4,
  },
  methodologyText: {
    fontSize: 9,
    color: '#374151',
    marginBottom: 8,
    lineHeight: 1.5,
  },
  // Notice box
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

const SEVERITY_COLORS: Record<InsightSeverity, { dot: string; bg: string; border: string }> = {
  caution: { dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  highlight: { dot: '#06b6d4', bg: '#ecfeff', border: '#a5f3fc' },
  note: { dot: '#10b981', bg: '#f0fdf4', border: '#a7f3d0' },
}

interface ComparisonPdfProps {
  appName: string
  companyName: string
  workspace: Workspace | null
  generatedAt: Date
  /** Either describes the manual selection ("12 selected posts") or the
   * campaign filter ("Spring Launch 2026, full campaign"). */
  scopeLabel: string
  /** Period label, when applicable. Empty/null when "Full campaign". */
  periodLabel: string | null
  report: ComparisonReport
  insights: ComparisonInsight[]
}

export function ComparisonPdf(props: ComparisonPdfProps) {
  const accentColor = props.workspace?.color || '#6366f1'
  const wsName = props.workspace ? props.workspace.name : 'All workspaces'
  const noMetrics =
    props.report.posts.length > 0 && props.report.summary.postsWithMetrics === 0
  const partialMetrics =
    props.report.summary.postsWithMetrics > 0 &&
    props.report.summary.postsWithMetrics < props.report.posts.length

  return (
    <Document
      title={`${wsName} – Comparison Report`}
      author={props.companyName || props.appName}
      creator={props.appName}
    >
      {/* ---- Cover + summary ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverEyebrow}>{props.companyName || props.appName}</Text>
        <Text style={styles.coverTitle}>Campaign Comparison</Text>
        <Text style={styles.coverSubtitle}>{wsName}</Text>
        <Text style={styles.coverMeta}>{props.scopeLabel}</Text>
        {props.periodLabel && (
          <Text style={styles.coverMeta}>{props.periodLabel}</Text>
        )}
        <Text style={styles.coverMeta}>
          Generated {formatDateShort(props.generatedAt.toISOString())}
        </Text>
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        {noMetrics && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              None of the selected posts have metric snapshots yet. Comparison
              numbers will populate once metrics are captured. Listing below
              shows the post selection only.
            </Text>
          </View>
        )}
        {partialMetrics && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              {props.report.posts.length - props.report.summary.postsWithMetrics}{' '}
              of {props.report.posts.length} posts have no metric snapshots yet.
              Numbers below are computed from the {props.report.summary.postsWithMetrics}{' '}
              posts that do have metrics.
            </Text>
          </View>
        )}

        <Text style={styles.sectionHeader}>Summary</Text>
        <Text style={styles.sectionCaption}>
          Headline numbers across the comparison set.
        </Text>
        <View style={styles.tileRow}>
          <SummaryTile
            label="Posts compared"
            value={props.report.posts.length.toString()}
            subline={
              partialMetrics || noMetrics
                ? `${props.report.summary.postsWithMetrics} with metrics`
                : 'all measured'
            }
          />
          <SummaryTile
            label="Total engagement"
            value={
              noMetrics ? '—' : props.report.summary.totalEngagement.toLocaleString()
            }
            subline={
              noMetrics
                ? 'no metrics yet'
                : `${props.report.summary.totalViews.toLocaleString()} views`
            }
          />
          <SummaryTile
            label="Mean engagement"
            value={
              noMetrics ? '—' : Math.round(props.report.summary.meanEngagement).toLocaleString()
            }
            subline={
              noMetrics
                ? '—'
                : `Median ${Math.round(props.report.summary.medianEngagement).toLocaleString()}`
            }
          />
          <SummaryTile
            label="Best performer"
            value={
              props.report.summary.best
                ? props.report.summary.best.engagement.toLocaleString()
                : '—'
            }
            subline={
              props.report.summary.best
                ? truncatePdf(props.report.summary.best.job.title, 28)
                : 'no data'
            }
          />
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${wsName} · Comparison · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ---- Ranked table ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeader}>Posts ranked by engagement</Text>
        <Text style={styles.sectionCaption}>
          Highest engagement first. Posts without metrics are listed at the
          end with em-dashes in numeric columns.
        </Text>
        <RankedTable report={props.report} />

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${wsName} · Comparison · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ---- Insights + methodology ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeader}>Observations</Text>
        <Text style={styles.sectionCaption}>
          Generated natively from the data in this set. Observations only fire
          when their data conditions are met. They describe what the numbers
          show, not what to do next — those decisions remain a human read.
        </Text>
        {props.insights.length === 0 ? (
          <Text style={styles.tableCellMuted}>
            No observations triggered for this comparison — numbers look stable.
          </Text>
        ) : (
          props.insights.map((i) => {
            const c = SEVERITY_COLORS[i.severity]
            return (
              <View
                key={i.id}
                style={[
                  styles.insightItem,
                  { borderColor: c.border, backgroundColor: c.bg },
                ]}
                wrap={false}
              >
                <View style={[styles.insightDot, { backgroundColor: c.dot }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.insightSeverity}>{i.severity}</Text>
                  <Text style={styles.insightTitle}>{i.title}</Text>
                  <Text style={styles.insightBody}>{i.body}</Text>
                </View>
              </View>
            )
          })
        )}

        <Text style={styles.sectionHeader}>Methodology</Text>
        <Text style={styles.methodologyHeader}>How posts were selected</Text>
        <Text style={styles.methodologyText}>
          {props.scopeLabel}. Only posts whose stage is &quot;posted&quot; or
          &quot;archive&quot; were eligible — drafts and in-progress jobs are
          excluded so the comparison only contains real finished posts.
        </Text>
        <Text style={styles.methodologyHeader}>How metrics were aggregated</Text>
        <Text style={styles.methodologyText}>
          Engagement = likes + comments + shares + saves, summed across each
          post&apos;s most recent metric snapshot. Mean engagement is the
          arithmetic average across posts that have metrics; the median is
          the middle value. Posts without metrics are excluded from those
          aggregates but listed in the ranked table for completeness.
        </Text>
        <Text style={styles.methodologyHeader}>How observations were generated</Text>
        <Text style={styles.methodologyText}>
          Observations come from a fixed set of rules evaluated against the
          comparison set, run natively on the server. Each rule has a clear
          precondition — when the data is too thin or the pattern absent, the
          rule does not fire. No language model, no API spend, no variability
          between runs of the same data.
        </Text>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${wsName} · Comparison · Page ${pageNumber} of ${totalPages}`
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
  subline,
}: {
  label: string
  value: string
  subline?: string
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {subline && <Text style={styles.tileSubline}>{subline}</Text>}
    </View>
  )
}

function RankedTable({ report }: { report: ComparisonReport }) {
  if (report.posts.length === 0) {
    return <Text style={styles.tableCellMuted}>No posts in this comparison.</Text>
  }
  return (
    <View>
      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadCell, { width: 24 }]}>#</Text>
        <Text style={[styles.tableHeadCell, { flex: 3 }]}>Post</Text>
        <Text style={[styles.tableHeadCell, { flex: 1.2 }]}>Posted</Text>
        <Text style={[styles.tableHeadCell, { flex: 1 }]}>Platform</Text>
        <Text
          style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}
        >
          Views
        </Text>
        <Text
          style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}
        >
          Engagement
        </Text>
        <Text
          style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}
        >
          Eng. rate
        </Text>
      </View>
      {report.posts.map((p, idx) => (
        <View key={p.job.id} style={styles.tableRow} wrap={false}>
          <Text
            style={[
              styles.tableCellMuted,
              { width: 24, fontWeight: 'bold' },
            ]}
          >
            {idx + 1}
          </Text>
          <View style={{ flex: 3 }}>
            <Text style={styles.tableCell}>{truncatePdf(p.job.title, 60)}</Text>
            {(p.job.contentTypes && p.job.contentTypes.length > 0) || p.job.campaign ? (
              <Text style={[styles.tableCellMuted, { fontSize: 8 }]}>
                {[
                  p.job.contentTypes && p.job.contentTypes.length > 0
                    ? p.job.contentTypes.join(', ')
                    : null,
                  p.job.campaign,
                ].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.tableCellMuted, { flex: 1.2 }]}>
            {p.job.postedAt ? formatDateShort(p.job.postedAt) : '—'}
          </Text>
          <Text
            style={[
              styles.tableCellMuted,
              { flex: 1, textTransform: 'capitalize' },
            ]}
          >
            {p.job.platform || '—'}
          </Text>
          <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>
            {p.hasMetrics ? p.views.toLocaleString() : '—'}
          </Text>
          <Text
            style={[
              styles.tableCell,
              { flex: 1, textAlign: 'right', fontWeight: 'bold' },
            ]}
          >
            {p.hasMetrics ? p.engagement.toLocaleString() : '—'}
          </Text>
          <Text style={[styles.tableCellMuted, { flex: 1, textAlign: 'right' }]}>
            {p.engagementRate == null
              ? '—'
              : (p.engagementRate * 100).toFixed(2) + '%'}
          </Text>
        </View>
      ))}
    </View>
  )
}

function truncatePdf(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}
