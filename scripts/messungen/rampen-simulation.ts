// Wie viel Filmzeit kosteten Anfahren und Ausrollen in der Engine VOR Etappe 4?
//
// Der Browser taugte dafür nicht: headless drosselt rAF, und `dt` war in tour.ts
// auf 0,05 s geklemmt — der Player lief dort um den Drosselfaktor zu langsam.
// Also ist die damalige Geschwindigkeitslogik hier Zeile für Zeile nachgebildet
// und mit festem dt = 1/60 integriert.
//
// **Das Skript beschreibt einen Zustand, den es nicht mehr gibt** — die Engine
// integriert `s` seit E2 nicht mehr selbst, und die Rampen sind seit E14 eine
// feste Form in der Achse. Es bleibt trotzdem stehen, weil es die
// KALIBRIER-GRUNDLAGE ist: An seinen 64,3 Rampen-Sekunden über die vier
// Fixtur-Touren ist `RAMPE_M` (src/filmachse.ts) ausgerichtet. Die Gegenrechnung
// steht in rampen-kalibrierung.ts, der heutige Stand in durchlauf-gegen-achse.mjs.
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute, nearestS, gruppiereStopps } from '../../src/geo.js'

// Die gerenderten Touren der LOKALEN Instanz. Über MAPTALE_DATEN_DIR
// umlenkbar, falls eine isolierte Instanz gemessen werden soll.
const WURZEL = process.env['MAPTALE_DATEN_DIR']
  ? `${process.env['MAPTALE_DATEN_DIR']}/tours`
  : new URL('../../server/daten/tours', import.meta.url).pathname
const TEMPO: Record<string, number> = {
  walk: 0.4,
  bike: 1,
  moped: 1.15,
  jeep: 1.45,
  tram: 1.25,
  ferry: 2.5,
}
const BASIS = 120
const HOLD_HIDE = 5.2
const HOLD_AUSBLEND = 0.8
const DT = 1 / 60

const meter = (a: number[], b: number[]): number => {
  const kx = 111_320 * Math.cos((a[1]! * Math.PI) / 180)
  return Math.hypot((b[0]! - a[0]!) * kx, (b[1]! - a[1]!) * 110_540)
}

console.log(
  'Tour              Stopps  Studio-Film   Player real   Differenz   davon Route   davon Rampen   je Stopp',
)
for (const id of readdirSync(WURZEL)) {
  let tour: any
  try {
    tour = JSON.parse(readFileSync(`${WURZEL}/${id}/tour.json`, 'utf8'))
  } catch {
    continue
  }
  if (!tour.segments?.length) continue

  // — Studio-Modell: Rohmeter ÷ Modus-Tempo + Standzeiten —
  let rohM = 0
  let filmFahrtStudio = 0
  const grenzenRoh: Array<{ s: number; mode: string }> = []
  for (const seg of tour.segments) {
    grenzenRoh.push({ s: rohM, mode: seg.mode })
    for (let i = 1; i < seg.pts.length; i++) {
      const d = meter(seg.pts[i - 1], seg.pts[i])
      rohM += d
      filmFahrtStudio += d / (BASIS * (TEMPO[seg.mode] ?? 1))
    }
  }

  // — Player: Route bauen, Fotos verankern, Stopps gruppieren (wie main.ts) —
  const wegpunkte = tour.segments.flatMap((s: any, i: number) => (i ? s.pts.slice(1) : s.pts))
  const route = buildRoute(wegpunkte)
  const skala = route.total / rohM
  const modi = grenzenRoh.map((g) => ({ s: g.s * skala, mode: g.mode }))
  const modeAt = (s: number): string => {
    let cur = modi[0]!.mode
    for (const m of modi) if (m.s <= s + 1) cur = m.mode
    return cur
  }

  const medien = (tour.media ?? []).filter((m: any) => Array.isArray(m.anchor))
  const verankert = medien.map((m: any) => ({ ...m, s: nearestS(route, m.anchor) }))
  const stopps = gruppiereStopps(verankert as any).sort((a: any, b: any) => a.s - b.s)

  let filmHalt = 0
  for (const st of stopps)
    for (const it of st.items)
      filmHalt +=
        (it.type === 'video' ? (it.durationS ?? HOLD_HIDE) : (it.display?.holdS ?? HOLD_HIDE)) +
        HOLD_AUSBLEND

  // — Simulation der Engine (tour.ts:916-953) —
  let s = 0
  let speed = 0
  let t = 0
  let phase: 'ride' | 'photo' = 'ride'
  let holdT = 0
  let idx = 0
  let itemIdx = 0
  let gezeigt = false
  let sicherung = 0
  while (s < route.total && sicherung++ < 20_000_000) {
    if (phase === 'photo' && gezeigt) {
      holdT += DT
      t += DT
      const it: any = stopps[idx - 1]?.items[itemIdx]
      const dauer =
        it?.type === 'video' ? (it.durationS ?? HOLD_HIDE) : (it?.display?.holdS ?? HOLD_HIDE)
      if (holdT >= dauer) {
        holdT = 0
        if (itemIdx + 1 < (stopps[idx - 1]?.items.length ?? 1)) itemIdx++
        else {
          // Ausblendphase, danach zurück in die Fahrt
          t += HOLD_AUSBLEND
          phase = 'ride'
          gezeigt = false
          itemIdx = 0
        }
      }
      continue
    }
    const ziel = phase === 'ride' ? BASIS * (TEMPO[modeAt(s)] ?? 1) : 0
    const tau = phase === 'photo' ? 0.55 : 1.1
    speed += (ziel - speed) * (1 - Math.exp(-DT / tau))
    s = Math.min(s + speed * DT, route.total)
    t += DT
    if (phase === 'ride' && idx < stopps.length) {
      const brake = speed * 0.62
      if (s >= (stopps[idx] as any).s - brake) {
        phase = 'photo'
        idx++
      }
    }
    if (phase === 'photo' && speed < 4 && !gezeigt) {
      speed = 0
      gezeigt = true
      holdT = 0
      itemIdx = 0
    }
  }

  const studio = filmFahrtStudio + filmHalt
  const diff = t - studio
  const routeAnteil = filmFahrtStudio * skala - filmFahrtStudio
  const rampen = diff - routeAnteil
  const f = (x: number, n = 1) => x.toFixed(n)
  console.log(
    `${id.slice(0, 16).padEnd(17)} ${String(stopps.length).padStart(5)}   ${f(studio).padStart(8)} s   ${f(t).padStart(9)} s   ` +
      `${(diff >= 0 ? '+' : '') + f(diff)} s (${f((diff / studio) * 100)} %)   ${'+' + f(routeAnteil)} s      ${'+' + f(rampen)} s      ${f(rampen / Math.max(1, stopps.length), 2)} s`,
  )
}
