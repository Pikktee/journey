// Die Leinwand der Foto-Karte im Player — der eine Aufrufer des Malers.
//
// Sie tut drei Dinge und nichts sonst: Sie hält die Leinwand in der richtigen
// Größe, sie ruft `maleKarte` pro Frame, und sie schiebt die DOM-Bedienung auf
// die Rechtecke, die der Maler zurückgibt.
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
  maleKarte,
  raeumeKartenPuffer,
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
  /** „Weiter ▸". */
  weiter: HTMLElement
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

export function createKartenSchicht(
  container: HTMLElement,
  bedienung: KartenBedienung,
  imExport: boolean,
): KartenSchicht {
  const leinwand = document.createElement('canvas')
  leinwand.id = 'karte'
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
   * die Einstellung des rendernden Rechners gehört nicht in die Datei (§5).
   */
  const bedienungSteht = (): boolean =>
    imExport ? false : !document.body.classList.contains('ui-clean')

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

  const raeumeBedienung = (): void => {
    lege(bedienung.karte, null, 0)
    lege(bedienung.bild, null, 0)
    lege(bedienung.weiter, null, 0)
  }

  const zeichne = (stand: KartenSchichtStand): void => {
    ctx.clearRect(0, 0, breite, hoehe)
    gemalt = true
    const ergebnis = maleKarte(
      ctx,
      {
        breite,
        hoehe,
        bedienungSteht: bedienungSteht(),
        ruhig,
        // Der Bildschirm hat den Schleier als DOM-Schicht darunter; der Film
        // komponiert selbst und bekommt die flache Füllung (§4).
        schleier: imExport ? 'flach' : 'aus',
      },
      stand,
    )
    letzteMasse = ergebnis.masse
    letztBereit = ergebnis.bereit
    if (!ergebnis.masse) return raeumeBedienung()
    const m = ergebnis.masse
    lege(bedienung.karte, m.karte, m.sicht)
    lege(bedienung.bild, m.bild, m.sicht)
    lege(bedienung.weiter, m.weiter, m.sicht)
    // Der Knopf skaliert mit der Bühne — sonst wäre er im 4K-Film eine
    // Briefmarke neben einer großen Karte.
    bedienung.weiter.style.fontSize = `${m.weiter.schrift.toFixed(2)}px`
    bedienung.weiter.style.borderRadius = `${m.weiter.radius.toFixed(1)}px`
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

  messe()
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
  // Fehler, den es hier schon einmal gab.
  let letztBedienung = bedienungSteht()
  const klassenBeobachter =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          const jetzt = bedienungSteht()
          if (jetzt === letztBedienung) return
          letztBedienung = jetzt
          neuZeichnen()
        })
      : null
  klassenBeobachter?.observe(document.body, { attributes: true, attributeFilter: ['class'] })

  return {
    male(stand) {
      letzterStand = stand
      messe()
      zeichne(stand)
    },
    raeume() {
      leere()
      letzterStand = null
      letzteMasse = null
      letztBereit = true
      raeumeBedienung()
    },
    bereit: () => letztBereit,
    masse: () => letzteMasse,
    stand: () => letzterStand,
    zerstoere() {
      window.removeEventListener('resize', beiGroesse)
      groessenBeobachter?.disconnect()
      klassenBeobachter?.disconnect()
      raeumeKartenPuffer()
      leinwand.remove()
    },
  }
}
