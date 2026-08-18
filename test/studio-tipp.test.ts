// Wohin die Tooltip-Blase gehört.
//
// Die Wahl ist der einzige Teil mit einer richtigen und mehreren falschen
// Antworten — und im Browser am schwersten zu prüfen, weil sie von der
// Fenstergröße abhängt. Deshalb DOM-frei.
import { describe, expect, it } from 'vitest'
import { lageFuer, type Kasten } from '../src/studio/tipp.js'

const fenster = { breite: 1440, hoehe: 900 }
const blase: Kasten = { left: 0, top: 0, width: 260, height: 36 }
/** Ein Griff im Inspector-Panel am rechten Rand. */
const imPanel = (top: number): Kasten => ({ left: 1180, top, width: 15, height: 15 })

describe('lageFuer', () => {
  it('legt die Blase links neben den Griff, wenn dort Platz ist', () => {
    // Der Normalfall im Studio: Das Panel klebt rechts, links liegt die Karte.
    // Nach unten deckte die Blase das Feld zu, zu dem sie gehört.
    const lage = lageFuer(imPanel(200), blase, fenster)
    expect(lage.seite).toBe('links')
    expect(lage.x).toBe(1180 - 260 - 8)
    // Mittig zur Zeile des Griffs.
    expect(lage.y).toBe(200 + 15 / 2 - 36 / 2)
  })

  it('weicht nach unten aus, wenn links kein Platz ist', () => {
    const lage = lageFuer({ left: 40, top: 300, width: 15, height: 15 }, blase, fenster)
    expect(lage.seite).toBe('unten')
    expect(lage.y).toBe(300 + 15 + 8)
  })

  it('geht nach oben, wenn unten der Rand kommt', () => {
    const lage = lageFuer({ left: 40, top: 880, width: 15, height: 15 }, blase, fenster)
    expect(lage.seite).toBe('oben')
    expect(lage.y).toBe(880 - 36 - 8)
  })

  it('hält die Blase im Fenster, auch wenn der Griff am Rand klebt', () => {
    const lage = lageFuer({ left: 4, top: 300, width: 15, height: 15 }, blase, fenster)
    expect(lage.x).toBeGreaterThanOrEqual(8)
    expect(lage.x + blase.width).toBeLessThanOrEqual(fenster.breite - 8)
  })

  it('klemmt eine seitliche Blase nicht aus dem Bild, wenn der Griff ganz unten steht', () => {
    const lage = lageFuer(imPanel(890), blase, fenster)
    expect(lage.seite).toBe('links')
    expect(lage.y + blase.height).toBeLessThanOrEqual(fenster.hoehe - 8)
  })

  it('bleibt am Griff, wenn das Fenster 0×0 meldet', () => {
    // Die Browser-Pane meldet das, sobald sie unsichtbar ist. Ohne Rückfall
    // klemmte jede Rechnung die Blase in die linke obere Ecke — sie stand dann
    // als Kasten am Fensterrand, weit weg von ihrem Griff.
    const lage = lageFuer(imPanel(200), blase, { breite: 0, hoehe: 0 })
    expect(lage.seite).toBe('links')
    expect(lage.x).toBe(1180 - 260 - 8)
    expect(lage.y).toBeGreaterThan(100)
  })
})
