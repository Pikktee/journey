/**
 * Hinweis, dass eine Studio-Sitzung wahrscheinlich steht.
 *
 * Das echte Session-Cookie (`maptale_session`) ist httpOnly — JS kann es nicht
 * lesen. Ohne Hinweis würde studio.html bei jedem Wechsel von Entdecken →
 * Meine Touren den Boot-Splash zeigen, obwohl die Sitzung schon da ist.
 * Dieses Cookie ist nur ein UX-Hinweis (kein Sicherheitsmerkmal): Studio
 * zeigt die App-Shell sofort und klärt `/api/auth/me` im Hintergrund.
 */

export const SESSION_HINWEIS_COOKIE = 'maptale_dabei'

/** 30 Tage — deckungsgleich mit der Server-Session-Dauer. */
const MAX_AGE_S = 30 * 24 * 60 * 60

function cookieSuffix(): string {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  return `; Path=/; SameSite=Lax${secure}`
}

export function merkeAngemeldet(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_HINWEIS_COOKIE}=1; Max-Age=${MAX_AGE_S}${cookieSuffix()}`
}

export function vergesseAngemeldet(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_HINWEIS_COOKIE}=; Max-Age=0${cookieSuffix()}`
}

/** Ob der Hinweis-Cookie gesetzt ist (synchron, vor Modul-Boot lesbar). */
export function vermutlichAngemeldet(cookie = typeof document !== 'undefined' ? document.cookie : ''): boolean {
  const nadel = `${SESSION_HINWEIS_COOKIE}=`
  return cookie.split(';').some((teil) => teil.trim().startsWith(nadel))
}
