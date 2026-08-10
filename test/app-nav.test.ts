// App-Topbar: eine Quelle für Icons, Markup und Aktiv-Zustand.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ICON_ENTDECKEN,
  ICON_TOUREN,
  appHeaderHtml,
  topNavHtml,
} from '../src/app-nav'

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

  it('liefert in appHeaderHtml dieselben Icons wie topNavHtml', () => {
    const html = appHeaderHtml({ aktiv: 'galerie' })
    expect(html).toContain(ICON_TOUREN)
    expect(html).toContain(ICON_ENTDECKEN)
    expect(html).toContain('class="brand"')
    expect(html).toContain('nav-right')
    expect(html).toContain('Anmelden')
  })

  it('trägt Studio- und Admin-Varianten', () => {
    const studio = appHeaderHtml({ aktiv: 'studio', variante: 'studio' })
    expect(studio).toContain('id="neu-oben"')
    expect(studio).toContain('id="benutzer-chip"')
    expect(studio).toContain('Neue Tour')

    const admin = appHeaderHtml({ aktiv: 'admin', variante: 'admin' })
    expect(admin).toContain('id="nav-rechts"')
    expect(admin).not.toContain('Anmelden')
  })

  it('hängt die Produkt-Seiten an appHeaderHtml über montiereAppHeader / schreibeAppHeader', () => {
    const oeffentlich = ['galerie.html', 'profil.html', 'konto.html']
    for (const datei of oeffentlich) {
      const html = readFileSync(join(wurzel, datei), 'utf8')
      expect(html, datei).toContain('montiereAppHeader')
      expect(html, datei).toContain('id="app-header"')
      expect(html, datei).not.toContain(ICON_TOUREN)
    }

    const studio = readFileSync(join(wurzel, 'studio.html'), 'utf8')
    expect(studio).toContain('id="app-header"')
    expect(studio).not.toContain('class="topbar"')
    expect(studio).not.toContain(ICON_TOUREN)

    const studioTs = readFileSync(join(wurzel, 'src/studio/studio.ts'), 'utf8')
    expect(studioTs).toContain('schreibeAppHeader')

    const admin = readFileSync(join(wurzel, 'admin.html'), 'utf8')
    expect(admin).toContain('id="app-header"')
    expect(admin).not.toContain('<header class="topbar"')

    const adminTs = readFileSync(join(wurzel, 'src/admin/admin.ts'), 'utf8')
    expect(adminTs).toContain('montiereAppHeader')
  })
})
