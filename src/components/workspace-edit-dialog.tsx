"use client"

import { useEffect, useState } from 'react'
import type { Workspace } from '@/lib/types'

/**
 * Edit dialog for a workspace's settings. Surfaces the fields Round 1
 * added to the schema (name, color, facebook_page_url,
 * instagram_page_url) but never had a UI for.
 *
 * The Facebook page URL is the important one — it switches the metric
 * fetcher to the via-page path, which is the only reliable way to get
 * Facebook reel metrics. Set this once per workspace and Facebook
 * "Fetch metrics" works for every reel/post owned by that page.
 *
 * The Instagram page URL is here for completeness and as a future hook
 * (the desktop app uses it for some refresh flows). The current Apify
 * lib doesn't use it for Instagram metric fetching — Instagram fetches
 * work post-by-post — but reserving the field means we don't have to
 * touch this dialog again when we add Instagram batch flows.
 */
export function WorkspaceEditDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace
  onClose: () => void
  onSaved: (updated: Workspace) => void
}) {
  const [name, setName] = useState(workspace.name)
  const [color, setColor] = useState(workspace.color)
  const [facebookPageUrl, setFacebookPageUrl] = useState(
    workspace.facebookPageUrl ?? '',
  )
  const [instagramPageUrl, setInstagramPageUrl] = useState(
    workspace.instagramPageUrl ?? '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when a different workspace is opened.
  useEffect(() => {
    setName(workspace.name)
    setColor(workspace.color)
    setFacebookPageUrl(workspace.facebookPageUrl ?? '')
    setInstagramPageUrl(workspace.instagramPageUrl ?? '')
    setError(null)
  }, [workspace.id, workspace.name, workspace.color, workspace.facebookPageUrl, workspace.instagramPageUrl])

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspace.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            color,
            // Empty string → null so the column is cleared properly.
            facebookPageUrl: facebookPageUrl.trim() || null,
            instagramPageUrl: instagramPageUrl.trim() || null,
          }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        setError(data?.error ?? `Save failed (${res.status})`)
        return
      }
      const data = (await res.json()) as { workspace: Workspace }
      onSaved(data.workspace)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Close on Escape — small QoL touch consistent with the rest of the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold">Workspace settings</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            Configure the workspace and the page URLs the metric fetcher uses.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Name */}
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              placeholder="Brand or workspace name"
            />
          </label>

          {/* Color */}
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Color
            </span>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 rounded border bg-transparent cursor-pointer"
                aria-label="Workspace color"
              />
              <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                {color}
              </span>
            </div>
          </label>

          {/* Facebook page URL — the important one */}
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Facebook page URL
            </span>
            <input
              type="url"
              value={facebookPageUrl}
              onChange={(e) => setFacebookPageUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              placeholder="https://www.facebook.com/yourbrandpage"
            />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-relaxed">
              Required for Facebook metric fetching. The fetcher scrapes
              this page and locates the post you&apos;re fetching among
              its 50 most recent posts. Without it, direct-URL fetches
              fail because Apify&apos;s Facebook actor only reliably
              accepts page URLs as input.
            </p>
          </label>

          {/* Instagram page URL */}
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Instagram page URL{' '}
              <span className="text-[10px] normal-case tracking-normal opacity-60">
                (optional)
              </span>
            </span>
            <input
              type="url"
              value={instagramPageUrl}
              onChange={(e) => setInstagramPageUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              placeholder="https://www.instagram.com/yourbrandhandle"
            />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-relaxed">
              Reserved for future use. Instagram metric fetching works
              per-post and doesn&apos;t need this; we save it for batch
              flows we may add later.
            </p>
          </label>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm hover:bg-[hsl(var(--accent))]/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
