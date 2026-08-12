// Die Gliederung der Datenschutzerklärung: Welcher Abschnitt gilt als gelesen?
import { describe, expect, it } from 'vitest'
import { KANTE, aktiverAbschnitt } from '../src/rechtstextgliederung'

describe('Gliederung', () => {
  it('nimmt die letzte Überschrift oberhalb der Lesekante', () => {
    // Drei Abschnitte: zwei sind vorbeigescrollt, der dritte steht noch unten.
    expect(aktiverAbschnitt([-800, -120, 640])).toBe(1)
  })

  it('bleibt beim ersten Punkt, solange nichts vorbei ist', () => {
    // Seitenanfang: Alle Überschriften liegen unter der Kante. Ohne diesen Fall
    // stünde die Gliederung ganz oben ohne jede Marke da.
    expect(aktiverAbschnitt([300, 900, 1500])).toBe(0)
  })

  it('nimmt am Dokumentende den letzten Punkt', () => {
    // „Deine Rechte" am Schluss ist kürzer als das Fenster und erreicht die
    // Lesekante nie — ohne den Sonderfall bliebe die Marke zwei Abschnitte
    // zurück, ausgerechnet dort.
    expect(aktiverAbschnitt([-3000, -2000, 400], true)).toBe(2)
  })

  it('zählt eine Überschrift genau auf der Kante als erreicht', () => {
    expect(aktiverAbschnitt([-500, KANTE])).toBe(1)
    expect(aktiverAbschnitt([-500, KANTE + 1])).toBe(0)
  })

  it('kommt mit einer leeren Gliederung zurecht', () => {
    expect(aktiverAbschnitt([])).toBe(-1)
  })
})
