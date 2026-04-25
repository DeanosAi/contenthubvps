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
    // Redirect to the original target page (set by middleware) or to /app.
    router.push(next.startsWith('/') && !next.startsWith('//') ? next : '/app')
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border bg-[hsl(var(--card))] p-8 space-y-5">
      <div>
        <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--primary))]">Content Hub</p>
        <h1 className="text-3xl font-bold mt-2">Sign in</h1>
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
