// Single place that converts raw Postgres rows (snake_case columns,
// JSONB columns as already-parsed objects) into the camelCase domain
// types the rest of the app uses.

import type {
  AssetLink,
  ApprovalStatus,
  CustomField,
  CustomFieldType,
  Job,
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

/** Like asNumber but null-passthrough — for nullable integer columns
 * (views, likes, etc.) where "no data" is meaningfully different from "0". */
function asNullableNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
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

/** Postgres `jsonb` columns come back as already-parsed objects, but we
 * defensively also handle null and string. */
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

/** Coerce a raw `live_metrics_json` blob into the typed LiveMetrics shape.
 * Tolerant: missing fields become null. Returns null if the input is null
 * or an empty object. */
export function mapLiveMetrics(raw: unknown): LiveMetrics | null {
  const parsed = parseJson<Record<string, unknown> | null>(raw, null)
  if (!parsed || typeof parsed !== 'object') return null
  // Reject empty objects so the API doesn't return `liveMetrics: {everything null}`
  // when the column was just initialised with `{}`.
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
  // If every field is null, return null instead — saves callers from
  // having to check `if (m && Object.values(m).some(v => v != null))`.
  if (Object.values(m).every((v) => v == null)) return null
  return m
}

export function rowToUser(row: Row): User {
  return {
    id: asString(row.id),
    email: asString(row.email),
    name: asNullableString(row.name),
    role: row.role === 'admin' ? 'admin' : 'member',
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

export function rowToJob(row: Row): Job {
  return {
    id: asString(row.id),
    workspaceId: asString(row.workspace_id),
    title: asString(row.title),
    description: asNullableString(row.description),
    stage: ((): Job['stage'] => {
      const allowed: Job['stage'][] = ['brief', 'production', 'ready', 'posted', 'archive']
      const s = String(row.stage ?? 'brief')
      return (allowed as string[]).includes(s) ? (s as Job['stage']) : 'brief'
    })(),
    priority: asNumber(row.priority, 0),
    dueDate: asNullableIsoString(row.due_date),
    hashtags: asNullableString(row.hashtags),
    platform: asNullableString(row.platform),
    liveUrl: asNullableString(row.live_url),
    notes: asNullableString(row.notes),
    contentType: asNullableString(row.content_type),
    briefUrl: asNullableString(row.brief_url),
    assetLinks: mapAssetLinks(row.asset_links_json),
    approvalStatus: mapApprovalStatus(row.approval_status),
    assignedTo: asNullableString(row.assigned_to),
    customFields: mapCustomFields(row.custom_fields_json),
    facebookLiveUrl: asNullableString(row.facebook_live_url),
    facebookPostId: asNullableString(row.facebook_post_id),
    instagramLiveUrl: asNullableString(row.instagram_live_url),
    postedAt: asNullableIsoString(row.posted_at),
    liveMetrics: mapLiveMetrics(row.live_metrics_json),
    lastMetricsFetchAt: asNullableIsoString(row.last_metrics_fetch_at),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

/** Map a raw `metric_snapshots` row into the API-shaped MetricSnapshot. */
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
