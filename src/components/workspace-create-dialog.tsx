"use client"

import { useEffect, useState } from 'react'
import type { Workspace } from '@/lib/types'

/**
 * Round 7.1 — modal for creating a new workspace.
 *
 * Replaces the inline name-only input that lived at the bottom of the
 * sidebar in earlier rounds. New workspaces collected the full
 * configuration up-front (Facebook page URL especially) so the user
 * doesn't need to immediately follow up with a ⚙ click to make
 * Facebook metric fetching work.
 *
 * Same shape as WorkspaceEditDialog (Round 6.4) but POSTs to
 * /api/workspaces instead of PATCHing /api/workspaces/:id. Could
 * theoretically share a base component; not worth the abstraction
 * cost for two callers.
 */
export function WorkspaceCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  /** Called with the freshly-created workspace so the parent can splice
   * it into local state without a refetch round-trip. */
  onCreated: (created: Workspace) => void
}) {
  // Default colour: Monday-style indigo, matching the new primary.
  // User can change it before saving.
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [facebookPageUrl, setFacebookPageUrl] = useState('')
  const [instagramPageUrl, setInstagramPageUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          color,
          facebookPageUrl: facebookPageUrl.trim() || null,
          instagramPageUrl: instagramPageUrl.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        setError(data?.error ?? `Create failed (${res.status})`)
        return
      }
      const data = (await res.json()) as { workspace: Workspace } | Workspace
      // /api/workspaces POST historically returned the workspace object
      // directly; defensively support both shapes.
      const created = 'workspace' in data ? data.workspace : (data as Workspace)
      onCreated(created)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Esc closes the modal — same UX contract as WorkspaceEditDialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] surface-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold">Create workspace</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            Set up the workspace and the page URLs the metric fetcher uses.
            Facebook fetching needs the page URL — you can add it later but
            adding it now means it works on the first try.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Name
            </span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
              placeholder="e.g. Acme Corp"
            />
          </label>

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
              its 50 most recent posts.
            </p>
          </label>

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
          </label>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
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
            {saving ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}
