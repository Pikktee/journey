/**
 * Hinweis, dass eine Studio-Sitzung wahrscheinlich steht.
 *
 * Das echte Session-Cookie (`maptale_session`) ist httpOnly — JS kann es nicht
 * lesen. Ohne Hinweis würde studio.html bei jedem Wechsel von Entdecken →
 * Meine Touren den Boot-Splash zeigen, obwohl die Sitzung schon da ist.
 * Dieses Cookie ist nur ein UX-Hinweis (kein Sicherheitsmerkmal): Studio
 * zeigt die App-Shell sofort und klärt `/api/auth/me` im Hintergrund.
 *
 * Öffentliche Seiten (Landing, Entdecken, Profil) setzen dasselbe Cookie und
 * die Klasse `nav-returning` auf `<html>`, damit die Gast-Nav („Anmelden") nicht
 * kurz aufblitzt, bevor `/me` antwortet.
 */

export const SESSION_NOTICE_COOKIE = 'maptale_returning'

/** Klasse auf `<html>` für öffentliche Seiten — deckungsgleich mit den Inline-Skripten. */
export const NAV_RETURNING_CLASS = 'nav-returning'

/** 30 Tage — deckungsgleich mit der Server-Session-Dauer. */
const MAX_AGE_S = 30 * 24 * 60 * 60

function cookieSuffix(): string {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  return `; Path=/; SameSite=Lax${secure}`
}

export const PROFILE_CACHE_KEY = 'maptale_profile_cache'

export type CachedProfile = {
  name: string
  initial: string
  avatarUrl?: string | null | undefined
}

export function rememberProfileCache(profile: CachedProfile): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
  } catch {}
}

export function forgetProfileCache(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch {}
}

export function readProfileCache(): CachedProfile | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    return raw ? (JSON.parse(raw) as CachedProfile) : null
  } catch {
    return null
  }
}

export function rememberSignedIn(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_NOTICE_COOKIE}=1; Max-Age=${MAX_AGE_S}${cookieSuffix()}`
  document.documentElement.classList.add(NAV_RETURNING_CLASS)
}

export function forgetSignedIn(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_NOTICE_COOKIE}=; Max-Age=0${cookieSuffix()}`
  document.documentElement.classList.remove(NAV_RETURNING_CLASS)
  forgetProfileCache()
}

/** Ob der Hinweis-Cookie gesetzt ist (synchron, vor Modul-Boot lesbar). */
export function probablySignedIn(
  cookie = typeof document !== 'undefined' ? document.cookie : '',
): boolean {
  const needle = `${SESSION_NOTICE_COOKIE}=`
  return cookie.split(';').some((part) => part.trim().startsWith(needle))
}
