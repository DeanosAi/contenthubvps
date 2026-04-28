"use client"

import { useEffect, useRef, useState } from 'react'
import type { JobComment } from '@/lib/types'

/**
 * Round 7.10 — comments thread component.
 *
 * Lives inside the job detail panel as a section. Self-contained:
 * fetches its own comments + session-me on mount, manages its own
 * post/edit/delete state. The parent doesn't need to do anything
 * beyond rendering <CommentsThread jobId={...} />.
 *
 * Permission UI:
 *   - Anyone authenticated sees the thread and can post.
 *   - Edit/delete buttons only show when the current user is the
 *     comment's author (edit) or the author OR admin (delete).
 *   - The server enforces the same rules; the UI just hides the
 *     buttons when there's nothing to click.
 *
 * Layout:
 *   - Composer textarea + Post button at the top.
 *   - Comments below, oldest-first (chronological — easier to follow
 *     an approval back-and-forth than newest-first).
 *   - Each comment row: avatar circle + author name + timestamp +
 *     edit/delete actions + body.
 *   - Empty state when zero comments.
 *
 * Why no real-time updates:
 *   - Polling would add load for a 5-person internal tool that
 *     doesn't have many concurrent viewers of the same job.
 *   - Closing & reopening the detail panel re-fetches anyway.
 *   - Adding websockets is a separate project.
 */

type SessionMe = {
  userId: string
  email: string
  role: 'admin' | 'member'
} | null

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.split('@')[0] || '?'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export function CommentsThread({ jobId }: { jobId: string }) {
  const [me, setMe] = useState<SessionMe>(null)
  const [comments, setComments] = useState<JobComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Composer state
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // Per-comment edit state — only one can be edited at a time
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Per-comment delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Initial load: who am I + the comments for this job
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/jobs/${encodeURIComponent(jobId)}/comments`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([meRes, commentsRes]) => {
        if (cancelled) return
        setMe(meRes ?? null)
        if (Array.isArray(commentsRes)) {
          setComments(commentsRes)
        } else {
          setError('Failed to load comments')
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load comments')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  async function postComment() {
    const body = draft.trim()
    if (body.length === 0 || posting) return
    setPosting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Post failed (${res.status})`)
        return
      }
      const created = (await res.json()) as JobComment
      setComments((cs) => [...cs, created])
      setDraft('')
      // After posting, blur the textarea so a tiny mobile keyboard
      // doesn't keep covering the new comment.
      composerRef.current?.blur()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed')
    } finally {
      setPosting(false)
    }
  }

  async function saveEdit(commentId: string) {
    const body = editDraft.trim()
    if (body.length === 0 || editSaving) return
    setEditSaving(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Edit failed (${res.status})`)
        return
      }
      const updated = (await res.json()) as JobComment
      setComments((cs) => cs.map((c) => (c.id === commentId ? updated : c)))
      setEditingId(null)
      setEditDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Edit failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteComment(commentId: string) {
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/comments/${encodeURIComponent(commentId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? `Delete failed (${res.status})`)
        return
      }
      setComments((cs) => cs.filter((c) => c.id !== commentId))
      setConfirmDeleteId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-3">
        Comments {comments.length > 0 && (
          <span className="text-slate-500 normal-case tracking-normal font-normal">
            · {comments.length}
          </span>
        )}
      </h3>

      {/* Composer */}
      <div className="rounded-lg border border-slate-300 bg-white overflow-hidden mb-4">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl-Enter to submit. Plain Enter inserts a newline
            // because comments often span multiple lines.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void postComment()
            }
          }}
          placeholder="Add a comment…"
          rows={2}
          maxLength={5000}
          className="w-full px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none resize-y min-h-[60px]"
          disabled={posting}
        />
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50">
          <span className="text-[10px] text-slate-500">
            ⌘/Ctrl+Enter to post
          </span>
          <button
            type="button"
            onClick={postComment}
            disabled={posting || draft.trim().length === 0}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 mb-3 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Comments list */}
      {loading ? (
        <p className="text-sm text-slate-600">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          No comments yet. Use this thread for approval feedback or
          revision notes — the description field stays clean.
        </p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const isAuthor = me?.userId === c.authorId
            const isAdmin = me?.role === 'admin'
            const canEdit = isAuthor
            const canDelete = isAuthor || isAdmin
            const isEditing = editingId === c.id
            const displayName =
              c.authorName?.trim() ||
              c.authorEmail ||
              (c.authorId === null ? 'Former user' : 'Unknown')

            return (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                {/* Avatar */}
                <span
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold shrink-0 ${
                    c.authorId === null
                      ? 'bg-slate-200 text-slate-500'
                      : 'bg-indigo-100 text-indigo-700'
                  }`}
                  title={displayName}
                  aria-hidden="true"
                >
                  {initialsFor(c.authorName, c.authorEmail)}
                </span>

                <div className="flex-1 min-w-0">
                  {/* Header row: name + time + actions */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {displayName}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatTimestamp(c.createdAt)}
                      {c.edited && ' · edited'}
                    </span>

                    {/* Spacer that pushes actions to the right when there's room */}
                    <span className="flex-1" />

                    {/* Edit / delete actions */}
                    {!isEditing && (canEdit || canDelete) && (
                      <span className="flex items-center gap-2 text-[11px]">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(c.id)
                              setEditDraft(c.body)
                              setConfirmDeleteId(null)
                            }}
                            className="text-slate-500 hover:text-indigo-700"
                          >
                            edit
                          </button>
                        )}
                        {canDelete && confirmDeleteId !== c.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(c.id)
                              setEditingId(null)
                            }}
                            className="text-slate-500 hover:text-red-700"
                          >
                            delete
                          </button>
                        )}
                        {canDelete && confirmDeleteId === c.id && (
                          <>
                            <button
                              type="button"
                              onClick={() => deleteComment(c.id)}
                              disabled={deleting}
                              className="text-red-700 font-semibold hover:underline disabled:opacity-50"
                            >
                              {deleting ? 'deleting…' : 'delete?'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-slate-500 hover:underline"
                            >
                              cancel
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Body or edit form */}
                  {isEditing ? (
                    <div className="mt-2 rounded-lg border border-slate-300 bg-white overflow-hidden">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault()
                            void saveEdit(c.id)
                          }
                          if (e.key === 'Escape') {
                            setEditingId(null)
                            setEditDraft('')
                          }
                        }}
                        rows={3}
                        maxLength={5000}
                        className="w-full px-3 py-2 text-sm text-slate-900 focus:outline-none resize-y min-h-[60px]"
                        disabled={editSaving}
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null)
                            setEditDraft('')
                          }}
                          className="text-xs text-slate-700 hover:underline"
                          disabled={editSaving}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(c.id)}
                          disabled={editSaving || editDraft.trim().length === 0}
                          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">
                      {c.body}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
