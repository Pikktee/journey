// Der Rest-Fehler, den KEINE Uhr behebt: Server und Player parametrisieren
// dieselbe Strecke verschieden. Der Server misst `f` auf der Rohgeometrie, der
// Player rechnet `f * route.total` auf der Catmull-Rom-Route. Wo die Glättung
// ungleichmäßig verlängert, landet ein Ton-Anker neben seiner gemeinten Stelle.
//
// Gemessen je Rohpunkt: f_server vs. frac_player am SELBEN physischen Punkt,
// umgerechnet in Filmsekunden.
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute, nearestS } from '../../src/geo.js'

// Die gerenderten Touren der LOKALEN Instanz. Über MAPTALE_DATEN_DIR
// umlenkbar, falls eine isolierte Instanz gemessen werden soll.
const WURZEL = process.env['MAPTALE_DATEN_DIR']
  ? `${process.env['MAPTALE_DATEN_DIR']}/tours`
  : new URL('../../server/daten/tours', import.meta.url).pathname
const TEMPO: Record<string, number> = { walk: 0.4, bike: 1, moped: 1.15, jeep: 1.45, tram: 1.25, ferry: 2.5 }

const meter = (a: number[], b: number[]): number => {
  const kx = 111_320 * Math.cos((a[1]! * Math.PI) / 180)
  return Math.hypot((b[0]! - a[0]!) * kx, (b[1]! - a[1]!) * 110_540)
}

console.log('Tour               Filmdauer   max |Δf|    → Sekunden   Median    Anker-Fehler nach Skalierung')
for (const id of readdirSync(WURZEL)) {
  let tour: any
  try {
    tour = JSON.parse(readFileSync(`${WURZEL}/${id}/tour.json`, 'utf8'))
  } catch {
    continue
  }
  if (!tour.segments?.length) continue

  const punkte: number[][] = []
  let rohM = 0
  let film = 0
  const dist: number[] = []
  const filmBei: number[] = []
  for (const seg of tour.segments) {
    const tempo = 120 * (TEMPO[seg.mode] ?? 1)
    for (let i = 0; i < seg.pts.length; i++) {
      if (punkte.length) {
        const d = meter(punkte[punkte.length - 1]!, seg.pts[i])
        rohM += d
        film += d / tempo
      }
      punkte.push(seg.pts[i])
      dist.push(rohM)
      filmBei.push(film)
    }
  }
  const filmDauer = film

  const wegpunkte = tour.segments.flatMap((s: any, i: number) => (i ? s.pts.slice(1) : s.pts))
  const route = buildRoute(wegpunkte)

  const fehler: number[] = []
  for (let i = 0; i < punkte.length; i++) {
    const fServer = dist[i]! / rohM
    const sPlayer = nearestS(route, [punkte[i]![0]!, punkte[i]![1]!])
    const fracPlayer = sPlayer / route.total
    fehler.push(fracPlayer - fServer)
  }
  const abs = fehler.map(Math.abs).sort((a, b) => a - b)
  const max = abs[abs.length - 1]!
  const median = abs[Math.floor(abs.length / 2)]!

  console.log(
    `${id.slice(0, 16).padEnd(18)} ${filmDauer.toFixed(1).padStart(7)} s   ${(max * 100).toFixed(2).padStart(6)} %   ` +
      `${(max * filmDauer).toFixed(2).padStart(8)} s   ${(median * filmDauer).toFixed(2).padStart(6)} s   ` +
      `bleibt (Skalierung ändert nur den Mittelwert)`,
  )
}
