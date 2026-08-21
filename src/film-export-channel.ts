/**
 * Video-Export: Formate, Clip-Zeit und Dateiname.
 *
 * DOM-frei. Player und Studio lesen dieselben Zahlen, der Encoder liegt in
 * film-export.ts. Tempo-Wahl und Share-Achse gehören nicht hierher.
 */

/**
 * Wählbare Bildraten. 24 ist der Kino-Takt (der Film wirkt getragener), 30 die
 * Vorgabe für den Versand, 50/60 die flüssige Variante.
 *
 * Die Bildrate ist eine reine ABTASTUNG: Alle Glättungen der Kamera rechnen
 * `1 − exp(−dt/τ)`, die exakte Lösung bei konstantem Ziel — bei 60 fps kommt
 * dieselbe Bewegung heraus, nur doppelt so oft gemessen. Filmlänge, Halte und
 * Rampen ändern sich dadurch nicht.
 *
 * Was sich sehr wohl ändert, ist die WARTEZEIT: 98 % der Wandzeit ist das
 * Warten auf Kacheln, und das fällt je BILD an. 60 fps kostet also grob das
 * Doppelte von 30.
 */
export const EXPORT_FPS_CHOICES = [24, 30, 50, 60] as const
export type ExportFps = (typeof EXPORT_FPS_CHOICES)[number]
/** Vorgabe und zugleich der Wert, bei dem der Dateiname nichts dazusagt. */
export const EXPORT_FPS = 30
/** Relive-Muster: Quellen stehen im Abspann, nicht dauerhaft im Bild. */
export const EXPORT_ATTRIBUTION_S = 2
export const EXPORT_ATTRIBUTION_FADE_S = 0.4
/**
 * Intro-Orbit vor der Fahrt. Der Player wartet auf den Start-Klick; der Film
 * braucht eine feste Länge. Langsam wie die Bühne, kurz genug als Auftakt.
 */
export const EXPORT_INTRO_S = 6
/** Finale-Orbit, nur wenn die Tour einen Endscreen hat. */
export const EXPORT_FINALE_S = 6

export type ExportOrientation = 'landscape' | 'portrait'
export type ExportSize = 720 | 1080

export interface ExportFormat {
  orientation: ExportOrientation
  size: ExportSize
  fps: ExportFps
}

export const EXPORT_DEFAULT: ExportFormat = { orientation: 'landscape', size: 720, fps: EXPORT_FPS }

/** Wie lange die Startscreen-Tafel in die Fahrt hinein ausblendet (Player: 1,2 s). */
export const EXPORT_INTRO_FADE_S = 1.2
/** Einblendung der „Ziel erreicht"-Tafel (Player: 0,9 s). */
export const EXPORT_FINALE_FADE_S = 0.9

export type ExportPhase = 'intro' | 'fahrt' | 'finale'

/**
 * Deckkraft der Startscreen-Tafel. Voll während des Intro-Orbits, dann blendet
 * sie in die anfahrende Kamera hinein aus — genau wie der Klick auf „Tour
 * starten" im Player.
 */
export function introPanelOpacity(
  clipS: number,
  introS = EXPORT_INTRO_S,
  fadeS = EXPORT_INTRO_FADE_S,
): number {
  if (clipS < introS) return 1
  if (fadeS <= 0) return 0
  return Math.max(0, 1 - (clipS - introS) / fadeS)
}

/** Deckkraft der Finale-Tafel aus der Zeit SEIT dem Phasenwechsel. */
export function finalePanelOpacity(sinceS: number, fadeS = EXPORT_FINALE_FADE_S): number {
  if (!(sinceS >= 0)) return 0
  if (fadeS <= 0) return 1
  return Math.min(1, sinceS / fadeS)
}

export interface ExportViewport {
  width: number
  height: number
}

const SIZES = new Set<ExportSize>([720, 1080])

export function isExportOrientation(v: string): v is ExportOrientation {
  return v === 'landscape' || v === 'portrait'
}

export function isExportSize(v: number): v is ExportSize {
  return SIZES.has(v as ExportSize)
}

export function isExportFps(v: number): v is ExportFps {
  return (EXPORT_FPS_CHOICES as readonly number[]).includes(v)
}

export function parseExportFormat(search: string): ExportFormat {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const orientationRaw = q.get('orientation') ?? ''
  const sizeRaw = Number.parseInt(q.get('size') ?? '', 10)
  const fpsRaw = Number.parseInt(q.get('fps') ?? '', 10)
  return {
    orientation: isExportOrientation(orientationRaw) ? orientationRaw : EXPORT_DEFAULT.orientation,
    size: isExportSize(sizeRaw) ? sizeRaw : EXPORT_DEFAULT.size,
    fps: isExportFps(fpsRaw) ? fpsRaw : EXPORT_DEFAULT.fps,
  }
}

/** Query für den Player-Dev-Weg und das Studio-Blatt. Immer vollständig. */
export function exportQuery(format: ExportFormat, embedded = false): string {
  const q = new URLSearchParams()
  q.set('export', '1')
  q.set('orientation', format.orientation)
  q.set('size', String(format.size))
  q.set('fps', String(format.fps))
  if (embedded) q.set('embedded', '1')
  return `?${q}`
}

/**
 * Der Kanal zwischen Renderer und Studio.
 *
 * Der Export läuft seit dem Studio-Blatt in einem gleich-origin `iframe` im
 * Studio-Tab, nicht mehr in einem zweiten Tab. Das ist nicht nur Bequemlichkeit:
 * Der Tab, den der Nutzer ansieht, ist der Studio-Tab — ein zweiter Tab wäre
 * verdeckt, und ein verdeckter Tab bekommt kaum noch Bilder (Falle 8). Der
 * Rahmen muss dabei GEZEICHNET werden; `display: none` oder `visibility:
 * hidden` liefern keinen WebGL-Inhalt, deshalb steht er sichtbar als kleine
 * Vorschau über dem Balken statt versteckt hinter ihm.
 */
export const EXPORT_MESSAGE = 'maptale:export'

export type ExportProgress = 'start' | 'laeuft' | 'pause' | 'fertig' | 'fehler'

export interface ExportMessage {
  type: typeof EXPORT_MESSAGE
  status: ExportProgress
  /** Schon fertige Bilder. */
  frame?: number
  frames?: number
  /** Filmlänge in Sekunden. */
  clipS?: number
  /** Satz für die Oberfläche (Fehlergrund, „Ton mischen …"). */
  text?: string
  fileName?: string
  data?: ArrayBuffer
}

export function isEmbedded(search: string): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return q.get('embedded') === '1'
}

/**
 * Restzeit aus dem bisherigen Tempo. Bewusst aus der GESAMTEN verstrichenen
 * Zeit und nicht aus den letzten Bildern: Das Tempo schwankt je nach Kacheln
 * um ein Vielfaches, und eine Restzeit, die zwischen „2 Minuten" und „20
 * Minuten" springt, ist keine Auskunft.
 */
export function remainingS(done: number, total: number, elapsedS: number): number | null {
  if (done < 12 || elapsedS <= 0 || total <= done) return null
  return ((total - done) * elapsedS) / done
}

/** „noch etwa 4 Minuten", „noch keine Minute". Für den Balken, nicht für Logs. */
export function remainingText(seconds: number | null): string {
  if (seconds == null) return 'Restzeit wird geschätzt'
  if (seconds < 60) return 'noch keine Minute'
  const min = Math.round(seconds / 60)
  if (min < 60) return `noch etwa ${min} Minute${min === 1 ? '' : 'n'}`
  const hrs = Math.round(seconds / 3600)
  return `noch etwa ${hrs} Stunde${hrs === 1 ? '' : 'n'}`
}

export function exportViewport(format: ExportFormat): ExportViewport {
  const short = format.size
  const long = format.size === 720 ? 1280 : 1920
  return format.orientation === 'portrait'
    ? { width: short, height: long }
    : { width: long, height: short }
}

/**
 * 720p darf 1,5× zeichnen (1080p-Framebuffer, unter 5 MP). 1080p nicht
 * zusätzlich mit 2× hochziehen (Konzept-Falle 7).
 */
export function exportPixelRatio(format: ExportFormat): number {
  return format.size === 720 ? 1.5 : 1
}

/**
 * Wie lang der Film wird. Die PHASEN kommen nicht von hier: Ob der Orbit
 * läuft, ein Halt steht oder das Finale beginnt, weiß seit dem Takt-Umbau die
 * Engine (`Tour.exportSchritt`). Eine zweite Phasenrechnung daneben war genau
 * die Sorte Zweitkopie, die still auseinanderläuft.
 */
export function exportClipDurationS(rideS: number, hasFinale: boolean): number {
  if (!(rideS > 0)) return 0
  return EXPORT_INTRO_S + rideS + (hasFinale ? EXPORT_FINALE_S : 0)
}

export function frameCount(durationS: number, fps: number): number {
  return Math.max(1, Math.round(durationS * fps))
}

/** Clip-Zeit des Frames: `i / fps`, geklemmt auf die Filmdauer. */
export function filmTimeAtFrame(i: number, fps: number, totalS: number): number {
  return Math.min(totalS, i / fps)
}

/** Filmzeit als „m:ss", ab einer Stunde „h:mm:ss". */
export function formatClipTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  if (mm < 60) return `${mm}:${ss}`
  return `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}`
}

export function progressText(clipS: number, i: number, n: number): string {
  return `${formatClipTime(clipS)} · Frame ${i} von ${n}`
}

/** Stand-Text, solange der Tab verdeckt ist. `fertig` = schon encodete Frames. */
export function pausedText(clipS: number, done: number, n: number): string {
  if (done <= 0) return `Pausiert. Tab wieder öffnen · ${formatClipTime(clipS)}`
  return `Pausiert. Tab wieder öffnen · ${progressText(clipS, done, n)}`
}

function titleSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tour'
  )
}

/**
 * Die Bildrate steht nur im Namen, wenn sie von der Vorgabe abweicht: Der
 * Regelfall behält seinen gewohnten Namen, und zwei Fassungen derselben Tour
 * überschreiben einander trotzdem nicht.
 */
export function fileName(title: string, format: ExportFormat = EXPORT_DEFAULT): string {
  const rate = format.fps === EXPORT_FPS ? '' : `-${format.fps}fps`
  return `maptale-${titleSlug(title)}-${format.orientation}-${format.size}${rate}.mp4`
}

/**
 * Deckkraft der Pflicht-Attribution. 0 während der Fahrt, 1 in den letzten
 * `EXPORT_ATTRIBUTION_S` Sekunden, mit kurzem Fade.
 */
export function attributionOpacity(
  filmS: number,
  clipS: number,
  durationS = EXPORT_ATTRIBUTION_S,
  fadeS = EXPORT_ATTRIBUTION_FADE_S,
): number {
  if (!(clipS > 0) || durationS <= 0) return 0
  const from = Math.max(0, clipS - durationS)
  if (filmS < from) return 0
  if (fadeS <= 0) return 1
  return Math.min(1, (filmS - from) / fadeS)
}

export interface LoopSegment {
  src: string
  fromClipS: number
  toClipS: number
  gain: number
}

/**
 * Aufeinanderfolgende Frames mit derselben Quelle zu Abschnitten ziehen.
 * `srcBei(i)` liefert die Spur des Frames `i`, oder null für Stille.
 */
export function mergeSegments(
  n: number,
  dt: number,
  srcAt: (i: number) => { src: string; gain: number } | null,
): LoopSegment[] {
  const out: LoopSegment[] = []
  let open: LoopSegment | null = null
  for (let i = 0; i < n; i++) {
    const now = srcAt(i)
    const t = i * dt
    if (!now) {
      if (open) {
        open.toClipS = t
        out.push(open)
        open = null
      }
      continue
    }
    if (open && open.src === now.src && Math.abs(open.gain - now.gain) < 0.02) {
      continue
    }
    if (open) {
      open.toClipS = t
      out.push(open)
    }
    open = { src: now.src, fromClipS: t, toClipS: (i + 1) * dt, gain: now.gain }
  }
  if (open) {
    open.toClipS = n * dt
    out.push(open)
  }
  return out
}
