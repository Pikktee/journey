// Die Leinwand der Foto-Karte — der eine Aufrufer des Malers.
//
// Sie tut drei Dinge und nichts sonst: Sie hält die Leinwand in der richtigen
// Größe, sie ruft `paintCard` pro Frame, und sie schiebt die DOM-Bedienung auf
// die Rechtecke, die der Maler zurückgibt.
//
// Sie trägt seit „Eine Bühne, ein Maler" BEIDE Bildschirm-Bühnen: den Player am
// `body` und die Vorschau des Editors über der Karten-Bühne. Verschieden sind
// nur der Bühnen-Satz (Maße, Lage, Flugweite — `cardStageSet` im Maler) und die
// Bedienung: Die Editor-Karte hat keine Knöpfe, also entfällt dort der
// aufwendigste Teil, die mitgeführten Klickflächen.
//
// Der letzte Punkt ist der, den man leicht unterschätzt (Konzept, Falle 5):
// „Klick: anhalten / weiterlaufen", der Ton-Knopf des Videos und „Weiter ▸"
// bleiben DOM — es sind Knöpfe, keine Bildinhalte, und sie haben im Film nichts
// zu suchen (§3.3). Ihre Flächen sind deshalb MITGEFÜHRT und kein statischer
// Kasten: Sie müssen mitwandern, wenn die Karte springt, weil die Bedienung
// erscheint oder verschwindet.
//
// Der Schleier gehört ausdrücklich NICHT hierher. Er bleibt eine DOM-Schicht mit
// `backdrop-filter` UNTER der Leinwand (§4): Auf einer Leinwand hat er kein
// Gegenstück, und der naheliegende Ausweg über einen eingefrorenen Puffer trägt
// nicht — dafür bräuchte es `preserveDrawingBuffer` im Normalbetrieb, und das
// Wetter läuft im Halt weiter.

import { mapPixelRatio } from './map.js'
import {
  CURVE,
  paintCard,
  clearCardBuffers,
  type CardStageName,
  type CardRects,
  type CardMedium,
  type CardSource,
  type CardText,
} from './card-painter.js'

export interface CardControls {
  /** Die Klickfläche der Karte (anhalten / weiterlaufen). */
  card: HTMLElement
  /** Der Bildbereich — trägt Ton-Knopf und „Angehalten"-Abzeichen. */
  image: HTMLElement
}

export interface CardLayerState {
  inS: number
  durationS: number
  medium: CardMedium
  text: CardText
  source: CardSource | null
  ready: boolean
}

export interface CardLayer {
  /** Ein Bild dieser Filmsekunde. */
  paint(frame: CardLayerState): void
  /** Leinwand leeren und die Bedienung wegnehmen. */
  clear(): void
  /**
   * Stand der letzten Zeichnung: Hat der Maler das Bild wirklich bekommen?
   *
   * Der Video-Export fragt danach, statt zu encodieren — `drawImage` auf einem
   * noch suchenden `<video>` zeichnet ohne Fehler das ALTE Bild, und am
   * Bildschirm fällt das nicht auf (Konzept §5, „Bild und Video").
   */
  ready(): boolean
  rects(): CardRects | null
  /**
   * Der Stand, der zuletzt gemalt wurde — Abnahme-Griff wie die übrigen
   * `window.__maptale`. Was auf der Leinwand steht, liegt sonst nirgends im DOM: Ein
   * Seiten-Screenshot zeigt das Bild, aber nicht die Werte, aus denen es kommt
   * (scripts/messungen/kartenleinwand.mjs braucht genau die).
   */
  frame(): CardLayerState | null
  destroy(): void
}

/**
 * `prefers-reduced-motion` wird EINMAL hier gelesen und als Schalter
 * weitergegeben — der Maler darf die Umgebung nicht selbst befragen (Falle 2).
 * Im Export ist der Schalter immer aus: Die Einstellung des rendernden Rechners
 * hätte sonst Einfluss auf die ausgelieferte Datei.
 */
function readCalm(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export interface CardLayerOptions {
  /** Wohin die Leinwand gehängt wird — Player: `body`, Editor: die Karten-Bühne. */
  container: HTMLElement
  /**
   * Die DOM-Knöpfe, die auf den Rechtecken des Malers mitgeführt werden.
   *
   * Fehlen sie, hat diese Bühne keine Bedienung (Editor) — dann entfällt auch
   * die Frage, ob eine Steuerleiste steht, und mit ihr der Klassen-Beobachter.
   */
  controls?: CardControls | null
  /** Welcher Bühnen-Satz gilt (Vorgabe `player`). */
  stage?: CardStageName
  /**
   * Wohin `--scrim-opacity` geschrieben wird — der Schleier UNTER der Leinwand.
   *
   * Er bleibt DOM (`backdrop-filter` hat auf einer Leinwand kein Gegenstück),
   * aber seine Deckkraft hängt seit dem Rückbau des Kamerablitzes an der
   * FILMZEIT: Sie ist die der Karte, also kommt er über den Flug hoch und geht
   * mit dem Abgang wieder weg — rückwärts wie vorwärts und beim Scrubben. Eine
   * Custom Property und kein `style.opacity`, weil der Schleier im Editor ein
   * `::after` ist: Ein Pseudo-Element nimmt keine Inline-Stile, seinen HOST
   * kann man dagegen beschriften.
   */
  scrim?: HTMLElement | null
  /** Im Video-Export: flacher Schleier, keine Leiste, kein Reduced-Motion. */
  inExport?: boolean
  /** `id` der Leinwand — der Export holt sie darüber (`zeichneOverlay`). */
  id?: string
}

export function createCardLayer(opts: CardLayerOptions): CardLayer {
  const { container } = opts
  const controls = opts.controls ?? null
  const scrim = opts.scrim ?? null
  const inExport = opts.inExport === true
  const stageName = opts.stage ?? 'player'
  const canvas = document.createElement('canvas')
  canvas.id = opts.id ?? 'card'
  canvas.className = 'card-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Karten-Leinwand: kein 2D-Kontext')

  const calm = inExport ? false : readCalm()
  let width = 0
  let height = 0
  let density = mapPixelRatio()
  let lastRects: CardRects | null = null
  let lastFrame: CardLayerState | null = null
  let lastReady = true
  let painted = false
  /**
   * Steht Outfit? (Falle 3 des Karten-Konzepts.)
   *
   * `ctx.font` scheitert LEISE: Ist die Schrift noch nicht geladen, nimmt der
   * Kontext klaglos die Rückfallschrift und meldet nichts. Am Bildschirm wäre
   * das ein kurzer Moment — hier ist es dauerhaft, weil Titel, Unterschrift und
   * Pillen GEPUFFERT werden (Falle 9) und ihr Schlüssel den Schriftzustand nicht
   * kennt: Einmal mit der Rückfallschrift gebacken, bliebe es bis zum nächsten
   * `raeumeKartenPuffer` dabei, also bis zum nächsten Resize. Und im FILM stünde
   * es für immer in der Datei.
   *
   * Deshalb zwei Dinge: Sind die Schriften da, werden die Puffer verworfen und
   * einmal neu gezeichnet; und bis dahin meldet `bereit()` `false`, sodass der
   * Export wartet — dieselbe Bremse, die er für einen noch suchenden Video-Frame
   * hat (film-export.ts, höchstens ein paar Bilder). Ohne `document.fonts` (alte
   * Browser) gilt sofort „bereit": Eine Zusicherung, die es nicht gibt, darf den
   * Lauf nicht aufhalten.
   */
  let fontReady = typeof document.fonts?.ready?.then !== 'function'

  /**
   * Die Fläche, die die Schicht bedeckt — gemessen an dem, was sie VORGIBT, nie
   * am Canvas selbst: `messe` schreibt `canvas.width`, und daraus zu lesen wäre
   * eine Rückkopplung (dieselbe Falle wie in weather.ts).
   */
  const area = (): { w: number; h: number } => {
    if (getComputedStyle(canvas).position === 'fixed') {
      return { w: window.innerWidth, h: window.innerHeight }
    }
    const r = container.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  const measure = (): void => {
    density = mapPixelRatio()
    const f = area()
    const b = Math.max(1, Math.round(f.w))
    const h = Math.max(1, Math.round(f.h))
    if (b === width && h === height && canvas.width === Math.round(b * density)) return
    width = b
    height = h
    canvas.width = Math.round(b * density)
    canvas.height = Math.round(h * density)
    ctx.setTransform(density, 0, 0, density, 0, 0)
    // Jede gepufferte Fassung hängt an der Kartengeometrie, und die ändert sich
    // mit der Bühne. Die Schlüssel tragen die Maße, alte Puffer würden also nur
    // Speicher halten.
    clearCardBuffers()
    painted = false
  }

  /**
   * Steht die Steuerleiste? Nur am Bildschirm — im Film gibt es keine Leiste, und
   * die Einstellung des rendernden Rechners gehört nicht in die Datei (§5). Auf
   * einer Bühne ohne Bedienung gibt es nichts, dem die Karte Platz machen müsste.
   */
  const controlsTarget = (): number =>
    inExport || !controls ? 0 : document.body.classList.contains('ui-clean') ? 0 : 1

  /**
   * Der GEFAHRENE Anteil — die Karte wächst und schrumpft, statt umzuspringen.
   *
   * Das ist bewusst eine WANDUHR-Bewegung und kein Widerspruch zur Regel, dass
   * im Film alles an der Filmzeit hängt: Sie gehört nicht dem Film, sondern der
   * Bedienung. Im Export ist das Ziel fest 0, dort bewegt sich nichts.
   *
   * Dauer und Kurve sind DIE DER LEISTE: `.dock`, `.exit-pill` und `.next-stop`
   * blenden mit `transition: … 0.5s ease` (style.css), und `ease` ist
   * `KURVE.ease` im Maler. Damit ist es EINE Geste — die Leiste kommt, die Karte
   * macht ihr Platz — und nicht zwei Bewegungen, die zufällig zugleich
   * stattfinden. Eine exponentielle Glättung stand hier zuerst und war
   * asymptotisch: Sie sah nach 0,33 s fertig aus und kroch dann noch ein Drittel
   * einer Sekunde nach, also gerade so lange, dass es sich nicht mehr wie
   * dieselbe Bewegung anfühlte.
   */
  const CONTROLS_DURATION_MS = 500
  let controlsNow = controlsTarget()
  let controlsFrom = controlsNow
  let controlsTo = controlsNow
  let controlsT0 = 0
  let controlsRaf = 0
  let lastPaintedAt = 0

  const wipe = (): void => {
    if (!painted) return
    ctx.clearRect(0, 0, width, height)
    painted = false
  }

  /** Ein Rechteck des Malers auf ein DOM-Element — in CSS-Pixeln der Bühne. */
  const place = (
    el: HTMLElement,
    r: { x: number; y: number; width: number; height: number } | null,
    opacity: number,
  ): void => {
    if (!r) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      return
    }
    el.style.left = `${r.x.toFixed(1)}px`
    el.style.top = `${r.y.toFixed(1)}px`
    el.style.width = `${r.width.toFixed(1)}px`
    el.style.height = `${r.height.toFixed(1)}px`
    el.style.opacity = opacity.toFixed(3)
    el.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none'
  }

  /**
   * Die Deckkraft des Schleiers — dieselbe wie die der Karte.
   *
   * Er hing bis zum Rückbau des Kamerablitzes an einer Klasse mit 0,8-s-
   * Transition, also an der WANDUHR: Beim Scrubben durch einen Halt blieb er
   * hinter der Karte zurück, rückwärts kam er gar nicht mit. Die Klasse
   * (`body.cinema` / `.foto-an`) schaltet seither nur noch den FILTER —
   * ein bildschirmfüllender `backdrop-filter`, der dauernd stünde, wäre auf
   * schwachen Geräten der teuerste Posten der Seite.
   */
  const placeScrim = (opacity: number): void => {
    scrim?.style.setProperty('--scrim-opacity', opacity.toFixed(3))
  }

  const clearControls = (): void => {
    if (!controls) return
    place(controls.card, null, 0)
    place(controls.image, null, 0)
  }

  const draw = (frame: CardLayerState): void => {
    ctx.clearRect(0, 0, width, height)
    painted = true
    lastPaintedAt = performance.now()
    const result = paintCard(
      ctx,
      {
        width: width,
        height: height,
        name: stageName,
        controls: controlsNow,
        calm: calm,
        // Der Bildschirm hat den Schleier als DOM-Schicht darunter; der Film
        // komponiert selbst und bekommt die flache Füllung (§4).
        scrim: inExport ? 'flat' : 'off',
      },
      frame,
    )
    lastRects = result.rects
    lastReady = result.ready && fontReady
    placeScrim(result.rects?.opacity ?? 0)
    if (!controls) return
    if (!result.rects) return clearControls()
    const m = result.rects
    place(controls.card, m.card, m.opacity)
    place(controls.image, m.image, m.opacity)
    controls.image.style.setProperty('--card-scale', m.scale.toFixed(3))
  }

  /**
   * Die Bühne hat sich geändert — neu zeichnen, auch wenn der Film STEHT.
   *
   * Das ist der Unterschied zwischen einer Leinwand und dem CSS, das sie ersetzt:
   * Eine Custom Property zeichnete sich von selbst neu, eine Leinwand nicht. Zwei
   * Fälle, die dadurch beide kaputt waren und am Screenshot auffielen:
   *
   *   · Der Auto-Rückzug der UI (`body.ui-clean`) kippt oft im angehaltenen
   *     Halt — dort läuft kein Kopfschritt, die Karte behielt die alte Größe und
   *     die Steuerleiste deckte ihre Bildunterschrift zu. Genau der Defekt, gegen
   *     den `--photo-chrome` einmal eingeführt wurde.
   *   · Ein Fenster-Resize schreibt `canvas.width` und LÖSCHT die Leinwand damit.
   *     Ohne Neuzeichnen wäre die Karte bis zum nächsten Kopfschritt weg.
   */
  const redraw = (): void => {
    if (lastFrame) draw(lastFrame)
  }

  /**
   * Den Anteil auf sein Ziel fahren, solange er nicht dort ist.
   *
   * Gezeichnet wird nur, wenn es im laufenden Bild noch niemand getan hat: Läuft
   * der Film, ruft er ohnehin jeden Frame `male()`, und ein zweites Kartenbild
   * je Frame kostete die Bewegung über 0,3 s doppelt. Steht er (Halt, Pause),
   * ist diese Schleife die einzige, die zeichnet — und ohne sie bliebe die Karte
   * auf ihrer alten Größe stehen, während die Leiste kommt.
   */
  const runControls = (): void => {
    const target = controlsTarget()
    if (target === controlsTo || !lastFrame) return
    // Ab dem STAND losfahren, nicht ab dem alten Ziel: Wer die Maus bewegt,
    // während die Karte noch schrumpft, bekommt sonst einen Sprung zurück.
    controlsFrom = controlsNow
    controlsTo = target
    controlsT0 = performance.now()
    if (controlsRaf) return
    const step = (now: number): void => {
      controlsRaf = 0
      const p = Math.max(0, Math.min(1, (now - controlsT0) / CONTROLS_DURATION_MS))
      controlsNow = controlsFrom + (controlsTo - controlsFrom) * CURVE.ease(p)
      // Nur zeichnen, wenn es im laufenden Bild noch niemand getan hat: Läuft
      // der Film, ruft er ohnehin jeden Frame `male()`, und ein zweites
      // Kartenbild je Frame kostete die halbe Sekunde doppelt. Steht er (Halt,
      // Pause), ist diese Schleife die einzige, die zeichnet — und ohne sie
      // bliebe die Karte auf ihrer alten Größe stehen, während die Leiste kommt.
      if (now - lastPaintedAt > 8) redraw()
      if (p < 1 && lastFrame) controlsRaf = requestAnimationFrame(step)
    }
    controlsRaf = requestAnimationFrame(step)
  }

  const stopControls = (): void => {
    if (controlsRaf) cancelAnimationFrame(controlsRaf)
    controlsRaf = 0
    controlsTo = controlsNow
  }

  measure()

  // Outfit abwarten und die mit der Rückfallschrift gebackenen Textpuffer
  // wegwerfen (s. `schriftBereit`). Genau EINMAL: `document.fonts.ready` löst
  // auf, wenn die Schriften des aktuellen Layouts stehen.
  if (!fontReady) {
    void document.fonts.ready
      .then(() => {
        fontReady = true
        clearCardBuffers()
        redraw()
      })
      .catch(() => {
        // Sagt der Browser nichts zu, darf das den Lauf nicht anhalten.
        fontReady = true
      })
  }

  const onResize = () => {
    measure()
    redraw()
  }
  window.addEventListener('resize', onResize)
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
  sizeObserver?.observe(container)

  // Der Rückzug der UI ist eine Klasse am body und kein Ereignis. Ein Beobachter
  // und kein Griff für main.ts: Ein Aufrufer, der ihn vergisst, wäre genau der
  // Fehler, den es hier schon einmal gab. Ohne Bedienung gibt es nichts zu
  // beobachten — der Editor bekäme sonst einen Beobachter auf eine Klasse, die
  // auf seiner Seite niemand setzt.
  let lastControls = controlsTarget()
  const classObserver =
    controls && typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          const now = controlsTarget()
          if (now === lastControls) return
          lastControls = now
          runControls()
        })
      : null
  classObserver?.observe(document.body, { attributes: true, attributeFilter: ['class'] })

  return {
    paint(frame) {
      const firstCard = !lastFrame
      lastFrame = frame
      // Eine Karte, die gerade erst auf die Bühne kommt, fliegt nicht auch noch
      // in ihre Größe: Sie beginnt bei dem Anteil, der GILT. Gefahren wird nur,
      // was sich ändert, während sie liegt.
      if (firstCard) {
        stopControls()
        controlsNow = controlsTarget()
        controlsTo = controlsNow
      } else runControls()
      measure()
      draw(frame)
    },
    clear() {
      wipe()
      stopControls()
      lastFrame = null
      lastRects = null
      lastReady = true
      controlsNow = controlsTarget()
      controlsTo = controlsNow
      placeScrim(0)
      clearControls()
    },
    ready: () => lastReady,
    rects: () => lastRects,
    frame: () => lastFrame,
    destroy() {
      stopControls()
      window.removeEventListener('resize', onResize)
      sizeObserver?.disconnect()
      classObserver?.disconnect()
      clearCardBuffers()
      canvas.remove()
    },
  }
}
