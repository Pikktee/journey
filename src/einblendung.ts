// Die Foto-Karte: Zahlen und Regeln, die Player UND Editor gemeinsam gehören.
//
// Beide zeigen dieselbe Einblendung — der Player als Bühne, der Editor als
// Vorschau auf der Karte. Was BEIDE wissen müssen, steht hier; wie sie es
// darstellen, bleibt getrennt (der Player läuft linear in Echtzeit, im Editor
// wird gescrubbt — ein gemeinsames DOM-Bauteil müsste beide Zeitmodelle
// tragen, s. docs/concepts/konzept_gleichlauf_player_editor.md §6A/§9).
//
// Warum eine eigene Datei und nicht `tour.ts`: Die Engine importiert MapLibre.
// Das Studio lädt MapLibre erst mit dem Editor nach; ein Import aus `tour.ts`
// zöge es ins Basis-Bundle. Und `ui.ts` importiert `tour.ts` nicht (nur
// umgekehrt) — eine exportierte Konstante dort wäre ein Import-Zyklus.
//
// Diese Datei ist DOM-frei und ohne Importe: Sie muss vom Player, vom Studio
// und aus Tests gleichermaßen benutzbar sein.

/**
 * Sekunden, die eine Foto-Karte sichtbar steht (Vorgabe).
 *
 * `display.holdS` aus dem Studio übersteuert sie pro Medium; für ein VIDEO ist
 * sie wirkungslos, dort zählt die Dateilänge (src/tour.ts, `advancePhoto`).
 *
 * Die Zahl hat zwei erzwungene Spiegel, die sie nicht importieren können —
 * `HALT_ENGINE_S` in server/src/pipeline/filmtempo.ts (eigener `rootDir`) und
 * in src/studio/zeitleiste.ts (kein `tour.ts`-Import, s. o.). Beide werden
 * gegen DIESE Datei bewacht.
 */
export const HOLD_HIDE = 5.2

/** Sekunden Ausblend-Animation nach der Anzeige, bevor es weitergeht. */
export const HOLD_AUSBLEND = 0.8

/**
 * Standzeit EINER Aufnahme im Halt (ohne Ausblendung) — die Filmzeit, die sie
 * kostet.
 *
 * Für ein Video ist das seine Länge und sonst nichts: Der Player läuft bis zum
 * Dateiende, `display.holdS` ist dort wirkungslos. Kennt niemand die Länge
 * (unverarbeiteter Altbestand), bleibt es bei der Foto-Annahme — und zwar in
 * Player UND Editor gleich (Konzept, Falle 4).
 *
 * Der Editor legt für seinen Video-SCHNITT noch eine Klemme darum
 * (`aufnahmeHaltS` in src/studio/zeitleiste.ts); die Regel darunter ist diese.
 */
export function standzeitS(m: {
  type?: 'photo' | 'video'
  /** Länge des Videos in Sekunden */
  dauerS?: number
  display?: { holdS?: number }
}): number {
  if (m.type === 'video' && m.dauerS !== undefined && m.dauerS > 0) return m.dauerS
  return m.display?.holdS ?? HOLD_HIDE
}

/**
 * Filmzeit, die eine Aufnahme im Halt insgesamt einnimmt — Standzeit UND
 * Ausblendung.
 *
 * Das ist die Länge ihres KLIPS: Der Editor zeichnet ihn so auf die Zeitleiste,
 * die Achse reiht die Aufnahmen eines Halts danach aneinander, und beide Bühnen
 * lassen ihre Karte genau so lange liegen. Bis E15 rechnete der Player daneben
 * mit `holdS + 1.8` für den Ken-Burns-Zug — die eine Sekunde aus §6C des
 * Gleichlauf-Konzepts.
 */
export function klipDauerS(standS: number): number {
  return standS + HOLD_AUSBLEND
}

/**
 * Füllstand des Anzeige-Balkens (0..1) an der Stelle `imS` eines Klips.
 *
 * Er wird bei jedem Kopfschritt GESETZT und nicht über eine Dauer animiert:
 * Eine Animation kennt nur „seit dem Start" und stünde beim Scrubben und nach
 * jeder Pause neben der Wahrheit.
 */
export function balkenAnteil(imS: number, dauerS: number): number {
  if (!(dauerS > 0)) return 0
  return Math.max(0, Math.min(1, imS / dauerS))
}

/** Die vier Zeiten der pausierten Karten-Animationen (Sekunden). */
export interface KartenZeiten {
  /** Negatives Delay der Auftritts-Animationen — der Stand IM Klip. */
  zeitS: number
  /** Dauer des Ken-Burns-Zugs: die volle Klip-Länge. */
  kbDauerS: number
  /** Delay des Abgangs; positiv, solange er noch aussteht. */
  ausZeitS: number
  /** Dauer des Abgangs. */
  ausDauerS: number
}

/**
 * Aus dem Stand im Klip die Delays der dauerhaft PAUSIERTEN Animationen.
 *
 * Das ist die Technik, mit der ein Standbild aus einer Animation gezogen wird:
 * Die Animation läuft nie, ihr Fortschritt kommt aus einem negativen Delay.
 * Deshalb erscheint die Karte auch rückwärts und beim Scrubben mit dem Bild,
 * das an DIESER Filmsekunde gilt — eine Wanduhr-Transition kann das nicht, sie
 * startet beim Klassenwechsel und läuft danach für sich.
 *
 * Der Abgang liegt in den letzten `HOLD_AUSBLEND` des Klips, also genau in der
 * Spanne, um die der Klip länger ist als die Standzeit.
 */
export function kartenZeiten(imS: number, dauerS: number): KartenZeiten {
  const klipS = Math.max(0.1, dauerS)
  const ausDauerS = Math.min(HOLD_AUSBLEND, klipS)
  return { zeitS: -imS, kbDauerS: klipS, ausZeitS: klipS - ausDauerS - imS, ausDauerS }
}

/**
 * Ein Video steht nicht auf dem letzten Frame, sondern kurz davor — sonst
 * klemmt der Browser `currentTime` still.
 */
const VIDEO_ENDE_S = 0.04

/**
 * Die Stelle IM Video, die zum Stand `imS` des Klips gehört — geklemmt an die
 * Schnittkanten.
 *
 * Der Klip ist um die Ausblendung länger als das Material (und bei einem
 * rechten Schnitt endet es noch früher). Ohne Klemme läuft `vonS + imS` über
 * das Ende hinaus: Der Browser klemmt `currentTime` still, die Abweichung
 * wächst mit jedem Frame über die Nachzieh-Schwelle — und die Wiedergabe seekte
 * in JEDEM Frame ans Ende, während `ended`/`play()` sich abwechselten. Das war
 * das Zittern am Klip-Ende. `ausgelaufen` sagt, dass ab hier nur noch das
 * letzte Bild steht, also weder gespielt noch nachgezogen werden muss.
 *
 * Der Player liefert geschnittene Dateien aus (`vonS` = 0), der Editor den
 * ungeschnittenen Master mit beiden Kanten — die Rechnung ist dieselbe.
 */
export function videoStandS(
  vonS: number,
  endeS: number,
  imS: number,
): { zielS: number; ausgelaufen: boolean } {
  const letzterFrameS = Math.max(vonS, endeS - VIDEO_ENDE_S)
  const roh = vonS + Math.max(0, imS)
  return { zielS: Math.min(roh, letzterFrameS), ausgelaufen: roh >= letzterFrameS }
}

/**
 * Grenzen des Seitenverhältnisses der Foto-Karte (Breite ÷ Höhe).
 *
 * Extreme Panoramen und Hochformate würden die Bühne sonst sprengen: Ein
 * 3:1-Panorama wäre breiter als das Fenster, ein 9:19-Handyfoto höher.
 */
export const AR_MIN = 0.62
export const AR_MAX = 1.85

/**
 * Seitenverhältnis eines Mediums für die Karte — gemessen und geklemmt.
 *
 * Der entscheidende Teil ist, dass überhaupt GEMESSEN wird: Ein fest gesetztes
 * 3:2 mit `object-fit: cover` schneidet ein Hochformat auf den Mittelstreifen,
 * und genau den will die Karte zeigen. Mit passendem Rahmen füllt `cover` das
 * Bild, ohne etwas wegzunehmen.
 *
 * `null` bei unbekannten Maßen (Bild noch nicht geladen, Video ohne Metadaten)
 * — der Aufrufer lässt dann das bisherige Verhältnis stehen, statt auf einen
 * Vorgabewert zurückzuspringen: Ein Zwischen-Reset ließe den Rahmen zucken.
 */
export function klemmeSeitenverhaeltnis(breite: number, hoehe: number): number | null {
  if (!(breite > 0) || !(hoehe > 0)) return null
  return Math.max(AR_MIN, Math.min(AR_MAX, breite / hoehe))
}
