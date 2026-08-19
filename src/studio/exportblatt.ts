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

export interface ExportBlattTour {
  id: string
  title: string | null
  cover: string | null
  /** Routen-Signatur aus `stats.spur`; fehlt bei Touren vor der Aufbereitung. */
  spur?: { d: string; start: [number, number]; ende: [number, number] } | null
  /** Länge des FILMS in Sekunden aus `stats.filmS`; fehlt bei Altbestand. */
  filmS?: number | null
  /** Endscreen — er zählt zur Länge der DATEI, s. `clipDauerS`. */
  finale?: boolean | null
}

let hinter: HTMLElement | null = null
let format: ExportFormat = { ...EXPORT_VORGABE }
let aktuell: ExportBlattTour | null = null
let rahmen: HTMLIFrameElement | null = null
let beobachter: ResizeObserver | null = null
let letzteBreite = 0
let beginnMs = 0
let fertigeDatei: { name: string; daten: ArrayBuffer } | null = null
let abbruchScharf = false

function $(sel: string, wurzel: ParentNode = document): HTMLElement {
  const el = wurzel.querySelector(sel)
  if (!(el instanceof HTMLElement)) throw new Error(`Export-Blatt: ${sel} fehlt.`)
  return el
}

function baueBlatt(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'neu-hinter'
  el.id = 'export-hinter'
  el.hidden = true
  el.innerHTML = `
    <div class="neu-fenster export-fenster" role="dialog" aria-modal="true" aria-labelledby="export-titel">
      <div class="neu-kopf">
        <div class="titelblock">
          <h2 id="export-titel">Als Video exportieren<button class="export-info" type="button" aria-label="Was passiert dabei?" aria-describedby="export-tip"><svg aria-hidden="true"><use href="#i-info"/></svg></button></h2>
          <div class="unter" id="export-unter"></div>
        </div>
        <!-- Der Tipp hängt an der KOPFZEILE, nicht am Knopf: Am Knopf lief er
             über den rechten Rand des Blattes und wurde von dessen
             overflow-hidden abgeschnitten. Über die volle Kopfbreite kann das
             nicht passieren. -->
        <div class="export-tip" id="export-tip" role="tooltip">Die ganze Tour, in Player-Tempo. Ein längerer Film braucht entsprechend lange, eine höhere Bildrate ebenso. Verlässt du den Tab, pausiert der Lauf.</div>
      </div>
      <div class="neu-rumpf export-rumpf">
        <!-- Die BÜHNE hat eine feste Höhe, der Rahmen darin wechselt die Form.
             Vorher änderte der Formatwechsel die Höhe der Vorschau und damit
             die des ganzen Blattes — das sah aus wie ein Fehler, nicht wie
             eine Wahl. -->
        <div class="export-buehne">
          <div class="export-vorschau" id="export-vorschau">
            <span class="export-dauer" id="export-dauer" hidden></span>
          </div>
        </div>
        <div class="export-wahl">
          <div class="export-reihe">
            <div class="export-etikett">Ausrichtung</div>
            <div class="insp-knoepfe" role="radiogroup" aria-label="Ausrichtung">
              <button type="button" data-lage="quer">Quer</button>
              <button type="button" data-lage="hoch">Hochkant</button>
            </div>
          </div>
          <div class="export-reihe">
            <div class="export-etikett">Größe</div>
            <div class="insp-knoepfe" role="radiogroup" aria-label="Größe">
              <button type="button" data-groesse="720">720p</button>
              <button type="button" data-groesse="1080">1080p</button>
            </div>
          </div>
          <div class="export-reihe">
            <div class="export-etikett">Bildrate</div>
            <div class="insp-knoepfe" role="radiogroup" aria-label="Bildrate">
              ${EXPORT_FPS_WAHL.map((n) => `<button type="button" data-fps="${n}">${n}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="export-lauf" id="export-lauf" hidden>
          <div class="export-balken"><div class="export-balken-fuell" id="export-fuell"></div></div>
          <div class="export-zeile">
            <span id="export-stand">Wird vorbereitet …</span>
            <span id="export-rest" class="export-rest"></span>
          </div>
        </div>
      </div>
      <div class="neu-fuss">
        <button class="knopf" type="button" data-abbrechen>Abbrechen</button>
        <button class="knopf-primaer" type="button" data-speichern hidden>
          <svg aria-hidden="true"><use href="#i-download"/></svg>Speichern
        </button>
        <button class="knopf-primaer" type="button" data-starten>
          <svg aria-hidden="true"><use href="#i-film"/></svg>Video erzeugen
        </button>
      </div>
      <!-- Die Rückfrage liegt ÜBER dem Blatt, nicht darin: Im Fluss schob sie
           die Knöpfe nach unten und ließ das Modal wachsen — eine Frage, die
           das Fenster verschiebt, liest sich als Panne. So bleibt die Größe
           exakt gleich, und die Frage nimmt sich trotzdem den ganzen Raum.
           Ein eigener Dialog wäre die Alternative gewesen, brächte aber eine
           zweite Fokusfalle über der ersten. -->
      <div class="export-frage" id="export-frage" hidden>
        <div class="export-frage-karte" role="alertdialog" aria-labelledby="export-frage-text">
          <p id="export-frage-text">Der Film ist noch nicht fertig. Brichst du jetzt ab, fängt er beim nächsten Mal von vorn an.</p>
          <div class="export-frage-knoepfe">
            <button class="knopf" type="button" data-abbruch-ja>Ja, abbrechen</button>
            <button class="knopf-primaer" type="button" data-weiter>Weiter rendern</button>
          </div>
        </div>
      </div>
    </div>`
  el.addEventListener('click', (e) => {
    // Während des Laufs schließt weder der Klick daneben noch Escape (s.
    // `beiEscape`): Ein Fehlgriff kostete sonst Minuten Rechnerei. Beenden
    // kann ihn nur der Knopf, der es auch sagt.
    if (e.target === el && !rahmen) schliesseExportBlatt()
  })
  $('button[data-starten]', el).addEventListener('click', starten)
  $('button[data-abbrechen]', el).addEventListener('click', zurueck)
  $('button[data-weiter]', el).addEventListener('click', entschaerfeAbbruch)
  $('button[data-abbruch-ja]', el).addEventListener('click', brichAb)
  $('button[data-speichern]', el).addEventListener('click', speichere)
  el.querySelectorAll<HTMLButtonElement>('[data-lage]').forEach((b) => {
    b.addEventListener('click', () =>
      setzeFormat({ ...format, lage: b.dataset.lage as ExportLage }),
    )
  })
  el.querySelectorAll<HTMLButtonElement>('[data-groesse]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number.parseInt(b.dataset.groesse ?? '', 10)
      setzeFormat({ ...format, groesse: n as ExportGroesse })
    })
  })
  el.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number.parseInt(b.dataset.fps ?? '', 10)
      if (istExportFps(n)) setzeFormat({ ...format, fps: n })
    })
  })
  document.body.appendChild(el)
  return el
}

function setzeFormat(n: ExportFormat): void {
  format = n
  if (!hinter) return
  hinter.querySelectorAll<HTMLButtonElement>('[data-lage]').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.lage === format.lage)
  })
  hinter.querySelectorAll<HTMLButtonElement>('[data-groesse]').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.groesse === String(format.groesse))
  })
  hinter.querySelectorAll<HTMLButtonElement>('[data-fps]').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.fps === String(format.fps))
  })
  const vp = exportViewport(format)
  const vorschau = $('#export-vorschau', hinter)
  vorschau.classList.toggle('hoch', format.lage === 'hoch')
  vorschau.style.aspectRatio = `${vp.breite} / ${vp.hoehe}`
  letzteBreite = 0 // Formatwechsel ändert das Seitenverhältnis, nicht nur die Breite
  passeRahmenEin()
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
function maleVorschau(tour: ExportBlattTour): void {
  if (!hinter) return
  const kasten = $('#export-vorschau', hinter)
  const dauer = $('#export-dauer', hinter)
  kasten.replaceChildren(dauer)
  kasten.classList.remove('laeuft')
  const spur = tour.spur ?? null
  kasten.classList.toggle('mit-spur', !!spur)
  if (tour.cover) {
    const img = document.createElement('img')
    img.src = tour.cover
    img.alt = ''
    kasten.appendChild(img)
  }
  if (spur) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'export-spur')
    svg.setAttribute('viewBox', '-6 -6 112 112')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML =
      `<path class="linie" d="${spur.d}"/>` +
      `<circle class="start" cx="${spur.start[0]}" cy="${spur.start[1]}" r="3.2"/>` +
      `<circle class="ende" cx="${spur.ende[0]}" cy="${spur.ende[1]}" r="3.2"/>`
    kasten.appendChild(svg)
  }
  const titel = tour.title?.trim() || 'Ohne Titel'
  const filmS = tour.filmS ?? null
  // Genannt wird die Länge der DATEI, nicht die der Fahrt: Intro und Finale
  // sind Teil des Films, und der Balken zählt später gegen dieselbe Zahl.
  // Ohne bekannte Filmlänge lieber nichts als eine geratene — sie ist die
  // Erwartung an Dateigröße und Wartezeit (Altbestand bekommt sie beim
  // nächsten Rendern, wie `spur` und `fotos`).
  const clipS = filmS && filmS > 0 ? clipDauerS(filmS, tour.finale === true) : 0
  $('#export-unter', hinter).textContent = titel
  dauer.hidden = !(clipS > 0)
  dauer.textContent = clipS > 0 ? formatiereClipzeit(clipS) : ''
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
function passeRahmenEin(): void {
  if (!hinter || !rahmen) return
  const vp = exportViewport(format)
  const buehne = $('#export-vorschau', hinter)
  const breite = buehne.clientWidth
  if (breite < 1 || breite === letzteBreite) return
  letzteBreite = breite
  rahmen.style.width = `${vp.breite}px`
  rahmen.style.height = `${vp.hoehe}px`
  rahmen.style.transform = `scale(${breite / vp.breite})`
}

/**
 * Die Fußzeile hat vier Zustände, und der linke Knopf trägt in jedem ein
 * anderes Wort: „Abbrechen", solange man noch entscheidet oder es läuft,
 * „Schließen", wenn nichts mehr abzubrechen ist.
 */
function zeigeLauf(laeuft: boolean): void {
  if (!hinter) return
  $('#export-lauf', hinter).hidden = !laeuft
  $('.export-wahl', hinter).hidden = laeuft
  $('#export-frage', hinter).hidden = true
  abbruchScharf = false
  hinter.querySelector<HTMLButtonElement>('[data-starten]')!.hidden = laeuft
  const zu = hinter.querySelector<HTMLButtonElement>('[data-abbrechen]')!
  zu.hidden = false
  zu.textContent = 'Abbrechen'
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
 * `display: none`-Teilbaum nichts — und `maleVorschau` baut die Vorschau,
 * solange der Dialog noch versteckt ist.
 */
function zentriereSpur(): void {
  if (!hinter) return
  const svg = hinter.querySelector('.export-spur')
  const pfad = svg?.querySelector('path')
  if (!(svg instanceof SVGSVGElement) || !(pfad instanceof SVGPathElement)) return
  const b = pfad.getBBox()
  if (!(b.width > 0) || !(b.height > 0)) return
  // Luft nach der LÄNGEREN Seite, sonst wird eine schmale Route seitlich
  // zugeklebt und eine flache oben und unten.
  const luft = Math.max(b.width, b.height) * 0.14
  svg.setAttribute(
    'viewBox',
    `${b.x - luft} ${b.y - luft} ${b.width + luft * 2} ${b.height + luft * 2}`,
  )
}

/**
 * Gewarnt wird, wo etwas verloren geht — nicht davor.
 *
 * Vor dem Start gibt es nichts zu verlieren: Ein Blatt, das erst einen
 * Hinweis wegklicken lässt, verlangt eine Zusage für eine Handlung ohne
 * Folgen. Ein LAUFENDER Film dagegen ist Minuten Rechnerei, und die sind mit
 * einem Klick weg. Also schärft sich der ABBRUCH, und das Verlassen der Seite
 * fragt der Browser (s. `beiVerlassen`).
 */
function entschaerfeAbbruch(): void {
  if (!hinter) return
  abbruchScharf = false
  $('#export-frage', hinter).hidden = true
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
 * `fragtNachLoeschung`) und eine zweite Fokusfalle über der ersten.
 */
function schaerfeAbbruch(): void {
  if (!hinter) return
  abbruchScharf = true
  $('#export-frage', hinter).hidden = false
  hinter.querySelector<HTMLButtonElement>('[data-weiter]')!.focus()
}

/**
 * Neu laden und Tab schließen fragt der BROWSER — das ist die einzige Stelle,
 * an der eine Seite das überhaupt kann, und der Nutzer kennt den Kasten.
 * Eigene Oberfläche gibt es dafür nicht: Sie käme zu spät.
 */
function beiVerlassen(e: BeforeUnloadEvent): void {
  e.preventDefault()
  e.returnValue = ''
}

function starten(): void {
  if (!aktuell || !hinter) return
  fertigeDatei = null
  beginnMs = Date.now()
  zeigeLauf(true)
  hinter.querySelector<HTMLButtonElement>('[data-speichern]')!.hidden = true
  const buehne = $('#export-vorschau', hinter)
  // Die Dauer-Plakette bleibt STEHEN (im Lauf blendet CSS sie aus): Sie ist
  // ein festes Kind der Bühne, und wer sie hier herauswirft, lässt jedes
  // spätere Öffnen des Blattes an `#export-dauer` scheitern.
  buehne.replaceChildren($('#export-dauer', hinter))
  buehne.classList.add('laeuft')
  const el = document.createElement('iframe')
  el.className = 'export-rahmen'
  el.setAttribute('title', 'Vorschau des Films, während er entsteht')
  el.src = tourPfad(`srv:${aktuell.id}`) + exportQuery(format, true)
  buehne.appendChild(el)
  rahmen = el
  letzteBreite = 0
  window.addEventListener('beforeunload', beiVerlassen)
  passeRahmenEin()
  beobachter = new ResizeObserver(passeRahmenEin)
  beobachter.observe(buehne)
  window.addEventListener('message', beiMeldung)
}

/**
 * Der linke Knopf — und er bedeutet zwei Dinge, die sich nicht verwechseln
 * lassen: Läuft ein Film, hält er ihn an; sonst schließt er das Blatt.
 *
 * Das ersetzt das × oben rechts. Solange nichts läuft, meinten beide exakt
 * dasselbe, und ein zweites Bedienelement für dieselbe Sache ist keine
 * Bequemlichkeit, sondern eine Frage mehr. Escape schließt weiterhin.
 */
function zurueck(): void {
  if (rahmen) schaerfeAbbruch()
  else schliesseExportBlatt()
}

function brichAb(): void {
  // Den Rahmen wegnehmen beendet den Lauf: Sein JavaScript stirbt mit ihm.
  // Ein „bitte aufhören" nach unten bräuchte einen Abbruchpunkt in jeder
  // Warteschleife und wäre trotzdem nie sofort.
  rahmen?.remove()
  rahmen = null
  beobachter?.disconnect()
  beobachter = null
  letzteBreite = 0
  window.removeEventListener('message', beiMeldung)
  window.removeEventListener('beforeunload', beiVerlassen)
  if (!hinter) return
  entschaerfeAbbruch()
  $('#export-vorschau', hinter).classList.remove('laeuft')
  zeigeLauf(false)
  if (aktuell) maleVorschau(aktuell)
}

function beiMeldung(e: MessageEvent): void {
  if (e.origin !== location.origin || !hinter) return
  const m = e.data as ExportMeldung | undefined
  if (!m || m.typ !== EXPORT_NACHRICHT) return
  const stand = $('#export-stand', hinter)
  const rest = $('#export-rest', hinter)
  const fuell = $('#export-fuell', hinter)
  const anteil = m.frames && m.frame ? m.frame / m.frames : 0
  fuell.style.width = `${Math.round(anteil * 100)}%`

  if (m.stand === 'fertig' && m.daten && m.dateiname) {
    fertigeDatei = { name: m.dateiname, daten: m.daten }
    fuell.style.width = '100%'
    stand.textContent = `Fertig. ${formatiereClipzeit(m.clipS ?? 0)} Film.`
    rest.textContent = ''
    abbruchScharf = false
    $('#export-frage', hinter).hidden = true
    hinter.querySelector<HTMLButtonElement>('[data-speichern]')!.hidden = false
    // Der Rahmen ist weg, es gibt nichts mehr abzubrechen — aber einen Weg
    // hinaus braucht es weiterhin, seit das × entfallen ist.
    rahmen?.remove()
    rahmen = null
    window.removeEventListener('beforeunload', beiVerlassen)
    hinter.querySelector<HTMLButtonElement>('[data-abbrechen]')!.textContent = 'Schließen'
    speichere() // einmal von selbst; der Knopf bleibt für den zweiten Versuch
    return
  }
  stand.textContent = m.text ?? ''
  rest.textContent =
    m.stand === 'laeuft'
      ? restzeitText(restzeitS(m.frame ?? 0, m.frames ?? 0, (Date.now() - beginnMs) / 1000))
      : ''
  if (m.stand === 'fehler') {
    // Gescheitert heißt: Es läuft nichts mehr. Bliebe der Rahmen stehen,
    // fragte „Abbrechen" für einen toten Lauf nach — und `beforeunload`
    // hielte weiter das Neuladen auf.
    rahmen?.remove()
    rahmen = null
    window.removeEventListener('beforeunload', beiVerlassen)
    abbruchScharf = false
    $('#export-frage', hinter).hidden = true
    hinter.querySelector<HTMLButtonElement>('[data-abbrechen]')!.textContent = 'Schließen'
  }
}

function speichere(): void {
  if (!fertigeDatei) return
  const url = URL.createObjectURL(new Blob([fertigeDatei.daten], { type: 'video/mp4' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fertigeDatei.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function beiEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !hinter || hinter.hidden) return
  e.stopPropagation()
  if (abbruchScharf) {
    // Escape beantwortet die Rückfrage mit „weiter", nie mit „abbrechen":
    // Die Taste soll das Zuletzt-Geöffnete zurücknehmen, nicht Minuten
    // Rechnerei verwerfen.
    entschaerfeAbbruch()
    return
  }
  if (rahmen) return // läuft: nur der Knopf beendet ihn
  schliesseExportBlatt()
}

export function schliesseExportBlatt(): void {
  if (!hinter) return
  brichAb()
  hinter.hidden = true
  aktuell = null
  fertigeDatei = null
  document.removeEventListener('keydown', beiEscape, true)
}

/** Öffnet das Blatt. Nur für eigene, fertige Touren aufrufen. */
export function oeffneExportBlatt(tour: ExportBlattTour): void {
  if (!hinter) hinter = baueBlatt()
  aktuell = tour
  format = { ...EXPORT_VORGABE }
  setzeFormat(format)
  maleVorschau(tour)
  zeigeLauf(false)
  hinter.querySelector<HTMLButtonElement>('[data-speichern]')!.hidden = true
  hinter.hidden = false
  zentriereSpur()
  document.addEventListener('keydown', beiEscape, true)
  hinter.querySelector<HTMLButtonElement>('button[data-starten]')?.focus()
}
