"use client"

import { useEffect, useState } from 'react'
import type { Workspace } from '@/lib/types'

/**
 * Workspace edit dialog — Round 7.1.2.
 *
 * Hardcoded slate colours (no CSS variables) so the dialog cannot
 * render with invisible text regardless of theme state. Same treatment
 * as workspace-create-dialog.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const inputClass =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Workspace settings</h2>
          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
            Configure the workspace and the page URLs the metric fetcher uses.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-700">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={inputClass}
              placeholder="Brand or workspace name"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-700">
              Color
            </span>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 rounded border border-slate-300 bg-white cursor-pointer"
                aria-label="Workspace color"
              />
              <span className="text-xs text-slate-600 font-mono">
                {color}
              </span>
            </div>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-700">
              Facebook page URL
            </span>
            <input
              type="url"
              value={facebookPageUrl}
              onChange={(e) => setFacebookPageUrl(e.target.value)}
              className={inputClass}
              placeholder="https://www.facebook.com/yourbrandpage"
            />
            <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
              Required for Facebook metric fetching. The fetcher scrapes
              this page and locates the post you&apos;re fetching among
              its 50 most recent posts. Without it, direct-URL fetches
              fail because Apify&apos;s Facebook actor only reliably
              accepts page URLs as input.
            </p>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-700">
              Instagram page URL{' '}
              <span className="text-[10px] normal-case tracking-normal text-slate-500">
                (optional)
              </span>
            </span>
            <input
              type="url"
              value={instagramPageUrl}
              onChange={(e) => setInstagramPageUrl(e.target.value)}
              className={inputClass}
              placeholder="https://www.instagram.com/yourbrandhandle"
            />
            <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
              Reserved for future use. Instagram metric fetching works
              per-post and doesn&apos;t need this; we save it for batch
              flows we may add later.
            </p>
          </label>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-4 py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
