"use client"

import { useEffect, useState } from 'react'

/**
 * Campaign-mode picker for the campaign report.
 *
 * Two controls:
 *   - Campaign dropdown: pulls campaigns from /api/workspaces/:id/campaigns
 *     (Round 6.1 endpoint), so it stays in sync with whatever's currently
 *     tagged.
 *   - "Full campaign" checkbox: when on, the date range from the existing
 *     filter bar is ignored; every post with the campaign tag is included
 *     regardless of when posted. Visually we grey out the date inputs
 *     (handled by the parent) so the user sees what's overridden.
 *
 * Date range comes from the existing filter bar at the top of /reports —
 * we don't duplicate that UI here. We just receive the values and forward
 * them on submit.
 */

export function ComparisonCampaignPicker({
  workspaceId,
  campaign,
  fullCampaign,
  fromIso,
  toIso,
  onChange,
  loading,
  resultCount,
}: {
  workspaceId: string
  campaign: string
  fullCampaign: boolean
  /** Echoed from the parent's filter bar; shown for clarity. */
  fromIso: string
  toIso: string
  onChange: (next: { campaign: string; fullCampaign: boolean }) => void
  loading: boolean
  /** Number of jobs the most recent fetch returned, for status display. */
  resultCount: number | null
}) {
  const [campaigns, setCampaigns] = useState<string[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)

  useEffect(() => {
    if (!workspaceId) {
      setCampaigns([])
      return
    }
    let cancelled = false
    ;(async () => {
      setCampaignsLoading(true)
      try {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/campaigns`,
        )
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as
          | { campaigns?: string[] }
          | null
        if (cancelled || !data?.campaigns) return
        setCampaigns(data.campaigns)
      } finally {
        if (!cancelled) setCampaignsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return (
    <div className="rounded-2xl border bg-white surface-shadow p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">By campaign</h3>
        <p className="text-xs text-slate-600 mt-1">
          Pick a campaign tag from this workspace. Posts in <code>posted</code>{' '}
          and <code>archive</code> stages with that tag will be compared.
        </p>
      </div>

      {!workspaceId ? (
        <p className="text-xs text-slate-600">
          Pick a workspace above to see its campaigns.
        </p>
      ) : campaignsLoading ? (
        <p className="text-xs text-slate-600">
          Loading campaigns…
        </p>
      ) : campaigns.length === 0 ? (
        <p className="text-xs text-slate-600">
          No campaigns tagged in this workspace yet. Tag posts with a campaign
          name in their detail panel to use this mode.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Campaign
            <select
              className="rounded-lg border bg-transparent px-3 py-2 text-sm"
              value={campaign}
              onChange={(e) =>
                onChange({ campaign: e.target.value, fullCampaign })
              }
            >
              <option value="">— Pick a campaign —</option>
              {campaigns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Date scope
            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="full-campaign-toggle"
                checked={fullCampaign}
                onChange={(e) =>
                  onChange({ campaign, fullCampaign: e.target.checked })
                }
                className="h-4 w-4"
              />
              <label
                htmlFor="full-campaign-toggle"
                className="text-sm text-slate-900 select-none cursor-pointer"
              >
                Full campaign (ignore date range)
              </label>
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              {fullCampaign
                ? 'Date range is being ignored. Every post with this campaign tag will be included.'
                : fromIso && toIso
                ? `Filtering to ${fromIso} → ${toIso} (from the date inputs above).`
                : 'No date range applied — all posts with this campaign tag will be included.'}
            </p>
          </label>
        </div>
      )}

      {/* Status line */}
      {campaign && (
        <div className="text-xs text-slate-600 pt-2 border-t border-slate-300">
          {loading ? (
            'Loading campaign posts…'
          ) : resultCount == null ? (
            ' '
          ) : resultCount === 0 ? (
            <span className="text-amber-700">
              No posts found matching this campaign and scope.
            </span>
          ) : (
            <>
              <span className="font-semibold text-slate-900">
                {resultCount}
              </span>{' '}
              {resultCount === 1 ? 'post' : 'posts'} match. Comparison is
              rendered below.
            </>
          )}
        </div>
      )}
    </div>
  )
}
