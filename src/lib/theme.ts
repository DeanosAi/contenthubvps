/**
 * Theme management — Round 7.1.1.
 *
 * The Round 7.1 implementation relied on `:root:not(.theme-dark)` for
 * the default state, which produced mixed cascade outcomes when the
 * bootstrap script ran late or when Tailwind v4 reordered selectors.
 * 7.1.1 makes both themes explicit (`.theme-light` AND `.theme-dark`)
 * and the bootstrap unconditionally applies one of them.
 *
 * The user's choice persists in localStorage. SSR-safe.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'contenthub:theme'

/** Read the stored theme. Returns 'light' on the server and on first
 *  load when nothing's been saved. */
export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const v = window.localStorage.getItem(STORAGE_KEY)
  if (v === 'dark' || v === 'light') return v
  return 'light'
}

/** Persist + apply a theme. */
export function setTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

/** Apply (without persisting). Sets the theme class on <html>,
 *  removes whichever class shouldn't be active, so the cascade is
 *  always in a clean either/or state — never both, never neither. */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.remove('theme-light')
    root.classList.add('theme-dark')
  } else {
    root.classList.remove('theme-dark')
    root.classList.add('theme-light')
  }
}

/**
 * Inline script source to embed in <head> via dangerouslySetInnerHTML.
 * Runs synchronously before any rendering. Now applies the theme
 * class explicitly — even when nothing is saved, .theme-light is set
 * — so the cascade always has a definite theme to read from.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem('${STORAGE_KEY}');
    var theme = (saved === 'dark') ? 'dark' : 'light';
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add('theme-' + theme);
  } catch (e) {
    document.documentElement.classList.add('theme-light');
  }
})();
`
