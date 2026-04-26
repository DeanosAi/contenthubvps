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

// Round 6.3 fix: was 'apify~instagram-post-scraper', which is a PROFILE
// scraper requiring `username` as input. We need a SINGLE-POST-URL
// scraper, which is `apify~instagram-scraper` (no "-post-" in the name).
// That actor accepts `directUrls` containing a post or reel URL and
// returns one item per URL when `resultsType: 'posts'`.
const INSTAGRAM_POST_ACTOR = 'apify~instagram-scraper'

// Default timeout for a single actor run.
//
// Round 5 set this to 60s based on optimistic estimates. Round 6.3
// bumps it to 120s after seeing real-world Facebook runs routinely
// take 60-100s on the official actor (which scrapes the parent page
// even when given a single post URL — wasted work, but the only path
// that works at all without a community actor swap). Instagram runs
// usually finish in 15-30s so the higher cap doesn't slow them down,
// it just means Facebook actually completes instead of timing out.
const ACTOR_RUN_TIMEOUT_MS = 120_000

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
 * Facebook scraping has two known quirks worth documenting:
 *
 *   1. `apify~facebook-posts-scraper` is officially a PAGE scraper. When
 *      we hand it a single post URL via startUrls, the actor's actual
 *      behaviour is to scrape the parent page (slow — 60-100s on
 *      busy pages) and look for the matching post in the result set.
 *      That's why we set a low resultsLimit and use the page-wide
 *      ACTOR_RUN_TIMEOUT_MS of 120s. There isn't a cleaner Apify-official
 *      "single Facebook post by URL" actor as of this writing.
 *
 *   2. The actor sometimes returns a thin result on the first run (post
 *      id but no engagement counts). We work around this with a 25→50
 *      retry: ask for 25 items first, retry with 50 if metrics are
 *      missing. Inherited from the desktop app's pattern.
 *
 * If Facebook fetches feel too slow or unreliable in production, a
 * Round 6.4 follow-up could:
 *   - Switch to a community actor that explicitly accepts post URLs
 *     (riskier — they get unmaintained)
 *   - Use the workspace-level facebook_page_url + a page scraper, then
 *     match the requested post by id within recent posts
 */
async function fetchFacebookPost(
  url: string,
  apifyToken: string,
  options: { facebookRetryItems?: boolean } = {},
): Promise<FetchOutcome> {
  // First attempt: 25 items. The actor will scrape recent posts of the
  // parent page; resultsLimit caps how far back we look.
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
        message:
          'Facebook actor returned no items matching this post. The post ' +
          'may be too old to appear in the page\'s recent posts, the page ' +
          'may not be public, or Facebook may have rate-limited the scraper. ' +
          'Try again in a minute, or fetch a more recent post first.',
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
  // Input shape for `apify~instagram-scraper`. The key fields:
  //   - directUrls: an array containing the post or reel URL
  //   - resultsType: 'posts' so the actor returns one post item rather
  //     than a profile feed
  //   - resultsLimit: 1 — we only want the post we asked for
  //   - addParentData: false — saves time + dataset items by NOT also
  //     scraping the post's owner profile
  //   - searchType / searchLimit: required by the input schema even for
  //     URL-driven runs; defaults are accepted but explicit is safer
  const result = await runActorAndPoll(INSTAGRAM_POST_ACTOR, apifyToken, {
    directUrls: [url],
    resultsType: 'posts',
    resultsLimit: 1,
    addParentData: false,
    searchType: 'hashtag',
    searchLimit: 1,
    enhanceUserSearchWithFacebookPage: false,
    isUserReelFeedURL: false,
    isUserTaggedFeedURL: false,
  })
  if (!result.ok) return { ok: false, error: result.error }

  // Match the requested URL to the right item, in case the actor
  // returned more than one (e.g. for reels with related items).
  const item = pickBestInstagramItem(result.items, url)
  if (!item) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message:
          'Instagram actor returned no items for that URL. The post may be ' +
          'from a private account, or the URL may not be a public post/reel.',
      },
    }
  }
  const metrics = parseInstagramMetrics(item)
  return {
    ok: true,
    result: { metrics, platform: 'instagram', raw: item },
  }
}

/** Pick the item from an Instagram run's results that best matches the
 * requested URL. The actor can return multiple items for some inputs
 * (carousel posts, reels with related content); the requested post is
 * usually the first one but we match by URL/shortcode to be safe. */
function pickBestInstagramItem(
  items: unknown[],
  targetUrl: string,
): Record<string, unknown> | null {
  if (items.length === 0) return null
  const target = targetUrl.toLowerCase()

  // Pull the shortcode from the URL (instagram.com/p/{shortcode}/ or
  // /reel/{shortcode}/) for matching against the item's shortCode field.
  const shortcodeMatch = target.match(/\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i)
  const targetShortcode = shortcodeMatch ? shortcodeMatch[1].toLowerCase() : null

  // Best match: exact URL or shortcode.
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const itemUrl = String(item.url ?? item.postUrl ?? '').toLowerCase()
    if (itemUrl && itemUrl === target) return item
    if (targetShortcode) {
      const itemShortcode = String(item.shortCode ?? item.shortcode ?? '').toLowerCase()
      if (itemShortcode === targetShortcode) return item
    }
  }
  // Otherwise, the first item.
  const first = items[0]
  return typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)
    : null
}

function parseInstagramMetrics(item: Record<string, unknown>): LiveMetrics {
  // apify~instagram-scraper returns slightly different field names
  // depending on the post type (regular post, reel, video, carousel).
  // We try several candidates and take the first present.
  //
  // Notable: the scraper sometimes returns -1 for likesCount when the
  // post owner has hidden the like count. Treat -1 as "not available"
  // rather than 0.
  const views = pickNumber(item, [
    'videoViewCount',
    'videoPlayCount',
    'viewsCount',
    'videoViews',
    'playCount',
  ])
  const likes = pickPositiveNumber(item, ['likesCount', 'likes'])
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

/** Like pickNumber but treats negative values (e.g. Instagram's -1 for
 * "likes hidden by owner") as "not available" rather than a real number. */
function pickPositiveNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  const v = pickNumber(obj, keys)
  if (v == null) return null
  return v < 0 ? null : v
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
  //
  // Round 6.3 hardening:
  //   - Track consecutive status-fetch failures. Previous code silently
  //     `continue`d on every failure, meaning persistent network issues
  //     just looked like an indistinguishable timeout.
  //   - Capture the last-seen status. When we time out, the message
  //     now says "still RUNNING after 120s" instead of just "timeout",
  //     which tells the user whether the actor was actually working
  //     vs stuck in a queue.
  //   - Bug fix: previously a `break` out of the while loop would still
  //     fall through to `if (Date.now() >= deadline)` which was a no-op
  //     in the success case but the structure was confusing. Now we
  //     explicitly exit on success and the timeout check is unambiguous.
  const deadline = Date.now() + ACTOR_RUN_TIMEOUT_MS
  let lastSeenStatus: string | null = null
  let consecutiveStatusFailures = 0
  let succeeded = false
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const statusUrl = `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`
    const statusRes = await fetch(statusUrl).catch(() => null)
    if (!statusRes || !statusRes.ok) {
      consecutiveStatusFailures++
      // After ~30s of failed status checks (10 retries at 3s each),
      // give up rather than wait out the full timeout — the user will
      // get a faster, more accurate error.
      if (consecutiveStatusFailures >= 10) {
        return {
          ok: false,
          error: {
            kind: 'apify-error',
            status: statusRes?.status ?? 0,
            message:
              `Could not check Apify run status — ${consecutiveStatusFailures} ` +
              `consecutive failures. Last HTTP status: ${statusRes?.status ?? 'no response'}.`,
          },
        }
      }
      continue
    }
    consecutiveStatusFailures = 0
    const body = (await statusRes.json().catch(() => null)) as
      | { data?: { status?: string } }
      | null
    const status = body?.data?.status
    if (status) lastSeenStatus = status
    if (status === 'SUCCEEDED') {
      succeeded = true
      break
    }
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
  if (!succeeded) {
    return {
      ok: false,
      error: {
        kind: 'timeout',
        message:
          lastSeenStatus
            ? `Apify actor still ${lastSeenStatus} after ${ACTOR_RUN_TIMEOUT_MS / 1000}s. ` +
              `Run is still going on Apify's side; metrics may complete shortly. ` +
              `Try fetching this post again in a minute.`
            : `Apify actor did not start within ${ACTOR_RUN_TIMEOUT_MS / 1000}s. ` +
              `Could be a queue backlog on Apify's side.`,
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
