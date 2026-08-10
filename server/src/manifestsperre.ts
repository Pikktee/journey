// Ein Manifest-Schreiber je Tour, nacheinander.
//
// **Warum das nötig ist.** Zwei Routen ändern das Manifest im Muster
// „lesen → ändern → schreiben": das Nachreichen (`POST …/medien`, hängt an) und
// das endgültige Löschen (`DELETE …/media/:mid`, setzt den Tombstone). Zwischen
// Lesen und Schreiben liegt echte Wartezeit — bei einer Datei-Ablage ein paar
// Millisekunden, bei einer Netz-Ablage mehr. Zwei gleichzeitige Läufe lesen
// denselben Stand, und der zweite schreibt den ersten weg.
//
// Was dabei verloren geht, ist nicht bloß ein Eintrag: Der Client hat für ihn
// eine Medien-ID bekommen und lädt die Bytes hoch. Die Datei liegt dann in der
// Ablage, zählt gegen die Quota und gehört zu keiner Tour — und weil ihr
// Manifest-Eintrag fehlt, greift auch der `quelle`-Riegel nicht mehr: Der
// nächste Lauf legt dasselbe Foto ein zweites Mal an, mit einer zweiten
// Waisen-Datei. In der Paarung `DELETE` gegen `POST` ist es schlimmer — dort
// überschreibt eine Zustellung den frisch gesetzten Tombstone und erweckt einen
// Eintrag, dessen Dateien der Server gerade gelöscht hat.
//
// Solange nur das Studio nachreichte, war das theoretisch: Ein Mensch klickt
// nicht zweimal gleichzeitig. Mit dem Foto-Nachzug der App gibt es automatische
// Aufrufer — zwei Geräte am selben Konto, App-Nachzug neben Studio-Nachreichen —
// und damit reale Auslöser. Der Mutex in der App deckt nur ihren eigenen
// Prozess ab; serialisiert werden muss dort, wo die Datei liegt.
//
// **Warum kein Dateisystem-Lock:** Der Server ist ein Prozess (ein Container),
// und die Ablage kennt keine Sperren. Eine Promise-Kette je Tour ist genau die
// Reichweite, die das Problem hat — dasselbe Muster wie `app.verarbeitungen`.

/**
 * Laufende Manifest-Arbeiten je Tour.
 *
 * Der Wert ist ein Platzhalter, der NIE ablehnt: Ein gescheiterter Lauf darf
 * den nächsten nicht mitreißen — sonst bräche ein einzelner Fehler die Kette
 * für alle folgenden Aufrufe dieser Tour.
 */
const laeufe = new Map<string, Promise<void>>()

/**
 * `arbeit` ausführen, aber nie gleichzeitig mit einer anderen Arbeit an
 * derselben Tour.
 *
 * Das Ergebnis (und ein Fehler) gehen unverändert an den Aufrufer zurück; die
 * Sperre ändert nur die Reihenfolge, nicht die Semantik. Der Eintrag wird
 * gelöscht, sobald niemand mehr wartet — die Map wächst also nicht mit der Zahl
 * der Touren, sondern nur mit den gerade laufenden Schreibern.
 */
export async function mitManifestSperre<T>(tourId: string, arbeit: () => Promise<T>): Promise<T> {
  const vorher = laeufe.get(tourId) ?? Promise.resolve()
  const lauf = vorher.then(arbeit)
  const platzhalter = lauf.then(
    () => undefined,
    () => undefined,
  )
  laeufe.set(tourId, platzhalter)
  try {
    return await lauf
  } finally {
    // Nur aufräumen, wenn seither niemand angehängt hat — sonst risse man die
    // Kette mitten aus den Wartenden heraus.
    if (laeufe.get(tourId) === platzhalter) laeufe.delete(tourId)
  }
}
