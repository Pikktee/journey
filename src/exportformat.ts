/**
 * Video-Export: Formate, Clip-Zeit und Dateiname.
 *
 * DOM-frei. Player und Studio lesen dieselben Zahlen, der Encoder liegt in
 * exportfilm.ts. Tempo-Wahl und Share-Achse gehören nicht hierher.
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
export const EXPORT_FPS_WAHL = [24, 30, 50, 60] as const
export type ExportFps = (typeof EXPORT_FPS_WAHL)[number]
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

export type ExportLage = 'quer' | 'hoch'
export type ExportGroesse = 720 | 1080

export interface ExportFormat {
  lage: ExportLage
  groesse: ExportGroesse
  fps: ExportFps
}

export const EXPORT_VORGABE: ExportFormat = { lage: 'quer', groesse: 720, fps: EXPORT_FPS }

/** Wie lange die Startscreen-Tafel in die Fahrt hinein ausblendet (Player: 1,2 s). */
export const EXPORT_INTRO_BLENDE_S = 1.2
/** Einblendung der „Ziel erreicht"-Tafel (Player: 0,9 s). */
export const EXPORT_FINALE_BLENDE_S = 0.9

export type ExportPhase = 'intro' | 'fahrt' | 'finale'

/**
 * Deckkraft der Startscreen-Tafel. Voll während des Intro-Orbits, dann blendet
 * sie in die anfahrende Kamera hinein aus — genau wie der Klick auf „Tour
 * starten" im Player.
 */
export function introTafelSicht(
  clipS: number,
  introS = EXPORT_INTRO_S,
  blendeS = EXPORT_INTRO_BLENDE_S,
): number {
  if (clipS < introS) return 1
  if (blendeS <= 0) return 0
  return Math.max(0, 1 - (clipS - introS) / blendeS)
}

/** Deckkraft der Finale-Tafel aus der Zeit SEIT dem Phasenwechsel. */
export function finaleTafelSicht(seitS: number, blendeS = EXPORT_FINALE_BLENDE_S): number {
  if (!(seitS >= 0)) return 0
  if (blendeS <= 0) return 1
  return Math.min(1, seitS / blendeS)
}

export interface ExportViewport {
  breite: number
  hoehe: number
}

const GROESSEN = new Set<ExportGroesse>([720, 1080])

export function istExportLage(v: string): v is ExportLage {
  return v === 'quer' || v === 'hoch'
}

export function istExportGroesse(v: number): v is ExportGroesse {
  return GROESSEN.has(v as ExportGroesse)
}

export function istExportFps(v: number): v is ExportFps {
  return (EXPORT_FPS_WAHL as readonly number[]).includes(v)
}

export function leseExportFormat(search: string): ExportFormat {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const lageRoh = q.get('lage') ?? ''
  const groesseRoh = Number.parseInt(q.get('groesse') ?? '', 10)
  const fpsRoh = Number.parseInt(q.get('fps') ?? '', 10)
  return {
    lage: istExportLage(lageRoh) ? lageRoh : EXPORT_VORGABE.lage,
    groesse: istExportGroesse(groesseRoh) ? groesseRoh : EXPORT_VORGABE.groesse,
    fps: istExportFps(fpsRoh) ? fpsRoh : EXPORT_VORGABE.fps,
  }
}

/** Query für den Player-Dev-Weg und das Studio-Blatt. Immer vollständig. */
export function exportQuery(format: ExportFormat, eingebettet = false): string {
  const q = new URLSearchParams()
  q.set('export', '1')
  q.set('lage', format.lage)
  q.set('groesse', String(format.groesse))
  q.set('fps', String(format.fps))
  if (eingebettet) q.set('rahmen', '1')
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
export const EXPORT_NACHRICHT = 'maptale:export'

export type ExportStand = 'start' | 'laeuft' | 'pause' | 'fertig' | 'fehler'

export interface ExportMeldung {
  typ: typeof EXPORT_NACHRICHT
  stand: ExportStand
  /** Schon fertige Bilder. */
  frame?: number
  frames?: number
  /** Filmlänge in Sekunden. */
  clipS?: number
  /** Satz für die Oberfläche (Fehlergrund, „Ton mischen …"). */
  text?: string
  dateiname?: string
  daten?: ArrayBuffer
}

export function istEingebettet(search: string): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return q.get('rahmen') === '1'
}

/**
 * Restzeit aus dem bisherigen Tempo. Bewusst aus der GESAMTEN verstrichenen
 * Zeit und nicht aus den letzten Bildern: Das Tempo schwankt je nach Kacheln
 * um ein Vielfaches, und eine Restzeit, die zwischen „2 Minuten" und „20
 * Minuten" springt, ist keine Auskunft.
 */
export function restzeitS(fertig: number, gesamt: number, verstrichenS: number): number | null {
  if (fertig < 12 || verstrichenS <= 0 || gesamt <= fertig) return null
  return ((gesamt - fertig) * verstrichenS) / fertig
}

/** „noch etwa 4 Minuten", „noch keine Minute". Für den Balken, nicht für Logs. */
export function restzeitText(sekunden: number | null): string {
  if (sekunden == null) return 'Restzeit wird geschätzt'
  if (sekunden < 60) return 'noch keine Minute'
  const min = Math.round(sekunden / 60)
  if (min < 60) return `noch etwa ${min} Minute${min === 1 ? '' : 'n'}`
  const std = Math.round(sekunden / 3600)
  return `noch etwa ${std} Stunde${std === 1 ? '' : 'n'}`
}

export function exportViewport(format: ExportFormat): ExportViewport {
  const kurz = format.groesse
  const lang = format.groesse === 720 ? 1280 : 1920
  return format.lage === 'hoch' ? { breite: kurz, hoehe: lang } : { breite: lang, hoehe: kurz }
}

/**
 * 720p darf 1,5× zeichnen (1080p-Framebuffer, unter 5 MP). 1080p nicht
 * zusätzlich mit 2× hochziehen (Konzept-Falle 7).
 */
export function exportPixelRatio(format: ExportFormat): number {
  return format.groesse === 720 ? 1.5 : 1
}

/**
 * Wie lang der Film wird. Die PHASEN kommen nicht von hier: Ob der Orbit
 * läuft, ein Halt steht oder das Finale beginnt, weiß seit dem Takt-Umbau die
 * Engine (`Tour.exportSchritt`). Eine zweite Phasenrechnung daneben war genau
 * die Sorte Zweitkopie, die still auseinanderläuft.
 */
export function clipDauerS(fahrtS: number, hatFinale: boolean): number {
  if (!(fahrtS > 0)) return 0
  return EXPORT_INTRO_S + fahrtS + (hatFinale ? EXPORT_FINALE_S : 0)
}

export function frameAnzahl(dauerS: number, fps: number): number {
  return Math.max(1, Math.round(dauerS * fps))
}

/** Clip-Zeit des Frames: `i / fps`, geklemmt auf die Filmdauer. */
export function filmSBeiFrame(i: number, fps: number, gesamtS: number): number {
  return Math.min(gesamtS, i / fps)
}

/** Filmzeit als „m:ss", ab einer Stunde „h:mm:ss". */
export function formatiereClipzeit(sekunden: number): string {
  const s = Math.max(0, Math.round(sekunden))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  if (mm < 60) return `${mm}:${ss}`
  return `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}`
}

export function fortschrittText(clipS: number, i: number, n: number): string {
  return `${formatiereClipzeit(clipS)} · Frame ${i} von ${n}`
}

/** Stand-Text, solange der Tab verdeckt ist. `fertig` = schon encodete Frames. */
export function pauseText(clipS: number, fertig: number, n: number): string {
  if (fertig <= 0) return `Pausiert. Tab wieder öffnen · ${formatiereClipzeit(clipS)}`
  return `Pausiert. Tab wieder öffnen · ${fortschrittText(clipS, fertig, n)}`
}

function titelSlug(titel: string): string {
  return (
    titel
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
export function dateiname(titel: string, format: ExportFormat = EXPORT_VORGABE): string {
  const takt = format.fps === EXPORT_FPS ? '' : `-${format.fps}fps`
  return `maptale-${titelSlug(titel)}-${format.lage}-${format.groesse}${takt}.mp4`
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

export interface LoopAbschnitt {
  src: string
  vonClipS: number
  bisClipS: number
  gain: number
}

/**
 * Aufeinanderfolgende Frames mit derselben Quelle zu Abschnitten ziehen.
 * `srcBei(i)` liefert die Spur des Frames `i`, oder null für Stille.
 */
export function verdichteAbschnitte(
  n: number,
  dt: number,
  srcBei: (i: number) => { src: string; gain: number } | null,
): LoopAbschnitt[] {
  const aus: LoopAbschnitt[] = []
  let offen: LoopAbschnitt | null = null
  for (let i = 0; i < n; i++) {
    const jetzt = srcBei(i)
    const t = i * dt
    if (!jetzt) {
      if (offen) {
        offen.bisClipS = t
        aus.push(offen)
        offen = null
      }
      continue
    }
    if (offen && offen.src === jetzt.src && Math.abs(offen.gain - jetzt.gain) < 0.02) {
      continue
    }
    if (offen) {
      offen.bisClipS = t
      aus.push(offen)
    }
    offen = { src: jetzt.src, vonClipS: t, bisClipS: (i + 1) * dt, gain: jetzt.gain }
  }
  if (offen) {
    offen.bisClipS = n * dt
    aus.push(offen)
  }
  return aus
}
