// Die eine Uhr: Filmsekunden aus echter Frame-Zeit.
//
// Der Kern des Tests ist eine einzige Zahl: Zehn Sekunden Echtzeit müssen zehn
// Sekunden Film ergeben — auch wenn das Gerät nur fünf Bilder pro Sekunde
// schafft. Mit dem alten 50-ms-Deckel kamen dabei 2,5 s heraus, und genau diese
// Lücke stand am Ende zwischen Bild und Musik
// (docs/concepts/konzept_gleichlauf_player_editor.md §4.1, §8A).

import { describe, expect, it } from 'vitest'
import { Filmuhr, NOT_DECKEL_S, verbindeSichtbarkeit } from '../src/filmuhr.js'

/** Spielt `dauerMs` Echtzeit in Frames von `frameMs` ab, liefert die Filmzeit. */
function spiele(uhr: Filmuhr, dauerMs: number, frameMs: number, startMs = 0): number {
  let film = 0
  for (let t = startMs + frameMs; t <= startMs + dauerMs; t += frameMs) film += uhr.frame(t)
  return film
}

describe('Filmuhr', () => {
  it('zählt 10 s Echtzeit auch bei 200-ms-Frames als 10 s Film', () => {
    const uhr = new Filmuhr(() => 0)
    expect(spiele(uhr, 10_000, 200)).toBeCloseTo(10, 6)
  })

  it('gibt bei flüssigen 60 fps dieselbe Zeit', () => {
    const uhr = new Filmuhr(() => 0)
    expect(spiele(uhr, 10_000, 1000 / 60)).toBeCloseTo(10, 3)
  })

  it('verliert auch bei 205-ms-Frames nichts — der gemessene Fall bei 12×', () => {
    const uhr = new Filmuhr(() => 0)
    const film = spiele(uhr, 20_500, 205)
    expect(film).toBeCloseTo(20.5, 6)
    expect(uhr.verworfenS).toBe(0) // der Notdeckel darf hier NICHT greifen
    expect(uhr.laengstesFrameS).toBeCloseTo(0.205, 6)
  })

  it('zählt, was der Notdeckel doch kappt', () => {
    const uhr = new Filmuhr(() => 0)
    uhr.frame(1000)
    const dt = uhr.frame(1000 + 5000) // 5 s Aussetzer ohne jedes Ereignis
    expect(dt).toBe(NOT_DECKEL_S)
    expect(uhr.verworfenS).toBeCloseTo(5 - NOT_DECKEL_S, 6)
    expect(uhr.verworfenFrames).toBe(1)
  })

  it('überspringt die Abwesenheit statt sie in den Film zu schieben', () => {
    let wanduhr = 1000
    const uhr = new Filmuhr(() => wanduhr)
    uhr.frame(1000)
    uhr.pausiere()
    wanduhr = 61_000 // eine Minute im Hintergrund
    uhr.weiter()
    expect(uhr.frame(61_000)).toBe(0) // erstes Frame nach der Rückkehr setzt neu an
    expect(uhr.frame(61_016)).toBeCloseTo(0.016, 6)
    expect(uhr.pausiertS).toBeCloseTo(60, 6)
    expect(uhr.pausen).toBe(1)
    expect(uhr.verworfenS).toBe(0) // der Notdeckel war nicht beteiligt
  })

  it('läuft während der Pause NICHT beim nächsten Frame wieder los', () => {
    // Genau das war der Fehler der ersten Fassung, im Browser gemessen: Ein
    // Frame direkt nach `pausiere()` setzte die Uhr wieder in Gang, und die
    // Tour fuhr durch die „Pause" hindurch weiter.
    let wanduhr = 1000
    const uhr = new Filmuhr(() => wanduhr)
    uhr.frame(1000)
    uhr.pausiere()
    expect(uhr.frame(1016)).toBe(0)
    wanduhr = 6000
    uhr.weiter()
    expect(uhr.pausiertS).toBeCloseTo(5, 6)
    expect(uhr.frame(6000)).toBe(0)
    expect(uhr.frame(6016)).toBeCloseTo(0.016, 6)
  })

  it('läuft von selbst weiter, wenn Bilder kommen und das Gegenstück ausbleibt', () => {
    // Sonst stünde der Film für immer, falls die Nachricht der App beim
    // Zurückkommen nicht durchkommt. Ein EINZELNES nachlaufendes Frame hebt die
    // Pause aber nicht auf.
    let wanduhr = 1000
    const uhr = new Filmuhr(() => wanduhr)
    uhr.frame(1000)
    uhr.pausiere()
    wanduhr = 3000
    expect(uhr.frame(3000)).toBe(0) // erstes Frame: noch Pause
    expect(uhr.selbstweiter).toBe(0)
    expect(uhr.frame(3016)).toBe(0) // zweites: die Seite ist offensichtlich da
    expect(uhr.selbstweiter).toBe(1)
    expect(uhr.pausiertS).toBeCloseTo(2, 6)
    expect(uhr.frame(3032)).toBe(0) // setzt neu an
    expect(uhr.frame(3048)).toBeCloseTo(0.016, 6)
  })

  it('ignoriert rückwärts laufende und doppelte Zeitstempel', () => {
    const uhr = new Filmuhr(() => 0)
    uhr.frame(1000)
    expect(uhr.frame(1000)).toBe(0)
    expect(uhr.frame(900)).toBe(0)
    expect(uhr.frame(1016)).toBeCloseTo(0.016, 6)
  })
})

// Die Testumgebung ist `node` (kein jsdom im Projekt, alle Web-Tests sind
// DOM-frei). Für die Anbindung reichen zwei EventTargets und ein Feld —
// geprüft wird, WELCHE Ereignisse die Uhr anhalten, nicht wie ein Browser sie
// auslöst.
function mitFensterAttrappe(pruefe: (doc: EventTarget & { visibilityState: string }) => void): void {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const g = globalThis as unknown as Record<string, unknown>
  g['document'] = doc
  g['window'] = new EventTarget()
  try {
    pruefe(doc)
  } finally {
    delete g['document']
    delete g['window']
  }
}

describe('verbindeSichtbarkeit', () => {
  it('hält die Uhr bei `visibilitychange` an — und beim App-Ereignis der WebView', () => {
    mitFensterAttrappe((doc) => {
      const uhr = new Filmuhr(() => 0)
      const loese = verbindeSichtbarkeit(uhr)

      // Die WebView-Seite: eigene Ereignisse, unabhängig von visibilityState
      window.dispatchEvent(new Event('maptale:hintergrund'))
      expect(uhr.pausen).toBe(1)
      window.dispatchEvent(new Event('maptale:vordergrund'))
      uhr.frame(1000)

      // Der Browser-Weg
      doc.visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      expect(uhr.pausen).toBe(2)

      loese()
      doc.visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('maptale:hintergrund'))
      expect(uhr.pausen).toBe(2) // nach dem Abmelden kommt nichts mehr an
    })
  })
})
