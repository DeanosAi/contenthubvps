"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/**
 * Round 7.11 — briefer layout chrome.
 *
 * Provides:
 *   - A top bar with the workspace name + "Hi {displayName}" + actions
 *   - The mandatory "Who's using this account today?" prompt that gates
 *     the rest of the page until set
 *   - A "Switch user" link to re-prompt mid-session
 *   - A logout link
 *
 * Children are only rendered once the session has a displayName.
 * This is enforced client-side here AND server-side in the comments
 * + brief-submit endpoints, so the form is never visible (or
 * actionable) without identification.
 *
 * Note: this component does NOT do role checking. The page using it
 * (server component) calls requireBrieferPage() before rendering.
 * This is a presentational layer.
 */

interface BrieferSession {
  userId: string
  email: string
  role: 'admin' | 'member' | 'briefer'
  workspaceId: string | null
  displayName: string | null
  // Round 7.14: per-session email captured at the prompt. Null
  // means the prompt should fire to ask for it.
  displayEmail: string | null
}

interface Workspace {
  id: string
  name: string
  color: string
}

export function BrieferShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<BrieferSession | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)

  // "Who are you" prompt state. Open whenever we have a session
  // but no displayName/displayEmail, OR when the user explicitly
  // clicks "Switch user." Round 7.14: also open when email missing.
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptName, setPromptName] = useState('')
  const [promptEmail, setPromptEmail] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  async function loadSession() {
    setLoading(true)
    try {
      const [meRes, wsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/workspaces'),
      ])
      if (meRes.ok) {
        const m: BrieferSession = await meRes.json()
        setMe(m)
        // Round 7.14: prompt fires if EITHER name or email missing.
        // Old briefer JWTs (pre-7.14) will have name but no email,
        // so they get re-prompted on next page load. The prompt
        // pre-fills the existing name so the briefer doesn't have
        // to retype it — they just add the email and continue.
        if (!m.displayName || !m.displayEmail) {
          setPromptName(m.displayName ?? '')
          setPromptEmail(m.displayEmail ?? '')
          setPromptOpen(true)
        }
      }
      if (wsRes.ok) {
        const list: Workspace[] = await wsRes.json()
        // The /api/workspaces endpoint already filters to the
        // briefer's own workspace — there should be exactly one row.
        if (list[0]) setWorkspace(list[0])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSession()
  }, [])

  async function saveIdentity() {
    const name = promptName.trim()
    const email = promptEmail.trim()
    if (!name) {
      setPromptError('Please enter your name')
      return
    }
    if (!email) {
      setPromptError('Please enter your email')
      return
    }
    // Round 7.14: client-side regex matches the server-side check.
    // Catches obvious mistakes (no @, missing domain) without
    // pretending to be RFC-compliant.
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    if (!emailOk) {
      setPromptError('Please enter a valid email address')
      return
    }
    setPromptSaving(true)
    setPromptError(null)
    try {
      const res = await fetch('/api/auth/set-display-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, displayEmail: email }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setPromptError(j?.error || 'Failed to save name')
        return
      }
      // Refresh session so child components see the new identity.
      await loadSession()
      setPromptOpen(false)
      setPromptName('')
      setPromptEmail('')
    } finally {
      setPromptSaving(false)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-600">
        Loading…
      </main>
    )
  }

  // The Who-Are-You prompt blocks all interaction. We return JUST
  // the modal in this state — children are not rendered.
  const showChildren = me && me.displayName && !promptOpen

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {workspace && (
              <span
                className="inline-block h-6 w-6 rounded-md shrink-0"
                style={{ backgroundColor: workspace.color }}
              />
            )}
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Briefer portal</p>
              <h1 className="text-base font-semibold truncate">
                {workspace?.name ?? 'Content Hub'}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {me?.displayName && (
              <span className="hidden sm:inline text-slate-700">
                Hi, <span className="font-medium">{me.displayName}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setPromptName(me?.displayName ?? '')
                setPromptEmail(me?.displayEmail ?? '')
                setPromptOpen(true)
              }}
              className="text-xs text-indigo-700 hover:text-indigo-900 underline"
            >
              Switch user
            </button>
            <button
              type="button"
              onClick={logout}
              className="text-xs text-slate-600 hover:text-slate-900 underline"
            >
              Log out
            </button>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-4 pb-2 flex items-center gap-4 text-sm">
          <Link
            href="/briefer"
            className="text-slate-700 hover:text-indigo-700 py-1"
          >
            My briefs
          </Link>
          <Link
            href="/briefer/submit"
            className="text-slate-700 hover:text-indigo-700 py-1"
          >
            Submit a new brief
          </Link>
        </nav>
      </header>

      {/* Main content */}
      <div className="flex-1 max-w-5xl mx-auto w-full p-4 lg:p-6">
        {showChildren ? children : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            Please tell us who&apos;s using this account before continuing.
          </div>
        )}
      </div>

      {/* "Who are you" prompt */}
      {promptOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Who&apos;s using this account today?
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Your name and email are saved with anything you brief or
                comment on, so the team knows who they&apos;re talking to
                and can email you back directly. The login is shared by
                your venue, but the credit goes to you.
              </p>
            </div>
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">
                Your name
              </span>
              <input
                type="text"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !promptSaving) {
                    e.preventDefault()
                    void saveIdentity()
                  }
                }}
                placeholder="e.g. Sarah Mitchell"
                maxLength={80}
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-700 mb-1">
                Your email
              </span>
              <input
                type="email"
                value={promptEmail}
                onChange={(e) => setPromptEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !promptSaving) {
                    e.preventDefault()
                    void saveIdentity()
                  }
                }}
                placeholder="e.g. sarah@yourvenue.com"
                maxLength={200}
                inputMode="email"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="block text-[11px] text-slate-500 mt-1">
                Used so the team can email you back when they reply to
                your comments.
              </span>
            </label>
            {promptError && (
              <p className="text-sm text-red-700">{promptError}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              {/* If the user already has BOTH a displayName and a
                  displayEmail and is just re-prompting via Switch user,
                  give them a Cancel. If either is missing, no escape —
                  they must answer to use the page (Round 7.14: now
                  also gates on email being set). */}
              {me?.displayName && me?.displayEmail && (
                <button
                  type="button"
                  onClick={() => {
                    setPromptOpen(false)
                    setPromptName('')
                    setPromptEmail('')
                    setPromptError(null)
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
                  disabled={promptSaving}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={saveIdentity}
                disabled={
                  promptSaving ||
                  promptName.trim().length === 0 ||
                  promptEmail.trim().length === 0
                }
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 text-sm disabled:opacity-50"
              >
                {promptSaving ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
