/**
 * Der Handle — Kopie von [src/handle.ts](../../src/handle.ts).
 *
 * Der Server kann die Web-Datei nicht importieren (eigener `rootDir`, dieselbe
 * Lage wie bei [webpfade.ts](./webpfade.ts)) und führt Regeln und
 * Reservierungen deshalb ein zweites Mal. Ein Drift-Wächter in
 * [test/routen.test.ts](../../test/routen.test.ts) vergleicht beide Listen —
 * ohne ihn fiele ein Unterschied erst auf, wenn ein Handle im Browser grün ist
 * und der Server ihn ablehnt.
 *
 * Die AUSSAGE steht drüben: warum der Handle im Pfad steht, warum er nicht der
 * Anzeigename ist und warum die reservierten Wörter neben und nicht in
 * `routen.ts` liegen.
 */

export const HANDLE_REGELN = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/

export const RESERVIERTE_HANDLES: ReadonlySet<string> = new Set([
  // Die Seiten, die es gibt (s. routen.ts)
  'app',
  'anmelden',
  'registrieren',
  'galerie',
  'profil',
  'admin',
  'impressum',
  'datenschutz',
  'erlebnis',
  // Technisches
  'api',
  'assets',
  'static',
  'media',
  'favicon',
  'robots',
  'sitemap',
  // Der Namensraum der Touren (`/tour/<kennung>`, s. routen.ts)
  'tour',
  'touren',
  'null',
  'undefined',
  // Was Maptale selbst noch brauchen wird
  'konto',
  'einstellungen',
  'abmelden',
  'passwort',
  'hilfe',
  'support',
  'blog',
  'presse',
  'preise',
  'agb',
  'kontakt',
  'shop',
  'team',
  'info',
  'news',
  'maptale',
  'you',
  'wir',
])

export type HandleFehler = 'leer' | 'kurz' | 'form' | 'reserviert' | 'vergeben'

export const HANDLE_TEXTE: Readonly<Record<HandleFehler, string>> = {
  leer: 'Ohne Adresse ist dein Profil nicht verlinkbar.',
  kurz: 'Mindestens 3 Zeichen.',
  form: 'Erlaubt sind a–z, 0–9, Punkt, Bindestrich und Unterstrich — nicht am Anfang oder Ende.',
  reserviert: 'Diese Adresse ist für Maptale selbst reserviert.',
  vergeben: 'Diese Adresse ist schon vergeben.',
}

export function pruefeHandleForm(wert: string): HandleFehler | null {
  const w = wert.trim().toLowerCase()
  if (!w) return 'leer'
  if (w.length < 3) return 'kurz'
  if (!HANDLE_REGELN.test(w)) return 'form'
  // Benutzer-IDs beginnen mit `u_` (ids.ts) — der Präfix bleibt frei, damit
  // `/api/benutzer/:wen/profil` ID und Handle auseinanderhalten kann.
  if (w.startsWith('u_')) return 'reserviert'
  if (RESERVIERTE_HANDLES.has(w)) return 'reserviert'
  return null
}

export function zuHandle(roh: string): string {
  return roh
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .slice(0, 30)
    .replace(/[._-]+$/, '')
}

/**
 * Aus einer E-Mail-Adresse einen Vorschlag bauen — die Vergabe beim Anlegen
 * eines Kontos. Der lokale Teil ohne Plus-Zusatz (`mira+maptale@` → `mira`),
 * durch `zuHandle` gedreht. Bleibt zu wenig übrig (`ä@…`, `ab@…`), gibt es
 * `reisende` als Stamm — der Zähler in `vergebeHandle` macht daraus einen
 * eigenen Namen.
 */
export function handleAusEmail(email: string): string {
  const lokal = email.split('@')[0] ?? ''
  const stamm = zuHandle(lokal.split('+')[0] ?? lokal)
  return stamm.length >= 3 ? stamm : 'reisende'
}

/**
 * Aus einem Stamm einen freien Handle machen: `henrik`, sonst `henrik2`, `henrik3`.
 *
 * `belegt` beantwortet „schon vergeben oder gesperrt?" — die Datenbank weiß
 * das, diese Datei nicht. Reservierte Wörter fängt die Funktion selbst ab
 * (`admin@…` darf nicht zu `@admin` werden), und der Zähler wird in den Stamm
 * hineingeschnitten, damit die 30 Zeichen halten.
 *
 * Der Zähler hat kein Limit: Bei jedem Durchgang wächst er, also endet die
 * Schleife zwangsläufig.
 */
export function freierHandle(stamm: string, belegt: (handle: string) => boolean): string {
  const basis = stamm.length >= 3 ? stamm.slice(0, 30) : 'reisende'
  const geht = (h: string): boolean => pruefeHandleForm(h) === null && !belegt(h)
  if (geht(basis)) return basis
  for (let n = 2; ; n++) {
    const kandidat = `${basis.slice(0, 30 - String(n).length)}${n}`
    if (geht(kandidat)) return kandidat
  }
}
