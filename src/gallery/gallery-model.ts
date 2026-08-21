// Datenmodell der öffentlichen Seiten (Galerie und Profil).
//
// DOM-frei und ohne Netzwerk-Aufruf, damit die Regeln prüfbar bleiben: welche
// Karte welchen Text trägt, wann ein Urheber genannt wird und wohin ein Klick
// führt. Die HTML-Seiten sind nur die Hülle darum.

import { handleFromPath, path, profilePath, tourPath } from '../routes.js'

/** Eine Tour, wie der Server sie für die öffentlichen Seiten ausliefert. */
export interface GalleryTour {
  id: string
  title: string | null
  cover: string | null
  /** Kachel-Fassung des Titelbilds; fehlt bei Touren ohne aufbereitete Fassungen */
  coverThumb?: string | null
  km: number | null
  createdAt: string
  author: {
    displayName: string
    avatarUrl: string | null
    id?: string
    handle?: string | null
  } | null
}

export interface GalleryResponse {
  tours: GalleryTour[]
  hasMore: boolean
}

/** Anzeigefertige Karte. */
export interface TourCard {
  id: string
  title: string
  /**
   * Bild-URL oder null — die Hülle zeigt dann eine ruhige Fläche.
   *
   * Eine Karte ist ein paar hundert Pixel breit: Hier gehört die Kachel-Fassung
   * hin, nicht das Foto in Anzeigegröße. Fehlt sie (Tour von vor der
   * Aufbereitung), bleibt es beim großen Bild — sonst hätte die Karte gar keins.
   */
  cover: string | null
  /** „12,4 km · Juli 2026" — leer, wenn nichts davon bekannt ist */
  subline: string
  authorName: string | null
  authorImage: string | null
  /** Link auf die Profilseite; null, wenn es keine öffentliche gibt */
  authorLink: string | null
  playLink: string
}

/** Ohne Titel bleibt die Karte nicht namenlos. */
const FALLBACK_TITLE = 'Namenlose Reise'

/**
 * Link auf eine Profilseite — `/@henrik`, ersatzweise `/profil?id=…`.
 *
 * Die ID-Form ist der Rückfall für Konten ohne Handle (Antworten aus der Zeit
 * davor) und bleibt für immer bedienbar: Solche Links stehen in Mails und
 * Chats. Ohne freigegebenes Profil gibt es gar keinen Link.
 */
export function profileLink(author: GalleryTour['author']): string | null {
  if (author?.handle) return profilePath(author.handle)
  if (author?.id) return path('profile', `?id=${encodeURIComponent(author.id)}`)
  return null
}

export function toTourCard(tour: GalleryTour): TourCard {
  return {
    id: tour.id,
    title: tour.title?.trim() || FALLBACK_TITLE,
    cover: tour.coverThumb ?? tour.cover,
    subline: [formatDistanceKm(tour.km), formatMonth(tour.createdAt)].filter(Boolean).join(' · '),
    authorName: tour.author?.displayName ?? null,
    authorImage: tour.author?.avatarUrl ?? null,
    authorLink: profileLink(tour.author),
    playLink: tourPath(`srv:${tour.id}`),
  }
}

export function toTourCards(response: GalleryResponse): TourCard[] {
  return response.tours.map(toTourCard)
}

/** „12,4 km"; unter 100 m ist die Angabe wertlos und entfällt. */
export function formatDistanceKm(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km) || km < 0.1) return ''
  return `${km.toFixed(1).replace('.', ',')} km`
}

/** „Juli 2026" — der Tag interessiert bei einer Rückschau nicht. */
export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date)
}

/** Benutzer-ID aus der Adresse der Profilseite (?id=…). */
export function idFromUrl(search: string): string | null {
  return new URLSearchParams(search).get('id')
}

/**
 * Wessen Profil gemeint ist — Handle aus dem Pfad (`/@henrik`) oder ID aus der
 * Query (`/profil?id=u_…`). Beides landet unverändert in der API-Adresse; die
 * Route dort unterscheidet sie am `u_`-Präfix.
 *
 * Der Pfad hat Vorrang: Steht ein Handle darin, ist ein zusätzliches `?id=`
 * bestenfalls Altlast eines kopierten Links.
 */
export function handleOrIdFromUrl(pathname: string, search: string): string | null {
  return handleFromPath(pathname) ?? idFromUrl(search)
}
