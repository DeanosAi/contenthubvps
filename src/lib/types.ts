// Centralized domain types for the hosted Content Hub SaaS.
// These intentionally mirror what the API returns to the browser (camelCase),
// not the raw Postgres column names (snake_case). The mapping happens in
// src/lib/db-mappers.ts so the rest of the app never has to think about it.

/**
 * The five reserved internal stages. Reports filter on these literal
 * values, so they're immutable forever. Round 7.2 introduces user-
 * added custom columns whose stage_key is an arbitrary string of the
 * form `cust_<short-uuid>`.
 *
 * Note: `Job.stage` at runtime can be ANY string (a custom stage_key),
 * but we keep this union for compile-time-checked filter expressions
 * like `job.stage === 'posted'` in reports. Code that needs to handle
 * arbitrary stage strings should accept `string` and check membership
 * against `BUILTIN_STAGE_KEYS`.
 */
export type JobStage = 'brief' | 'production' | 'ready' | 'posted' | 'archive'

/**
 * Round 7.12 — Type of Job allowed values.
 *
 * Each job can have zero or more of these types (multi-select).
 * Used by the API to validate inputs, by the UI to render the
 * checkbox picker, and by reports to bucket counts.
 *
 * Adding a new type here is the only change needed — UI, validation,
 * and reports all read from this constant. Changing or removing a
 * value would orphan any existing jobs that used it, so additions
 * only please.
 *
 * "Other" is a deliberate escape hatch for jobs that don't fit
 * cleanly. Reports surface "Other" as its own bucket so we can
 * spot when it grows large enough to justify adding a new type.
 */
export const ALLOWED_JOB_TYPES = [
  'Video',
  'Graphic Design',
  'Social Post',
  'Website Update',
  'Email Marketing',
  'Print',
  'Reports',
  'Other',
] as const

export type JobType = (typeof ALLOWED_JOB_TYPES)[number]

/**
 * Help text shown alongside the picker, explaining what each
 * value means. Keep these short — they fit in tooltip-style UI.
 */
export const JOB_TYPE_DESCRIPTIONS: Record<JobType, string> = {
  'Video': 'Video production, editing, motion graphics',
  'Graphic Design': 'Logos, posters, brochures, illustrations',
  'Social Post': 'Content for Facebook, Instagram, TikTok, etc.',
  'Website Update': 'Page edits, new pages, content changes',
  'Email Marketing': 'Newsletters, EDMs, mailout content',
  'Print': 'Flyers, posters, print collateral, signage',
  'Reports': 'Analytics requests, data summaries, dashboards',
  'Other': 'Doesn\'t fit any of the above',
}

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

/** A point-in-time set of social-media metrics for a job. */
export interface LiveMetrics {
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  reach: number | null
  impressions: number | null
  /** Engagement rate as a fraction (0.0234 = 2.34%). */
  engagementRate: number | null
}

/** Append-only historical record of a metric fetch. */
export interface MetricSnapshot {
  id: string
  jobId: string
  workspaceId: string
  platform: string | null
  capturedAt: string
  metrics: LiveMetrics
}

/**
 * Application user role.
 *
 * - `admin` — full access, plus user/workspace management.
 * - `member` — full access to all jobs across all workspaces.
 *   Cannot manage users or create workspaces.
 * - `briefer` — Round 7.11. Restricted to a single workspace
 *   (their venue). Can submit briefs into that workspace, view
 *   their own jobs, edit only the brief fields they originally
 *   set, and read+write comments. Cannot see the staff app shell,
 *   reports, calendar, settings, or other workspaces.
 */
export type UserRole = 'admin' | 'member' | 'briefer'

export interface User {
  id: string
  email: string
  name: string | null
  role: UserRole
  /**
   * Round 7.11: required for `briefer` role, NULL for admin/member.
   * Bound to a single workspace ("venue") — briefers see only
   * jobs from this workspace.
   */
  workspaceId: string | null
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

/**
 * Round 7.2: per-workspace kanban column configuration.
 *
 * Each row maps a `stageKey` (the literal value stored in `Job.stage`)
 * to a user-facing label, colour, and sort order.
 *
 * Built-in columns (the five reserved stages) have `isBuiltin: true`
 * and their `stageKey` is one of the JobStage union values. They can
 * be renamed and reordered but NOT deleted — reports depend on them.
 *
 * Custom columns have `isBuiltin: false` and `stageKey` of the form
 * `cust_<short-uuid>`. They can be renamed, reordered, and deleted
 * freely. Posts in custom columns don't appear in any reports (the
 * caption "Posts here won't appear in reports" makes this explicit
 * in the UI).
 */
export interface KanbanColumn {
  id: string
  workspaceId: string
  /** Stored in `jobs.stage` — built-ins use the JobStage values, customs
   *  use `cust_<short-uuid>`. */
  stageKey: string
  /** User-facing column header. */
  label: string
  /** Hex colour used for the column dot and tinted backdrop. */
  color: string
  sortOrder: number
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
}

export interface Job {
  id: string
  workspaceId: string
  title: string
  description: string | null
  /**
   * Round 7.2: at runtime this can be any non-empty string (one of the
   * five built-in JobStage values OR a custom `cust_<...>` key). The
   * type is widened to `string` here so component code that passes
   * stage values around doesn't have to cast everywhere.
   *
   * Reports and other code that branches on specific stages should
   * compare against the literal strings: `job.stage === 'posted'` etc.
   * Those checks remain compile-time safe via the JobStage union when
   * needed.
   */
  stage: string
  priority: number
  dueDate: string | null
  hashtags: string | null
  platform: string | null
  liveUrl: string | null
  notes: string | null
  /**
   * @deprecated Round 7.12: replaced by `contentTypes` (multi-select
   * array). This field is no longer populated by new code, but kept
   * in the type for compatibility with any client code that might
   * still reference it. Always returned as null by the mapper now.
   */
  contentType: string | null
  /**
   * Round 7.12: Type of Job — multi-select. Each value is one of
   * ALLOWED_JOB_TYPES. Empty array means no types selected.
   *
   * A single job can have multiple types: a video that's also
   * shared as a social post gets ['Video', 'Social Post']. The
   * "Jobs by type" report counts each type-bucket independently
   * (so this job adds +1 to both Video and Social Post counts).
   */
  contentTypes: string[]
  briefUrl: string | null
  assetLinks: AssetLink[]
  approvalStatus: ApprovalStatus
  assignedTo: string | null
  customFields: CustomField[]
  campaign: string | null
  facebookLiveUrl: string | null
  facebookPostId: string | null
  instagramLiveUrl: string | null
  postedAt: string | null
  liveMetrics: LiveMetrics | null
  lastMetricsFetchAt: string | null
  /**
   * Round 7.11: briefer's display name captured at brief-submit time.
   * NULL for jobs created by staff. Set when a briefer submits via
   * the brief form — preserves their identity even when the venue's
   * shared login is later used by someone else.
   */
  brieferDisplayName: string | null
  createdAt: string
  updatedAt: string
}

/** Key-value app settings. */
export type SettingKey =
  | 'app.name'
  | 'app.companyName'
  | 'app.logoUrl'
  | 'app.accentColor'
  | 'jobs.defaultPlatform'
  | 'jobs.defaultStage'
  | 'jobs.defaultSort'
  | 'jobs.archivedVisibility'
  | 'apify.token'

export interface AppSetting {
  key: SettingKey
  value: string | null
  updatedAt: string
}

/**
 * Shape of the JWT payload after verifying a session cookie.
 *
 * Round 7.11 additions:
 * - `role` includes 'briefer'
 * - `workspaceId` carried for briefer sessions (null for admin/member)
 * - `displayName` carried separately from the user's profile name —
 *   it's the "who's using this venue account today" answer captured
 *   at session start (or set by the switch-user flow). Used as the
 *   default for comment authorship and edit attribution. May be null
 *   if not yet set; UI prompts the briefer for it on first action.
 */
export interface SessionUser {
  userId: string
  email: string
  role: UserRole
  workspaceId: string | null
  displayName: string | null
}

/**
 * A comment on a job (Round 7.10 — comments / approval thread).
 *
 * `authorId` may be null if the original author was deleted from the
 * users table — the FK uses ON DELETE SET NULL specifically to
 * preserve historical comments. The UI renders a "Former user"
 * placeholder in that case.
 *
 * `authorName` and `authorEmail` are denormalised for convenience
 * so the comments API can return ready-to-render data without the
 * client needing to join against the users list. They're computed
 * server-side on read; not stored.
 *
 * Round 7.11 additions:
 * - `displayName` captured from the session at post time. For staff
 *   this defaults to their profile name. For briefers it's the
 *   "who's using this account" session answer. Null for legacy
 *   comments posted before 7.11 — UI falls back to authorName.
 * - `authorRole` denormalised so the UI can render a "via venue"
 *   badge for briefer comments without an extra users join.
 *
 * `edited` is a boolean flag separate from `createdAt != updatedAt`
 * because we want to distinguish "the author edited this comment"
 * from "the timestamp moved for any internal reason." Cleaner.
 */
export interface JobComment {
  id: string
  jobId: string
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  authorRole: UserRole | null
  displayName: string | null
  body: string
  edited: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Round 7.11 — a single edit event on a tracked job field.
 *
 * Surfaced in the UI in two places:
 *   1. Inline indicator next to a field on the staff detail panel:
 *      "edited by Tracy on 28 May, 3:47pm"
 *   2. Full edit timeline view (modal/section) showing every change
 *      with old/new values.
 *
 * `editedByUserId` may be null if the editing user was later deleted
 * (FK is ON DELETE SET NULL). `editedByName` is snapshotted at edit
 * time so attribution survives user deletion AND survives a venue
 * shared-login switching to a different person mid-day.
 */
export interface JobEdit {
  id: string
  jobId: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  editedByUserId: string | null
  editedByName: string
  editedByRole: UserRole
  editedAt: string
}

/**
 * Helper: is this stage one of the five built-in reserved stages?
 *
 * Round 7.2 adds custom user stages whose keys are NOT in this list.
 * Reports use this to skip over custom-stage jobs at the filtering step.
 */
export function isBuiltinStage(stage: string): stage is JobStage {
  return (
    stage === 'brief' ||
    stage === 'production' ||
    stage === 'ready' ||
    stage === 'posted' ||
    stage === 'archive'
  )
}
