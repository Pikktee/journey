// Wie lange ein Streckenstück im fertigen Film dauert.
//
// Die Kamerafahrt fährt nicht nach der Uhr, sondern nach der STRECKE: pro
// Sekunde legt sie `BASIS_TEMPO_MS` Meter zurück, skaliert mit dem
// Fortbewegungsmittel. Der Server braucht dieselbe Rechnung, um Ereignisse in
// Filmsekunden zu bemessen statt in Metern — 200 m sind zu Fuß gut vier
// Sekunden und auf der Fähre eine halbe.
//
// Die Zahlen sind eine KOPIE der Engine-Konstanten aus src/tour.js
// (`baseSpeed`, `MODE_SPEED`); der Server kann die Datei nicht importieren
// (eigener rootDir, kein allowJs). Ein Drift-Wächter in
// server/test/filmtempo.test.ts vergleicht sie mit deren Quelltext — dieselbe
// Absicherung wie im Studio (src/studio/zeitleiste.ts).

import type { Modus } from '../schema/upload.js'

/** Streckenfortschritt bei 1× (m/s) — src/tour.js `baseSpeed`. */
export const BASIS_TEMPO_MS = 120

/** Tempo-Faktor je Fortbewegung — src/tour.js `MODE_SPEED`. */
export const MODUS_TEMPO: Record<Modus, number> = {
  walk: 0.4,
  bike: 1,
  moped: 1.15,
  jeep: 1.45,
  tram: 1.25,
  ferry: 2.5,
}

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
