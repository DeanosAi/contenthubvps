"use client"

import { useEffect, useState } from 'react'

/** Slim user shape used by assignee dropdowns. The /api/users endpoint
 * returns this for non-admins (omitting role). Admins get role too — we
 * just don't need it here. */
export interface UserOption {
  id: string
  email: string
  name: string | null
}

// Module-level cache — once fetched per page load, reused across components.
// Cleared on any window event the parent triggers; for the moment the only
// way to invalidate is to reload the page, which is fine for Round 2.
let cachedUsers: UserOption[] | null = null
let inFlight: Promise<UserOption[]> | null = null

async function fetchUsers(): Promise<UserOption[]> {
  if (cachedUsers) return cachedUsers
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/users')
      if (!res.ok) return []
      const data: UserOption[] = await res.json()
      cachedUsers = Array.isArray(data) ? data : []
      return cachedUsers
    } catch {
      return []
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Force-clear the cache. Call after creating, deleting, or updating a user
 * so dropdowns pick up the change without a full page reload. */
export function invalidateUsersCache(): void {
  cachedUsers = null
}

export function useUsers(): { users: UserOption[]; loading: boolean } {
  const [users, setUsers] = useState<UserOption[]>(cachedUsers ?? [])
  const [loading, setLoading] = useState(cachedUsers == null)

  useEffect(() => {
    let cancelled = false
    if (cachedUsers) {
      setUsers(cachedUsers)
      setLoading(false)
      return
    }
    setLoading(true)
    fetchUsers().then((u) => {
      if (cancelled) return
      setUsers(u)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { users, loading }
}
