/**
 * Video-Export, Etappe 0: Probe ohne Produkt-UI.
 *
 * Feste ~10 s der ersten Filmsekunden, 720p quer. Karte, Fahrer, Atmosphäre,
 * Foto-Karte und Attribution auf ein H.264-MP4, Musik wenn die Tour welche hat.
 *
 * DOM-arm wo möglich: Anfrage, Dateiname, Framezahl und Einbrand-Text sind
 * reine Funktionen. Der Encoder (mediabunny) kommt erst im Lauf, per dynamischem
 * Import, damit er nicht im Player-Chunk landet.
 */

import type { Map as MapLibreKarte } from 'maplibre-gl'
import { indexAt, pointAt, type Route } from './geo.js'
import { quellenAlsEinbrand, sammleQuellen, type Datenquelle } from './karteninfo.js'
import type { Tour } from './tour.js'

export const EXPORT_BREITE = 1280
export const EXPORT_HOEHE = 720
export const EXPORT_FPS = 30
export const EXPORT_DAUER_S = 10
/** Marker auf 720p: etwas über dem Player-Puck (36 px), kein Ballon. */
export const EXPORT_REITER_PX = 40
/**
 * Walk liegt im Player bei 0,5. Aus der Distanz sind Esri-Kacheln scharf,
 * darunter wird das Satellitenbild zur Fläche. Export nicht näher als ~Rad.
 */
export const EXPORT_SKALA_MIN = 0.9
/** Relive-Muster: Quellen stehen im Abspann, nicht dauerhaft im Bild. */
export const EXPORT_ATTRIBUTION_S = 2
export const EXPORT_ATTRIBUTION_FADE_S = 0.4

export function klemmeExportSkala(sc: { behind: number; hover: number }): {
  behind: number
  hover: number
} {
  return {
    behind: Math.max(sc.behind, EXPORT_SKALA_MIN),
    hover: Math.max(sc.hover, EXPORT_SKALA_MIN),
  }
}

/** Query `?export=1` oder bereits gesetztes `body.export`. */
export function istExportAnfrage(search: string, bodyHatKlasse: boolean): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return q.get('export') === '1' || bodyHatKlasse
}

/**
 * Server-Kennung einer eigenen Tour (`t_…`). Mitgelieferte TOURS und fremde
 * Links fallen raus: Export ist Autor, nicht Besucher.
 */
export function eigeneTourId(tourParam: string): string | null {
  const id = tourParam.startsWith('srv:') ? tourParam.slice(4) : tourParam
  return id.startsWith('t_') ? id : null
}

export function istEigeneBereiteTour(
  tourParam: string,
  liste: ReadonlyArray<{ id: string }>,
): boolean {
  const id = eigeneTourId(tourParam)
  return id != null && liste.some((t) => t.id === id)
}

export function frameAnzahl(dauerS: number, fps: number): number {
  return Math.max(1, Math.round(dauerS * fps))
}

/** Clip-Zeit des Frames: `i / fps`, geklemmt auf die Filmdauer. */
export function filmSBeiFrame(i: number, fps: number, gesamtS: number): number {
  return Math.min(gesamtS, i / fps)
}

export function dateiname(titel: string): string {
  const slug =
    titel
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tour'
  return `maptale-${slug}-quer-720.mp4`
}

export function attributionAusKarte(
  sources: Record<string, { attribution?: string | undefined } | undefined>,
  extra: readonly Datenquelle[] = [],
): string {
  return quellenAlsEinbrand(sammleQuellen(sources, extra))
}

/**
 * Deckkraft der Pflicht-Attribution. 0 während der Fahrt, 1 in den letzten
 * `EXPORT_ATTRIBUTION_S` Sekunden, mit kurzem Fade.
 */
export function attributionSicht(
  filmS: number,
  clipS: number,
  dauerS = EXPORT_ATTRIBUTION_S,
  fadeS = EXPORT_ATTRIBUTION_FADE_S,
): number {
  if (!(clipS > 0) || dauerS <= 0) return 0
  const von = Math.max(0, clipS - dauerS)
  if (filmS < von) return 0
  if (fadeS <= 0) return 1
  return Math.min(1, (filmS - von) / fadeS)
}

/**
 * Deckkraft der Foto-Karte aus den Klip-Zeiten (Auftritt 0,5 s, Abgang aus
 * `ausZeitS`). 1 = voll sichtbar.
 */
export function kartenSicht(imS: number, ausZeitS: number, ausDauerS: number): number {
  let a = 1
  if (imS < 0.5) a = Math.max(0, imS / 0.5)
  if (ausZeitS < 0) a = Math.min(a, Math.max(0, 1 + ausZeitS / Math.max(0.01, ausDauerS)))
  return a
}

function warteMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function warteIdle(map: MapLibreKarte, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let fertig = false
    const ende = () => {
      if (fertig) return
      fertig = true
      resolve()
    }
    map.once('idle', ende)
    map.triggerRepaint()
    window.setTimeout(ende, timeoutMs)
  })
}

function naechstesBild(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

/**
 * Nach einem Kamerasprung erst ein Bild, dann kurz warten, bis MapLibre die
 * neuen Kachel-Anfragen gestellt hat, dann idle. Sonst feuert idle auf den
 * Overview-Kacheln der vorigen Pose (Konzept §8.4).
 */
async function warteKartenFrame(map: MapLibreKarte): Promise<void> {
  await naechstesBild()
  await warteMs(120)
  await warteIdle(map, 6000)
  if (!map.areTilesLoaded()) await warteIdle(map, 4000)
  await naechstesBild()
}

function tokenFarbe(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * Bricht die Rechtezeile an den Quellen-Trennern, sonst an Leerzeichen.
 * Pflicht-Attribution bleibt, nur nicht als Balken über die ganze Breite.
 */
export function brichAttribution(
  text: string,
  maxPx: number,
  mass: (s: string) => number,
): string[] {
  const stuecke = text.split(' · ')
  const zeilen: string[] = []
  let zeile = ''
  const passt = (s: string) => mass(s) <= maxPx
  for (const stueck of stuecke) {
    const cand = zeile ? `${zeile} · ${stueck}` : stueck
    if (zeile && !passt(cand)) {
      zeilen.push(zeile)
      zeile = passt(stueck) ? stueck : kuerze(stueck, maxPx, mass)
    } else if (!zeile && !passt(stueck)) {
      zeile = kuerze(stueck, maxPx, mass)
    } else {
      zeile = cand
    }
  }
  if (zeile) zeilen.push(zeile)
  return zeilen
}

function kuerze(text: string, maxPx: number, mass: (s: string) => number): string {
  let s = text
  while (s.length > 4 && mass(`${s}…`) > maxPx) s = s.slice(0, -1)
  return s.length < text.length ? `${s}…` : s
}

function zeichneAttribution(
  ctx: CanvasRenderingContext2D,
  text: string,
  breite: number,
  hoehe: number,
  sicht: number,
): void {
  if (!text || sicht <= 0.02) return
  const schrift = 11
  const pad = 8
  const lh = 14
  ctx.save()
  ctx.font = `500 ${schrift}px Outfit, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const max = Math.min(breite * 0.62, 640)
  const zeilen = brichAttribution(text, max, (s) => ctx.measureText(s).width)
  if (!zeilen.length) {
    ctx.restore()
    return
  }
  const textW = Math.max(...zeilen.map((z) => ctx.measureText(z).width))
  const boxW = textW + pad * 2
  const boxH = zeilen.length * lh + pad * 2 - 2
  const x = 8
  const y = hoehe - boxH - 8
  ctx.globalAlpha = sicht
  ctx.fillStyle = 'rgba(12, 15, 20, 0.42)'
  ctx.beginPath()
  ctx.roundRect(x, y, boxW, boxH, 4)
  ctx.fill()
  ctx.fillStyle = tokenFarbe('--text', '#f2ede3')
  zeilen.forEach((z, i) => ctx.fillText(z, x + pad, y + pad + i * lh))
  ctx.restore()
}

function zeichneOverlay(ctx: CanvasRenderingContext2D, id: string, breite: number, hoehe: number): void {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLCanvasElement) || el.width < 2 || el.height < 2) return
  ctx.drawImage(el, 0, 0, breite, hoehe)
}

export interface ExportReiter {
  getLngLat(): { lng: number; lat: number }
  getElement(): HTMLElement
}

async function backeReiter(marker: ExportReiter): Promise<HTMLCanvasElement> {
  const seite = EXPORT_REITER_PX
  const c = document.createElement('canvas')
  const dpr = 2
  c.width = seite * dpr
  c.height = seite * dpr
  const x = c.getContext('2d')
  if (!x) return c
  x.scale(dpr, dpr)
  const cx = seite / 2
  const cy = seite / 2
  const r = seite * 0.42
  const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  g.addColorStop(0, '#f8bb4b')
  g.addColorStop(1, '#ef8f35')
  x.beginPath()
  x.arc(cx, cy, r, 0, Math.PI * 2)
  x.fillStyle = g
  x.fill()
  x.lineWidth = 2.5
  x.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  x.stroke()
  const svgEl = marker.getElement().querySelector('svg')
  if (svgEl) {
    const clone = svgEl.cloneNode(true) as SVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('stroke', '#171106')
    clone.setAttribute('fill', 'none')
    const url =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new XMLSerializer().serializeToString(clone))
    const img = new Image()
    img.src = url
    try {
      await img.decode()
      const icon = seite * 0.44
      x.drawImage(img, cx - icon / 2, cy - icon / 2, icon, icon)
    } catch {
      /* Puck ohne Icon ist immer noch der Marker */
    }
  }
  return c
}

function zeichneReiter(
  ctx: CanvasRenderingContext2D,
  map: MapLibreKarte,
  marker: ExportReiter,
  sprite: HTMLCanvasElement,
): void {
  const p = map.project(marker.getLngLat())
  const seite = EXPORT_REITER_PX
  ctx.drawImage(sprite, p.x - seite / 2, p.y - seite / 2, seite, seite)
}

function parseZeitVar(el: HTMLElement, name: string): number {
  const roh = el.style.getPropertyValue(name).trim()
  const n = Number.parseFloat(roh)
  return Number.isFinite(n) ? n : 0
}

function zeichneFotoKarte(ctx: CanvasRenderingContext2D, breite: number, hoehe: number): void {
  const layer = document.getElementById('photo-layer')
  if (!(layer instanceof HTMLElement) || !layer.classList.contains('show')) return
  const imS = -parseZeitVar(layer, '--karte-zeit')
  const ausZeitS = parseZeitVar(layer, '--karte-aus-zeit')
  const ausDauerS = parseZeitVar(layer, '--karte-aus-dauer') || 0.8
  const sicht = kartenSicht(imS, ausZeitS, ausDauerS)
  if (sicht <= 0.02) return

  const video = layer.querySelector<HTMLVideoElement>('.photo-frame video')
  const img = layer.querySelector<HTMLImageElement>('.photo-frame img:not(.video-standbild)')
  const quelle =
    video && !video.hidden && video.readyState >= 2 ? video : img && img.complete ? img : null
  if (!quelle) return

  const titel = layer.querySelector('.photo-title')?.textContent?.trim() ?? ''
  const unter = layer.querySelector('.photo-sub')?.textContent?.trim() ?? ''
  const ar = quelle instanceof HTMLVideoElement
    ? (quelle.videoWidth || 3) / (quelle.videoHeight || 2)
    : (quelle.naturalWidth || 3) / (quelle.naturalHeight || 2)

  const maxW = breite * 0.72
  const maxH = hoehe * 0.58
  let bildW = maxW
  let bildH = bildW / ar
  if (bildH > maxH) {
    bildH = maxH
    bildW = bildH * ar
  }
  const pad = 14
  const textH = titel || unter ? 52 : 8
  const karteW = bildW + pad * 2
  const karteH = bildH + pad + textH
  const x = (breite - karteW) / 2
  const y = (hoehe - karteH) / 2 - 12
  const kb = 1 + 0.06 * Math.min(1, imS / 6)

  ctx.save()
  ctx.globalAlpha = sicht
  ctx.fillStyle = 'rgba(6, 10, 16, 0.28)'
  ctx.fillRect(0, 0, breite, hoehe)
  ctx.fillStyle = tokenFarbe('--papier', '#efe8dc')
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 40
  ctx.beginPath()
  ctx.roundRect(x, y, karteW, karteH, 12)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x + pad, y + pad, bildW, bildH, 5)
  ctx.clip()
  const zw = bildW * kb
  const zh = bildH * kb
  ctx.drawImage(quelle, x + pad - (zw - bildW) / 2, y + pad - (zh - bildH) / 2, zw, zh)
  ctx.restore()
  ctx.fillStyle = '#1c1712'
  ctx.font = '600 16px Outfit, system-ui, sans-serif'
  ctx.textBaseline = 'top'
  if (titel) ctx.fillText(titel, x + pad, y + pad + bildH + 10, bildW)
  if (unter) {
    ctx.font = '500 13px Outfit, system-ui, sans-serif'
    ctx.globalAlpha = sicht * 0.7
    ctx.fillText(unter, x + pad, y + pad + bildH + 30, bildW)
  }
  ctx.restore()
}

/**
 * Bricht eine projizierte Kette, sobald Punkte hinter der Kamera explodieren.
 * Sonst kreuzt die Spur den ganzen Frame.
 */
export function spurSegmente(
  punkte: ReadonlyArray<{ x: number; y: number }>,
  max: number,
): Array<Array<{ x: number; y: number }>> {
  const ketten: Array<Array<{ x: number; y: number }>> = []
  let kette: Array<{ x: number; y: number }> = []
  for (const p of punkte) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > max || Math.abs(p.y) > max) {
      if (kette.length >= 2) ketten.push(kette)
      kette = []
      continue
    }
    kette.push(p)
  }
  if (kette.length >= 2) ketten.push(kette)
  return ketten
}

function zeichneKetten(
  ctx: CanvasRenderingContext2D,
  ketten: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>,
  farbe: string,
  breite: number,
  glow = false,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const kette of ketten) {
    if (kette.length < 2) continue
    ctx.beginPath()
    ctx.moveTo(kette[0]!.x, kette[0]!.y)
    for (let i = 1; i < kette.length; i++) ctx.lineTo(kette[i]!.x, kette[i]!.y)
    if (glow) {
      ctx.strokeStyle = 'rgba(245, 165, 36, 0.38)'
      ctx.lineWidth = breite * 2.4
      ctx.stroke()
    }
    ctx.strokeStyle = farbe
    ctx.lineWidth = breite
    ctx.stroke()
  }
  ctx.restore()
}

function projektKette(
  map: MapLibreKarte,
  punkte: ReadonlyArray<readonly [number, number]>,
  breite: number,
  hoehe: number,
): Array<Array<{ x: number; y: number }>> {
  const max = Math.max(breite, hoehe) * 2.5
  return spurSegmente(
    punkte.map((c) => {
      const p = map.project([c[0], c[1]])
      return { x: p.x, y: p.y }
    }),
    max,
  )
}

function zeichneSpur(
  ctx: CanvasRenderingContext2D,
  map: MapLibreKarte,
  route: Route,
  s: number,
  breite: number,
  hoehe: number,
): void {
  if (route.coords.length < 2) return
  const hier = pointAt(route, s)
  const i = indexAt(route, s)
  const rest: Array<[number, number]> = [[hier[0], hier[1]]]
  for (let k = i; k < route.coords.length; k++) {
    const c = route.coords[k]!
    rest.push([c[0], c[1]])
  }
  const bereist: Array<[number, number]> = []
  for (let k = 0; k < i; k++) {
    const c = route.coords[k]!
    bereist.push([c[0], c[1]])
  }
  bereist.push([hier[0], hier[1]])
  zeichneKetten(ctx, projektKette(map, rest, breite, hoehe), 'rgba(255, 255, 255, 0.78)', 3.4)
  zeichneKetten(ctx, projektKette(map, bereist, breite, hoehe), '#f5a524', 5.6, true)
}

function versteckeKartenSpur(map: MapLibreKarte): void {
  for (const id of ['route-full', 'route-glow', 'route-glow-tip', 'route-progress', 'route-tip']) {
    try {
      map.setLayoutProperty(id, 'visibility', 'none')
    } catch {
      /* Layer kann fehlen */
    }
  }
}

function komponiereFrame(
  ziel: HTMLCanvasElement,
  map: MapLibreKarte,
  attribution: string,
  reiter: ExportReiter | undefined,
  sprite: HTMLCanvasElement | null,
  attribSicht: number,
  route: Route | undefined,
  s: number,
): void {
  const ctx = ziel.getContext('2d')
  if (!ctx) throw new Error('Ziel-Canvas ohne 2D-Kontext.')
  ctx.drawImage(map.getCanvas(), 0, 0, ziel.width, ziel.height)
  zeichneOverlay(ctx, 'atmosphere', ziel.width, ziel.height)
  zeichneOverlay(ctx, 'weather', ziel.width, ziel.height)
  if (route) zeichneSpur(ctx, map, route, s, ziel.width, ziel.height)
  if (reiter && sprite) zeichneReiter(ctx, map, reiter, sprite)
  zeichneFotoKarte(ctx, ziel.width, ziel.height)
  zeichneAttribution(ctx, attribution, ziel.width, ziel.height, attribSicht)
}

function setzeStand(el: HTMLElement, text: string): void {
  el.textContent = text
}

function ladeHerunter(buffer: ArrayBuffer, name: string): void {
  const blob = new Blob([buffer], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface ExportMusik {
  src: string
  vonS: number
  dauerS: number
  gain: number
}

export interface ExportLauf {
  map: MapLibreKarte
  tour: Tour
  titel: string
  stand?: HTMLElement
  extraQuellen?: readonly Datenquelle[]
  reiter?: ExportReiter
  hoehenBereit?: Promise<unknown>
  musik?: ExportMusik
}

async function schneideMusik(musik: ExportMusik, clipS: number): Promise<AudioBuffer | null> {
  try {
    const antwort = await fetch(musik.src)
    if (!antwort.ok) return null
    const ctx = new AudioContext()
    const voll = await ctx.decodeAudioData(await antwort.arrayBuffer())
    await ctx.close()
    const n = Math.max(1, Math.round(clipS * voll.sampleRate))
    const out = new AudioBuffer({
      length: n,
      sampleRate: voll.sampleRate,
      numberOfChannels: voll.numberOfChannels,
    })
    const start = Math.max(0, Math.floor(musik.vonS * voll.sampleRate))
    const gain = musik.gain
    for (let ch = 0; ch < voll.numberOfChannels; ch++) {
      const ein = voll.getChannelData(ch)
      const aus = out.getChannelData(ch)
      const len = ein.length
      if (!len) continue
      for (let i = 0; i < n; i++) aus[i] = ein[(start + i) % len]! * gain
    }
    return out
  } catch {
    return null
  }
}

/**
 * Stept ~10 s, komponiert die sichtbare Szene, muxed H.264-MP4, startet den Download.
 * Fehlt H.264, wird das auf dem Stand geschrieben, nicht als WebM heruntergeladen.
 */
export async function fuehreExportAus(lauf: ExportLauf): Promise<void> {
  const stand = lauf.stand
  const gesamtS = lauf.tour.film.gesamtS
  if (!(gesamtS > 0)) {
    if (stand) setzeStand(stand, 'Die Tour hat keine Filmdauer.')
    return
  }
  const dauerS = Math.min(EXPORT_DAUER_S, gesamtS)
  const n = frameAnzahl(dauerS, EXPORT_FPS)
  lauf.map.resize()
  try {
    lauf.map.setPaintProperty('satellite', 'raster-fade-duration', 0)
  } catch {
    /* Layer-Name kann fehlen */
  }

  if (document.hidden) {
    if (stand) setzeStand(stand, 'Tab im Hintergrund. Export abgebrochen.')
    return
  }

  let sources: Record<string, { attribution?: string | undefined } | undefined> = {}
  try {
    sources = (lauf.map.getStyle()?.sources ?? {}) as Record<
      string,
      { attribution?: string | undefined }
    >
  } catch {
    /* Stil noch nicht bereit: dann nur Extra-Quellen */
  }
  const attribution = attributionAusKarte(sources, lauf.extraQuellen ?? [])

  const {
    AudioBufferSource,
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
  } = await import('mediabunny')

  const codec = await getFirstEncodableVideoCodec(['avc'], {
    width: EXPORT_BREITE,
    height: EXPORT_HOEHE,
    quality: QUALITY_HIGH,
  })
  if (codec !== 'avc') {
    if (stand)
      setzeStand(stand, 'H.264 fehlt in diesem Browser. In Chrome oder Safari öffnen.')
    return
  }

  const ziel = document.createElement('canvas')
  ziel.width = EXPORT_BREITE
  ziel.height = EXPORT_HOEHE

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })
  const video = new CanvasSource(ziel, {
    codec: 'avc',
    quality: QUALITY_HIGH,
    keyFrameInterval: 2,
    alpha: 'discard',
    latencyMode: 'quality',
  })
  output.addVideoTrack(video, { frameRate: EXPORT_FPS })

  let audioQuelle: InstanceType<typeof AudioBufferSource> | null = null
  let musikPuffer: AudioBuffer | null = null
  if (lauf.musik) {
    const aac = await getFirstEncodableAudioCodec(['aac'])
    if (aac === 'aac') musikPuffer = await schneideMusik(lauf.musik, dauerS)
    if (musikPuffer) {
      audioQuelle = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
      output.addAudioTrack(audioQuelle)
    }
  }

  await output.start()
  if (audioQuelle && musikPuffer) {
    await audioQuelle.add(musikPuffer)
    audioQuelle.close()
  }

  let wache: WakeLockSentinel | null = null
  try {
    wache = (await navigator.wakeLock?.request('screen')) ?? null
  } catch {
    /* WakeLock ist Zugabe, kein Muss */
  }

  const sprite = lauf.reiter ? await backeReiter(lauf.reiter) : null

  try {
    if (stand) setzeStand(stand, 'Kacheln laden …')
    if (lauf.hoehenBereit) {
      // Nicht mitten im Loop ankommen: sampleElevations schreibt die
      // Wegpunkt-Höhen in-place, die Kamera würde dann hart absacken.
      await Promise.race([lauf.hoehenBereit, warteMs(20000)])
    }
    versteckeKartenSpur(lauf.map)
    lauf.tour.stelleExportFrame(0, EXPORT_SKALA_MIN, true)
    await warteMs(400)
    await warteKartenFrame(lauf.map)

    for (let i = 0; i < n; i++) {
      if (document.hidden) {
        await output.cancel()
        if (stand) setzeStand(stand, 'Tab im Hintergrund. Export abgebrochen.')
        return
      }
      if (stand) setzeStand(stand, `Frame ${i + 1} von ${n}`)
      const filmS = filmSBeiFrame(i, EXPORT_FPS, gesamtS)
      lauf.tour.stelleExportFrame(filmS, EXPORT_SKALA_MIN, false)
      await warteKartenFrame(lauf.map)
      await naechstesBild()
      komponiereFrame(
        ziel,
        lauf.map,
        attribution,
        lauf.reiter,
        sprite,
        attributionSicht(filmS, dauerS),
        lauf.tour.route,
        lauf.tour.s,
      )
      await video.add(i / EXPORT_FPS, 1 / EXPORT_FPS, { keyFrame: i % EXPORT_FPS === 0 })
    }
    video.close()
    await output.finalize()
    const buffer = target.buffer
    if (!buffer) {
      if (stand) setzeStand(stand, 'Muxer lieferte keine Datei.')
      return
    }
    ladeHerunter(buffer, dateiname(lauf.titel))
    if (stand) setzeStand(stand, 'Fertig. Datei liegt im Download.')
  } catch (err) {
    try {
      await output.cancel()
    } catch {
      /* schon tot */
    }
    const meldung = err instanceof Error ? err.message : String(err)
    if (stand) setzeStand(stand, `Export gescheitert: ${meldung}`)
    console.error('Video-Export:', err)
  } finally {
    try {
      await wache?.release()
    } catch {
      /* ignorieren */
    }
  }
}

/** Kleines Stand-Schild über der Karte. Kein Studio-Blatt. */
export function baueExportStand(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'export-stand'
  el.setAttribute('role', 'status')
  el.textContent = 'Export startet …'
  document.body.appendChild(el)
  return el
}

