// Die Filmachse: aus Strecke wird Filmzeit — der geteilte Kern von Player und
// Studio (Gleichlauf-Konzept §8C, E3/E12).
//
// **Parametrisiert wird über die STRECKE, nicht über die Aufnahmezeit.** Das ist
// keine Wahl, sondern die Vorbedingung von E2: Gebraucht wird Filmsekunde →
// Streckenposition. Über der Aufnahmezeit liefert eine Achse Filmsekunde →
// Aufnahmezeit, und den zweiten Schritt kann der Player nicht gehen — `cfg.time`
// ist Pseudo-Zeit mit Pausen-Zeitraffer, nicht die Aufnahmeuhr; eine Abbildung
// Aufnahmezeit → `f` gibt es dort nicht.
//
// Wer in Aufnahmezeit rechnet (die Zeitleiste des Editors, die Anker von Medien
// und Ton-Klips, `projiziereAufReihe` im Server), braucht deshalb einen
// Zeit→Strecke-ADAPTER. Die Anker selbst bleiben Aufnahme-Zeitstempel: Sie sind
// trim-stabil, und was hier umgestellt wird, ist die Achse, nicht die
// Verankerung.
//
// Diese Datei ist DOM- und importfrei: Player, Studio und Tests benutzen sie
// gleichermaßen. Der Server kann sie NICHT importieren (eigener `rootDir`) und
// führt seinen Spiegel in server/src/pipeline/filmtempo.ts +
// server/src/pipeline/filmachse.ts; beide Seiten rechnen dasselbe
// Verhaltens-Fixture durch (test/fixtures/filmachse.json).

// — Das Tempo-Modell —
//
// Es steht seit Paket D an genau ZWEI Stellen: hier und im Server-Spiegel.
// Vorher waren es drei, gekoppelt über Tests, die den Quelltext von `tour.ts`
// nach Zeichenketten absuchten.

/** Streckenfortschritt bei 1× in m/s (die Engine fährt damit, src/tour.ts). */
export const BASIS_TEMPO_MS = 120

/** Tempo-Faktor je Fortbewegungsmodus. Schlüssel = die Modi des Austauschformats. */
export const MODUS_TEMPO = { walk: 0.4, moped: 1.15, bike: 1, jeep: 1.45, tram: 1.25, ferry: 2.5 }

/**
 * Film-Tempo eines Modus in m/s.
 *
 * Der Modus kommt als freie Zeichenkette herein (Server-Segmente, src/remote.ts)
 * — der Rückfall auf 1 ist deshalb kein Zierrat, sondern der Umgang mit einem
 * unbekannten Modus.
 */
export function tempoMs(mode: string): number {
  return BASIS_TEMPO_MS * ((MODUS_TEMPO as Record<string, number | undefined>)[mode] ?? 1)
}

/** Filmsekunden für eine Strecke im gegebenen Modus. */
export function filmsekunden(meter: number, mode: string): number {
  return meter / tempoMs(mode)
}

/** Standzeit eines Kamera-Moments je Art (s) — Vorgabe ohne eigene Dauer. */
export const MOMENT_DEFAULT_S = { umkreisen: 6, aufstieg: 5, innehalten: 4 }

/**
 * Standzeit eines Kamera-Moments. OHNE Ausblendung — anders als eine Aufnahme:
 * die Engine geht nach der Dauer direkt zurück in die Fahrt (src/tour.ts).
 */
export function momentHaltS(m: { art: string; dauerS?: number | undefined }): number {
  return m.dauerS ?? (MOMENT_DEFAULT_S as Record<string, number | undefined>)[m.art] ?? 5
}

// — Interpolation —

/**
 * Stückweise lineare Auswertung ys(x) über monoton nicht-fallendem xs.
 *
 * lower_bound: erster Index mit `xs[i] ≥ x` — bei Duplikat-Stufen in `xs` landet
 * ein exakter Treffer damit auf der ERSTEN Stützstelle der Stufe, knapp darüber
 * hinter der letzten. Außerhalb wird geklemmt.
 *
 * **Die Konvention „Plateau → Ankunft" bleibt nötig**, sie wechselt nur ihren
 * Ort: Über der Aufnahmezeit waren die Plateaus die realen PAUSEN, über der
 * Strecke sind es die HALTE (§8C). Eine andere Wahl verschöbe jeden Anker, der
 * genau auf einer Halt-Position sitzt, um die ganze Standzeit.
 */
export function interpoliere(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length
  if (n === 0) return 0
  if (x <= (xs[0] as number)) return ys[0] as number
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((xs[mitte] as number) < x) lo = mitte + 1
    else hi = mitte
  }
  const a = xs[lo - 1] as number
  const b = xs[lo] as number
  const spanne = b - a
  const u = spanne > 0 ? (x - a) / spanne : 1
  return (ys[lo - 1] as number) + u * ((ys[lo] as number) - (ys[lo - 1] as number))
}

// — Halte —

/** Ein Halt: wo er liegt (in der x-Größe der Kurve) und was er im Film kostet. */
export interface Halt {
  breiteS: number
}

/** Ein eingewebter Halt: dazu, wo er im FILM liegt. */
export type HaltIntervall<H extends Halt = Halt> = H & { filmVon: number; filmBis: number }

/**
 * Halte als Sprünge einweben: an ihrer Position zwei Stützstellen (Film vor und
 * nach der Standzeit), alle späteren Werte heben sich um die Breite. Aufsteigend
 * gewebt, damit `filmAmHalt` die früheren Halte schon trägt — die Intervalle
 * stimmen ohne Nachrechnen.
 *
 * Die x-Größe bleibt offen (`ort`): über der Strecke sind es Meter (die Achse),
 * über der Aufnahmezeit Sekunden (das Zug-Fenster einer Fortbewegungs-Grenze im
 * Editor). Weben ist in beiden Fällen dieselbe Rechnung, und genau deshalb steht
 * sie einmal.
 */
export function webeHalte<H extends Halt>(
  xs: number[],
  ys: number[],
  halte: readonly H[],
  ort: (h: H) => number,
): Array<HaltIntervall<H>> {
  const intervalle: Array<HaltIntervall<H>> = []
  for (const h of [...halte].sort((a, b) => ort(a) - ort(b))) {
    if (!(h.breiteS > 0)) continue
    const x = ort(h)
    const filmAmHalt = interpoliere(xs, ys, x)
    // Einfügeposition: hinter alle Stützstellen ≤ Halt-Position
    let i = xs.length
    while (i > 0 && (xs[i - 1] as number) > x) i--
    for (let j = i; j < xs.length; j++) ys[j] = (ys[j] as number) + h.breiteS
    xs.splice(i, 0, x, x)
    ys.splice(i, 0, filmAmHalt, filmAmHalt + h.breiteS)
    intervalle.push({ ...h, filmVon: filmAmHalt, filmBis: filmAmHalt + h.breiteS })
  }
  return intervalle
}

// — Die Achse —

/** Ein Streckenabschnitt: ab welchem Meter er gilt und wie der Film ihn fährt. */
export interface Streckenabschnitt {
  /** Streckenmeter, ab dem dieser Modus gilt (der erste zählt ab 0) */
  abM: number
  mode: string
}

/** Ein Halt auf der Strecke: sein Ort in Metern und seine Standzeit im Film. */
export interface Streckenhalt extends Halt {
  meterM: number
}

/**
 * Strecke ↔ Filmzeit, stückweise linear.
 *
 * `sM` ist nicht streng monoton: Jeder Halt liegt als PAAR gleicher Meterwerte
 * darin (Ankunft und Abfahrt) — das Plateau, in dem der Film läuft und die
 * Strecke steht. Genau dafür ist die Achse da.
 */
export interface Filmachse<H extends Streckenhalt = Streckenhalt> {
  sM: number[]
  filmS: number[]
  gesamtM: number
  gesamtS: number
  halte: Array<HaltIntervall<H>>
}

/**
 * Die Filmachse aus Abschnitten und Halten.
 *
 * Innerhalb eines Abschnitts ist die Abbildung EXAKT linear (Strecke ÷ Tempo) —
 * Stützstellen je Trackpunkt braucht es dafür nicht. Wer sie hat (der Editor),
 * legt seinen Zeit→Strecke-Adapter daneben, statt sie in die Achse zu tragen.
 *
 * **Die Meter müssen ROH sein, nicht die der gebauten Route:** Catmull-Rom und
 * das 14-m-Raster machen die Route 2,2–3,0 % länger, und die Dehnung verteilt
 * sich ungleichmäßig — die Filmdauer wäre allein durch die Glättung zu lang
 * (§8C, Falle 2).
 */
export function baueFilmachse<H extends Streckenhalt>(
  abschnitte: readonly Streckenabschnitt[],
  gesamtM: number,
  halte: readonly H[],
): Filmachse<H> {
  const sM: number[] = [0]
  const filmS: number[] = [0]
  let film = 0
  let vonM = 0
  let mode = abschnitte[0]?.mode ?? 'bike'
  for (const a of abschnitte.slice(1)) {
    const bisM = Math.max(vonM, Math.min(gesamtM, a.abM))
    if (bisM > vonM) {
      film += filmsekunden(bisM - vonM, mode)
      sM.push(bisM)
      filmS.push(film)
    }
    vonM = bisM
    mode = a.mode
  }
  if (gesamtM > vonM) {
    film += filmsekunden(gesamtM - vonM, mode)
    sM.push(gesamtM)
    filmS.push(film)
  }

  const intervalle = webeHalte(sM, filmS, halte, (h) => Math.max(0, Math.min(gesamtM, h.meterM)))
  return { sM, filmS, gesamtM, gesamtS: filmS[filmS.length - 1] as number, halte: intervalle }
}

/** Nur die Stützstellen — beide Auswertungen brauchen die Halt-Liste nicht. */
type Stuetzstellen = { sM: readonly number[]; filmS: readonly number[] }

/** Filmsekunde an einer Streckenposition (im Halt → seine Ankunft). */
export function filmBeiStrecke(achse: Stuetzstellen, meterM: number): number {
  return interpoliere(achse.sM, achse.filmS, meterM)
}

/**
 * Streckenposition zu einer Filmsekunde — die Richtung, für die es die Achse
 * gibt (E2). Im Halt steht die Strecke: jede Filmsekunde darin liefert seinen
 * Ort.
 */
export function streckeBeiFilm(achse: Stuetzstellen, filmS: number): number {
  return interpoliere(achse.filmS, achse.sM, filmS)
}

/**
 * Steht die Filmsekunde in einem Halt — und in welchem?
 *
 * Die Ankunft (`filmVon`) zählt dazu, die Abfahrt (`filmBis`) nicht: dort läuft
 * die Fahrt schon wieder.
 */
export function haltBeiFilm<H extends Streckenhalt>(
  achse: Filmachse<H>,
  filmS: number,
): HaltIntervall<H> | null {
  for (const halt of achse.halte) {
    if (filmS < halt.filmVon) return null // Halte sind sortiert
    if (filmS < halt.filmBis) return halt
  }
  return null
}
