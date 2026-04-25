import { cookies } from 'next/headers'

const COOKIE_NAME = 'contenthub_admin'

export async function isAdminAuthenticated() {
  const store = await cookies()
  return store.get(COOKIE_NAME)?.value === '1'
}

export async function setAdminAuthenticated() {
  const store = await cookies()
  store.set(COOKIE_NAME, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  })
}

export async function clearAdminAuthenticated() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}
