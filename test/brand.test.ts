// Drift-Wächter für die Marke: Die Geometrie des Zeichens „Offener Globus“ liegt zweimal im
// Repo — einmal als ausgeliefertes `public/logo-mark.svg` (erzeugt von scripts/gen-logo.mjs)
// und einmal als String in `src/brand.ts`, damit Code das Logo bauen kann. Läuft das
// auseinander, zeigt die App ein anderes Logo als die Website.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BRAND_COLORS, getBrandLogoSvg } from '../src/brand'

const mark = readFileSync(new URL('../public/logo-mark.svg', import.meta.url), 'utf8')
const pfade = [...mark.matchAll(/\sd="([^"]+)"/g)].flatMap((t) => (t[1] ? [t[1]] : []))

describe('Marke', () => {
  it('logo-mark.svg trägt Umriss-Bögen und Route', () => {
    // Zwei Bögen statt eines geschlossenen Kreises — der Umriss reißt an der Route auf.
    expect(pfade).toHaveLength(3)
    expect(pfade.filter((d) => d.includes('A 15.2 15.2'))).toHaveLength(2)
    expect(pfade.some((d) => d.startsWith('M 4.4 23.4 C'))).toBe(true)
  })

  it('getBrandLogoSvg nutzt dieselbe Geometrie wie logo-mark.svg', () => {
    const svg = getBrandLogoSvg()
    for (const d of pfade) expect(svg).toContain(d)
    expect(svg).toContain('<ellipse cx="20" cy="20" rx="8.5" ry="15.2"/>')
    expect(svg).toContain('rotate(-17 20 20)')
  })

  it('der Zielpunkt bleibt klein und creme, nicht weiß', () => {
    // Der alte weiße Punkt (r 2,5) war der stärkste Kontrast im Zeichen und zog den Blick
    // an den äußersten Rand.
    for (const quelle of [mark, getBrandLogoSvg()]) {
      expect(quelle).toContain(`r="1.9" fill="${BRAND_COLORS.text}"`)
      // Weiß bleibt der Wortmarke vorbehalten, kein Punkt im Zeichen trägt es.
      expect(quelle).not.toMatch(/<circle[^>]*fill="#FFF(FFF)?"/i)
    }
  })

  it('die Wortmarke steht rechts neben dem Zeichen', () => {
    expect(getBrandLogoSvg()).toContain('>Maptale</text>')
    expect(getBrandLogoSvg({ showText: false })).not.toContain('<text')
  })
})
