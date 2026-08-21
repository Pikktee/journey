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

import { parseBrowser, parseOs } from './account/account-model.js'

/** Genau die Felder, die der Server annimmt. Mehr zu schicken hätte keinen Zweck. */
export interface FeedbackContext {
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
export function cleanPath(href: string): string {
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
export function collectContext(opts: {
  href: string
  version: string
  userAgent: string
  width: number
  height: number
  language?: string
}): FeedbackContext {
  const context: FeedbackContext = {
    page: cleanPath(opts.href),
    version: opts.version,
  }
  const browser = parseBrowser(opts.userAgent)
  const os = parseOs(opts.userAgent)
  if (browser) context.browser = browser
  if (os) context.platform = os
  if (opts.width > 0 && opts.height > 0) context.screen = `${opts.width}×${opts.height}`
  if (opts.language) context.language = opts.language
  return context
}

/** Menschenlesbare Paare für den Aufklapper. Reihenfolge fest, damit sie nicht springt. */
export function contextLines(context: FeedbackContext): Array<[string, string]> {
  const labels: Array<[keyof FeedbackContext, string]> = [
    ['page', 'Seite'],
    ['version', 'Version'],
    ['browser', 'Browser'],
    ['platform', 'System'],
    ['screen', 'Fenster'],
    ['language', 'Sprache'],
  ]
  return labels.filter(([key]) => context[key]).map(([key, name]) => [name, String(context[key])])
}

/**
 * Taugt der Text zum Absenden?
 *
 * Bewusst nur eine Untergrenze und keine Formvorschrift: „Karte schwarz" ist
 * eine brauchbare Meldung. Zu prüfen gibt es genau eines — ob überhaupt etwas
 * dasteht, damit ein versehentlich leeres Formular nicht als Meldung ankommt.
 */
export function canSubmitText(text: string): boolean {
  return text.trim().length >= 3
}

export const MAX_TEXT = 4000
