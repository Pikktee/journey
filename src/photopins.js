// 3D-FOTO-PINS (Standarddarstellung der Foto-Stopps; `?pins3d=0` schaltet auf die flachen
// Kreise zurück, `?pins3d=foto` zeigt das Bild im Kopf) — die Stopps stehen nicht mehr
// flach auf dem Boden, sondern auf einem Mast ÜBER dem Gelände: Fußring am Boden (Ort),
// Mast (Höhe), Kopfscheibe mit Nummer bzw. Foto (Ziel). Damit liest sich im Bergland
// endlich, WO ein Stopp liegt — der flache Kreis klebte am Hang und verschwand hinter
// jedem Grat, sobald die Kamera flach stand.
//
// Die Rechenregeln (Zustände, Detailstufen-Fenster, Blende, Maßstab) liegen DOM-frei und
// getestet in [pinmodell.ts](pinmodell.ts); hier steht nur Three.js/MapLibre-Verdrahtung.
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
import maplibregl from 'maplibre-gl'
import { EXAGGERATION } from './map.js'
import { naechsterIndex, zustaende, stufenZiele, blendeSchritt, weltGroesse, imBild } from './pinmodell'

const DEG = Math.PI / 180

// Zustände in der Sprache der Timeline (identisch zu map.js/addSpotLayers):
//   kommend  = creme gefüllt, dünner neutraler Ring
//   naechster = creme gefüllt + Amber-Ring (Ziel)
//   besucht  = amber gefüllt + weißer Ring
const ZUSTAND = {
  kommend: { fuellung: '#f6f1e7', ring: 'rgba(23,17,6,0.42)', ringPx: 5, mast: 0xf1ece2, ziffer: '#1c1712' },
  naechster: { fuellung: '#f6f1e7', ring: '#f5a524', ringPx: 9, mast: 0xf5a524, ziffer: '#1c1712' },
  besucht: { fuellung: '#f5a524', ring: '#ffffff', ringPx: 7, mast: 0xf5a524, ziffer: '#231a08' },
}

// Bildschirmmaße des Pins in CSS-Pixeln bei der Referenzdistanz. Als Objekt, damit die
// Proportionen am laufenden Player nachjustierbar sind (__j.pins.setMasse({ mast: 90 })).
const MASSE = {
  kopf: 17, // Radius der Kopfscheibe
  mast: 74, // Fuß → Kopfmitte
  fuss: 9, // Radius des Bodenrings
  perspektive: 0.82, // 1 = bildschirmstabil (2D-Verhalten), 0 = echte Weltgröße
}
const KOPF_PX = MASSE.kopf // Bezugsgröße fürs Zeichnen der Kopf-Textur (Ringstärke)
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
// FENSTER heißt: der nächste Stopp, der zuletzt besuchte und (am Desktop) der zweite
// kommende. Der Übergang wird GEBLENDET (s. pin.stufe) — ein harter Wechsel Pin↔Punkt
// beim Vorbeifahren würde poppen, und genau an der Stelle schaut man hin.
const FENSTER = { vor: COARSE ? 1 : 2, zurueck: 1 }
const BLENDE = 0.12 // Anteil pro Frame, mit dem sich stufe ihrem Ziel nähert (~0,3 s)

// 4×4 spaltenweise multiplizieren — float64 wegen der Mercator-Präzision
function mat4mul(a, b, o) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  return o
}

// — Kopfscheibe als Canvas-Textur: Füllung/Ring aus dem Zustand, darin die Nummer oder
//   das runde Foto. Wird NUR bei Zustandswechsel neu gezeichnet, nicht pro Frame.
function zeichneKopf(canvas, nummer, zustand, bild) {
  const S = 192
  canvas.width = canvas.height = S
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, S, S)
  const z = ZUSTAND[zustand]
  const m = S / 2
  const r = m - 16 // Rand für den Schlagschatten
  const ringW = (z.ringPx / KOPF_PX) * r * 0.5

  // Schlagschatten löst die Scheibe vom Luftbild (sonst „klebt" sie im Hintergrund)
  g.save()
  g.shadowColor = 'rgba(12, 9, 4, 0.5)'
  g.shadowBlur = 12
  g.shadowOffsetY = 4
  g.beginPath()
  g.arc(m, m, r, 0, Math.PI * 2)
  g.fillStyle = z.fuellung
  g.fill()
  g.restore()

  if (bild) {
    // Foto rund beschnitten, kurze Seite füllend (cover)
    g.save()
    g.beginPath()
    g.arc(m, m, r - ringW * 0.5, 0, Math.PI * 2)
    g.clip()
    const sk = Math.max((2 * r) / bild.width, (2 * r) / bild.height)
    const w = bild.width * sk
    const h = bild.height * sk
    g.globalAlpha = zustand === 'kommend' ? 0.88 : 1
    g.drawImage(bild, m - w / 2, m - h / 2, w, h)
    g.restore()
  }

  g.lineWidth = ringW
  g.strokeStyle = z.ring
  g.beginPath()
  g.arc(m, m, r - ringW / 2, 0, Math.PI * 2)
  g.stroke()

  if (bild) {
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
    g.fillText(String(nummer), m, by + 1)
  } else {
    g.fillStyle = z.ziffer
    g.font = `600 ${Math.round(r * 1.05)}px Outfit, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(nummer), m, m + 2)
  }
}

// Mast: weißes Band mit weichen Rändern (Alpha-Antialiasing) und leichtem Abfall nach
// unten. Die FARBE kommt aus dem Material (eine Textur für alle Pins).
function mastTextur() {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 64
  const g = c.getContext('2d')
  const img = g.createImageData(16, 64)
  for (let y = 0; y < 64; y++) {
    const vy = y / 63 // 0 = oben (Kopf), 1 = unten (Fuß)
    for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5) / 7.5
      const kante = Math.max(0, 1 - Math.pow(dx, 3.5)) // weiche Ränder, solide Mitte
      const i = (y * 16 + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 255
      img.data[i + 3] = Math.round(255 * kante * (1 - 0.22 * vy))
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.minFilter = THREE.LinearFilter
  return t
}

// Bodenring: markiert den exakten Ort am Hang und erdet den Pin (ohne ihn schwebte
// der Kopf über dem Nichts — genau der Vorwurf an schwebende 3D-Marker).
function fussTextur() {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
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

/**
 * @param map      MapLibre-Karte (Terrain aktiv)
 * @param spots    [{ lnglat:[lng,lat], s, ele?, src? }] — ele = Fallback-Höhe (Route, ohne
 *                 Überhöhung), src = Foto für die Kopf-Variante
 * @param opts     { onSelect(s), variante: 'nummer'|'foto' }
 * @returns        { sync(s), setVisible, applyDayNight, remove, … } — `sync` ist
 *                 signaturgleich zum Rückgabewert von addSpotLayers (ui.registerSpots)
 */
export function installPhotoPins(map, spots, { onSelect, variante = 'nummer' } = {}) {
  if (COARSE) {
    MASSE.kopf = 14
    MASSE.mast = 62
    MASSE.fuss = 8
  }
  const scene = new THREE.Scene()
  const camera = new THREE.Camera()
  let renderer = null
  let sichtbar = true

  // Mercator-Ursprung in der Mitte der Punktwolke: die Vertices bleiben klein
  // (float32-sicher), die Verschiebung steckt in der float64-Matrix.
  const mitte = spots[Math.floor(spots.length / 2)]?.lnglat ?? [0, 0]
  const mc0 = maplibregl.MercatorCoordinate.fromLngLat(mitte, 0)
  const mpu = mc0.meterInMercatorCoordinateUnits()
  const originMat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, mc0.x, mc0.y, mc0.z, 1]

  const texMast = mastTextur()
  const texFuss = fussTextur()
  const quad = new THREE.PlaneGeometry(1, 1)

  // Basisvektoren im Mercator-Raum (x = Ost, y = SÜD, z = oben) — deshalb der y-Flip
  const vRechts = new THREE.Vector3()
  const vHoch = new THREE.Vector3()
  const vNormal = new THREE.Vector3()
  const vX = new THREE.Vector3(1, 0, 0)
  const vY = new THREE.Vector3(0, 1, 0)
  const vZ = new THREE.Vector3(0, 0, 1)
  const vTiefe = new THREE.Vector3()
  const vPos = new THREE.Vector3()
  const vSkala = new THREE.Vector3()

  const pins = spots.map((sp, i) => {
    const mc = maplibregl.MercatorCoordinate.fromLngLat(sp.lnglat, 0)
    const canvas = document.createElement('canvas')
    zeichneKopf(canvas, i + 1, 'kommend', null)
    const texKopf = new THREE.CanvasTexture(canvas)
    texKopf.minFilter = THREE.LinearMipmapLinearFilter
    texKopf.anisotropy = 4

    // DoubleSide ist Pflicht, nicht Bequemlichkeit: der Mercator-Raum ist gegenüber
    // ENU an der y-Achse gespiegelt (y zeigt nach Süden), damit kippt die Winding-Order
    // — die flach liegende Bodenscheibe wurde mit dem Default FrontSide komplett
    // weggecullt (sie war schlicht unsichtbar, unabhängig von Größe und Tiefentest).
    const kopf = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: texKopf, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }))
    const mast = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: texMast, color: ZUSTAND.kommend.mast, transparent: true, depthWrite: false, opacity: 0.92, side: THREE.DoubleSide }))
    const fuss = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: texFuss, color: ZUSTAND.kommend.mast, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    for (const o of [kopf, mast, fuss]) {
      o.matrixAutoUpdate = false
      o.frustumCulled = false
      scene.add(o)
    }
    return {
      sp,
      nummer: i + 1,
      mx: mc.x - mc0.x, // Mercator, relativ zum Ursprung
      my: mc.y - mc0.y,
      ele: (sp.ele ?? 0) * EXAGGERATION, // Startwert aus dem Höhenprofil der Route,
      eleZiel: null, //                     bis die erste Terrain-Abfrage greift

      zustand: 'kommend',
      stufe: 0, //     0 = flacher Bodenpunkt, 1 = voller Pin (wird geblendet)
      zielStufe: 0, // Ziel aus dem Fenster um die aktuelle Position (s. sync)
      canvas,
      texKopf,
      kopf,
      mast,
      fuss,
      bild: null,
      schirm: null, // { x, y, r } in CSS-Pixeln — Klickziel des Kopfes
    }
  })

  // Foto-Variante: Bilder nachladen, Kopf beim Eintreffen neu zeichnen. Der Kopf muss
  // dafür deutlich größer sein — bei 17 px Radius ist ein Foto ein Farbfleck.
  if (variante === 'foto') {
    MASSE.kopf = COARSE ? 22 : 27
    MASSE.mast = COARSE ? 74 : 88
    for (const p of pins) {
      if (!p.sp.src) continue
      const img = new Image()
      img.onload = () => {
        p.bild = img
        neuZeichnen(p)
        map.triggerRepaint()
      }
      img.src = p.sp.src
    }
  }

  function neuZeichnen(p) {
    zeichneKopf(p.canvas, p.nummer, p.zustand, p.bild)
    p.texKopf.needsUpdate = true
    const z = ZUSTAND[p.zustand]
    p.mast.material.color.setHex(z.mast)
    p.fuss.material.color.setHex(z.mast)
  }

  // — Terrainhöhe der Fußpunkte. queryTerrainElevation liefert die Höhe INKLUSIVE
  //   Überhöhung (genau dafür ist sie da) — nur so steht der Fuß auf dem gerenderten
  //   Boden statt im Hang. Gedrosselt, weil die DEM-Kacheln beim Fahren nachladen; die
  //   Höhe wird dabei NACHGEZOGEN statt gesetzt: eine feiner aufgelöste Kachel ändert
  //   den Wert um mehrere Meter, hart gesetzt würde der Pin sichtbar springen.
  let letzteHoehen = 0
  function hoehenPruefen(jetzt) {
    if (jetzt - letzteHoehen < 400) return
    letzteHoehen = jetzt
    for (const p of pins) {
      const e = map.queryTerrainElevation(p.sp.lnglat)
      if (e != null && Number.isFinite(e)) p.eleZiel = e
    }
  }

  // Bildschirmgröße → Weltmaß. k = Meter pro Pixel bei 1 m Kameradistanz (Öffnungswinkel).
  function metrik() {
    const tr = map.transform
    const hPx = tr?.height || map.getCanvas().clientHeight || 800
    const fov = (tr?.fov ?? 36.87) * DEG
    return { k: (2 * Math.tan(fov / 2)) / hPx, hPx, wPx: tr?.width || map.getCanvas().clientWidth || 1200 }
  }

  const mvp = new Array(16)
  const mainBuf = new Array(16)

  // Punkt (Mercator, ursprungsrelativ) durch die MVP-Matrix → NDC + Clip-w
  function projiziere(m, x, y, z, out) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    out.w = w
    out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w
    out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w
    return out
  }
  const pA = { x: 0, y: 0, w: 0 }
  const pB = { x: 0, y: 0, w: 0 }

  let blendet = false // läuft gerade eine Detailstufen-Blende? (pro Frame neu bestimmt)

  function aktualisiere(m) {
    blendet = false
    const { k, hPx, wPx } = metrik()
    const b = map.getBearing() * DEG
    const p = map.getPitch() * DEG
    // Bildschirm-Rechts und Bildschirm-Oben im Mercator-Raum (y zeigt nach Süden)
    vRechts.set(Math.cos(b), Math.sin(b), 0)
    vHoch.set(Math.sin(b) * Math.cos(p), -Math.cos(b) * Math.cos(p), Math.sin(p))
    vNormal.crossVectors(vRechts, vHoch).normalize()

    // Maßstab bei Referenzdistanz (Pixel je Meter) — Bezug der weltfesten Größe.
    const pxRef = 1 / (k * D_REF)
    const groesse = (px, pxProM) => weltGroesse(px, pxProM, pxRef, MASSE.perspektive, PX_MIN, PX_MAX)

    for (const pin of pins) {
      if (pin.eleZiel != null) pin.ele += (pin.eleZiel - pin.ele) * 0.18 // weich nachziehen
      const zFuss = pin.ele * mpu
      // Pixel je Meter am Fußpunkt: einen Meter entlang der Bildschirm-Rechts-Achse
      // projizieren. Braucht weder Kameraposition (die FreeCamera-API gibt es in
      // MapLibre 5 nicht mehr) noch Annahmen über die Projektion.
      projiziere(m, pin.mx, pin.my, zFuss, pA)
      projiziere(m, pin.mx + vRechts.x * mpu, pin.my + vRechts.y * mpu, zFuss, pB)
      const pxProM = Math.max(1e-6, Math.abs(pB.x - pA.x) * 0.5 * wPx)

      // Detailstufe weich nachziehen. Mast und Kopf wachsen MIT der Stufe aus dem
      // Bodenpunkt heraus — dadurch wandert auch das Klickziel (der Kopf) beim Ausblenden
      // von selbst auf den Boden zurück, und der Stopp bleibt anfassbar.
      if (pin.stufe !== pin.zielStufe) {
        pin.stufe = blendeSchritt(pin.stufe, pin.zielStufe, BLENDE)
        blendet = true // s. render(): sonst friert die Blende in der Pause ein
      }
      const stufe = pin.stufe
      const hM = groesse(MASSE.mast, pxProM) * stufe
      const rKopf = groesse(MASSE.kopf, pxProM) * stufe
      // Der Bodenpunkt bleibt IMMER und wird etwas größer, wenn kein Mast auf ihm steht —
      // sonst wäre ein ferner Stopp auf der Karte gar nicht mehr auffindbar.
      const rFuss = groesse(MASSE.fuss, pxProM) * (1 + 0.35 * (1 - stufe))
      const breite = Math.max(groesse(MASSE.kopf, pxProM) * 0.13, groesse(2.2, pxProM))
      const d = pA.w // Tiefe (Clip-w) — reicht als Sortierschlüssel

      // Was nicht im Bild ist, kostet nichts: bei 12 Stopps sind meist ein bis drei Pins
      // sichtbar. Three cullt hier nicht selbst (frustumCulled ist aus, weil die Kamera
      // keine Frustum-Info trägt — die Projektion kommt von MapLibre), also prüfen wir
      // Fuß UND Kopf gegen den Clip-Raum. Gemessen: 0,59 → 0,2 ms CPU je Frame.
      projiziere(m, pin.mx, pin.my, zFuss + hM * mpu, pB)
      const drin = imBild(pA.x, pA.y, pA.w) || imBild(pB.x, pB.y, pB.w)
      // Ausgeblendete Stufe = ein Draw statt drei (genau hier liegt die Ersparnis)
      const voll = stufe > 0.02
      pin.fuss.visible = drin
      pin.kopf.visible = pin.mast.visible = drin && voll
      if (!drin) {
        pin.schirm = null
        continue
      }

      // Fußring: flach in der Kartenebene. Er muss SPÜRBAR über Grund liegen — MapLibres
      // Terrain schreibt Tiefe, eine bodengleiche Scheibe verschwindet sonst komplett
      // (erster Versuch mit 0,2 m Abstand war unsichtbar). Der Abstand hängt an der VOLLEN
      // Masthöhe, nicht an der geblendeten: sonst versinkt der reine Bodenpunkt (stufe 0).
      pin.fuss.matrix.makeBasis(vX, vY, vZ)
      pin.fuss.matrix.scale(vSkala.set(rFuss * 2 * mpu, rFuss * 2 * mpu, 1))
      pin.fuss.matrix.setPosition(vPos.set(pin.mx, pin.my, zFuss + groesse(MASSE.mast, pxProM) * 0.03 * mpu))
      pin.fuss.renderOrder = 1e4 - d

      if (voll) {
        // Mast: senkrechtes Band, Breitenachse zur Kamera gedreht → aus jeder Richtung gleich dick
        pin.mast.matrix.makeBasis(vRechts, vZ, vTiefe.crossVectors(vRechts, vZ).normalize())
        pin.mast.matrix.scale(vSkala.set(breite * mpu, hM * mpu, 1))
        pin.mast.matrix.setPosition(vPos.set(pin.mx, pin.my, zFuss + (hM / 2) * mpu))

        // Kopf: volles Billboard (dreht mit Bearing UND Pitch zur Kamera)
        pin.kopf.matrix.makeBasis(vRechts, vHoch, vNormal)
        pin.kopf.matrix.scale(vSkala.set(rKopf * 2.35 * mpu, rKopf * 2.35 * mpu, 1))
        pin.kopf.matrix.setPosition(vPos.set(pin.mx, pin.my, zFuss + hM * mpu))

        // Transparenz ohne Tiefenschreiben braucht eine explizite Reihenfolge: fern zuerst.
        // (Three sortiert selbst über die Kameramatrix — die haben wir hier nicht.)
        pin.kopf.renderOrder = 1e6 - d
        pin.mast.renderOrder = 1e5 - d
      }
      // Klickziel: Kopfmitte, solange ein Kopf steht — sonst der Bodenpunkt. Weil hM mit
      // der Stufe schrumpft, wandert es beim Ausblenden von selbst nach unten.
      pin.klickZ = zFuss + hM * mpu
      pin.pxKlick = Math.max(rKopf, rFuss) * pxProM
      pin.hPx = hPx
      pin.wPx = wPx
    }
  }

  // Klickziele in CSS-Pixeln. Bezugspunkt ist die Kopfmitte bzw. — bei ausgeblendeter
  // Detailstufe — der Bodenpunkt (klickZ). Ein Stopp bleibt in JEDER Stufe anfassbar; die
  // flachen 2D-Kreise waren es auch.
  function schirmPunkte(m) {
    for (const pin of pins) {
      if (!pin.fuss.visible) {
        pin.schirm = null // außerhalb des Bildes → keine (veraltete) Klickfläche
        continue
      }
      projiziere(m, pin.mx, pin.my, pin.klickZ, pA)
      if (pA.w <= 0) {
        pin.schirm = null
        continue
      }
      pin.schirm = { x: (pA.x * 0.5 + 0.5) * pin.wPx, y: (0.5 - pA.y * 0.5) * pin.hPx, r: pin.pxKlick }
    }
  }

  function treffer(punkt) {
    let best = null
    let bestD = Infinity
    for (const pin of pins) {
      if (!pin.schirm) continue
      const d = Math.hypot(pin.schirm.x - punkt.x, pin.schirm.y - punkt.y)
      if (d < pin.schirm.r * 1.25 && d < bestD) {
        bestD = d
        best = pin
      }
    }
    return best
  }

  const layer = {
    id: 'photopins-3d',
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(gl, opts) {
      if (!renderer || !sichtbar) return
      hoehenPruefen(performance.now())
      const main = opts?.defaultProjectionData?.mainMatrix || opts
      for (let i = 0; i < 16; i++) mainBuf[i] = main[i]
      mat4mul(mainBuf, originMat, mvp)
      aktualisiere(mvp) // Maßstab kommt aus DIESER Matrix (s. projiziere)
      schirmPunkte(mvp)
      camera.projectionMatrix.fromArray(mvp)
      renderer.resetState()
      renderer.render(scene, camera)
      // Die Blende braucht mehrere Frames. Steht die Szene (Pause, Foto-Stopp), liefert
      // MapLibre von sich aus keinen weiteren Frame → hier selbst nachfordern.
      if (blendet) map.triggerRepaint()
    },
  }
  map.addLayer(layer)

  map.on('click', (e) => {
    if (!sichtbar) return
    const pin = treffer(e.point)
    if (pin) onSelect?.(pin.sp.s)
  })
  map.on('mousemove', (e) => {
    if (!sichtbar) return
    const c = map.getCanvas()
    if (treffer(e.point)) c.style.cursor = 'pointer'
    else if (c.style.cursor === 'pointer') c.style.cursor = ''
  })

  return {
    // Signaturgleich zu addSpotLayers: „besucht" ab Erreichen (20 m Vorlauf), danach
    // ist der erste offene Pin der nächste.
    sync(s) {
      const sWerte = pins.map((p) => p.sp.s)
      const zust = zustaende(sWerte, s)
      const ziele = stufenZiele(pins.length, naechsterIndex(sWerte, s), FENSTER)
      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i]
        if (zust[i] !== pin.zustand) {
          pin.zustand = zust[i]
          neuZeichnen(pin) // Kopf-Textur trägt die Zustandsfarben
        }
        pin.zielStufe = ziele[i]
      }
      map.triggerRepaint() // auch ohne Zustandswechsel: die Blende muss anlaufen
    },
    // Fenstergröße zur Laufzeit: __j.pins.setFenster({ vor: 3, zurueck: 1 })
    setFenster({ vor, zurueck } = {}) {
      if (vor != null) FENSTER.vor = Math.max(1, vor)
      if (zurueck != null) FENSTER.zurueck = Math.max(0, zurueck)
      map.triggerRepaint()
    },
    setVisible(on) {
      sichtbar = on
      map.triggerRepaint()
    },
    // Nachts leicht zurücknehmen — der Pin bleibt UI, soll aber nicht wie ein
    // Scheinwerfer über der dunklen Landschaft stehen.
    applyDayNight(p) {
      const b = Math.max(0.55, Math.min(1, p?.br ?? 1))
      for (const pin of pins) {
        pin.mast.material.opacity = 0.92 * b
        pin.fuss.material.opacity = b
      }
      map.triggerRepaint()
    },
    // Verdeckung durch das Gelände an/aus (Mast + Fußring). MapLibres Terrain schreibt
    // Tiefe, ein Custom-Layer mit renderingMode '3d' testet also dagegen — nachgewiesen
    // an einem Pin hinter dem Bergkamm. Der KOPF bleibt immer sichtbar.
    setTiefentest(on) {
      for (const p of pins) {
        p.mast.material.depthTest = on
        p.fuss.material.depthTest = on
      }
      map.triggerRepaint()
    },
    // Live-Regler in der Konsole: __j.pins.setMasse({ mast: 90, kopf: 20 })
    setMasse({ mast, kopf, fuss, perspektive } = {}) {
      if (mast != null) MASSE.mast = mast
      if (kopf != null) MASSE.kopf = kopf
      if (fuss != null) MASSE.fuss = fuss
      if (perspektive != null) MASSE.perspektive = perspektive
      map.triggerRepaint()
    },
    _dbg: () => ({
      pins: pins.length,
      hoehen: pins.map((p) => Math.round(p.ele)),
      stufen: pins.map((p) => Number(p.stufe.toFixed(2))), // Detailstufe je Pin
      schirm: pins.map((p) => (p.schirm ? { x: Math.round(p.schirm.x), y: Math.round(p.schirm.y), r: Math.round(p.schirm.r) } : null)),
    }),
    remove() {
      if (map.getLayer('photopins-3d')) map.removeLayer('photopins-3d')
      for (const p of pins) {
        p.texKopf.dispose()
        p.kopf.material.dispose()
        p.mast.material.dispose()
        p.fuss.material.dispose()
      }
      texMast.dispose()
      texFuss.dispose()
      quad.dispose()
    },
  }
}
