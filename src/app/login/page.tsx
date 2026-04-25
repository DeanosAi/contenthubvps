"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) {
      setError(data.error || 'Login failed')
      return
    }
    router.push('/app')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border bg-[hsl(var(--card))] p-8 space-y-5">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-[hsl(var(--primary))]">Content Hub</p>
          <h1 className="text-3xl font-bold mt-2">Sign in</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-2">Hosted Content Hub admin access.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Email</label>
          <input className="w-full rounded-lg border bg-transparent px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-[hsl(var(--muted-foreground))]">Password</label>
          <input type="password" className="w-full rounded-lg border bg-transparent px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold py-2.5 disabled:opacity-60">
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
