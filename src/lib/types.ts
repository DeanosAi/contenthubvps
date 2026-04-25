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
  // Hosted-safe extensions (Phase 1 brief)
  contentType: string | null
  briefUrl: string | null
  assetLinks: AssetLink[]
  approvalStatus: ApprovalStatus
  assignedTo: string | null
  // Optional Facebook fields preserved from desktop app, used by metrics
  // fetching paths added in later rounds.
  facebookLiveUrl: string | null
  facebookPostId: string | null
  instagramLiveUrl: string | null
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
