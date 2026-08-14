// Die Film-Achse der Pipeline: Aufnahmezeit ↔ Filmsekunde ↔ Streckenanteil.
//
// Warum der Server das braucht: Ein Ton-Klip hängt seit Etappe 4 an einem ANKER
// in Aufnahmezeit plus einem VERSATZ in Filmsekunden (docs §2E). Der Versatz
// darf mitten in einer Standzeit liegen — dort steht die Aufnahmeuhr still,
// während der Film weiterläuft. Ohne eine Achse, die die Halte kennt, wäre
// „3 Sekunden nach dem Anker" beim Rendern nicht auffindbar.
//
// Das hier ist der SERVER-Spiegel von `baueFilmachse` in src/filmachse.ts.
// Beide müssen dasselbe rechnen, sonst startet ein Klip im fertigen Film woanders
// als im Editor gezeigt — genau die Sorte Drift, an der schon die
// Gehabschnitts-Erkennung einmal hing. Deshalb: dieselbe Gruppierung (120
// Streckenmeter, src/geo.ts), dieselben Halt-Dauern (`aufnahmeHaltS` +
// Ausblendung), dieselben RAMPEN (E14 — an jedem Tempowechsel, am Halt auf
// beiden Seiten, an einer Modus-Grenze ganz im schnelleren Abschnitt) und
// dieselbe Interpolations-Konvention (Plateau → Ankunft).
//
// **Gerechnet wird über die STRECKE, die Anker bleiben Aufnahmezeit** — genau
// wie im Editor (src/studio/zeitleiste.ts, `baueAchse`). Das ist seit E12 keine
// Wahl mehr: Die Rampen sind eine Form über einer STRECKE, über der Aufnahmeuhr
// ließen sie sich nicht ausdrücken. Aufnahmezeit ↔ Filmzeit geht deshalb in
// zwei Schritten, über den Adapter `tS`/`mM`.

import type { MomentArt } from '../schema/edits.js'
import { HALT_AUSBLEND_S, NAHE_M, RAMPE_M, aufnahmeHaltS, momentHaltS, tempoMs } from './filmtempo.js'
import type { Zeitreihe } from './zeit.js'

/** Ein Halt auf der Achse: wann er beginnt (Aufnahmezeit) und was er im Film kostet. */
export interface AchsenHalt {
  offsetS: number
  breiteS: number
}

/**
 * Aufnahmezeit ↔ Strecke ↔ Filmzeit, stückweise linear.
 *
 * `tS`/`mM` ist der Zeit→Strecke-Adapter (je Stützpunkt seine Aufnahmesekunde
 * und sein Meterstand); `sM`/`filmS` ist die eigentliche Achse. `sM` ist nicht
 * streng monoton: Jeder Halt liegt als PAAR gleicher Meterwerte darin (Ankunft
 * und Abfahrt) — das Plateau, in dem der Film läuft und die Strecke steht.
 */
export interface FilmAchse {
  tS: number[]
  mM: number[]
  sM: number[]
  filmS: number[]
  gesamtS: number
}

/** Meter zwischen zwei Punkten (lokale Plattkarte — auf Segmentlänge genau genug). */
function meterZwischen(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const dx = (b.lng - a.lng) * kx
  const dy = (b.lat - a.lat) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Lineare Interpolation mit lower_bound-Konvention.
 *
 * Bei doppelten Stützstellen (Halt) liefert sie den LINKEN Wert — die Ankunft.
 * Dieselbe Konvention wie `interpoliere` in src/studio/zeitleiste.ts; eine
 * andere Wahl verschöbe jeden Anker, der genau auf einer Halt-Zeit sitzt, um
 * die ganze Standzeit.
 */
function interpoliere(xs: readonly number[], ys: readonly number[], x: number): number {
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

/**
 * Weganteil der Rampe nach dem Zeitanteil `u`, von Tempo `v0` auf `v1` —
 * Spiegel von `rampenWeg` in src/filmachse.ts.
 *
 * Die Geschwindigkeit folgt `v0 + (v1 − v0) · smoothstep(u)`: sanft an, in der
 * Mitte am stärksten, sanft ins neue Tempo. Daraus die zwei Zahlen, die die
 * Rechnung tragen: `w(1) = 1` und die Dauer `T = 2L / (v0 + v1)` — die Strecke
 * durch das MITTLERE Tempo. Für `v0 = 0` fällt daraus die Halt-Rampe heraus
 * (`2u³ − u⁴`, `T = 2L/v1`).
 */
function rampenWeg(u: number, v0: number, v1: number): number {
  const mittel = (v0 + v1) / 2
  if (!(mittel > 0)) return u
  return (v0 * u + (v1 - v0) * (u * u * u - (u * u * u * u) / 2)) / mittel
}

/** Stützstellen je Rampe — dieselbe Abtastung wie im Web. */
const RAMPEN_STUFEN = 12

/** Ein Punkt der Achse, an dem sich das Tempo ändert — Spiegel von `Rampenknoten`. */
interface Rampenknoten {
  ort: number
  halte: AchsenHalt[]
  vLinks: number
  vRechts: number
  wunschL: number
  wunschR: number
  lenL: number
  lenR: number
}

/**
 * Film-Achse aus der (bereits getrimmten) Zeitreihe und den Halten.
 *
 * Fahrzeit kommt aus Strecke ÷ modusabhängigem Tempo — dieselbe Rechnung, mit
 * der die Engine fährt (filmtempo.ts) —, dazu die Rampen. Sie liegen an JEDEM
 * Tempowechsel: am Start, an jedem Halt (Sonderfall „von oder auf null") und an
 * jeder Modus-Grenze, dort ganz im schnelleren Abschnitt. `null`, wenn zu wenig
 * Material für eine Abbildung da ist; der Aufrufer fällt dann auf die alte
 * Aufnahmezeit-Verankerung zurück, statt zu raten.
 *
 * `rampeM` ist nur für das Verhaltens-Fixture offen: Es beschreibt die FORM der
 * Rampe mit runden Längen, die Dosierung steht als `RAMPE_M` in filmtempo.ts.
 */
export function baueFilmAchse(
  reihe: Zeitreihe,
  halte: readonly AchsenHalt[],
  rampeM: number = RAMPE_M,
): FilmAchse | null {
  // — Der Zeit→Strecke-Adapter und die Tempo-Stufen über der Strecke —
  const tS: number[] = []
  const mM: number[] = []
  const stufen: Array<{ abM: number; v: number }> = []
  let meter = 0
  const punkte = reihe.punkte
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i]
    if (!p) continue
    if (i > 0) {
      const vor = punkte[i - 1]
      // Das Tempo des Punktes, VON dem gefahren wird — Grenzen wirken ab ihrem
      // Punkt, exakt wie in der Studio-Achse.
      if (vor) meter += meterZwischen(vor, p)
    }
    const v = tempoMs(p.mode)
    const letzte = stufen[stufen.length - 1]
    if (!letzte) stufen.push({ abM: 0, v })
    else if (letzte.abM === meter) letzte.v = v
    else if (letzte.v !== v) stufen.push({ abM: meter, v })
    const letzter = tS.length - 1
    if (letzter >= 0 && tS[letzter] === p.tSek && mM[letzter] === meter) continue
    tS.push(p.tSek)
    mM.push(meter)
  }
  if (tS.length < 2 || !(meter > 0) || stufen.length === 0) return null
  const gesamtM = meter
  // Tempowechsel in der Rampenzone eines Halts wandern AUF den Halt — sonst
  // quetschen sich Wechsel- und Halt-Rampe in die paar Meter dazwischen, und
  // der Film beschleunigt auf voller Höhe, um sofort wieder zu stehen (an
  // Stockholm gemessen: Grenze zu Fuß → Fähre 13 m vor einem Halt).
  const halteOrte = [...halte]
    .filter((h) => h.breiteS > 0)
    .map((h) => Math.max(0, Math.min(gesamtM, interpoliere(tS, mM, h.offsetS))))
    .sort((a, b) => a - b)
  if (rampeM > 0 && halteOrte.length > 0 && stufen.length > 1) {
    for (const st of stufen.slice(1)) {
      let naechster: number | undefined
      for (const o of halteOrte) {
        const abstand = Math.abs(o - st.abM)
        if (abstand < rampeM && (naechster === undefined || abstand < Math.abs(naechster - st.abM))) naechster = o
      }
      if (naechster !== undefined) st.abM = naechster
    }
    stufen.sort((a, b) => a.abM - b.abM)
    const geraeumt: Array<{ abM: number; v: number }> = []
    for (const st of stufen) {
      const letzte = geraeumt[geraeumt.length - 1]
      if (!letzte) geraeumt.push(st)
      else if (letzte.abM === st.abM) letzte.v = st.v
      else if (letzte.v !== st.v) geraeumt.push(st)
    }
    stufen.length = 0
    stufen.push(...geraeumt)
  }

  const tempoBei = (m: number): number => {
    let v = (stufen[0] as { v: number }).v
    for (const st of stufen) if (st.abM <= m) v = st.v
    return v
  }

  // — Die Rampenknoten —
  //
  // Halte auf die Strecke ziehen — nach ZEIT vorsortiert, damit mehrere Halte
  // in derselben realen Pause (gleicher Meterstand) ihre Reihenfolge behalten.
  const knoten: Rampenknoten[] = []
  const knotenAn = (ort: number): Rampenknoten => {
    const da = knoten.find((k) => k.ort === ort)
    if (da) return da
    const neu: Rampenknoten = {
      ort,
      halte: [],
      vLinks: ort <= 0 ? 0 : tempoBei(ort - 1e-9),
      vRechts: ort >= gesamtM ? 0 : tempoBei(ort),
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
  for (const h of [...halte].filter((x) => x.breiteS > 0).sort((a, b) => a.offsetS - b.offsetS)) {
    knotenAn(Math.max(0, Math.min(gesamtM, interpoliere(tS, mM, h.offsetS)))).halte.push(h)
  }
  knoten.sort((a, b) => a.ort - b.ort)

  for (const k of knoten) {
    const amStart = k.ort <= 0
    const amEnde = k.ort >= gesamtM
    if (k.halte.length > 0) {
      k.wunschL = amStart ? 0 : rampeM
      k.wunschR = amEnde ? 0 : rampeM
    } else if (amStart) {
      k.wunschR = rampeM
    } else if (!amEnde) {
      // Modus-Grenze: EINE Rampe, ganz im SCHNELLEREN Abschnitt — beim
      // Beschleunigen hinter der Grenze, beim Verzögern davor. Symmetrisch
      // gelegt liefe der langsamere Modus auf seinen letzten Metern schon mit
      // dem Tempo des schnelleren.
      if (k.vRechts > k.vLinks) k.wunschR = rampeM
      else k.wunschL = rampeM
    }
  }
  // Kollidierende Rampen teilen sich die Lücke anteilig nach ihrem Bedarf.
  for (let i = 0; i + 1 < knoten.length; i++) {
    const links = knoten[i] as Rampenknoten
    const rechts = knoten[i + 1] as Rampenknoten
    const luecke = Math.max(0, rechts.ort - links.ort)
    const bedarf = links.wunschR + rechts.wunschL
    const faktor = bedarf > luecke ? (bedarf > 0 ? luecke / bedarf : 0) : 1
    links.lenR = links.wunschR * faktor
    rechts.lenL = rechts.wunschL * faktor
  }

  // — Der Durchgang —
  const sM: number[] = [0]
  const filmS: number[] = [0]
  let pos = 0
  let film = 0

  const setze = (m: number, f: number): void => {
    const n = sM.length
    if (n > 0 && sM[n - 1] === m && filmS[n - 1] === f) return
    sM.push(m)
    filmS.push(f)
  }

  const reise = (bis: number): void => {
    while (pos < bis) {
      let naechste = bis
      for (const st of stufen) if (st.abM > pos && st.abM < naechste) naechste = st.abM
      film += (naechste - pos) / tempoBei(pos)
      pos = naechste
      setze(pos, film)
    }
  }

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
    if (k.halte.length > 0) {
      rampe(pos, k.lenL, k.vLinks, 0)
      for (const h of k.halte) {
        setze(k.ort, film)
        sM.push(k.ort)
        filmS.push(film + h.breiteS)
        film += h.breiteS
      }
      pos = k.ort
      rampe(k.ort, k.lenR, 0, k.vRechts)
    } else {
      rampe(k.ort - k.lenL, k.lenL + k.lenR, k.vLinks, k.vRechts)
    }
  }
  reise(gesamtM)

  const gesamtS = filmS[filmS.length - 1] as number
  if (!(gesamtS > 0)) return null
  return { tS, mM, sM, filmS, gesamtS }
}

/** Filmsekunde zu einer Aufnahmezeit — zwei Schritte: Zeit → Strecke → Film. */
export function filmBeiZeit(achse: FilmAchse, tSek: number): number {
  return interpoliere(achse.sM, achse.filmS, interpoliere(achse.tS, achse.mM, tSek))
}

/**
 * Aufnahmezeit zu einer Filmsekunde (Umkehrung; im Halt → dessen Zeit).
 *
 * Der Rückweg Strecke → Zeit ist in einer realen PAUSE mehrdeutig — dort gilt
 * die Ankunft, dieselbe lower_bound-Konvention wie überall.
 */
export function zeitBeiFilm(achse: FilmAchse, filmS: number): number {
  return interpoliere(achse.mM, achse.tS, interpoliere(achse.filmS, achse.sM, filmS))
}

/**
 * Anker [lng,lat] auf die Zeitreihe projizieren: Streckenmeter und Zeit-Offset.
 *
 * Gemessen wird auf die STRECKE zwischen zwei Stützpunkten, nicht auf den
 * nächsten Stützpunkt — auf einem grob abgetasteten Track (Alpen-Serpentinen,
 * 30-s-Raster) liegen die Punkte weit auseinander, und ein Halt spränge sonst
 * um mehrere Sekunden. Spiegel von `projiziereAufTrack` (editmodell.ts).
 */
export function projiziereAufReihe(reihe: Zeitreihe, lng: number, lat: number): { meter: number; offsetS: number } {
  const punkte = reihe.punkte
  const erster = punkte[0]
  if (!erster) return { meter: 0, offsetS: 0 }
  const kx = 111_320 * Math.cos((erster.lat * Math.PI) / 180)
  let besteD2 = Infinity
  let meter = erster.dist
  let offsetS = erster.tSek
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1]
    const b = punkte[i]
    if (!a || !b) continue
    const ax = a.lng * kx
    const ay = a.lat * 110_540
    const bx = b.lng * kx
    const by = b.lat * 110_540
    const px = lng * kx
    const py = lat * 110_540
    const dx = bx - ax
    const dy = by - ay
    const laenge2 = dx * dx + dy * dy
    const u = laenge2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / laenge2)) : 0
    const fx = ax + u * dx
    const fy = ay + u * dy
    const d2 = (px - fx) * (px - fx) + (py - fy) * (py - fy)
    if (d2 < besteD2) {
      besteD2 = d2
      meter = a.dist + u * (b.dist - a.dist)
      offsetS = a.tSek + u * (b.tSek - a.tSek)
    }
  }
  return { meter, offsetS }
}

/**
 * Aufnahmen zu Halten gruppieren — Spiegel von `baueStopps`
 * (src/studio/stopps.ts) und `gruppiereStopps` (src/geo.ts).
 *
 * Gemessen wird zum ANFANG des Halts, nicht zum Vorgänger: sonst könnte eine
 * Perlenkette knapp benachbarter Aufnahmen zu einem beliebig langen Stopp
 * verschmelzen. Die Breite ist die Summe der Standzeiten samt Ausblendung —
 * ein Halt mit drei Fotos ist im Film eine Folge von dreien.
 */
export function baueAchsenHalte(
  medien: ReadonlyArray<{
    type: 'photo' | 'video'
    /** Streckenmeter des Ankers (unplatzierte Medien gehören nicht in die Liste) */
    meter: number
    /** Sekunden ab time.start */
    offsetS: number
    dauerS?: number
    display?: { holdS?: number }
  }>,
  naheM = NAHE_M,
): AchsenHalt[] {
  const sortiert = [...medien].sort((a, b) => a.meter - b.meter)
  const gruppen: Array<{ anfangM: number; offsets: number[]; breiteS: number }> = []
  for (const m of sortiert) {
    const letzte = gruppen[gruppen.length - 1]
    const dauer = aufnahmeHaltS(m) + HALT_AUSBLEND_S
    if (letzte && m.meter - letzte.anfangM < naheM) {
      letzte.offsets.push(m.offsetS)
      letzte.breiteS += dauer
    } else {
      gruppen.push({ anfangM: m.meter, offsets: [m.offsetS], breiteS: dauer })
    }
  }
  return gruppen.map((g) => ({
    offsetS: g.offsets.reduce((s, v) => s + v, 0) / g.offsets.length,
    breiteS: g.breiteS,
  }))
}

/**
 * Kamera-Momente als Halte — Spiegel von `achsenHalte` (src/studio/editor.ts).
 *
 * Ein Moment ist grammatikalisch ein HALT: die Fahrt steht, die Kamera tut
 * etwas, Filmzeit vergeht (src/tour.ts, Phase `moment`). Er gehört deshalb
 * genauso in die Achse wie eine Foto-Kette — fehlte er, wäre die Achse um seine
 * Dauer zu kurz: Ein Ton-Klip, dessen Versatz (Anker + Filmsekunden) ÜBER den
 * Moment reicht, bekäme eine zu weit vorn liegende Streckenstelle und klänge im
 * fertigen Film um die Momentdauer SPÄTER als im Editor gezeigt — der Player
 * fährt den Moment ja mit.
 *
 * Anders als Aufnahmen werden Momente NICHT gruppiert: Jeder ist ein eigenes
 * Ereignis mit eigener Dauer, und zwei dicht beieinander sind im Film zwei
 * Halte hintereinander. `webeHalte` sortiert selbst.
 */
export function baueMomentHalte(
  momente: ReadonlyArray<{
    /** Sekunden ab time.start */
    offsetS: number
    art: MomentArt
    dauerS?: number | undefined
  }>,
): AchsenHalt[] {
  return momente.map((m) => ({ offsetS: m.offsetS, breiteS: momentHaltS(m) }))
}
