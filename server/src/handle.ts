/**
 * Der Handle — Kopie von [src/handle.ts](../../src/handle.ts).
 *
 * Der Server kann die Web-Datei nicht importieren (eigener `rootDir`, dieselbe
 * Lage wie bei [webpfade.ts](./webpfade.ts)) und führt Regeln und
 * Reservierungen deshalb ein zweites Mal. Ein Drift-Wächter in
 * [test/routes.test.ts](../../test/routes.test.ts) vergleicht beide Listen —
 * ohne ihn fiele ein Unterschied erst auf, wenn ein Handle im Browser grün ist
 * und der Server ihn ablehnt.
 *
 * Die AUSSAGE steht drüben: warum der Handle im Pfad steht, warum er nicht der
 * Anzeigename ist und warum die reservierten Wörter neben und nicht in
 * `routes.ts` liegen.
 */

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // Die Seiten, die es gibt (s. routes.ts)
  'app',
  'anmelden',
  'registrieren',
  'galerie',
  'profil',
  'admin',
  'impressum',
  'datenschutz',
  'erlebnis',
  'feedback',
  // Technisches
  'api',
  'assets',
  'static',
  'media',
  'favicon',
  'robots',
  'sitemap',
  // Der Namensraum der Touren (`/tour/<kennung>`, s. routes.ts)
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

export type HandleError = 'empty' | 'tooShort' | 'format' | 'reserved' | 'taken'

export const HANDLE_ERROR_TEXTS: Readonly<Record<HandleError, string>> = {
  empty: 'Ohne Adresse ist dein Profil nicht verlinkbar.',
  tooShort: 'Mindestens 3 Zeichen.',
  format: 'Erlaubt sind a–z, 0–9, Punkt, Bindestrich und Unterstrich; nicht am Anfang oder Ende.',
  reserved: 'Diese Adresse ist für Maptale selbst reserviert.',
  taken: 'Diese Adresse ist schon vergeben.',
}

export function validateHandleForm(value: string): HandleError | null {
  const w = value.trim().toLowerCase()
  if (!w) return 'empty'
  if (w.length < 3) return 'tooShort'
  if (!HANDLE_PATTERN.test(w)) return 'format'
  // Benutzer-IDs beginnen mit `u_` (ids.ts) — der Präfix bleibt frei, damit
  // `/api/users/:wen/profile` ID und Handle auseinanderhalten kann.
  if (w.startsWith('u_')) return 'reserved'
  if (RESERVED_HANDLES.has(w)) return 'reserved'
  return null
}

export function toHandle(raw: string): string {
  return raw
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
 * durch `toHandle` gedreht. Bleibt zu wenig übrig (`ä@…`, `ab@…`), gibt es
 * `reisende` als Stamm — der Zähler in `vergebeHandle` macht daraus einen
 * eigenen Namen.
 */
export function handleFromEmail(email: string): string {
  const lokal = email.split('@')[0] ?? ''
  const stamm = toHandle(lokal.split('+')[0] ?? lokal)
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
export function findFreeHandle(stamm: string, belegt: (handle: string) => boolean): string {
  const basis = stamm.length >= 3 ? stamm.slice(0, 30) : 'reisende'
  const geht = (h: string): boolean => validateHandleForm(h) === null && !belegt(h)
  if (geht(basis)) return basis
  for (let n = 2; ; n++) {
    const kandidat = `${basis.slice(0, 30 - String(n).length)}${n}`
    if (geht(kandidat)) return kandidat
  }
}
