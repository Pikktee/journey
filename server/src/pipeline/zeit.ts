// Zeit-Werkzeuge der Anreicherungs-Pipeline: verkettet die Segmente zu einer
// Zeitreihe (Position + kumulierte Distanz + Zeit-Offset je Punkt) und
// destilliert daraus die `timeline`-Stützstellen f→Pseudo-Zeit fürs Tour-JSON.
//
// Kern-Designentscheid: Eine Pause hat keine Streckenausdehnung — der Film
// fährt nach Strecke, die Uhr läuft nach Zeit. Zwei Stunden Kino wären an
// dieser Stelle also ein SPRUNG der Pseudo-Uhr (und damit der Sonne) von hell
// auf dunkel, mitten in der Fahrt.
//
// Bis Juli 2026 wurde die Pause deshalb auf zwei Minuten gestaucht. Das nahm
// den Ruck, verschob aber alles Folgende: Nach zwei Stunden Pause zeigte die
// Telemetrie bis zum Tourende gut zwei Stunden zu früh an — an einer echten
// Tour endete die Anzeige um 20:51, während die Fotos derselben Minuten schon
// „22:48" untertitelt waren und es draußen längst dunkel war.
//
// Stattdessen läuft die Pause jetzt als ZEITRAFFER ab: außerhalb eines kurzen
// Streckenfensters um die Pause gilt überall die echte Aufnahmezeit, im Fenster
// vergeht sie im Schnelldurchlauf. Der Himmel dreht dort sichtbar von Dämmerung
// auf Nacht — ein etabliertes filmisches Mittel, das die Pause miterzählt,
// statt sie zu verschlucken. Bemessen wird das Fenster in FILMsekunden
// (filmtempo.ts), nicht in Metern: 200 m sind zu Fuß vier Sekunden und auf der
// Fähre eine halbe.

import type { Modus, UploadPunkt, UploadSegment } from '../schema/upload.js'
import { meterFuerFilmsekunden } from './filmtempo.js'
import { distanzM } from './geo.js'

/** Punkt der verketteten Zeitreihe. */
export interface ZeitPunkt {
  lng: number
  lat: number
  /** kumulierte Distanz ab Tour-Start (m), inkl. Sprünge zwischen Segmenten */
  dist: number
  /** Sekunden ab time.start — monoton nicht-fallend erzwungen */
  tSek: number
  /** Fortbewegung des Segments, aus dem der Punkt stammt */
  mode: Modus
}

export interface Zeitreihe {
  punkte: ZeitPunkt[]
  gesamtM: number
  dauerS: number
}

/** Pause: Indexbereich in der Zeitreihe, in dem Zeit ohne Ortswechsel verging. */
export interface Pause {
  vonIdx: number
  bisIdx: number
  dauerS: number
}

/** Pausen ab dieser Dauer laufen als Zeitraffer ab. */
export const PAUSE_MIN_S = 15 * 60

/**
 * Filmdauer des Zeitraffers — kurze Pause / sehr lange Pause.
 *
 * Die Rampe wächst mit der übersprungenen Dauer: Zwanzig Minuten sind ein
 * Wimpernschlag Dämmerung, zwei Stunden ein halber Sonnenuntergang. Bekäme
 * beides dieselben drei Sekunden, zuckte das Licht bei der langen Pause.
 */
export const RAMPE_MIN_FILM_S = 3
export const RAMPE_MAX_FILM_S = 7
/** Ab dieser Pausendauer ist die Rampe voll ausgefahren. */
const RAMPE_VOLL_S = 4 * 3600
// Aufenthaltsradius: GPS rauscht im Stand (Accuracy-Filter der App lässt bis
// 30 m durch) und eine „Pause" darf ein kurzer Gang zum Kiosk sein.
const PAUSE_RADIUS_M = 150
// Zielgenauigkeit des Destillats: max. Abweichung der stückweise linearen
// Pseudo-Zeit von der komprimierten Wahrheit (die Sonne wandert ~1° je 4 min).
const DESTILLAT_TOLERANZ_S = 45
const DESTILLAT_MAX_PUNKTE = 300

/** Segmente zu einer Zeitreihe verketten; Zeit-Offsets werden monoton geklemmt. */
export function baueZeitreihe(segments: readonly UploadSegment[]): Zeitreihe {
  const punkte: ZeitPunkt[] = []
  let dist = 0
  let tSek = 0
  for (const seg of segments) {
    for (const p of seg.pts) {
      const [lng = 0, lat = 0, , t = 0] = p
      const vorher = punkte[punkte.length - 1]
      if (vorher) dist += distanzM([vorher.lng, vorher.lat], [lng, lat])
      tSek = Math.max(tSek, t)
      punkte.push({ lng, lat, dist, tSek, mode: seg.mode })
    }
  }
  const erster = punkte[0]
  const letzter = punkte[punkte.length - 1]
  return { punkte, gesamtM: dist, dauerS: erster && letzter ? letzter.tSek - erster.tSek : 0 }
}

/**
 * Pausen finden: maximale Bereiche, in denen alle Punkte im Aufenthaltsradius
 * um den Bereichs-Anfang bleiben und dabei ≥ PAUSE_MIN_S vergehen. Das fängt
 * beide Erscheinungsformen — die Punktwolke im Stand (App speichert alle 30 s
 * weiter) wie die einzelne Aufzeichnungslücke am selben Ort.
 */
export function findePausen(reihe: Zeitreihe): Pause[] {
  const { punkte } = reihe
  // Fürs Suchen reicht ein ≥10-s-Zeitraster — das deckelt die Fensterbreite
  // (und damit die Distanzrechnungen) auch bei sekündlich dichten GPX-Quellen.
  const raster: number[] = []
  let letztT = -Infinity
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i] as ZeitPunkt
    if (p.tSek - letztT >= 10 || i === punkte.length - 1) {
      raster.push(i)
      letztT = p.tSek
    }
  }

  const pausen: Pause[] = []
  let a = 0
  while (a < raster.length - 1) {
    const anker = punkte[raster[a] as number] as ZeitPunkt
    let b = a
    while (b + 1 < raster.length) {
      const kandidat = punkte[raster[b + 1] as number] as ZeitPunkt
      if (distanzM([anker.lng, anker.lat], [kandidat.lng, kandidat.lat]) > PAUSE_RADIUS_M) break
      b++
    }
    const ende = punkte[raster[b] as number] as ZeitPunkt
    if (b > a && ende.tSek - anker.tSek >= PAUSE_MIN_S) {
      pausen.push({
        vonIdx: raster[a] as number,
        bisIdx: raster[b] as number,
        dauerS: ende.tSek - anker.tSek,
      })
      a = b
    } else {
      a++
    }
  }
  return pausen
}

/** Filmdauer des Zeitraffers für eine Pause dieser Länge (s). */
function rampeFilmS(dauerS: number): number {
  const u = Math.min(1, Math.max(0, dauerS) / RAMPE_VOLL_S)
  return RAMPE_MIN_FILM_S + u * (RAMPE_MAX_FILM_S - RAMPE_MIN_FILM_S)
}

/**
 * Pseudo-Zeit je Punkt (s ab time.start): überall die ECHTE Aufnahmezeit, nur
 * um jede Pause herum ein Zeitraffer.
 *
 * Das Fenster reicht eine halbe Rampenlänge vor die Pause und ebenso weit
 * dahinter; innerhalb läuft die Zeit linear mit der STRECKE, außerhalb bleibt
 * sie unangetastet. Am Fensterrand stimmen beide überein — nach der Pause geht
 * die Uhr also wieder richtig, und das Tourende trägt die Uhrzeit, zu der es
 * wirklich stattfand.
 *
 * Die Pausenpunkte selbst liegen (nach `kollabierePausen`) alle auf demselben
 * Ort und bekommen deshalb dieselbe Pseudo-Zeit — im Film ist die Pause ein
 * Augenblick, kein Halt. Erzählt wird sie von der Rampe drumherum.
 */
export function raffePausen(reihe: Zeitreihe, pausen: readonly Pause[]): number[] {
  const { punkte } = reihe
  const out = punkte.map((p) => p.tSek)
  if (punkte.length < 2 || !pausen.length) return out

  // Fenster in Indizes: letzte Stützstelle vor der Rampe → erste dahinter.
  // Überlappende Fenster (zwei Pausen dicht beieinander) werden verschmolzen —
  // sonst überschriebe die zweite Rampe den vorgezogenen Rand der ersten und
  // die Uhr liefe an der Nahtstelle rückwärts.
  const fenster: Array<{ a: number; b: number }> = []
  for (const pause of pausen) {
    const halbeM =
      meterFuerFilmsekunden(rampeFilmS(pause.dauerS), (punkte[pause.vonIdx] as ZeitPunkt).mode) / 2
    const vonM = (punkte[pause.vonIdx] as ZeitPunkt).dist - halbeM
    const bisM = (punkte[pause.bisIdx] as ZeitPunkt).dist + halbeM
    let a = pause.vonIdx
    while (a > 0 && (punkte[a - 1] as ZeitPunkt).dist >= vonM) a--
    let b = pause.bisIdx
    while (b < punkte.length - 1 && (punkte[b + 1] as ZeitPunkt).dist <= bisM) b++
    const letztes = fenster[fenster.length - 1]
    if (letztes && a <= letztes.b) letztes.b = Math.max(letztes.b, b)
    else fenster.push({ a, b })
  }

  for (const { a, b } of fenster) {
    const von = punkte[a] as ZeitPunkt
    const bis = punkte[b] as ZeitPunkt
    const spanneM = bis.dist - von.dist
    for (let i = a + 1; i < b; i++) {
      const p = punkte[i] as ZeitPunkt
      const u = spanneM > 0 ? (p.dist - von.dist) / spanneM : 0
      out[i] = von.tSek + u * (bis.tSek - von.tSek)
    }
  }

  // Netz gegen Rundungsreste: die Pseudo-Zeit muss monoton bleiben, sonst
  // liefe die Sonne stellenweise rückwärts.
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i] as number, out[i - 1] as number)
  return out
}

/** Unter dieser Rest-Strecke bleibt der Kollaps aus — eine Tour, die fast nur
 *  aus Pause besteht, würde sonst zur punktförmigen Route (Player: NaN). */
export const KOLLAPS_MIN_REST_M = 30

/**
 * GPS-Drift in Pausen geometrisch stilllegen: Wer steht, kommt nicht vom
 * Fleck — das GPS schon (200 m in 23 min sind normal). Diese Drift wurde zu
 * echter Strecke: die Kamera zitterte im Film minutenlang auf der Stelle, die
 * km-Statistik zählte Meter, die niemand gegangen ist.
 *
 * Alle Punkte einer erkannten Pause (findePausen: ≥ 15 min im 150-m-Radius)
 * rücken auf ihren Schwerpunkt; die ZEITEN bleiben unangetastet — jeder
 * Overlay-Anker (ISO-Zeitstempel) und die Pseudo-Zeit-Kompression gelten
 * weiter. An Segment-Nähten liegt der Grenzpunkt als Kopie in beiden
 * Segmenten; ragt eine Pause bis an die Naht, werden zeit- und ortsgleiche
 * Duplikate mitgezogen, sonst bliebe eine Kopie stehen und risse einen
 * künstlichen Sprung in die Route.
 */
export function kollabierePausen(segmente: readonly UploadSegment[]): UploadSegment[] {
  const reihe = baueZeitreihe(segmente)
  const pausen = findePausen(reihe)
  if (!pausen.length) return [...segmente]

  // Flach-Index → (Segment, Punkt), in der Verkettungsreihenfolge der Zeitreihe
  const karte: Array<{ seg: number; pt: number }> = []
  segmente.forEach((s, seg) => s.pts.forEach((_, pt) => karte.push({ seg, pt })))

  const punktZu = (i: number): ZeitPunkt => reihe.punkte[i] as ZeitPunkt
  const duplikat = (a: ZeitPunkt, b: ZeitPunkt): boolean =>
    a.tSek === b.tSek && a.lng === b.lng && a.lat === b.lat

  // Ziel-Koordinate je betroffenem Flach-Index
  const ziel = new Map<number, [number, number, number]>()
  for (const pause of pausen) {
    let von = pause.vonIdx
    let bis = pause.bisIdx
    while (von > 0 && duplikat(punktZu(von - 1), punktZu(von))) von--
    while (bis < reihe.punkte.length - 1 && duplikat(punktZu(bis + 1), punktZu(bis))) bis++

    let sLng = 0
    let sLat = 0
    let sEle = 0
    const n = bis - von + 1
    for (let i = von; i <= bis; i++) {
      const { seg, pt } = karte[i] as { seg: number; pt: number }
      const [lng = 0, lat = 0, ele = 0] = (segmente[seg] as UploadSegment).pts[pt] as UploadPunkt
      sLng += lng
      sLat += lat
      sEle += ele
    }
    for (let i = von; i <= bis; i++) ziel.set(i, [sLng / n, sLat / n, sEle / n])
  }

  // Nur betroffene Segmente kopieren; die Zeiten (Index 3) bleiben byte-gleich
  const segStart: number[] = []
  let lauf = 0
  for (const s of segmente) {
    segStart.push(lauf)
    lauf += s.pts.length
  }
  const neu = segmente.map((s, seg) => {
    const start = segStart[seg] as number
    if (!s.pts.some((_, pt) => ziel.has(start + pt))) return s
    return {
      ...s,
      pts: s.pts.map((p, pt): UploadPunkt => {
        const z = ziel.get(start + pt)
        return z ? [z[0], z[1], z[2], p[3]] : p
      }),
    }
  })

  return baueZeitreihe(neu).gesamtM < KOLLAPS_MIN_REST_M ? [...segmente] : neu
}

/** Pseudo-Zeit der ganzen Tour je Punkt (echte Zeit + Zeitraffer an den Pausen). */
export function pseudoZeiten(reihe: Zeitreihe): number[] {
  return raffePausen(reihe, findePausen(reihe))
}

/**
 * Streckenanteil, an dem die Pseudo-Uhr die Aufnahmezeit `tSek` ZEIGT.
 *
 * Die Umkehrung von `raffePausen` und damit das Gegenstück zu
 * `positionZurZeit`: Jene beantwortet „wo war die Tour um 21 Uhr?" (der Ort,
 * für den das Wetter gilt), diese „an welcher Stelle des Films steht 21 Uhr
 * auf der Uhr?". In einer Pause fallen alle Stunden auf denselben ORT — aber
 * auf verschiedene Stellen der Zeitraffer-Rampe. Ohne diese Unterscheidung
 * landeten alle Wetter-Samples einer Pause auf demselben f und nur der letzte
 * überlebte: Ein Regen, der während der Pause einsetzte und wieder aufhörte,
 * verschwand spurlos.
 */
export function anteilZurUhrzeit(
  reihe: Zeitreihe,
  pseudo: readonly number[],
  tSek: number,
): number {
  const { punkte, gesamtM } = reihe
  if (punkte.length < 2 || gesamtM <= 0) return 0
  const anteil = (i: number): number => (punkte[i] as ZeitPunkt).dist / gesamtM
  if (tSek <= (pseudo[0] as number)) return anteil(0)
  const letzter = pseudo.length - 1
  if (tSek >= (pseudo[letzter] as number)) return anteil(letzter)

  // Binärsuche: erster Index mit pseudo >= gesucht (pseudo ist monoton)
  let lo = 0
  let hi = letzter
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((pseudo[mitte] as number) < tSek) lo = mitte + 1
    else hi = mitte
  }
  const spanne = (pseudo[lo] as number) - (pseudo[lo - 1] as number)
  const u = spanne > 0 ? (tSek - (pseudo[lo - 1] as number)) / spanne : 0
  return anteil(lo - 1) + u * (anteil(lo) - anteil(lo - 1))
}

/**
 * Timeline-Destillat: wenige Stützstellen [{f, t}] (stückweise linear), die die
 * gerafften Zeitkurve bis auf DESTILLAT_TOLERANZ_S treffen. `undefined` bei
 * degenerierten Touren (keine Strecke / keine Zeitspanne / kaputter Start) —
 * der Player fällt dann auf die lineare Pseudo-Zeit zurück.
 *
 * Die Zeitraffer-Rampe übersteht das Destillat unbeschadet: Sie ist linear in
 * der Strecke und damit durch ihre beiden Endpunkte exakt beschrieben, und ihre
 * Knicke sind die Stellen mit der größten Abweichung — genau das, was
 * Douglas-Peucker als Erstes behält.
 */
export function destilliereTimeline(
  reihe: Zeitreihe,
  startIso: string,
): Array<{ f: number; t: string }> | undefined {
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return undefined
  if (reihe.punkte.length < 2 || reihe.gesamtM < 10 || reihe.dauerS <= 0) return undefined

  const tKomp = pseudoZeiten(reihe)
  const f = reihe.punkte.map((p) => p.dist / reihe.gesamtM)

  let toleranz = DESTILLAT_TOLERANZ_S
  let behalten = destilliere(f, tKomp, toleranz)
  while (behalten.length > DESTILLAT_MAX_PUNKTE) {
    toleranz *= 2
    behalten = destilliere(f, tKomp, toleranz)
  }

  const iso = (sek: number): string =>
    `${new Date(startMs + sek * 1000).toISOString().split('.')[0]}Z`
  const timeline: Array<{ f: number; t: string }> = []
  for (const i of behalten) {
    const eintrag = { f: Math.round((f[i] as number) * 1e4) / 1e4, t: iso(tKomp[i] as number) }
    const vorher = timeline[timeline.length - 1]
    if (vorher && vorher.f === eintrag.f && vorher.t === eintrag.t) continue
    timeline.push(eintrag)
  }
  return timeline.length >= 2 ? timeline : undefined
}

// Douglas-Peucker über der (monotonen) Kurve f→t mit vertikaler Zeit-Abweichung
// als Maß. Iterativ (Stack) wie vereinfacheSegment — lange Aufzeichnungen
// sollen keinen Callstack sprengen. Liefert sortierte Index-Liste.
function destilliere(f: readonly number[], t: readonly number[], toleranzS: number): number[] {
  const n = f.length
  const behalten = new Array<boolean>(n).fill(false)
  behalten[0] = behalten[n - 1] = true
  const stapel: Array<[number, number]> = [[0, n - 1]]
  while (stapel.length) {
    const [von, bis] = stapel.pop() as [number, number]
    const fVon = f[von] as number
    const fBis = f[bis] as number
    const tVon = t[von] as number
    const tBis = t[bis] as number
    const spanne = fBis - fVon
    let maxAbstand = 0
    let index = -1
    for (let i = von + 1; i < bis; i++) {
      // Senkrechter f-Sprung (Pause): jede Zeitabweichung zählt gegen den Anfang
      const erwartet =
        spanne <= 0 ? tVon : tVon + (((f[i] as number) - fVon) / spanne) * (tBis - tVon)
      const abstand = Math.abs((t[i] as number) - erwartet)
      if (abstand > maxAbstand) {
        maxAbstand = abstand
        index = i
      }
    }
    if (index >= 0 && maxAbstand > toleranzS) {
      behalten[index] = true
      stapel.push([von, index], [index, bis])
    }
  }
  const indizes: number[] = []
  for (let i = 0; i < n; i++) if (behalten[i]) indizes.push(i)
  return indizes
}

/**
 * Position (und Streckenanteil) zur Tour-Zeit `tSek` — linear zwischen den
 * umgebenden Punkten interpoliert, außerhalb geklemmt. Grundlage der
 * Raum-Zeit-Samples des Auto-Wetters („wo war die Tour um 14 Uhr?").
 */
export function positionZurZeit(
  reihe: Zeitreihe,
  tSek: number,
): { lng: number; lat: number; f: number } {
  const { punkte, gesamtM } = reihe
  const erster = punkte[0] as ZeitPunkt
  const letzter = punkte[punkte.length - 1] as ZeitPunkt
  const anteil = (p: ZeitPunkt): number => (gesamtM > 0 ? p.dist / gesamtM : 0)
  if (tSek <= erster.tSek) return { lng: erster.lng, lat: erster.lat, f: anteil(erster) }
  if (tSek >= letzter.tSek) return { lng: letzter.lng, lat: letzter.lat, f: anteil(letzter) }

  // Binärsuche: erster Punkt mit tSek >= gesucht (tSek ist monoton)
  let lo = 0
  let hi = punkte.length - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((punkte[mitte] as ZeitPunkt).tSek < tSek) lo = mitte + 1
    else hi = mitte
  }
  const b = punkte[lo] as ZeitPunkt
  const a = punkte[lo - 1] as ZeitPunkt
  const spanne = b.tSek - a.tSek
  const u = spanne > 0 ? (tSek - a.tSek) / spanne : 1
  return {
    lng: a.lng + u * (b.lng - a.lng),
    lat: a.lat + u * (b.lat - a.lat),
    f: anteil(a) + u * (anteil(b) - anteil(a)),
  }
}

/**
 * Umkehrung von `positionZurZeit`: Tour-Zeit zum Streckenanteil `f`.
 *
 * Gebraucht, um Streckenanteile des Tour-JSONs (Wetter-Keyframes) zurück in
 * absolute Zeiten zu übersetzen — die Ankerform aller Studio-Edits. Steht die
 * Tour (Pause), wächst `tSek` bei gleichbleibender Distanz: der Anteil ist dort
 * mehrdeutig, geliefert wird der FRÜHESTE Zeitpunkt (der Moment des Ankommens).
 * Außerhalb 0..1 wird geklemmt — f=1 ist damit immer das Tour-Ende, auch wenn
 * die Tour dort noch steht.
 */
export function zeitZurPosition(reihe: Zeitreihe, f: number): number {
  const { punkte, gesamtM } = reihe
  const erster = punkte[0] as ZeitPunkt | undefined
  const letzter = punkte[punkte.length - 1] as ZeitPunkt | undefined
  if (!erster || !letzter) return 0
  const ziel = Math.max(0, Math.min(1, f)) * gesamtM
  if (ziel <= erster.dist) return erster.tSek
  if (ziel >= letzter.dist) return letzter.tSek

  // Binärsuche: erster Punkt mit dist >= ziel (dist ist monoton)
  let lo = 0
  let hi = punkte.length - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((punkte[mitte] as ZeitPunkt).dist < ziel) lo = mitte + 1
    else hi = mitte
  }
  const b = punkte[lo] as ZeitPunkt
  const a = punkte[lo - 1] as ZeitPunkt
  const spanne = b.dist - a.dist
  const u = spanne > 0 ? (ziel - a.dist) / spanne : 0
  return a.tSek + u * (b.tSek - a.tSek)
}
