// Wohin die Tooltip-Blase gehört.
//
// Die Wahl ist der einzige Teil mit einer richtigen und mehreren falschen
// Antworten — und im Browser am schwersten zu prüfen, weil sie von der
// Fenstergröße abhängt. Deshalb DOM-frei.
import { describe, expect, it } from 'vitest'
import { positionFor, type Box } from '../src/studio/tooltip.js'

const viewport = { width: 1440, height: 900 }
const bubble: Box = { left: 0, top: 0, width: 260, height: 36 }
/** Ein Griff im Inspector-Panel am rechten Rand. */
const inPanel = (top: number): Box => ({ left: 1180, top, width: 15, height: 15 })

describe('lageFuer', () => {
  it('legt die Blase links neben den Griff, wenn dort Platz ist', () => {
    // Der Normalfall im Studio: Das Panel klebt rechts, links liegt die Karte.
    // Nach unten deckte die Blase das Feld zu, zu dem sie gehört.
    const position = positionFor(inPanel(200), bubble, viewport)
    expect(position.side).toBe('left')
    expect(position.x).toBe(1180 - 260 - 8)
    // Mittig zur Zeile des Griffs.
    expect(position.y).toBe(200 + 15 / 2 - 36 / 2)
  })

  it('weicht nach unten aus, wenn links kein Platz ist', () => {
    const position = positionFor({ left: 40, top: 300, width: 15, height: 15 }, bubble, viewport)
    expect(position.side).toBe('bottom')
    expect(position.y).toBe(300 + 15 + 8)
  })

  it('geht nach oben, wenn unten der Rand kommt', () => {
    const position = positionFor({ left: 40, top: 880, width: 15, height: 15 }, bubble, viewport)
    expect(position.side).toBe('top')
    expect(position.y).toBe(880 - 36 - 8)
  })

  it('hält die Blase im Fenster, auch wenn der Griff am Rand klebt', () => {
    const position = positionFor({ left: 4, top: 300, width: 15, height: 15 }, bubble, viewport)
    expect(position.x).toBeGreaterThanOrEqual(8)
    expect(position.x + bubble.width).toBeLessThanOrEqual(viewport.width - 8)
  })

  it('klemmt eine seitliche Blase nicht aus dem Bild, wenn der Griff ganz unten steht', () => {
    const position = positionFor(inPanel(890), bubble, viewport)
    expect(position.side).toBe('left')
    expect(position.y + bubble.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  it('bleibt am Griff, wenn das Fenster 0×0 meldet', () => {
    // Die Browser-Pane meldet das, sobald sie unsichtbar ist. Ohne Rückfall
    // klemmte jede Rechnung die Blase in die linke obere Ecke — sie stand dann
    // als Kasten am Fensterrand, weit weg von ihrem Griff.
    const position = positionFor(inPanel(200), bubble, { width: 0, height: 0 })
    expect(position.side).toBe('left')
    expect(position.x).toBe(1180 - 260 - 8)
    expect(position.y).toBeGreaterThan(100)
  })
})
