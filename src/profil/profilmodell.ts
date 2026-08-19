// Datenmodell der Profilseite — DOM-frei und ohne Netzwerk-Aufruf, damit die
// Regeln prüfbar bleiben: welcher Chip welche Zahl trägt, wohin ein Link führt,
// wann jemand sein eigenes Profil ansieht. Die Seite ist nur die Hülle darum
// (dieselbe Aufteilung wie galeriemodell.ts).

import { profilPfad } from '../routen.js'
import type { GalerieTour } from '../galerie/galeriemodell.js'

/** Die Antwort von `GET /api/benutzer/:wen/profil`. */
export interface ProfilAntwort {
  handle: string | null
  anzeigename: string | null
  bio: string | null
  ort: string | null
  /** Nackte Formen ohne Schema bzw. ohne `@` — der Server speichert sie so. */
  website: string | null
  instagram: string | null
  avatarUrl: string | null
  titelbildUrl: string | null
  /** ISO-Zeitpunkt der Registrierung; angezeigt wird nur der Monat. */
  dabeiSeit: string | null
  kennzahlen: Kennzahlen | null
  /** Nur wahr, wenn der Besitzer sein noch privates Profil ansieht. */
  nurFuerDich?: boolean
  touren: GalerieTour[]
}

export interface Kennzahlen {
  touren: number
  km: number
  hm: number
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
export function profilKopf(profil: ProfilAntwort): {
  name: string
  bio: string | null
  bild: string | null
  handle: string | null
  ort: string | null
  dabeiSeit: string
} {
  const anzeigename = profil.anzeigename?.trim()
  const handle = profil.handle ? `@${profil.handle}` : null
  return {
    name: anzeigename || handle || 'Ohne Namen',
    bio: profil.bio?.trim() || null,
    bild: profil.avatarUrl,
    handle: anzeigename ? handle : null,
    ort: profil.ort?.trim() || null,
    dabeiSeit: dabeiSeit(profil.dabeiSeit),
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
export function kennzahlChips(kennzahlen: Kennzahlen | null): KennzahlChip[] {
  if (!kennzahlen) return []
  const chips: KennzahlChip[] = []
  if (kennzahlen.touren > 0) {
    chips.push({
      art: 'touren',
      zahl: zahl(kennzahlen.touren),
      wort: kennzahlen.touren === 1 ? 'Tour' : 'Touren',
    })
  }
  if (kennzahlen.km >= 1)
    chips.push({ art: 'km', zahl: zahl(Math.round(kennzahlen.km)), wort: 'km unterwegs' })
  if (kennzahlen.hm >= 1)
    chips.push({ art: 'hm', zahl: zahl(Math.round(kennzahlen.hm)), wort: 'Höhenmeter' })
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
export function linkChips(profil: ProfilAntwort): LinkChip[] {
  const chips: LinkChip[] = []
  const web = profil.website?.trim()
  if (web) chips.push({ art: 'web', text: web, href: `https://${web}` })
  const insta = profil.instagram?.trim().replace(/^@/, '')
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
  profil: ProfilAntwort,
  eigenerHandle: string | null | undefined,
): boolean {
  if (!profil.handle || !eigenerHandle) return false
  return profil.handle.toLowerCase() === eigenerHandle.toLowerCase()
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
export function anfangsbuchstabe(profil: ProfilAntwort): string {
  const quelle = profil.anzeigename?.trim() || profil.handle?.trim() || ''
  return [...quelle][0]?.toUpperCase() ?? '·'
}
