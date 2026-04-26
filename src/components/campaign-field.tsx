"use client"

import { useEffect, useState } from 'react'

/**
 * Campaign-name input with autocomplete suggestions sourced from the
 * current workspace's existing campaigns.
 *
 * Why <datalist> instead of a custom popover:
 *   - Native browser autocomplete: keyboard nav, screen reader support,
 *     accept-on-Tab — all of it works out of the box.
 *   - No portal / positioning gymnastics.
 *   - Free typing is the primary mode (you're often creating a NEW
 *     campaign, not picking an existing one), and <datalist> handles
 *     "type a value not in the list" without any extra logic.
 *
 * The fetch is keyed on workspaceId — when the user switches workspaces
 * (e.g. between two open detail panels), suggestions reload accordingly.
 *
 * Empty workspaceId (the rare "all workspaces" view) means we don't
 * fetch — there's no good per-workspace narrowing to do, and showing
 * mixed-workspace suggestions would be misleading.
 */
export function CampaignField({
  value,
  workspaceId,
  onChange,
  placeholder = 'e.g. Spring Launch 2026',
  disabled = false,
}: {
  value: string | null
  /** Workspace whose campaigns drive the suggestions. */
  workspaceId: string
  onChange: (next: string | null) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  // Stable id so multiple instances on one page don't share their
  // datalist (e.g. a list view + an open detail panel).
  const [listId] = useState(
    () => `campaign-suggestions-${Math.random().toString(36).slice(2, 9)}`,
  )

  useEffect(() => {
    if (!workspaceId) {
      setSuggestions([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/campaigns`,
        )
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as
          | { campaigns?: string[] }
          | null
        if (cancelled || !data?.campaigns) return
        setSuggestions(data.campaigns)
      } catch {
        // Soft-fail — suggestions are a nicety, not required for typing.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return (
    <>
      <input
        type="text"
        list={listId}
        className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        value={value ?? ''}
        onChange={(e) => {
          // Pass empty string back as null so the API stores NULL rather
          // than an empty-string campaign — matches the server-side
          // normaliseCampaign behaviour.
          const v = e.target.value
          onChange(v.length > 0 ? v : null)
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  )
}
