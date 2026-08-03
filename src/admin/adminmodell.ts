// Rechnende Teile der Benutzerverwaltung — ohne DOM, damit sie prüfbar sind.
// Die Oberfläche (admin.ts) baut daraus nur noch Elemente.

import { pfad } from '../routen.js'

export type Rolle = 'nutzer' | 'admin'
export type EinladungsZustand = 'offen' | 'eingeloest' | 'abgelaufen'

export interface AdminBenutzer {
  id: string
  email: string
  name: string
  rolle: Rolle
  verifiziert: boolean
  angelegtAm: string
  anzeigename: string | null
  touren: number
  speicher: number
  /** In der Konfiguration als Admin gesetzt — Rolle und Konto sind unantastbar. */
  fest: boolean
}

export interface AdminEinladung {
  code: string
  notiz: string | null
  erstelltAm: string
  erstelltVon: string | null
  ablauf: string | null
  eingeloestAm: string | null
  eingeloestVon: string | null
  zustand: EinladungsZustand
}

export type WartelistenZustand = 'unbestaetigt' | 'wartend' | 'eingeladen'

export interface AdminWartender {
  id: string
  email: string
  /** Freiwillige Angabe des Anmelders — das Kriterium fürs gezielte Freischalten. */
  notiz: string | null
  eingetragenAm: string
  bestaetigtAm: string | null
  eingeladenAm: string | null
  eingeladenCode: string | null
  zustand: WartelistenZustand
}

/** Megabyte mit einer Nachkommastelle, Gigabyte ab 1024 MB. */
export function formatiereBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 0.1) return '0 MB'
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

/** Tag.Monat.Jahr in der Zeitzone des Betrachters — kurz genug für eine Tabellenzelle. */
export function formatiereDatum(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const zwei = (n: number): string => String(n).padStart(2, '0')
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * Suche über alles, was jemanden identifiziert: Adresse, Klarname und
 * öffentlicher Anzeigename. Wer nach „anna" sucht, meint die Person — nicht
 * eine bestimmte Spalte.
 */
export function filtereBenutzer(liste: readonly AdminBenutzer[], suche: string): AdminBenutzer[] {
  const s = suche.trim().toLowerCase()
  if (!s) return [...liste]
  return liste.filter((b) =>
    [b.email, b.name, b.anzeigename ?? ''].some((feld) => feld.toLowerCase().includes(s)),
  )
}

/** Wie viele Einladungen in welchem Zustand — für die Zeile über der Liste. */
export function zaehleEinladungen(liste: readonly AdminEinladung[]): Record<EinladungsZustand, number> {
  const zaehler: Record<EinladungsZustand, number> = { offen: 0, eingeloest: 0, abgelaufen: 0 }
  for (const e of liste) zaehler[e.zustand]++
  return zaehler
}

/**
 * Der Satz unter dem Code — er beantwortet die einzige Frage, die man an eine
 * Einladung hat: Kann die noch jemand benutzen, und wenn nein, wer war es?
 */
export function beschreibeEinladung(e: AdminEinladung): string {
  if (e.zustand === 'eingeloest') {
    const wer = e.eingeloestVon ?? 'einem gelöschten Konto'
    return `Eingelöst von ${wer} am ${formatiereDatum(e.eingeloestAm)}`
  }
  if (e.zustand === 'abgelaufen') return `Abgelaufen am ${formatiereDatum(e.ablauf)}`
  return e.ablauf ? `Offen · gültig bis ${formatiereDatum(e.ablauf)}` : 'Offen · ohne Ablaufdatum'
}

/**
 * Wie viele warten, wie viele hängen noch an ihrer Bestätigung.
 *
 * `wartend` steht vorn, weil es die einzige Zahl ist, auf die jemand handeln
 * kann: Nur bestätigte Adressen dürfen eine Einladung bekommen.
 */
export function zaehleWarteliste(
  liste: readonly AdminWartender[],
): Record<WartelistenZustand, number> {
  const zaehler: Record<WartelistenZustand, number> = { unbestaetigt: 0, wartend: 0, eingeladen: 0 }
  for (const e of liste) zaehler[e.zustand]++
  return zaehler
}

/** Der Satz unter der Adresse — wo im Ablauf dieser Eintrag gerade steht. */
export function beschreibeWartenden(e: AdminWartender): string {
  if (e.zustand === 'eingeladen') {
    const code = e.eingeladenCode ? ` mit Code ${e.eingeladenCode}` : ''
    return `Eingeladen am ${formatiereDatum(e.eingeladenAm)}${code}`
  }
  if (e.zustand === 'wartend') return `Bestätigt am ${formatiereDatum(e.bestaetigtAm)} · wartet`
  return `Eingetragen am ${formatiereDatum(e.eingetragenAm)} · Bestätigung steht aus`
}

/**
 * Warum sich jemand nicht einladen lässt — leer heißt: Knopf anbieten.
 *
 * Wie bei den Rollen stehen die Regeln doppelt (hier und in
 * server/src/routes/warteliste.ts). Die wichtigste ist die erste: Eine Mail an
 * eine unbestätigte Adresse wäre genau die ungefragte Nachricht, gegen die das
 * Double-Opt-in gebaut ist.
 */
export function einladenGesperrt(e: AdminWartender): string {
  if (e.zustand === 'unbestaetigt') return 'Diese Adresse ist noch nicht bestätigt'
  if (e.zustand === 'eingeladen') return 'Schon eingeladen — der Code steht in der Liste darunter'
  return ''
}

/**
 * Der Link, den man verschickt — er führt direkt ins Registrierungsformular mit
 * eingetragenem Code. Ohne ihn müsste der Eingeladene den Code abtippen und
 * vorher raten, wo.
 */
export function einladungsLink(basisUrl: string, code: string): string {
  return `${basisUrl.replace(/\/+$/, '')}${pfad('registrieren', `#einladung=${encodeURIComponent(code)}`)}`
}

/**
 * Warum eine Rolle oder ein Konto festliegt — leer heißt: darf geändert werden.
 *
 * Die Regeln stehen doppelt (hier und in server/src/routes/admin.ts). Das ist
 * Absicht: Der Server MUSS sie durchsetzen, die Oberfläche SOLL den Knopf gar
 * nicht erst anbieten. Ein Formular, das erst nach dem Absenden „geht nicht"
 * sagt, ist die schlechtere Hälfte davon.
 */
export function rolleGesperrt(
  ziel: AdminBenutzer,
  ichId: string,
  adminZahl: number,
): string {
  if (ziel.rolle !== 'admin') return ''
  if (ziel.fest) return 'In der Konfiguration als Admin gesetzt'
  if (ziel.id === ichId) return 'Die eigene Admin-Rolle lässt sich nicht ablegen'
  if (adminZahl <= 1) return 'Es muss mindestens einen Administrator geben'
  return ''
}

export function loeschenGesperrt(ziel: AdminBenutzer, ichId: string, adminZahl: number): string {
  if (ziel.id === ichId) return 'Das eigene Konto löschst du im Studio unter „Konto"'
  if (ziel.fest) return 'In der Konfiguration als Admin gesetzt'
  if (ziel.rolle === 'admin' && adminZahl <= 1) return 'Es muss mindestens einen Administrator geben'
  return ''
}

/** Wie viele Konten die Admin-Rolle tragen. */
export const zaehleAdmins = (liste: readonly AdminBenutzer[]): number =>
  liste.filter((b) => b.rolle === 'admin').length
