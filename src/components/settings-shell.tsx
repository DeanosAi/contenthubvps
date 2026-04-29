"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HostedSidebar } from '@/components/hosted-sidebar'
import type { Workspace, SettingKey, User } from '@/lib/types'
import { invalidateUsersCache } from '@/lib/use-users'

/** Settings page. Three sections:
 *
 *   1. Branding — app/company name, logo URL, accent color. Stored in
 *      app_settings (key/value). All signed-in users can view; only
 *      admins can save.
 *
 *   2. Defaults — pre-fills for new jobs (default platform, stage, sort).
 *      Same gating as above.
 *
 *   3. Users — admins can list/create/delete teammates. Members see a
 *      "you don't have permission to manage users" stub.
 *
 * The shell intentionally fetches all sections' data on mount in parallel
 * so the page renders fully populated rather than tile-by-tile. */

interface SettingsMap {
  [key: string]: string | null
}

type SessionMe = {
  userId: string
  email: string
  role: 'admin' | 'member' | 'briefer'
  workspaceId: string | null
  displayName: string | null
} | null

const SETTING_KEYS: SettingKey[] = [
  'app.name',
  'app.companyName',
  'app.logoUrl',
  'app.accentColor',
  'jobs.defaultPlatform',
  'jobs.defaultStage',
  'jobs.defaultSort',
  'jobs.archivedVisibility',
  'apify.token',
]

export function SettingsShell() {
  // ---- workspaces (sidebar) ----
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('')

  // ---- settings (drafts) ----
  const [settings, setSettings] = useState<SettingsMap>({})
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  // ---- users ----
  const [users, setUsers] = useState<User[]>([])
  const [me, setMe] = useState<SessionMe>(null)

  // ---- new-user form ----
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState<'admin' | 'member' | 'briefer'>('member')
  // Round 7.11: workspace binding for briefer accounts. NULL/empty
  // for staff. Required if role === 'briefer'.
  const [newUserWorkspaceId, setNewUserWorkspaceId] = useState<string>('')
  const [creatingUser, setCreatingUser] = useState(false)

  // ---- ux ----
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const isAdmin = me?.role === 'admin'

  async function loadAll() {
    const [wsRes, settingsRes, usersRes, meRes] = await Promise.all([
      fetch('/api/workspaces'),
      fetch('/api/settings'),
      fetch('/api/users'),
      fetch('/api/auth/me'),
    ])

    if (wsRes.ok) {
      const ws: Workspace[] = await wsRes.json()
      setWorkspaces(ws)
      if (!selectedWorkspaceId && ws[0]) setSelectedWorkspaceId(ws[0].id)
    }
    if (settingsRes.ok) {
      const s: SettingsMap = await settingsRes.json()
      setSettings(s)
    }
    if (usersRes.ok) {
      const u: User[] = await usersRes.json()
      setUsers(u)
    }
    if (meRes.ok) {
      const m: SessionMe = await meRes.json()
      setMe(m)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patchSetting(key: SettingKey, value: string | null) {
    setSettings((s) => ({ ...s, [key]: value }))
    setSettingsDirty(true)
  }

  async function saveSettings() {
    if (!isAdmin) return
    setSavingSettings(true)
    setErrorMessage(null)
    setStatusMessage(null)
    const updates = SETTING_KEYS.map((key) => ({
      key,
      value: settings[key] ?? null,
    }))
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setSavingSettings(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErrorMessage(j?.error || 'Failed to save settings')
      return
    }
    setSettingsDirty(false)
    setStatusMessage('Settings saved.')
    setTimeout(() => setStatusMessage(null), 3000)
  }

  async function createUser() {
    if (!isAdmin) return
    if (!newUserEmail.trim() || !newUserPassword.trim()) {
      setErrorMessage('Email and password are required')
      return
    }
    if (newUserPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters')
      return
    }
    // Round 7.11: briefer accounts require a workspace binding.
    if (newUserRole === 'briefer' && !newUserWorkspaceId) {
      setErrorMessage('Select a workspace (venue) for the briefer account')
      return
    }
    setCreatingUser(true)
    setErrorMessage(null)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newUserEmail.trim(),
        name: newUserName.trim() || undefined,
        password: newUserPassword,
        role: newUserRole,
        workspaceId: newUserRole === 'briefer' ? newUserWorkspaceId : null,
      }),
    })
    setCreatingUser(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErrorMessage(j?.error || 'Failed to create user')
      return
    }
    invalidateUsersCache()
    setNewUserEmail('')
    setNewUserName('')
    setNewUserPassword('')
    setNewUserRole('member')
    setNewUserWorkspaceId('')
    await loadAll()
    setStatusMessage('User created.')
    setTimeout(() => setStatusMessage(null), 3000)
  }

  async function deleteUser(user: User) {
    if (!isAdmin) return
    if (user.id === me?.userId) {
      setErrorMessage('You cannot delete your own account')
      return
    }
    if (!confirm(`Remove ${user.name || user.email} from the team?`)) return
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErrorMessage(j?.error || 'Failed to remove user')
      return
    }
    invalidateUsersCache()
    await loadAll()
  }

  async function changeUserRole(user: User, role: 'admin' | 'member') {
    if (!isAdmin) return
    if (user.id === me?.userId && role !== 'admin') {
      setErrorMessage('You cannot remove your own admin role')
      return
    }
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErrorMessage(j?.error || 'Failed to update user')
      return
    }
    await loadAll()
  }

  async function resetUserPassword(user: User) {
    if (!isAdmin) return
    const newPwd = prompt(
      `Set a new password for ${user.email}. They'll use this to sign in next.`,
      '',
    )
    if (newPwd == null) return
    if (newPwd.length < 8) {
      setErrorMessage('Password must be at least 8 characters')
      return
    }
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPwd }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErrorMessage(j?.error || 'Failed to reset password')
      return
    }
    setStatusMessage(`Password reset for ${user.email}. Share the new password with them via Teams.`)
    setTimeout(() => setStatusMessage(null), 6000)
  }

  // ---- workspace mutations (passed to sidebar) ----
  async function createWorkspace(name: string) {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: '#8b5cf6' }),
    })
    if (!res.ok) return setErrorMessage('Failed to create workspace')
    await loadAll()
  }
  async function renameWorkspace(id: string, name: string) {
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return setErrorMessage('Failed to rename workspace')
    await loadAll()
  }
  async function deleteWorkspace(id: string) {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    if (!res.ok) return setErrorMessage('Failed to delete workspace')
    if (selectedWorkspaceId === id) setSelectedWorkspaceId('')
    await loadAll()
  }
  async function reorderWorkspaces(orderedIds: string[]) {
    const prev = workspaces
    const byId = new Map(prev.map((w) => [w.id, w]))
    const reordered: Workspace[] = []
    for (const id of orderedIds) {
      const w = byId.get(id)
      if (w) reordered.push(w)
    }
    setWorkspaces(reordered.map((w, i) => ({ ...w, sortOrder: i })))
    const res = await fetch('/api/workspaces/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
    if (!res.ok) {
      setWorkspaces(prev)
      setErrorMessage('Failed to reorder workspaces')
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen p-4 lg:p-8 bg-slate-100 text-slate-900">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6 max-w-[1600px] mx-auto">
        <HostedSidebar
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={setSelectedWorkspaceId}
          onCreateWorkspace={createWorkspace}
          onRenameWorkspace={renameWorkspace}
          onDeleteWorkspace={deleteWorkspace}
          onReorderWorkspaces={reorderWorkspaces}
          onWorkspaceUpdated={(updated) => {
            setWorkspaces((prev) =>
              prev.map((w) => (w.id === updated.id ? updated : w)),
            )
          }}
          onWorkspaceCreated={(created) => {
            setWorkspaces((prev) => [...prev, created])
            setSelectedWorkspaceId(created.id)
          }}
        />

        <main className="space-y-6 min-w-0">
          <section className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
              <p className="text-slate-600 mt-2 max-w-3xl">
                Branding, defaults, and team. {isAdmin
                  ? 'Changes here affect the whole team.'
                  : 'Read-only — only admins can change settings.'}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/app"
                className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-3 py-2 text-sm transition-colors"
              >
                Back to dashboard
              </Link>
              <button
                className="rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 px-4 py-2 text-sm transition-colors"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          </section>

          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
              <span>{errorMessage}</span>
              <button className="text-xs underline" onClick={() => setErrorMessage(null)}>
                Dismiss
              </button>
            </div>
          )}
          {statusMessage && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {statusMessage}
            </div>
          )}

        {/* ---- Branding ---- */}
        <section className="rounded-2xl border border-slate-200 bg-white surface-shadow p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Branding</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Used on the PDF reports header and the sign-in screen.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <SettingInput
              label="App name"
              value={settings['app.name'] ?? ''}
              onChange={(v) => patchSetting('app.name', v || null)}
              placeholder="Content Hub"
              disabled={!isAdmin}
            />
            <SettingInput
              label="Company name"
              value={settings['app.companyName'] ?? ''}
              onChange={(v) => patchSetting('app.companyName', v || null)}
              placeholder="Your agency or business name"
              disabled={!isAdmin}
            />
            <SettingInput
              label="Logo URL"
              value={settings['app.logoUrl'] ?? ''}
              onChange={(v) => patchSetting('app.logoUrl', v || null)}
              placeholder="https://… (a square PNG works best)"
              disabled={!isAdmin}
            />
            <SettingInput
              label="Accent color"
              type="color"
              value={settings['app.accentColor'] ?? '#6366f1'}
              onChange={(v) => patchSetting('app.accentColor', v)}
              disabled={!isAdmin}
            />
          </div>
        </section>

        {/* ---- Integrations ---- */}
        <section className="rounded-2xl border border-slate-200 bg-white surface-shadow p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Integrations</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Third-party services Content Hub talks to on your behalf. Tokens
              are stored on the server only and never sent to the browser
              after they're saved.
            </p>
          </div>
          <div className="space-y-3">
            <SettingInput
              label="Apify token"
              value={settings['apify.token'] ?? ''}
              onChange={(v) => patchSetting('apify.token', v || null)}
              placeholder={
                isAdmin
                  ? 'apify_api_…'
                  : 'Hidden — only admins can view'
              }
              type="text"
              disabled={!isAdmin}
            />
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              Used by the metric fetcher to scrape Facebook and Instagram post
              metrics on demand. Get one at{' '}
              <a
                href="https://console.apify.com/account/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-[hsl(var(--primary))]"
              >
                console.apify.com → Integrations
              </a>
              . Without a token, the "Fetch metrics" buttons on posted jobs
              show an error and reports remain empty.
            </p>
          </div>
        </section>

        {/* ---- Defaults ---- */}
        <section className="rounded-2xl border border-slate-200 bg-white surface-shadow p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Defaults</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Pre-fills used when creating new jobs. Each user can override
              for a specific job.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <SettingSelect
              label="Default platform"
              value={settings['jobs.defaultPlatform'] ?? ''}
              onChange={(v) => patchSetting('jobs.defaultPlatform', v || null)}
              disabled={!isAdmin}
              options={[
                { value: '', label: '— No default —' },
                { value: 'instagram', label: 'instagram' },
                { value: 'facebook', label: 'facebook' },
                { value: 'tiktok', label: 'tiktok' },
                { value: 'youtube', label: 'youtube' },
              ]}
            />
            <SettingSelect
              label="Default starting stage"
              value={settings['jobs.defaultStage'] ?? 'brief'}
              onChange={(v) => patchSetting('jobs.defaultStage', v || null)}
              disabled={!isAdmin}
              options={[
                { value: 'brief', label: 'brief' },
                { value: 'production', label: 'production' },
                { value: 'ready', label: 'ready' },
              ]}
            />
            <SettingSelect
              label="Default kanban sort"
              value={settings['jobs.defaultSort'] ?? 'newest'}
              onChange={(v) => patchSetting('jobs.defaultSort', v || null)}
              disabled={!isAdmin}
              options={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'recentlyUpdated', label: 'Recently updated' },
                { value: 'dueDateAsc', label: 'Due date (soonest)' },
                { value: 'dueDateDesc', label: 'Due date (latest)' },
                { value: 'priorityDesc', label: 'Priority (highest)' },
                { value: 'priorityAsc', label: 'Priority (lowest)' },
              ]}
            />
          </div>
        </section>

        {isAdmin && (
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-50"
              onClick={saveSettings}
              disabled={savingSettings || !settingsDirty}
            >
              {savingSettings ? 'Saving…' : settingsDirty ? 'Save settings' : 'No changes'}
            </button>
          </div>
        )}

        {/* ---- Team ---- */}
        <section className="rounded-2xl border border-slate-200 bg-white surface-shadow p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold">Team</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {isAdmin
                  ? 'Add or remove teammates. Tell them their email + the password you set, and ask them to sign in at the login URL.'
                  : 'Members of your team. Only admins can change this.'}
              </p>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {users.length} {users.length === 1 ? 'user' : 'users'}
            </p>
          </div>

          {users.length === 0 ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">No users yet.</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 flex items-center gap-3 flex-wrap"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {u.name || u.email}
                      {u.id === me?.userId && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-[hsl(var(--primary))]">
                          you
                        </span>
                      )}
                    </p>
                    {u.name && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{u.email}</p>
                    )}
                  </div>
                  {isAdmin ? (
                    <>
                      {u.role === 'briefer' ? (
                        // Round 7.11: don't allow flipping a briefer
                        // to staff via this dropdown. Doing so would
                        // require coordinated workspace_id NULL'ing
                        // on the server. To reclassify, delete and
                        // recreate. Show a static badge instead.
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] text-amber-700">
                          briefer
                          {u.workspaceId && workspaces.find((w) => w.id === u.workspaceId) && (
                            <span className="text-amber-600">
                              · {workspaces.find((w) => w.id === u.workspaceId)?.name}
                            </span>
                          )}
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) =>
                            changeUserRole(u, e.target.value as 'admin' | 'member')
                          }
                          className="rounded-lg border bg-transparent px-2 py-1 text-xs"
                          disabled={u.id === me?.userId && u.role === 'admin'}
                        >
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => resetUserPassword(u)}
                        className="text-xs px-2 py-1 rounded border hover:bg-[hsl(var(--accent))]/40"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteUser(u)}
                        disabled={u.id === me?.userId}
                        className="text-xs px-2 py-1 rounded border text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                      {u.role}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Add a new teammate
              </h3>
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  className="rounded-lg border bg-transparent px-3 py-2 text-sm"
                  placeholder="Email"
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
                <input
                  className="rounded-lg border bg-transparent px-3 py-2 text-sm"
                  placeholder="Display name (optional)"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                />
                <input
                  className="rounded-lg border bg-transparent px-3 py-2 text-sm"
                  placeholder="Initial password (≥ 8 characters)"
                  type="text"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                />
                <select
                  className="rounded-lg border bg-transparent px-3 py-2 text-sm"
                  value={newUserRole}
                  onChange={(e) =>
                    setNewUserRole(e.target.value as 'admin' | 'member' | 'briefer')
                  }
                >
                  <option value="member">member (staff)</option>
                  <option value="admin">admin (staff)</option>
                  <option value="briefer">briefer (venue login)</option>
                </select>
                {/* Round 7.11: workspace picker — only shown when
                    creating a briefer. Required for that role; the
                    API rejects briefer-without-workspace. */}
                {newUserRole === 'briefer' && (
                  <select
                    className="rounded-lg border bg-transparent px-3 py-2 text-sm md:col-span-2"
                    value={newUserWorkspaceId}
                    onChange={(e) => setNewUserWorkspaceId(e.target.value)}
                  >
                    <option value="">Select workspace (venue)…</option>
                    {workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={createUser}
                  disabled={creatingUser}
                  className="rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold px-4 py-2 text-sm disabled:opacity-50"
                >
                  {creatingUser ? 'Creating…' : 'Add user'}
                </button>
              </div>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Tip: share the email + password with the teammate via Teams.
                {' '}For briefer accounts, this is the shared login the venue
                will use to access Content Hub.
              </p>
            </div>
          )}
        </section>
      </main>
      </div>
    </div>
  )
}

function SettingInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'color'
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
      {label}
      <input
        type={type}
        className={`rounded-lg border bg-transparent px-3 py-2 text-sm ${
          type === 'color' ? 'h-10 cursor-pointer' : ''
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  )
}

function SettingSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[hsl(var(--muted-foreground))]">
      {label}
      <select
        className="rounded-lg border bg-transparent px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
