// Wie lange ein Streckenstück im fertigen Film dauert.
//
// Die Kamerafahrt fährt nicht nach der Uhr, sondern nach der STRECKE: pro
// Sekunde legt sie `BASIS_TEMPO_MS` Meter zurück, skaliert mit dem
// Fortbewegungsmittel. Der Server braucht dieselbe Rechnung, um Ereignisse in
// Filmsekunden zu bemessen statt in Metern — 200 m sind zu Fuß gut vier
// Sekunden und auf der Fähre eine halbe.
//
// Die Zahlen sind eine KOPIE der Engine-Konstanten aus src/tour.ts
// (`baseSpeed`, `MODE_SPEED`); der Server kann die Datei nicht importieren
// (eigener rootDir, kein allowJs). Ein Drift-Wächter in
// server/test/filmtempo.test.ts vergleicht sie mit deren Quelltext — dieselbe
// Absicherung wie im Studio (src/studio/zeitleiste.ts).

import type { MomentArt } from '../schema/edits.js'
import type { Modus } from '../schema/upload.js'

/** Streckenfortschritt bei 1× (m/s) — src/tour.ts `baseSpeed`. */
export const BASIS_TEMPO_MS = 120

/** Tempo-Faktor je Fortbewegung — src/tour.ts `MODE_SPEED`. */
export const MODUS_TEMPO: Record<Modus, number> = {
  walk: 0.4,
  bike: 1,
  moped: 1.15,
  jeep: 1.45,
  tram: 1.25,
  ferry: 2.5,
}

/** `HOLD_HIDE` in src/tour.ts: sichtbare Foto-Karte (Default, `display.holdS` übersteuert). */
export const HALT_ENGINE_S = 5.2
/** `HOLD_AUSBLEND` in src/tour.ts: Ausblendung nach der Anzeige, bevor es weitergeht. */
export const HALT_AUSBLEND_S = 0.8
/** `NAHE_M` in src/geo.ts: Streckenabstand, unter dem Aufnahmen EINEN Halt bilden. */
export const NAHE_M = 120

/** `MOMENT_DEFAULT_S` in src/tour.ts: Filmzeit eines Kamera-Moments ohne eigene Angabe. */
export const MOMENT_DEFAULT_S: Record<MomentArt, number> = { umkreisen: 6, aufstieg: 5, innehalten: 4 }

/** Meter, die der Film in dieser Fortbewegung je Sekunde zurücklegt. */
export function tempoMs(mode: Modus): number {
  return BASIS_TEMPO_MS * (MODUS_TEMPO[mode] ?? 1)
}

/** Strecke (m), die im Film `sekunden` dauert. */
export function meterFuerFilmsekunden(sekunden: number, mode: Modus): number {
  return sekunden * tempoMs(mode)
}

/** Filmdauer (s) eines Streckenstücks. */
export function filmsekunden(meter: number, mode: Modus): number {
  return meter / tempoMs(mode)
}

/**
 * Filmzeit, die EINE Aufnahme am Halt belegt (ohne Ausblendung).
 *
 * Ein Video zählt mit seiner echten Länge — der Player läuft bis zum Dateiende,
 * `display.holdS` ist dort wirkungslos (src/tour.ts). Spiegel von
 * `aufnahmeHaltS` in src/studio/zeitleiste.ts; laufen die beiden auseinander,
 * zeigt die Zeitleiste eine andere Filmdauer, als der Film hat.
 */
export function aufnahmeHaltS(m: { type: 'photo' | 'video'; dauerS?: number; display?: { holdS?: number } }): number {
  if (m.type === 'video' && m.dauerS !== undefined && m.dauerS > 0) return m.dauerS
  return m.display?.holdS ?? HALT_ENGINE_S
}

/**
 * Filmzeit, die EIN Kamera-Moment kostet — OHNE Ausblendung.
 *
 * Anders als am Foto-Halt: Die Engine (src/tour.ts, Phase `moment`) geht nach
 * `momentDauer` unmittelbar zurück auf `ride`, es gibt kein `HOLD_AUSBLEND`-
 * Nachspiel. Spiegel von `momentDauerS` in src/studio/editor.ts; wer hier die
 * Ausblendung addiert, macht jeden Moment im Render um 0,8 s breiter als in der
 * Zeitleiste — und schiebt damit genau die Ton-Klips, um die es geht.
 */
export function momentHaltS(m: { art: MomentArt; dauerS?: number | undefined }): number {
  return m.dauerS ?? MOMENT_DEFAULT_S[m.art]
}
