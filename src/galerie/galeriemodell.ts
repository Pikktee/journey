// Datenmodell der öffentlichen Seiten (Galerie und Profil).
//
// DOM-frei und ohne Netzwerk-Aufruf, damit die Regeln prüfbar bleiben: welche
// Karte welchen Text trägt, wann ein Urheber genannt wird und wohin ein Klick
// führt. Die HTML-Seiten sind nur die Hülle darum.

import { handleAusPfad, pfad, profilPfad, tourPfad } from '../routen.js'

/** Eine Tour, wie der Server sie für die öffentlichen Seiten ausliefert. */
export interface GalerieTour {
  id: string
  titel: string | null
  cover: string | null
  /** Kachel-Fassung des Titelbilds; fehlt bei Touren ohne aufbereitete Fassungen */
  coverThumb?: string | null
  km: number | null
  erstelltAm: string
  autor: {
    anzeigename: string
    avatarUrl: string | null
    id?: string
    handle?: string | null
  } | null
}

export interface GalerieAntwort {
  touren: GalerieTour[]
  mehr: boolean
}

/** Anzeigefertige Karte. */
export interface Karte {
  id: string
  titel: string
  /**
   * Bild-URL oder null — die Hülle zeigt dann eine ruhige Fläche.
   *
   * Eine Karte ist ein paar hundert Pixel breit: Hier gehört die Kachel-Fassung
   * hin, nicht das Foto in Anzeigegröße. Fehlt sie (Tour von vor der
   * Aufbereitung), bleibt es beim großen Bild — sonst hätte die Karte gar keins.
   */
  cover: string | null
  /** „12,4 km · Juli 2026" — leer, wenn nichts davon bekannt ist */
  unterzeile: string
  autorName: string | null
  autorBild: string | null
  /** Link auf die Profilseite; null, wenn es keine öffentliche gibt */
  autorLink: string | null
  spielLink: string
}

/** Ohne Titel bleibt die Karte nicht namenlos. */
const ERSATZTITEL = 'Namenlose Reise'

/**
 * Link auf eine Profilseite — `/@henrik`, ersatzweise `/profil?id=…`.
 *
 * Die ID-Form ist der Rückfall für Konten ohne Handle (Antworten aus der Zeit
 * davor) und bleibt für immer bedienbar: Solche Links stehen in Mails und
 * Chats. Ohne freigegebenes Profil gibt es gar keinen Link.
 */
export function profilLink(autor: GalerieTour['autor']): string | null {
  if (autor?.handle) return profilPfad(autor.handle)
  if (autor?.id) return pfad('profil', `?id=${encodeURIComponent(autor.id)}`)
  return null
}

export function alsKarte(tour: GalerieTour): Karte {
  return {
    id: tour.id,
    titel: tour.titel?.trim() || ERSATZTITEL,
    cover: tour.coverThumb ?? tour.cover,
    unterzeile: [entfernung(tour.km), monat(tour.erstelltAm)].filter(Boolean).join(' · '),
    autorName: tour.autor?.anzeigename ?? null,
    autorBild: tour.autor?.avatarUrl ?? null,
    autorLink: profilLink(tour.autor),
    spielLink: tourPfad(`srv:${tour.id}`),
  }
}

export function alsKarten(antwort: GalerieAntwort): Karte[] {
  return antwort.touren.map(alsKarte)
}

/** „12,4 km"; unter 100 m ist die Angabe wertlos und entfällt. */
export function entfernung(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km) || km < 0.1) return ''
  return `${km.toFixed(1).replace('.', ',')} km`
}

/** „Juli 2026" — der Tag interessiert bei einer Rückschau nicht. */
export function monat(iso: string | null | undefined): string {
  if (!iso) return ''
  const datum = new Date(iso)
  if (Number.isNaN(datum.getTime())) return ''
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(datum)
}

/** Benutzer-ID aus der Adresse der Profilseite (?id=…). */
export function idAusAdresse(suchteil: string): string | null {
  return new URLSearchParams(suchteil).get('id')
}

/**
 * Wessen Profil gemeint ist — Handle aus dem Pfad (`/@henrik`) oder ID aus der
 * Query (`/profil?id=u_…`). Beides landet unverändert in der API-Adresse; die
 * Route dort unterscheidet sie am `u_`-Präfix.
 *
 * Der Pfad hat Vorrang: Steht ein Handle darin, ist ein zusätzliches `?id=`
 * bestenfalls Altlast eines kopierten Links.
 */
export function wenAusAdresse(pfadteil: string, suchteil: string): string | null {
  return handleAusPfad(pfadteil) ?? idAusAdresse(suchteil)
}
