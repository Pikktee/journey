// Datenmodell der öffentlichen Seiten (Galerie und Profil).
//
// DOM-frei und ohne Netzwerk-Aufruf, damit die Regeln prüfbar bleiben: welche
// Karte welchen Text trägt, wann ein Urheber genannt wird und wohin ein Klick
// führt. Die HTML-Seiten sind nur die Hülle darum.

/** Eine Tour, wie der Server sie für die öffentlichen Seiten ausliefert. */
export interface GalerieTour {
  id: string
  titel: string | null
  cover: string | null
  km: number | null
  erstelltAm: string
  autor: { anzeigename: string; avatarUrl: string | null; id?: string } | null
}

export interface GalerieAntwort {
  touren: GalerieTour[]
  mehr: boolean
}

export interface ProfilAntwort {
  anzeigename: string | null
  bio: string | null
  avatarUrl: string | null
  touren: GalerieTour[]
}

/** Anzeigefertige Karte. */
export interface Karte {
  id: string
  titel: string
  /** Bild-URL oder null — die Hülle zeigt dann eine ruhige Fläche */
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

export function alsKarte(tour: GalerieTour): Karte {
  return {
    id: tour.id,
    titel: tour.titel?.trim() || ERSATZTITEL,
    cover: tour.cover,
    unterzeile: [entfernung(tour.km), monat(tour.erstelltAm)].filter(Boolean).join(' · '),
    autorName: tour.autor?.anzeigename ?? null,
    autorBild: tour.autor?.avatarUrl ?? null,
    autorLink: tour.autor?.id ? `/profil.html?id=${encodeURIComponent(tour.autor.id)}` : null,
    spielLink: `/erlebnis.html?tour=srv:${encodeURIComponent(tour.id)}`,
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
 * Kopfzeile eines Profils. Ohne Anzeigenamen bleibt die Seite bewusst
 * unpersönlich, statt Klarnamen oder E-Mail zu erfinden.
 */
export function profilKopf(profil: ProfilAntwort): { name: string; bio: string | null; bild: string | null } {
  return {
    name: profil.anzeigename?.trim() || 'Ohne Namen',
    bio: profil.bio?.trim() || null,
    bild: profil.avatarUrl,
  }
}
