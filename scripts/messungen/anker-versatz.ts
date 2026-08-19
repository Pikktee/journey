// Der Rest, den KEINE Uhr behebt: Server und Player parametrisieren dieselbe
// Strecke verschieden. Der Server misst `f` auf der Rohgeometrie, der Player
// rechnete `f × route.total` auf der Catmull-Rom-Route — 2,2–3,0 % länger, und
// die Dehnung verteilt sich ungleichmäßig. Wo sie ungleichmäßig verlängert,
// landet ein Ton-Anker neben seiner gemeinten Stelle.
//
// Seit Etappe 2 gibt es die Wegpunkt-Tabelle (src/streckenanker.ts): je
// Wegpunkt sein `f` (Server, E11) und sein `s` (route.wpS). Dieses Skript hält
// beide Wege gegen dieselbe Wahrheit — **je Ankerklasse**, denn genau das ist
// das Abnahmekriterium: Audio, Kamera, Momente, Wetter, Timeline.
//
// **Die Wahrheit** ist der physische Ort, den der Server gemeint hat: der Punkt
// bei Rohdistanz `f × gesamt`, gefunden auf der ausgelieferten Geometrie, und
// von dort die Streckenposition auf der gebauten Route. Gemessen wird stetig
// (Projektion auf die Nachbarsegmente), nicht auf das 14-m-Raster gerundet —
// sonst misst man die Abtastung statt die Übersetzung.
//
// Zwei Dinge, die die Messung wertlos machen (die übrigen stehen im README):
//   · Eine Tour OHNE `f` je Wegpunkt (vor E11 gerendert) hat keine Server-
//     Wahrheit im Tour-JSON. Die Spalte „f-Quelle" sagt, was stattdessen galt:
//     `manifest` — die Rohpunkte daneben, über die Koordinate zugeordnet, also
//     dasselbe Maß, das der Server nimmt; `ausgeliefert` — aus der vereinfachten
//     Geometrie nachgerechnet, dort fehlt der Längenverlust der 5-m-Toleranz
//     (0,00–0,09 % auf diesen Touren).
//   · Eine Ankerklasse ohne Einträge misst NICHTS. Sie steht dann als „—" da;
//     die Zeile „Raster" tastet dieselbe Übersetzung dicht ab und ist der
//     Rückhalt, aber sie ersetzt keinen echten Anker.
import { readFileSync, readdirSync } from 'node:fs'
import { buildRoute, dist, type Route } from '../../src/geo.js'
import { baueSBeiF } from '../../src/streckenanker.js'
import type { Wegpunkt } from '../../src/tours.js'

// Die gerenderten Touren der LOKALEN Instanz. Über MAPTALE_DATEN_DIR
// umlenkbar, falls eine isolierte Instanz gemessen werden soll.
const WURZEL = process.env['MAPTALE_DATEN_DIR']
  ? `${process.env['MAPTALE_DATEN_DIR']}/tours`
  : new URL('../../server/daten/tours', import.meta.url).pathname
// Meter je FILMsekunde, wie die Engine sie fährt (MODE_SPEED × Basistempo) —
// derselbe Satz wie in rampen-simulation.ts.
const TEMPO: Record<string, number> = {
  walk: 0.4,
  bike: 1,
  moped: 1.15,
  jeep: 1.45,
  tram: 1.25,
  ferry: 2.5,
}
const BASIS_M_PRO_S = 120
/** Abnahmekriterium aus §12, Etappe 2 */
const ZIEL_MEDIAN_S = 0.05

interface TourSegment {
  mode: string
  pts: Array<[number, number, number]>
  f?: number[]
}

/**
 * Stetige Streckenposition des Punktes, der `p` am nächsten liegt — gesucht
 * NUR im Streckenabschnitt [sVon, sBis].
 *
 * Das Fenster ist keine Bequemlichkeit, sondern die Bedingung dafür, dass die
 * Messung etwas aussagt. Zwei Gründe: Eine sich kreuzende Route (Koh Pha-ngan
 * fährt zweimal durch dieselbe Bucht) schnappt sonst auf den falschen
 * Vorbeigang und zeigt Fehler von Kilometern, wo keiner ist. Und der Anker
 * liegt bekanntlich zwischen zwei Wegpunkten — der Routenabschnitt zwischen
 * ihnen IST der Ort, an dem er gesucht gehört; außerhalb zu suchen misst die
 * Überschwinger der Catmull-Rom-Glättung und nicht die Übersetzung.
 */
function nearestSGenau(route: Route, p: [number, number], sVon: number, sBis: number): number {
  let von = 0
  let bis = route.coords.length - 1
  while (von < bis && (route.cum[von + 1] as number) < sVon) von++
  while (bis > von && (route.cum[bis - 1] as number) > sBis) bis--
  let best = von
  let bestD = Infinity
  for (let i = von; i <= bis; i++) {
    const d = dist(route.coords[i] as Wegpunkt, p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  // Auf die beiden Nachbarsegmente projizieren: Ohne das misst man das
  // 14-m-Raster der Route (bis 7 m ≈ 0,06 Filmsekunden) statt die Übersetzung.
  let s = route.cum[best] as number
  let d2 = bestD
  for (const [a, b] of [
    [best - 1, best],
    [best, best + 1],
  ]) {
    const pa = route.coords[a]
    const pb = route.coords[b]
    if (!pa || !pb) continue
    const laenge = (route.cum[b] as number) - (route.cum[a] as number)
    if (!(laenge > 0)) continue
    // Lokale Plattkarte reicht auf 14 m
    const kx = Math.cos((pa[1] * Math.PI) / 180)
    const vx = (pb[0] - pa[0]) * kx
    const vy = pb[1] - pa[1]
    const wx = (p[0] - pa[0]) * kx
    const wy = p[1] - pa[1]
    const n2 = vx * vx + vy * vy
    if (!(n2 > 0)) continue
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / n2))
    const proj: [number, number] = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]
    const d = dist(proj, p)
    if (d < d2) {
      d2 = d
      s = (route.cum[a] as number) + t * laenge
    }
  }
  return Math.max(sVon, Math.min(sBis, s))
}

/**
 * Das Maß des Servers aus den ROHEN Punkten des Manifests: je ausgeliefertem
 * Wegpunkt sein Streckenanteil auf der vollen Auflösung — genau das, was
 * `enrich.ts` seit E11 in `segments[].f` schreibt. Für Touren, die davor
 * gerendert wurden, ist das der Ersatz.
 *
 * Zugeordnet wird **der Reihe nach**, nicht über eine Koordinaten-Tabelle: Eine
 * Route, die dieselbe Straße zweimal befährt (Koh Pha-ngan), hat Koordinaten
 * doppelt — eine Tabelle gäbe dem ersten Vorbeigang das Maß des zweiten, die
 * Liste liefe nicht mehr monoton, und `baueSBeiF` verwürfe sie stumm zugunsten
 * des Rückfalls. Gemessen hätte man dann zweimal denselben alten Weg.
 *
 * Gibt `null` zurück, sobald die Reihe nicht aufgeht — dann hat die Pipeline
 * Punkte VERSCHOBEN (der Pausen-Kollaps zieht sie auf den Schwerpunkt) und die
 * ausgelieferten sind keine Rohpunkte mehr.
 */
function rohMassStab(pfad: string, waypoints: readonly Wegpunkt[]): number[] | null {
  let manifest: { segments?: Array<{ pts: number[][] }> }
  try {
    manifest = JSON.parse(readFileSync(pfad, 'utf8'))
  } catch {
    return null
  }
  const pts = (manifest.segments ?? []).flatMap((s) => s.pts)
  if (pts.length < 2) return null
  const kum: number[] = [0]
  let m = 0
  for (let i = 1; i < pts.length; i++) {
    m += dist(pts[i - 1] as [number, number], pts[i] as [number, number])
    kum.push(m)
  }
  if (!(m > 0)) return null

  const fs: number[] = []
  let roh = 0
  for (const p of waypoints) {
    while (
      roh < pts.length &&
      !((pts[roh] as number[])[0] === p[0] && (pts[roh] as number[])[1] === p[1])
    )
      roh++
    if (roh >= pts.length) return null
    fs.push((kum[roh] as number) / m)
  }
  return fs
}

const quantil = (sortiert: number[], q: number): number =>
  sortiert.length
    ? (sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))] as number)
    : Number.NaN

const zahl = (x: number, breite: number, stellen = 2) =>
  (Number.isFinite(x) ? x.toFixed(stellen) : '—').padStart(breite)

console.log(
  'Der Anker-Versatz je Klasse, in Filmsekunden. „alt" = f × route.total, „neu" = Wegpunkt-Tabelle.\n' +
    `Abnahme (Etappe 2): Median neu < ${ZIEL_MEDIAN_S.toFixed(2)} s in JEDER Klasse mit Ankern.\n`,
)

let alleBestanden = true
for (const id of readdirSync(WURZEL)) {
  let tour: {
    segments?: TourSegment[]
    audio?: Array<{ f0: number; f1: number }>
    camera?: Array<{ f: number }>
    moments?: Array<{ f: number }>
    weather?: Array<{ f: number }>
    timeline?: Array<{ f: number }>
  }
  try {
    tour = JSON.parse(readFileSync(`${WURZEL}/${id}/tour.json`, 'utf8'))
  } catch {
    continue
  }
  const segmente = tour.segments
  if (!segmente?.length) continue

  // Genau wie main.ts: Segmente verketten (Nahtpunkt dedupen), f parallel dazu.
  const waypoints: Wegpunkt[] = []
  const wegpunktF: number[] = []
  const wegpunktModus: string[] = []
  let ausJson = true
  for (const seg of segmente) {
    const erster = waypoints.length === 0
    const pts = erster ? seg.pts : seg.pts.slice(1)
    waypoints.push(...(pts as Wegpunkt[]))
    for (const _ of pts) wegpunktModus.push(seg.mode)
    if (seg.f?.length === seg.pts.length) wegpunktF.push(...(erster ? seg.f : seg.f.slice(1)))
    else ausJson = false
  }
  // Ohne Server-`f` zuerst die ROHEN Punkte daneben versuchen: Douglas-Peucker
  // behält Originalpunkte, also findet sich jeder ausgelieferte Wegpunkt über
  // seine Koordinate im Manifest wieder — und damit sein echtes Maß. Das geht
  // nur, solange die Pipeline die Punkte nicht VERSCHOBEN hat (der Pausen-
  // Kollaps zieht sie auf den Schwerpunkt); deshalb die Trefferquote als Riegel.
  let quelle = ausJson ? 'tour.json (E11)' : ''
  if (!ausJson) {
    wegpunktF.length = 0
    const rohF = rohMassStab(`${WURZEL}/${id}/original/manifest.json`, waypoints)
    if (rohF) {
      quelle = 'manifest'
      wegpunktF.push(...rohF)
    } else {
      quelle = 'ausgeliefert'
      let m = 0
      const kum = waypoints.map((p, i) => (i ? (m += dist(waypoints[i - 1] as Wegpunkt, p)) : 0))
      for (const k of kum) wegpunktF.push(m > 0 ? k / m : 0)
    }
  }

  const route = buildRoute(waypoints)
  const sBeiF = baueSBeiF(wegpunktF, route.wpS, route.total)
  const sAltBeiF = (f: number) => Math.max(0, Math.min(1, f)) * route.total

  /** Erster Wegpunkt mit `f` >= ziel — die obere Kante des Abschnitts. */
  const oberKante = (ziel: number): number => {
    const i = wegpunktF.findIndex((x) => x >= ziel)
    return i <= 0 ? Math.min(1, wegpunktF.length - 1) : i
  }

  /**
   * Die WAHRHEIT zu einem `f`: der physische Ort, den der Server gemeint hat —
   * anteilig zwischen den beiden Wegpunkten, die ihn einschließen —, und von
   * dort die Streckenposition auf der gebauten Route.
   */
  const wahrBeiF = (f: number): number => {
    const ziel = Math.max(0, Math.min(1, f))
    const hi = oberKante(ziel)
    const a = waypoints[hi - 1] as Wegpunkt
    const b = waypoints[hi] as Wegpunkt
    const spanne = (wegpunktF[hi] as number) - (wegpunktF[hi - 1] as number)
    const t = spanne > 0 ? (ziel - (wegpunktF[hi - 1] as number)) / spanne : 0
    const ort: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    return nearestSGenau(route, ort, route.wpS[hi - 1] as number, route.wpS[hi] as number)
  }

  // Filmtempo am Ort des Ankers (Meter je Filmsekunde) — ein Meter Versatz
  // wiegt zu Fuß zweieinhalbmal so schwer wie auf der Fähre.
  const tempoBeiF = (f: number): number =>
    BASIS_M_PRO_S * (TEMPO[wegpunktModus[oberKante(Math.max(0, Math.min(1, f)))] ?? 'bike'] ?? 1)

  const klassen: Array<[string, number[]]> = [
    ['Audio', (tour.audio ?? []).flatMap((a) => [a.f0, a.f1])],
    ['Kamera', (tour.camera ?? []).map((k) => k.f)],
    ['Momente', (tour.moments ?? []).map((m) => m.f)],
    ['Wetter', (tour.weather ?? []).map((w) => w.f)],
    ['Timeline', (tour.timeline ?? []).map((t) => t.f)],
    ['Wegpunkte', wegpunktF.slice()],
    // Rückhalt für Klassen ohne Anker: dieselbe Übersetzung, dicht abgetastet.
    ['Raster', Array.from({ length: 501 }, (_, i) => i / 500)],
  ]

  console.log(
    `${id}   ${waypoints.length} Wegpunkte · ${(route.total / 1000).toFixed(1)} km · f-Quelle: ${quelle}`,
  )
  console.log('  Klasse       n     Median alt   Median neu      p90 neu      max neu')
  for (const [name, fs] of klassen) {
    if (!fs.length) {
      console.log(
        `  ${name.padEnd(11)} ${'0'.padStart(4)}            —            —            —            —`,
      )
      continue
    }
    const alt: number[] = []
    const neu: number[] = []
    for (const f of fs) {
      if (!Number.isFinite(f)) continue
      const wahr = wahrBeiF(f)
      const tempo = tempoBeiF(f)
      alt.push(Math.abs(sAltBeiF(f) - wahr) / tempo)
      neu.push(Math.abs(sBeiF(f) - wahr) / tempo)
    }
    alt.sort((a, b) => a - b)
    neu.sort((a, b) => a - b)
    const medianNeu = quantil(neu, 0.5)
    // Die beiden Rückhalt-Zeilen zählen nicht zur Abnahme (§12: „je Ankerklasse").
    const zaehlt = name !== 'Raster' && name !== 'Wegpunkte'
    const bestanden = !zaehlt || medianNeu < ZIEL_MEDIAN_S
    if (!bestanden) alleBestanden = false
    console.log(
      `  ${name.padEnd(11)} ${String(neu.length).padStart(4)}   ${zahl(quantil(alt, 0.5), 10)} s ${zahl(medianNeu, 10)} s ` +
        `${zahl(quantil(neu, 0.9), 10)} s ${zahl(quantil(neu, 1), 10)} s${bestanden ? '' : '   ← über dem Ziel'}`,
    )
  }
  console.log()
}

console.log(
  alleBestanden
    ? '✓ Abnahmekriterium erfüllt.'
    : '✗ Mindestens eine Ankerklasse liegt über dem Ziel.',
)
