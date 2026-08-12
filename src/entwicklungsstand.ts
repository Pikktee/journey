/**
 * Der Entwicklungsstand als sichtbares Kennzeichen hinter der Wortmarke.
 *
 * Maptale steht offen im Netz, nimmt echte Aufnahmen entgegen und wird dabei
 * weiter umgebaut. Ohne Kennzeichen liest sich jeder Bruch als Produktversagen
 * statt als Bauzustand — das Wort neben der Marke setzt die Erwartung, BEVOR
 * jemand seine Urlaubsfotos hochlädt.
 *
 * Warum „Alpha" und nicht „Preview": In dieser Oberfläche ist „Vorschau"
 * bereits ein Fachwort (Vorschaukarten geteilter Links, Titelbild-Vorschau,
 * Server-Vorschau der Mail-Vorlagen). Ein Chip „Preview" neben der Marke wäre
 * als „Vorschau einer Tour" lesbar gewesen — genau die Verwechslung, die ein
 * Warnhinweis nicht haben darf.
 *
 * Der Chip ist ANKLICKBAR, und das ist der Grund, warum das weniger geläufige
 * Wort tragbar ist: Wer „Alpha" nicht kennt, klickt — und liest dort den Satz,
 * auf den es ankommt. Ein bekanntes Wort, das man zu verstehen glaubt, wird
 * nicht geklickt.
 *
 * Das Markup steht hier und nicht fünfmal in den Seiten; das CSS bringt das
 * Modul selbst mit, weil die Landing (index.html) `grundelemente.css` NICHT
 * lädt — sie hat ihre eigene Kopfleiste. Aus demselben Grund ist die Erklärung
 * ein eigenes kleines Kärtchen und nicht `dialogschicht.ts`: Deren Optik steht
 * in `grundelemente.css` und wäre auf der Landing ungestaltet.
 */

import { version as APP_VERSION } from '../package.json'

/** Das Wort auf dem Chip. Eine Quelle — Chip, Kärtchen und Wächter lesen es. */
export const STAND_WORT = 'Alpha'

/**
 * Was der Stand bedeutet — drei Punkte in der Reihenfolge, in der sie den
 * Besucher betreffen: was er merken wird, was mit seinen Daten ist, was er tun
 * kann.
 *
 * Als PUNKTE mit Symbol und Überschrift und nicht als drei Absätze: Ein Block
 * Fließtext neben der Wortmarke wird überflogen, nicht gelesen — und genau der
 * mittlere Punkt ist der, den niemand überfliegen sollte. Die Überschrift trägt
 * die Aussage, der Satz darunter die Begründung.
 */
export interface StandPunkt {
  /** Pfad-Daten eines 24×24-Symbols (stroke, kein fill). */
  readonly symbol: string
  readonly titel: string
  readonly text: string
}

export const STAND_PUNKTE: readonly StandPunkt[] = [
  {
    // Werkzeug: hier wird gearbeitet.
    symbol:
      '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.6 9.6a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 17.5 3.5a4 4 0 0 1 3 3l-2.8 2.8"/>',
    titel: 'Noch nicht fertig',
    text: 'Funktionen ändern sich, Fehler sind wahrscheinlich.',
  },
  {
    // Bild mit Warnung: die Originale gehören dir, nicht uns.
    symbol:
      '<rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3 15 4.5-4 4 3.5 3-2.5L21 17"/>',
    titel: 'Kein Backup',
    text: 'Behalte deine Originale.',
  },
  {
    // Sprechblase: der Weg zurück zu uns.
    symbol:
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.7-5a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.4-8.5h.5a8.4 8.4 0 0 1 8.1 8z"/>',
    titel: 'Sag es uns',
    // `{feedback}` wird im Kärtchen zum Knopf, der das Formular öffnet — das
    // Wort steht ohnehin da, und ein Wort, das den Weg NENNT, ohne ihn zu
    // öffnen, lässt einen suchen. Der Marker statt fertigem Markup: Die Sätze
    // bleiben Text und lassen sich prüfen, ohne HTML zu parsen.
    text: 'Jedes {feedback} fließt direkt in die Entwicklung.',
  },
]

const STIL_ID = 'stand-karte-stil'

/**
 * NUR die Optik des Kärtchens steht hier — der Hinweis selbst wird statisch
 * gestaltet (`grundelemente.css` für die Produktseiten, der eigene Stilblock
 * der Landing für index.html).
 *
 * Der Grund ist ein sichtbarer Fehler gewesen: Per JavaScript eingehängtes CSS
 * kommt NACH dem HTML, und der Hinweis stand deshalb bei jedem Laden einen
 * Wimpernschlag lang ungestaltet neben der Marke. Was im Markup der Seite liegt,
 * muss aus einem Stylesheet kommen. Das Kärtchen darf hier bleiben: Es entsteht
 * erst auf Klick, also lange nachdem dieser Block im Kopf steht.
 */
const STIL = `
.stand-karte {
  position: fixed;
  z-index: 1200;
  width: min(320px, calc(100vw - 24px));
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  padding: 14px 16px 15px;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--glas-rand, rgba(255, 255, 255, 0.1));
  background: var(--fl-1, #111722);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.5);
  font-family: var(--font-ui);
}
.stand-karte h2 {
  margin: 0 0 8px;
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text, #f2ede3);
}
.stand-punkte {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.stand-punkte li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-2, #a7b1bf);
}
.stand-punkte svg {
  width: 17px;
  height: 17px;
  flex: none;
  /* Auf die erste Zeile ausgerichtet, nicht auf den Absatz: Bei zwei Zeilen
     rutschte ein zentriertes Symbol neben den Zeilenzwischenraum. */
  margin-top: 1px;
  color: var(--akzent, #f59e0b);
  opacity: 0.9;
}
.stand-punkte b {
  display: block;
  font-weight: 600;
  color: var(--text, #f2ede3);
}
/* Wie ein Link im Fließtext, nicht wie ein Knopf: Er steht mitten im Satz. */
.stand-link {
  font: inherit;
  color: var(--akzent, #f59e0b);
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.stand-link:hover { background: none; text-decoration-thickness: 2px; }
.stand-fuss {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--linie, rgba(255, 255, 255, 0.08));
  font-size: 11.5px;
  color: var(--text-3, #7e8a99);
  font-variant-numeric: tabular-nums;
}
.stand-fuss > span { margin-right: auto; }
.stand-fuss button {
  font-family: var(--font-ui);
  font-size: 11.5px;
  font-weight: 550;
  color: var(--text-2, #a7b1bf);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.stand-fuss button:hover { color: var(--text, #f2ede3); background: none; }
@media (prefers-reduced-motion: no-preference) {
  .stand-karte { animation: stand-auf 140ms ease-out; }
}
@keyframes stand-auf {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
`

function stellStilBereit(): void {
  if (document.getElementById(STIL_ID)) return
  const stil = document.createElement('style')
  stil.id = STIL_ID
  stil.textContent = STIL
  document.head.appendChild(stil)
}

/**
 * Der Hinweis als Markup — hinter der Wortmarke, in einer `.marken-gruppe`,
 * damit er an ihr klebt und nicht hinter dem Nav-Abstand landet.
 *
 * Kleines Wort statt Pille: Ein umrandeter Chip in Akzentfarbe zieht neben der
 * Marke mehr Aufmerksamkeit auf sich als die Marke selbst — er soll den Stand
 * NENNEN, nicht ihn bewerben. Ein `<button>` und kein `<a>`, weil er nirgendwo
 * hinführt: Er erklärt sich an Ort und Stelle.
 */
export function standChipHtml(): string {
  return (
    `<button type="button" class="stand-hinweis" aria-haspopup="dialog" aria-expanded="false"` +
    ` title="Was das bedeutet">${STAND_WORT}</button>`
  )
}

let offen: (() => void) | null = null
let verdrahtet = false

function oeffneKarte(chip: HTMLElement): void {
  stellStilBereit()
  const karte = document.createElement('div')
  karte.className = 'stand-karte'
  karte.setAttribute('role', 'dialog')
  karte.setAttribute('aria-label', `Maptale ist in der ${STAND_WORT}`)
  karte.innerHTML =
    `<h2>Maptale ist in der ${STAND_WORT}</h2>` +
    `<ul class="stand-punkte">` +
    STAND_PUNKTE.map(
      (p) =>
        `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"` +
        ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.symbol}</svg>` +
        `<span><b>${p.titel}</b>${p.text.replace(
          '{feedback}',
          '<button type="button" class="stand-link" data-feedback>Feedback</button>',
        )}</span></li>`,
    ).join('') +
    `</ul>` +
    `<div class="stand-fuss"><span>Version ${APP_VERSION}</span>` +
    `<button type="button" data-schliessen>Verstanden</button></div>`
  document.body.appendChild(karte)

  // Das Formular wird erst hier nachgeladen: Die meisten öffnen das Kärtchen,
  // um das Wort zu verstehen, nicht um zu schreiben.
  karte.querySelector('[data-feedback]')?.addEventListener('click', () => {
    schliesse()
    void import('./feedbackknopf.js').then(({ oeffneFeedback }) => oeffneFeedback())
  })

  // Unter dem Chip ausrichten und am Fensterrand klemmen: `position: fixed`
  // rechnet gegen das Sichtfeld, die Kopfleiste ist sticky — beides passt
  // zusammen, solange die Karte nach dem Anhängen (also mit echter Breite)
  // gemessen wird.
  const platziere = (): void => {
    const r = chip.getBoundingClientRect()
    const breite = karte.offsetWidth
    const links = Math.max(12, Math.min(r.left, window.innerWidth - breite - 12))
    karte.style.left = `${links}px`
    karte.style.top = `${r.bottom + 10}px`
  }
  platziere()

  const schliesse = (): void => {
    karte.remove()
    document.removeEventListener('keydown', beiTaste)
    document.removeEventListener('pointerdown', beiKlickDaneben, true)
    window.removeEventListener('resize', platziere)
    window.removeEventListener('scroll', platziere, true)
    chip.setAttribute('aria-expanded', 'false')
    offen = null
  }

  function beiTaste(e: KeyboardEvent): void {
    if (e.key === 'Escape') schliesse()
  }
  function beiKlickDaneben(e: Event): void {
    const ziel = e.target as Node
    if (karte.contains(ziel) || chip.contains(ziel)) return
    schliesse()
  }

  karte.querySelector('[data-schliessen]')?.addEventListener('click', schliesse)
  document.addEventListener('keydown', beiTaste)
  // Erst im nächsten Tick: Auf Touch können dem `click`, der die Karte öffnet,
  // noch Kompatibilitäts-Ereignisse desselben Tipps folgen. Die fielen sonst in
  // den Zuhörer „Klick daneben" und schlössen die Karte im selben Atemzug
  // wieder — mit der Maus wäre davon nichts zu sehen.
  setTimeout(() => {
    if (offen !== schliesse) return
    document.addEventListener('pointerdown', beiKlickDaneben, true)
  }, 0)
  window.addEventListener('resize', platziere)
  // `true`: auch das Scrollen innerhalb einer Tafel soll die Karte nachziehen.
  window.addEventListener('scroll', platziere, true)
  chip.setAttribute('aria-expanded', 'true')
  offen = schliesse
}

/**
 * Verdrahtet den Chip — einmal pro Seite. Bewusst als Delegation am `document`
 * und nicht am Element: Die Produkt-Seiten tragen die Kopfleiste zuerst
 * statisch im HTML und ersetzen sie danach durch `montiereAppHeader`. Ein
 * Zuhörer am Knopf wäre dabei mitsamt dem alten Markup verschwunden.
 */
export function montiereStandChip(): void {
  // Idempotent: Die Kopfleiste wird pro Seite ein- bis zweimal montiert
  // (statisch, dann nachgeladen), und jeder Aufruf käme sonst mit einem
  // weiteren Zuhörer — die Karte ginge beim zweiten Klick auf und sofort
  // wieder zu.
  if (verdrahtet) return
  verdrahtet = true
  document.addEventListener('click', (e) => {
    const chip = (e.target as Element | null)?.closest?.('.stand-hinweis')
    if (!(chip instanceof HTMLElement)) return
    if (offen) {
      offen()
      return
    }
    oeffneKarte(chip)
  })
}
