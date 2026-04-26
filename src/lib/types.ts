// Centralized domain types for the hosted Content Hub SaaS.
// These intentionally mirror what the API returns to the browser (camelCase),
// not the raw Postgres column names (snake_case). The mapping happens in
// src/lib/db-mappers.ts so the rest of the app never has to think about it.

export type JobStage = 'brief' | 'production' | 'ready' | 'posted' | 'archive'

export type ApprovalStatus = 'none' | 'awaiting' | 'approved' | 'changes_requested'

/** A reference link attached to a job. URL-only by design — the hosted app
 * deliberately does not store local file paths or browser blob URLs.
 * Cloud links (Drive / Dropbox / Frame.io / SharePoint) are the supported
 * way to reference assets. */
export interface AssetLink {
  /** Stable id within the job — used as React keys and for delete-by-id. */
  id: string
  /** Human label shown in the UI. */
  label: string
  /** Full URL. Anything that begins with http(s) renders as a link. */
  url: string
}

/** Available data shapes for a custom field. Kept narrow so the UI can
 * render the right input control for each. */
export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'url'

/** A user-defined extra field on a job. */
export interface CustomField {
  id: string
  label: string
  type: CustomFieldType
  value: string
}

/** A point-in-time set of social-media metrics for a job. Used both as the
 * latest cached state on `Job.liveMetrics` and as the historical record in
 * `MetricSnapshot.metrics`.
 *
 * All numeric fields are nullable because not every platform reports every
 * metric — TikTok exposes views but not reach, Instagram exposes reach but
 * not views, etc. The reports tolerate nulls. */
export interface LiveMetrics {
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  reach: number | null
  impressions: number | null
  /** Engagement rate as a fraction (0.0234 = 2.34%). Stored that way to
   * avoid double-converting back and forth. The UI formats with `* 100`. */
  engagementRate: number | null
}

/** Append-only historical record of a metric fetch. Reports query these
 * for trend analysis (month-over-month growth, etc). */
export interface MetricSnapshot {
  id: string
  jobId: string
  workspaceId: string
  /** Which platform these metrics belong to. Null for combined / unknown. */
  platform: string | null
  /** ISO timestamp of when the snapshot was captured. */
  capturedAt: string
  metrics: LiveMetrics
}

export interface User {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  ownerId: string
  name: string
  color: string
  sortOrder: number
  facebookPageUrl: string | null
  instagramPageUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface Job {
  id: string
  workspaceId: string
  title: string
  description: string | null
  stage: JobStage
  priority: number
  dueDate: string | null
  hashtags: string | null
  platform: string | null
  liveUrl: string | null
  notes: string | null
  contentType: string | null
  briefUrl: string | null
  assetLinks: AssetLink[]
  approvalStatus: ApprovalStatus
  assignedTo: string | null
  customFields: CustomField[]
  facebookLiveUrl: string | null
  facebookPostId: string | null
  instagramLiveUrl: string | null
  /** Stable timestamp of when the stage moved to `posted`. Null while the
   * job is still pre-post. Reports use this (not updatedAt or dueDate)
   * for "posts in date range" calculations. */
  postedAt: string | null
  /** Latest cached metric values from the most recent Apify fetch. Null
   * until the first fetch happens. The kanban card / detail panel read
   * from here for at-a-glance display. */
  liveMetrics: LiveMetrics | null
  /** When `liveMetrics` was last refreshed. Null if never fetched. */
  lastMetricsFetchAt: string | null
  createdAt: string
  updatedAt: string
}

/** Key-value app settings. Stored in DB so they survive restarts and so
 * branding/preferences set by an admin show up for the whole team. */
export type SettingKey =
  | 'app.name'
  | 'app.companyName'
  | 'app.logoUrl'
  | 'app.accentColor'
  | 'jobs.defaultPlatform'
  | 'jobs.defaultStage'
  | 'jobs.defaultSort'
  | 'jobs.archivedVisibility'

export interface AppSetting {
  key: SettingKey
  value: string | null
  updatedAt: string
}

/** Shape of the JWT payload after verifying a session cookie. */
export interface SessionUser {
  userId: string
  email: string
  role: 'admin' | 'member'
}
