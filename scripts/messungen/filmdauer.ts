// Wie lang ist der Film je Tour — und was ändert eine gestalterische Zahl daran?
//
// Die Filmdauer ist keine technische Größe: Sie hängt an `TRAVEL_MODE_TEMPO`, an
// `RAMP_M` und daran, wo die Achse überhaupt Rampen setzt. Wer eine dieser
// Zahlen anfasst, ändert JEDE bestehende Tour — auf dem Papier, nicht im
// Material. Dieses Skript ist der Beleg dafür: dieselbe Achse, die Player und
// Studio rechnen, über die vier lokalen Fixtur-Touren.
//
// Zwei Tempo-Stände nebeneinander, weil `TRAVEL_MODE_TEMPO` ein gewöhnliches Objekt
// ist und sich für eine Messung umstellen lässt. Das ist hier Absicht und
// nirgends sonst erlaubt.
//
// Aufruf: npx tsx scripts/messungen/filmdauer.ts
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute, nearestS, groupStops, dist } from '../../src/geo.js'
import {
  TRAVEL_MODE_TEMPO,
  buildFilmAxis,
  interpolate,
  momentHoldS,
  type DistanceStop,
} from '../../src/film-axis.js'
import { HOLD_FADE_OUT_S, holdS } from '../../src/card-timing.js'

const WURZEL = process.env['MAPTALE_DATA_DIR']
  ? `${process.env['MAPTALE_DATA_DIR']}/tours`
  : new URL('../../server/daten/tours', import.meta.url).pathname

interface Tourbau {
  id: string
  grenzen: Array<{ abM: number; mode: string }>
  gesamtM: number
  halte: DistanceStop[]
}

const touren: Tourbau[] = []
for (const id of readdirSync(WURZEL)) {
  let tour: {
    segments?: Array<{ mode: string; pts: number[][] }>
    media?: unknown[]
    moments?: unknown[]
  }
  try {
    tour = JSON.parse(readFileSync(`${WURZEL}/${id}/tour.json`, 'utf8'))
  } catch {
    continue
  }
  if (!tour.segments?.length) continue

  const wegpunkte = tour.segments.flatMap((s, i) => (i ? s.pts.slice(1) : s.pts))
  const route = buildRoute(wegpunkte as never)
  let rohGesamt = 0
  const grenzen: Array<{ abM: number; mode: string }> = []
  for (const seg of tour.segments) {
    grenzen.push({ abM: rohGesamt, mode: seg.mode })
    for (let i = 1; i < seg.pts.length; i++)
      rohGesamt += dist(seg.pts[i - 1] as never, seg.pts[i] as never)
  }
  // Route-Meter → ROH-Meter über dieselbe Tabelle wie der Player (src/main.ts):
  // Catmull-Rom streckt die Route ungleichmäßig, ein einzelner Faktor läge je
  // nach Tour ein bis zwei Sekunden daneben.
  const rohKum: number[] = [0]
  for (let i = 1; i < wegpunkte.length; i++)
    rohKum.push((rohKum[i - 1] as number) + dist(wegpunkte[i - 1] as never, wegpunkte[i] as never))
  const rohBeiS = (x: number): number => interpolate(route.wpS, rohKum, x)
  const medien = ((tour.media ?? []) as Array<{ anchor?: number[] }>).filter((m) =>
    Array.isArray(m.anchor),
  )
  const verankert = medien.map((m) => ({ ...m, s: nearestS(route, m.anchor as never) }))
  const stopps = groupStops(verankert as never) as Array<{
    s: number
    items: Array<Record<string, unknown>>
  }>
  const halte: DistanceStop[] = [
    ...stopps.map((h) => ({
      meterM: rohBeiS(h.s),
      widthS: h.items.reduce(
        (summe, it) =>
          summe +
          holdS({
            ...it,
            ...(it['durationS'] !== undefined ? { durationS: it['durationS'] as number } : {}),
          }) +
          HOLD_FADE_OUT_S,
        0,
      ),
    })),
    ...((tour.moments ?? []) as Array<{ f: number; art: string; dauerS?: number }>).map((mo) => ({
      meterM: rohGesamt * mo.f,
      widthS: momentHoldS(mo),
    })),
  ]
  touren.push({ id, grenzen, gesamtM: rohGesamt, halte })
}

const dauer = (t: Tourbau): number => buildFilmAxis(t.grenzen, t.gesamtM, t.halte).totalS
const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

const walkVorher = 0.4
const walkJetzt = TRAVEL_MODE_TEMPO.walk

console.log(`Tour                walk ${walkVorher}      walk ${walkJetzt}      Differenz`)
for (const t of touren) {
  TRAVEL_MODE_TEMPO.walk = walkVorher
  const a = dauer(t)
  TRAVEL_MODE_TEMPO.walk = walkJetzt
  const b = dauer(t)
  console.log(
    `${t.id.padEnd(18)} ${a.toFixed(1).padStart(7)} s (${mmss(a)})  ${b.toFixed(1).padStart(7)} s (${mmss(b)})  ` +
      `${(b - a >= 0 ? '+' : '') + (b - a).toFixed(1)} s (${(((b - a) / a) * 100).toFixed(1)} %)`,
  )
}
