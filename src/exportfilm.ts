/**
 * Video-Export: Encoder und Komposition.
 *
 * Ganze Tour in Player-Tempo, Intro/Fahrt/Finale, Bild und Ton wie der Player.
 * Formate und Clip-Zeit stehen in exportformat.ts (DOM-frei, geteilt mit Studio).
 * mediabunny kommt erst im Lauf, per dynamischem Import.
 */

import type { Map as MapLibreKarte } from 'maplibre-gl'
import {
  EXPORT_INTRO_S,
  attributionSicht,
  clipDauerS,
  dateiname,
  exportViewport,
  filmSBeiFrame,
  finaleTafelSicht,
  introTafelSicht,
  formatiereClipzeit,
  fortschrittText,
  pauseText,
  frameAnzahl,
  EXPORT_NACHRICHT,
  type ExportFormat,
  type ExportMeldung,
  type ExportStand,
} from './exportformat.js'
import { quellenAlsEinbrand, sammleQuellen, type Datenquelle } from './karteninfo.js'
import { hatBereich, loopAktiv, musikVersatzS, type SpielSpur } from './audiotracks.js'
import type { Tour } from './tour.js'

export {
  EXPORT_ATTRIBUTION_FADE_S,
  EXPORT_ATTRIBUTION_S,
  EXPORT_FINALE_S,
  EXPORT_FPS,
  EXPORT_FPS_WAHL,
  EXPORT_INTRO_S,
  EXPORT_VORGABE,
  istExportFps,
  attributionSicht,
  clipDauerS,
  dateiname,
  exportPixelRatio,
  exportQuery,
  exportViewport,
  istEingebettet,
  restzeitS,
  restzeitText,
  filmSBeiFrame,
  finaleTafelSicht,
  formatiereClipzeit,
  fortschrittText,
  introTafelSicht,
  pauseText,
  frameAnzahl,
  leseExportFormat,
  verdichteAbschnitte,
  EXPORT_NACHRICHT,
} from './exportformat.js'
export type {
  ExportFps,
  ExportMeldung,
  ExportStand,
  ExportFormat,
  ExportGroesse,
  ExportLage,
  ExportPhase,
  ExportViewport,
  LoopAbschnitt,
} from './exportformat.js'

/** Marker auf 720p: etwas über dem Player-Puck (36 px), kein Ballon. */
export const EXPORT_REITER_PX = 40
/**
 * Walk liegt im Player bei 0,5. Aus der Distanz sind Esri-Kacheln scharf,
 * darunter wird das Satellitenbild zur Fläche. Export nicht näher als ~Rad.
 */
export const EXPORT_SKALA_MIN = 0.9

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

export function attributionAusKarte(
  sources: Record<string, { attribution?: string | undefined } | undefined>,
  extra: readonly Datenquelle[] = [],
): string {
  return quellenAlsEinbrand(sammleQuellen(sources, extra))
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

function warteBisSichtbar(): Promise<void> {
  if (!document.hidden) return Promise.resolve()
  return new Promise((resolve) => {
    const weiter = () => {
      if (document.hidden) return
      document.removeEventListener('visibilitychange', weiter)
      resolve()
    }
    document.addEventListener('visibilitychange', weiter)
    if (!document.hidden) weiter()
  })
}

async function pausiereWennVerdeckt(
  melde: (stand: ExportStand, text: string, frame?: number) => void,
  clipS: number,
  fertig: number,
  n: number,
): Promise<boolean> {
  if (!document.hidden) return false
  melde('pause', pauseText(clipS, fertig, n), fertig)
  await warteBisSichtbar()
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
const WARTEN_MAX_MS = 120
const WARTEN_MIN_MS = 30

class Kachelwarten {
  pauseMs = WARTEN_MAX_MS
  /** Wie oft die Pause wieder auf den vollen Wert musste. Abnahme-Zähler. */
  nachgeladen = 0

  async frame(map: MapLibreKarte): Promise<void> {
    await naechstesBild()
    await warteMs(this.pauseMs)
    if (map.areTilesLoaded()) {
      this.pauseMs = Math.max(WARTEN_MIN_MS, Math.round(this.pauseMs * 0.75))
      await naechstesBild()
      return
    }
    this.nachgeladen++
    this.pauseMs = WARTEN_MAX_MS
    await warteIdle(map, 6000)
    if (!map.areTilesLoaded()) await warteIdle(map, 4000)
    await naechstesBild()
  }
}

/**
 * Wo die Wandzeit hingeht. Kein Profiler-Ersatz, sondern die vier Posten, die
 * sich überhaupt unterscheiden lassen — und der Beleg dafür, dass eine
 * Optimierung an der richtigen greift (`window.__j.exportMess`).
 */
export class Frameuhr {
  readonly posten: Record<string, number> = {
    engine: 0,
    kacheln: 0,
    komposition: 0,
    encode: 0,
  }
  frames = 0
  private t0 = 0

  start(): void {
    this.t0 = performance.now()
  }

  buche(posten: string): void {
    const jetzt = performance.now()
    this.posten[posten] = (this.posten[posten] ?? 0) + (jetzt - this.t0)
    this.t0 = jetzt
  }

  /** Millisekunden je Bild, gerundet — das ist die Zahl, die man vergleicht. */
  jeBild(): Record<string, number> {
    const n = Math.max(1, this.frames)
    const aus: Record<string, number> = {}
    for (const [k, v] of Object.entries(this.posten)) aus[k] = Math.round((v / n) * 10) / 10
    return aus
  }
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

/**
 * Sprite-Vorrat je Fortbewegungsmittel.
 *
 * Vorher wurde EIN Sprite vor der Schleife gebacken. `emitStats` schaltete das
 * Icon des DOM-Markers brav um, aber im Film blieb bis zum Ende das Symbol des
 * ersten Modus stehen — der Verkehrsmittelwechsel war unsichtbar. Gebacken
 * wird beim ersten Auftreten eines Modus, danach aus dem Vorrat.
 */
export function reiterVorrat(marker: ExportReiter, seite: number) {
  const gebacken = new Map<string, HTMLCanvasElement>()
  return async (modus: string): Promise<HTMLCanvasElement> => {
    const da = gebacken.get(modus)
    if (da) return da
    const neu = await backeReiter(marker, seite)
    gebacken.set(modus, neu)
    return neu
  }
}

async function backeReiter(marker: ExportReiter, seite: number): Promise<HTMLCanvasElement> {
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
  seite: number,
): void {
  const p = map.project(marker.getLngLat())
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
 * Die Spur bleibt die der KARTE.
 *
 * Bis hierher zeichnete der Export eine eigene Linie über `map.project()`.
 * Die kennt das Gelände nicht und verbindet die Stützpunkte roh — die Spur
 * wirkte kantiger und gröber als im Player, und sie lag über dem Wetter statt
 * darunter. Die nativen Layer sind gedrapt und geglättet; im Film bekommt nur
 * die gepunktete Vorschau etwas mehr Gewicht, weil 2,4 px gestrichelt aus der
 * Filmkamera verschwinden (Konzept-Falle 11). Dieselben Layer, andere Zahlen.
 */
function verstaerkeKartenSpur(map: MapLibreKarte, faktor: number): void {
  const setze = (id: string, name: string, wert: unknown): void => {
    try {
      map.setPaintProperty(id, name as never, wert as never)
    } catch {
      /* Layer kann fehlen */
    }
  }
  setze('route-full', 'line-width', 3.2 * faktor)
  setze('route-full', 'line-color', 'rgba(255,255,255,0.72)')
  setze('route-full', 'line-dasharray', [0.6, 1.9])
  setze('route-glow', 'line-width', 13 * faktor)
  setze('route-glow-tip', 'line-width', 13 * faktor)
  setze('route-progress', 'line-width', 5.6 * faktor)
  setze('route-tip', 'line-width', 5.6 * faktor)
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
  return el?.textContent?.trim() ?? ''
}

function zeichneScrim(ctx: CanvasRenderingContext2D, b: number, h: number, staerke: number): void {
  const g = ctx.createRadialGradient(b / 2, h * 0.44, 0, b / 2, h * 0.44, Math.max(b, h) * 0.75)
  g.addColorStop(0, `rgba(6, 9, 14, ${0.62 * staerke})`)
  g.addColorStop(1, `rgba(5, 8, 12, ${0.94 * staerke})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, b, h)
}

function zeichneMitte(ctx: CanvasRenderingContext2D, zeile: string, b: number, y: number): void {
  ctx.fillText(zeile, b / 2, y)
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
export function zeichneIntroTafel(
  ctx: CanvasRenderingContext2D,
  b: number,
  h: number,
  sicht: number,
): void {
  if (sicht <= 0.02) return
  const e = Math.min(b, h) / 720 // Maße sind auf 720p ausgemessen
  const titel = (document.getElementById('intro-title')?.innerHTML ?? '')
    .split(/<br\s*\/?>/i)
    .map((z) => z.replace(/<[^>]*>/g, '').trim())
    .filter(Boolean)
  const kicker = text('intro-kicker')
  const route = text('intro-route')
  // Eine Zeile statt drei Pillen. Der schmale Zwischenraum um das Trennzeichen
  // ist Absicht: „0,4 km · 11 hm" liest sich als eine Angabe, mit normalen
  // Leerzeichen zerfiele die Zeile in drei.
  const zahlen = ['chip-distance', 'chip-gain', 'chip-photos'].map(text).filter(Boolean).join('  ·  ')

  ctx.save()
  ctx.globalAlpha = sicht
  zeichneScrim(ctx, b, h, 1)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const laengste = Math.max(1, ...titel.map((z) => z.length))
  const titelPx = Math.min(96 * e, (b * 0.82) / (laengste * 0.54))
  const zeilenH = titelPx * 1.02
  const block = 30 * e + titel.length * zeilenH + 46 * e + (route ? 24 * e : 0) + (zahlen ? 30 * e : 0)
  let y = h / 2 - block / 2 + 8 * e

  ctx.font = `500 ${13.5 * e}px Outfit, system-ui, sans-serif`
  ctx.fillStyle = tokenFarbe('--akzent', '#f5a524')
  if (kicker) zeichneMitte(ctx, kicker, b, y)
  y += 24 * e + zeilenH / 2

  ctx.fillStyle = tokenFarbe('--text', '#f2ede3')
  ctx.font = `600 ${titelPx}px Outfit, system-ui, sans-serif`
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 40 * e
  ctx.shadowOffsetY = 6 * e
  for (const zeile of titel) {
    zeichneMitte(ctx, zeile, b, y)
    y += zeilenH
  }
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  y += zeilenH * -0.5 + 34 * e

  ctx.fillStyle = tokenFarbe('--akzent', '#f5a524')
  ctx.globalAlpha = sicht * 0.85
  ctx.fillRect(b / 2 - 38 * e, y, 76 * e, Math.max(1, e))
  ctx.globalAlpha = sicht
  y += 26 * e

  if (route) {
    ctx.font = `500 ${13.5 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenFarbe('--text-gedaempft', 'rgba(242,237,227,0.62)')
    zeichneMitte(ctx, route, b, y)
    y += 30 * e
  }

  if (zahlen) {
    ctx.font = `500 ${13.5 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenFarbe('--text', '#f2ede3')
    ctx.globalAlpha = sicht * 0.9
    zeichneMitte(ctx, zahlen, b, y)
  }
  ctx.restore()
}

/** „Ziel erreicht": Glaskarte mit Titel und den drei Kennzahlen. */
export function zeichneFinaleTafel(
  ctx: CanvasRenderingContext2D,
  b: number,
  h: number,
  sicht: number,
): void {
  if (sicht <= 0.02) return
  const e = Math.min(b, h) / 720
  const kicker = document.querySelector('.finale-kicker')?.textContent?.trim() ?? 'Ziel erreicht'
  const titel = text('finale-title')
  const werte: Array<[string, string]> = [
    ['Distanz', text('final-km')],
    ['Höhenmeter', text('final-gain')],
    ['Fotos', text('final-photos')],
  ].filter((z) => z[1]) as Array<[string, string]>

  ctx.save()
  ctx.globalAlpha = sicht
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${48 * e}px Outfit, system-ui, sans-serif`
  const spalte = 120 * e
  const karteW = Math.max(ctx.measureText(titel).width + 112 * e, werte.length * spalte + 32 * e)
  const karteH = (werte.length ? 214 : 150) * e
  const x = b / 2 - karteW / 2
  const y = h / 2 - karteH / 2

  ctx.fillStyle = tokenFarbe('--glas', 'rgba(18, 22, 28, 0.72)')
  ctx.strokeStyle = tokenFarbe('--glas-rand', 'rgba(255,255,255,0.14)')
  ctx.lineWidth = Math.max(1, e)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 60 * e
  ctx.beginPath()
  ctx.roundRect(x, y, karteW, karteH, 22 * e)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.stroke()

  let cy = y + 42 * e
  ctx.font = `500 ${13 * e}px Outfit, system-ui, sans-serif`
  ctx.fillStyle = tokenFarbe('--akzent', '#f5a524')
  zeichneMitte(ctx, kicker, b, cy)
  cy += 16 * e + 27 * e
  ctx.font = `600 ${48 * e}px Outfit, system-ui, sans-serif`
  ctx.fillStyle = tokenFarbe('--text', '#f2ede3')
  zeichneMitte(ctx, titel, b, cy)
  cy += 27 * e + 46 * e

  const links = b / 2 - ((werte.length - 1) * spalte) / 2
  werte.forEach(([label, wert], i) => {
    const cx = links + i * spalte
    ctx.font = `500 ${12 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenFarbe('--text-gedaempft', 'rgba(242,237,227,0.62)')
    ctx.fillText(label, cx, cy)
    ctx.font = `600 ${24 * e}px Outfit, system-ui, sans-serif`
    ctx.fillStyle = tokenFarbe('--text', '#f2ede3')
    ctx.fillText(wert, cx, cy + 26 * e)
  })
  ctx.restore()
}

export interface FrameTafeln {
  intro: number
  finale: number
}

function komponiereFrame(
  ziel: HTMLCanvasElement,
  map: MapLibreKarte,
  attribution: string,
  reiter: ExportReiter | undefined,
  sprite: HTMLCanvasElement | null,
  reiterPx: number,
  attribSicht: number,
  tafeln: FrameTafeln,
): void {
  const ctx = ziel.getContext('2d')
  if (!ctx) throw new Error('Ziel-Canvas ohne 2D-Kontext.')
  // Reihenfolge wie die Schichtung der Seite: Karte (mit ihrer Spur), darüber
  // Atmosphäre und Wetter, dann was im DOM darüber liegt.
  ctx.drawImage(map.getCanvas(), 0, 0, ziel.width, ziel.height)
  zeichneOverlay(ctx, 'atmosphere', ziel.width, ziel.height)
  zeichneOverlay(ctx, 'weather', ziel.width, ziel.height)
  if (reiter && sprite) zeichneReiter(ctx, map, reiter, sprite, reiterPx)
  zeichneFotoKarte(ctx, ziel.width, ziel.height)
  zeichneIntroTafel(ctx, ziel.width, ziel.height, tafeln.intro)
  zeichneFinaleTafel(ctx, ziel.width, ziel.height, tafeln.finale)
  zeichneAttribution(ctx, attribution, ziel.width, ziel.height, attribSicht)
}

function setzeStand(el: HTMLElement, text: string): void {
  el.textContent = text
}

/**
 * Ein Ort für „wie weit ist der Film". Schreibt aufs Stand-Schild (eigener
 * Tab) UND meldet nach draußen (Rahmen im Studio) — beides aus denselben
 * Zahlen, damit die zwei Oberflächen nicht auseinanderlaufen.
 */
function baueMelder(lauf: ExportLauf, clipS: number, frames: number) {
  return (stand: ExportStand, text: string, frame = 0): void => {
    if (lauf.stand) setzeStand(lauf.stand, text)
    lauf.melde?.({ typ: EXPORT_NACHRICHT, stand, frame, frames, clipS, text })
  }
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

export interface ExportTonKlip {
  src: string
  vonClipS: number
  bisClipS: number
  dateiVonS: number
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
  blendeS?: number
}

export interface ExportTonSchuss {
  src: string
  beiClipS: number
  gain: number
}

export interface ExportTon {
  klips: ExportTonKlip[]
  schuesse: ExportTonSchuss[]
}

export interface ExportLauf {
  map: MapLibreKarte
  tour: Tour
  titel: string
  format: ExportFormat
  stand?: HTMLElement
  /**
   * Fortschritt nach draußen. Gesetzt, wenn der Lauf in einem Rahmen im
   * Studio steckt: Dann gibt es kein Stand-Schild, sondern einen Balken im
   * Studio-Blatt, und die fertige Datei geht als Puffer dorthin — der Nutzer
   * soll sie auch nach einer weggeklickten Download-Leiste noch bekommen.
   */
  melde?: (m: ExportMeldung, uebergabe?: Transferable[]) => void
  extraQuellen?: readonly Datenquelle[]
  reiter?: ExportReiter
  hoehenBereit?: Promise<unknown>
  ton?: ExportTon
  /**
   * Overlays für den Film scharf machen: Gates auf „läuft", Canvases neu
   * messen, Wetter und Atmosphäre auf EXTERNEN Takt (s. `taktOverlays`).
   */
  vorbereitenOverlays?: () => void
  /**
   * Ein Filmbild der Overlays. Ohne diesen Griff liefen Partikel, Böen und die
   * Wetter-Blende auf der Wanduhr weiter — im Export sind das 0,3–2 s je
   * Filmbild, und zwar jedes Mal andere.
   */
  taktOverlays?: (dt: number) => void
  /** Nach jedem Kamerasprung: Wetter der Stelle anwenden. */
  nachKamera?: () => void
}

const MOTOR_SRC: Record<string, string> = {
  moped: '/audio/eng-moped.mp3',
  jeep: '/audio/eng-jeep.mp3',
  ferry: '/audio/eng-boat.mp3',
}
/** Wie `createVehicle({ volume: 0.2 })` im Player. */
export const MOTOR_GAIN = 0.2
const WETTER_SRC: Record<string, { src: string; gain: number }> = {
  rain: { src: '/audio/rain.mp3', gain: 0.4 },
  storm: { src: '/audio/storm.mp3', gain: 0.5 },
  snow: { src: '/audio/wind.mp3', gain: 0.26 },
}

export function motorQuelle(mode: string): string | null {
  return MOTOR_SRC[mode] ?? null
}

export function wetterQuelle(mode: string, k: number): { src: string; gain: number } | null {
  const basis = WETTER_SRC[mode]
  if (!basis) return null
  return { src: basis.src, gain: basis.gain * (0.4 + 0.6 * Math.max(0, Math.min(1, k))) }
}

/** Studio-Spuren auf Clip-Zeit (Intro davor, Finale danach, dort stumm wie im Player). */
export function tonKlipsAusSpuren(
  spuren: readonly SpielSpur[],
  introS: number,
  fahrtS: number,
  master: number,
): { klips: ExportTonKlip[]; schuesse: ExportTonSchuss[] } {
  const klips: ExportTonKlip[] = []
  const schuesse: ExportTonSchuss[] = []
  for (const spur of spuren) {
    const gain = master * (spur.gain ?? 1)
    if (hatBereich(spur)) {
      const von = introS + Math.max(0, spur.filmVonS)
      const bis = introS + Math.min(fahrtS, spur.filmBisS)
      if (bis <= von) continue
      klips.push({
        src: spur.src,
        vonClipS: von,
        bisClipS: bis,
        dateiVonS: musikVersatzS(Math.max(0, -spur.filmVonS), 0, spur.startS ?? 0, loopAktiv(spur)),
        loop: loopAktiv(spur),
        gain,
      })
    } else if (spur.filmVonS >= 0 && spur.filmVonS < fahrtS) {
      schuesse.push({ src: spur.src, beiClipS: introS + spur.filmVonS, gain })
    }
  }
  return { klips, schuesse }
}

async function ladePuffer(src: string): Promise<AudioBuffer | null> {
  try {
    const antwort = await fetch(src)
    if (!antwort.ok) return null
    const ctx = new AudioContext()
    const voll = await ctx.decodeAudioData(await antwort.arrayBuffer())
    await ctx.close()
    return voll
  } catch {
    return null
  }
}

/**
 * Mix aus filmS, nicht aus dem Live-Graphen. Der Encode stepped, die Wanduhr
 * der Player-Elemente stünde woanders als der Frame.
 */
async function mischeTon(ton: ExportTon, clipS: number): Promise<AudioBuffer | null> {
  const srcs = new Set<string>()
  for (const k of ton.klips) srcs.add(k.src)
  for (const s of ton.schuesse) srcs.add(s.src)
  if (!srcs.size || !(clipS > 0)) return null
  const puffer = new Map<string, AudioBuffer>()
  await Promise.all(
    [...srcs].map(async (src) => {
      const b = await ladePuffer(src)
      if (b) puffer.set(src, b)
    }),
  )
  if (!puffer.size) return null
  const rate = [...puffer.values()][0]!.sampleRate
  const laenge = Math.max(1, Math.round(clipS * rate))
  const offline = new OfflineAudioContext(2, laenge, rate)
  const startKlip = (k: ExportTonKlip, buf: AudioBuffer): void => {
    const src = offline.createBufferSource()
    src.buffer = buf
    src.loop = k.loop
    if (k.loop) {
      src.loopStart = 0
      src.loopEnd = buf.duration
    }
    const g = offline.createGain()
    const pegel = Math.max(0, Math.min(1, k.gain))
    src.connect(g)
    g.connect(offline.destination)
    const offset = Math.max(0, Math.min(buf.duration, k.dateiVonS))
    const when = Math.max(0, k.vonClipS)
    const dauer = Math.max(0.02, k.bisClipS - k.vonClipS)
    // Blende höchstens über die halbe Abschnittslänge, sonst überlappen sich
    // Ein- und Ausblendung und der Abschnitt erreicht seinen Pegel nie.
    const blende = Math.min(k.blendeS ?? 0, dauer / 2)
    if (blende > 0.01) {
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(pegel, when + blende)
      g.gain.setValueAtTime(pegel, when + dauer - blende)
      g.gain.linearRampToValueAtTime(0, when + dauer)
    } else {
      g.gain.value = pegel
    }
    try {
      src.start(when, offset)
      src.stop(when + dauer)
    } catch {
      /* Start hinter dem Ende: ignorieren */
    }
  }
  for (const k of ton.klips) {
    const buf = puffer.get(k.src)
    if (buf) startKlip(k, buf)
  }
  for (const s of ton.schuesse) {
    const buf = puffer.get(s.src)
    if (!buf) continue
    startKlip(
      {
        src: s.src,
        vonClipS: s.beiClipS,
        bisClipS: Math.min(clipS, s.beiClipS + buf.duration),
        dateiVonS: 0,
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
export async function fuehreExportAus(lauf: ExportLauf): Promise<void> {
  const stand = lauf.stand
  const fahrtS = lauf.tour.film.gesamtS
  if (!(fahrtS > 0)) {
    if (stand) setzeStand(stand, 'Die Tour hat keine Filmdauer.')
    lauf.melde?.({ typ: EXPORT_NACHRICHT, stand: 'fehler', text: 'Die Tour hat keine Filmdauer.' })
    return
  }
  const format = lauf.format
  const vp = exportViewport(format)
  // Die Bildrate ist eine reine ABTASTUNG (s. `EXPORT_FPS_WAHL`): Sie bestimmt,
  // wie oft die Filmzeit gemessen wird, nicht wie der Film abläuft. Deshalb
  // hängt alles im selben Atemzug daran — Bildzahl, Engine-Schritt,
  // Overlay-Takt, Zeitstempel und die Bildrate der Spur.
  const fps = format.fps
  const dauerS = clipDauerS(fahrtS, lauf.tour.showFinale)
  const n = frameAnzahl(dauerS, fps)
  const melde = baueMelder(lauf, dauerS, n)
  const dtFrame = 1 / fps
  lauf.map.resize()
  try {
    lauf.map.setPaintProperty('satellite', 'raster-fade-duration', 0)
  } catch {
    /* Layer-Name kann fehlen */
  }
  lauf.vorbereitenOverlays?.()
  await pausiereWennVerdeckt(melde, dauerS, 0, n)

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
    width: vp.breite,
    height: vp.hoehe,
    quality: QUALITY_HIGH,
  })
  if (codec !== 'avc') {
    melde('fehler', 'H.264 fehlt in diesem Browser. In Chrome oder Safari öffnen.')
    return
  }

  const ziel = document.createElement('canvas')
  ziel.width = vp.breite
  ziel.height = vp.hoehe
  // Abnahme-Griff wie die übrigen `window.__j`: Was der Encoder sieht, ist
  // sonst nirgends im DOM — ein Seiten-Screenshot zeigt Reiter, Foto-Karte und
  // die Tafeln gerade NICHT, weil die auf diese Leinwand gezeichnet werden.
  Object.assign((window as unknown as { __j?: Record<string, unknown> }).__j ?? {}, {
    exportZiel: ziel,
  })
  const reiterPx = Math.round(EXPORT_REITER_PX * (Math.min(vp.breite, vp.hoehe) / 720))

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
  output.addVideoTrack(video, { frameRate: fps })

  let audioQuelle: InstanceType<typeof AudioBufferSource> | null = null
  let tonPuffer: AudioBuffer | null = null
  if (lauf.ton && (lauf.ton.klips.length || lauf.ton.schuesse.length)) {
    const aac = await getFirstEncodableAudioCodec(['aac'])
    if (aac === 'aac') {
      melde('start', 'Ton mischen …')
      tonPuffer = await mischeTon(lauf.ton, dauerS)
    }
    if (tonPuffer) {
      audioQuelle = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
      output.addAudioTrack(audioQuelle)
    }
  }

  await output.start()
  if (audioQuelle && tonPuffer) {
    await audioQuelle.add(tonPuffer)
    audioQuelle.close()
  }

  const holeWache = async (): Promise<WakeLockSentinel | null> => {
    try {
      return (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      return null
    }
  }
  let wache: WakeLockSentinel | null = await holeWache()

  const holeSprite = lauf.reiter ? reiterVorrat(lauf.reiter, reiterPx) : null

  try {
    await pausiereWennVerdeckt(melde, dauerS, 0, n)
    wache = (await holeWache()) ?? wache
    melde('start', `Film ${formatiereClipzeit(dauerS)}. Kacheln laden …`)
    if (lauf.hoehenBereit) {
      // Nicht mitten im Loop ankommen: sampleElevations schreibt die
      // Wegpunkt-Höhen in-place, die Kamera würde dann hart absacken.
      await Promise.race([lauf.hoehenBereit, warteMs(20000)])
    }
    verstaerkeKartenSpur(lauf.map, Math.min(vp.breite, vp.hoehe) / 720)
    // Ab hier taktet der Encoder. `tick` läuft weiter, rührt die Kamera aber
    // nicht mehr an — sonst drehte die Wanduhr den Intro-Orbit mit.
    lauf.tour.exportTakt = true
    lauf.tour.exportSkalaMin = EXPORT_SKALA_MIN
    // Ein paar Bilder einschwingen (die DEM-Kacheln kommen erst jetzt an),
    // danach den Orbit-Winkel zurücksetzen: Der Film beginnt bei seinem Anfang.
    const orbitStart = lauf.tour.orbitA
    for (let k = 0; k < 30; k++) lauf.tour.exportSchritt(dtFrame)
    lauf.tour.orbitA = orbitStart
    await warteMs(400)
    const warten = new Kachelwarten()
    const uhr = new Frameuhr()
    Object.assign((window as unknown as { __j?: Record<string, unknown> }).__j ?? {}, {
      exportMess: () => ({ ...uhr.jeBild(), frames: uhr.frames, pauseMs: warten.pauseMs, nachgeladen: warten.nachgeladen }),
    })
    await warten.frame(lauf.map)

    let finaleSeitS = -1
    for (let i = 0; i < n; i++) {
      if (await pausiereWennVerdeckt(melde, dauerS, i, n)) {
        wache = (await holeWache()) ?? wache
      }
      melde('laeuft', fortschrittText(dauerS, i + 1, n), i + 1)
      uhr.start()
      const t = filmSBeiFrame(i, fps, dauerS)
      // Der Übergang vom Orbit in die Fahrt ist derselbe wie im Player: kein
      // eigener Pfad, sondern der Griff, den auch „Tour starten" bedient.
      if (t >= EXPORT_INTRO_S && lauf.tour.phase === 'intro') lauf.tour.begin()
      lauf.tour.exportSchritt(dtFrame)
      lauf.nachKamera?.()
      lauf.taktOverlays?.(dtFrame)
      // Beim EINTRITT auf 0 und nicht auf −1 + dt: sonst stünde die Tafel eine
      // Sekunde lang bei „noch nicht sichtbar", und von sechs Finale-Sekunden
      // wären zwei vertan.
      finaleSeitS =
        lauf.tour.phase === 'finale' ? (finaleSeitS < 0 ? 0 : finaleSeitS + dtFrame) : -1
      uhr.buche('engine')
      await warten.frame(lauf.map)
      if (await pausiereWennVerdeckt(melde, dauerS, i, n)) {
        wache = (await holeWache()) ?? wache
        await warten.frame(lauf.map)
      }
      uhr.buche('kacheln')
      const sprite = holeSprite ? await holeSprite(lauf.tour.modeAt(lauf.tour.s).mode) : null
      komponiereFrame(
        ziel,
        lauf.map,
        attribution,
        lauf.reiter,
        sprite,
        reiterPx,
        attributionSicht(t, dauerS),
        {
          intro: introTafelSicht(t),
          finale: finaleSeitS >= 0 ? finaleTafelSicht(finaleSeitS) : 0,
        },
      )
      uhr.buche('komposition')
      await video.add(i / fps, 1 / fps, { keyFrame: i % fps === 0 })
      uhr.buche('encode')
      uhr.frames++
    }
    console.info('Video-Export, Wandzeit je Bild (ms):', uhr.jeBild(), 'Nachladen:', warten.nachgeladen)
    video.close()
    await output.finalize()
    const buffer = target.buffer
    if (!buffer) {
      melde('fehler', 'Muxer lieferte keine Datei.')
      return
    }
    const name = dateiname(lauf.titel, format)
    if (lauf.melde) {
      // Der Rahmen lädt NICHT selbst herunter: Ein Klick auf „Speichern" im
      // Studio soll auch dann noch gehen, wenn die Download-Leiste des
      // Browsers längst weg ist. Der Puffer wandert übergeben, nicht kopiert.
      lauf.melde(
        { typ: EXPORT_NACHRICHT, stand: 'fertig', frame: n, frames: n, clipS: dauerS, dateiname: name, daten: buffer },
        [buffer],
      )
    } else {
      ladeHerunter(buffer, name)
      melde('fertig', 'Fertig. Datei liegt im Download.')
    }
  } catch (err) {
    try {
      await output.cancel()
    } catch {
      /* schon tot */
    }
    const meldung = err instanceof Error ? err.message : String(err)
    melde('fehler', `Export gescheitert: ${meldung}`)
    console.error('Video-Export:', err)
  } finally {
    try {
      await wache?.release()
    } catch {
      /* ignorieren */
    }
  }
}

/** Kleines Stand-Schild über der Karte. Fortschritt während des Encodes. */
export function baueExportStand(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'export-stand'
  el.setAttribute('role', 'status')
  el.textContent = 'Export startet …'
  document.body.appendChild(el)
  return el
}

