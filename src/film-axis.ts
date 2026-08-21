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
// server/src/pipeline/film-axis.ts; beide Seiten rechnen dasselbe
// Verhaltens-Fixture durch (test/fixtures/filmachse.json).

// — Das Tempo-Modell —
//
// Es steht seit Paket D an genau ZWEI Stellen: hier und im Server-Spiegel.
// Vorher waren es drei, gekoppelt über Tests, die den Quelltext von `tour.ts`
// nach Zeichenketten absuchten.

/** Streckenfortschritt bei 1× in m/s (die Engine fährt damit, src/tour.ts). */
export const BASE_TEMPO_MPS = 120

/**
 * Tempo-Faktor je Fortbewegungsmodus. Schlüssel = die Modi des Austauschformats.
 *
 * **Gestalterische Zahlen**, keine physikalischen: Sie sagen, wie sich eine
 * Fortbewegung im FILM anfühlen soll, nicht wie schnell man sich wirklich
 * bewegt. `walk` stand bis zum Abfahren des Rampen-Nachtrags auf 0,4 und wirkte
 * einen Tick zu träge — 0,5 ist die Korrektur daran. Wer hier etwas ändert,
 * ändert die Dauer JEDER bestehenden Tour (s. scripts/messungen/filmdauer.ts)
 * und muss den Spiegel in server/src/pipeline/filmtempo.ts mitnehmen.
 */
export const TRAVEL_MODE_TEMPO = {
  walk: 0.5,
  moped: 1.15,
  bike: 1,
  jeep: 1.45,
  tram: 1.25,
  ferry: 2.5,
}

/**
 * Film-Tempo eines Modus in m/s.
 *
 * Der Modus kommt als freie Zeichenkette herein (Server-Segmente, src/remote.ts)
 * — der Rückfall auf 1 ist deshalb kein Zierrat, sondern der Umgang mit einem
 * unbekannten Modus.
 */
export function tempoMps(mode: string): number {
  return BASE_TEMPO_MPS * ((TRAVEL_MODE_TEMPO as Record<string, number | undefined>)[mode] ?? 1)
}

/** Filmsekunden für eine Strecke im gegebenen Modus. */
export function filmSeconds(meters: number, mode: string): number {
  return meters / tempoMps(mode)
}

/** Standzeit eines Kamera-Moments je Art (s) — Vorgabe ohne eigene Dauer. */
export const MOMENT_DEFAULT_S = { orbit: 6, ascend: 5, linger: 4 }

/**
 * Standzeit eines Kamera-Moments. OHNE Ausblendung — anders als eine Aufnahme:
 * die Engine geht nach der Dauer direkt zurück in die Fahrt (src/tour.ts).
 */
export function momentHoldS(m: { kind: string; durationS?: number | undefined }): number {
  return m.durationS ?? (MOMENT_DEFAULT_S as Record<string, number | undefined>)[m.kind] ?? 5
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
export function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length
  if (n === 0) return 0
  if (x <= (xs[0] as number)) return ys[0] as number
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((xs[mid] as number) < x) lo = mid + 1
    else hi = mid
  }
  const a = xs[lo - 1] as number
  const b = xs[lo] as number
  const span = b - a
  const u = span > 0 ? (x - a) / span : 1
  return (ys[lo - 1] as number) + u * ((ys[lo] as number) - (ys[lo - 1] as number))
}

// — Halte —

/** Ein Halt: wo er liegt (in der x-Größe der Kurve) und was er im Film kostet. */
export interface AxisStop {
  widthS: number
}

/** Ein eingewebter Halt: dazu, wo er im FILM liegt. */
export type StopInterval<H extends AxisStop = AxisStop> = H & { filmFrom: number; filmTo: number }

// — Die Rampe (E14) —
//
// Anfahren und Ausrollen sind seit Etappe 4 eine FORM IN DER KURVE, keine
// emergente Eigenschaft einer Differentialgleichung mehr. Vorher strebte
// `speed` sein Ziel exponentiell an (τ = 1,1 s beim Anfahren, 0,55 s beim
// Ausrollen): kräftig vorn, dann immer sanfter, **ohne definiertes Ende** — und
// die Dauer hing am Tempo. Genau diese Unschärfe war der Grund, warum die
// Halt-Breite im Studio nie stimmen konnte.
//
// Drei Folgen der festen Form: Die Halt-Breite wird EXAKT, die Rampe ist im
// Editor zeichenbar, und sie passt zur Achse, die seit E12 ohnehin über der
// STRECKE rechnet (eine Rampe über feste ZEIT müsste dort rückwärts aufgelöst
// werden).
//
// **Die Rampe gilt für JEDEN Tempowechsel, nicht nur für Halte** (Nachtrag zu
// Etappe 4). Ein Halt ist seither der Sonderfall „Wechsel von oder auf null".
// Der erste Wurf rampte nur um Halte herum und ließ Modus-Grenzen springen —
// bei Stockholm von zu Fuß auf Fähre in einem Frame, Faktor 6,25. Die alte
// Engine hatte das nicht: Ihr Tiefpass lag auf JEDER Tempoänderung. Sichtbar
// wurde es erst zusammen mit der Kamera, die weiter geglättet folgt: erst
// schnell und nah, dann schnell und weit — „auf einen Schlag sehr schnell,
// wird dann aber scheinbar langsamer".

/**
 * Weganteil der Rampe nach dem Zeitanteil `u` (0..1), von Tempo `v0` auf `v1`.
 *
 * Die Geschwindigkeit folgt `v(u) = v0 + (v1 − v0) · smoothstep(u)`: sanft an,
 * in der MITTE am stärksten, sanft ins neue Tempo — Beschleunigung an beiden
 * Enden null, also kein Ruck. Integriert ergibt das
 *
 *     w(u) = [v0·u + (v1 − v0)·(u³ − u⁴/2)] / ((v0 + v1)/2)
 *
 * und daraus die zwei Zahlen, die die Rechnung tragen: `w(1) = 1` (die Rampe
 * fährt genau ihre Strecke) und die **Dauer `T = 2L / (v0 + v1)`** — die Strecke
 * geteilt durch das MITTLERE Tempo.
 *
 * Für `v0 = 0` fällt daraus exakt die Halt-Rampe heraus (`w = 2u³ − u⁴`,
 * `T = 2L/v1`): Die Verallgemeinerung geht stetig in die frühere Form über,
 * Halte rechnen weiter dasselbe.
 */
const rampDistance = (u: number, v0: number, v1: number): number => {
  const mean = (v0 + v1) / 2
  if (!(mean > 0)) return u
  return (v0 * u + (v1 - v0) * (u * u * u - (u * u * u * u) / 2)) / mean
}

/**
 * Stützstellen je Rampe. Die Kurve wird stückweise linear abgetastet — 12
 * Stufen halten den Fehler unter einem Prozent der Rampenzeit und kosten bei
 * zwölf Halten rund 300 Punkte.
 */
const RAMP_STEPS = 12

/**
 * Rampenstrecke in Metern — **die eine gestalterische Zahl der Rampe**,
 * kalibriert und nicht geraten.
 *
 * Kalibriert an den Rampen der alten Engine, damit sich die Fahrt nicht
 * sprunghaft anders anfühlt — die Summe über die vier Fixtur-Touren beträgt
 * 64,3 Rampen-Sekunden ([rampen-simulation.ts](../scripts/messungen/rampen-simulation.ts):
 * 32,4 · 14,7 · 1,3 · 15,9). Am HALT ist der Zuschlag `Länge ÷ Tempo`, ein Halt
 * kostet also `2 L / v`; **120 m** treffen die Summe auf 3,3 % genau (62,2 s),
 * nachgerechnet mit
 * [rampen-kalibrierung.ts](../scripts/messungen/rampen-kalibrierung.ts).
 *
 * Die VERTEILUNG ändert sich dabei bewusst, und das ist keine Ungenauigkeit,
 * sondern der Kern von E14: Früher WUCHS der Zuschlag mit dem Tempo (die
 * Exponentialkurve brauchte bei Vollgas länger, 2,70 s je Halt auf der
 * 41-km-Tour gegen 0,44 s auf der kurzen), jetzt FÄLLT er damit — dieselbe
 * Strecke ist schneller durchfahren. Die schnelle Tour verliert deshalb
 * Rampenzeit (32,4 → 22,0 s), die überwiegend gegangene gewinnt welche
 * (14,7 → 24,2 s): Der Antritt wirkt bei Tempo knackiger und zu Fuß getragener.
 *
 * **Am Halt liegt die volle Länge auf JEDER Seite** (bremsen davor, anfahren
 * danach); an einer Modus-Grenze liegt sie EINMAL und ganz im **schnelleren**
 * Abschnitt — beim Beschleunigen hinter der Grenze, beim Verzögern davor.
 *
 * Das war zuerst symmetrisch (halbe Länge auf jede Seite) und das war falsch:
 * Die halbe Rampe lag dann im LANGSAMEREN Abschnitt, also ging man die letzten
 * 60 m zum Anleger schon mit anlaufendem Fährtempo — an Stockholm gemessen mit
 * dem 5,3-Fachen des Fußgängertempos, mit dem Fußgänger-Marker auf der Karte.
 * Beim Aussteigen dasselbe rückwärts (6,6-Faches). Im schnelleren Abschnitt
 * stimmt es auch inhaltlich: Die Fähre beschleunigt, nachdem man eingestiegen
 * ist, und der Wagen bremst, bevor man aussteigt.
 *
 * **Kollidieren zwei Rampen, teilen sie sich die Lücke** — anteilig nach dem,
 * was sie bräuchten, was bei zwei gleich langen genau die Hälfte ist. Sonst
 * überlappten sie, und die Achse liefe rückwärts. Auf der kurzen Fixtur-Tour
 * (356 m zwischen drei Halten) greift das durchgehend: Ihre Rampen bleiben bei
 * 3,0 s, egal wie lang `RAMP_M` steht.
 */
export const RAMP_M = 120

/**
 * Was eine Modus-Rampe VOR ihrer Grenze gegenüber reiner Reise kostet (s).
 *
 * Für das Zug-Fenster einer Fortbewegungs-Grenze im Editor
 * ([timeline.ts](studio/timeline.ts), `buildBoundaryCurve`): Dessen Kurve
 * rechnet das Fenster durchgehend im LINKEN Modus, weil die Filmposition der
 * Kante nur von dem abhängt, was vor ihr liegt.
 *
 * Beim BESCHLEUNIGEN ist das seit der Verlegung der Rampe wieder exakt — sie
 * liegt dann ganz hinter der Grenze, vor ihr fährt der Film unverändert `v0`.
 * Beim VERZÖGERN liegt die ganze Rampe davor und ersetzt `rampeM` Meter Reise
 * durch die Rampendauer. Der Betrag ist KONSTANT (er hängt nur an den beiden
 * Tempi und der Rampenlänge, nicht daran, wo die Kante steht), verschiebt die
 * Kurve also bloß und lässt sie umkehrbar.
 */
export function rampOffsetS(v0: number, v1: number, rampM: number = RAMP_M): number {
  if (!(rampM > 0) || !(v0 > 0) || !(v1 > 0) || v1 >= v0) return 0
  return (2 * rampM) / (v0 + v1) - rampM / v0
}

/** Wie die Achse ihre Rampen setzt. */
export interface RampChoice {
  /**
   * Anfahr- und Ausrollstrecke in Metern; Vorgabe `RAMP_M`. `0` baut die reine
   * Reise-Achse — dafür gibt es genau einen Grund, und der sind die Tests: Sie
   * beschreiben das Weben der HALTE, und mit Rampe stünde in jeder Erwartung
   * noch deren Zuschlag.
   */
  rampM?: number
  /**
   * Mit welchem Tempo (m/s) betritt der Film dieses Stück?
   *
   * Vorgabe `0` — eine Tour fährt aus dem Stand los, und daraus wird die
   * Anfahr-Rampe. Das Zug-Fenster einer Fortbewegungs-Grenze (`buildBoundaryCurve`
   * im Editor) beginnt dagegen mitten in der Fahrt: Dort gibt es kein Anfahren,
   * sondern höchstens einen Tempowechsel an der linken Kante. `null` heißt
   * „kein Wechsel, der Film läuft schon im Tempo des ersten Abschnitts".
   */
  startTempoMs?: number | null
}

// — Die Achse —

/**
 * Ein Tempowechsel, wie ihn die KAMERA braucht: die beiden Modi und das
 * Streckenfenster, über das die Achse zwischen ihnen überblendet.
 *
 * Ohne das hinge die Kameradistanz an einer eigenen Uhr: Sie zieht mit
 * τ = 2,2 s nach (~6 s bis sie steht), die Rampe ist in unter einer Sekunde
 * fertig. Dazwischen fährt man Fährtempo mit einer Fußgänger-Kamera — an
 * Stockholm gemessen mit dem 2,3-Fachen des sonstigen Bildschirm-Tempos. Über
 * dasselbe Fenster geführt bleibt es stetig, ohne neue gestalterische Zahl.
 */
export interface TravelModeTransition {
  fromM: number
  toM: number
  fromMode: string
  toMode: string
}

/** Ein Streckenabschnitt: ab welchem Meter er gilt und wie der Film ihn fährt. */
export interface DistanceSegment {
  /** Streckenmeter, ab dem dieser Modus gilt (der erste zählt ab 0) */
  fromM: number
  mode: string
}

/** Ein Halt auf der Strecke: sein Ort in Metern und seine Standzeit im Film. */
export interface DistanceStop extends AxisStop {
  meterM: number
}

/**
 * Strecke ↔ Filmzeit, stückweise linear.
 *
 * `sM` ist nicht streng monoton: Jeder Halt liegt als PAAR gleicher Meterwerte
 * darin (Ankunft und Abfahrt) — das Plateau, in dem der Film läuft und die
 * Strecke steht. Genau dafür ist die Achse da.
 */
export interface FilmAxis<H extends DistanceStop = DistanceStop> {
  sM: number[]
  filmS: number[]
  totalM: number
  totalS: number
  stops: Array<StopInterval<H>>
  /** Die Fenster, in denen die Achse zwischen zwei Modi überblendet (für die Kamera) */
  transitions: TravelModeTransition[]
  /**
   * Die Fortbewegung über der Strecke, wie die ACHSE sie führt.
   *
   * Nicht dieselbe Liste wie die Modus-Grenzen der Tour: Ein Tempowechsel dicht
   * an einem Halt ist hier auf den Halt gezogen. Wer die rohen Grenzen fragt,
   * bekommt für die Meter dazwischen eine Fortbewegung, die die Achse gar nicht
   * mehr fährt — der Fußgänger-Marker liefe dann mit Fährtempo über die Karte.
   */
  modes: Array<{ fromM: number; mode: string }>
}

/** Das Tempo (m/s), das die Achse an einem Streckenmeter gerade fährt. */
export function tempoAtDistance(axis: Pick<FilmAxis, 'sM' | 'filmS'>, meterM: number): number {
  const { sM, filmS } = axis
  const n = sM.length
  if (n < 2) return 0
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sM[mid] as number) < meterM) lo = mid + 1
    else hi = mid
  }
  // Halt-Plateaus (gleiche Meter, wachsende Filmzeit) tragen kein Tempo — das
  // nächste fahrende Stück gilt.
  for (let i = Math.max(1, lo); i < n; i++) {
    const dm = (sM[i] as number) - (sM[i - 1] as number)
    const df = (filmS[i] as number) - (filmS[i - 1] as number)
    if (dm > 0 && df > 0) return dm / df
  }
  return 0
}

/**
 * Die Modus-Mischung an einem Streckenmeter: welche zwei Modi, und wie weit
 * zwischen ihnen. `anteil` 0 = ganz `vonMode`, 1 = ganz `nachMode`.
 *
 * **Gemischt wird nach dem TEMPO, nicht nach der Strecke.** Das ist der Punkt:
 * Die Rampe ist eine Form über der ZEIT (nach halber Rampenzeit sind aus dem
 * Stand erst 3/16 der Strecke gefahren), eine Mischung über die Strecke hinkte
 * ihr also nach — die Kamera stünde noch nah, während das Tempo längst oben
 * ist. Am Tempo geführt bleibt `Tempo ÷ Kameradistanz` über den ganzen Wechsel
 * stetig, und genau darauf sind die Modi abgestimmt.
 *
 * Außerhalb eines Übergangs sind beide Modi derselbe — der Aufrufer muss also
 * nicht unterscheiden.
 */
export function travelModeMix(
  axis: Pick<FilmAxis, 'transitions' | 'sM' | 'filmS'>,
  meterM: number,
  modeAt: (m: number) => string,
): { fromMode: string; toMode: string; fraction: number } {
  for (const u of axis.transitions) {
    if (meterM < u.fromM) break // aufsteigend gesammelt
    if (meterM < u.toM) {
      const v0 = tempoMps(u.fromMode)
      const v1 = tempoMps(u.toMode)
      const span = v1 - v0
      const raw = span === 0 ? 1 : (tempoAtDistance(axis, meterM) - v0) / span
      return { fromMode: u.fromMode, toMode: u.toMode, fraction: Math.max(0, Math.min(1, raw)) }
    }
  }
  const mode = modeAt(meterM)
  return { fromMode: mode, toMode: mode, fraction: 1 }
}

/** Ein Punkt der Achse, an dem sich das Tempo ändert — und wie viel Rampe er will. */
interface RampNode<H extends DistanceStop> {
  at: number
  /** Halte an genau dieser Stelle (mehrere, wenn sie in derselben Pause liegen) */
  stops: H[]
  /** Tempo links und rechts des Knotens (m/s); am Halt ist es dazwischen null */
  vLeft: number
  vRight: number
  modeLeft: string
  modeRight: string
  /** Rampenlänge, die der Knoten links/rechts BRÄUCHTE, und was er nach dem Teilen bekommt */
  wantL: number
  wantR: number
  lenL: number
  lenR: number
}

/**
 * Die Filmachse aus Abschnitten und Halten.
 *
 * Zwischen den Rampen ist die Abbildung exakt linear (Strecke ÷ Tempo) —
 * Stützstellen je Trackpunkt braucht es dafür nicht. Wer sie hat (der Editor),
 * legt seinen Zeit→Strecke-Adapter daneben, statt sie in die Achse zu tragen.
 * Nichtlinear wird die Achse genau dort, wo sich das TEMPO ändert: am Start,
 * an jedem Halt und an jeder Modus-Grenze.
 *
 * Gebaut wird in drei Schritten und einem Durchgang: die Tempo-Stufen über der
 * Strecke, daraus die Rampenknoten samt Teilung der Lücken, dann von vorn nach
 * hinten Reise · Rampe · Halt-Plateau · Rampe. Ein nachträgliches Einweben (die
 * frühere `webeHalte`) ginge nicht: Wie lang eine Rampe wird, hängt davon ab,
 * wie viel Platz zwischen ihren Nachbarn ist.
 *
 * **Die Meter müssen ROH sein, nicht die der gebauten Route:** Catmull-Rom und
 * das 14-m-Raster machen die Route 2,2–3,0 % länger, und die Dehnung verteilt
 * sich ungleichmäßig — die Filmdauer wäre allein durch die Glättung zu lang
 * (§8C, Falle 2).
 */
export function buildFilmAxis<H extends DistanceStop>(
  segments: readonly DistanceSegment[],
  totalM: number,
  stops: readonly H[],
  choice: RampChoice = {},
): FilmAxis<H> {
  const rampM = choice.rampM ?? RAMP_M
  const startTempoMs = choice.startTempoMs === undefined ? 0 : choice.startTempoMs

  // — 1. Das Tempo über der Strecke, als Stufenfunktion —
  //
  // Aufeinanderfolgende Abschnitte mit demselben Tempo werden zusammengelegt:
  // Ein Segmentwechsel ohne Tempowechsel ist keine Kante und braucht keine
  // Rampe (dieselbe Fahrt, nur ein anderer Eintrag im Manifest).
  const firstMode = segments[0]?.mode ?? 'bike'
  const steps: Array<{ fromM: number; v: number; mode: string }> = [
    { fromM: 0, v: tempoMps(firstMode), mode: firstMode },
  ]
  {
    let fromM = 0
    for (const a of segments.slice(1)) {
      const toM = Math.max(fromM, Math.min(totalM, a.fromM))
      fromM = toM
      const v = tempoMps(a.mode)
      const last = steps[steps.length - 1] as { fromM: number; v: number; mode: string }
      if (last.fromM === toM) {
        last.v = v
        last.mode = a.mode
      } else if (last.v !== v) steps.push({ fromM: toM, v, mode: a.mode })
    }
  }
  // — 1b. Tempowechsel in der Rampenzone eines Halts wandern AUF den Halt —
  //
  // Sonst quetschen sich Wechsel- und Halt-Rampe in die paar Meter dazwischen,
  // und der Film beschleunigt auf voller Höhe, um sofort wieder zu stehen. An
  // Stockholm gemessen: Die Grenze zu Fuß → Fähre liegt 13 m vor einem Halt,
  // der Film ging dort in 0,36 s auf Fährtempo und in 0,06 s zurück auf null.
  // Auf den Halt gezogen stimmt es auch inhaltlich — man bremst ohnehin, und
  // die neue Fortbewegung beginnt mit der Weiterfahrt (dort steigt man ja ein).
  const stopPositions = stops
    .filter((h) => h.widthS > 0)
    .map((h) => Math.max(0, Math.min(totalM, h.meterM)))
    .sort((a, b) => a - b)
  if (rampM > 0 && stopPositions.length > 0 && steps.length > 1) {
    for (const st of steps.slice(1)) {
      let next: number | undefined
      for (const o of stopPositions) {
        const gap = Math.abs(o - st.fromM)
        if (gap < rampM && (next === undefined || gap < Math.abs(next - st.fromM))) next = o
      }
      if (next !== undefined) st.fromM = next
    }
    // Nach dem Ziehen neu ordnen: gleiche Stelle → die spätere gilt, gleiches
    // Tempo → keine Kante.
    steps.sort((a, b) => a.fromM - b.fromM)
    const moved: Array<{ fromM: number; v: number; mode: string }> = []
    for (const st of steps) {
      const last = moved[moved.length - 1]
      if (!last) moved.push(st)
      else if (last.fromM === st.fromM) {
        last.v = st.v
        last.mode = st.mode
      } else if (last.v !== st.v) moved.push(st)
    }
    steps.length = 0
    steps.push(...moved)
  }

  const tempoAt = (m: number): number => {
    let v = (steps[0] as { v: number }).v
    for (const st of steps) if (st.fromM <= m) v = st.v
    return v
  }
  const modeAtM = (m: number): string => {
    let mode = (steps[0] as { mode: string }).mode
    for (const st of steps) if (st.fromM <= m) mode = st.mode
    return mode
  }

  // — 2. Die Rampenknoten —
  //
  // Halte ohne Breite kosten nichts und bremsen deshalb auch nicht. Sortiert
  // wird nach dem ORT; die Sortierung ist stabil, also behalten Halte auf
  // demselben Meterstand (mehrere in derselben realen Pause) ihre Reihenfolge.
  const nodes: Array<RampNode<H>> = []
  const nodeAt = (at: number): RampNode<H> => {
    const found = nodes.find((k) => k.at === at)
    if (found) return found
    const fresh: RampNode<H> = {
      at,
      stops: [],
      vLeft: at <= 0 ? (startTempoMs ?? tempoAt(0)) : tempoAt(at - 1e-9),
      vRight: at >= totalM ? 0 : tempoAt(at),
      modeLeft: modeAtM(Math.max(0, at - 1e-9)),
      modeRight: modeAtM(Math.min(totalM, at)),
      wantL: 0,
      wantR: 0,
      lenL: 0,
      lenR: 0,
    }
    nodes.push(fresh)
    return fresh
  }
  nodeAt(0)
  nodeAt(totalM)
  for (const st of steps.slice(1)) if (st.fromM > 0 && st.fromM < totalM) nodeAt(st.fromM)
  for (const h of stops) {
    if (!(h.widthS > 0)) continue
    nodeAt(Math.max(0, Math.min(totalM, h.meterM))).stops.push(h)
  }
  nodes.sort((a, b) => a.at - b.at)

  for (const k of nodes) {
    const atStart = k.at <= 0
    const atEnd = k.at >= totalM
    if (k.stops.length > 0) {
      // Ein Halt ist der Sonderfall „Wechsel von oder auf null" — und der
      // einzige, bei dem die volle Länge auf JEDE Seite gehört.
      k.wantL = atStart ? 0 : rampM
      k.wantR = atEnd ? 0 : rampM
    } else if (atStart) {
      // Der Eintritt ins Stück ist selbst ein Tempowechsel — aus dem Stand die
      // Anfahrt, mitten in der Fahrt der Wechsel an der linken Kante. Beides
      // liegt im schnelleren Abschnitt, hier also dahinter (nach vorn ist kein
      // Platz).
      k.wantR = k.vRight > k.vLeft ? rampM : 0
    } else if (!atEnd) {
      // Modus-Grenze: EINE Rampe, ganz im SCHNELLEREN Abschnitt (s. RAMPE_M).
      if (k.vRight > k.vLeft) k.wantR = rampM
      else k.wantL = rampM
    }
    // Am Tour-ENDE wird nicht gebremst: Der Film läuft dort aus.
  }

  // Kollidierende Rampen teilen sich die Lücke ANTEILIG nach ihrem Bedarf — bei
  // zwei gleich langen ist das genau die Hälfte, und zwischen Halt (volle
  // Länge) und Modus-Grenze (halbe) bleibt das Verhältnis erhalten.
  for (let i = 0; i + 1 < nodes.length; i++) {
    const left = nodes[i] as RampNode<H>
    const right = nodes[i + 1] as RampNode<H>
    const gap = Math.max(0, right.at - left.at)
    const need = left.wantR + right.wantL
    const factor = need > gap ? (need > 0 ? gap / need : 0) : 1
    left.lenR = left.wantR * factor
    right.lenL = right.wantL * factor
  }

  // — 3. Der Durchgang —
  const sM: number[] = [0]
  const filmS: number[] = [0]
  const intervals: Array<StopInterval<H>> = []
  const transitions: TravelModeTransition[] = []
  let pos = 0
  let film = 0

  const put = (m: number, f: number): void => {
    const n = sM.length
    if (n > 0 && sM[n - 1] === m && filmS[n - 1] === f) return
    sM.push(m)
    filmS.push(f)
  }

  /** Reisen bis `to` — an jeder Tempo-Stufe unterwegs eine Stützstelle. */
  const travel = (to: number): void => {
    while (pos < to) {
      let nextStop = to
      for (const st of steps) if (st.fromM > pos && st.fromM < nextStop) nextStop = st.fromM
      film += (nextStop - pos) / tempoAt(pos)
      pos = nextStop
      put(pos, film)
    }
  }

  /**
   * Eine Rampe abtasten: `laenge` Meter von Tempo `v0` auf `v1`.
   *
   * Sie dauert `2L / (v0 + v1)` — Strecke durch das mittlere Tempo. Am Halt
   * (`v0` oder `v1` null) ist das die doppelte Reisezeit, ihr Zuschlag also
   * genau eine Reisezeit; an einer Modus-Grenze ist sie sogar KÜRZER als das
   * Fahren derselben Strecke in zwei Hälften, weil man das langsamere Tempo
   * früher verlässt.
   */
  const ramp = (from: number, length: number, v0: number, v1: number): void => {
    if (!(length > 0) || !(v0 + v1 > 0)) return
    const duration = (2 * length) / (v0 + v1)
    const base = film
    for (let k = 1; k <= RAMP_STEPS; k++) {
      const u = k / RAMP_STEPS
      put(from + length * rampDistance(u, v0, v1), base + duration * u)
    }
    film = base + duration
    pos = from + length
  }

  for (const k of nodes) {
    travel(k.at - k.lenL)
    // Wechselt der MODUS hier, blendet die Kamera über dieselbe Strecke über.
    // Am Halt gehört das Fenster der Ausfahrt: Während der Standzeit steht die
    // Kamera ohnehin, und die neue Fortbewegung beginnt mit der Weiterfahrt.
    if (k.modeLeft !== k.modeRight) {
      const fromM = k.stops.length > 0 ? k.at : k.at - k.lenL
      const toM = k.at + k.lenR
      if (toM > fromM) transitions.push({ fromM, toM, fromMode: k.modeLeft, toMode: k.modeRight })
    }
    if (k.stops.length > 0) {
      ramp(pos, k.lenL, k.vLeft, 0)
      for (const h of k.stops) {
        put(k.at, film)
        sM.push(k.at)
        filmS.push(film + h.widthS)
        intervals.push({ ...h, filmFrom: film, filmTo: film + h.widthS })
        film += h.widthS
      }
      pos = k.at
      ramp(k.at, k.lenR, 0, k.vRight)
    } else {
      ramp(k.at - k.lenL, k.lenL + k.lenR, k.vLeft, k.vRight)
    }
  }
  travel(totalM)

  return {
    sM,
    filmS,
    totalM,
    totalS: filmS[filmS.length - 1] as number,
    stops: intervals,
    transitions,
    modes: steps.map((st) => ({ fromM: st.fromM, mode: st.mode })),
  }
}

/** Nur die Stützstellen — beide Auswertungen brauchen die Halt-Liste nicht. */
type AxisSamples = { sM: readonly number[]; filmS: readonly number[] }

/** Filmsekunde an einer Streckenposition (im Halt → seine Ankunft). */
export function filmTimeAtDistance(axis: AxisSamples, meterM: number): number {
  return interpolate(axis.sM, axis.filmS, meterM)
}

/**
 * Streckenposition zu einer Filmsekunde — die Richtung, für die es die Achse
 * gibt (E2). Im Halt steht die Strecke: jede Filmsekunde darin liefert seinen
 * Ort.
 */
export function distanceAtFilmTime(axis: AxisSamples, filmS: number): number {
  return interpolate(axis.filmS, axis.sM, filmS)
}

/**
 * Steht die Filmsekunde in einem Halt — und in welchem?
 *
 * Die Ankunft (`filmFrom`) zählt dazu, die Abfahrt (`filmTo`) nicht: dort läuft
 * die Fahrt schon wieder.
 */
export function stopAtFilmTime<H extends DistanceStop>(
  axis: FilmAxis<H>,
  filmS: number,
): StopInterval<H> | null {
  for (const stop of axis.stops) {
    if (filmS < stop.filmFrom) return null // Halte sind sortiert
    if (filmS < stop.filmTo) return stop
  }
  return null
}
