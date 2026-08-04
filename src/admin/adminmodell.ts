// Rechnende Teile der Benutzerverwaltung — ohne DOM, damit sie prüfbar sind.
// Die Oberfläche (admin.ts) baut daraus nur noch Elemente.

import { pfad } from '../routen.js'

export type Rolle = 'nutzer' | 'admin'
export type EinladungsZustand = 'offen' | 'eingeloest' | 'abgelaufen'

// — Bereiche —
//
// Die Verwaltung hatte fünf Karten untereinander auf einer Seite; wer eine
// Einladung erstellen wollte, scrollte an Wartenden und Mail-Vorlagen vorbei.
// Jetzt ist jeder Bereich ein Reiter — und weil die Liste den URL-Anhang, die
// Reiterleiste UND die Zähler speist, steht sie EINMAL hier.

export type TabId = 'konten' | 'statistiken' | 'einladungen' | 'warteliste' | 'mails' | 'protokoll'

export interface Tab {
  id: TabId
  name: string
  /**
   * Was die Zahl am Reiter zählt. Sie ist NICHT überall dasselbe — bei den
   * Konten sind es alle, bei Einladungen und Warteliste nur die, auf die man
   * handeln kann. Der Zähler allein sagt das nicht, deshalb geht dieses Wort
   * ins `aria-label` und in den Tooltip.
   */
  zaehlt: string
}

export const TABS: readonly Tab[] = [
  { id: 'konten', name: 'Konten', zaehlt: 'Konten' },
  { id: 'statistiken', name: 'Statistiken', zaehlt: 'Live' },
  { id: 'einladungen', name: 'Einladungen', zaehlt: 'offen' },
  { id: 'warteliste', name: 'Warteliste', zaehlt: 'warten' },
  { id: 'mails', name: 'System-Mails', zaehlt: 'Vorlagen' },
  { id: 'protokoll', name: 'Protokoll', zaehlt: 'Fehler' },
]

/** Womit die Seite aufmacht: die Konten sind der Grund, warum es sie gibt. */
export const TAB_STANDARD: TabId = 'konten'

/**
 * Welcher Reiter zu `#einladungen` gehört — unbekanntes fällt auf den Standard.
 *
 * Der Anhang ist die einzige Adresse eines Reiters: Ein Neuladen (und jeder
 * Link, den sich jemand ablegt) landet wieder dort, wo er war. Ein eigener
 * Pfad je Bereich wäre die Alternative, hieße aber vier Einträge in
 * `routen.ts` und vier `location`-Blöcke im Vhost für eine Seite, die ohnehin
 * nur Admins sehen.
 */
export function tabAusHash(hash: string): TabId {
  const name = hash.replace(/^#/, '').trim().toLowerCase()
  return TABS.find((t) => t.id === name)?.id ?? TAB_STANDARD
}

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

/** Erster Buchstabe für den Punkt vor dem Namen — wie der Konto-Chip der Topbar. */
export function initiale(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase()
}

const enthaelt = (feld: string, suche: string): boolean => feld.toLowerCase().includes(suche)

export type KontenFilter = 'alle' | 'admins' | 'unbestaetigt'

/**
 * Suche über alles, was jemanden identifiziert: Adresse, Klarname und
 * öffentlicher Anzeigename. Wer nach „anna" sucht, meint die Person — nicht
 * eine bestimmte Spalte.
 *
 * Der Filter beantwortet die zwei Fragen, die man an eine Kontenliste hat:
 * Wer darf verwalten, und wer hängt noch an seiner Bestätigung (und kann
 * deshalb nicht hochladen).
 */
export function filtereBenutzer(
  liste: readonly AdminBenutzer[],
  suche: string,
  filter: KontenFilter = 'alle',
): AdminBenutzer[] {
  const s = suche.trim().toLowerCase()
  return liste.filter((b) => {
    if (filter === 'admins' && b.rolle !== 'admin') return false
    if (filter === 'unbestaetigt' && b.verifiziert) return false
    if (!s) return true
    return [b.email, b.name, b.anzeigename ?? ''].some((feld) => enthaelt(feld, s))
  })
}

export type EinladungsFilter = 'alle' | EinladungsZustand

/**
 * Suche über Code und Notiz.
 *
 * Der Code wird ohne Trennzeichen verglichen: Wer ihn aus einer Mail kopiert
 * oder aus dem Gedächtnis tippt, schreibt „abcd2345" — an einem Bindestrich
 * darf die Suche nicht scheitern.
 */
export function filtereEinladungen(
  liste: readonly AdminEinladung[],
  suche: string,
  filter: EinladungsFilter = 'alle',
): AdminEinladung[] {
  const s = suche.trim().toLowerCase()
  const blank = s.replace(/[^a-z0-9]/g, '')
  return liste.filter((e) => {
    if (filter !== 'alle' && e.zustand !== filter) return false
    if (!s) return true
    if (blank && e.code.toLowerCase().replace(/[^a-z0-9]/g, '').includes(blank)) return true
    return enthaelt(e.notiz ?? '', s)
  })
}

export type WartelistenFilter = 'alle' | WartelistenZustand

/** Suche über Adresse und die freiwillige Angabe — das Kriterium fürs Freischalten. */
export function filtereWarteliste(
  liste: readonly AdminWartender[],
  suche: string,
  filter: WartelistenFilter = 'alle',
): AdminWartender[] {
  const s = suche.trim().toLowerCase()
  return liste.filter((e) => {
    if (filter !== 'alle' && e.zustand !== filter) return false
    if (!s) return true
    return [e.email, e.notiz ?? ''].some((feld) => enthaelt(feld, s))
  })
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

/**
 * Steht das Wartelisten-Formular gerade wirklich vor der Tür?
 *
 * Spiegel von `wartelisteAngeboten` in server/src/auth/warteliste.ts — dritte
 * Regel dieser Art, die doppelt steht (wie `rolleGesperrt`). Der Server MUSS
 * sie durchsetzen; hier hängt an ihr nur ein Satz. Die Antwort per API zu
 * holen ginge auch, aber die Schalter ändern sich im Sekundentakt, während die
 * Liste stehen bleibt: Ohne eigene Rechnung stünde nach jedem Umlegen ein
 * überholter Hinweis da.
 */
export const wartelisteAngeboten = (
  offen: boolean,
  einladungPflicht: boolean,
  registrierungOffen: boolean,
): boolean => offen && (einladungPflicht || !registrierungOffen)

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

// — System-Mails —

/** Die bearbeitbaren Teile einer Mail; Layout und HTML kommen vom Server. */
export interface MailBausteine {
  betreff: string
  titel: string
  text: string
  knopf: string
  fuss: string
}

export interface MailPlatzhalter {
  name: string
  beschreibung: string
  beispiel: string
}

export interface MailVorlage {
  schluessel: string
  name: string
  anlass: string
  platzhalter: MailPlatzhalter[]
  hatLink: boolean
  standard: MailBausteine
  /** Was tatsächlich verschickt wird: die Anpassung, sonst der Standard. */
  bausteine: MailBausteine
  angepasst: boolean
  geaendertAm: string | null
  geaendertVon: string | null
}

/**
 * Der Satz unter dem Namen — steht die Vorlage im Code oder ist sie angefasst?
 *
 * Eine unveränderte Vorlage erzählt lieber, WANN sie rausgeht: Das ist die
 * Frage, die man vor dem Bearbeiten hat. Bei einer angepassten ist die
 * dringendere, wer sie zuletzt angefasst hat.
 */
export function beschreibeVorlage(v: MailVorlage): string {
  if (!v.angepasst) return v.anlass
  const wer = v.geaendertVon ? ` von ${v.geaendertVon}` : ''
  return `Angepasst am ${formatiereDatum(v.geaendertAm)}${wer}`
}

// — Betriebsprotokoll —
//
// Die letzten Warnungen und Fehler der API. Sie liegen dort in einem Ringpuffer
// im Arbeitsspeicher (server/src/protokoll.ts) — was diese Ansicht zeigt, ist
// also immer „seit dem letzten Neustart", und genau das sagt sie auch.

export type ProtokollStufe = 'warnung' | 'fehler'

export interface ProtokollEintrag {
  nr: number
  zeit: string
  stufe: ProtokollStufe
  text: string
  detail?: string
}

export type ProtokollFilter = 'alle' | ProtokollStufe

/** Suche über Meldung UND Detail — die Tour-ID steht oft nur im Detail. */
export function filtereProtokoll(
  liste: readonly ProtokollEintrag[],
  suche: string,
  filter: ProtokollFilter = 'alle',
): ProtokollEintrag[] {
  const s = suche.trim().toLowerCase()
  return liste.filter((e) => {
    if (filter !== 'alle' && e.stufe !== filter) return false
    if (!s) return true
    return [e.text, e.detail ?? ''].some((feld) => enthaelt(feld, s))
  })
}

export function zaehleProtokoll(liste: readonly ProtokollEintrag[]): Record<ProtokollStufe, number> {
  const zaehler: Record<ProtokollStufe, number> = { warnung: 0, fehler: 0 }
  for (const e of liste) zaehler[e.stufe]++
  return zaehler
}

/**
 * Uhrzeit mit Sekunde — bei einem Protokoll ist die Reihenfolge innerhalb einer
 * Minute die eigentliche Information („kam der Fehler VOR oder NACH dem Retry?").
 * Das Datum steht nur dabei, wenn die Meldung nicht von heute ist: Bei einem
 * Puffer, der meist Minuten alt ist, wäre es sonst in jeder Zeile Ballast.
 */
export function formatiereZeitpunkt(iso: string, jetzt: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const zwei = (n: number): string => String(n).padStart(2, '0')
  const uhr = `${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`
  const gleicherTag =
    d.getDate() === jetzt.getDate() && d.getMonth() === jetzt.getMonth() && d.getFullYear() === jetzt.getFullYear()
  return gleicherTag ? uhr : `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}. ${uhr}`
}

/**
 * Was über der Liste steht. Ein leerer Puffer ist die GUTE Nachricht — er darf
 * nicht wie ein Fehler aussehen („keine Daten"), sondern sagt, seit wann nichts
 * vorgefallen ist.
 */
export function beschreibeProtokoll(anzahl: number, fehler: number, gestartet: string | null): string {
  const seit = gestartet ? ` seit dem Start der API am ${formatiereDatum(gestartet)} um ${formatiereZeitpunkt(gestartet)}` : ''
  if (anzahl === 0) return `Nichts vorgefallen${seit}.`
  const teile = [`${anzahl} ${anzahl === 1 ? 'Meldung' : 'Meldungen'}`]
  if (fehler > 0) teile.push(`davon ${fehler} ${fehler === 1 ? 'Fehler' : 'Fehler'}`)
  return `${teile.join(', ')}${seit}.`
}
