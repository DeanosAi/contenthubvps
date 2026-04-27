/**
 * Theme management — Round 7.1.
 *
 * The user's theme preference (light or dark) lives in localStorage so
 * it persists across sessions without hitting the server. A small
 * inline script in the app's <head> applies the saved choice before
 * paint, avoiding a flash of light theme when a dark-theme user
 * refreshes (or vice versa).
 *
 * 7.3 will extend this to include accent-colour selection from a
 * Settings page; the storage key is namespaced now so we can add
 * sibling preferences without colliding.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'contenthub:theme'

/** Read the stored theme. SSR-safe: returns 'light' on the server. */
export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const v = window.localStorage.getItem(STORAGE_KEY)
  if (v === 'dark' || v === 'light') return v
  return 'light'
}

/** Persist + apply a theme. Applies to <html> so the CSS cascade
 *  picks up the variable changes everywhere. */
export function setTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

/** Apply (without persisting) — used by the bootstrap script and the
 *  settings UI's preview. */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('theme-dark')
  else root.classList.remove('theme-dark')
}

/**
 * Inline script source to embed in <head> via dangerouslySetInnerHTML.
 * Runs synchronously before any rendering so the correct theme is
 * applied on first paint. Kept tiny — this is shipped raw to every
 * page load, so we minimise allocations and skip nice-to-haves.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'dark') {
      document.documentElement.classList.add('theme-dark');
    }
  } catch (e) {}
})();
`
