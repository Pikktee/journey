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

/**
 * Weganteil der Rampe nach dem Zeitanteil `u` (0..1) — `2u³ − u⁴`.
 *
 * Ihre Ableitung ist `2 · smoothstep(u)`: Tempo 0 am Anfang, sanft anziehend,
 * in der MITTE am stärksten, sanft ins Reisetempo (Beschleunigung an beiden
 * Enden null — kein Ruck). Das ist genau die Form, die E14 beschreibt.
 *
 * Aus `σ(1) = 1` und `σ'(1) = 2` folgt die eine Zahl, die die ganze Rechnung
 * trägt: **Eine Rampe dauert doppelt so lange wie das Reisen derselben
 * Strecke.** Ihr Zuschlag ist also genau eine Reisezeit ihrer Länge — und weil
 * die aus der Reise-Achse kommt, stimmt er auch, wenn mitten in der Rampe ein
 * Modus wechselt.
 */
const rampenWeg = (u: number): number => u * u * u * (2 - u)

/**
 * Stützstellen je Rampe. Die Kurve wird stückweise linear abgetastet — 12
 * Stufen halten den Fehler unter einem Prozent der Rampenzeit und kosten bei
 * zwölf Halten rund 300 Punkte.
 */
const RAMPEN_STUFEN = 12

/**
 * Anfahr- und Ausrollstrecke in Metern — **die eine gestalterische Zahl der
 * Rampe**, kalibriert und nicht geraten.
 *
 * Kalibriert an den heute simulierten Rampen, damit sich die Fahrt nicht
 * sprunghaft anders anfühlt — die Summe über die vier Fixtur-Touren beträgt
 * 64,3 Rampen-Sekunden ([rampen-simulation.ts](../scripts/messungen/rampen-simulation.ts):
 * 32,4 · 14,7 · 1,3 · 15,9). Der Zuschlag einer Rampe ist `Länge ÷ Tempo`, ein
 * Halt kostet also `2 L / v`; **120 m** treffen die Summe auf 3,3 % genau
 * (62,2 s), nachgerechnet mit
 * [rampen-kalibrierung.ts](../scripts/messungen/rampen-kalibrierung.ts).
 *
 * Die VERTEILUNG ändert sich dabei bewusst, und das ist keine Ungenauigkeit,
 * sondern der Kern von E14: Heute WÄCHST der Zuschlag mit dem Tempo (die
 * Exponentialkurve braucht bei Vollgas länger, 2,70 s je Halt auf der
 * 41-km-Tour gegen 0,44 s auf der kurzen), künftig FÄLLT er damit — dieselbe
 * Strecke ist schneller durchfahren. Die schnelle Tour verliert deshalb
 * Rampenzeit (32,4 → 22,0 s), die überwiegend gegangene gewinnt welche
 * (14,7 → 24,2 s): Der Antritt wirkt bei Tempo knackiger und zu Fuß getragener.
 *
 * **Liegen zwei Halte näher beieinander als 2 L**, teilen sie sich die Lücke
 * hälftig — sonst überlappten Ausrollen und Anfahren, und die Achse liefe
 * rückwärts. Auf der kurzen Tour (356 m Luftlinie zwischen drei Halten) greift
 * genau das: Ihre Rampen bleiben bei 3,0 s, egal wie lang `RAMPE_M` steht.
 */
export const RAMPE_M = 120

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
   * Beginnt das Stück im STAND? Vorgabe ja — eine Tour fährt aus dem Stand los.
   *
   * Das Zug-Fenster einer Fortbewegungs-Grenze (`baueGrenzKurve` im Editor)
   * beginnt dagegen mitten in der Fahrt: Dort eine Anfahrt einzurechnen schöbe
   * die gezogene Kante um deren Zuschlag, und sie landete nicht dort, wo man
   * losgelassen hat.
   */
  ausDemStand?: boolean
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
 * Innerhalb eines Abschnitts ist die REISE-Abbildung exakt linear (Strecke ÷
 * Tempo) — Stützstellen je Trackpunkt braucht es dafür nicht. Wer sie hat (der
 * Editor), legt seinen Zeit→Strecke-Adapter daneben, statt sie in die Achse zu
 * tragen. Nichtlinear wird die Achse nur dort, wo eine RAMPE liegt: um jeden
 * Halt und am Start der Tour.
 *
 * Gebaut wird in einem Durchgang von vorn nach hinten — Rampe, Reise, Rampe,
 * Halt-Plateau —, und der aufgelaufene `zuschlag` trägt Rampen und Standzeiten
 * gemeinsam. Ein nachträgliches Einweben (die frühere `webeHalte`) ginge nicht
 * mehr: Die Rampen einer Lücke hängen davon ab, wie lang sie ist.
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
  const ausDemStand = wahl.ausDemStand ?? true
  // — Die REISE-Achse: Strecke ÷ Tempo, ohne Rampen und ohne Halte —
  const reiseM: number[] = [0]
  const reiseS: number[] = [0]
  let film = 0
  let vonM = 0
  let mode = abschnitte[0]?.mode ?? 'bike'
  for (const a of abschnitte.slice(1)) {
    const bisM = Math.max(vonM, Math.min(gesamtM, a.abM))
    if (bisM > vonM) {
      film += filmsekunden(bisM - vonM, mode)
      reiseM.push(bisM)
      reiseS.push(film)
    }
    vonM = bisM
    mode = a.mode
  }
  if (gesamtM > vonM) {
    film += filmsekunden(gesamtM - vonM, mode)
    reiseM.push(gesamtM)
    reiseS.push(film)
  }
  const reiseFilm = (m: number): number => interpoliere(reiseM, reiseS, m)

  // Halte ohne Breite kosten nichts und bremsen deshalb auch nicht. Sortiert
  // wird nach dem ORT; die Sortierung ist stabil, also behalten Halte auf
  // demselben Meterstand (mehrere in derselben realen Pause) ihre Reihenfolge.
  const geordnet = halte
    .map((h) => ({ h, ort: Math.max(0, Math.min(gesamtM, h.meterM)) }))
    .filter((e) => e.h.breiteS > 0)
    .sort((a, b) => a.ort - b.ort)

  const sM: number[] = [0]
  const filmS: number[] = [0]
  const intervalle: Array<HaltIntervall<H>> = []
  /** Alles, was die Achse gegenüber der reinen Reisezeit schon gewonnen hat. */
  let zuschlag = 0
  let stand = 0 // Meterstand des letzten Ruhepunkts (Start oder Halt)

  const setze = (m: number, f: number): void => {
    const n = sM.length
    if (n > 0 && sM[n - 1] === m && filmS[n - 1] === f) return
    sM.push(m)
    filmS.push(f)
  }

  /**
   * Eine Rampe abtasten. `anfahrt` = aus dem Stand ins Reisetempo, sonst die
   * Zeitumkehrung davon. Sie kostet `2 × Reisezeit` ihrer Strecke; der
   * Zuschlag ist damit genau eine Reisezeit.
   */
  const rampe = (vonRampeM: number, laenge: number, anfahrt: boolean): void => {
    if (!(laenge > 0)) return
    const reise = reiseFilm(vonRampeM + laenge) - reiseFilm(vonRampeM)
    const basis = reiseFilm(vonRampeM) + zuschlag
    for (let k = 1; k <= RAMPEN_STUFEN; k++) {
      const u = k / RAMPEN_STUFEN
      const anteil = anfahrt ? rampenWeg(u) : 1 - rampenWeg(1 - u)
      setze(vonRampeM + laenge * anteil, basis + 2 * reise * u)
    }
    zuschlag += reise
  }

  for (let i = 0; i <= geordnet.length; i++) {
    const eintrag = geordnet[i]
    const ziel = eintrag ? eintrag.ort : gesamtM
    const luecke = Math.max(0, ziel - stand)
    // Vor einem Halt wird gebremst, am Tour-ENDE nicht: Der Film läuft dort
    // aus, wie er es heute tut. Beide Rampen teilen sich die Lücke hälftig,
    // wenn sie sonst überlappten.
    const ausrollen = eintrag ? Math.min(rampeM, luecke / 2) : 0
    const anfahrt =
      i === 0 && !ausDemStand ? 0 : Math.min(rampeM, eintrag ? luecke / 2 : luecke)
    setze(stand, reiseFilm(stand) + zuschlag)
    rampe(stand, anfahrt, true)
    // Reisen: die Modus-Grenzen zwischen den Rampen behalten ihre Stützstelle.
    const reiseVon = stand + anfahrt
    const reiseBis = ziel - ausrollen
    for (const m of reiseM) if (m > reiseVon && m < reiseBis) setze(m, reiseFilm(m) + zuschlag)
    if (reiseBis > reiseVon) setze(reiseBis, reiseFilm(reiseBis) + zuschlag)
    rampe(reiseBis, ausrollen, false)
    if (!eintrag) break
    // Das Halt-Plateau: dieselbe Strecke, zwei Filmzeiten.
    const ankunft = reiseFilm(ziel) + zuschlag
    setze(ziel, ankunft)
    sM.push(ziel)
    filmS.push(ankunft + eintrag.h.breiteS)
    intervalle.push({ ...eintrag.h, filmVon: ankunft, filmBis: ankunft + eintrag.h.breiteS })
    zuschlag += eintrag.h.breiteS
    stand = ziel
  }

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
