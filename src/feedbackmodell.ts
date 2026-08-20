// Was eine Rückmeldung an technischen Angaben mitbringt — DOM-frei und
// getestet, damit die Oberfläche nur noch anzeigt.
//
// Die Leitregel steht in einem Satz: **Der Absender entscheidet, OB die Angaben
// mitgehen; sehen kann er sie vorher.** Ein Häkchen ohne Einblick wäre eine
// Zumutung — es verlangt Vertrauen für etwas, das man zeigen könnte. Deshalb
// baut `kontextZeilen` aus demselben Objekt, das gesendet wird, die Liste, die
// im Aufklapper steht: Was dort fehlt, geht auch nicht raus.
//
// Der Umfang ist nicht beliebig: Er steht wortgleich in der
// Datenschutzerklärung, und der Server nimmt ohnehin nur die bekannten Felder
// an (`saubereKontext` in server/src/routes/rueckmeldungen.ts).

import { browserAus, systemAus } from './konto/kontomodell.js'

/** Genau die Felder, die der Server annimmt. Mehr zu schicken hätte keinen Zweck. */
export interface FeedbackKontext {
  /** Adresse der Seite OHNE Query und Fragment — dort steht sonst Fremdes. */
  page?: string
  version?: string
  browser?: string
  platform?: string
  screen?: string
  language?: string
}

/**
 * Die Adresse ohne Query und Fragment.
 *
 * Ein Fragment trägt in Maptale Einlöse-Token (`#email=…`, `#reset=…`), und ein
 * Query kann alles enthalten, was jemand angehängt hat. Für die Frage „wo ist
 * es passiert?" reicht der Pfad, und mehr darf eine freiwillige Angabe nicht
 * heimlich mitnehmen.
 */
export function sauberePfadangabe(href: string): string {
  try {
    const u = new URL(href)
    return u.pathname
  } catch {
    return href.split('?')[0]?.split('#')[0] ?? ''
  }
}

/**
 * Sammelt, was der Browser über sich weiß. Fehlende Angaben bleiben weg statt
 * „unbekannt" zu heißen — eine leere Zeile in der Liste des Betreibers ist
 * ehrlicher als eine ausgedachte.
 */
export function sammleKontext(opts: {
  href: string
  version: string
  userAgent: string
  breite: number
  hoehe: number
  language?: string
}): FeedbackKontext {
  const kontext: FeedbackKontext = {
    page: sauberePfadangabe(opts.href),
    version: opts.version,
  }
  const browser = browserAus(opts.userAgent)
  const system = systemAus(opts.userAgent)
  if (browser) kontext.browser = browser
  if (system) kontext.platform = system
  if (opts.breite > 0 && opts.hoehe > 0) kontext.screen = `${opts.breite}×${opts.hoehe}`
  if (opts.language) kontext.language = opts.language
  return kontext
}

/** Menschenlesbare Paare für den Aufklapper. Reihenfolge fest, damit sie nicht springt. */
export function kontextZeilen(kontext: FeedbackKontext): Array<[string, string]> {
  const namen: Array<[keyof FeedbackKontext, string]> = [
    ['page', 'Seite'],
    ['version', 'Version'],
    ['browser', 'Browser'],
    ['platform', 'System'],
    ['screen', 'Fenster'],
    ['language', 'Sprache'],
  ]
  return namen
    .filter(([schluessel]) => kontext[schluessel])
    .map(([schluessel, name]) => [name, String(kontext[schluessel])])
}

/**
 * Taugt der Text zum Absenden?
 *
 * Bewusst nur eine Untergrenze und keine Formvorschrift: „Karte schwarz" ist
 * eine brauchbare Meldung. Zu prüfen gibt es genau eines — ob überhaupt etwas
 * dasteht, damit ein versehentlich leeres Formular nicht als Meldung ankommt.
 */
export function textTaugt(text: string): boolean {
  return text.trim().length >= 3
}

export const MAX_TEXT = 4000
