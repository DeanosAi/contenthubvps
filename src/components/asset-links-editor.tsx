"use client"

import { useState } from 'react'
import type { AssetLink } from '@/lib/types'

/** Auto-detect link "type" from the URL host so we can show a helpful
 * label in the UI without making the user pick from a dropdown. Purely
 * cosmetic — the database column accepts anything. */
function detectLinkLabel(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('drive.google.com') || lower.includes('docs.google.com')) return 'Drive'
  if (lower.includes('dropbox.com')) return 'Dropbox'
  if (lower.includes('frame.io')) return 'Frame.io'
  if (lower.includes('sharepoint.com') || lower.includes('onedrive.com')) return 'SharePoint'
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube'
  if (lower.includes('vimeo.com')) return 'Vimeo'
  return 'Link'
}

function genId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `link_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

/** Reusable widget for adding/removing reference URLs on a job. URL-only
 * by design — the hosted app intentionally does not support uploading
 * raw files (that's what cloud storage links are for). */
export function AssetLinksEditor({
  links,
  onChange,
  compact = false,
}: {
  links: AssetLink[]
  onChange: (next: AssetLink[]) => void
  compact?: boolean
}) {
  const [draftLabel, setDraftLabel] = useState('')
  const [draftUrl, setDraftUrl] = useState('')

  function addLink() {
    const url = draftUrl.trim()
    if (!url) return
    const label = draftLabel.trim() || detectLinkLabel(url)
    onChange([...links, { id: genId(), label, url }])
    setDraftLabel('')
    setDraftUrl('')
  }

  function removeLink(id: string) {
    onChange(links.filter((l) => l.id !== id))
  }

  function updateLink(id: string, patch: Partial<AssetLink>) {
    onChange(links.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {links.length > 0 && (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <input
                  className="w-full bg-transparent text-sm font-medium border-0 outline-none p-0 mb-1"
                  value={link.label}
                  onChange={(e) => updateLink(link.id, { label: e.target.value })}
                  placeholder="Label"
                />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-[hsl(var(--primary))] truncate hover:underline"
                  title={link.url}
                >
                  {link.url}
                </a>
              </div>
              <button
                type="button"
                onClick={() => removeLink(link.id)}
                className="text-xs text-red-400 hover:text-red-300 px-2"
                aria-label="Remove link"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr,auto] gap-2">
        <div className="space-y-2">
          <input
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            placeholder="Display label (optional, auto-detected if blank)"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
          />
          <input
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            placeholder="https://drive.google.com/... or dropbox.com/..."
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLink()
              }
            }}
          />
        </div>
        <button
          type="button"
          className="self-end rounded-lg border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--accent))]"
          onClick={addLink}
          disabled={!draftUrl.trim()}
        >
          Add link
        </button>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Paste cloud URLs (Drive, Dropbox, SharePoint, frame.io, etc). Local files are not supported on the hosted app — store them in cloud storage and link here.
      </p>
    </div>
  )
}
