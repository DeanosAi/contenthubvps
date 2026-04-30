// Single place that converts raw Postgres rows (snake_case columns,
// JSONB columns as already-parsed objects) into the camelCase domain
// types the rest of the app uses.

import type {
  AssetLink,
  ApprovalStatus,
  CustomField,
  CustomFieldType,
  Job,
  JobComment,
  KanbanColumn,
  LiveMetrics,
  MetricSnapshot,
  User,
  Workspace,
  AppSetting,
  SettingKey,
} from './types'

type Row = Record<string, unknown>

function asString(v: unknown): string {
  return v == null ? '' : String(v)
}

function asNullableString(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s.length > 0 ? s : null
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

function asNullableNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asBoolean(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true' || v === 't' || v === '1'
  if (typeof v === 'number') return v !== 0
  return fallback
}

function asIsoString(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function asNullableIsoString(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  return s.length > 0 ? s : null
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

function mapAssetLinks(raw: unknown): AssetLink[] {
  const parsed = parseJson<unknown>(raw, [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: asString(item.id) || crypto.randomUUID(),
      label: asString(item.label),
      url: asString(item.url),
    }))
    .filter((link) => link.url.length > 0)
}

function mapCustomFields(raw: unknown): CustomField[] {
  const parsed = parseJson<unknown>(raw, [])
  if (!Array.isArray(parsed)) return []
  const allowedTypes: CustomFieldType[] = ['text', 'textarea', 'number', 'date', 'url']
  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const t = String(item.type ?? 'text')
      const safeType: CustomFieldType = (allowedTypes as string[]).includes(t)
        ? (t as CustomFieldType)
        : 'text'
      return {
        id: asString(item.id) || crypto.randomUUID(),
        label: asString(item.label),
        type: safeType,
        value: asString(item.value),
      }
    })
    .filter((cf) => cf.label.length > 0 || cf.value.length > 0)
}

function mapApprovalStatus(v: unknown): ApprovalStatus {
  const allowed: ApprovalStatus[] = ['none', 'awaiting', 'approved', 'changes_requested']
  const s = String(v ?? 'none')
  return (allowed as string[]).includes(s) ? (s as ApprovalStatus) : 'none'
}

/**
 * Round 7.12 — map a Postgres TEXT[] column to string[].
 *
 * The pg driver decodes TEXT[] as a JS array, so this helper is
 * mostly defensive: it ensures the result is an array of strings
 * even if the column is null (legacy rows from before the
 * migration), and filters out non-string entries defensively.
 *
 * We do NOT enforce that values are in ALLOWED_JOB_TYPES here —
 * the API write path validates inputs at the gate. Reading what's
 * already stored should be lenient so a value that was added then
 * later removed from ALLOWED_JOB_TYPES still surfaces (and the
 * reports breakdown can show it as a stray bucket).
 */
function mapContentTypes(raw: unknown): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) return []
  return raw
    .map((v) => (typeof v === 'string' ? v : String(v ?? '')))
    .filter((s) => s.length > 0)
}

export function mapLiveMetrics(raw: unknown): LiveMetrics | null {
  const parsed = parseJson<Record<string, unknown> | null>(raw, null)
  if (!parsed || typeof parsed !== 'object') return null
  const m: LiveMetrics = {
    views: asNullableNumber(parsed.views),
    likes: asNullableNumber(parsed.likes),
    comments: asNullableNumber(parsed.comments),
    shares: asNullableNumber(parsed.shares),
    saves: asNullableNumber(parsed.saves),
    reach: asNullableNumber(parsed.reach),
    impressions: asNullableNumber(parsed.impressions),
    engagementRate: asNullableNumber(parsed.engagementRate ?? parsed.engagement_rate),
  }
  if (Object.values(m).every((v) => v == null)) return null
  return m
}

export function rowToUser(row: Row): User {
  // Round 7.11: role is now a 3-value union. Anything we don't
  // recognise falls back to 'member' (the safest default — they
  // can see everything but can't manage other users).
  const rawRole = String(row.role ?? '')
  const role: User['role'] =
    rawRole === 'admin' ? 'admin'
    : rawRole === 'briefer' ? 'briefer'
    : 'member'
  return {
    id: asString(row.id),
    email: asString(row.email),
    name: asNullableString(row.name),
    role,
    workspaceId: asNullableString(row.workspace_id),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

export function rowToWorkspace(row: Row): Workspace {
  return {
    id: asString(row.id),
    ownerId: asString(row.owner_id),
    name: asString(row.name),
    color: asString(row.color) || '#8b5cf6',
    sortOrder: asNumber(row.sort_order, 0),
    facebookPageUrl: asNullableString(row.facebook_page_url),
    instagramPageUrl: asNullableString(row.instagram_page_url),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

/**
 * Round 7.2: stage validation relaxed.
 *
 * Pre-7.2 this function had an allow-list and silently rewrote any
 * unknown stage to 'brief'. With user-added custom columns now valid
 * (their stage_key is `cust_<...>`), we accept any non-empty string.
 *
 * The fallback to 'brief' is preserved for the empty / null case
 * (database integrity issue), but custom stage keys pass through.
 */
function safeStage(raw: unknown): string {
  const s = String(raw ?? '').trim()
  return s.length > 0 ? s : 'brief'
}

export function rowToJob(row: Row): Job {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    title: asString(row.title),
    description: asNullableString(row.description),
    stage: safeStage(row.stage),
    priority: asNumber(row.priority, 0),
    dueDate: asNullableIsoString(row.due_date),
    hashtags: asNullableString(row.hashtags),
    platform: asNullableString(row.platform),
    liveUrl: asNullableString(row.live_url),
    notes: asNullableString(row.notes),
    // Round 7.12: contentType is deprecated. The mapper returns
    // null even if the legacy column has data — the active field
    // is contentTypes (multi-select) below.
    contentType: null,
    contentTypes: mapContentTypes(row.content_types),
    briefUrl: asNullableString(row.brief_url),
    assetLinks: mapAssetLinks(row.asset_links_json),
    approvalStatus: mapApprovalStatus(row.approval_status),
    assignedTo: asNullableString(row.assigned_to),
    customFields: mapCustomFields(row.custom_fields_json),
    campaign: asNullableString(row.campaign),
    facebookLiveUrl: asNullableString(row.facebook_live_url),
    facebookPostId: asNullableString(row.facebook_post_id),
    instagramLiveUrl: asNullableString(row.instagram_live_url),
    postedAt: asNullableIsoString(row.posted_at),
    liveMetrics: mapLiveMetrics(row.live_metrics_json),
    lastMetricsFetchAt: asNullableIsoString(row.last_metrics_fetch_at),
    brieferDisplayName: asNullableString(row.briefer_display_name),
    brieferDisplayEmail: asNullableString(row.briefer_display_email),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

/**
 * Round 7.2: shape a `kanban_columns` row into the API-shaped
 * KanbanColumn. Used by both the GET endpoint and any code that needs
 * to splice updated columns into local state without a refetch.
 */
export function rowToKanbanColumn(row: Row): KanbanColumn {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    stageKey: asString(row.stage_key),
    label: asString(row.label),
    color: asString(row.color) || '#64748b',
    sortOrder: asNumber(row.sort_order, 0),
    isBuiltin: asBoolean(row.is_builtin, false),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

/**
 * Round 7.10 — JobComment mapper.
 *
 * Expects rows joined against `users` so the author's display
 * name / email come through alongside the comment row. The API
 * route does this JOIN once and feeds rows here. If author_id is
 * NULL (former user deleted), authorName and authorEmail come
 * back NULL too — the UI then renders a "Former user" placeholder
 * rather than crashing on missing data.
 *
 * Field name mapping:
 *   sql:  author_name (from users.name)   →  ts: authorName
 *   sql:  author_email (from users.email) →  ts: authorEmail
 */
export function rowToJobComment(row: Row): JobComment {
  const authorId = row.author_id == null ? null : asString(row.author_id)
  const authorName =
    row.author_name == null ? null : asString(row.author_name) || null
  const authorEmail =
    row.author_email == null ? null : asString(row.author_email) || null
  // Round 7.11: authorRole comes from the users JOIN. May be null
  // for legacy comments where the author was deleted (FK SET NULL).
  const rawRole = row.author_role == null ? null : String(row.author_role)
  const authorRole: JobComment['authorRole'] =
    rawRole === 'admin' ? 'admin'
    : rawRole === 'briefer' ? 'briefer'
    : rawRole === 'member' ? 'member'
    : null
  return {
    id: asString(row.id),
    jobId: asString(row.job_id),
    authorId,
    authorName,
    authorEmail,
    authorRole,
    displayName: asNullableString(row.display_name),
    displayEmail: asNullableString(row.display_email),
    parentId: asNullableString(row.parent_id),
    body: asString(row.body),
    edited: asBoolean(row.edited, false),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

/**
 * Round 7.11 — JobEdit mapper.
 *
 * Maps a single audit-log row into a UI-renderable JobEdit. The
 * row is expected to come straight from job_edits (no joins
 * needed — edited_by_name is snapshotted directly into the row).
 */
export function rowToJobEdit(row: Row): import('./types').JobEdit {
  const rawRole = String(row.edited_by_role ?? 'member')
  const editedByRole: import('./types').UserRole =
    rawRole === 'admin' ? 'admin'
    : rawRole === 'briefer' ? 'briefer'
    : 'member'
  return {
    id: asString(row.id),
    jobId: asString(row.job_id),
    fieldName: asString(row.field_name),
    oldValue: row.old_value == null ? null : String(row.old_value),
    newValue: row.new_value == null ? null : String(row.new_value),
    editedByUserId: row.edited_by_user_id == null ? null : asString(row.edited_by_user_id),
    editedByName: asString(row.edited_by_name) || 'Unknown',
    editedByRole,
    editedAt: asIsoString(row.edited_at),
  }
}

export function rowToMetricSnapshot(row: Row): MetricSnapshot {
  return {
    id: asString(row.id),
    jobId: asString(row.job_id),
    workspaceId: asString(row.workspace_id),
    platform: asNullableString(row.platform),
    capturedAt: asIsoString(row.captured_at),
    metrics: {
      views: asNullableNumber(row.views),
      likes: asNullableNumber(row.likes),
      comments: asNullableNumber(row.comments),
      shares: asNullableNumber(row.shares),
      saves: asNullableNumber(row.saves),
      reach: asNullableNumber(row.reach),
      impressions: asNullableNumber(row.impressions),
      engagementRate: asNullableNumber(row.engagement_rate),
    },
  }
}

export function rowToSetting(row: Row): AppSetting {
  return {
    key: asString(row.key) as SettingKey,
    value: asNullableString(row.value),
    updatedAt: asIsoString(row.updated_at),
  }
}
