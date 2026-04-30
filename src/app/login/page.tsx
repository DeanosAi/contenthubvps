"use client"

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/app'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    let res: Response
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      setLoading(false)
      setError('Network error — please check your connection and try again.')
      return
    }
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) {
      setError(data?.error || 'Login failed')
      return
    }
    // Round 7.11: respect the role-based redirectTo from the API
    // response. If the user originally tried to access a specific
    // staff page (?next=...) AND they're staff, honour that.
    // For briefers, always go to /briefer regardless of ?next.
    const redirectTo: string =
      typeof data?.redirectTo === 'string' ? data.redirectTo : '/app'
    const isStaffTarget =
      redirectTo === '/app' &&
      next.startsWith('/') &&
      !next.startsWith('//') &&
      !next.startsWith('/briefer')
    const target = isStaffTarget ? next : redirectTo
    router.push(target)
  }

  return (
    <div className="w-full max-w-md space-y-5">
      {/* Round 7.18: full banner sits above the login card.
          Keeps the existing card layout intact; the banner is a
          separate hero element. The redundant "CONTENT HUB"
          label inside the form has been removed since the banner
          already brands the page. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/content-hub-banner.png"
        alt="Content Hub — Plan. Create. Publish."
        className="w-full h-auto block"
      />
      <form onSubmit={onSubmit} className="rounded-2xl border bg-[hsl(var(--card))] p-8 space-y-5">
        <div>
          <h1 className="text-3xl font-bold">Sign in</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2">Hosted Content Hub team access.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Email</label>
          <input
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-lg border bg-transparent px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border bg-transparent px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={loading}
          className="w-full rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold py-2.5 disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
