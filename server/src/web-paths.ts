/**
 * Die Web-Pfade, auf die Mails zeigen.
 *
 * Der Server kann [src/routes.ts](../../src/routes.ts) nicht importieren
 * (eigener `rootDir`) und führt die Pfade deshalb ein zweites Mal — dieselbe
 * Lage wie bei der SFX-Bibliothek. Ein Drift-Wächter in
 * [test/routes.test.ts](../../test/routes.test.ts) vergleicht beide Listen, denn
 * eine falsche Adresse fällt hier erst auf, wenn jemand seine Mail anklickt.
 *
 * Bestätigung und Reset zeigen auf `/anmelden`, nicht auf `/app`: Wer dem Link
 * folgt, ist im Zweifel gerade NICHT angemeldet — und die Seite schreibt den
 * Pfad ohnehin auf `/app` um, sobald die Sitzung steht.
 */
export const WEB_PATHS = {
  login: '/anmelden',
  register: '/registrieren',
  /** Ziel des Bestätigungslinks beim E-Mail-Wechsel — dort steht auch der Anlass. */
  account: '/konto',
  /** Beide stehen in der Fußzeile jeder System-Mail (maillayout.ts). */
  imprint: '/impressum',
  privacy: '/datenschutz',
} as const
