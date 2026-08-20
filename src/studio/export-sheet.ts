/**
 * Studio-Blatt für den Video-Export.
 *
 * Wählt Lage und Größe und rendert DANN IM SELBEN BLATT: Die Export-Seite läuft
 * als gleich-origin `iframe` klein skaliert über dem Fortschrittsbalken, meldet
 * ihren Stand per `postMessage` und schiebt die fertige Datei als Puffer
 * herauf. Der Encoder bleibt drüben in exportfilm.ts, damit MapLibre und
 * mediabunny nicht ins Studio-Bundle wandern — der Rahmen ist genau die
 * Grenze, die das sicherstellt.
 *
 * Warum nicht versteckt: Ein `iframe` mit `display: none` oder `visibility:
 * hidden` wird nicht gezeichnet, und ohne Zeichnen gibt es kein WebGL-Bild zum
 * Greifen. Es MUSS sichtbar sein — also wird aus der Not die Vorschau, und man
 * sieht beim Warten zu, was entsteht.
 *
 * Und warum nicht mehr ein zweiter Tab: Der Tab, den niemand ansieht, bekommt
 * von Chrome kaum noch Bilder. Derselbe Lauf fiel dadurch von ~7 auf ~0,15
 * Bilder je Sekunde (Konzept-Falle 8). Im Studio-Tab ist der Renderer immer der
 * sichtbare.
 */

import {
  EXPORT_FPS_WAHL,
  EXPORT_NACHRICHT,
  EXPORT_VORGABE,
  clipDauerS,
  exportQuery,
  exportViewport,
  formatiereClipzeit,
  istExportFps,
  restzeitS,
  restzeitText,
  type ExportFormat,
  type ExportGroesse,
  type ExportLage,
  type ExportMeldung,
} from '../exportformat.js'
import { tourPfad } from '../routen.js'

export interface ExportSheetTour {
  id: string
  title: string | null
  cover: string | null
  /** Routen-Signatur aus `stats.trackSignature`; fehlt bei Touren vor der Aufbereitung. */
  track?: { d: string; start: [number, number]; end: [number, number] } | null
  /** Länge des FILMS in Sekunden aus `stats.filmS`; fehlt bei Altbestand. */
  filmS?: number | null
  /** Endscreen — er zählt zur Länge der DATEI, s. `clipDauerS`. */
  finale?: boolean | null
}

let backdrop: HTMLElement | null = null
let format: ExportFormat = { ...EXPORT_VORGABE }
let current: ExportSheetTour | null = null
let frame: HTMLIFrameElement | null = null
let observer: ResizeObserver | null = null
let lastWidth = 0
let startMs = 0
let doneFile: { name: string; data: ArrayBuffer } | null = null
let cancelArmed = false

function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel)
  if (!(el instanceof HTMLElement)) throw new Error(`Export-Blatt: ${sel} fehlt.`)
  return el
}

function buildSheet(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'new-backdrop'
  el.id = 'film-export-backdrop'
  el.hidden = true
  el.innerHTML = `
    <div class="new-window film-export-window" role="dialog" aria-modal="true" aria-labelledby="export-titel">
      <div class="new-header">
        <div class="title-block">
          <h2 id="film-export-title">Als Video exportieren<button class="export-info" type="button" aria-label="Was passiert dabei?" aria-describedby="export-tip"><svg aria-hidden="true"><use href="#i-info"/></svg></button></h2>
          <div class="subtitle" id="film-export-subtitle"></div>
        </div>
        <!-- Der Tipp hängt an der KOPFZEILE, nicht am Knopf: Am Knopf lief er
             über den rechten Rand des Blattes und wurde von dessen
             overflow-hidden abgeschnitten. Über die volle Kopfbreite kann das
             nicht passieren. -->
        <div class="export-tip" id="export-tip" role="tooltip">Die ganze Tour, in Player-Tempo. Ein längerer Film braucht entsprechend lange, eine höhere Bildrate ebenso. Verlässt du den Tab, pausiert der Lauf.</div>
      </div>
      <div class="new-body film-export-body">
        <!-- Die BÜHNE hat eine feste Höhe, der Rahmen darin wechselt die Form.
             Vorher änderte der Formatwechsel die Höhe der Vorschau und damit
             die des ganzen Blattes — das sah aus wie ein Fehler, nicht wie
             eine Wahl. -->
        <div class="film-export-stage">
          <div class="film-export-preview" id="film-export-preview">
            <span class="film-export-duration" id="film-export-duration" hidden></span>
          </div>
        </div>
        <div class="film-export-picker">
          <div class="film-export-row">
            <div class="film-export-label">Ausrichtung</div>
            <div class="inspector-buttons" role="radiogroup" aria-label="Ausrichtung">
              <button type="button" data-orientation="quer">Quer</button>
              <button type="button" data-orientation="hoch">Hochkant</button>
            </div>
          </div>
          <div class="film-export-row">
            <div class="film-export-label">Größe</div>
            <div class="inspector-buttons" role="radiogroup" aria-label="Größe">
              <button type="button" data-size="720">720p</button>
              <button type="button" data-size="1080">1080p</button>
            </div>
          </div>
          <div class="film-export-row">
            <div class="film-export-label">Bildrate</div>
            <div class="inspector-buttons" role="radiogroup" aria-label="Bildrate">
              ${EXPORT_FPS_WAHL.map((n) => `<button type="button" data-fps="${n}">${n}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="film-export-run" id="film-export-run" hidden>
          <div class="film-export-bar"><div class="film-export-bar-fill" id="film-export-fill"></div></div>
          <div class="film-export-line">
            <span id="film-export-status">Wird vorbereitet …</span>
            <span id="film-export-remaining" class="film-export-remaining"></span>
          </div>
        </div>
      </div>
      <div class="new-footer">
        <button class="knopf" type="button" data-cancel>Abbrechen</button>
        <button class="knopf-primaer" type="button" data-save hidden>
          <svg aria-hidden="true"><use href="#i-download"/></svg>Speichern
        </button>
        <button class="knopf-primaer" type="button" data-start>
          <svg aria-hidden="true"><use href="#i-film"/></svg>Video erzeugen
        </button>
      </div>
      <!-- Die Rückfrage liegt ÜBER dem Blatt, nicht darin: Im Fluss schob sie
           die Knöpfe nach unten und ließ das Modal wachsen — eine Frage, die
           das Fenster verschiebt, liest sich als Panne. So bleibt die Größe
           exakt gleich, und die Frage nimmt sich trotzdem den ganzen Raum.
           Ein eigener Dialog wäre die Alternative gewesen, brächte aber eine
           zweite Fokusfalle über der ersten. -->
      <div class="film-export-prompt" id="film-export-prompt" hidden>
        <div class="film-export-prompt-card" role="alertdialog" aria-labelledby="export-frage-text">
          <p id="film-export-prompt-text">Der Film ist noch nicht fertig. Brichst du jetzt ab, fängt er beim nächsten Mal von vorn an.</p>
          <div class="film-export-prompt-buttons">
            <button class="knopf" type="button" data-cancel-yes>Ja, abbrechen</button>
            <button class="knopf-primaer" type="button" data-continue>Weiter rendern</button>
          </div>
        </div>
      </div>
    </div>`
  el.addEventListener('click', (e) => {
    // Während des Laufs schließt weder der Klick daneben noch Escape (s.
    // `onEscape`): Ein Fehlgriff kostete sonst Minuten Rechnerei. Beenden
    // kann ihn nur der Knopf, der es auch sagt.
    if (e.target === el && !frame) closeExportSheet()
  })
  $('button[data-start]', el).addEventListener('click', start)
  $('button[data-cancel]', el).addEventListener('click', back)
  $('button[data-continue]', el).addEventListener('click', disarmCancel)
  $('button[data-cancel-yes]', el).addEventListener('click', abort)
  $('button[data-save]', el).addEventListener('click', save)
  el.querySelectorAll<HTMLButtonElement>('[data-orientation]').forEach((b) => {
    b.addEventListener('click', () =>
      setFormat({ ...format, lage: b.dataset.orientation as ExportLage }),
    )
  })
  el.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number.parseInt(b.dataset.size ?? '', 10)
      setFormat({ ...format, groesse: n as ExportGroesse })
    })
  })
  el.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number.parseInt(b.dataset.fps ?? '', 10)
      if (istExportFps(n)) setFormat({ ...format, fps: n })
    })
  })
  document.body.appendChild(el)
  return el
}

function setFormat(n: ExportFormat): void {
  format = n
  if (!backdrop) return
  backdrop.querySelectorAll<HTMLButtonElement>('[data-orientation]').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.orientation === format.lage)
  })
  backdrop.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.size === String(format.groesse))
  })
  backdrop.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.fps === String(format.fps))
  })
  const vp = exportViewport(format)
  const preview = $('#film-export-preview', backdrop)
  preview.classList.toggle('portrait', format.lage === 'hoch')
  preview.style.aspectRatio = `${vp.breite} / ${vp.hoehe}`
  lastWidth = 0 // Formatwechsel ändert das Seitenverhältnis, nicht nur die Breite
  fitFrame()
}

/**
 * Das Standbild zeigt die TOUR, nicht ein Foto daraus.
 *
 * Das Titelbild allein beantwortete die falsche Frage: Fotos sehen einander
 * ähnlich, Routen nicht — und exportiert wird die Route. Deshalb liegt die
 * Routen-Signatur (dieselbe wie auf der Bibliotheks-Kachel) vorn und das
 * Titelbild gedämpft dahinter: Es gibt Ort und Stimmung, ohne mit der Form zu
 * konkurrieren. Fehlt die Signatur (Tour vor der Aufbereitung), bleibt das
 * Bild allein und ungedämpft — ein leerer Kasten wäre der schlechtere Tausch.
 */
function paintPreview(tour: ExportSheetTour): void {
  if (!backdrop) return
  const box = $('#film-export-preview', backdrop)
  const duration = $('#film-export-duration', backdrop)
  box.replaceChildren(duration)
  box.classList.remove('running')
  const track = tour.track ?? null
  box.classList.toggle('with-track', !!track)
  if (tour.cover) {
    const img = document.createElement('img')
    img.src = tour.cover
    img.alt = ''
    box.appendChild(img)
  }
  if (track) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'film-export-track')
    svg.setAttribute('viewBox', '-6 -6 112 112')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML =
      `<path class="line" d="${track.d}"/>` +
      `<circle class="start" cx="${track.start[0]}" cy="${track.start[1]}" r="3.2"/>` +
      `<circle class="end" cx="${track.end[0]}" cy="${track.end[1]}" r="3.2"/>`
    box.appendChild(svg)
  }
  const title = tour.title?.trim() || 'Ohne Titel'
  const filmS = tour.filmS ?? null
  // Genannt wird die Länge der DATEI, nicht die der Fahrt: Intro und Finale
  // sind Teil des Films, und der Balken zählt später gegen dieselbe Zahl.
  // Ohne bekannte Filmlänge lieber nichts als eine geratene — sie ist die
  // Erwartung an Dateigröße und Wartezeit (Altbestand bekommt sie beim
  // nächsten Rendern, wie `track` und `photos`).
  const clipS = filmS && filmS > 0 ? clipDauerS(filmS, tour.finale === true) : 0
  $('#film-export-subtitle', backdrop).textContent = title
  duration.hidden = !(clipS > 0)
  duration.textContent = clipS > 0 ? formatiereClipzeit(clipS) : ''
}

/**
 * Der Rahmen bekommt die volle Export-Größe und wird per `transform` klein
 * gerechnet. Nicht die Breite verkleinern: Der Encoder greift die Leinwand in
 * IHRER Größe, ein 400 px breiter Rahmen lieferte einen 400 px breiten Film.
 * Skaliert wird also nur die Anzeige.
 *
 * Gemessen wird über einen `ResizeObserver` und nicht einmal beim Start: Das
 * Blatt ändert seine Breite mit einer Transition, und eine im falschen Moment
 * genommene Zahl lässt neben der Vorschau einen schwarzen Streifen stehen.
 * Der Vergleich mit dem letzten Wert ist Pflicht — der Observer feuert auch
 * für Änderungen, die keine sind, und jedes Schreiben löst die nächste aus.
 */
function fitFrame(): void {
  if (!backdrop || !frame) return
  const vp = exportViewport(format)
  const stage = $('#film-export-preview', backdrop)
  const width = stage.clientWidth
  if (width < 1 || width === lastWidth) return
  lastWidth = width
  frame.style.width = `${vp.breite}px`
  frame.style.height = `${vp.hoehe}px`
  frame.style.transform = `scale(${width / vp.breite})`
}

/**
 * Die Fußzeile hat vier Zustände, und der linke Knopf trägt in jedem ein
 * anderes Wort: „Abbrechen", solange man noch entscheidet oder es läuft,
 * „Schließen", wenn nichts mehr abzubrechen ist.
 */
function showRun(running: boolean): void {
  if (!backdrop) return
  $('#film-export-run', backdrop).hidden = !running
  $('.film-export-picker', backdrop).hidden = running
  $('#film-export-prompt', backdrop).hidden = true
  cancelArmed = false
  backdrop.querySelector<HTMLButtonElement>('[data-start]')!.hidden = running
  const to = backdrop.querySelector<HTMLButtonElement>('[data-cancel]')!
  to.hidden = false
  to.textContent = 'Abbrechen'
}

/**
 * Den Blickkasten auf die WIRKLICHE Ausdehnung der Route setzen.
 *
 * Der 0..100-Kasten der Signatur ist nicht der Kasten der Route: Eine hohe
 * Route füllt ihn senkrecht und lässt waagerecht Luft, eine breite umgekehrt.
 * Mit dem festen Kasten saß eine hohe Route sichtbar zu tief; erst mit dem
 * eigenen Kasten heißt `xMidYMid` auch mittig.
 *
 * Läuft NACH dem Sichtbarwerden des Blattes: `getBBox()` misst in einem
 * `display: none`-Teilbaum nichts — und `paintPreview` baut die Vorschau,
 * solange der Dialog noch versteckt ist.
 */
function centerTrack(): void {
  if (!backdrop) return
  const svg = backdrop.querySelector('.film-export-track')
  const path = svg?.querySelector('path')
  if (!(svg instanceof SVGSVGElement) || !(path instanceof SVGPathElement)) return
  const b = path.getBBox()
  if (!(b.width > 0) || !(b.height > 0)) return
  // Luft nach der LÄNGEREN Seite, sonst wird eine schmale Route seitlich
  // zugeklebt und eine flache oben und unten.
  const gap = Math.max(b.width, b.height) * 0.14
  svg.setAttribute(
    'viewBox',
    `${b.x - gap} ${b.y - gap} ${b.width + gap * 2} ${b.height + gap * 2}`,
  )
}

/**
 * Gewarnt wird, wo etwas verloren geht — nicht davor.
 *
 * Vor dem Start gibt es nichts zu verlieren: Ein Blatt, das erst einen
 * Hinweis wegklicken lässt, verlangt eine Zusage für eine Handlung ohne
 * Folgen. Ein LAUFENDER Film dagegen ist Minuten Rechnerei, und die sind mit
 * einem Klick weg. Also schärft sich der ABBRUCH, und das Verlassen der Seite
 * fragt der Browser (s. `onLeave`).
 */
function disarmCancel(): void {
  if (!backdrop) return
  cancelArmed = false
  $('#film-export-prompt', backdrop).hidden = true
}

/**
 * Die Rückfrage ist eine FRAGE — also mit zwei Antworten.
 *
 * Sie stand hier zwischenzeitlich mit nur einem Knopf da („Ja, abbrechen"),
 * und wer es sich anders überlegte, hatte keinen Weg zurück: Escape und der
 * Klick daneben sind während des Laufs gesperrt. Die SICHERE Antwort ist
 * dabei die primäre und bekommt den Fokus; der Abbruch bleibt der leise
 * Knopf. Ein zweiter Dialog über dem Blatt wäre die Alternative gewesen —
 * dagegen sprechen die Hauskonvention (der Editor fragt genauso, s.
 * `asksForDeletion`) und eine zweite Fokusfalle über der ersten.
 */
function armCancel(): void {
  if (!backdrop) return
  cancelArmed = true
  $('#film-export-prompt', backdrop).hidden = false
  backdrop.querySelector<HTMLButtonElement>('[data-continue]')!.focus()
}

/**
 * Neu laden und Tab schließen fragt der BROWSER — das ist die einzige Stelle,
 * an der eine Seite das überhaupt kann, und der Nutzer kennt den Kasten.
 * Eigene Oberfläche gibt es dafür nicht: Sie käme zu spät.
 */
function onLeave(e: BeforeUnloadEvent): void {
  e.preventDefault()
  e.returnValue = ''
}

function start(): void {
  if (!current || !backdrop) return
  doneFile = null
  startMs = Date.now()
  showRun(true)
  backdrop.querySelector<HTMLButtonElement>('[data-save]')!.hidden = true
  const stage = $('#film-export-preview', backdrop)
  // Die Dauer-Plakette bleibt STEHEN (im Lauf blendet CSS sie aus): Sie ist
  // ein festes Kind der Bühne, und wer sie hier herauswirft, lässt jedes
  // spätere Öffnen des Blattes an `#film-export-duration` scheitern.
  stage.replaceChildren($('#film-export-duration', backdrop))
  stage.classList.add('running')
  const el = document.createElement('iframe')
  el.className = 'film-export-frame'
  el.setAttribute('title', 'Vorschau des Films, während er entsteht')
  el.src = tourPfad(`srv:${current.id}`) + exportQuery(format, true)
  stage.appendChild(el)
  frame = el
  lastWidth = 0
  window.addEventListener('beforeunload', onLeave)
  fitFrame()
  observer = new ResizeObserver(fitFrame)
  observer.observe(stage)
  window.addEventListener('message', onMessage)
}

/**
 * Der linke Knopf — und er bedeutet zwei Dinge, die sich nicht verwechseln
 * lassen: Läuft ein Film, hält er ihn an; sonst schließt er das Blatt.
 *
 * Das ersetzt das × oben rechts. Solange nichts läuft, meinten beide exakt
 * dasselbe, und ein zweites Bedienelement für dieselbe Sache ist keine
 * Bequemlichkeit, sondern eine Frage mehr. Escape schließt weiterhin.
 */
function back(): void {
  if (frame) armCancel()
  else closeExportSheet()
}

function abort(): void {
  // Den Rahmen wegnehmen beendet den Lauf: Sein JavaScript stirbt mit ihm.
  // Ein „bitte aufhören" nach unten bräuchte einen Abbruchpunkt in jeder
  // Warteschleife und wäre trotzdem nie sofort.
  frame?.remove()
  frame = null
  observer?.disconnect()
  observer = null
  lastWidth = 0
  window.removeEventListener('message', onMessage)
  window.removeEventListener('beforeunload', onLeave)
  if (!backdrop) return
  disarmCancel()
  $('#film-export-preview', backdrop).classList.remove('running')
  showRun(false)
  if (current) paintPreview(current)
}

function onMessage(e: MessageEvent): void {
  if (e.origin !== location.origin || !backdrop) return
  const m = e.data as ExportMeldung | undefined
  if (!m || m.typ !== EXPORT_NACHRICHT) return
  const state = $('#film-export-status', backdrop)
  const rest = $('#film-export-remaining', backdrop)
  const fill = $('#film-export-fill', backdrop)
  const fraction = m.frames && m.frame ? m.frame / m.frames : 0
  fill.style.width = `${Math.round(fraction * 100)}%`

  if (m.stand === 'fertig' && m.daten && m.dateiname) {
    doneFile = { name: m.dateiname, data: m.daten }
    fill.style.width = '100%'
    state.textContent = `Fertig. ${formatiereClipzeit(m.clipS ?? 0)} Film.`
    rest.textContent = ''
    cancelArmed = false
    $('#film-export-prompt', backdrop).hidden = true
    backdrop.querySelector<HTMLButtonElement>('[data-save]')!.hidden = false
    // Der Rahmen ist weg, es gibt nichts mehr abzubrechen — aber einen Weg
    // hinaus braucht es weiterhin, seit das × entfallen ist.
    frame?.remove()
    frame = null
    window.removeEventListener('beforeunload', onLeave)
    backdrop.querySelector<HTMLButtonElement>('[data-cancel]')!.textContent = 'Schließen'
    save() // einmal von selbst; der Knopf bleibt für den zweiten Versuch
    return
  }
  state.textContent = m.text ?? ''
  rest.textContent =
    m.stand === 'laeuft'
      ? restzeitText(restzeitS(m.frame ?? 0, m.frames ?? 0, (Date.now() - startMs) / 1000))
      : ''
  if (m.stand === 'fehler') {
    // Gescheitert heißt: Es läuft nichts mehr. Bliebe der Rahmen stehen,
    // fragte „Abbrechen" für einen toten Lauf nach — und `beforeunload`
    // hielte weiter das Neuladen auf.
    frame?.remove()
    frame = null
    window.removeEventListener('beforeunload', onLeave)
    cancelArmed = false
    $('#film-export-prompt', backdrop).hidden = true
    backdrop.querySelector<HTMLButtonElement>('[data-cancel]')!.textContent = 'Schließen'
  }
}

function save(): void {
  if (!doneFile) return
  const url = URL.createObjectURL(new Blob([doneFile.data], { type: 'video/mp4' }))
  const a = document.createElement('a')
  a.href = url
  a.download = doneFile.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !backdrop || backdrop.hidden) return
  e.stopPropagation()
  if (cancelArmed) {
    // Escape beantwortet die Rückfrage mit „weiter", nie mit „abbrechen":
    // Die Taste soll das Zuletzt-Geöffnete zurücknehmen, nicht Minuten
    // Rechnerei verwerfen.
    disarmCancel()
    return
  }
  if (frame) return // läuft: nur der Knopf beendet ihn
  closeExportSheet()
}

export function closeExportSheet(): void {
  if (!backdrop) return
  abort()
  backdrop.hidden = true
  current = null
  doneFile = null
  document.removeEventListener('keydown', onEscape, true)
}

/** Öffnet das Blatt. Nur für eigene, fertige Touren aufrufen. */
export function openExportSheet(tour: ExportSheetTour): void {
  if (!backdrop) backdrop = buildSheet()
  current = tour
  format = { ...EXPORT_VORGABE }
  setFormat(format)
  paintPreview(tour)
  showRun(false)
  backdrop.querySelector<HTMLButtonElement>('[data-save]')!.hidden = true
  backdrop.hidden = false
  centerTrack()
  document.addEventListener('keydown', onEscape, true)
  backdrop.querySelector<HTMLButtonElement>('button[data-start]')?.focus()
}
