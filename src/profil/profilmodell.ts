// Datenmodell der Profilseite — DOM-frei und ohne Netzwerk-Aufruf, damit die
// Regeln prüfbar bleiben: welcher Chip welche Zahl trägt, wohin ein Link führt,
// wann jemand sein eigenes Profil ansieht. Die Seite ist nur die Hülle darum
// (dieselbe Aufteilung wie galeriemodell.ts).

import { profilPfad } from '../routen.js'
import type { GalerieTour } from '../galerie/galeriemodell.js'

/** Die Antwort von `GET /api/users/:id/profile`. */
export interface ProfilAntwort {
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
  stats: Kennzahlen | null
  /** Nur wahr, wenn der Besitzer sein noch privates Profil ansieht. */
  ownerOnly?: boolean
  tours: GalerieTour[]
}

export interface Kennzahlen {
  tours: number
  km: number
  elevationGain: number
}

/** Ein Chip unter dem Profilkopf. */
export interface KennzahlChip {
  /** Schlüssel für das Zeichen davor — die Hülle hält die SVG-Pfade. */
  art: 'touren' | 'km' | 'hm'
  /** Die Zahl allein, damit sie in der Anzeige fett stehen kann. */
  zahl: string
  /** Das Wort danach („Touren", „km unterwegs") */
  wort: string
}

/** Ein Link-Chip neben der Bio. */
export interface LinkChip {
  art: 'web' | 'instagram'
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
export function profilKopf(profile: ProfilAntwort): {
  name: string
  bio: string | null
  bild: string | null
  handle: string | null
  location: string | null
  memberSince: string
} {
  const anzeigename = profile.displayName?.trim()
  const handle = profile.handle ? `@${profile.handle}` : null
  return {
    name: anzeigename || handle || 'Ohne Namen',
    bio: profile.bio?.trim() || null,
    bild: profile.avatarUrl,
    handle: anzeigename ? handle : null,
    location: profile.location?.trim() || null,
    memberSince: dabeiSeit(profile.memberSince),
  }
}

/** „Dabei seit Juli 2026" — auf den Tag genau wäre es eine Angabe, die niemand braucht. */
export function dabeiSeit(iso: string | null | undefined): string {
  if (!iso) return ''
  const datum = new Date(iso)
  if (Number.isNaN(datum.getTime())) return ''
  return `Dabei seit ${new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(datum)}`
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
export function kennzahlChips(stats: Kennzahlen | null): KennzahlChip[] {
  if (!stats) return []
  const chips: KennzahlChip[] = []
  if (stats.tours > 0) {
    chips.push({
      art: 'touren',
      zahl: zahl(stats.tours),
      wort: stats.tours === 1 ? 'Tour' : 'Touren',
    })
  }
  if (stats.km >= 1)
    chips.push({ art: 'km', zahl: zahl(Math.round(stats.km)), wort: 'km unterwegs' })
  if (stats.elevationGain >= 1)
    chips.push({ art: 'hm', zahl: zahl(Math.round(stats.elevationGain)), wort: 'Höhenmeter' })
  return chips
}

/**
 * Tausender mit schmalem Leerraum: „1 240".
 *
 * Kein Punkt, weil derselbe Punkt in „12.4 km" das Komma vertritt und beide
 * Zahlen nebeneinander stehen. Das Zeichen ist U+202F (schmales geschütztes
 * Leerzeichen) — ein normales Leerzeichen bräche die Zahl am Zeilenende um.
 */
export function zahl(wert: number): string {
  return Math.round(wert)
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
export function linkChips(profile: ProfilAntwort): LinkChip[] {
  const chips: LinkChip[] = []
  const web = profile.website?.trim()
  if (web) chips.push({ art: 'web', text: web, href: `https://${web}` })
  const insta = profile.instagram?.trim().replace(/^@/, '')
  if (insta) {
    chips.push({
      art: 'instagram',
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
export function istEigenes(
  profile: ProfilAntwort,
  eigenerHandle: string | null | undefined,
): boolean {
  if (!profile.handle || !eigenerHandle) return false
  return profile.handle.toLowerCase() === eigenerHandle.toLowerCase()
}

/** Die Adresse, die der Teilen-Knopf weitergibt — vollständig, zum Vorlesen. */
export function profilAdresse(handle: string | null, herkunft: string): string {
  if (!handle) return herkunft
  return `${herkunft.replace(/\/+$/, '')}${profilPfad(handle)}`
}

/**
 * Der Anfangsbuchstabe für den Platzhalter-Avatar.
 *
 * Aus dem ANZEIGENAMEN, nicht aus dem Handle: Der Kreis steht direkt neben dem
 * Namen, und ein „t" neben „Reisende" sieht aus wie ein Fehler. Ohne Namen
 * bleibt der Handle die zweite Wahl, sonst ein neutrales Zeichen.
 */
export function anfangsbuchstabe(profile: ProfilAntwort): string {
  const quelle = profile.displayName?.trim() || profile.handle?.trim() || ''
  return [...quelle][0]?.toUpperCase() ?? '·'
}
