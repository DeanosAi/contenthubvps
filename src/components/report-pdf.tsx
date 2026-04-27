"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { Workspace } from '@/lib/types'
import type {
  HeadlineNumbers,
  PlatformRow,
  TopPostRow,
} from '@/lib/reports'
import { formatNumber, formatEngagementRate, formatDateShort } from '@/lib/reports'

/**
 * Standard report PDF, generated client-side via @react-pdf/renderer.
 *
 * Why client-side: zero server cost per export, no Chromium dependency
 * on the VPS, the user's browser does the work. For 5-15 page reports
 * this finishes in well under a second on a typical machine.
 *
 * The visual style is deliberately understated and corporate-appropriate
 * — clean typography, generous whitespace, no dark theme (PDFs print
 * better on light backgrounds). The accent color is the only "branded"
 * touch and pulls from the workspace color when available, falling back
 * to a neutral indigo.
 */

// Default fonts. We don't pull custom fonts — relying on Helvetica
// (the @react-pdf default) keeps the bundle small and avoids font-load
// failures in restricted environments.

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
  // ---- Section headers ----
  sectionHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
    marginTop: 8,
  },
  sectionCaption: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 12,
  },
  // ---- Headline tiles ----
  headlineRow: {
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
  tileCaption: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 2,
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
  // ---- Top posts ----
  topPlatformBlock: {
    marginBottom: 16,
  },
  topPostsHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  topPost: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    borderBottomStyle: 'solid',
  },
  topPostRank: {
    width: 18,
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: 'bold',
  },
  topPostTitle: {
    // Round 7.5: removed `flex: 1` and added explicit lineHeight,
    // matching the fix made in report-deep-dive-pdf.tsx in Round 7.4.
    // The standard report PDF had the same bug — the title sat in
    // a column-flex parent so flex: 1 didn't widen it but caused
    // @react-pdf/renderer layout instability that collapsed the
    // title's height, making topPostMeta render on the same line.
    fontSize: 10,
    color: '#111827',
    lineHeight: 1.3,
  },
  topPostMeta: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 2,
  },
  topPostStat: {
    width: 70,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#111827',
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
  // ---- Empty state notes ----
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
})

interface ReportPdfProps {
  appName: string
  companyName: string
  workspace: Workspace | null
  fromIso: string | null
  toIso: string | null
  generatedAt: Date
  headline: HeadlineNumbers
  platformRows: PlatformRow[]
  topByPlatform: Map<string, TopPostRow[]>
}

export function ReportPdf(props: ReportPdfProps) {
  const accentColor = props.workspace?.color || '#6366f1'
  const scopeLabel = props.workspace
    ? props.workspace.name
    : 'All workspaces'
  const dateLabel =
    props.fromIso && props.toIso
      ? `${formatDateShort(props.fromIso)} – ${formatDateShort(props.toIso)}`
      : 'All time'
  const noMetrics =
    props.headline.totalPosts > 0 && props.headline.jobsWithMetrics === 0

  return (
    <Document
      title={`${scopeLabel} – Performance report`}
      author={props.companyName || props.appName}
      creator={props.appName}
    >
      {/* ---- Page 1: Cover + headline ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverEyebrow}>{props.companyName || props.appName}</Text>
        <Text style={styles.coverTitle}>Performance Report</Text>
        <Text style={styles.coverSubtitle}>{scopeLabel}</Text>
        <Text style={styles.coverMeta}>
          {dateLabel} · Generated {formatDateShort(props.generatedAt.toISOString())}
        </Text>
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        {noMetrics && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              Posts in this period have not yet been measured. View, engagement,
              and rate figures will populate once the metrics fetcher captures
              them.
            </Text>
          </View>
        )}

        <Text style={styles.sectionHeader}>Headline numbers</Text>
        <Text style={styles.sectionCaption}>
          Aggregate performance for posts in the reporting window.
        </Text>

        <View style={styles.headlineRow}>
          <Tile
            label="Total posts"
            value={formatNumber(props.headline.totalPosts)}
            caption={
              props.headline.totalPosts === 1 ? 'post in range' : 'posts in range'
            }
          />
          <Tile
            label="Total views"
            value={noMetrics ? '—' : formatNumber(props.headline.totalViews)}
            caption={noMetrics ? 'awaiting metrics' : 'across all posts'}
          />
          <Tile
            label="Total engagement"
            value={
              noMetrics ? '—' : formatNumber(props.headline.totalEngagement)
            }
            caption="likes + comments + shares + saves"
          />
          <Tile
            label="Avg eng. rate"
            value={
              noMetrics
                ? '—'
                : formatEngagementRate(props.headline.avgEngagementRate)
            }
            caption="mean across reporting posts"
          />
        </View>

        <Text style={styles.sectionHeader}>Platform breakdown</Text>
        <Text style={styles.sectionCaption}>
          Performance grouped by platform, sorted by total engagement.
        </Text>

        <View style={styles.tableHead}>
          <Text style={[styles.tableHeadCell, { flex: 2 }]}>Platform</Text>
          <Text style={[styles.tableHeadCell, { flex: 1, textAlign: 'right' }]}>Posts</Text>
          <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Views</Text>
          <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Engagement</Text>
          <Text style={[styles.tableHeadCell, { flex: 1.2, textAlign: 'right' }]}>Avg rate</Text>
        </View>
        {props.platformRows.length === 0 ? (
          <Text style={[styles.tableCellMuted, { paddingVertical: 12 }]}>
            No posts in this range.
          </Text>
        ) : (
          props.platformRows.map((r) => (
            <View key={r.platform} style={styles.tableRow}>
              <Text
                style={[
                  styles.tableCell,
                  { flex: 2, textTransform: 'capitalize' },
                ]}
              >
                {r.platform}
              </Text>
              <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>
                {r.postsCount}
              </Text>
              <Text
                style={[styles.tableCellMuted, { flex: 1.2, textAlign: 'right' }]}
              >
                {formatNumber(r.totalViews)}
              </Text>
              <Text
                style={[styles.tableCellMuted, { flex: 1.2, textAlign: 'right' }]}
              >
                {formatNumber(r.totalEngagement)}
              </Text>
              <Text
                style={[styles.tableCellMuted, { flex: 1.2, textAlign: 'right' }]}
              >
                {formatEngagementRate(r.avgEngagementRate)}
              </Text>
            </View>
          ))
        )}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${scopeLabel} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ---- Page 2+: Top performers ---- */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionHeader}>Top performers</Text>
        <Text style={styles.sectionCaption}>
          The five highest-engagement posts in each platform for the reporting
          window. Engagement = likes + comments + shares + saves.
        </Text>

        {props.topByPlatform.size === 0 ? (
          <Text style={styles.tableCellMuted}>
            No posts have metrics yet. Top performers will appear here once the
            metric fetcher has captured at least one snapshot per post.
          </Text>
        ) : (
          Array.from(props.topByPlatform.entries()).map(([platform, rows]) => (
            <View key={platform} style={styles.topPlatformBlock} wrap={false}>
              <Text style={styles.topPostsHeader}>{platform}</Text>
              {rows.map((r, idx) => (
                <View key={r.job.id} style={styles.topPost}>
                  <Text style={styles.topPostRank}>{idx + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topPostTitle}>{r.job.title}</Text>
                    <Text style={styles.topPostMeta}>
                      Posted {formatDateShort(r.job.postedAt)} ·{' '}
                      {formatNumber(r.views)} views ·{' '}
                      {formatEngagementRate(r.engagementRate)}
                    </Text>
                  </View>
                  <Text style={styles.topPostStat}>
                    {formatNumber(r.engagement)}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${scopeLabel} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )
}

function Tile({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption?: string
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {caption && <Text style={styles.tileCaption}>{caption}</Text>}
    </View>
  )
}
