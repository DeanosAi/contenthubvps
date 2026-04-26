// Apify metric fetcher — Round 6.4 verbatim port of the desktop app's
// Rust implementation. Earlier rounds (5, 6.3) tried to "improve" on
// the desktop's approach and got both Instagram and Facebook wrong.
// This file mirrors src-tauri/src/main.rs's behaviour line-for-line:
//
//   Instagram:
//     Actor: apify~instagram-post-scraper
//     Input: { username: [url], resultsLimit: 1 }   ← URL goes inside
//                                                     the `username` array
//     Read: likesCount, commentsCount, then
//           videoPlayCount FIRST, videoViewCount as fallback
//
//   Facebook (via-page, preferred when workspace.facebook_page_url is set):
//     Actor: apify~facebook-posts-scraper
//     Input: { startUrls: [{ url: page_url }], resultsLimit: 50,
//              onlyPostsNewerThan: '1970-01-01',
//              includeNestedComments: false }
//     Match the requested target post by URL or numeric reel/post ID
//     among the returned items.
//
//   Facebook (direct, fallback when no page URL is set):
//     Three sequential attempts against apify~facebook-posts-scraper:
//       1. raw URL
//       2. normalized URL (m./web. → www.)
//       3. with `directUrls` field added
//     Each attempt rejects "page-stub" responses where all metrics are
//     zero AND no item URL matches the request.
//
// Field-extraction is robust across actor schema variants — the desktop
// learned this the hard way and the helpers here cover every shape we
// know: flat numbers, nested feedback objects, arrays whose length IS
// the count, sum-of-flat-reactions for Facebook reels, etc.

import type { LiveMetrics } from './types'

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export interface FetchedMetrics {
  metrics: LiveMetrics
  /** Detected platform — 'instagram' | 'facebook'. */
  platform: 'instagram' | 'facebook'
  /** The specific Apify dataset item we picked. Stored as raw_json on
   * the metric_snapshot so we can debug after the fact. */
  raw: Record<string, unknown>
  /** When Facebook returns a numeric post id, surface it so the route
   * can cache it on the job. */
  facebookPostId: string | null
}

export type FetchError =
  | { kind: 'no-token'; message: string }
  | { kind: 'unsupported-platform'; message: string }
  | { kind: 'apify-error'; status: number; message: string }
  | { kind: 'no-data'; message: string }
  | { kind: 'timeout'; message: string }

export type FetchOutcome =
  | { ok: true; result: FetchedMetrics }
  | { ok: false; error: FetchError }

/**
 * Top-level entry point. Detects the platform from the URL, dispatches
 * to the right fetcher.
 *
 * `facebookPageUrl`, when provided, switches the Facebook path to the
 * via-page approach (scrape the workspace's page, match the target).
 * Pass null/undefined to use the direct-URL fallback.
 */
export async function fetchMetricsForUrl(
  url: string,
  apifyToken: string,
  facebookPageUrl: string | null = null,
): Promise<FetchOutcome> {
  if (!apifyToken) {
    return {
      ok: false,
      error: { kind: 'no-token', message: 'No Apify token configured.' },
    }
  }

  const platform = detectPlatform(url)
  if (platform === 'instagram') {
    return await fetchInstagramPost(url, apifyToken)
  }
  if (platform === 'facebook') {
    if (facebookPageUrl && facebookPageUrl.trim()) {
      return await fetchFacebookViaPage(url, apifyToken, facebookPageUrl.trim())
    }
    return await fetchFacebookDirect(url, apifyToken)
  }
  return {
    ok: false,
    error: {
      kind: 'unsupported-platform',
      message: `URL does not look like Instagram or Facebook: ${url}`,
    },
  }
}

function detectPlatform(url: string): 'instagram' | 'facebook' | 'unknown' {
  const u = url.toLowerCase()
  if (u.includes('instagram.com')) return 'instagram'
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook'
  return 'unknown'
}

// ---------------------------------------------------------------------
// Apify HTTP — uses run-sync-get-dataset-items (one-shot, blocking
// until the run finishes or hits the request timeout). Mirrors the
// desktop Rust client which uses the same endpoint.
// ---------------------------------------------------------------------

const APIFY_REQUEST_TIMEOUT_MS = 180_000 // 3 min — page scrapes can run long

interface RunResult {
  ok: true
  items: unknown[]
}

interface RunError {
  ok: false
  error: FetchError
}

/** POST to Apify's run-sync-get-dataset-items endpoint. Returns the
 * dataset items array on success, or a structured error otherwise. */
async function runApifyActor(
  actorId: string,
  apifyToken: string,
  input: unknown,
): Promise<RunResult | RunError> {
  const url =
    `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APIFY_REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('aborted')) {
      return {
        ok: false,
        error: {
          kind: 'timeout',
          message: `Apify request did not respond within ${
            APIFY_REQUEST_TIMEOUT_MS / 1000
          }s. The actor may be queued behind other runs; try again.`,
        },
      }
    }
    return {
      ok: false,
      error: { kind: 'apify-error', status: 0, message: `Apify request failed: ${msg}` },
    }
  }
  clearTimeout(timer)

  const bodyText = await res.text().catch(() => '')

  if (!res.ok) {
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: res.status,
        message: `Apify start failed (${res.status}): ${bodyText.slice(0, 500)}`,
      },
    }
  }

  // run-sync-get-dataset-items returns the dataset as a JSON ARRAY.
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: res.status,
        message: `Apify response was not JSON. First 300 chars: ${bodyText.slice(0, 300)}`,
      },
    }
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: {
        kind: 'apify-error',
        status: res.status,
        message: `Apify returned non-array response: ${typeof parsed}`,
      },
    }
  }
  return { ok: true, items: parsed }
}

// ---------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------

/**
 * Verbatim port of `fetch_instagram_metrics` in main.rs.
 *
 * The actor `apify~instagram-post-scraper` accepts the post URL inside
 * the `username` array. This is unintuitive — the actor was originally
 * profile-driven, but stuffing a full URL into the username array
 * triggers its single-post mode. The desktop discovered this and it
 * works reliably; rounds 5 and 6.3 missed it and produced wrong data.
 */
async function fetchInstagramPost(
  url: string,
  apifyToken: string,
): Promise<FetchOutcome> {
  const result = await runApifyActor('apify~instagram-post-scraper', apifyToken, {
    username: [url],
    resultsLimit: 1,
  })
  if (!result.ok) return { ok: false, error: result.error }

  if (result.items.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message:
          'No data returned from Instagram scraper. The post may be private, ' +
          'deleted, or the URL invalid.',
      },
    }
  }

  const first = result.items[0]
  if (typeof first !== 'object' || first === null) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Instagram actor returned a non-object item.',
      },
    }
  }
  const item = first as Record<string, unknown>

  // Mirror the desktop's exact field-extraction order:
  //   likes:    likesCount
  //   comments: commentsCount
  //   views:    videoPlayCount FIRST, then videoViewCount
  // Don't add other field-name candidates — the desktop tested these
  // and the priority matters; a different order returned wrong numbers
  // in earlier rounds.
  const likes = readU64(item, 'likesCount') ?? 0
  const comments = readU64(item, 'commentsCount') ?? 0
  const views =
    readU64(item, 'videoPlayCount') ?? readU64(item, 'videoViewCount') ?? 0
  const shares = 0 // Instagram doesn't expose share count via scraping

  // Engagement rate uses views as the denominator when available, else
  // falls back to a likes-based estimate. Desktop computes percentages
  // (likes+comments)/base * 100; we store the same number unscaled so
  // downstream (which expects rate as a fraction) divides by 100.
  const base = views > 0 ? views : likes * 10
  const engagementRate = base > 0 ? (likes + comments) / base : null

  const metrics: LiveMetrics = {
    views: views || null,
    likes,
    comments,
    shares: shares || null,
    saves: null,
    reach: null,
    impressions: null,
    engagementRate,
  }

  return {
    ok: true,
    result: {
      metrics,
      platform: 'instagram',
      raw: item,
      facebookPostId: null,
    },
  }
}

// ---------------------------------------------------------------------
// Facebook — shared parser
// ---------------------------------------------------------------------

const FACEBOOK_VIEWS_PATHS: string[][] = [
  ['viewsCount'],
  ['videoViewCount'],
  ['videoPlayCount'],
  ['playCount'],
  ['playCountRounded'],
  ['views'],
  ['plays'],
  ['video_play_count'],
  ['video_view_count'],
  ['video', 'views'],
  ['video', 'playCount'],
  ['statistics', 'views'],
  ['feedback', 'video_view_count'],
]

const FACEBOOK_LIKES_PATHS: string[][] = [
  ['likes'],
  ['likesCount'],
  ['likes_count'],
  ['reactionsCount'],
  ['reaction_count'],
  ['totalReactions'],
  ['statistics', 'likes'],
  ['feedback', 'reaction_count', 'count'],
  ['feedback', 'reaction_count'],
]

const FACEBOOK_COMMENTS_PATHS: string[][] = [
  ['comments'],
  ['commentsCount'],
  ['comments_count'],
  ['commentCount'],
  ['totalComments'],
  ['feedback', 'comment_count', 'total_count'],
  ['feedback', 'comment_count'],
  ['statistics', 'comments'],
]

const FACEBOOK_SHARES_PATHS: string[][] = [
  ['shares'],
  ['sharesCount'],
  ['shares_count'],
  ['shareCount'],
  ['totalShares'],
  ['feedback', 'share_count', 'count'],
  ['feedback', 'share_count'],
  ['statistics', 'shares'],
]

const FACEBOOK_REACTION_FIELDS = [
  'reactionLikeCount',
  'reactionLoveCount',
  'reactionHahaCount',
  'reactionWowCount',
  'reactionSadCount',
  'reactionAngryCount',
  'reactionCareCount',
] as const

/** Parse metrics out of one Facebook post item, trying every known
 * field-name variant. Direct port of `parse_post_metrics` in main.rs. */
function parseFacebookMetrics(item: Record<string, unknown>): LiveMetrics {
  const views = firstPathU64(item, FACEBOOK_VIEWS_PATHS) ?? 0

  // Likes can come from a single field, OR be the sum of flat
  // per-reaction counts (reactionLikeCount + reactionLoveCount + …),
  // OR live in a nested reactions object. Take whichever is largest.
  const flatReactionTotal = sumFlatReactions(item)
  const objectReactionTotal = Math.max(
    sumObjectU64(item['reactions']),
    sumObjectU64(item['reactionCount']),
  )
  const reactionFallback = Math.max(flatReactionTotal, objectReactionTotal)
  let likes = firstPathU64(item, FACEBOOK_LIKES_PATHS) ?? 0
  if (reactionFallback > likes) likes = reactionFallback

  const comments = firstPathCountOrLen(item, FACEBOOK_COMMENTS_PATHS) ?? 0
  const shares = firstPathCountOrLen(item, FACEBOOK_SHARES_PATHS) ?? 0

  const base = views > 0 ? views : Math.max(likes, 1)
  const engagementRate =
    base > 0 ? (likes + comments + shares) / base : null

  return {
    views: views || null,
    likes,
    comments,
    shares,
    saves: null,
    reach: null,
    impressions: null,
    engagementRate,
  }
}

/** Reject items that are zero across every metric AND don't match the
 * requested URL — those are page-lookup stubs, not real posts.
 * Direct port of `item_looks_like_real_post`. */
function itemLooksLikeRealPost(
  item: Record<string, unknown>,
  requestedUrl: string,
): boolean {
  const nonzero = (path: string[]): boolean => {
    const v = readPathU64(item, path)
    return v !== null && v > 0
  }

  const hasNonzeroLikes =
    nonzero(['likes']) ||
    nonzero(['likesCount']) ||
    nonzero(['reactionLikeCount'])
  const hasNonzeroViews =
    nonzero(['viewsCount']) ||
    nonzero(['playCount']) ||
    nonzero(['playCountRounded']) ||
    nonzero(['videoViewCount'])
  const hasNonzeroComments = nonzero(['comments']) || nonzero(['commentsCount'])
  const hasNonzeroShares = nonzero(['shares']) || nonzero(['sharesCount'])

  const hasText = readNonEmptyString(item, 'text') !== null
  const hasFeedbackId = readNonEmptyString(item, 'feedbackId') !== null
  const hasPostId =
    readNonEmptyString(item, 'postId') !== null ||
    readNonEmptyString(item, 'post_id') !== null

  const u1 = readString(item, 'url')
  const u2 = readString(item, 'topLevelUrl')
  const u3 = readString(item, 'shareable_url')
  const u4 = readString(item, 'topLevelReelUrl')
  const urlMatchesRequest =
    urlMatches(requestedUrl, u1) ||
    urlMatches(requestedUrl, u2) ||
    urlMatches(requestedUrl, u3) ||
    urlMatches(requestedUrl, u4)

  return (
    hasNonzeroLikes ||
    hasNonzeroViews ||
    hasNonzeroComments ||
    hasNonzeroShares ||
    hasText ||
    hasFeedbackId ||
    hasPostId ||
    urlMatchesRequest
  )
}

/** Try one Apify Facebook actor call. Mirrors `try_actor` in main.rs:
 *  - URL-match first (for page-wide scrapes)
 *  - else: first item that looks like a real post
 *  - else: first item, but reject if all-zero AND not a real post
 */
async function tryFacebookActor(
  apifyToken: string,
  input: unknown,
  requestedUrl: string,
): Promise<FetchOutcome> {
  const result = await runApifyActor(
    'apify~facebook-posts-scraper',
    apifyToken,
    input,
  )
  if (!result.ok) return { ok: false, error: result.error }

  if (result.items.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: `Facebook actor returned 0 items for ${requestedUrl}.`,
      },
    }
  }

  // Prefer URL-matched items (common when scraping a page that holds
  // the target post among others).
  const matched = result.items.find(
    (raw) => isObject(raw) && facebookItemMatchesUrl(raw, requestedUrl),
  )
  const realPost = result.items.find(
    (raw) => isObject(raw) && itemLooksLikeRealPost(raw, requestedUrl),
  )
  const chosen = (matched ?? realPost ?? result.items[0]) as unknown
  if (!isObject(chosen)) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message: 'Facebook actor returned a non-object item.',
      },
    }
  }
  const item = chosen as Record<string, unknown>

  const metrics = parseFacebookMetrics(item)
  const allZero =
    (metrics.views ?? 0) === 0 &&
    metrics.likes === 0 &&
    metrics.comments === 0 &&
    (metrics.shares ?? 0) === 0

  if (allZero && !itemLooksLikeRealPost(item, requestedUrl)) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message:
          `Facebook actor returned ${result.items.length} item(s) but none ` +
          `contain engagement data and none match the requested URL. ` +
          `Looks like a page-lookup stub, not a post record.`,
      },
    }
  }

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

// ---------------------------------------------------------------------
// Facebook via-page (preferred when workspace has a Facebook page URL)
// ---------------------------------------------------------------------

/**
 * Scrape the workspace's Facebook page, match the requested target post
 * by URL or post id among the recent posts, return its metrics.
 *
 * Direct port of `fetch_facebook_metrics_via_page` in main.rs. This is
 * the recommended path for direct reel URLs because the official
 * `apify/facebook-posts-scraper` only accepts page/profile URLs as
 * input — feeding it a single reel URL produces zero-engagement stubs.
 */
async function fetchFacebookViaPage(
  targetPostUrl: string,
  apifyToken: string,
  pageUrl: string,
): Promise<FetchOutcome> {
  const result = await runApifyActor(
    'apify~facebook-posts-scraper',
    apifyToken,
    {
      startUrls: [{ url: pageUrl }],
      resultsLimit: 50,
      onlyPostsNewerThan: '1970-01-01',
      includeNestedComments: false,
    },
  )
  if (!result.ok) return { ok: false, error: result.error }

  if (result.items.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message:
          `Page scrape of '${pageUrl}' returned 0 items. The page may not ` +
          `exist, be private, or require residential proxies on your Apify ` +
          `account.`,
      },
    }
  }

  const targetReelId = extractReelId(targetPostUrl)

  const matched = result.items.find((raw) => {
    if (!isObject(raw)) return false
    const item = raw as Record<string, unknown>
    if (facebookItemMatchesUrl(item, targetPostUrl)) return true
    if (targetReelId && facebookItemMatchesId(item, targetReelId)) return true
    return false
  }) as Record<string, unknown> | undefined

  if (!matched) {
    // Helpful error: list the first few URLs the scraper did return,
    // so the user can verify their target URL + page URL line up.
    const sampleUrls: string[] = []
    for (const raw of result.items.slice(0, 10)) {
      if (!isObject(raw)) continue
      const item = raw as Record<string, unknown>
      const u =
        readString(item, 'url') ||
        readString(item, 'topLevelUrl') ||
        readString(item, 'topLevelReelUrl')
      if (u) sampleUrls.push(u)
    }
    return {
      ok: false,
      error: {
        kind: 'no-data',
        message:
          `Scraped '${pageUrl}' (${result.items.length} items) but couldn't ` +
          `find a post matching '${targetPostUrl}'. ` +
          (sampleUrls.length > 0
            ? `First URLs returned: ${sampleUrls.slice(0, 3).join(', ')}. `
            : '') +
          `This usually means the post is older than the 50 most recent ` +
          `posts on the page, the page URL doesn't own this post, or the ` +
          `post has been deleted.`,
      },
    }
  }

  const metrics = parseFacebookMetrics(matched)
  return {
    ok: true,
    result: {
      metrics,
      platform: 'facebook',
      raw: matched,
      facebookPostId: extractFacebookPostId(matched),
    },
  }
}

// ---------------------------------------------------------------------
// Facebook direct (fallback when no workspace page URL is set)
// ---------------------------------------------------------------------

/**
 * Three sequential attempts against `apify~facebook-posts-scraper` for
 * a single target URL. Direct port of `fetch_facebook_metrics`. The
 * via-page path is preferred when a workspace Facebook page URL is
 * available; this is the fallback.
 */
async function fetchFacebookDirect(
  url: string,
  apifyToken: string,
): Promise<FetchOutcome> {
  const attempts: string[] = []

  // Attempt 1: raw URL
  const r1 = await tryFacebookActor(
    apifyToken,
    {
      startUrls: [{ url }],
      resultsLimit: 5,
      onlyPostsNewerThan: '1970-01-01',
      includeNestedComments: false,
    },
    url,
  )
  if (r1.ok) return r1
  attempts.push(`[1] raw URL: ${r1.error.message}`)

  // Attempt 2: normalized URL (m./web. → www.)
  const normalized = url
    .replace('://m.facebook.com/', '://www.facebook.com/')
    .replace('://web.facebook.com/', '://www.facebook.com/')
  if (normalized !== url) {
    const r2 = await tryFacebookActor(
      apifyToken,
      {
        startUrls: [{ url: normalized }],
        resultsLimit: 5,
        onlyPostsNewerThan: '1970-01-01',
        includeNestedComments: false,
      },
      normalized,
    )
    if (r2.ok) return r2
    attempts.push(`[2] normalized URL: ${r2.error.message}`)
  }

  // Attempt 3: with directUrls field added
  const r3 = await tryFacebookActor(
    apifyToken,
    {
      startUrls: [{ url }],
      directUrls: [url],
      resultsLimit: 5,
      onlyPostsNewerThan: '1970-01-01',
    },
    url,
  )
  if (r3.ok) return r3
  attempts.push(`[3] directUrls: ${r3.error.message}`)

  return {
    ok: false,
    error: {
      kind: 'no-data',
      message:
        `Facebook metrics fetch failed for ${url} after ${attempts.length} attempt(s). ` +
        `${attempts.join(' | ')}. ` +
        `Most common cause: the official 'apify/facebook-posts-scraper' actor ` +
        `only reliably accepts page/profile URLs, not direct reel URLs. ` +
        `Set a Facebook page URL on this workspace (Settings → workspace) ` +
        `so the metric fetcher can scrape the page and locate this post.`,
    },
  }
}

// ---------------------------------------------------------------------
// Facebook helpers — URL matching, ID extraction
// ---------------------------------------------------------------------

function facebookItemMatchesUrl(
  item: Record<string, unknown>,
  requestedUrl: string,
): boolean {
  const u1 = readString(item, 'url')
  const u2 = readString(item, 'topLevelUrl')
  const u3 = readString(item, 'shareable_url')
  const u4 = readString(item, 'topLevelReelUrl')
  return (
    urlMatches(requestedUrl, u1) ||
    urlMatches(requestedUrl, u2) ||
    urlMatches(requestedUrl, u3) ||
    urlMatches(requestedUrl, u4)
  )
}

function facebookItemMatchesId(
  item: Record<string, unknown>,
  targetId: string,
): boolean {
  const postId = readString(item, 'postId') || readString(item, 'post_id')
  if (postId && postId === targetId) return true

  // Also check whether any URL field's reel ID matches.
  for (const key of ['url', 'topLevelUrl', 'shareable_url', 'topLevelReelUrl']) {
    const u = readString(item, key)
    if (!u) continue
    const id = extractReelId(u)
    if (id && id === targetId) return true
  }
  return false
}

/** Loose URL comparison — strips protocol, m./www./web. prefixes,
 * trailing slashes, lowercases, then exact-or-substring match. */
function urlMatches(a: string, b: string | null): boolean {
  if (!b) return false
  const na = normalizeUrl(a)
  const nb = normalizeUrl(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function normalizeUrl(u: string): string {
  let s = u.trim().toLowerCase()
  if (s.startsWith('https://')) s = s.slice(8)
  else if (s.startsWith('http://')) s = s.slice(7)
  if (s.startsWith('www.')) s = s.slice(4)
  else if (s.startsWith('m.')) s = s.slice(2)
  else if (s.startsWith('web.')) s = s.slice(4)
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

/** Extract numeric id from /reel/{id}, /posts/{id}, or /videos/{id}. */
function extractReelId(url: string): string | null {
  const lower = url.toLowerCase()
  for (const segment of ['/reel/', '/posts/', '/videos/']) {
    const idx = lower.indexOf(segment)
    if (idx === -1) continue
    const rest = url.slice(idx + segment.length)
    let end = rest.length
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]
      if (c === '/' || c === '?' || c === '#') {
        end = i
        break
      }
    }
    const digits = rest
      .slice(0, end)
      .split('')
      .filter((c) => c >= '0' && c <= '9')
      .join('')
    if (digits) return digits
  }
  return null
}

function extractFacebookPostId(item: Record<string, unknown>): string | null {
  return (
    readString(item, 'postId') ||
    readString(item, 'post_id') ||
    readString(item, 'feedbackId') ||
    null
  )
}

// ---------------------------------------------------------------------
// JSON-walking primitives
// ---------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read a top-level u64. Coerces numbers, integer strings, and
 * non-negative floats. Returns null if missing or non-numeric. */
function readU64(obj: Record<string, unknown>, key: string): number | null {
  return coerceU64(obj[key])
}

function coerceU64(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.floor(v)
  }
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim()
    const n = Number(cleaned)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return null
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  return typeof v === 'string' ? v : null
}

function readNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = readString(obj, key)
  if (!v) return null
  return v.trim() ? v : null
}

/** Walk a path of keys into nested objects, then coerce the leaf to
 * u64. Returns null if any segment is missing or the leaf isn't
 * coercible. */
function readPathU64(value: unknown, path: string[]): number | null {
  let current: unknown = value
  for (const key of path) {
    if (!isObject(current)) return null
    current = current[key]
  }
  return coerceU64(current)
}

/** Try a list of paths, return the first one that yields a number. */
function firstPathU64(
  obj: Record<string, unknown>,
  paths: string[][],
): number | null {
  for (const p of paths) {
    const v = readPathU64(obj, p)
    if (v !== null) return v
  }
  return null
}

/** Like firstPathU64, but if the leaf is an array, return its length.
 * Facebook actors sometimes return comments/shares as arrays of entity
 * objects rather than a precounted number. */
function firstPathCountOrLen(
  obj: Record<string, unknown>,
  paths: string[][],
): number | null {
  for (const path of paths) {
    let current: unknown = obj
    let ok = true
    for (const key of path) {
      if (!isObject(current)) {
        ok = false
        break
      }
      current = current[key]
    }
    if (!ok) continue
    const num = coerceU64(current)
    if (num !== null) return num
    if (Array.isArray(current)) return current.length
  }
  return null
}

/** Sum the values of every numeric leaf in a one-level-deep object. */
function sumObjectU64(value: unknown): number {
  if (!isObject(value)) return 0
  let total = 0
  for (const v of Object.values(value)) {
    const n = coerceU64(v)
    if (n !== null) total += n
  }
  return total
}

/** Sum Facebook's flat reactionLikeCount/reactionLoveCount/etc fields. */
function sumFlatReactions(item: Record<string, unknown>): number {
  let total = 0
  for (const field of FACEBOOK_REACTION_FIELDS) {
    const n = readU64(item, field)
    if (n !== null) total += n
  }
  return total
}
