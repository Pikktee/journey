/**
 * Video-Export: Encoder und Komposition.
 *
 * Ganze Tour in Player-Tempo, Intro/Fahrt/Finale, Bild und Ton wie der Player.
 * Formate und Clip-Zeit stehen in film-export-channel.ts (DOM-frei, geteilt mit Studio).
 * mediabunny kommt erst im Lauf, per dynamischem Import.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  EXPORT_INTRO_S,
  attributionOpacity,
  exportClipDurationS,
  fileName,
  exportViewport,
  filmTimeAtFrame,
  finalePanelOpacity,
  introPanelOpacity,
  formatClipTime,
  progressText,
  pausedText,
  frameCount,
  EXPORT_MESSAGE,
  type ExportFormat,
  type ExportMessage,
  type ExportProgress,
} from './film-export-channel.js'
import { sourcesForBurnIn, collectSources, type MapSource } from './map-attribution.js'
import { hasRange, loopEnabled, musicOffsetS, type AudioTrack } from './audiotracks.js'
import type { Tour } from './tour.js'

export {
  EXPORT_ATTRIBUTION_FADE_S,
  EXPORT_ATTRIBUTION_S,
  EXPORT_FINALE_S,
  EXPORT_FPS,
  EXPORT_FPS_CHOICES,
  EXPORT_INTRO_S,
  EXPORT_DEFAULT,
  isExportFps,
  attributionOpacity,
  exportClipDurationS,
  fileName,
  exportPixelRatio,
  exportQuery,
  exportViewport,
  isEmbedded,
  remainingS,
  remainingText,
  filmTimeAtFrame,
  finalePanelOpacity,
  formatClipTime,
  progressText,
  introPanelOpacity,
  pausedText,
  frameCount,
  parseExportFormat,
  mergeSegments,
  EXPORT_MESSAGE,
} from './film-export-channel.js'
export type {
  ExportFps,
  ExportMessage,
  ExportProgress,
  ExportFormat,
  ExportSize,
  ExportOrientation,
  ExportPhase,
  ExportViewport,
  LoopSegment,
} from './film-export-channel.js'

/** Marker auf 720p: etwas über dem Player-Puck (36 px), kein Ballon. */
export const EXPORT_TAB_PX = 40
/**
 * Walk liegt im Player bei 0,5. Aus der Distanz sind Esri-Kacheln scharf,
 * darunter wird das Satellitenbild zur Fläche. Export nicht näher als ~Rad.
 */
export const EXPORT_SCALE_MIN = 0.9

/** Query `?export=1` oder bereits gesetztes `body.export`. */
export function isExportRequest(search: string, bodyHasClass: boolean): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return q.get('export') === '1' || bodyHasClass
}

/**
 * Server-Kennung einer eigenen Tour (`t_…`). Mitgelieferte TOURS und fremde
 * Links fallen raus: Export ist Autor, nicht Besucher.
 */
export function ownTourId(tourParam: string): string | null {
  const id = tourParam.startsWith('srv:') ? tourParam.slice(4) : tourParam
  return id.startsWith('t_') ? id : null
}

export function isOwnReadyTour(tourParam: string, list: ReadonlyArray<{ id: string }>): boolean {
  const id = ownTourId(tourParam)
  return id != null && list.some((t) => t.id === id)
}

export function attributionFromMap(
  sources: Record<string, { attribution?: string | undefined } | undefined>,
  extra: readonly MapSource[] = [],
): string {
  return sourcesForBurnIn(collectSources(sources, extra))
}

// `kartenSicht` stand hier: eine lineare Deckkraft über 0,5 s, die einzige
// Auftritts-Bewegung, die der Export je hatte. Sie ist mit dem Nachbau
// gegangen — die Deckkraft der Karte rechnet jetzt `cardPhases`
// (src/card-painter.ts) aus derselben Blende und demselben Abgang wie am
// Bildschirm, mit den Kurven aus `CARD`.

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function waitIdle(map: MapLibreMap, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const end = () => {
      if (done) return
      done = true
      resolve()
    }
    map.once('idle', end)
    map.triggerRepaint()
    window.setTimeout(end, timeoutMs)
  })
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function waitUntilVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve()
  return new Promise((resolve) => {
    const next = () => {
      if (document.hidden) return
      document.removeEventListener('visibilitychange', next)
      resolve()
    }
    document.addEventListener('visibilitychange', next)
    if (!document.hidden) next()
  })
}

async function pauseWhileHidden(
  report: (status: ExportProgress, text: string, frame?: number) => void,
  clipS: number,
  done: number,
  n: number,
): Promise<boolean> {
  if (!document.hidden) return false
  report('pause', pausedText(clipS, done, n), done)
  await waitUntilVisible()
  return true
}

/**
 * Wartet, bis das Bild steht — und zwar so kurz wie möglich.
 *
 * Die feste 120-ms-Pause der ersten Fassung war der Preis für Falle 4: `idle`
 * feuert sonst auf den Kacheln der VORIGEN Pose, weil MapLibre die neuen
 * Anfragen erst nach einem Renderdurchlauf stellt. Bezahlt wurde sie aber in
 * JEDEM Bild — bei 30 fps sind das mindestens vier Sekunden Wandzeit je
 * Filmsekunde, bei einem Vier-Minuten-Film eine Viertelstunde reines Schlafen.
 *
 * Also justiert sich die Pause selbst: Sie schrumpft, solange die Karte danach
 * schon vollständig war, und springt bei der ersten Fehlstelle auf den vollen
 * Wert zurück. Ein Foto-Halt, ein langsamer Abschnitt oder eine zweite Runde
 * durch geladene Kacheln kostet damit fast nichts mehr.
 *
 * Sie fällt bewusst nicht auf null: Ohne Aufgabe an die Ereignisschleife
 * bekäme MapLibre keine Gelegenheit, die Anfragen überhaupt abzuschicken, und
 * `idle` fiele wieder auf den alten Kacheln — der Fehler wäre ein unscharfes
 * Bild, und das sieht man erst in der fertigen Datei.
 */
const WAIT_MAX_MS = 120
const WAIT_MIN_MS = 30

class TileWait {
  pauseMs = WAIT_MAX_MS
  /** Wie oft die Pause wieder auf den vollen Wert musste. Abnahme-Zähler. */
  reloaded = 0

  async frame(map: MapLibreMap): Promise<void> {
    await nextFrame()
    await waitMs(this.pauseMs)
    if (map.areTilesLoaded()) {
      this.pauseMs = Math.max(WAIT_MIN_MS, Math.round(this.pauseMs * 0.75))
      await nextFrame()
      return
    }
    this.reloaded++
    this.pauseMs = WAIT_MAX_MS
    await waitIdle(map, 6000)
    if (!map.areTilesLoaded()) await waitIdle(map, 4000)
    await nextFrame()
  }
}

/**
 * Wo die Wandzeit hingeht. Kein Profiler-Ersatz, sondern die vier Posten, die
 * sich überhaupt unterscheiden lassen — und der Beleg dafür, dass eine
 * Optimierung an der richtigen greift (`window.__maptale.exportMess`).
 */
export class FrameClock {
  readonly items: Record<string, number> = {
    engine: 0,
    tiles: 0,
    composition: 0,
    encode: 0,
  }
  frames = 0
  private t0 = 0

  start(): void {
    this.t0 = performance.now()
  }

  book(items: string): void {
    const now = performance.now()
    this.items[items] = (this.items[items] ?? 0) + (now - this.t0)
    this.t0 = now
  }

  /** Millisekunden je Bild, gerundet — das ist die Zahl, die man vergleicht. */
  perFrame(): Record<string, number> {
    const n = Math.max(1, this.frames)
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(this.items)) out[k] = Math.round((v / n) * 10) / 10
    return out
  }
}

function tokenColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * Bricht die Rechtezeile an den Quellen-Trennern, sonst an Leerzeichen.
 * Pflicht-Attribution bleibt, nur nicht als Balken über die ganze Breite.
 */
export function wrapAttribution(
  text: string,
  maxPx: number,
  scale: (s: string) => number,
): string[] {
  const pieces = text.split(' · ')
  const lines: string[] = []
  let line = ''
  const fits = (s: string) => scale(s) <= maxPx
  for (const piece of pieces) {
    const cand = line ? `${line} · ${piece}` : piece
    if (line && !fits(cand)) {
      lines.push(line)
      line = fits(piece) ? piece : truncate(piece, maxPx, scale)
    } else if (!line && !fits(piece)) {
      line = truncate(piece, maxPx, scale)
    } else {
      line = cand
    }
  }
  if (line) lines.push(line)
  return lines
}

function truncate(text: string, maxPx: number, scale: (s: string) => number): string {
  let s = text
  while (s.length > 4 && scale(`${s}…`) > maxPx) s = s.slice(0, -1)
  return s.length < text.length ? `${s}…` : s
}

function drawAttribution(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  opacity: number,
): void {
  if (!text || opacity <= 0.02) return
  const font = 11
  const pad = 8
  const lh = 14
  ctx.save()
  ctx.font = `500 ${font}px Outfit, system-ui, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const max = Math.min(width * 0.62, 640)
  const lines = wrapAttribution(text, max, (s) => ctx.measureText(s).width)
  if (!lines.length) {
    ctx.restore()
    return
  }
  const textW = Math.max(...lines.map((z) => ctx.measureText(z).width))
  const boxW = textW + pad * 2
  const boxH = lines.length * lh + pad * 2 - 2
  const x = 8
  const y = height - boxH - 8
  ctx.globalAlpha = opacity
  ctx.fillStyle = 'rgba(12, 15, 20, 0.42)'
  ctx.beginPath()
  ctx.roundRect(x, y, boxW, boxH, 4)
  ctx.fill()
  ctx.fillStyle = tokenColor('--text', '#f2ede3')
  lines.forEach((z, i) => ctx.fillText(z, x + pad, y + pad + i * lh))
  ctx.restore()
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  id: string,
  width: number,
  height: number,
): void {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLCanvasElement) || el.width < 2 || el.height < 2) return
  ctx.drawImage(el, 0, 0, width, height)
}

export interface ExportTab {
  getLngLat(): { lng: number; lat: number }
  getElement(): HTMLElement
}

/**
 * Sprite-Vorrat je Fortbewegungsmittel.
 *
 * Vorher wurde EIN Sprite vor der Schleife gebacken. `emitStats` schaltete das
 * Icon des DOM-Markers brav um, aber im Film blieb bis zum Ende das Symbol des
 * ersten Modus stehen — der Verkehrsmittelwechsel war unsichtbar. Gebacken
 * wird beim ersten Auftreten eines Modus, danach aus dem Vorrat.
 */
export function tabPool(marker: ExportTab, page: number) {
  const baked = new Map<string, HTMLCanvasElement>()
  return async (mode: string): Promise<HTMLCanvasElement> => {
    const found = baked.get(mode)
    if (found) return found
    const fresh = await bakeTab(marker, page)
    baked.set(mode, fresh)
    return fresh
  }
}

async function bakeTab(marker: ExportTab, page: number): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  const dpr = 2
  c.width = page * dpr
  c.height = page * dpr
  const x = c.getContext('2d')
  if (!x) return c
  x.scale(dpr, dpr)
  const cx = page / 2
  const cy = page / 2
  const r = page * 0.42
  const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  // Derselbe Marken-Verlauf wie der Puck auf der Bühne (.rider-pulse in
  // style.css) — vorher standen hier zwei Amber-Zwillinge, die es sonst
  // nirgends gab.
  g.addColorStop(0, tokenColor('--primary', '#f59e0b'))
  g.addColorStop(1, tokenColor('--secondary', '#ff6f52'))
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
    clone.setAttribute('stroke', tokenColor('--on-cta', '#1a1206'))
    clone.setAttribute('fill', 'none')
    const url =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new XMLSerializer().serializeToString(clone))
    const img = new Image()
    img.src = url
    try {
      await img.decode()
      const icon = page * 0.44
      x.drawImage(img, cx - icon / 2, cy - icon / 2, icon, icon)
    } catch {
      /* Puck ohne Icon ist immer noch der Marker */
    }
  }
  return c
}

function drawTab(
  ctx: CanvasRenderingContext2D,
  map: MapLibreMap,
  marker: ExportTab,
  sprite: HTMLCanvasElement,
  page: number,
): void {
  const p = map.project(marker.getLngLat())
  ctx.drawImage(sprite, p.x - page / 2, p.y - page / 2, page, page)
}

/**
 * Die Spur bleibt die der KARTE.
 *
 * Bis hierher zeichnete der Export eine eigene Linie über `map.project()`.
 * Die kennt das Gelände nicht und verbindet die Stützpunkte roh — die Spur
 * wirkte kantiger und gröber als im Player, und sie lag über dem Wetter statt
 * darunter. Die nativen Layer sind gedrapt und geglättet; im Film bekommt nur
 * die gepunktete Vorschau etwas mehr Gewicht, weil 2,4 px gestrichelt aus der
 * Filmkamera verschwinden (Konzept-Falle 11). Dieselben Layer, andere Zahlen.
 */
function boostRouteLine(map: MapLibreMap, factor: number): void {
  const put = (id: string, name: string, value: unknown): void => {
    try {
      map.setPaintProperty(id, name as never, value as never)
    } catch {
      /* Layer kann fehlen */
    }
  }
  put('route-full', 'line-width', 3.2 * factor)
  put('route-full', 'line-color', 'rgba(255,255,255,0.72)')
  put('route-full', 'line-dasharray', [0.6, 1.9])
  put('route-glow', 'line-width', 13 * factor)
  put('route-glow-tip', 'line-width', 13 * factor)
  put('route-progress', 'line-width', 5.6 * factor)
  put('route-tip', 'line-width', 5.6 * factor)
}

/**
 * Die Tafeln des Players auf die Leinwand.
 *
 * Startscreen und „Ziel erreicht" liegen im DOM und lassen sich nicht grabben —
 * die einzige Stelle, an der der Export wirklich nachbaut. Der INHALT kommt
 * deshalb aus denselben Elementen, die der Player füllt: Wer dort eine Zeile
 * ändert, ändert sie im Film mit.
 */
function text(id: string): string {
  const el = document.getElementById(id)
  // Ein ausgehängtes Element hat weiter seinen alten Text: Der Player versteckt
  // Chips, die nichts sagen („0 hm"), und die Stationszeile, wenn sie nur den
  // Titel wiederholt. Ohne diese Prüfung stünden sie im FILM trotzdem.
  if (!el || el.hidden || el.closest('[hidden]')) return ''
  return el.textContent?.trim() ?? ''
}

/**
 * Ein Absatz in Zeilen, die in `maxPx` passen — für die Beschreibung.
 *
 * Nimmt nur `measureText`, damit der Umbruch ohne Leinwand prüfbar ist: Die
 * Schriftmaße hängen an `ctx.font`, die Wortlogik nicht.
 */
export function wrapLines(
  ctx: { measureText(text: string): { width: number } },
  set: string,
  maxPx: number,
): string[] {
  const words = set.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let running = ''
  for (const word of words) {
    const attempt = running ? `${running} ${word}` : word
    if (running && ctx.measureText(attempt).width > maxPx) {
      lines.push(running)
      running = word
    } else running = attempt
  }
  if (running) lines.push(running)
  return lines
}

function drawScrim(ctx: CanvasRenderingContext2D, b: number, h: number, strength: number): void {
  const g = ctx.createRadialGradient(b / 2, h * 0.44, 0, b / 2, h * 0.44, Math.max(b, h) * 0.75)
  g.addColorStop(0, `rgba(6, 9, 14, ${0.62 * strength})`)
  g.addColorStop(1, `rgba(5, 8, 12, ${0.94 * strength})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, b, h)
}

function drawCentered(ctx: CanvasRenderingContext2D, line: string, b: number, y: number): void {
  ctx.fillText(line, b / 2, y)
}

/**
 * Der Filmtitel.
 *
 * Inhaltlich der Startscreen, in der Form aber eine TITELTAFEL und keine
 * abfotografierte Oberfläche: Der Startknopf und die Zurück-Pille fehlen, weil
 * hier nichts zu bedienen ist, und die Kennzahlen stehen als ruhige Zeile statt
 * als Pillen. Ein Rand und eine Glasfläche sagen „hier kann man klicken" — in
 * einem Film sagt das niemandem etwas und sieht nach Screenshot aus.
 *
 * Der INHALT kommt aus denselben Elementen, die der Player füllt.
 */
export function drawIntroPanel(
  ctx: CanvasRenderingContext2D,
  b: number,
  h: number,
  opacity: number,
): void {
  if (opacity <= 0.02) return
  const e = Math.min(b, h) / 720 // Maße sind auf 720p ausgemessen
  const title = (document.getElementById('intro-title')?.innerHTML ?? '')
    .split(/<br\s*\/?>/i)
    .map((z) => z.replace(/<[^>]*>/g, '').trim())
    .filter(Boolean)
  const kicker = text('intro-kicker')
  const route = text('intro-route')
  const description = text('intro-desc')
  // Die Herkunft steht auch im Film — nur ohne Link und ohne Avatar: Ein Bild
  // aus dem Netz wäre eine weitere Ladequelle mitten im Rendern.
  const authorName = text('intro-author-name')
  const authorDate = text('intro-author-date')
  const author = [authorName, authorDate].filter(Boolean).join('  ·  ')
  // Eine Zeile statt drei Pillen. Der schmale Zwischenraum um das Trennzeichen
  // ist Absicht: „0,4 km · 11 hm" liest sich als eine Angabe, mit normalen
  // Leerzeichen zerfiele die Zeile in drei.
  const numbers = ['chip-duration-text', 'chip-distance', 'chip-gain', 'chip-photos']
    .map(text)
    .filter(Boolean)
    .join('  ·  ')

  ctx.save()
  ctx.globalAlpha = opacity
  drawScrim(ctx, b, h, 1)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const longest = Math.max(1, ...title.map((z) => z.length))
  const titlePx = Math.min(96 * e, (b * 0.82) / (longest * 0.54))
  const lineH = titlePx * 1.02
  // Die Beschreibung muss VOR der Blockhöhe umbrochen werden — sie ist der
  // einzige Teil der Tafel, dessen Höhe vom Text abhängt.
  const descriptionPx = 15 * e
  const descriptionWidth = Math.min(b * 0.62, 620 * e)
  ctx.font = `300 ${descriptionPx}px Outfit, system-ui, sans-serif`
  const descriptionLines = description ? wrapLines(ctx, description, descriptionWidth) : []
  const descriptionLineH = descriptionPx * 1.5
  const block =
    30 * e +
    title.length * lineH +
    46 * e +
    (author ? 26 * e : 0) +
    (route ? 24 * e : 0) +
    (descriptionLines.length ? descriptionLines.length * descriptionLineH + 8 * e : 0) +
    (numbers ? 30 * e : 0)
  let y = h / 2 - block / 2 + 8 * e

  ctx.font = `500 ${13.5 * e}px Outfit, system-ui, sans-serif`
  ctx.fillStyle = tokenColor('--primary', '#f5a524')
  if (kicker) drawCentered(ctx, kicker, b, y)
  y += 24 * e + lineH / 2

  ctx.fillStyle = tokenColor('--text', '#f2ede3')
  ctx.font = `600 ${titlePx}px Outfit, system-ui, sans-serif`
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 40 * e
  ctx.shadowOffsetY = 6 * e
  for (const line of title) {
    drawCentered(ctx, line, b, y)
    y += lineH
  }
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  y += lineH * -0.5 + 34 * e

  ctx.fillStyle = tokenColor('--primary', '#f5a524')
  ctx.globalAlpha = opacity * 0.85
  ctx.fillRect(b / 2 - 38 * e, y, 76 * e, Math.max(1, e))
  ctx.globalAlpha = opacity
  y += 26 * e

  if (author) {
    ctx.font = `500 ${14 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenColor('--muted', 'rgba(242,237,227,0.62)')
    drawCentered(ctx, author, b, y)
    y += 26 * e
  }

  if (route) {
    ctx.font = `500 ${13.5 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenColor('--muted', 'rgba(242,237,227,0.62)')
    drawCentered(ctx, route, b, y)
    y += 30 * e
  }

  if (descriptionLines.length) {
    ctx.font = `300 ${descriptionPx}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenColor('--muted', 'rgba(242,237,227,0.62)')
    for (const line of descriptionLines) {
      drawCentered(ctx, line, b, y)
      y += descriptionLineH
    }
    y += 8 * e
  }

  if (numbers) {
    ctx.font = `500 ${13.5 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenColor('--text', '#f2ede3')
    ctx.globalAlpha = opacity * 0.9
    drawCentered(ctx, numbers, b, y)
  }
  ctx.restore()
}

/** „Ziel erreicht": Glaskarte mit Titel und den drei Kennzahlen. */
export function drawFinalePanel(
  ctx: CanvasRenderingContext2D,
  b: number,
  h: number,
  opacity: number,
): void {
  if (opacity <= 0.02) return
  const e = Math.min(b, h) / 720
  const kicker = document.querySelector('.finale-kicker')?.textContent?.trim() ?? 'Ziel erreicht'
  const title = text('finale-title')
  const values: Array<[string, string]> = [
    ['Distanz', text('final-km')],
    ['Höhenmeter', text('final-gain')],
    ['Fotos', text('final-photos')],
  ].filter((z) => z[1]) as Array<[string, string]>

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${48 * e}px Outfit, system-ui, sans-serif`
  const column = 120 * e
  const cardW = Math.max(ctx.measureText(title).width + 112 * e, values.length * column + 32 * e)
  const cardH = (values.length ? 214 : 150) * e
  const x = b / 2 - cardW / 2
  const y = h / 2 - cardH / 2

  ctx.fillStyle = tokenColor('--glass', 'rgba(18, 22, 28, 0.72)')
  ctx.strokeStyle = tokenColor('--glass-border', 'rgba(255,255,255,0.14)')
  ctx.lineWidth = Math.max(1, e)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 60 * e
  ctx.beginPath()
  ctx.roundRect(x, y, cardW, cardH, 22 * e)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.stroke()

  let cy = y + 42 * e
  ctx.font = `500 ${13 * e}px Outfit, system-ui, sans-serif`
  ctx.fillStyle = tokenColor('--primary', '#f5a524')
  drawCentered(ctx, kicker, b, cy)
  cy += 16 * e + 27 * e
  ctx.font = `600 ${48 * e}px Outfit, system-ui, sans-serif`
  ctx.fillStyle = tokenColor('--text', '#f2ede3')
  drawCentered(ctx, title, b, cy)
  cy += 27 * e + 46 * e

  const left = b / 2 - ((values.length - 1) * column) / 2
  values.forEach(([label, value], i) => {
    const cx = left + i * column
    ctx.font = `500 ${12 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenColor('--muted', 'rgba(242,237,227,0.62)')
    ctx.fillText(label, cx, cy)
    ctx.font = `600 ${24 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenColor('--text', '#f2ede3')
    ctx.fillText(value, cx, cy + 26 * e)
  })
  ctx.restore()
}

export interface FramePanels {
  intro: number
  finale: number
}

function composeFrame(
  target: HTMLCanvasElement,
  map: MapLibreMap,
  attribution: string,
  tab: ExportTab | undefined,
  sprite: HTMLCanvasElement | null,
  tabPx: number,
  attribOpacity: number,
  panels: FramePanels,
): void {
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('Ziel-Canvas ohne 2D-Kontext.')
  // Reihenfolge wie die Schichtung der Seite: Karte (mit ihrer Spur), darüber
  // Atmosphäre und Wetter, dann was im DOM darüber liegt.
  ctx.drawImage(map.getCanvas(), 0, 0, target.width, target.height)
  drawOverlay(ctx, 'atmosphere', target.width, target.height)
  drawOverlay(ctx, 'weather', target.width, target.height)
  if (tab && sprite) drawTab(ctx, map, tab, sprite, tabPx)
  // Die Foto-Karte ist seit Etappe 2 der Kartenleinwand eine Leinwand des
  // PLAYERS und wird hier nur noch geholt — dieselbe Zeile wie für Wetter und
  // Atmosphäre. Vorher stand hier ein eigener Nachbau: Ken Burns in der
  // Gegenrichtung, kein „Entwickeln", kein Blitz, kein Balken, keine Pillen, und
  // die Texte per `textContent` aus dem DOM zurückgelesen
  // (docs/concepts/konzept_kartenleinwand.md §2.1).
  drawOverlay(ctx, 'card', target.width, target.height)
  drawIntroPanel(ctx, target.width, target.height, panels.intro)
  drawFinalePanel(ctx, target.width, target.height, panels.finale)
  drawAttribution(ctx, attribution, target.width, target.height, attribOpacity)
}

function setStatus(el: HTMLElement, text: string): void {
  el.textContent = text
}

/**
 * Ein Ort für „wie weit ist der Film". Schreibt aufs Stand-Schild (eigener
 * Tab) UND meldet nach draußen (Rahmen im Studio) — beides aus denselben
 * Zahlen, damit die zwei Oberflächen nicht auseinanderlaufen.
 */
function buildReporter(run: ExportRun, clipS: number, frames: number) {
  return (status: ExportProgress, text: string, frame = 0): void => {
    if (run.status) setStatus(run.status, text)
    run.report?.({ type: EXPORT_MESSAGE, status: status, frame, frames, clipS, text })
  }
}

function download(buffer: ArrayBuffer, name: string): void {
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

export interface ExportAudioClip {
  src: string
  fromClipS: number
  toClipS: number
  fileFromS: number
  loop: boolean
  gain: number
  /**
   * Ein-/Ausblendung in Sekunden (0 = harter Schnitt).
   *
   * Motor und Wetterton entstehen als ABSCHNITTE aus der Filmachse und stoßen
   * an jeder Modus-Kante und an jedem Halt aneinander. Hart geschnitten knackt
   * dort jede Naht; im Player ist derselbe Wechsel ein Crossfade (`vehicle.ts`
   * blendet über ~0,7 s). Die Studio-Spuren bleiben bei 0 — die bringen ihre
   * eigene Blende mit.
   */
  fadeS?: number
}

export interface ExportAudioOneShot {
  src: string
  atClipS: number
  gain: number
}

export interface ExportAudio {
  clips: ExportAudioClip[]
  oneShots: ExportAudioOneShot[]
}

export interface ExportRun {
  map: MapLibreMap
  tour: Tour
  title: string
  format: ExportFormat
  status?: HTMLElement
  /**
   * Fortschritt nach draußen. Gesetzt, wenn der Lauf in einem Rahmen im
   * Studio steckt: Dann gibt es kein Stand-Schild, sondern einen Balken im
   * Studio-Blatt, und die fertige Datei geht als Puffer dorthin — der Nutzer
   * soll sie auch nach einer weggeklickten Download-Leiste noch bekommen.
   */
  report?: (m: ExportMessage, handover?: Transferable[]) => void
  extraSources?: readonly MapSource[]
  tab?: ExportTab
  elevationReady?: Promise<unknown>
  audio?: ExportAudio
  /**
   * Overlays für den Film scharf machen: Gates auf „läuft", Canvases neu
   * messen, Wetter und Atmosphäre auf EXTERNEN Takt (s. `taktOverlays`).
   */
  prepareOverlays?: () => void
  /**
   * Ein Filmbild der Overlays. Ohne diesen Griff liefen Partikel, Böen und die
   * Wetter-Blende auf der Wanduhr weiter — im Export sind das 0,3–2 s je
   * Filmbild, und zwar jedes Mal andere.
   */
  stepOverlays?: (dt: number) => void
  /** Nach jedem Kamerasprung: Wetter der Stelle anwenden. */
  afterCamera?: () => void
  /**
   * Steht das Bild der Foto-Karte? (`ui.kartenBereit`)
   *
   * `drawImage` auf einem noch suchenden `<video>` zeichnet ohne Fehler das ALTE
   * Bild. Am Bildschirm fällt das nicht auf, im Film ist es ein falsches
   * Einzelbild in der Datei — deshalb wartet der Lauf hier, statt zu encodieren
   * (Konzept §5, „Bild und Video").
   */
  cardReady?: () => boolean
}

const ENGINE_SRC: Record<string, string> = {
  moped: '/audio/eng-moped.mp3',
  jeep: '/audio/eng-jeep.mp3',
  ferry: '/audio/eng-boat.mp3',
}
/** Wie `createVehicle({ volume: 0.2 })` im Player. */
export const ENGINE_GAIN = 0.2
const WEATHER_SRC: Record<string, { src: string; gain: number }> = {
  rain: { src: '/audio/rain.mp3', gain: 0.4 },
  storm: { src: '/audio/storm.mp3', gain: 0.5 },
  snow: { src: '/audio/wind.mp3', gain: 0.26 },
}

export function engineLoopSource(mode: string): string | null {
  return ENGINE_SRC[mode] ?? null
}

export function weatherLoopSource(mode: string, k: number): { src: string; gain: number } | null {
  const base = WEATHER_SRC[mode]
  if (!base) return null
  return { src: base.src, gain: base.gain * (0.4 + 0.6 * Math.max(0, Math.min(1, k))) }
}

/** Studio-Spuren auf Clip-Zeit (Intro davor, Finale danach, dort stumm wie im Player). */
export function audioClipsFromTracks(
  tracks: readonly AudioTrack[],
  introS: number,
  rideS: number,
  master: number,
): { clips: ExportAudioClip[]; oneShots: ExportAudioOneShot[] } {
  const clips: ExportAudioClip[] = []
  const oneShots: ExportAudioOneShot[] = []
  for (const track of tracks) {
    const gain = master * (track.gain ?? 1)
    if (hasRange(track)) {
      const from = introS + Math.max(0, track.filmFromS)
      const to = introS + Math.min(rideS, track.filmToS)
      if (to <= from) continue
      clips.push({
        src: track.src,
        fromClipS: from,
        toClipS: to,
        fileFromS: musicOffsetS(
          Math.max(0, -track.filmFromS),
          0,
          track.startS ?? 0,
          loopEnabled(track),
        ),
        loop: loopEnabled(track),
        gain,
      })
    } else if (track.filmFromS >= 0 && track.filmFromS < rideS) {
      oneShots.push({ src: track.src, atClipS: introS + track.filmFromS, gain })
    }
  }
  return { clips, oneShots }
}

async function loadBuffer(src: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const ctx = new AudioContext()
    const full = await ctx.decodeAudioData(await response.arrayBuffer())
    await ctx.close()
    return full
  } catch {
    return null
  }
}

/**
 * Mix aus filmS, nicht aus dem Live-Graphen. Der Encode stepped, die Wanduhr
 * der Player-Elemente stünde woanders als der Frame.
 */
async function mixAudio(audio: ExportAudio, clipS: number): Promise<AudioBuffer | null> {
  const srcs = new Set<string>()
  for (const k of audio.clips) srcs.add(k.src)
  for (const s of audio.oneShots) srcs.add(s.src)
  if (!srcs.size || !(clipS > 0)) return null
  const buffer = new Map<string, AudioBuffer>()
  await Promise.all(
    [...srcs].map(async (src) => {
      const b = await loadBuffer(src)
      if (b) buffer.set(src, b)
    }),
  )
  if (!buffer.size) return null
  const rate = [...buffer.values()][0]!.sampleRate
  const length = Math.max(1, Math.round(clipS * rate))
  const offline = new OfflineAudioContext(2, length, rate)
  const startClip = (k: ExportAudioClip, buf: AudioBuffer): void => {
    const src = offline.createBufferSource()
    src.buffer = buf
    src.loop = k.loop
    if (k.loop) {
      src.loopStart = 0
      src.loopEnd = buf.duration
    }
    const g = offline.createGain()
    const volume = Math.max(0, Math.min(1, k.gain))
    src.connect(g)
    g.connect(offline.destination)
    const offset = Math.max(0, Math.min(buf.duration, k.fileFromS))
    const when = Math.max(0, k.fromClipS)
    const duration = Math.max(0.02, k.toClipS - k.fromClipS)
    // Blende höchstens über die halbe Abschnittslänge, sonst überlappen sich
    // Ein- und Ausblendung und der Abschnitt erreicht seinen Pegel nie.
    const fade = Math.min(k.fadeS ?? 0, duration / 2)
    if (fade > 0.01) {
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(volume, when + fade)
      g.gain.setValueAtTime(volume, when + duration - fade)
      g.gain.linearRampToValueAtTime(0, when + duration)
    } else {
      g.gain.value = volume
    }
    try {
      src.start(when, offset)
      src.stop(when + duration)
    } catch {
      /* Start hinter dem Ende: ignorieren */
    }
  }
  for (const k of audio.clips) {
    const buf = buffer.get(k.src)
    if (buf) startClip(k, buf)
  }
  for (const s of audio.oneShots) {
    const buf = buffer.get(s.src)
    if (!buf) continue
    startClip(
      {
        src: s.src,
        fromClipS: s.atClipS,
        toClipS: Math.min(clipS, s.atClipS + buf.duration),
        fileFromS: 0,
        loop: false,
        gain: s.gain,
      },
      buf,
    )
  }
  try {
    return await offline.startRendering()
  } catch {
    return null
  }
}

/**
 * Stept die ganze Tour, komponiert die sichtbare Szene, muxed H.264-MP4.
 * Fehlt H.264, wird das auf dem Stand geschrieben, nicht als WebM heruntergeladen.
 */
export async function runFilmExport(run: ExportRun): Promise<void> {
  const status = run.status
  const rideS = run.tour.film.totalS
  if (!(rideS > 0)) {
    if (status) setStatus(status, 'Die Tour hat keine Filmdauer.')
    run.report?.({ type: EXPORT_MESSAGE, status: 'fehler', text: 'Die Tour hat keine Filmdauer.' })
    return
  }
  const format = run.format
  const vp = exportViewport(format)
  // Die Bildrate ist eine reine ABTASTUNG (s. `EXPORT_FPS_WAHL`): Sie bestimmt,
  // wie oft die Filmzeit gemessen wird, nicht wie der Film abläuft. Deshalb
  // hängt alles im selben Atemzug daran — Bildzahl, Engine-Schritt,
  // Overlay-Takt, Zeitstempel und die Bildrate der Spur.
  const fps = format.fps
  const durationS = exportClipDurationS(rideS, run.tour.showFinale)
  const n = frameCount(durationS, fps)
  const report = buildReporter(run, durationS, n)
  const dtFrame = 1 / fps
  run.map.resize()
  try {
    run.map.setPaintProperty('satellite', 'raster-fade-duration', 0)
  } catch {
    /* Layer-Name kann fehlen */
  }
  run.prepareOverlays?.()
  await pauseWhileHidden(report, durationS, 0, n)

  let sources: Record<string, { attribution?: string | undefined } | undefined> = {}
  try {
    sources = (run.map.getStyle()?.sources ?? {}) as Record<
      string,
      { attribution?: string | undefined }
    >
  } catch {
    /* Stil noch nicht bereit: dann nur Extra-Quellen */
  }
  const attribution = attributionFromMap(sources, run.extraSources ?? [])

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
    width: vp.width,
    height: vp.height,
    quality: QUALITY_HIGH,
  })
  if (codec !== 'avc') {
    report('fehler', 'H.264 fehlt in diesem Browser. In Chrome oder Safari öffnen.')
    return
  }

  const frameCanvas = document.createElement('canvas')
  frameCanvas.width = vp.width
  frameCanvas.height = vp.height
  // Abnahme-Griff wie die übrigen `window.__maptale`: Was der Encoder sieht, ist
  // sonst nirgends im DOM — ein Seiten-Screenshot zeigt Reiter, Foto-Karte und
  // die Tafeln gerade NICHT, weil die auf diese Leinwand gezeichnet werden.
  Object.assign((window as unknown as { __maptale?: Record<string, unknown> }).__maptale ?? {}, {
    exportTarget: frameCanvas,
  })
  const tabPx = Math.round(EXPORT_TAB_PX * (Math.min(vp.width, vp.height) / 720))

  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })
  const video = new CanvasSource(frameCanvas, {
    codec: 'avc',
    quality: QUALITY_HIGH,
    keyFrameInterval: 2,
    alpha: 'discard',
    latencyMode: 'quality',
  })
  output.addVideoTrack(video, { frameRate: fps })

  let audioSource: InstanceType<typeof AudioBufferSource> | null = null
  let audioBuffer: AudioBuffer | null = null
  if (run.audio && (run.audio.clips.length || run.audio.oneShots.length)) {
    const aac = await getFirstEncodableAudioCodec(['aac'])
    if (aac === 'aac') {
      report('start', 'Ton mischen …')
      audioBuffer = await mixAudio(run.audio, durationS)
    }
    if (audioBuffer) {
      audioSource = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
      output.addAudioTrack(audioSource)
    }
  }

  await output.start()
  if (audioSource && audioBuffer) {
    await audioSource.add(audioBuffer)
    audioSource.close()
  }

  const takeGuard = async (): Promise<WakeLockSentinel | null> => {
    try {
      return (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      return null
    }
  }
  let guard: WakeLockSentinel | null = await takeGuard()

  const takeSprite = run.tab ? tabPool(run.tab, tabPx) : null

  try {
    await pauseWhileHidden(report, durationS, 0, n)
    guard = (await takeGuard()) ?? guard
    report('start', `Film ${formatClipTime(durationS)}. Kacheln laden …`)
    if (run.elevationReady) {
      // Nicht mitten im Loop ankommen: sampleElevations schreibt die
      // Wegpunkt-Höhen in-place, die Kamera würde dann hart absacken.
      await Promise.race([run.elevationReady, waitMs(20000)])
    }
    boostRouteLine(run.map, Math.min(vp.width, vp.height) / 720)
    // Ab hier taktet der Encoder. `tick` läuft weiter, rührt die Kamera aber
    // nicht mehr an — sonst drehte die Wanduhr den Intro-Orbit mit.
    run.tour.exportTick = true
    run.tour.exportScaleMin = EXPORT_SCALE_MIN
    // Ein paar Bilder einschwingen (die DEM-Kacheln kommen erst jetzt an),
    // danach den Orbit-Winkel zurücksetzen: Der Film beginnt bei seinem Anfang.
    const orbitStart = run.tour.orbitA
    for (let k = 0; k < 30; k++) run.tour.exportSchritt(dtFrame)
    run.tour.orbitA = orbitStart
    await waitMs(400)
    const waiting = new TileWait()
    const clock = new FrameClock()
    Object.assign((window as unknown as { __maptale?: Record<string, unknown> }).__maptale ?? {}, {
      exportStats: () => ({
        ...clock.perFrame(),
        frames: clock.frames,
        pauseMs: waiting.pauseMs,
        reloaded: waiting.reloaded,
      }),
    })
    await waiting.frame(run.map)

    let finaleSinceS = -1
    for (let i = 0; i < n; i++) {
      if (await pauseWhileHidden(report, durationS, i, n)) {
        guard = (await takeGuard()) ?? guard
      }
      report('laeuft', progressText(durationS, i + 1, n), i + 1)
      clock.start()
      const t = filmTimeAtFrame(i, fps, durationS)
      // Der Übergang vom Orbit in die Fahrt ist derselbe wie im Player: kein
      // eigener Pfad, sondern der Griff, den auch „Tour starten" bedient.
      if (t >= EXPORT_INTRO_S && run.tour.phase === 'intro') run.tour.begin()
      run.tour.exportSchritt(dtFrame)
      run.afterCamera?.()
      run.stepOverlays?.(dtFrame)
      // Beim EINTRITT auf 0 und nicht auf −1 + dt: sonst stünde die Tafel eine
      // Sekunde lang bei „noch nicht sichtbar", und von sechs Finale-Sekunden
      // wären zwei vertan.
      finaleSinceS =
        run.tour.phase === 'finale' ? (finaleSinceS < 0 ? 0 : finaleSinceS + dtFrame) : -1
      clock.book('engine')
      await waiting.frame(run.map)
      if (await pauseWhileHidden(report, durationS, i, n)) {
        guard = (await takeGuard()) ?? guard
        await waiting.frame(run.map)
      }
      clock.book('kacheln')
      // Höchstens ein paar Bilder: Bleibt der Frame aus (Datei kaputt, Seek
      // hängt), ist ein Bild mit dem vorigen Stand besser als ein Lauf, der
      // nicht endet.
      for (let w = 0; w < 6 && run.cardReady && !run.cardReady(); w++) {
        await nextFrame()
        run.tour.exportSchritt(0)
      }
      const sprite = takeSprite ? await takeSprite(run.tour.modeAt(run.tour.s).mode) : null
      composeFrame(
        frameCanvas,
        run.map,
        attribution,
        run.tab,
        sprite,
        tabPx,
        attributionOpacity(t, durationS),
        {
          intro: introPanelOpacity(t),
          finale: finaleSinceS >= 0 ? finalePanelOpacity(finaleSinceS) : 0,
        },
      )
      clock.book('komposition')
      await video.add(i / fps, 1 / fps, { keyFrame: i % fps === 0 })
      clock.book('encode')
      clock.frames++
    }
    console.info(
      'Video-Export, Wandzeit je Bild (ms):',
      clock.perFrame(),
      'Nachladen:',
      waiting.reloaded,
    )
    video.close()
    await output.finalize()
    const buffer = target.buffer
    if (!buffer) {
      report('fehler', 'Muxer lieferte keine Datei.')
      return
    }
    const name = fileName(run.title, format)
    if (run.report) {
      // Der Rahmen lädt NICHT selbst herunter: Ein Klick auf „Speichern" im
      // Studio soll auch dann noch gehen, wenn die Download-Leiste des
      // Browsers längst weg ist. Der Puffer wandert übergeben, nicht kopiert.
      run.report(
        {
          type: EXPORT_MESSAGE,
          status: 'fertig',
          frame: n,
          frames: n,
          clipS: durationS,
          fileName: name,
          data: buffer,
        },
        [buffer],
      )
    } else {
      download(buffer, name)
      report('fertig', 'Fertig. Datei liegt im Download.')
    }
  } catch (err) {
    try {
      await output.cancel()
    } catch {
      /* schon tot */
    }
    const message = err instanceof Error ? err.message : String(err)
    report('fehler', `Export gescheitert: ${message}`)
    console.error('Video-Export:', err)
  } finally {
    try {
      await guard?.release()
    } catch {
      /* ignorieren */
    }
  }
}

/** Kleines Stand-Schild über der Karte. Fortschritt während des Encodes. */
export function buildExportStatus(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'film-export-status'
  el.setAttribute('role', 'status')
  el.textContent = 'Export startet …'
  document.body.appendChild(el)
  return el
}
