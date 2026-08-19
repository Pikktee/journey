import { describe, it, expect } from 'vitest'
import {
  naechsterIndex,
  zustaende,
  stufenZiele,
  blendeSchritt,
  weltGroesse,
  imBild,
} from '../src/pinmodell'

// Streckenmeter der Foto-Stopps einer Beispieltour (Koh Pha-ngan, gerundet)
const STOPPS = [756, 4228, 9184, 13440, 17304, 19292]

describe('naechsterIndex', () => {
  it('nennt den ersten Stopp, solange nichts erreicht ist', () => {
    expect(naechsterIndex(STOPPS, 0)).toBe(0)
  })

  it('zählt einen Stopp erst beim ERREICHEN als besucht, nicht davor', () => {
    expect(naechsterIndex(STOPPS, 700)).toBe(0) // 56 m vor dem Stopp: noch offen
    expect(naechsterIndex(STOPPS, 740)).toBe(1) // im 20-m-Vorlauf: gilt als erreicht
  })

  it('liegt nach dem letzten Stopp hinter dem Feld', () => {
    expect(naechsterIndex(STOPPS, 40000)).toBe(STOPPS.length)
  })
})

describe('zustaende', () => {
  it('teilt in besucht / naechster / kommend', () => {
    expect(zustaende(STOPPS, 10000)).toEqual([
      'besucht',
      'besucht',
      'besucht',
      'naechster',
      'kommend',
      'kommend',
    ])
  })

  it('kennt am Ende keinen nächsten mehr', () => {
    expect(zustaende(STOPPS, 40000)).toEqual(new Array(STOPPS.length).fill('besucht'))
  })
})

describe('stufenZiele', () => {
  const F = { vor: 2, zurueck: 1 }

  it('stellt den nächsten, den zuletzt besuchten und den zweiten kommenden voll dar', () => {
    expect(stufenZiele(6, 3, F)).toEqual([0, 0, 1, 1, 1, 0])
  })

  it('läuft am Anfang nicht ins Negative', () => {
    expect(stufenZiele(6, 0, F)).toEqual([1, 1, 0, 0, 0, 0])
  })

  it('lässt am Ende den letzten Stopp voll stehen', () => {
    expect(stufenZiele(6, 6, F)).toEqual([0, 0, 0, 0, 0, 1])
  })

  it('zeigt am Handy (vor: 1) einen Pin weniger', () => {
    expect(stufenZiele(6, 3, { vor: 1, zurueck: 1 })).toEqual([0, 0, 1, 1, 0, 0])
  })

  it('markiert immer nur einen Ausschnitt, nie alles', () => {
    const ziele = stufenZiele(40, 20, F)
    expect(ziele.filter((z) => z === 1)).toHaveLength(3)
  })
})

describe('blendeSchritt', () => {
  it('nähert sich dem Ziel, ohne es zu überschießen', () => {
    const s1 = blendeSchritt(0, 1, 0.12)
    expect(s1).toBeCloseTo(0.12, 5)
    expect(blendeSchritt(s1, 1, 0.12)).toBeGreaterThan(s1)
    expect(blendeSchritt(s1, 1, 0.12)).toBeLessThan(1)
  })

  it('rastet am Ziel ein — sonst endet die Repaint-Anforderung nie', () => {
    let stufe = 0
    for (let i = 0; i < 200; i++) stufe = blendeSchritt(stufe, 1, 0.12)
    expect(stufe).toBe(1)
  })

  it('blendet auch zurück', () => {
    let stufe = 1
    for (let i = 0; i < 200; i++) stufe = blendeSchritt(stufe, 0, 0.12)
    expect(stufe).toBe(0)
  })

  it('lässt ein erreichtes Ziel unverändert', () => {
    expect(blendeSchritt(1, 1, 0.12)).toBe(1)
  })
})

describe('weltGroesse', () => {
  // k = 2·tan(fov/2)/hPx bei fov 36,87° und 900 px Höhe
  const k = (2 * Math.tan((36.87 * Math.PI) / 180 / 2)) / 900
  const pxRef = 1 / (k * 420)
  const groesse = (px: number, d: number, perspektive = 0.82) =>
    weltGroesse(px, 1 / (k * d), pxRef, perspektive, 0.5, 1.7)

  it('ist bei perspektive = 1 bildschirmstabil (gleiche Pixelgröße in jeder Distanz)', () => {
    const px = (d: number) => groesse(17, d, 1) * (1 / (k * d))
    expect(px(200)).toBeCloseTo(px(2000), 6)
  })

  it('ist bei perspektive = 0 weltfest — solange die Pixel-Klemmung nicht greift', () => {
    // Bei D_REF = 420 m bleibt die Größe zwischen ~250 m und ~840 m ungeklemmt; weiter
    // außen begrenzen PX_MIN/PX_MAX bewusst (Intro-Anflug, Foto-Orbit).
    expect(groesse(17, 300, 0)).toBeCloseTo(groesse(17, 700, 0), 6)
    expect(groesse(17, 200, 0)).toBeLessThan(groesse(17, 300, 0)) // geklemmt → kleiner
  })

  it('wächst mit der Distanz — aber schwächer als die Distanz selbst', () => {
    const nah = groesse(17, 200)
    const fern = groesse(17, 2000)
    expect(fern).toBeGreaterThan(nah)
    expect(fern / nah).toBeLessThan(10) // rein weltfest wäre Faktor 1, bildschirmstabil 10
  })

  it('klemmt Extremdistanzen: der Intro-Anflug sprengt das Bild nicht', () => {
    const pxBei = (d: number) => groesse(17, d) * (1 / (k * d))
    expect(pxBei(50_000)).toBeLessThanOrEqual(17 * 1.7 + 1e-9)
    expect(pxBei(20)).toBeGreaterThanOrEqual(17 * 0.5 - 1e-9)
  })

  it('hält die Proportion zwischen Kopf und Mast über alle Distanzen', () => {
    const v = (d: number) => groesse(74, d) / groesse(17, d)
    expect(v(200)).toBeCloseTo(v(3000), 6)
  })
})

describe('imBild', () => {
  it('nimmt Punkte im Bild und knapp daneben', () => {
    expect(imBild(0, 0, 100)).toBe(true)
    expect(imBild(1.1, 0.2, 100)).toBe(true) // Rand: halber Kopf ragt herein
  })

  it('verwirft, was hinter der Kamera oder weit außerhalb liegt', () => {
    expect(imBild(0, 0, -5)).toBe(false)
    expect(imBild(4, 0, 100)).toBe(false)
    expect(imBild(0, -3, 100)).toBe(false)
  })
})
