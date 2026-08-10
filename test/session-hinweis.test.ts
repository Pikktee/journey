import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NAV_DABEI_KLASSE,
  SESSION_HINWEIS_COOKIE,
  leseProfilCache,
  merkeProfilCache,
  vergesseAngemeldet,
  vergesseProfilCache,
  vermutlichAngemeldet,
} from '../src/session-hinweis'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('session-hinweis', () => {
  it('erkennt den Hinweis-Cookie in einem Cookie-String', () => {
    expect(vermutlichAngemeldet('')).toBe(false)
    expect(vermutlichAngemeldet('foo=bar')).toBe(false)
    expect(vermutlichAngemeldet(`${SESSION_HINWEIS_COOKIE}=1`)).toBe(true)
    expect(vermutlichAngemeldet(`a=1; ${SESSION_HINWEIS_COOKIE}=1; b=2`)).toBe(true)
    // Präfix darf nicht greifen
    expect(vermutlichAngemeldet(`${SESSION_HINWEIS_COOKIE}_x=1`)).toBe(false)
  })

  it('hält Inline-Script und Modul auf demselben Cookie-Namen', () => {
    const html = readFileSync(join(wurzel, 'studio.html'), 'utf8')
    expect(html).toContain(`${SESSION_HINWEIS_COOKIE}=`)
    expect(html).toContain('studio-dabei')
    expect(html).toContain('html.studio-dabei #studio-boot')
    expect(html).toContain('html.studio-dabei #app-view')
    // Editor-Deep-Link darf die Bibliothek nicht früh erzwingen
    expect(html).toMatch(/URLSearchParams\(location\.search\)\.get\('edit'\)/)
    expect(html).toMatch(/dabei && !\(edit && edit\.length > 0\)/)
  })

  it('blendet die Gast-Nav auf öffentlichen Seiten sofort aus', () => {
    // Das Umschalt-CSS steht seit Etappe 7 in src/grundelemente.css und gilt
    // damit für alle Produkt-Seiten; die Landing hat es weiterhin selbst (sie
    // bindet die Bausteine nicht ein, ihre Kopfleiste ist eine andere).
    const bausteine = readFileSync(join(wurzel, 'src/grundelemente.css'), 'utf8')
    expect(bausteine).toContain(`html.${NAV_DABEI_KLASSE} [data-gast]`)
    expect(bausteine).toContain(`html:not(.${NAV_DABEI_KLASSE}) [data-dabei]`)

    for (const datei of ['index.html', 'galerie.html', 'profil.html']) {
      const html = readFileSync(join(wurzel, datei), 'utf8')
      const regeln = datei === 'index.html' ? html : html + bausteine
      expect(html, datei).toContain(`${SESSION_HINWEIS_COOKIE}=`)
      expect(html, datei).toContain(NAV_DABEI_KLASSE)
      expect(regeln, datei).toContain(`html.${NAV_DABEI_KLASSE} [data-gast]`)
      expect(regeln, datei).toContain(`html:not(.${NAV_DABEI_KLASSE}) [data-dabei]`)
      expect(html, datei).toContain('data-gast')
      expect(html, datei).toContain('data-dabei')
      // Die Regeln müssen die Seite auch erreichen.
      if (datei !== 'index.html') expect(html, datei).toContain('/src/grundelemente.css')
    }
  })

  it('speichert und löscht den Profil-Cache im localStorage', () => {
    const storage: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v },
      removeItem: (k: string) => { delete storage[k] },
      clear: () => {},
      length: 0,
      key: () => null,
    }

    expect(leseProfilCache()).toBeNull()

    merkeProfilCache({ name: 'Henrik', initial: 'H', avatarUrl: '/avatar.jpg' })
    expect(leseProfilCache()).toEqual({ name: 'Henrik', initial: 'H', avatarUrl: '/avatar.jpg' })

    vergesseProfilCache()
    expect(leseProfilCache()).toBeNull()
  })

  it('hält Frontend und Server auf demselben Hinweis-Cookie', () => {
    const app = readFileSync(join(wurzel, 'server/src/app.ts'), 'utf8')
    expect(app).toContain(`'${SESSION_HINWEIS_COOKIE}'`)
  })
})
