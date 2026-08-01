// Drift-Wächter: Die Filmtempi im Server sind eine KOPIE der Engine-Konstanten
// aus src/tour.js (der Server kann die Datei nicht importieren — eigener
// rootDir, kein allowJs). Läuft die Kopie auseinander, bemisst die Pipeline
// Zeitraffer-Rampen nach einem Tempo, das der Player gar nicht fährt.
//
// Dasselbe Muster sichert im Studio die Tempo-Tabelle
// (test/studio-baukasten.test.ts im Repo-Root).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BASIS_TEMPO_MS, MODUS_TEMPO, filmsekunden, meterFuerFilmsekunden, tempoMs } from '../src/pipeline/filmtempo.js'
import { MODI } from '../src/schema/upload.js'

const engineQuelle = (): string => readFileSync(new URL('../../src/tour.js', import.meta.url), 'utf8')

describe('Filmtempo', () => {
  it('kennt genau die Modi des Austauschformats', () => {
    expect(Object.keys(MODUS_TEMPO).slice().sort()).toEqual([...MODI].slice().sort())
  })

  it('deckt sich mit MODE_SPEED der Engine', () => {
    const block = engineQuelle().match(/const MODE_SPEED = \{([^}]*)\}/)
    expect(block, 'MODE_SPEED in src/tour.js nicht gefunden').not.toBeNull()
    const engine = Object.fromEntries(
      [...(block?.[1] ?? '').matchAll(/(\w+)\s*:\s*([\d.]+)/g)].map((m) => [m[1] as string, Number(m[2])]),
    )
    expect(engine).toEqual(MODUS_TEMPO)
  })

  it('deckt sich mit dem Basistempo der Engine', () => {
    const treffer = engineQuelle().match(/this\.baseSpeed\s*=\s*([\d.]+)/)
    expect(treffer, 'baseSpeed in src/tour.js nicht gefunden').not.toBeNull()
    expect(Number(treffer?.[1])).toBe(BASIS_TEMPO_MS)
  })

  it('rechnet Strecke und Filmdauer ineinander um', () => {
    expect(tempoMs('walk')).toBe(48)
    expect(tempoMs('ferry')).toBe(300)
    // Zu Fuß dauern 240 m fünf Filmsekunden — auf der Fähre keine Sekunde
    expect(filmsekunden(240, 'walk')).toBe(5)
    expect(meterFuerFilmsekunden(5, 'walk')).toBe(240)
    expect(filmsekunden(meterFuerFilmsekunden(3, 'tram'), 'tram')).toBeCloseTo(3, 9)
  })
})
