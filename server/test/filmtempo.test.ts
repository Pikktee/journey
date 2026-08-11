// Drift-Wächter: Die Filmtempi im Server sind eine KOPIE der Engine-Konstanten
// aus src/tour.ts (der Server kann die Datei nicht importieren — eigener
// rootDir, kein allowJs). Läuft die Kopie auseinander, bemisst die Pipeline
// Zeitraffer-Rampen nach einem Tempo, das der Player gar nicht fährt.
//
// Dasselbe Muster sichert im Studio die Tempo-Tabelle
// (test/studio-baukasten.test.ts im Repo-Root).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BASIS_TEMPO_MS,
  HALT_AUSBLEND_S,
  HALT_ENGINE_S,
  MODUS_TEMPO,
  NAHE_M,
  aufnahmeHaltS,
  filmsekunden,
  meterFuerFilmsekunden,
  tempoMs,
} from '../src/pipeline/filmtempo.js'
import { MODI } from '../src/schema/upload.js'

const engineQuelle = (): string => readFileSync(new URL('../../src/tour.ts', import.meta.url), 'utf8')
const geoQuelle = (): string => readFileSync(new URL('../../src/geo.ts', import.meta.url), 'utf8')

describe('Filmtempo', () => {
  it('kennt genau die Modi des Austauschformats', () => {
    expect(Object.keys(MODUS_TEMPO).slice().sort()).toEqual([...MODI].slice().sort())
  })

  it('deckt sich mit MODE_SPEED der Engine', () => {
    const block = engineQuelle().match(/const MODE_SPEED = \{([^}]*)\}/)
    expect(block, 'MODE_SPEED in src/tour.ts nicht gefunden').not.toBeNull()
    const engine = Object.fromEntries(
      [...(block?.[1] ?? '').matchAll(/(\w+)\s*:\s*([\d.]+)/g)].map((m) => [m[1] as string, Number(m[2])]),
    )
    expect(engine).toEqual(MODUS_TEMPO)
  })

  it('deckt sich mit dem Basistempo der Engine', () => {
    const treffer = engineQuelle().match(/this\.baseSpeed\s*=\s*([\d.]+)/)
    expect(treffer, 'baseSpeed in src/tour.ts nicht gefunden').not.toBeNull()
    expect(Number(treffer?.[1])).toBe(BASIS_TEMPO_MS)
  })

  it('deckt sich mit den Halte-Konstanten der Engine', () => {
    // Sie bemessen, wie viel FILMzeit eine Aufnahme kostet — die Grundlage der
    // Film-Achse, über die seit Etappe 4 die Ton-Anker übersetzt werden.
    const quelle = engineQuelle()
    expect(Number(quelle.match(/const HOLD_HIDE = ([\d.]+)/)?.[1])).toBe(HALT_ENGINE_S)
    expect(Number(quelle.match(/const HOLD_AUSBLEND = ([\d.]+)/)?.[1])).toBe(HALT_AUSBLEND_S)
  })

  it('deckt sich mit dem Halt-Abstand aus src/geo.ts', () => {
    // Wer Aufnahmen anders gruppiert als der Player, webt die Halte an andere
    // Stellen der Achse — und ein Ton-Klip landete neben seinem Anker.
    expect(Number(geoQuelle().match(/export const NAHE_M = (\d+)/)?.[1])).toBe(NAHE_M)
  })

  it('bemisst eine Aufnahme wie die Engine: Video mit seiner Länge, Foto mit der Standzeit', () => {
    expect(aufnahmeHaltS({ type: 'photo' })).toBe(HALT_ENGINE_S)
    expect(aufnahmeHaltS({ type: 'photo', display: { holdS: 9 } })).toBe(9)
    expect(aufnahmeHaltS({ type: 'video', dauerS: 34.2 })).toBe(34.2)
    // `display.holdS` ist bei Video wirkungslos — der Player läuft bis zum Ende
    expect(aufnahmeHaltS({ type: 'video', dauerS: 34.2, display: { holdS: 9 } })).toBe(34.2)
    // Länge unbekannt (unverarbeiteter Altbestand): Foto-Annahme, nichts bricht
    expect(aufnahmeHaltS({ type: 'video' })).toBe(HALT_ENGINE_S)
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
