// App-Topbar: eine Quelle für Icons und Aktiv-Zustand auf Studio/Entdecken/Profil.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_ENTDECKEN, ICON_TOUREN, topNavHtml } from '../src/app-nav'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('app-nav', () => {
  it('markiert die aktive Seite und trägt beide Labels', () => {
    const studio = topNavHtml('studio')
    expect(studio).toContain('class="aktiv"')
    expect(studio.indexOf('Meine Touren')).toBeLessThan(studio.indexOf('Entdecken'))
    expect(studio).toMatch(/"\/app"[^>]*class="aktiv"/)
    expect(studio).not.toMatch(/"\/galerie"[^>]*class="aktiv"/)

    const galerie = topNavHtml('galerie')
    expect(galerie).toMatch(/"\/galerie"[^>]*class="aktiv"/)
    expect(galerie).not.toMatch(/"\/app"[^>]*class="aktiv"/)

    const profil = topNavHtml('profil')
    expect(profil).not.toContain('class="aktiv"')
    expect(profil).toContain('Meine Touren')
    expect(profil).toContain('Entdecken')
  })

  it('benutzt für Touren und Entdecken unterschiedliche Icons', () => {
    expect(ICON_TOUREN).not.toBe(ICON_ENTDECKEN)
    expect(ICON_TOUREN).toContain('viewBox="0 0 24 24"')
    expect(ICON_ENTDECKEN).toContain('viewBox="0 0 24 24"')
  })

  it('hält Studio, Entdecken und Profil auf denselben Nav-Icons', () => {
    const seiten = ['studio.html', 'galerie.html', 'profil.html'].map((f) =>
      readFileSync(join(wurzel, f), 'utf8'),
    )
    for (const html of seiten) {
      expect(html).toContain(ICON_TOUREN)
      expect(html).toContain(ICON_ENTDECKEN)
    }
  })
})
