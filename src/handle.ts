/**
 * Der Handle — die Adresse einer Person: `maptale.io/@henrik`.
 *
 * Er steht im PFAD und nicht als Query hinter `/profil`. Drei Gründe: Ohne das
 * `@` teilte er sich den Namensraum mit allen Seitenpfaden (dann darf niemand
 * mehr „galerie" heißen, und jeder neue Pfad entwertet einen vergebenen
 * Handle); das `@` macht einen eigenen Namensraum auf und sagt „hier kommt eine
 * Person"; und er überlebt die Mehrsprachigkeit unverändert — aus `/profil`
 * würde `/en/profile`, aus `/@henrik` nichts. Im Vhost ist das ein
 * `location ~ ^/@`, das mit keinem `try_files` kollidiert, weil `@` in keinem
 * Dateinamen vorkommt.
 *
 * **Der Handle ist NICHT der Anzeigename.** Namen sind doppelt vergeben, dürfen
 * Leerzeichen und Umlaute tragen und ändern sich; eine Adresse darf das alles
 * nicht.
 *
 * Diese Datei ist DOM-frei und wird an zwei Stellen gebraucht: im Browser als
 * Bequemlichkeit beim Tippen und im Server als Entscheidung. Der Server kann
 * sie nicht importieren (eigener `rootDir`) und führt sie deshalb ein zweites
 * Mal in [server/src/handle.ts](../server/src/handle.ts) — ein Drift-Wächter in
 * [test/routen.test.ts](../test/routen.test.ts) hält beide zusammen.
 */

/**
 * 3–30 Zeichen, Kleinbuchstaben, Ziffern und `. _ -` in der Mitte.
 *
 * Anfang und Ende bleiben alphanumerisch: `-henrik` sieht in einer Aufzählung
 * wie ein Aufzählungszeichen aus, `henrik.` verliert seinen Punkt, sobald ihn
 * jemand ans Satzende schreibt.
 */
export const HANDLE_REGELN = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/

/**
 * Was sich niemand greifen soll.
 *
 * Die Liste steht NEBEN [routen.ts](./routen.ts), nicht darin: Sie enthält
 * jeden vorhandenen Pfad (sonst überschriebe ein Handle eine Seite) UND das
 * Übliche, das später einmal einer werden könnte. Genau das ist der Punkt —
 * wäre sie aus `ROUTEN` abgeleitet, entwertete jeder neue Pfad still einen
 * längst vergebenen Handle. Der Wächter in `test/routen.test.ts` prüft nur die
 * eine Richtung: Jeder Pfad muss hier drinstehen.
 */
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

/** Warum ein Handle nicht geht — der Text dazu steht in `HANDLE_TEXTE`. */
export type HandleFehler = 'leer' | 'kurz' | 'form' | 'reserviert' | 'vergeben'

export const HANDLE_TEXTE: Readonly<Record<HandleFehler, string>> = {
  leer: 'Ohne Adresse ist dein Profil nicht verlinkbar.',
  kurz: 'Mindestens 3 Zeichen.',
  form: 'Erlaubt sind a–z, 0–9, Punkt, Bindestrich und Unterstrich — nicht am Anfang oder Ende.',
  reserviert: 'Diese Adresse ist für Maptale selbst reserviert.',
  vergeben: 'Diese Adresse ist schon vergeben.',
}

/**
 * Form und Reservierung prüfen — alles, was ohne Datenbank zu entscheiden ist.
 * `null` heißt „so weit in Ordnung"; ob der Handle noch FREI ist, weiß nur der
 * Server (`vergeben`).
 */
export function pruefeHandleForm(wert: string): HandleFehler | null {
  const w = wert.trim().toLowerCase()
  if (!w) return 'leer'
  if (w.length < 3) return 'kurz'
  if (!HANDLE_REGELN.test(w)) return 'form'
  // Benutzer-IDs beginnen mit `u_` (server/src/ids.ts). Der Präfix bleibt frei,
  // damit `/api/benutzer/:wen/profil` eine ID von einem Handle unterscheiden
  // kann, ohne zu raten — sonst führte ein Handle „u_abc" auf ein fremdes Profil.
  if (w.startsWith('u_')) return 'reserviert'
  if (RESERVIERTE_HANDLES.has(w)) return 'reserviert'
  return null
}

/**
 * Tippeingabe → gültiger Handle.
 *
 * Umlaute werden ÜBERSETZT, nicht gelöscht: „Henrik Süd" ergäbe sonst
 * „henriksd", und der Nutzer suchte den Fehler bei sich. Leerzeichen werden zum
 * Bindestrich, weil das die übliche Lesart ist. Das Ergebnis kann trotzdem
 * ungültig sein (zu kurz, reserviert) — geprüft wird getrennt.
 */
export function zuHandle(roh: string): string {
  return roh
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // é → e, å → a
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '')
    .slice(0, 30)
    .replace(/[._-]+$/, '') // der Schnitt kann ein Trennzeichen ans Ende gelegt haben
}
