// Apify integration for the Content Hub SaaS.
//
// This module owns ALL knowledge of how to talk to Apify. The rest of
// the app (API routes, UI) calls one or two functions in here and gets
// back our normalised LiveMetrics shape. If Apify changes their API,
// or we swap providers entirely, this is the only file to change.
//
// We deliberately avoid the @apify/client SDK — it pulls in a lot of
// transitive dependencies for what is fundamentally two HTTP calls.
// Direct fetch() keeps the bundle small and the failure modes obvious.
//
// Cost note: at typical pricing, ~$0.001–0.003 per post scraped. 50
// posts × refresh weekly ≈ $0.10/week. Negligible for the use case.

import type { LiveMetrics } from './types'

// ---------------------------------------------------------------------
// Actor identifiers — these are Apify's public actor names. They've been
// stable for years; if Apify renames them we'll see a clean 404 from the
// API and can update here.
// ---------------------------------------------------------------------

const FACEBOOK_POST_ACTOR = 'apify~facebook-posts-scraper'
const INSTAGRAM_POST_ACTOR = 'apify~instagram-post-scraper'

// Default timeout for a single actor run. Apify's actors usually finish
// in 10-20s for a single URL but we allow 60s headroom because some
// posts trigger slow scraping paths.
const ACTOR_RUN_TIMEOUT_MS = 60_000

// How long to poll the run status before declaring it stuck. Apify
// recommends polling every 2-5s; we go with 3s.
const POLL_INTERVAL_MS = 3_000

// ---------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------

export interface FetchResult {
  /** What metrics were extracted, normalised to our shape. */
  metrics: LiveMetrics
  /** Platform identifier ('facebook' | 'instagram'). */
  platform: string
  /** Apify's raw item — preserved end-to-end so the snapshot endpoint
   * can store the full response under raw_json. If our extraction
   * later changes, we can re-derive from raw_json without re-fetching. */
  raw: unknown
  /** Optional Facebook post id if the actor surfaced it. Caching this
   * on the job lets future fetches skip the URL → post-id resolution. */
  facebookPostId?: string | null
}

export type FetchError =
  | { kind: 'no-token'; message: string }
  | { kind: 'apify-error'; status: number; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'no-data'; message: string }
  | { kind: 'invalid-url'; message: string }

export type FetchOutcome =
  | { ok: true; result: FetchResult }
  | { ok: false; error: FetchError }

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

/**
 * Fetch metrics for a single post URL. Detects platform from the URL
 * and dispatches to the appropriate Apify actor. Returns a normalised
 * result OR a structured error — never throws for known failure modes.
 */
export async function fetchMetricsForUrl(
  url: string,
  apifyToken: string,
  options: { facebookRetryItems?: boolean } = {},
): Promise<FetchOutcome> {
  if (!apifyToken || apifyToken.trim().length === 0) {
    return {
      ok: false,
      error: {
        kind: 'no-token',
        message:
          'No Apify token configured. An admin can set it under /settings → Branding.',
      },
    }
  }

  const platform = detectPlatform(url)
  if (!platform) {
    return {
      ok: false,
      error: {
        kind: 'invalid-url',
        message:
          `URL doesn't look like a Facebook or Instagram post. ` +
          `Supported: facebook.com/.../posts/..., instagram.com/p/..., instagram.com/reel/...`,
      },
    }
  }

  try {
    if (platform === 'facebook') {
      return await fetchFacebookPost(url, apifyToken, options)
    }
    return await fetchInstagramPost(url, apifyToken)
  } catch (err) {
    // Unexpected errors — bubble up as apify-error so the UI can show
    // something useful rather than a stack trace.
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: { kind: 'apify-error', status: 0, message: msg },
    }
  }
}

// ---------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------

function detectPlatform(url: string): 'facebook' | 'instagram' | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'web.facebook.com' || host === 'fb.com' || host === 'fb.watch') {
    return 'facebook'
  }
  if (host === 'instagram.com') {
    return 'instagram'
  }
  return null
}

// ---------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------

/**
 * Facebook scraping has a known quirk: the actor sometimes returns a
 * thin result on the first run (post id + no metrics). The desktop app
 * worked around this with a 25→50 retry pattern: ask for 25 items
 * first, retry with 50 if metrics are missing. We preserve that
 * behaviour here.
 */
async function fetchFacebookPost(
  url: string,
  apifyToken: string,
  options: { facebookRetryItems?: boolean } = {},
): Promise<FetchOutcome> {
  // First attempt: 25 items.
  const first = await runActorAndPoll(FACEBOOK_POST_ACTOR, apifyToken, {
    startUrls: [{ url }],
    resultsLimit: 25,
  })
  if (!first.ok) return { ok: false, error: first.error }

  const item = pickBestFacebookItem(first.items, url)
  if (!item) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Facebook actor returned no items for that URL.',
      },
    }
  }

  // If we got metrics, we're done.
  let metrics = parseFacebookMetrics(item)
  if (metricsAreSubstantive(metrics)) {
    return {
      ok: true,
      result: {
        metrics,
        platform: 'facebook',
        raw: item,
        facebookPostId: extractFacebookPostId(item),
      },
    }
  }

  // Retry with 50 items unless explicitly disabled (e.g. for tests).
  if (options.facebookRetryItems === false) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Facebook actor returned post but no metrics. (Retry disabled.)',
      },
    }
  }

  const second = await runActorAndPoll(FACEBOOK_POST_ACTOR, apifyToken, {
    startUrls: [{ url }],
    resultsLimit: 50,
  })
  if (!second.ok) return { ok: false, error: second.error }
  const retryItem = pickBestFacebookItem(second.items, url)
  if (!retryItem) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Facebook actor returned no items on retry.',
      },
    }
  }
  metrics = parseFacebookMetrics(retryItem)
  return {
    ok: true,
    result: {
      metrics,
      platform: 'facebook',
      raw: retryItem,
      facebookPostId: extractFacebookPostId(retryItem),
    },
  }
}

/** Pick the item from an Apify result list that matches the requested
 * URL most closely. Apify sometimes returns related posts; we want the
 * exact one. */
function pickBestFacebookItem(items: unknown[], targetUrl: string): Record<string, unknown> | null {
  if (items.length === 0) return null
  const target = targetUrl.toLowerCase()
  // Best match: exact URL match.
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const itemUrl = String(item.url ?? item.postUrl ?? item.facebookUrl ?? '').toLowerCase()
    if (itemUrl === target) return item
  }
  // Otherwise, the first item (Apify usually puts the requested post first).
  const first = items[0]
  return typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)
    : null
}

function parseFacebookMetrics(item: Record<string, unknown>): LiveMetrics {
  // Facebook actor field names have shifted historically; try several
  // candidates for each metric and take the first that's present.
  const views = pickNumber(item, ['viewsCount', 'videoViewCount', 'views'])
  const likes = pickNumber(item, ['likesCount', 'reactionsCount', 'likes'])
  const comments = pickNumber(item, ['commentsCount', 'comments'])
  const shares = pickNumber(item, ['sharesCount', 'shares'])
  // Facebook doesn't expose saves or reach via public scraping.
  const engagement = (likes ?? 0) + (comments ?? 0) + (shares ?? 0)
  const engagementRate =
    views != null && views > 0 ? engagement / views : null
  return {
    views,
    likes,
    comments,
    shares,
    saves: null,
    reach: null,
    impressions: null,
    engagementRate,
  }
}

function extractFacebookPostId(item: Record<string, unknown>): string | null {
  const id = item.postId ?? item.id ?? item.facebookId
  if (id == null) return null
  const s = String(id)
  return s.length > 0 ? s : null
}

// ---------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------

async function fetchInstagramPost(url: string, apifyToken: string): Promise<FetchOutcome> {
  const result = await runActorAndPoll(INSTAGRAM_POST_ACTOR, apifyToken, {
    directUrls: [url],
    resultsLimit: 1,
    addParentData: false,
  })
  if (!result.ok) return { ok: false, error: result.error }

  const first = result.items[0]
  if (typeof first !== 'object' || first === null) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Instagram actor returned no items for that URL.',
      },
    }
  }
  const item = first as Record<string, unknown>
  const metrics = parseInstagramMetrics(item)
  return {
    ok: true,
    result: { metrics, platform: 'instagram', raw: item },
  }
}

function parseInstagramMetrics(item: Record<string, unknown>): LiveMetrics {
  const views = pickNumber(item, ['videoViewCount', 'videoPlayCount', 'viewsCount'])
  const likes = pickNumber(item, ['likesCount', 'likes'])
  const comments = pickNumber(item, ['commentsCount', 'comments'])
  // IG doesn't expose shares via scraping; nor public saves.
  const engagement = (likes ?? 0) + (comments ?? 0)
  const engagementRate =
    views != null && views > 0 ? engagement / views : null
  return {
    views,
    likes,
    comments,
    shares: null,
    saves: null,
    reach: null,
    impressions: null,
    engagementRate,
  }
}

// ---------------------------------------------------------------------
// Apify HTTP machinery
// ---------------------------------------------------------------------

interface ActorRunResponse {
  ok: true
  items: unknown[]
}
interface ActorRunFailure {
  ok: false
  error: FetchError
}

/**
 * Synchronously start an Apify actor, poll until it finishes (or times
 * out), then fetch its dataset items.
 *
 * Why not the "run-sync" Apify endpoint: it returns the dataset directly
 * but doesn't let us inspect run state if something goes wrong. Polling
 * gives us cleaner error reporting at minimal cost.
 */
async function runActorAndPoll(
  actor: string,
  token: string,
  input: Record<string, unknown>,
): Promise<ActorRunResponse | ActorRunFailure> {
  // 1. Start the run.
  const startUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?token=${encodeURIComponent(token)}`
  let startRes: Response
  try {
    startRes = await fetch(startUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: 0,
        message: `Network error contacting Apify: ${err instanceof Error ? err.message : String(err)}`,
      },
    }
  }
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => '')
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: startRes.status,
        message: `Apify start failed (${startRes.status}): ${text.slice(0, 200)}`,
      },
    }
  }
  const startBody = await startRes.json().catch(() => null) as
    | { data?: { id?: string; defaultDatasetId?: string } }
    | null
  const runId = startBody?.data?.id
  const datasetId = startBody?.data?.defaultDatasetId
  if (!runId || !datasetId) {
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: 200,
        message: 'Apify start returned no run id or dataset id.',
      },
    }
  }

  // 2. Poll until SUCCEEDED, FAILED, or timeout.
  const deadline = Date.now() + ACTOR_RUN_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const statusUrl = `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`
    const statusRes = await fetch(statusUrl).catch(() => null)
    if (!statusRes || !statusRes.ok) continue
    const body = (await statusRes.json().catch(() => null)) as
      | { data?: { status?: string } }
      | null
    const status = body?.data?.status
    if (status === 'SUCCEEDED') break
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      return {
        ok: false,
        error: {
          kind: 'apify-error',
          status: 0,
          message: `Apify actor run finished with status ${status}.`,
        },
      }
    }
    // Otherwise keep polling (READY, RUNNING, etc).
  }
  if (Date.now() >= deadline) {
    return {
      ok: false,
      error: {
        kind: 'timeout',
        message: `Apify actor exceeded ${ACTOR_RUN_TIMEOUT_MS / 1000}s timeout.`,
      },
    }
  }

  // 3. Fetch dataset items.
  const itemsUrl = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(token)}&clean=true&format=json`
  const itemsRes = await fetch(itemsUrl).catch(() => null)
  if (!itemsRes || !itemsRes.ok) {
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: itemsRes?.status ?? 0,
        message: 'Could not fetch Apify dataset items.',
      },
    }
  }
  const items = (await itemsRes.json().catch(() => null)) as unknown[] | null
  if (!Array.isArray(items)) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Apify dataset response was not an array.',
      },
    }
  }
  return { ok: true, items }
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/** Find the first present numeric value across a list of candidate keys. */
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

/** True iff the metrics object contains at least one substantive value
 * (likes/views/etc). Used to decide whether to retry a fetch that came
 * back with everything null. */
function metricsAreSubstantive(m: LiveMetrics): boolean {
  return (
    (m.views ?? 0) > 0 ||
    (m.likes ?? 0) > 0 ||
    (m.comments ?? 0) > 0 ||
    (m.shares ?? 0) > 0
  )
}
