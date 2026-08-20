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
export const MODUS_TEMPO = { walk: 0.5, moped: 1.15, bike: 1, jeep: 1.45, tram: 1.25, ferry: 2.5 }

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
export const MOMENT_DEFAULT_S = { orbit: 6, ascend: 5, linger: 4 }

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
const rampenWeg = (u: number, v0: number, v1: number): number => {
  const mittel = (v0 + v1) / 2
  if (!(mittel > 0)) return u
  return (v0 * u + (v1 - v0) * (u * u * u - (u * u * u * u) / 2)) / mittel
}

/**
 * Stützstellen je Rampe. Die Kurve wird stückweise linear abgetastet — 12
 * Stufen halten den Fehler unter einem Prozent der Rampenzeit und kosten bei
 * zwölf Halten rund 300 Punkte.
 */
const RAMPEN_STUFEN = 12

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
 * 3,0 s, egal wie lang `RAMPE_M` steht.
 */
export const RAMPE_M = 120

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
export function rampenVersatzS(v0: number, v1: number, rampeM: number = RAMPE_M): number {
  if (!(rampeM > 0) || !(v0 > 0) || !(v1 > 0) || v1 >= v0) return 0
  return (2 * rampeM) / (v0 + v1) - rampeM / v0
}

/** Wie die Achse ihre Rampen setzt. */
export interface Rampenwahl {
  /**
   * Anfahr- und Ausrollstrecke in Metern; Vorgabe `RAMPE_M`. `0` baut die reine
   * Reise-Achse — dafür gibt es genau einen Grund, und der sind die Tests: Sie
   * beschreiben das Weben der HALTE, und mit Rampe stünde in jeder Erwartung
   * noch deren Zuschlag.
   */
  rampeM?: number
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
export interface Modusuebergang {
  vonM: number
  bisM: number
  vonMode: string
  nachMode: string
}

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
  /** Die Fenster, in denen die Achse zwischen zwei Modi überblendet (für die Kamera) */
  uebergaenge: Modusuebergang[]
  /**
   * Die Fortbewegung über der Strecke, wie die ACHSE sie führt.
   *
   * Nicht dieselbe Liste wie die Modus-Grenzen der Tour: Ein Tempowechsel dicht
   * an einem Halt ist hier auf den Halt gezogen. Wer die rohen Grenzen fragt,
   * bekommt für die Meter dazwischen eine Fortbewegung, die die Achse gar nicht
   * mehr fährt — der Fußgänger-Marker liefe dann mit Fährtempo über die Karte.
   */
  modi: Array<{ abM: number; mode: string }>
}

/** Das Tempo (m/s), das die Achse an einem Streckenmeter gerade fährt. */
export function tempoBeiStrecke(achse: Pick<Filmachse, 'sM' | 'filmS'>, meterM: number): number {
  const { sM, filmS } = achse
  const n = sM.length
  if (n < 2) return 0
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((sM[mitte] as number) < meterM) lo = mitte + 1
    else hi = mitte
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
export function modusMischung(
  achse: Pick<Filmachse, 'uebergaenge' | 'sM' | 'filmS'>,
  meterM: number,
  modeBei: (m: number) => string,
): { vonMode: string; nachMode: string; anteil: number } {
  for (const u of achse.uebergaenge) {
    if (meterM < u.vonM) break // aufsteigend gesammelt
    if (meterM < u.bisM) {
      const v0 = tempoMs(u.vonMode)
      const v1 = tempoMs(u.nachMode)
      const spanne = v1 - v0
      const roh = spanne === 0 ? 1 : (tempoBeiStrecke(achse, meterM) - v0) / spanne
      return { vonMode: u.vonMode, nachMode: u.nachMode, anteil: Math.max(0, Math.min(1, roh)) }
    }
  }
  const mode = modeBei(meterM)
  return { vonMode: mode, nachMode: mode, anteil: 1 }
}

/** Ein Punkt der Achse, an dem sich das Tempo ändert — und wie viel Rampe er will. */
interface Rampenknoten<H extends Streckenhalt> {
  ort: number
  /** Halte an genau dieser Stelle (mehrere, wenn sie in derselben Pause liegen) */
  halte: H[]
  /** Tempo links und rechts des Knotens (m/s); am Halt ist es dazwischen null */
  vLinks: number
  vRechts: number
  modeLinks: string
  modeRechts: string
  /** Rampenlänge, die der Knoten links/rechts BRÄUCHTE, und was er nach dem Teilen bekommt */
  wunschL: number
  wunschR: number
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
export function baueFilmachse<H extends Streckenhalt>(
  abschnitte: readonly Streckenabschnitt[],
  gesamtM: number,
  halte: readonly H[],
  wahl: Rampenwahl = {},
): Filmachse<H> {
  const rampeM = wahl.rampeM ?? RAMPE_M
  const startTempoMs = wahl.startTempoMs === undefined ? 0 : wahl.startTempoMs

  // — 1. Das Tempo über der Strecke, als Stufenfunktion —
  //
  // Aufeinanderfolgende Abschnitte mit demselben Tempo werden zusammengelegt:
  // Ein Segmentwechsel ohne Tempowechsel ist keine Kante und braucht keine
  // Rampe (dieselbe Fahrt, nur ein anderer Eintrag im Manifest).
  const ersterModus = abschnitte[0]?.mode ?? 'bike'
  const stufen: Array<{ abM: number; v: number; mode: string }> = [
    { abM: 0, v: tempoMs(ersterModus), mode: ersterModus },
  ]
  {
    let vonM = 0
    for (const a of abschnitte.slice(1)) {
      const bisM = Math.max(vonM, Math.min(gesamtM, a.abM))
      vonM = bisM
      const v = tempoMs(a.mode)
      const letzte = stufen[stufen.length - 1] as { abM: number; v: number; mode: string }
      if (letzte.abM === bisM) {
        letzte.v = v
        letzte.mode = a.mode
      } else if (letzte.v !== v) stufen.push({ abM: bisM, v, mode: a.mode })
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
  const halteOrte = halte
    .filter((h) => h.breiteS > 0)
    .map((h) => Math.max(0, Math.min(gesamtM, h.meterM)))
    .sort((a, b) => a - b)
  if (rampeM > 0 && halteOrte.length > 0 && stufen.length > 1) {
    for (const st of stufen.slice(1)) {
      let naechster: number | undefined
      for (const o of halteOrte) {
        const abstand = Math.abs(o - st.abM)
        if (abstand < rampeM && (naechster === undefined || abstand < Math.abs(naechster - st.abM)))
          naechster = o
      }
      if (naechster !== undefined) st.abM = naechster
    }
    // Nach dem Ziehen neu ordnen: gleiche Stelle → die spätere gilt, gleiches
    // Tempo → keine Kante.
    stufen.sort((a, b) => a.abM - b.abM)
    const geraeumt: Array<{ abM: number; v: number; mode: string }> = []
    for (const st of stufen) {
      const letzte = geraeumt[geraeumt.length - 1]
      if (!letzte) geraeumt.push(st)
      else if (letzte.abM === st.abM) {
        letzte.v = st.v
        letzte.mode = st.mode
      } else if (letzte.v !== st.v) geraeumt.push(st)
    }
    stufen.length = 0
    stufen.push(...geraeumt)
  }

  const tempoBei = (m: number): number => {
    let v = (stufen[0] as { v: number }).v
    for (const st of stufen) if (st.abM <= m) v = st.v
    return v
  }
  const modusBei = (m: number): string => {
    let mode = (stufen[0] as { mode: string }).mode
    for (const st of stufen) if (st.abM <= m) mode = st.mode
    return mode
  }

  // — 2. Die Rampenknoten —
  //
  // Halte ohne Breite kosten nichts und bremsen deshalb auch nicht. Sortiert
  // wird nach dem ORT; die Sortierung ist stabil, also behalten Halte auf
  // demselben Meterstand (mehrere in derselben realen Pause) ihre Reihenfolge.
  const knoten: Array<Rampenknoten<H>> = []
  const knotenAn = (ort: number): Rampenknoten<H> => {
    const da = knoten.find((k) => k.ort === ort)
    if (da) return da
    const neu: Rampenknoten<H> = {
      ort,
      halte: [],
      vLinks: ort <= 0 ? (startTempoMs ?? tempoBei(0)) : tempoBei(ort - 1e-9),
      vRechts: ort >= gesamtM ? 0 : tempoBei(ort),
      modeLinks: modusBei(Math.max(0, ort - 1e-9)),
      modeRechts: modusBei(Math.min(gesamtM, ort)),
      wunschL: 0,
      wunschR: 0,
      lenL: 0,
      lenR: 0,
    }
    knoten.push(neu)
    return neu
  }
  knotenAn(0)
  knotenAn(gesamtM)
  for (const st of stufen.slice(1)) if (st.abM > 0 && st.abM < gesamtM) knotenAn(st.abM)
  for (const h of halte) {
    if (!(h.breiteS > 0)) continue
    knotenAn(Math.max(0, Math.min(gesamtM, h.meterM))).halte.push(h)
  }
  knoten.sort((a, b) => a.ort - b.ort)

  for (const k of knoten) {
    const amStart = k.ort <= 0
    const amEnde = k.ort >= gesamtM
    if (k.halte.length > 0) {
      // Ein Halt ist der Sonderfall „Wechsel von oder auf null" — und der
      // einzige, bei dem die volle Länge auf JEDE Seite gehört.
      k.wunschL = amStart ? 0 : rampeM
      k.wunschR = amEnde ? 0 : rampeM
    } else if (amStart) {
      // Der Eintritt ins Stück ist selbst ein Tempowechsel — aus dem Stand die
      // Anfahrt, mitten in der Fahrt der Wechsel an der linken Kante. Beides
      // liegt im schnelleren Abschnitt, hier also dahinter (nach vorn ist kein
      // Platz).
      k.wunschR = k.vRechts > k.vLinks ? rampeM : 0
    } else if (!amEnde) {
      // Modus-Grenze: EINE Rampe, ganz im SCHNELLEREN Abschnitt (s. RAMPE_M).
      if (k.vRechts > k.vLinks) k.wunschR = rampeM
      else k.wunschL = rampeM
    }
    // Am Tour-ENDE wird nicht gebremst: Der Film läuft dort aus.
  }

  // Kollidierende Rampen teilen sich die Lücke ANTEILIG nach ihrem Bedarf — bei
  // zwei gleich langen ist das genau die Hälfte, und zwischen Halt (volle
  // Länge) und Modus-Grenze (halbe) bleibt das Verhältnis erhalten.
  for (let i = 0; i + 1 < knoten.length; i++) {
    const links = knoten[i] as Rampenknoten<H>
    const rechts = knoten[i + 1] as Rampenknoten<H>
    const luecke = Math.max(0, rechts.ort - links.ort)
    const bedarf = links.wunschR + rechts.wunschL
    const faktor = bedarf > luecke ? (bedarf > 0 ? luecke / bedarf : 0) : 1
    links.lenR = links.wunschR * faktor
    rechts.lenL = rechts.wunschL * faktor
  }

  // — 3. Der Durchgang —
  const sM: number[] = [0]
  const filmS: number[] = [0]
  const intervalle: Array<HaltIntervall<H>> = []
  const uebergaenge: Modusuebergang[] = []
  let pos = 0
  let film = 0

  const setze = (m: number, f: number): void => {
    const n = sM.length
    if (n > 0 && sM[n - 1] === m && filmS[n - 1] === f) return
    sM.push(m)
    filmS.push(f)
  }

  /** Reisen bis `bis` — an jeder Tempo-Stufe unterwegs eine Stützstelle. */
  const reise = (bis: number): void => {
    while (pos < bis) {
      let naechste = bis
      for (const st of stufen) if (st.abM > pos && st.abM < naechste) naechste = st.abM
      film += (naechste - pos) / tempoBei(pos)
      pos = naechste
      setze(pos, film)
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
  const rampe = (von: number, laenge: number, v0: number, v1: number): void => {
    if (!(laenge > 0) || !(v0 + v1 > 0)) return
    const dauer = (2 * laenge) / (v0 + v1)
    const basis = film
    for (let k = 1; k <= RAMPEN_STUFEN; k++) {
      const u = k / RAMPEN_STUFEN
      setze(von + laenge * rampenWeg(u, v0, v1), basis + dauer * u)
    }
    film = basis + dauer
    pos = von + laenge
  }

  for (const k of knoten) {
    reise(k.ort - k.lenL)
    // Wechselt der MODUS hier, blendet die Kamera über dieselbe Strecke über.
    // Am Halt gehört das Fenster der Ausfahrt: Während der Standzeit steht die
    // Kamera ohnehin, und die neue Fortbewegung beginnt mit der Weiterfahrt.
    if (k.modeLinks !== k.modeRechts) {
      const vonM = k.halte.length > 0 ? k.ort : k.ort - k.lenL
      const bisM = k.ort + k.lenR
      if (bisM > vonM)
        uebergaenge.push({ vonM, bisM, vonMode: k.modeLinks, nachMode: k.modeRechts })
    }
    if (k.halte.length > 0) {
      rampe(pos, k.lenL, k.vLinks, 0)
      for (const h of k.halte) {
        setze(k.ort, film)
        sM.push(k.ort)
        filmS.push(film + h.breiteS)
        intervalle.push({ ...h, filmVon: film, filmBis: film + h.breiteS })
        film += h.breiteS
      }
      pos = k.ort
      rampe(k.ort, k.lenR, 0, k.vRechts)
    } else {
      rampe(k.ort - k.lenL, k.lenL + k.lenR, k.vLinks, k.vRechts)
    }
  }
  reise(gesamtM)

  return {
    sM,
    filmS,
    gesamtM,
    gesamtS: filmS[filmS.length - 1] as number,
    halte: intervalle,
    uebergaenge,
    modi: stufen.map((st) => ({ abM: st.abM, mode: st.mode })),
  }
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
