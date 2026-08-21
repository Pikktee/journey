// 3D-FOTO-PINS (Standarddarstellung der Foto-Stopps; `?pins3d=0` schaltet auf die flachen
// Kreise zurück, `?pins3d=photo` zeigt das Bild im Kopf) — die Stopps stehen nicht mehr
// flach auf dem Boden, sondern auf einem Mast ÜBER dem Gelände: Fußring am Boden (Ort),
// Mast (Höhe), Kopfscheibe mit Nummer bzw. Foto (Ziel). Damit liest sich im Bergland
// endlich, WO ein Stopp liegt — der flache Kreis klebte am Hang und verschwand hinter
// jedem Grat, sobald die Kamera flach stand.
//
// Die Rechenregeln (Zustände, Detailstufen-Fenster, Blende, Maßstab) liegen DOM-frei und
// getestet in [pin-model.ts](pin-model.ts); hier steht nur Three.js/MapLibre-Verdrahtung.
//
// WARUM EIN EIGENER RENDERER (Machbarkeit, an MapLibre 5.24 geprüft):
//   · Symbol-/Circle-Layer können in MapLibre NICHT über Grund gehoben werden — die
//     Eigenschaften `symbol-z-offset` / `*-elevation-reference` gibt es in dieser Version
//     nicht (im Bundle nicht vorhanden). `circle-pitch-alignment: viewport` hält den Kreis
//     zwar zur Kamera, aber am Boden.
//   · `fill-extrusion` könnte einen Mast als Klotz extrudieren, trägt aber weder Text noch
//     eine kamerazugewandte Scheibe — Nummer/Foto am Kopf wären unmöglich.
//   · Ein DOM-Marker (wie der Fahrer) kennt nur eine Bodenkoordinate; ein Pixel-Offset nach
//     oben wäre nicht perspektivisch (Höhe schrumpfte nicht mit der Entfernung).
//   → Bleibt der CustomLayerInterface-Weg mit Three.js: Mercator-Ursprung + Projektions-
//     matrix von MapLibre. (Das Muster stammt aus den früheren Gebäude-Renderern, die
//     2026-08-11 ausgebaut wurden — docs/archive/renderer-labor.md.)
//
// MASSSTAB — der eigentliche Entwurfspunkt. Eine feste Pin-Höhe in Metern funktioniert
// nicht: dieselben 40 m sind im Intro-Anflug (Kamera 3 km hoch) ein Zahnstocher und am
// Foto-Orbit (200 m) ein Sendemast. Deshalb wird die Größe aus der KAMERADISTANZ
// gerechnet — mit einem Mischfaktor PERSPEKTIVE zwischen „konstante Bildschirmgröße"
// (wie die alten 2D-Kreise, kein Tiefeneindruck) und „echte Weltgröße" (ferne Pins
// verschwinden). 0,82 heißt: fast bildschirmstabil, aber nahe Pins bleiben spürbar
// größer als ferne — genau das macht den 3D-Eindruck.
//
// TIEFE: Mast und Fußring testen gegen den Tiefenpuffer (verschwinden also korrekt hinter
// einem Bergrücken), der KOPF nicht — er ist Navigations-Element und bleibt wie der
// Fahrer-Marker immer lesbar (MapLibre macht dort dasselbe über opacityWhenCovered).

import * as THREE from 'three'
import maplibregl, { type CustomLayerInterface, type Map as MapLibreKarte } from 'maplibre-gl'
import { EXAGGERATION, type LngLat2D } from './map.js'
import {
  nextIndex,
  pinStates,
  detailTargets,
  fadeStep,
  worldSize,
  inView,
  type PinWindow,
  type PinState,
} from './pin-model.js'
import type { LightMood } from './daynight.js'

const DEG = Math.PI / 180

/** Ein Foto-Stopp, wie ihn der Verdrahter aus der Route baut (s. main.ts). */
export interface PinStop {
  lnglat: LngLat2D
  /** Streckenmeter des Halts */
  s: number
  /** Fallback-Höhe aus dem Routen-Profil (ohne Überhöhung), bis das DEM greift */
  ele?: number | undefined
  /** Foto für die Kopf-Variante (`?pins3d=photo`) */
  src?: string | undefined
}

/** Steuerung des Layers; `sync` ist signaturgleich zum Rückgabewert von addSpotLayers. */
export interface PinControl {
  sync(s: number): void
  setWindow(f?: Partial<PinWindow>): void
  setVisible(on: boolean): void
  applyDayNight(p?: Pick<LightMood, 'br'> | null): void
  setDepthTest(on: boolean): void
  setSizes(m?: Partial<typeof SIZES>): void
  _dbg(): unknown
  remove(): void
}

/** Aussehen eines Pins je Timeline-Zustand (s. STATE_STYLE). */
interface StateStyle {
  fill: string
  ring: string
  ringPx: number
  /** Materialfarbe von Mast und Fußring (Three-Hex) */
  pole: number
  digit: string
}

// Zustände in der Sprache der Timeline (identisch zu map.ts/addSpotLayers):
//   upcoming = creme gefüllt, dünner neutraler Ring
//   next     = creme gefüllt + Amber-Ring (Ziel)
//   visited  = amber gefüllt + weißer Ring
const STATE_STYLE: Record<PinState, StateStyle> = {
  upcoming: {
    fill: '#f6f1e7',
    ring: 'rgba(23,17,6,0.42)',
    ringPx: 5,
    pole: 0xf1ece2,
    digit: '#1c1712',
  },
  next: { fill: '#f6f1e7', ring: '#f5a524', ringPx: 9, pole: 0xf5a524, digit: '#1c1712' },
  visited: { fill: '#f5a524', ring: '#ffffff', ringPx: 7, pole: 0xf5a524, digit: '#231a08' },
}

// Bildschirmmaße des Pins in CSS-Pixeln bei der Referenzdistanz. Als Objekt, damit die
// Proportionen am laufenden Player nachjustierbar sind (__maptale.pins.setSizes({ pole: 90 })).
const SIZES = {
  head: 17, // Radius der Kopfscheibe
  pole: 74, // Fuß → Kopfmitte
  foot: 9, // Radius des Bodenrings
  perspective: 0.82, // 1 = bildschirmstabil (2D-Verhalten), 0 = echte Weltgröße
}
const HEAD_PX = SIZES.head // Bezugsgröße fürs Zeichnen der Kopf-Textur (Ringstärke)
// Touch-Geräte: derselbe Pixelwert nimmt anteilig viel mehr Bild ein — ein 34 px breiter
// Kopf sind auf 390 px Hochformat fast 9 % der Breite, auf 1440 px nur 2,4 %. Deshalb am
// Handy etwas kleiner; lesbar bleibt er (im Querformat gemessen der angenehmste Wert).
const COARSE = window.matchMedia?.('(pointer: coarse)').matches ?? false
const D_REF = 420 // Referenz-Kameradistanz in Metern
const PX_MIN = 0.5 // Klemmung der Bildschirmgröße gegen Extremdistanzen
const PX_MAX = 1.7

// DETAILSTUFE — nur die Stopps, um die es GERADE geht, stehen als voller Pin; alle anderen
// bleiben ein flacher Bodenpunkt. Zwei Gründe, gemessen bzw. gesehen:
//   · Kosten: am Pixel 9 kostete der Layer im Querformat 1,50 ms je Frame gegen 0,71 ms im
//     Hochformat — allein weil dort VIER Pins gleichzeitig im Bild waren statt einem
//     (7 % Bildrate). Die Kosten hängen an sichtbaren Pins, nicht an ihrer Gesamtzahl.
//   · Bild: fünf Masten auf 390 px Breite sind ein Zaun, kein Wegweiser.
// DETAIL_WINDOW heißt: der nächste Stopp, der zuletzt besuchte und (am Desktop) der zweite
// kommende. Der Übergang wird GEBLENDET (s. pin.level) — ein harter Wechsel Pin↔Punkt
// beim Vorbeifahren würde poppen, und genau an der Stelle schaut man hin.
const DETAIL_WINDOW = { ahead: COARSE ? 1 : 2, behind: 1 }
const FADE_RATE = 0.12 // Anteil pro Frame, mit dem sich level seinem Ziel nähert (~0,3 s)

// 4×4 spaltenweise multiplizieren — float64 wegen der Mercator-Präzision.
// Die `!` stehen für „nachweislich im Bereich": alle drei Puffer sind exakt 16
// Elemente lang, die Indizes laufen über 0…15 (wie in demclean.ts).
function mat4mul(a: ArrayLike<number>, b: ArrayLike<number>, o: number[]): number[] {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r]! * b[c * 4]! +
        a[4 + r]! * b[c * 4 + 1]! +
        a[8 + r]! * b[c * 4 + 2]! +
        a[12 + r]! * b[c * 4 + 3]!
    }
  return o
}

// — Kopfscheibe als Canvas-Textur: Füllung/Ring aus dem Zustand, darin die Nummer oder
//   das runde Foto. Wird NUR bei Zustandswechsel neu gezeichnet, nicht pro Frame.
function drawHead(
  canvas: HTMLCanvasElement,
  no: number,
  state: PinState,
  image: HTMLImageElement | null,
) {
  const S = 192
  canvas.width = canvas.height = S
  const g = canvas.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, S, S)
  const z = STATE_STYLE[state]
  const m = S / 2
  const r = m - 16 // Rand für den Schlagschatten
  const ringW = (z.ringPx / HEAD_PX) * r * 0.5

  // Schlagschatten löst die Scheibe vom Luftbild (sonst „klebt" sie im Hintergrund)
  g.save()
  g.shadowColor = 'rgba(12, 9, 4, 0.5)'
  g.shadowBlur = 12
  g.shadowOffsetY = 4
  g.beginPath()
  g.arc(m, m, r, 0, Math.PI * 2)
  g.fillStyle = z.fill
  g.fill()
  g.restore()

  if (image) {
    // Foto rund beschnitten, kurze Seite füllend (cover)
    g.save()
    g.beginPath()
    g.arc(m, m, r - ringW * 0.5, 0, Math.PI * 2)
    g.clip()
    const sk = Math.max((2 * r) / image.width, (2 * r) / image.height)
    const w = image.width * sk
    const h = image.height * sk
    g.globalAlpha = state === 'upcoming' ? 0.88 : 1
    g.drawImage(image, m - w / 2, m - h / 2, w, h)
    g.restore()
  }

  g.lineWidth = ringW
  g.strokeStyle = z.ring
  g.beginPath()
  g.arc(m, m, r - ringW / 2, 0, Math.PI * 2)
  g.stroke()

  if (image) {
    // Nummer als kleines Schild unten — im Foto-Kopf darf die Ziffer nicht das Bild fressen
    const br = r * 0.34
    const by = m + r * 0.62
    g.beginPath()
    g.arc(m, by, br, 0, Math.PI * 2)
    g.fillStyle = '#1c1712'
    g.fill()
    g.lineWidth = ringW * 0.5
    g.strokeStyle = z.ring
    g.stroke()
    g.fillStyle = '#f6f1e7'
    g.font = `600 ${Math.round(br * 1.35)}px Outfit, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(no), m, by + 1)
  } else {
    g.fillStyle = z.digit
    g.font = `600 ${Math.round(r * 1.05)}px Outfit, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(no), m, m + 2)
  }
}

// Mast: weißes Band mit weichen Rändern (Alpha-Antialiasing) und leichtem Abfall nach
// unten. Die FARBE kommt aus dem Material (eine Textur für alle Pins).
function poleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 64
  const g = c.getContext('2d')
  if (!g) throw new Error('Foto-Pins: kein 2D-Kontext für die Mast-Textur')
  const img = g.createImageData(16, 64)
  for (let y = 0; y < 64; y++) {
    const vy = y / 63 // 0 = oben (Kopf), 1 = unten (Fuß)
    for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5) / 7.5
      const edge = Math.max(0, 1 - Math.pow(dx, 3.5)) // weiche Ränder, solide Mitte
      const i = (y * 16 + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 255
      img.data[i + 3] = Math.round(255 * edge * (1 - 0.22 * vy))
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.minFilter = THREE.LinearFilter
  return t
}

// Bodenring: markiert den exakten Ort am Hang und erdet den Pin (ohne ihn schwebte
// der Kopf über dem Nichts — genau der Vorwurf an schwebende 3D-Marker).
function footTexture(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  if (!g) throw new Error('Foto-Pins: kein 2D-Kontext für die Fuß-Textur')
  const m = S / 2
  const grd = g.createRadialGradient(m, m, 0, m, m, m)
  grd.addColorStop(0, 'rgba(255,255,255,0.30)')
  grd.addColorStop(0.62, 'rgba(255,255,255,0.10)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.beginPath()
  g.arc(m, m, m, 0, Math.PI * 2)
  g.fill()
  g.lineWidth = 9
  g.strokeStyle = 'rgba(255,255,255,0.92)'
  g.beginPath()
  g.arc(m, m, m - 12, 0, Math.PI * 2)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.minFilter = THREE.LinearFilter
  return t
}

/** Ein Pin samt seinen drei Meshes und seinem geblendeten Detailstufen-Zustand. */
interface Pin {
  sp: PinStop
  no: number
  /** Mercator, relativ zum Ursprung */
  mx: number
  my: number
  /** Aktuelle (weich nachgezogene) Fußhöhe und ihr Ziel aus der Terrain-Abfrage */
  ele: number
  eleTarget: number | null
  state: PinState
  /** 0 = flacher Bodenpunkt, 1 = voller Pin (wird geblendet) */
  level: number
  targetLevel: number
  canvas: HTMLCanvasElement
  texHead: THREE.CanvasTexture
  head: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  pole: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  foot: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  image: HTMLImageElement | null
  /** Klickziel des Kopfes in CSS-Pixeln; null = außerhalb des Bildes */
  screen: { x: number; y: number; r: number } | null
  /** Zwischenwerte aus update() für screenPoints() */
  clickZ: number
  clickPx: number
  hPx: number
  wPx: number
}

/**
 * @param map      MapLibre-Karte (Terrain aktiv)
 * @param spots    Foto-Stopps; `ele` = Fallback-Höhe (Route, ohne Überhöhung)
 * @param opts     Klick-Rückruf und Kopf-Variante (Nummer oder Foto)
 * @returns        Steuerung des Layers; `sync` ist signaturgleich zum Rückgabewert
 *                 von addSpotLayers (ui.registerSpots)
 */
export function installPhotoPins(
  map: MapLibreKarte,
  spots: PinStop[],
  {
    onSelect,
    variant = 'number',
  }: { onSelect?: (s: number) => void; variant?: 'number' | 'photo' } = {},
): PinControl {
  if (COARSE) {
    SIZES.head = 14
    SIZES.pole = 62
    SIZES.foot = 8
  }
  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  let renderer: THREE.WebGLRenderer | null = null
  let visible = true

  // Mercator-Ursprung in der Mitte der Punktwolke: die Vertices bleiben klein
  // (float32-sicher), die Verschiebung steckt in der float64-Matrix.
  const center = spots[Math.floor(spots.length / 2)]?.lnglat ?? [0, 0]
  const mc0 = maplibregl.MercatorCoordinate.fromLngLat(center, 0)
  const mpu = mc0.meterInMercatorCoordinateUnits()
  const originMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mc0.x, mc0.y, mc0.z, 1]

  const texPole = poleTexture()
  const texFoot = footTexture()
  const quad = new THREE.PlaneGeometry(1, 1)

  // Basisvektoren im Mercator-Raum (x = Ost, y = SÜD, z = oben) — deshalb der y-Flip
  const vRight = new THREE.Vector3()
  const vUp = new THREE.Vector3()
  const vNormal = new THREE.Vector3()
  const vX = new THREE.Vector3(1, 0, 0)
  const vY = new THREE.Vector3(0, 1, 0)
  const vZ = new THREE.Vector3(0, 0, 1)
  const vDepth = new THREE.Vector3()
  const vPos = new THREE.Vector3()
  const vScale = new THREE.Vector3()

  const pins: Pin[] = spots.map((sp, i) => {
    const mc = maplibregl.MercatorCoordinate.fromLngLat(sp.lnglat, 0)
    const canvas = document.createElement('canvas')
    drawHead(canvas, i + 1, 'upcoming', null)
    const texHead = new THREE.CanvasTexture(canvas)
    texHead.minFilter = THREE.LinearMipmapLinearFilter
    texHead.anisotropy = 4

    // DoubleSide ist Pflicht, nicht Bequemlichkeit: der Mercator-Raum ist gegenüber
    // ENU an der y-Achse gespiegelt (y zeigt nach Süden), damit kippt die Winding-Order
    // — die flach liegende Bodenscheibe wurde mit dem Default FrontSide komplett
    // weggecullt (sie war schlicht unsichtbar, unabhängig von Größe und Tiefentest).
    const head = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: texHead,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    const pole = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: texPole,
        color: STATE_STYLE.upcoming.pole,
        transparent: true,
        depthWrite: false,
        opacity: 0.92,
        side: THREE.DoubleSide,
      }),
    )
    const foot = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: texFoot,
        color: STATE_STYLE.upcoming.pole,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    for (const o of [head, pole, foot]) {
      o.matrixAutoUpdate = false
      o.frustumCulled = false
      scene.add(o)
    }
    return {
      sp,
      no: i + 1,
      mx: mc.x - mc0.x, // Mercator, relativ zum Ursprung
      my: mc.y - mc0.y,
      ele: (sp.ele ?? 0) * EXAGGERATION, // Startwert aus dem Höhenprofil der Route,
      eleTarget: null, //                     bis die erste Terrain-Abfrage greift

      state: 'upcoming',
      level: 0, //     0 = flacher Bodenpunkt, 1 = voller Pin (wird geblendet)
      targetLevel: 0, // Ziel aus dem Fenster um die aktuelle Position (s. sync)
      canvas,
      texHead,
      head,
      pole,
      foot,
      image: null,
      screen: null, // { x, y, r } in CSS-Pixeln — Klickziel des Kopfes
      clickZ: 0,
      clickPx: 0,
      hPx: 0,
      wPx: 0,
    }
  })

  // Foto-Variante: Bilder nachladen, Kopf beim Eintreffen neu zeichnen. Der Kopf muss
  // dafür deutlich größer sein — bei 17 px Radius ist ein Foto ein Farbfleck.
  if (variant === 'photo') {
    SIZES.head = COARSE ? 22 : 27
    SIZES.pole = COARSE ? 74 : 88
    for (const p of pins) {
      if (!p.sp.src) continue
      const img = new Image()
      img.onload = () => {
        p.image = img
        redraw(p)
        map.triggerRepaint()
      }
      img.src = p.sp.src
    }
  }

  function redraw(p: Pin) {
    drawHead(p.canvas, p.no, p.state, p.image)
    p.texHead.needsUpdate = true
    const z = STATE_STYLE[p.state]
    p.pole.material.color.setHex(z.pole)
    p.foot.material.color.setHex(z.pole)
  }

  // — Terrainhöhe der Fußpunkte. queryTerrainElevation liefert die Höhe INKLUSIVE
  //   Überhöhung (genau dafür ist sie da) — nur so steht der Fuß auf dem gerenderten
  //   Boden statt im Hang. Gedrosselt, weil die DEM-Kacheln beim Fahren nachladen; die
  //   Höhe wird dabei NACHGEZOGEN statt gesetzt: eine feiner aufgelöste Kachel ändert
  //   den Wert um mehrere Meter, hart gesetzt würde der Pin sichtbar springen.
  let lastElevationCheck = 0
  function checkElevations(now: number) {
    if (now - lastElevationCheck < 400) return
    lastElevationCheck = now
    for (const p of pins) {
      const e = map.queryTerrainElevation(p.sp.lnglat)
      if (e != null && Number.isFinite(e)) p.eleTarget = e
    }
  }

  // Bildschirmgröße → Weltmaß. k = Meter pro Pixel bei 1 m Kameradistanz (Öffnungswinkel).
  function metrics() {
    const tr = map.transform
    const hPx = tr?.height || map.getCanvas().clientHeight || 800
    const fov = (tr?.fov ?? 36.87) * DEG
    return {
      k: (2 * Math.tan(fov / 2)) / hPx,
      hPx,
      wPx: tr?.width || map.getCanvas().clientWidth || 1200,
    }
  }

  const mvp: number[] = new Array<number>(16).fill(0)
  const mainBuf: number[] = new Array<number>(16).fill(0)

  /** Projizierter Punkt: NDC-x/y plus Clip-w (Tiefe). */
  interface ScreenPoint {
    x: number
    y: number
    w: number
  }

  // Punkt (Mercator, ursprungsrelativ) durch die MVP-Matrix → NDC + Clip-w.
  // Die `!` wie in mat4mul: m ist immer die gefüllte 16er-Matrix.
  function project(m: number[], x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
    out.w = w
    out.x = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w
    out.y = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w
    return out
  }
  const pA: ScreenPoint = { x: 0, y: 0, w: 0 }
  const pB: ScreenPoint = { x: 0, y: 0, w: 0 }

  let fading = false // läuft gerade eine Detailstufen-Blende? (pro Frame neu bestimmt)

  function update(m: number[]) {
    fading = false
    const { k, hPx, wPx } = metrics()
    const b = map.getBearing() * DEG
    const p = map.getPitch() * DEG
    // Bildschirm-Rechts und Bildschirm-Oben im Mercator-Raum (y zeigt nach Süden)
    vRight.set(Math.cos(b), Math.sin(b), 0)
    vUp.set(Math.sin(b) * Math.cos(p), -Math.cos(b) * Math.cos(p), Math.sin(p))
    vNormal.crossVectors(vRight, vUp).normalize()

    // Maßstab bei Referenzdistanz (Pixel je Meter) — Bezug der weltfesten Größe.
    const pxRef = 1 / (k * D_REF)
    const size = (px: number, pxPerM: number) =>
      worldSize(px, pxPerM, pxRef, SIZES.perspective, PX_MIN, PX_MAX)

    for (const pin of pins) {
      if (pin.eleTarget != null) pin.ele += (pin.eleTarget - pin.ele) * 0.18 // weich nachziehen
      const zFoot = pin.ele * mpu
      // Pixel je Meter am Fußpunkt: einen Meter entlang der Bildschirm-Rechts-Achse
      // projizieren. Braucht weder Kameraposition (die FreeCamera-API gibt es in
      // MapLibre 5 nicht mehr) noch Annahmen über die Projektion.
      project(m, pin.mx, pin.my, zFoot, pA)
      project(m, pin.mx + vRight.x * mpu, pin.my + vRight.y * mpu, zFoot, pB)
      const pxPerM = Math.max(1e-6, Math.abs(pB.x - pA.x) * 0.5 * wPx)

      // Detailstufe weich nachziehen. Mast und Kopf wachsen MIT der Stufe aus dem
      // Bodenpunkt heraus — dadurch wandert auch das Klickziel (der Kopf) beim Ausblenden
      // von selbst auf den Boden zurück, und der Stopp bleibt anfassbar.
      if (pin.level !== pin.targetLevel) {
        pin.level = fadeStep(pin.level, pin.targetLevel, FADE_RATE)
        fading = true // s. render(): sonst friert die Blende in der Pause ein
      }
      const level = pin.level
      const hM = size(SIZES.pole, pxPerM) * level
      const rHead = size(SIZES.head, pxPerM) * level
      // Der Bodenpunkt bleibt IMMER und wird etwas größer, wenn kein Mast auf ihm steht —
      // sonst wäre ein ferner Stopp auf der Karte gar nicht mehr auffindbar.
      const rFoot = size(SIZES.foot, pxPerM) * (1 + 0.35 * (1 - level))
      const width = Math.max(size(SIZES.head, pxPerM) * 0.13, size(2.2, pxPerM))
      const d = pA.w // Tiefe (Clip-w) — reicht als Sortierschlüssel

      // Was nicht im Bild ist, kostet nichts: bei 12 Stopps sind meist ein bis drei Pins
      // sichtbar. Three cullt hier nicht selbst (frustumCulled ist aus, weil die Kamera
      // keine Frustum-Info trägt — die Projektion kommt von MapLibre), also prüfen wir
      // Fuß UND Kopf gegen den Clip-Raum. Gemessen: 0,59 → 0,2 ms CPU je Frame.
      project(m, pin.mx, pin.my, zFoot + hM * mpu, pB)
      const inside = inView(pA.x, pA.y, pA.w) || inView(pB.x, pB.y, pB.w)
      // Ausgeblendete Stufe = ein Draw statt drei (genau hier liegt die Ersparnis)
      const full = level > 0.02
      pin.foot.visible = inside
      pin.head.visible = pin.pole.visible = inside && full
      if (!inside) {
        pin.screen = null
        continue
      }

      // Fußring: flach in der Kartenebene. Er muss SPÜRBAR über Grund liegen — MapLibres
      // Terrain schreibt Tiefe, eine bodengleiche Scheibe verschwindet sonst komplett
      // (erster Versuch mit 0,2 m Abstand war unsichtbar). Der Abstand hängt an der VOLLEN
      // Masthöhe, nicht an der geblendeten: sonst versinkt der reine Bodenpunkt (level 0).
      pin.foot.matrix.makeBasis(vX, vY, vZ)
      pin.foot.matrix.scale(vScale.set(rFoot * 2 * mpu, rFoot * 2 * mpu, 1))
      pin.foot.matrix.setPosition(
        vPos.set(pin.mx, pin.my, zFoot + size(SIZES.pole, pxPerM) * 0.03 * mpu),
      )
      pin.foot.renderOrder = 1e4 - d

      if (full) {
        // Mast: senkrechtes Band, Breitenachse zur Kamera gedreht → aus jeder Richtung gleich dick
        pin.pole.matrix.makeBasis(vRight, vZ, vDepth.crossVectors(vRight, vZ).normalize())
        pin.pole.matrix.scale(vScale.set(width * mpu, hM * mpu, 1))
        pin.pole.matrix.setPosition(vPos.set(pin.mx, pin.my, zFoot + (hM / 2) * mpu))

        // Kopf: volles Billboard (dreht mit Bearing UND Pitch zur Kamera)
        pin.head.matrix.makeBasis(vRight, vUp, vNormal)
        pin.head.matrix.scale(vScale.set(rHead * 2.35 * mpu, rHead * 2.35 * mpu, 1))
        pin.head.matrix.setPosition(vPos.set(pin.mx, pin.my, zFoot + hM * mpu))

        // Transparenz ohne Tiefenschreiben braucht eine explizite Reihenfolge: fern zuerst.
        // (Three sortiert selbst über die Kameramatrix — die haben wir hier nicht.)
        pin.head.renderOrder = 1e6 - d
        pin.pole.renderOrder = 1e5 - d
      }
      // Klickziel: Kopfmitte, solange ein Kopf steht — sonst der Bodenpunkt. Weil hM mit
      // der Stufe schrumpft, wandert es beim Ausblenden von selbst nach unten.
      pin.clickZ = zFoot + hM * mpu
      pin.clickPx = Math.max(rHead, rFoot) * pxPerM
      pin.hPx = hPx
      pin.wPx = wPx
    }
  }

  // Klickziele in CSS-Pixeln. Bezugspunkt ist die Kopfmitte bzw. — bei ausgeblendeter
  // Detailstufe — der Bodenpunkt (clickZ). Ein Stopp bleibt in JEDER Stufe anfassbar; die
  // flachen 2D-Kreise waren es auch.
  function screenPoints(m: number[]) {
    for (const pin of pins) {
      if (!pin.foot.visible) {
        pin.screen = null // außerhalb des Bildes → keine (veraltete) Klickfläche
        continue
      }
      project(m, pin.mx, pin.my, pin.clickZ, pA)
      if (pA.w <= 0) {
        pin.screen = null
        continue
      }
      pin.screen = {
        x: (pA.x * 0.5 + 0.5) * pin.wPx,
        y: (0.5 - pA.y * 0.5) * pin.hPx,
        r: pin.clickPx,
      }
    }
  }

  function hit(point: { x: number; y: number }): Pin | null {
    let best: Pin | null = null
    let bestD = Infinity
    for (const pin of pins) {
      if (!pin.screen) continue
      const d = Math.hypot(pin.screen.x - point.x, pin.screen.y - point.y)
      if (d < pin.screen.r * 1.25 && d < bestD) {
        bestD = d
        best = pin
      }
    }
    return best
  }

  const layer: CustomLayerInterface = {
    id: 'photopins-3d',
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      // Kein `antialias` hier: Three benutzt den übergebenen Kontext unverändert,
      // die Attribute stehen längst fest — das Flag war wirkungslos. Die Karte
      // fordert seit der Messung vom 2026-08-11 ebenfalls kein MSAA mehr an
      // (docs/archive/antialias-verworfen.md).
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl })
      renderer.autoClear = false
    },
    render(_gl, opts) {
      if (!renderer || !visible) return
      checkElevations(performance.now())
      // Ältere MapLibre-Fassungen reichten die Matrix direkt statt im Options-Objekt
      // durch — der Fallback bleibt, die Typen kennen nur die heutige Form.
      const main: ArrayLike<number> =
        opts?.defaultProjectionData?.mainMatrix ?? (opts as unknown as ArrayLike<number>)
      for (let i = 0; i < 16; i++) mainBuf[i] = main[i] ?? 0
      mat4mul(mainBuf, originMat, mvp)
      update(mvp) // Maßstab kommt aus DIESER Matrix (s. projiziere)
      screenPoints(mvp)
      camera.projectionMatrix.fromArray(mvp)
      renderer.resetState()
      renderer.render(scene, camera)
      // Die Blende braucht mehrere Frames. Steht die Szene (Pause, Foto-Stopp), liefert
      // MapLibre von sich aus keinen weiteren Frame → hier selbst nachfordern.
      if (fading) map.triggerRepaint()
    },
  }
  map.addLayer(layer)

  map.on('click', (e) => {
    if (!visible) return
    const pin = hit(e.point)
    if (pin) onSelect?.(pin.sp.s)
  })
  map.on('mousemove', (e) => {
    if (!visible) return
    const c = map.getCanvas()
    if (hit(e.point)) c.style.cursor = 'pointer'
    else if (c.style.cursor === 'pointer') c.style.cursor = ''
  })

  return {
    // Signaturgleich zu addSpotLayers: „besucht" ab Erreichen (20 m Vorlauf), danach
    // ist der erste offene Pin der nächste.
    sync(s) {
      let repaint = false
      const sValues = pins.map((p) => p.sp.s)
      const states = pinStates(sValues, s)
      const targets = detailTargets(pins.length, nextIndex(sValues, s), DETAIL_WINDOW)
      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i]
        const z = states[i]
        if (!pin || !z) continue
        if (z !== pin.state) {
          pin.state = z
          repaint = true
          redraw(pin) // Kopf-Textur trägt die Zustandsfarben
        }
        const newTarget = targets[i] ?? 0
        if (newTarget !== pin.targetLevel) repaint = true
        pin.targetLevel = newTarget
      }
      // Angestoßen wird nur, wenn sich WIRKLICH etwas geändert hat — ein
      // Zustand, ein Blendenziel, oder eine Blende, die noch unterwegs ist.
      // Unbedingt gerufen hielt diese Zeile die Karte im stehenden Halt am
      // Zeichnen, denn `sync` läuft in jedem Frame (ui.updateTrace): MapLibre
      // rendert dann das ganze Bild neu, Terrain-Pass inklusive. Eine laufende
      // Blende trägt sich selbst weiter (s. `render`).
      if (repaint || pins.some((p) => p.level !== p.targetLevel)) map.triggerRepaint()
    },
    // Fenstergröße zur Laufzeit: __maptale.pins.setWindow({ ahead: 3, behind: 1 })
    setWindow({ ahead, behind } = {}) {
      if (ahead != null) DETAIL_WINDOW.ahead = Math.max(1, ahead)
      if (behind != null) DETAIL_WINDOW.behind = Math.max(0, behind)
      map.triggerRepaint()
    },
    setVisible(on: boolean) {
      visible = on
      map.triggerRepaint()
    },
    // Nachts leicht zurücknehmen — der Pin bleibt UI, soll aber nicht wie ein
    // Scheinwerfer über der dunklen Landschaft stehen.
    applyDayNight(p?: Pick<LightMood, 'br'> | null) {
      const b = Math.max(0.55, Math.min(1, p?.br ?? 1))
      for (const pin of pins) {
        pin.pole.material.opacity = 0.92 * b
        pin.foot.material.opacity = b
      }
      map.triggerRepaint()
    },
    // Verdeckung durch das Gelände an/aus (Mast + Fußring). MapLibres Terrain schreibt
    // Tiefe, ein Custom-Layer mit renderingMode '3d' testet also dagegen — nachgewiesen
    // an einem Pin hinter dem Bergkamm. Der KOPF bleibt immer sichtbar.
    setDepthTest(on: boolean) {
      for (const p of pins) {
        p.pole.material.depthTest = on
        p.foot.material.depthTest = on
      }
      map.triggerRepaint()
    },
    // Live-Regler in der Konsole: __maptale.pins.setSizes({ pole: 90, head: 20 })
    setSizes({ pole, head, foot, perspective } = {}) {
      if (pole != null) SIZES.pole = pole
      if (head != null) SIZES.head = head
      if (foot != null) SIZES.foot = foot
      if (perspective != null) SIZES.perspective = perspective
      map.triggerRepaint()
    },
    _dbg: () => ({
      pins: pins.length,
      elevations: pins.map((p) => Math.round(p.ele)),
      levels: pins.map((p) => Number(p.level.toFixed(2))), // Detailstufe je Pin
      screen: pins.map((p) =>
        p.screen
          ? { x: Math.round(p.screen.x), y: Math.round(p.screen.y), r: Math.round(p.screen.r) }
          : null,
      ),
    }),
    remove() {
      if (map.getLayer('photopins-3d')) map.removeLayer('photopins-3d')
      for (const p of pins) {
        p.texHead.dispose()
        p.head.material.dispose()
        p.pole.material.dispose()
        p.foot.material.dispose()
      }
      texPole.dispose()
      texFoot.dispose()
      quad.dispose()
    },
  }
}
