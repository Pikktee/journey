// Datenmodell der Profilseite — DOM-frei und ohne Netzwerk-Aufruf, damit die
// Regeln prüfbar bleiben: welcher Chip welche Zahl trägt, wohin ein Link führt,
// wann jemand sein eigenes Profil ansieht. Die Seite ist nur die Hülle darum
// (dieselbe Aufteilung wie gallery-model.ts).

import { profilePath } from '../routes.js'
import type { GalleryTour } from '../gallery/gallery-model.js'

/** Die Antwort von `GET /api/users/:id/profile`. */
export interface ProfileResponse {
  handle: string | null
  displayName: string | null
  bio: string | null
  location: string | null
  /** Nackte Formen ohne Schema bzw. ohne `@` — der Server speichert sie so. */
  website: string | null
  instagram: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  /** ISO-Zeitpunkt der Registrierung; angezeigt wird nur der Monat. */
  memberSince: string | null
  stats: ProfileStats | null
  /** Nur wahr, wenn der Besitzer sein noch privates Profil ansieht. */
  ownerOnly?: boolean
  tours: GalleryTour[]
}

export interface ProfileStats {
  tours: number
  km: number
  elevationGain: number
}

/** Ein Chip unter dem Profilkopf. */
export interface StatChip {
  /** Schlüssel für das Zeichen davor — die Hülle hält die SVG-Pfade. */
  kind: 'tours' | 'km' | 'elevation'
  /** Die Zahl allein, damit sie in der Anzeige fett stehen kann. */
  value: string
  /** Das Wort danach („Touren", „km unterwegs") */
  label: string
}

/** Ein Link-Chip neben der Bio. */
export interface LinkChip {
  kind: 'web' | 'instagram'
  /** Was dasteht — die nackte Form, so wie sie eingetragen wurde. */
  text: string
  /** Wohin es geht — mit Schema, denn ein `href` ohne wäre ein relativer Pfad. */
  href: string
}

/**
 * Kopfzeile eines Profils.
 *
 * Ohne Anzeigenamen steht dort der HANDLE — er ist der Name, den diese Person
 * bereits hat, und er steht ohnehin in der Adresszeile. „Ohne Namen" war der
 * frühere Rückfall und beschrieb nicht die Person, sondern ein leeres
 * Datenbankfeld. Der Klarname aus der Registrierung bleibt weiter außen vor:
 * Wer sich mit seinem echten Namen anmeldet, veröffentlicht ihn damit nicht.
 *
 * Der Handle fällt dann aus dem Beiwerk heraus — zweimal `@henrik`
 * untereinander liest sich wie ein Fehler.
 */
export function profileHeading(profile: ProfileResponse): {
  name: string
  bio: string | null
  image: string | null
  handle: string | null
  location: string | null
  memberSince: string
} {
  const displayed = profile.displayName?.trim()
  const handle = profile.handle ? `@${profile.handle}` : null
  return {
    name: displayed || handle || 'Ohne Namen',
    bio: profile.bio?.trim() || null,
    image: profile.avatarUrl,
    handle: displayed ? handle : null,
    location: profile.location?.trim() || null,
    memberSince: memberSince(profile.memberSince),
  }
}

/** „Dabei seit Juli 2026" — auf den Tag genau wäre es eine Angabe, die niemand braucht. */
export function memberSince(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `Dabei seit ${new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date)}`
}

/**
 * Die Kennzahl-Chips.
 *
 * Ein Wert von 0 fällt heraus — „0 km unterwegs" unter einem frischen Profil
 * ist keine Auskunft, sondern ein Vorwurf. Die Tourenzahl bleibt trotzdem
 * stehen, sobald es überhaupt eine gibt: Sie erklärt das Raster darunter.
 *
 * Gezählt wird ausschließlich, was der Server geliefert hat — und der summiert
 * nur öffentliche Touren. Hier nachzurechnen (etwa aus `touren.length`) wäre
 * dasselbe Ergebnis auf einem Weg, den man versehentlich ändert.
 */
export function statChips(stats: ProfileStats | null): StatChip[] {
  if (!stats) return []
  const chips: StatChip[] = []
  if (stats.tours > 0) {
    chips.push({
      kind: 'tours',
      value: formatNumber(stats.tours),
      label: stats.tours === 1 ? 'Tour' : 'Touren',
    })
  }
  if (stats.km >= 1)
    chips.push({ kind: 'km', value: formatNumber(Math.round(stats.km)), label: 'km unterwegs' })
  if (stats.elevationGain >= 1)
    chips.push({
      kind: 'elevation',
      value: formatNumber(Math.round(stats.elevationGain)),
      label: 'Höhenmeter',
    })
  return chips
}

/**
 * Tausender mit schmalem Leerraum: „1 240".
 *
 * Kein Punkt, weil derselbe Punkt in „12.4 km" das Komma vertritt und beide
 * Zahlen nebeneinander stehen. Das Zeichen ist U+202F (schmales geschütztes
 * Leerzeichen) — ein normales Leerzeichen bräche die Zahl am Zeilenende um.
 */
export function formatNumber(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/**
 * Die Link-Chips neben der Bio.
 *
 * Der Server speichert nackt (`henrikheil.net`, `henrik.unterwegs`) — das ist
 * die Form, die dasteht. Das `href` bekommt sein Schema erst hier: Ohne wäre
 * `henrikheil.net` ein RELATIVER Pfad und der Link zeigte auf
 * `maptale.io/@henrik/henrikheil.net`.
 */
export function linkChips(profile: ProfileResponse): LinkChip[] {
  const chips: LinkChip[] = []
  const web = profile.website?.trim()
  if (web) chips.push({ kind: 'web', text: web, href: `https://${web}` })
  const insta = profile.instagram?.trim().replace(/^@/, '')
  if (insta) {
    chips.push({
      kind: 'instagram',
      text: `@${insta}`,
      href: `https://instagram.com/${encodeURIComponent(insta)}`,
    })
  }
  return chips
}

/**
 * Gehört dieses Profil der angemeldeten Person?
 *
 * Verglichen werden HANDLES, nicht die Adresszeile: Die Seite kann über
 * `?id=…` oder über einen aufgegebenen Handle erreicht worden sein, und in
 * beiden Fällen ist es trotzdem das eigene Profil. Ohne Anmeldung oder ohne
 * Handle auf einer der beiden Seiten ist die Antwort nein — ein „vielleicht"
 * gäbe es sonst als angebotenen Bearbeiten-Knopf, der nicht funktioniert.
 */
export function isOwn(profile: ProfileResponse, ownHandle: string | null | undefined): boolean {
  if (!profile.handle || !ownHandle) return false
  return profile.handle.toLowerCase() === ownHandle.toLowerCase()
}

/** Die Adresse, die der Teilen-Knopf weitergibt — vollständig, zum Vorlesen. */
export function profileAddress(handle: string | null, origin: string): string {
  if (!handle) return origin
  return `${origin.replace(/\/+$/, '')}${profilePath(handle)}`
}

/**
 * Der Anfangsbuchstabe für den Platzhalter-Avatar.
 *
 * Aus dem ANZEIGENAMEN, nicht aus dem Handle: Der Kreis steht direkt neben dem
 * Namen, und ein „t" neben „Reisende" sieht aus wie ein Fehler. Ohne Namen
 * bleibt der Handle die zweite Wahl, sonst ein neutrales Zeichen.
 */
export function avatarInitial(profile: ProfileResponse): string {
  const source = profile.displayName?.trim() || profile.handle?.trim() || ''
  return [...source][0]?.toUpperCase() ?? '·'
}
