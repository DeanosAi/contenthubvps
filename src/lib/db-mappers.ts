// Single place that converts raw Postgres rows (snake_case columns,
// JSONB columns as already-parsed objects) into the camelCase domain
// types the rest of the app uses.
//
// Why this exists: previously app-shell.tsx mapped row → Job and
// row → Workspace inline at every call site. That pattern doesn't
// survive new fields being added — every consumer has to be updated
// in lockstep. Centralizing here means a new column added to the
// `jobs` table only needs to be wired up in one mapper plus the
// schema bootstrap.

import type {
  AssetLink,
  ApprovalStatus,
  Job,
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
 * defensively also handle null and string (just in case the column was
 * stored as TEXT during an older deploy). */
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

function mapApprovalStatus(v: unknown): ApprovalStatus {
  const allowed: ApprovalStatus[] = ['none', 'awaiting', 'approved', 'changes_requested']
  const s = String(v ?? 'none')
  return (allowed as string[]).includes(s) ? (s as ApprovalStatus) : 'none'
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
    facebookLiveUrl: asNullableString(row.facebook_live_url),
    facebookPostId: asNullableString(row.facebook_post_id),
    instagramLiveUrl: asNullableString(row.instagram_live_url),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  }
}

export function rowToSetting(row: Row): AppSetting {
  return {
    key: asString(row.key) as SettingKey,
    value: asNullableString(row.value),
    updatedAt: asIsoString(row.updated_at),
  }
}
