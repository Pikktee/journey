// App-Chrome: eine Quelle für Header, Footer, Icons und Aktiv-Zustand.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_DISCOVER, ICON_TOURS, appFooterHtml, appHeaderHtml, topNavHtml } from '../src/app-nav'
import { path } from '../src/routes'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('app-nav', () => {
  it('markiert die aktive Seite und trägt beide Labels', () => {
    const studio = topNavHtml('studio')
    expect(studio).toContain('class="active"')
    expect(studio.indexOf('Meine Touren')).toBeLessThan(studio.indexOf('Entdecken'))
    expect(studio).toMatch(/"\/app"[^>]*class="active"/)
    expect(studio).not.toMatch(/"\/galerie"[^>]*class="active"/)

    const galerie = topNavHtml('gallery')
    expect(galerie).toMatch(/"\/galerie"[^>]*class="active"/)
    expect(galerie).not.toMatch(/"\/app"[^>]*class="active"/)

    const profil = topNavHtml('profile')
    expect(profil).not.toContain('class="active"')
    expect(profil).toContain('Meine Touren')
    expect(profil).toContain('Entdecken')
  })

  it('benutzt für Touren und Entdecken unterschiedliche Icons', () => {
    expect(ICON_TOURS).not.toBe(ICON_DISCOVER)
    expect(ICON_TOURS).toContain('viewBox="0 0 24 24"')
    expect(ICON_DISCOVER).toContain('viewBox="0 0 24 24"')
  })

  it('liefert in appHeaderHtml dieselben Icons wie topNavHtml', () => {
    const html = appHeaderHtml({ active: 'gallery' })
    expect(html).toContain(ICON_TOURS)
    expect(html).toContain(ICON_DISCOVER)
    expect(html).toContain('class="brand"')
    expect(html).toContain('nav-right')
    expect(html).toContain('Anmelden')
  })

  it('trägt Studio- und Admin-Varianten', () => {
    const studio = appHeaderHtml({ active: 'studio', variant: 'studio' })
    expect(studio).toContain('id="new-top"')
    expect(studio).toContain('id="user-chip"')
    expect(studio).toContain('Neue Tour')

    const admin = appHeaderHtml({ active: 'admin', variant: 'admin' })
    expect(admin).toContain('id="nav-right"')
    expect(admin).not.toContain('Anmelden')
  })

  it('liefert in appFooterHtml Impressum, Datenschutz und die Paket-Version', () => {
    const html = appFooterHtml()
    expect(html).toContain('footer-brand')
    expect(html).toContain('footer-version')
    expect(html).toMatch(/v\d+\.\d+\.\d+/)
    expect(html).toContain(`href="${path('imprint')}"`)
    expect(html).toContain(`href="${path('privacy')}"`)
    expect(html).toContain('Impressum')
    expect(html).toContain('Datenschutz')
    expect(html).toContain('aria-label="Rechtliches"')
    expect(html).toContain('footer-sep')
    expect(html).toContain('·')
  })

  it('nimmt in appFooterHtml optionale Landing-Links an', () => {
    const html = appFooterHtml({
      ariaLabel: 'Fußzeile',
      links: [
        { href: '#tours', label: 'Touren' },
        { href: path('imprint'), label: 'Impressum' },
      ],
    })
    expect(html).toContain('aria-label="Fußzeile"')
    expect(html).toContain('href="#tours"')
    expect(html).toContain('Touren')
    expect(html).not.toContain('Datenschutz')
  })

  it('hängt die Produkt-Seiten an Header/Footer über app-nav', () => {
    const oeffentlich = ['galerie.html', 'profil.html', 'konto.html']
    for (const datei of oeffentlich) {
      const html = readFileSync(join(wurzel, datei), 'utf8')
      expect(html, datei).toContain('mountAppHeader')
      expect(html, datei).toContain('writeAppFooter')
      expect(html, datei).toContain('id="app-header"')
      expect(html, datei).toContain('id="app-footer"')
      expect(html, datei).not.toMatch(/<footer[^>]*>\s*<div class="wrap">/)
    }

    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    expect(landing).toContain('writeAppFooter')
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
    expect(studioTs).toContain('writeAppHeader')
    expect(studioTs).toContain('writeAppFooter')

    const admin = readFileSync(join(wurzel, 'admin.html'), 'utf8')
    expect(admin).toContain('id="app-header"')
    expect(admin).toContain('id="app-footer"')
    expect(admin).not.toContain('<header class="topbar"')
    expect(admin).not.toMatch(/--wrap:\s*1080px/)

    const adminTs = readFileSync(join(wurzel, 'src/admin/admin.ts'), 'utf8')
    expect(adminTs).toContain('mountAppHeader')
    expect(adminTs).toContain('writeAppFooter')

    const konto = readFileSync(join(wurzel, 'konto.html'), 'utf8')
    expect(konto).toContain('account-reading-column')
    expect(konto).not.toMatch(/--wrap:\s*780px/)
  })

  it('legt auf der Landing Konto vor die Seitenanker und Meine Touren ins Panel', () => {
    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    const panel = landing.slice(landing.indexOf('id="nav-panel"'), landing.indexOf('</nav>'))
    expect(panel.indexOf('Konto')).toBeLessThan(panel.indexOf('Auf der Seite'))
    expect(panel).toMatch(/class="nav-panel-cta" data-signed-in>Meine Touren/)
    expect(panel).not.toMatch(/nav-nur-xs[^>]*>Meine Touren/)
    expect(landing).toMatch(/class="nav-cta nav-hide-sm" data-signed-in>Meine Touren/)
  })

  it('lässt Studio in der Landing-Nav, streicht So-funktioniert und macht daraus keine Tür', () => {
    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    const nav = landing.slice(landing.indexOf('<nav class="nav"'), landing.indexOf('</nav>'))
    const middle = nav.slice(nav.indexOf('nav-middle'), nav.indexOf('nav-end'))
    expect(middle).toContain('href="#tours"')
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
      active: 'studio' | 'gallery' | 'profile' | 'account' | 'admin'
      variant?: 'studio' | 'admin' | 'public'
    }> = [
      { file: 'galerie.html', active: 'gallery' },
      { file: 'konto.html', active: 'account' },
      { file: 'profil.html', active: 'profile' },
      { file: 'studio.html', active: 'studio', variant: 'studio' },
      { file: 'admin.html', active: 'admin', variant: 'admin' },
    ]
    for (const s of seiten) {
      const html = readFileSync(join(wurzel, s.file), 'utf8')
      const erwartet = `<div class="wrap">${appHeaderHtml({
        active: s.active,
        ...(s.variant ? { variant: s.variant } : {}),
      })}</div>`
      // Kein Regex auf </nav>: innen steckt schon .top-nav.
      expect(html, s.file).toContain(`id="app-header"`)
      expect(html, s.file).toContain(erwartet)
      expect(html, s.file).toContain('class="brand"')
      expect(html, s.file).toContain('class="top-nav"')
    }
  })

  it('optiert Basis und Produkt-Nav in Cross-Document View Transitions ein', () => {
    const basis = readFileSync(join(wurzel, 'src/base.css'), 'utf8')
    expect(basis).toMatch(/@view-transition\s*\{\s*navigation:\s*auto/)
    expect(basis).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*navigation:\s*none/)

    const grund = readFileSync(join(wurzel, 'src/page-elements.css'), 'utf8')
    expect(grund).toContain('view-transition-name: maptale-nav')
  })
})
