// Wie lange ein Streckenstück im fertigen Film dauert.
//
// Die Kamerafahrt fährt nicht nach der Uhr, sondern nach der STRECKE: pro
// Sekunde legt sie `BASE_TEMPO_MS` Meter zurück, skaliert mit dem
// Fortbewegungsmittel. Der Server braucht dieselbe Rechnung, um Ereignisse in
// Filmsekunden zu bemessen statt in Metern — 200 m sind zu Fuß gut vier
// Sekunden und auf der Fähre eine halbe.
//
// Die Zahlen sind eine KOPIE der Engine-Konstanten aus src/tour.ts
// (`baseSpeed`, `MODE_SPEED`); der Server kann die Datei nicht importieren
// (eigener rootDir, kein allowJs). Ein Drift-Wächter in
// server/test/filmtempo.test.ts vergleicht sie mit deren Quelltext — dieselbe
// Absicherung wie im Studio (src/studio/timeline.ts).

import type { CameraMomentKind } from '../schema/edits.js'
import type { TravelMode } from '../schema/upload.js'

/** Streckenfortschritt bei 1× (m/s) — src/tour.ts `baseSpeed`. */
export const BASE_TEMPO_MS = 120

/**
 * Tempo-Faktor je Fortbewegung — Spiegel von `TRAVEL_MODE_TEMPO` in src/film-axis.ts.
 *
 * Gestalterische Zahlen, keine physikalischen; `walk` ging nach dem Abfahren
 * des Rampen-Nachtrags von 0,4 auf 0,5 (zu träge). Wer sie ändert, ändert die
 * Dauer jeder bestehenden Tour — und muss beide Seiten anfassen.
 */
export const TRAVEL_MODE_TEMPO: Record<TravelMode, number> = {
  walk: 0.5,
  bike: 1,
  moped: 1.15,
  jeep: 1.45,
  tram: 1.25,
  ferry: 2.5,
}

/** `HOLD_HIDE` in src/tour.ts: sichtbare Foto-Karte (Default, `display.holdS` übersteuert). */
export const STOP_ENGINE_S = 5.2
/** `HOLD_AUSBLEND` in src/tour.ts: Ausblendung nach der Anzeige, bevor es weitergeht. */
export const STOP_FADE_OUT_S = 0.8
/** `NEAR_M` in src/geo.ts: Streckenabstand, unter dem Aufnahmen EINEN Halt bilden. */
export const NEAR_M = 120

/**
 * `RAMP_M` in src/film-axis.ts: Anfahr- und Ausrollstrecke in Metern (E14).
 *
 * Sie ist der Grund, warum diese Kopie in DERSELBEN Auslieferung mitgeht wie
 * Etappe 4: Kennt die Server-Achse die Rampen nicht, lösen `anker +
 * versatzFilmS` in Studio und Render verschieden auf — exakt die Drift, die
 * Etappe 3 gerade beendet hat. Herleitung der Zahl steht drüben, sie ist
 * gestalterisch und nicht technisch.
 */
export const RAMP_M = 120

/** `MOMENT_DEFAULT_S` in src/tour.ts: Filmzeit eines Kamera-Moments ohne eigene Angabe. */
export const MOMENT_DEFAULT_S: Record<CameraMomentKind, number> = {
  orbit: 6,
  ascend: 5,
  linger: 4,
}

/** Meter, die der Film in dieser Fortbewegung je Sekunde zurücklegt. */
export function tempoMs(mode: TravelMode): number {
  return BASE_TEMPO_MS * (TRAVEL_MODE_TEMPO[mode] ?? 1)
}

/** Strecke (m), die im Film `sekunden` dauert. */
export function metersForFilmSeconds(seconds: number, mode: TravelMode): number {
  return seconds * tempoMs(mode)
}

/** Filmdauer (s) eines Streckenstücks. */
export function filmSeconds(meters: number, mode: TravelMode): number {
  return meters / tempoMs(mode)
}

/**
 * Filmzeit, die EINE Aufnahme am Halt belegt (ohne Ausblendung).
 *
 * Ein Video zählt mit seiner echten Länge — der Player läuft bis zum Dateiende,
 * `display.holdS` ist dort wirkungslos (src/tour.ts). Spiegel von
 * `mediumHoldS` in src/studio/timeline.ts; laufen die beiden auseinander,
 * zeigt die Zeitleiste eine andere Filmdauer, als der Film hat.
 */
export function mediumHoldS(m: {
  type: 'photo' | 'video'
  durationS?: number
  display?: { holdS?: number }
}): number {
  if (m.type === 'video' && m.durationS !== undefined && m.durationS > 0) return m.durationS
  return m.display?.holdS ?? STOP_ENGINE_S
}

/**
 * Filmzeit, die EIN Kamera-Moment kostet — OHNE Ausblendung.
 *
 * Anders als am Foto-Halt: Die Engine (src/tour.ts, Phase `moment`) geht nach
 * `momentDauer` unmittelbar zurück auf `ride`, es gibt kein `HOLD_AUSBLEND`-
 * Nachspiel. Spiegel von `momentDurationS` in src/studio/editor.ts; wer hier die
 * Ausblendung addiert, macht jeden Moment im Render um 0,8 s breiter als in der
 * Zeitleiste — und schiebt damit genau die Ton-Klips, um die es geht.
 */
export function momentHoldS(m: { kind: CameraMomentKind; durationS?: number | undefined }): number {
  return m.durationS ?? MOMENT_DEFAULT_S[m.kind]
}
