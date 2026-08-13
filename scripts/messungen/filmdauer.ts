// Wie lang ist der Film je Tour — und was ändert eine gestalterische Zahl daran?
//
// Die Filmdauer ist keine technische Größe: Sie hängt an `MODUS_TEMPO`, an
// `RAMPE_M` und daran, wo die Achse überhaupt Rampen setzt. Wer eine dieser
// Zahlen anfasst, ändert JEDE bestehende Tour — auf dem Papier, nicht im
// Material. Dieses Skript ist der Beleg dafür: dieselbe Achse, die Player und
// Studio rechnen, über die vier lokalen Fixtur-Touren.
//
// Zwei Tempo-Stände nebeneinander, weil `MODUS_TEMPO` ein gewöhnliches Objekt
// ist und sich für eine Messung umstellen lässt. Das ist hier Absicht und
// nirgends sonst erlaubt.
//
// Aufruf: npx tsx scripts/messungen/filmdauer.ts
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute, nearestS, gruppiereStopps, dist } from '../../src/geo.js'
import { MODUS_TEMPO, baueFilmachse, interpoliere, momentHaltS, type Streckenhalt } from '../../src/filmachse.js'
import { HOLD_AUSBLEND, standzeitS } from '../../src/einblendung.js'

const WURZEL = process.env['MAPTALE_DATEN_DIR']
  ? `${process.env['MAPTALE_DATEN_DIR']}/tours`
  : new URL('../../server/daten/tours', import.meta.url).pathname

interface Tourbau {
  id: string
  grenzen: Array<{ abM: number; mode: string }>
  gesamtM: number
  halte: Streckenhalt[]
}

const touren: Tourbau[] = []
for (const id of readdirSync(WURZEL)) {
  let tour: { segments?: Array<{ mode: string; pts: number[][] }>; media?: unknown[]; moments?: unknown[] }
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
    for (let i = 1; i < seg.pts.length; i++) rohGesamt += dist(seg.pts[i - 1] as never, seg.pts[i] as never)
  }
  // Route-Meter → ROH-Meter über dieselbe Tabelle wie der Player (src/main.ts):
  // Catmull-Rom streckt die Route ungleichmäßig, ein einzelner Faktor läge je
  // nach Tour ein bis zwei Sekunden daneben.
  const rohKum: number[] = [0]
  for (let i = 1; i < wegpunkte.length; i++) rohKum.push((rohKum[i - 1] as number) + dist(wegpunkte[i - 1] as never, wegpunkte[i] as never))
  const rohBeiS = (x: number): number => interpoliere(route.wpS, rohKum, x)
  const medien = ((tour.media ?? []) as Array<{ anchor?: number[] }>).filter((m) => Array.isArray(m.anchor))
  const verankert = medien.map((m) => ({ ...m, s: nearestS(route, m.anchor as never) }))
  const stopps = gruppiereStopps(verankert as never) as Array<{ s: number; items: Array<Record<string, unknown>> }>
  const halte: Streckenhalt[] = [
    ...stopps.map((h) => ({
      meterM: rohBeiS(h.s),
      breiteS: h.items.reduce(
        (summe, it) =>
          summe +
          standzeitS({ ...it, ...(it['durationS'] !== undefined ? { dauerS: it['durationS'] as number } : {}) }) +
          HOLD_AUSBLEND,
        0,
      ),
    })),
    ...((tour.moments ?? []) as Array<{ f: number; art: string; dauerS?: number }>).map((mo) => ({
      meterM: rohGesamt * mo.f,
      breiteS: momentHaltS(mo),
    })),
  ]
  touren.push({ id, grenzen, gesamtM: rohGesamt, halte })
}

const dauer = (t: Tourbau): number => baueFilmachse(t.grenzen, t.gesamtM, t.halte).gesamtS
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

const walkVorher = 0.4
const walkJetzt = MODUS_TEMPO.walk

console.log(`Tour                walk ${walkVorher}      walk ${walkJetzt}      Differenz`)
for (const t of touren) {
  MODUS_TEMPO.walk = walkVorher
  const a = dauer(t)
  MODUS_TEMPO.walk = walkJetzt
  const b = dauer(t)
  console.log(
    `${t.id.padEnd(18)} ${a.toFixed(1).padStart(7)} s (${mmss(a)})  ${b.toFixed(1).padStart(7)} s (${mmss(b)})  ` +
      `${(b - a >= 0 ? '+' : '') + (b - a).toFixed(1)} s (${(((b - a) / a) * 100).toFixed(1)} %)`,
  )
}
