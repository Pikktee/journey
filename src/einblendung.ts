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
