// App-Chrome: eine Quelle für Header, Footer, Icons und Aktiv-Zustand.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ICON_ENTDECKEN,
  ICON_TOUREN,
  appFooterHtml,
  appHeaderHtml,
  topNavHtml,
} from '../src/app-nav'
import { pfad } from '../src/routen'

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

  it('liefert in appFooterHtml Impressum, Datenschutz und die Paket-Version', () => {
    const html = appFooterHtml()
    expect(html).toContain('fuss-marke')
    expect(html).toContain('fuss-version')
    expect(html).toMatch(/v\d+\.\d+\.\d+/)
    expect(html).toContain(`href="${pfad('impressum')}"`)
    expect(html).toContain(`href="${pfad('datenschutz')}"`)
    expect(html).toContain('Impressum')
    expect(html).toContain('Datenschutz')
    expect(html).toContain('aria-label="Rechtliches"')
    expect(html).toContain('fuss-sep')
    expect(html).toContain('·')
  })

  it('nimmt in appFooterHtml optionale Landing-Links an', () => {
    const html = appFooterHtml({
      ariaLabel: 'Fußzeile',
      links: [
        { href: '#touren', label: 'Touren' },
        { href: pfad('impressum'), label: 'Impressum' },
      ],
    })
    expect(html).toContain('aria-label="Fußzeile"')
    expect(html).toContain('href="#touren"')
    expect(html).toContain('Touren')
    expect(html).not.toContain('Datenschutz')
  })

  it('hängt die Produkt-Seiten an Header/Footer über app-nav', () => {
    const oeffentlich = ['galerie.html', 'profil.html', 'konto.html']
    for (const datei of oeffentlich) {
      const html = readFileSync(join(wurzel, datei), 'utf8')
      expect(html, datei).toContain('montiereAppHeader')
      expect(html, datei).toContain('schreibeAppFooter')
      expect(html, datei).toContain('id="app-header"')
      expect(html, datei).toContain('id="app-footer"')
      expect(html, datei).not.toMatch(/<footer[^>]*>\s*<div class="wrap">/)
    }

    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    expect(landing).toContain('schreibeAppFooter')
    expect(landing).toContain('id="app-footer"')
    expect(landing).not.toContain('foot-brand')
    expect(landing).not.toContain('class="attribution"')
    expect(landing).toContain('view-transition-name: maptale-nav')

    const studio = readFileSync(join(wurzel, 'studio.html'), 'utf8')
    expect(studio).toContain('id="app-header"')
    expect(studio).toContain('id="app-footer"')
    expect(studio).not.toContain('class="topbar"')
    expect(studio).not.toMatch(/<footer[^>]*>\s*<div class="wrap">/)

    const studioTs = readFileSync(join(wurzel, 'src/studio/studio.ts'), 'utf8')
    expect(studioTs).toContain('schreibeAppHeader')
    expect(studioTs).toContain('schreibeAppFooter')

    const admin = readFileSync(join(wurzel, 'admin.html'), 'utf8')
    expect(admin).toContain('id="app-header"')
    expect(admin).toContain('id="app-footer"')
    expect(admin).not.toContain('<header class="topbar"')
    expect(admin).not.toMatch(/--wrap:\s*1080px/)

    const adminTs = readFileSync(join(wurzel, 'src/admin/admin.ts'), 'utf8')
    expect(adminTs).toContain('montiereAppHeader')
    expect(adminTs).toContain('schreibeAppFooter')

    const konto = readFileSync(join(wurzel, 'konto.html'), 'utf8')
    expect(konto).toContain('konto-lesespalte')
    expect(konto).not.toMatch(/--wrap:\s*780px/)
  })

  it('legt auf der Landing Konto vor die Seitenanker und Meine Touren ins Panel', () => {
    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    const panel = landing.slice(landing.indexOf('id="nav-panel"'), landing.indexOf('</nav>'))
    expect(panel.indexOf('Konto')).toBeLessThan(panel.indexOf('Auf der Seite'))
    expect(panel).toMatch(/class="nav-panel-cta" data-dabei>Meine Touren/)
    expect(panel).not.toMatch(/nav-nur-xs[^>]*>Meine Touren/)
    expect(landing).toMatch(/class="nav-cta nav-hide-sm" data-dabei>Meine Touren/)
  })

  it('lässt Studio in der Landing-Nav, streicht So-funktioniert und macht daraus keine Tür', () => {
    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    const nav = landing.slice(landing.indexOf('<nav class="nav"'), landing.indexOf('</nav>'))
    const middle = nav.slice(nav.indexOf('nav-middle'), nav.indexOf('nav-end'))
    expect(middle).toContain('href="#touren"')
    expect(middle).toContain('href="#app"')
    expect(middle).toContain('href="#editor"')
    expect(middle).toContain('Studio')
    expect(middle).not.toContain('so-funktionierts')

    const panel = nav.slice(nav.indexOf('id="nav-panel"'))
    expect(panel).toContain('href="#editor"')
    expect(panel).not.toContain('so-funktionierts')

    const studio = landing.slice(
      landing.indexOf('id="editor"'),
      landing.indexOf('class="band cta-band"'),
    )
    expect(studio).not.toContain('/registrieren')
    expect(studio).not.toContain('href="/app"')
  })

  it('trägt #app-header schon im HTML deckungsgleich zu appHeaderHtml', () => {
    // Sonst blitzt beim MPA-Wechsel wieder die leere Schale — View Transition
    // hin oder her. Der Inhalt MUSS exakt schreibeAppHeader entsprechen.
    const seiten: Array<{
      file: string
      aktiv: 'studio' | 'galerie' | 'profil' | 'konto' | 'admin'
      variante?: 'studio' | 'admin' | 'oeffentlich'
    }> = [
      { file: 'galerie.html', aktiv: 'galerie' },
      { file: 'konto.html', aktiv: 'konto' },
      { file: 'profil.html', aktiv: 'profil' },
      { file: 'studio.html', aktiv: 'studio', variante: 'studio' },
      { file: 'admin.html', aktiv: 'admin', variante: 'admin' },
    ]
    for (const s of seiten) {
      const html = readFileSync(join(wurzel, s.file), 'utf8')
      const erwartet = `<div class="wrap">${appHeaderHtml({
        aktiv: s.aktiv,
        ...(s.variante ? { variante: s.variante } : {}),
      })}</div>`
      // Kein Regex auf </nav>: innen steckt schon .top-nav.
      expect(html, s.file).toContain(`id="app-header"`)
      expect(html, s.file).toContain(erwartet)
      expect(html, s.file).toContain('class="brand"')
      expect(html, s.file).toContain('class="top-nav"')
    }
  })

  it('optiert Basis und Produkt-Nav in Cross-Document View Transitions ein', () => {
    const basis = readFileSync(join(wurzel, 'src/basis.css'), 'utf8')
    expect(basis).toMatch(/@view-transition\s*\{\s*navigation:\s*auto/)
    expect(basis).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*navigation:\s*none/)

    const grund = readFileSync(join(wurzel, 'src/grundelemente.css'), 'utf8')
    expect(grund).toContain('view-transition-name: maptale-nav')
  })
})
