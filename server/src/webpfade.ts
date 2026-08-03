/**
 * Die Web-Pfade, auf die Mails zeigen.
 *
 * Der Server kann [src/routen.ts](../../src/routen.ts) nicht importieren
 * (eigener `rootDir`) und führt die Pfade deshalb ein zweites Mal — dieselbe
 * Lage wie bei der SFX-Bibliothek. Ein Drift-Wächter in
 * [test/routen.test.ts](../../test/routen.test.ts) vergleicht beide Listen, denn
 * eine falsche Adresse fällt hier erst auf, wenn jemand seine Mail anklickt.
 *
 * Bestätigung und Reset zeigen auf `/anmelden`, nicht auf `/app`: Wer dem Link
 * folgt, ist im Zweifel gerade NICHT angemeldet — und die Seite schreibt den
 * Pfad ohnehin auf `/app` um, sobald die Sitzung steht.
 */
export const WEB_PFADE = {
  anmelden: '/anmelden',
  registrieren: '/registrieren',
} as const
