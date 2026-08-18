// Die Leinwand der Foto-Karte — der eine Aufrufer des Malers.
//
// Sie tut drei Dinge und nichts sonst: Sie hält die Leinwand in der richtigen
// Größe, sie ruft `maleKarte` pro Frame, und sie schiebt die DOM-Bedienung auf
// die Rechtecke, die der Maler zurückgibt.
//
// Sie trägt seit „Eine Bühne, ein Maler" BEIDE Bildschirm-Bühnen: den Player am
// `body` und die Vorschau des Editors über der Karten-Bühne. Verschieden sind
// nur der Bühnen-Satz (Maße, Lage, Flugweite — `kartenSatz` im Maler) und die
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

import { kartenPixelRatio } from './map.js'
import {
  KURVE,
  maleKarte,
  raeumeKartenPuffer,
  type KartenBuehnenName,
  type KartenMasse,
  type KartenMedium,
  type KartenQuelle,
  type KartenText,
} from './kartenmaler.js'

export interface KartenBedienung {
  /** Die Klickfläche der Karte (anhalten / weiterlaufen). */
  karte: HTMLElement
  /** Der Bildbereich — trägt Ton-Knopf und „Angehalten"-Abzeichen. */
  bild: HTMLElement
}

export interface KartenSchichtStand {
  imS: number
  dauerS: number
  medium: KartenMedium
  text: KartenText
  quelle: KartenQuelle | null
  bereit: boolean
}

export interface KartenSchicht {
  /** Ein Bild dieser Filmsekunde. */
  male(stand: KartenSchichtStand): void
  /** Leinwand leeren und die Bedienung wegnehmen. */
  raeume(): void
  /**
   * Stand der letzten Zeichnung: Hat der Maler das Bild wirklich bekommen?
   *
   * Der Video-Export fragt danach, statt zu encodieren — `drawImage` auf einem
   * noch suchenden `<video>` zeichnet ohne Fehler das ALTE Bild, und am
   * Bildschirm fällt das nicht auf (Konzept §5, „Bild und Video").
   */
  bereit(): boolean
  masse(): KartenMasse | null
  /**
   * Der Stand, der zuletzt gemalt wurde — Abnahme-Griff wie die übrigen
   * `window.__j`. Was auf der Leinwand steht, liegt sonst nirgends im DOM: Ein
   * Seiten-Screenshot zeigt das Bild, aber nicht die Werte, aus denen es kommt
   * (scripts/messungen/kartenleinwand.mjs braucht genau die).
   */
  stand(): KartenSchichtStand | null
  zerstoere(): void
}

/**
 * `prefers-reduced-motion` wird EINMAL hier gelesen und als Schalter
 * weitergegeben — der Maler darf die Umgebung nicht selbst befragen (Falle 2).
 * Im Export ist der Schalter immer aus: Die Einstellung des rendernden Rechners
 * hätte sonst Einfluss auf die ausgelieferte Datei.
 */
function liesRuhig(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export interface KartenSchichtOptionen {
  /** Wohin die Leinwand gehängt wird — Player: `body`, Editor: die Karten-Bühne. */
  container: HTMLElement
  /**
   * Die DOM-Knöpfe, die auf den Rechtecken des Malers mitgeführt werden.
   *
   * Fehlen sie, hat diese Bühne keine Bedienung (Editor) — dann entfällt auch
   * die Frage, ob eine Steuerleiste steht, und mit ihr der Klassen-Beobachter.
   */
  bedienung?: KartenBedienung | null
  /** Welcher Bühnen-Satz gilt (Vorgabe `player`). */
  buehne?: KartenBuehnenName
  /**
   * Wohin `--schleier-sicht` geschrieben wird — der Schleier UNTER der Leinwand.
   *
   * Er bleibt DOM (`backdrop-filter` hat auf einer Leinwand kein Gegenstück),
   * aber seine Deckkraft hängt seit dem Rückbau des Kamerablitzes an der
   * FILMZEIT: Sie ist die der Karte, also kommt er über den Flug hoch und geht
   * mit dem Abgang wieder weg — rückwärts wie vorwärts und beim Scrubben. Eine
   * Custom Property und kein `style.opacity`, weil der Schleier im Editor ein
   * `::after` ist: Ein Pseudo-Element nimmt keine Inline-Stile, seinen HOST
   * kann man dagegen beschriften.
   */
  schleier?: HTMLElement | null
  /** Im Video-Export: flacher Schleier, keine Leiste, kein Reduced-Motion. */
  imExport?: boolean
  /** `id` der Leinwand — der Export holt sie darüber (`zeichneOverlay`). */
  id?: string
}

export function createKartenSchicht(opt: KartenSchichtOptionen): KartenSchicht {
  const { container } = opt
  const bedienung = opt.bedienung ?? null
  const schleier = opt.schleier ?? null
  const imExport = opt.imExport === true
  const buehneName = opt.buehne ?? 'player'
  const leinwand = document.createElement('canvas')
  leinwand.id = opt.id ?? 'karte'
  leinwand.className = 'karten-leinwand'
  leinwand.setAttribute('aria-hidden', 'true')
  container.appendChild(leinwand)
  const ctx = leinwand.getContext('2d')
  if (!ctx) throw new Error('Karten-Leinwand: kein 2D-Kontext')

  const ruhig = imExport ? false : liesRuhig()
  let breite = 0
  let hoehe = 0
  let dichte = kartenPixelRatio()
  let letzteMasse: KartenMasse | null = null
  let letzterStand: KartenSchichtStand | null = null
  let letztBereit = true
  let gemalt = false
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
   * hat (exportfilm.ts, höchstens ein paar Bilder). Ohne `document.fonts` (alte
   * Browser) gilt sofort „bereit": Eine Zusicherung, die es nicht gibt, darf den
   * Lauf nicht aufhalten.
   */
  let schriftBereit = typeof document.fonts?.ready?.then !== 'function'

  /**
   * Die Fläche, die die Schicht bedeckt — gemessen an dem, was sie VORGIBT, nie
   * am Canvas selbst: `messe` schreibt `canvas.width`, und daraus zu lesen wäre
   * eine Rückkopplung (dieselbe Falle wie in weather.ts).
   */
  const flaeche = (): { w: number; h: number } => {
    if (getComputedStyle(leinwand).position === 'fixed') {
      return { w: window.innerWidth, h: window.innerHeight }
    }
    const r = container.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  const messe = (): void => {
    dichte = kartenPixelRatio()
    const f = flaeche()
    const b = Math.max(1, Math.round(f.w))
    const h = Math.max(1, Math.round(f.h))
    if (b === breite && h === hoehe && leinwand.width === Math.round(b * dichte)) return
    breite = b
    hoehe = h
    leinwand.width = Math.round(b * dichte)
    leinwand.height = Math.round(h * dichte)
    ctx.setTransform(dichte, 0, 0, dichte, 0, 0)
    // Jede gepufferte Fassung hängt an der Kartengeometrie, und die ändert sich
    // mit der Bühne. Die Schlüssel tragen die Maße, alte Puffer würden also nur
    // Speicher halten.
    raeumeKartenPuffer()
    gemalt = false
  }

  /**
   * Steht die Steuerleiste? Nur am Bildschirm — im Film gibt es keine Leiste, und
   * die Einstellung des rendernden Rechners gehört nicht in die Datei (§5). Auf
   * einer Bühne ohne Bedienung gibt es nichts, dem die Karte Platz machen müsste.
   */
  const bedienungZiel = (): number =>
    imExport || !bedienung ? 0 : document.body.classList.contains('ui-clean') ? 0 : 1

  /**
   * Der GEFAHRENE Anteil — die Karte wächst und schrumpft, statt umzuspringen.
   *
   * Das ist bewusst eine WANDUHR-Bewegung und kein Widerspruch zur Regel, dass
   * im Film alles an der Filmzeit hängt: Sie gehört nicht dem Film, sondern der
   * Bedienung. Im Export ist das Ziel fest 0, dort bewegt sich nichts.
   *
   * Dauer und Kurve sind DIE DER LEISTE: `.dock`, `.zurueck` und `.next-stop`
   * blenden mit `transition: … 0.5s ease` (style.css), und `ease` ist
   * `KURVE.ease` im Maler. Damit ist es EINE Geste — die Leiste kommt, die Karte
   * macht ihr Platz — und nicht zwei Bewegungen, die zufällig zugleich
   * stattfinden. Eine exponentielle Glättung stand hier zuerst und war
   * asymptotisch: Sie sah nach 0,33 s fertig aus und kroch dann noch ein Drittel
   * einer Sekunde nach, also gerade so lange, dass es sich nicht mehr wie
   * dieselbe Bewegung anfühlte.
   */
  const BEDIENUNG_DAUER_MS = 500
  let bedienungIst = bedienungZiel()
  let bedienungVon = bedienungIst
  let bedienungBis = bedienungIst
  let bedienungT0 = 0
  let bedienungRaf = 0
  let zuletztGemalt = 0

  const leere = (): void => {
    if (!gemalt) return
    ctx.clearRect(0, 0, breite, hoehe)
    gemalt = false
  }

  /** Ein Rechteck des Malers auf ein DOM-Element — in CSS-Pixeln der Bühne. */
  const lege = (
    el: HTMLElement,
    r: { x: number; y: number; breite: number; hoehe: number } | null,
    sicht: number,
  ): void => {
    if (!r) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      return
    }
    el.style.left = `${r.x.toFixed(1)}px`
    el.style.top = `${r.y.toFixed(1)}px`
    el.style.width = `${r.breite.toFixed(1)}px`
    el.style.height = `${r.hoehe.toFixed(1)}px`
    el.style.opacity = sicht.toFixed(3)
    el.style.pointerEvents = sicht > 0.5 ? 'auto' : 'none'
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
  const legeSchleier = (sicht: number): void => {
    schleier?.style.setProperty('--schleier-sicht', sicht.toFixed(3))
  }

  const raeumeBedienung = (): void => {
    if (!bedienung) return
    lege(bedienung.karte, null, 0)
    lege(bedienung.bild, null, 0)
  }

  const zeichne = (stand: KartenSchichtStand): void => {
    ctx.clearRect(0, 0, breite, hoehe)
    gemalt = true
    zuletztGemalt = performance.now()
    const ergebnis = maleKarte(
      ctx,
      {
        breite,
        hoehe,
        name: buehneName,
        bedienung: bedienungIst,
        ruhig,
        // Der Bildschirm hat den Schleier als DOM-Schicht darunter; der Film
        // komponiert selbst und bekommt die flache Füllung (§4).
        schleier: imExport ? 'flach' : 'aus',
      },
      stand,
    )
    letzteMasse = ergebnis.masse
    letztBereit = ergebnis.bereit && schriftBereit
    legeSchleier(ergebnis.masse?.sicht ?? 0)
    if (!bedienung) return
    if (!ergebnis.masse) return raeumeBedienung()
    const m = ergebnis.masse
    lege(bedienung.karte, m.karte, m.sicht)
    lege(bedienung.bild, m.bild, m.sicht)
    bedienung.bild.style.setProperty('--karten-mass', m.mass.toFixed(3))
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
  const neuZeichnen = (): void => {
    if (letzterStand) zeichne(letzterStand)
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
  const fahreBedienung = (): void => {
    const ziel = bedienungZiel()
    if (ziel === bedienungBis || !letzterStand) return
    // Ab dem STAND losfahren, nicht ab dem alten Ziel: Wer die Maus bewegt,
    // während die Karte noch schrumpft, bekommt sonst einen Sprung zurück.
    bedienungVon = bedienungIst
    bedienungBis = ziel
    bedienungT0 = performance.now()
    if (bedienungRaf) return
    const schritt = (jetzt: number): void => {
      bedienungRaf = 0
      const p = Math.max(0, Math.min(1, (jetzt - bedienungT0) / BEDIENUNG_DAUER_MS))
      bedienungIst = bedienungVon + (bedienungBis - bedienungVon) * KURVE.ease(p)
      // Nur zeichnen, wenn es im laufenden Bild noch niemand getan hat: Läuft
      // der Film, ruft er ohnehin jeden Frame `male()`, und ein zweites
      // Kartenbild je Frame kostete die halbe Sekunde doppelt. Steht er (Halt,
      // Pause), ist diese Schleife die einzige, die zeichnet — und ohne sie
      // bliebe die Karte auf ihrer alten Größe stehen, während die Leiste kommt.
      if (jetzt - zuletztGemalt > 8) neuZeichnen()
      if (p < 1 && letzterStand) bedienungRaf = requestAnimationFrame(schritt)
    }
    bedienungRaf = requestAnimationFrame(schritt)
  }

  const halteBedienung = (): void => {
    if (bedienungRaf) cancelAnimationFrame(bedienungRaf)
    bedienungRaf = 0
    bedienungBis = bedienungIst
  }

  messe()

  // Outfit abwarten und die mit der Rückfallschrift gebackenen Textpuffer
  // wegwerfen (s. `schriftBereit`). Genau EINMAL: `document.fonts.ready` löst
  // auf, wenn die Schriften des aktuellen Layouts stehen.
  if (!schriftBereit) {
    void document.fonts.ready
      .then(() => {
        schriftBereit = true
        raeumeKartenPuffer()
        neuZeichnen()
      })
      .catch(() => {
        // Sagt der Browser nichts zu, darf das den Lauf nicht anhalten.
        schriftBereit = true
      })
  }

  const beiGroesse = () => {
    messe()
    neuZeichnen()
  }
  window.addEventListener('resize', beiGroesse)
  const groessenBeobachter =
    typeof ResizeObserver === 'function' ? new ResizeObserver(beiGroesse) : null
  groessenBeobachter?.observe(container)

  // Der Rückzug der UI ist eine Klasse am body und kein Ereignis. Ein Beobachter
  // und kein Griff für main.ts: Ein Aufrufer, der ihn vergisst, wäre genau der
  // Fehler, den es hier schon einmal gab. Ohne Bedienung gibt es nichts zu
  // beobachten — der Editor bekäme sonst einen Beobachter auf eine Klasse, die
  // auf seiner Seite niemand setzt.
  let letztBedienung = bedienungZiel()
  const klassenBeobachter =
    bedienung && typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          const jetzt = bedienungZiel()
          if (jetzt === letztBedienung) return
          letztBedienung = jetzt
          fahreBedienung()
        })
      : null
  klassenBeobachter?.observe(document.body, { attributes: true, attributeFilter: ['class'] })

  return {
    male(stand) {
      const ersteKarte = !letzterStand
      letzterStand = stand
      // Eine Karte, die gerade erst auf die Bühne kommt, fliegt nicht auch noch
      // in ihre Größe: Sie beginnt bei dem Anteil, der GILT. Gefahren wird nur,
      // was sich ändert, während sie liegt.
      if (ersteKarte) {
        halteBedienung()
        bedienungIst = bedienungZiel()
        bedienungBis = bedienungIst
      } else fahreBedienung()
      messe()
      zeichne(stand)
    },
    raeume() {
      leere()
      halteBedienung()
      letzterStand = null
      letzteMasse = null
      letztBereit = true
      bedienungIst = bedienungZiel()
      bedienungBis = bedienungIst
      legeSchleier(0)
      raeumeBedienung()
    },
    bereit: () => letztBereit,
    masse: () => letzteMasse,
    stand: () => letzterStand,
    zerstoere() {
      halteBedienung()
      window.removeEventListener('resize', beiGroesse)
      groessenBeobachter?.disconnect()
      klassenBeobachter?.disconnect()
      raeumeKartenPuffer()
      leinwand.remove()
    },
  }
}
