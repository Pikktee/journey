// Gehpausen erkennen: Wer mit dem Rad unterwegs ist, schiebt bergauf, geht
// durch die Altstadt und steht an Ampeln. In der Kamerafahrt sah das bisher
// aus wie eine langsame Radfahrt, weil die App EINEN Modus für die ganze Tour
// kannte — und die Chip-Reihe, mit der man ihn unterwegs hätte umschalten
// können, hat niemand bedient.
//
// Das Fortbewegungsmittel bleibt die Angabe des Nutzers (aus dem Start-Blatt
// oder dem Editor). Hier wird nur getrennt, wo er stattdessen zu Fuß war.
// Bewusst konservativ: aus dem Tempo lässt sich Gehen von Fahren
// unterscheiden, aber nicht Moped von Jeep von Tram.

import { distanzM } from './geo.js'
import type { Modus, UploadPunkt, UploadSegment } from '../schema/upload.js'

/** Halbe Fensterbreite für den gleitenden Median (s). */
const FENSTER_S = 30

/** Unter diesem Tempo beginnt ein Gehabschnitt (km/h). */
const GEHEN_EIN = 5.5

/**
 * Erst darüber endet er wieder — die Lücke zwischen den Schwellen verhindert,
 * dass ein Abschnitt bei jedem Schwanken um den Grenzwert zerfällt.
 */
const GEHEN_AUS = 8

/** Kürzere Abschnitte gehen im Nachbarn auf (s). */
const MIN_GEHEN_S = 120
const MIN_FAHREN_S = 90

/** Ab diesem Median-Tempo gilt eine Tour ohne Angabe als Radfahrt (km/h). */
const RAD_AB_KMH = 7

/**
 * Tempo je Punkt als gleitender Median über ±FENSTER_S.
 *
 * Median statt Mittelwert, weil GPS-Ausreißer sonst einzelne Punkte auf
 * 80 km/h schleudern und dort einen Fahrabschnitt erfinden würden.
 */
export function tempoVerlaufKmh(pts: readonly UploadPunkt[]): number[] {
  if (pts.length < 2) return pts.map(() => 0)

  // Momentantempo je Punkt aus dem Abstand zum Nachbarn
  const roh: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!
    const b = pts[Math.min(pts.length - 1, i + 1)]!
    const dt = b[3] - a[3]
    roh.push(dt > 0 ? (distanzM([a[0], a[1]], [b[0], b[1]]) / dt) * 3.6 : 0)
  }

  return pts.map((p, i) => {
    const fenster: number[] = []
    for (let j = i; j >= 0 && p[3] - pts[j]![3] <= FENSTER_S; j--) fenster.push(roh[j]!)
    for (let j = i + 1; j < pts.length && pts[j]![3] - p[3] <= FENSTER_S; j++) fenster.push(roh[j]!)
    fenster.sort((x, y) => x - y)
    const mitte = Math.floor(fenster.length / 2)
    return fenster.length % 2 ? fenster[mitte]! : (fenster[mitte - 1]! + fenster[mitte]!) / 2
  })
}

/** Ein zusammenhängender Abschnitt gleicher Fortbewegung. */
interface Abschnitt {
  vonIndex: number
  bisIndex: number
  gehen: boolean
}

/** Punkte anhand des Tempos in Geh- und Fahrabschnitte teilen (mit Hysterese). */
function teileNachTempo(tempo: readonly number[]): Abschnitt[] {
  const abschnitte: Abschnitt[] = []
  let gehen = tempo[0]! < GEHEN_EIN
  let start = 0
  for (let i = 1; i < tempo.length; i++) {
    const wechsel = gehen ? tempo[i]! > GEHEN_AUS : tempo[i]! < GEHEN_EIN
    if (!wechsel) continue
    abschnitte.push({ vonIndex: start, bisIndex: i, gehen })
    gehen = !gehen
    start = i
  }
  abschnitte.push({ vonIndex: start, bisIndex: tempo.length - 1, gehen })
  return abschnitte
}

/**
 * Zu kurze Abschnitte im Nachbarn aufgehen lassen. Eine Ampel ist kein
 * Spaziergang, und ein Meter Rollen mitten im Wandern keine Radfahrt.
 */
function verschmelzeKurze(abschnitte: Abschnitt[], pts: readonly UploadPunkt[]): Abschnitt[] {
  const dauer = (a: Abschnitt): number => pts[a.bisIndex]![3] - pts[a.vonIndex]![3]
  let liste = abschnitte
  let geaendert = true
  while (geaendert && liste.length > 1) {
    geaendert = false
    for (let i = 0; i < liste.length; i++) {
      const a = liste[i]!
      const grenze = a.gehen ? MIN_GEHEN_S : MIN_FAHREN_S
      if (dauer(a) >= grenze) continue
      // In den (zeitlich) größeren Nachbarn schlucken, damit kurze Stücke
      // nicht reihum die Richtung wechseln
      const vor = liste[i - 1]
      const nach = liste[i + 1]
      const ziel = !vor ? nach : !nach ? vor : dauer(vor) >= dauer(nach) ? vor : nach
      if (!ziel) break
      ziel.vonIndex = Math.min(ziel.vonIndex, a.vonIndex)
      ziel.bisIndex = Math.max(ziel.bisIndex, a.bisIndex)
      liste = liste.filter((x) => x !== a)
      // Gleichartige Nachbarn zusammenziehen, die durch das Schlucken entstanden
      liste = liste.reduce<Abschnitt[]>((acc, x) => {
        const letzte = acc[acc.length - 1]
        if (letzte && letzte.gehen === x.gehen) {
          letzte.bisIndex = Math.max(letzte.bisIndex, x.bisIndex)
          return acc
        }
        acc.push(x)
        return acc
      }, [])
      geaendert = true
      break
    }
  }
  return liste
}

/**
 * Primärmodus einer Tour ohne Angabe: Nur die Hebung walk → bike wird geraten.
 * Moped, Jeep, Tram und Fähre lassen sich am Tempo nicht auseinanderhalten —
 * sie bleiben Sache des Nutzers.
 */
function primaerOhneAngabe(tempo: readonly number[]): Modus {
  const fahrend = tempo.filter((t) => t >= GEHEN_EIN).sort((a, b) => a - b)
  if (!fahrend.length) return 'walk'
  const median = fahrend[Math.floor(fahrend.length / 2)]!
  return median > RAD_AB_KMH ? 'bike' : 'walk'
}

/**
 * Ein Segment in Geh- und Primärabschnitte zerlegen.
 *
 * Der Grenzpunkt gehört BEIDEN Abschnitten — dieselbe Konvention wie bei den
 * Modus-Grenzen aus dem Editor, sonst entsteht beim Verketten eine Lücke.
 * Ändert sich nichts, kommt das Segment unverändert zurück.
 */
export function trenneGehabschnitte(segment: UploadSegment): UploadSegment[] {
  if (segment.pts.length < 4) return [segment]

  const tempo = tempoVerlaufKmh(segment.pts)
  const primaer: Modus = segment.mode === 'walk' ? primaerOhneAngabe(tempo) : segment.mode
  // Ohne erkennbare Fahrt bleibt alles, wie es ist
  if (primaer === 'walk') return [segment]

  const abschnitte = verschmelzeKurze(teileNachTempo(tempo), segment.pts)
  if (abschnitte.length < 2) {
    // Ein einziger Abschnitt: nur der Modus kann sich noch geändert haben.
    // Das Label des Originals fällt dabei weg — es beschrieb den alten Modus.
    const mode: Modus = abschnitte[0]?.gehen ? 'walk' : primaer
    return mode === segment.mode ? [segment] : [{ mode, pts: segment.pts }]
  }

  return abschnitte.map((a) => ({
    mode: a.gehen ? ('walk' as Modus) : primaer,
    pts: segment.pts.slice(a.vonIndex, a.bisIndex + 1),
  }))
}

/**
 * Automatik für eine ganze Aufzeichnung.
 *
 * Sie greift nur, wenn genau EIN Segment vorliegt: Mehrere Segmente heißen,
 * dass jemand den Modus bewusst umgeschaltet hat (ältere Aufnahmen mit der
 * Chip-Reihe, oder ein GPX-Import mit Vorgabe) — diese Entscheidung wird nicht
 * überschrieben.
 */
export function trenneGehabschnitteInSegmenten(segmente: readonly UploadSegment[]): UploadSegment[] {
  if (segmente.length !== 1) return [...segmente]
  return trenneGehabschnitte(segmente[0]!)
}
