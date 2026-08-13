// Kalibrierung der Rampenlänge (E14): Wie viel Filmzeit kosten die Rampen der
// NEUEN Achse gegenüber den früher simulierten?
//
// `RAMPE_M` ist eine GESTALTERISCHE Zahl — sie entscheidet, wie sich der Antritt
// anfühlt — und sie soll die Fahrt nicht sprunghaft anders machen. Also wird sie
// gegen die Summe der heutigen Rampen-Sekunden ausgerichtet
// (rampen-simulation.ts, 64,3 s über die vier Fixtur-Touren). Dass sich die
// VERTEILUNG dabei verschiebt, ist gewollt: Heute wächst der Zuschlag mit dem
// Tempo, künftig fällt er damit.
//
// Die Zeit→Strecke-Streckung ist hier bewusst grob (ein Faktor statt der Tabelle
// aus main.ts) — für eine Kalibrierung auf ganze Zehner-Meter genügt sie, und
// der Fehler liegt unter einem Prozent der Rampensumme.
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute, nearestS, gruppiereStopps, dist } from '../../src/geo.js'
import { baueFilmachse, momentHaltS, type Streckenhalt } from '../../src/filmachse.js'
import { HOLD_AUSBLEND, standzeitS } from '../../src/einblendung.js'

const WURZEL = new URL('../../server/daten/tours', import.meta.url).pathname
// Heutige Rampen-Sekunden je Tour (scripts/messungen/rampen-simulation.ts)
const HEUTE: Record<string, number> = {
  t_MpDncFJcwYupqG: 32.4,
  t_TeH5rXaXkTKxZm: 14.7,
  t_av6FvtBXV2eFEx: 1.3,
  t_cGuHmm3vMa4ggQ: 15.9,
}

interface Befund { id: string; ohne: number; je: (l: number) => number }
const touren: Befund[] = []

for (const id of readdirSync(WURZEL)) {
  let tour: any
  try { tour = JSON.parse(readFileSync(`${WURZEL}/${id}/tour.json`, 'utf8')) } catch { continue }
  if (!tour.segments?.length) continue

  const wegpunkte = tour.segments.flatMap((s: any, i: number) => (i ? s.pts.slice(1) : s.pts))
  const route = buildRoute(wegpunkte)
  const rohKum: number[] = [0]
  for (let i = 1; i < wegpunkte.length; i++) rohKum.push(rohKum[i - 1]! + dist(wegpunkte[i - 1], wegpunkte[i]))
  const rohGesamt = rohKum[rohKum.length - 1]!
  const skala = rohGesamt / route.total
  const rohBeiS = (s: number) => s * skala // grob: für die Kalibrierung genügt die Streckung

  let m = 0
  const grenzen: Array<{ abM: number; mode: string }> = []
  for (const seg of tour.segments) {
    grenzen.push({ abM: m, mode: seg.mode })
    for (let i = 1; i < seg.pts.length; i++) m += dist(seg.pts[i - 1], seg.pts[i])
  }

  const medien = (tour.media ?? []).filter((x: any) => Array.isArray(x.anchor))
  const verankert = medien.map((x: any) => ({ ...x, s: nearestS(route, x.anchor) }))
  const stopps = gruppiereStopps(verankert as any).sort((a: any, b: any) => a.s - b.s)
  const halte: Streckenhalt[] = [
    ...stopps.map((h: any) => ({
      meterM: rohBeiS(h.s),
      breiteS: h.items.reduce(
        (s: number, it: any) => s + standzeitS({ ...it, ...(it.durationS !== undefined ? { dauerS: it.durationS } : {}) }) + HOLD_AUSBLEND,
        0,
      ),
    })),
    ...(tour.moments ?? []).map((mo: any) => ({ meterM: rohGesamt * mo.f, breiteS: momentHaltS(mo) })),
  ]
  const ohne = baueFilmachse(grenzen, rohGesamt, halte, { rampeM: 0 }).gesamtS
  touren.push({ id, ohne, je: (l) => baueFilmachse(grenzen, rohGesamt, halte, { rampeM: l }).gesamtS - ohne })
}

console.log('L (m)   ' + touren.map((t) => t.id.slice(0, 8).padStart(9)).join('') + '     Summe   heute   Abw.')
const heuteSumme = touren.reduce((s, t) => s + (HEUTE[t.id] ?? 0), 0)
for (const L of [80, 100, 120, 130, 140, 150, 160, 180, 200]) {
  const werte = touren.map((t) => t.je(L))
  const summe = werte.reduce((a, b) => a + b, 0)
  console.log(
    String(L).padEnd(8) + werte.map((v) => v.toFixed(1).padStart(9)).join('') +
      `   ${summe.toFixed(1).padStart(7)}   ${heuteSumme.toFixed(1)}   ${(((summe - heuteSumme) / heuteSumme) * 100).toFixed(1)} %`,
  )
}
console.log('\nheute je Tour: ' + touren.map((t) => `${t.id.slice(0, 8)} ${HEUTE[t.id]}`).join(' · '))
