// Wie weit weicht `route.total` (Catmull-Rom + 14-m-Resample) von der
// Rohgeometrie ab, in der der SERVER seine f-Werte misst? Das ist der
// Maßstabsfehler zwischen Studio-Filmzeit und Player-Abspielzeit.
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute } from '../../src/geo.js'

// Die gerenderten Touren der LOKALEN Instanz. Über MAPTALE_DATEN_DIR
// umlenkbar, falls eine isolierte Instanz gemessen werden soll.
const WURZEL = process.env['MAPTALE_DATEN_DIR']
  ? `${process.env['MAPTALE_DATEN_DIR']}/tours`
  : new URL('../../server/daten/tours', import.meta.url).pathname

const meter = (a: number[], b: number[]): number => {
  const kx = 111_320 * Math.cos((a[1]! * Math.PI) / 180)
  return Math.hypot((b[0]! - a[0]!) * kx, (b[1]! - a[1]!) * 110_540)
}

const TEMPO: Record<string, number> = { walk: 0.4, bike: 1, moped: 1.15, jeep: 1.45, tram: 1.25, ferry: 2.5 }

console.log('Tour              roh (m)  route.total  Abw.%   Filmzeit roh  Filmzeit Player  Abw. (s)')
for (const id of readdirSync(WURZEL)) {
  let tour: any
  try {
    tour = JSON.parse(readFileSync(`${WURZEL}/${id}/tour.json`, 'utf8'))
  } catch {
    continue
  }
  if (!tour.segments?.length) continue

  let roh = 0
  let filmRoh = 0
  for (const seg of tour.segments) {
    const tempo = 120 * (TEMPO[seg.mode] ?? 1)
    for (let i = 1; i < seg.pts.length; i++) {
      const d = meter(seg.pts[i - 1], seg.pts[i])
      roh += d
      filmRoh += d / tempo
    }
  }

  // Genau wie main.ts: Segmente verketten, buildRoute darüber
  const wegpunkte = tour.segments.flatMap((s: any, i: number) => (i ? s.pts.slice(1) : s.pts))
  const route = buildRoute(wegpunkte)

  // Filmzeit über die GEBAUTE Route, Modus je Abschnitt (Grenzen wie main.ts:
  // kumulierte Segmentlängen auf die neue Gesamtlänge skaliert)
  let vor = 0
  const grenzen: Array<{ s: number; mode: string }> = []
  let summe = 0
  for (const seg of tour.segments) {
    grenzen.push({ s: summe, mode: seg.mode })
    for (let i = 1; i < seg.pts.length; i++) summe += meter(seg.pts[i - 1], seg.pts[i])
  }
  const skala = route.total / summe
  let filmPlayer = 0
  for (let i = 1; i < route.coords.length; i++) {
    const ds = route.cum[i]! - route.cum[i - 1]!
    const s = route.cum[i - 1]!
    let mode = grenzen[0]!.mode
    for (const g of grenzen) if (g.s * skala <= s + 1) mode = g.mode
    filmPlayer += ds / (120 * (TEMPO[mode] ?? 1))
  }
  vor = ((route.total - roh) / roh) * 100

  console.log(
    `${id.slice(0, 16).padEnd(17)} ${String(Math.round(roh)).padStart(7)}  ${String(Math.round(route.total)).padStart(11)}  ` +
      `${vor >= 0 ? '+' : ''}${vor.toFixed(2)}%  ${filmRoh.toFixed(1).padStart(11)} s  ${filmPlayer.toFixed(1).padStart(13)} s  ${(filmPlayer - filmRoh >= 0 ? '+' : '') + (filmPlayer - filmRoh).toFixed(1)}`,
  )
}
