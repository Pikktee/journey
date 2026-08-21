import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NAV_RETURNING_CLASS,
  SESSION_NOTICE_COOKIE,
  readProfileCache,
  rememberProfileCache,
  forgetSignedIn,
  forgetProfileCache,
  probablySignedIn,
} from '../src/session-notice'
import { appHeaderHtml } from '../src/app-nav'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('session-hinweis', () => {
  it('erkennt den Hinweis-Cookie in einem Cookie-String', () => {
    expect(probablySignedIn('')).toBe(false)
    expect(probablySignedIn('foo=bar')).toBe(false)
    expect(probablySignedIn(`${SESSION_NOTICE_COOKIE}=1`)).toBe(true)
    expect(probablySignedIn(`a=1; ${SESSION_NOTICE_COOKIE}=1; b=2`)).toBe(true)
    // Präfix darf nicht greifen
    expect(probablySignedIn(`${SESSION_NOTICE_COOKIE}_x=1`)).toBe(false)
  })

  it('hält Inline-Script und Modul auf demselben Cookie-Namen', () => {
    const html = readFileSync(join(wurzel, 'studio.html'), 'utf8')
    expect(html).toContain(`${SESSION_NOTICE_COOKIE}=`)
    expect(html).toContain('studio-signed-in')
    expect(html).toContain('html.studio-signed-in #studio-boot')
    // Der Vorgriff übersteuert `[hidden]` — aber NUR bis `zeige()` die
    // Sichtbarkeit selbst übernimmt (`studio-controlled`). Ohne diese Grenze
    // galt das !important die ganze Sitzung, und die Bibliothek stand beim
    // Öffnen des Editors sichtbar über der Karte.
    expect(html).toContain('html.studio-signed-in:not(.studio-controlled) #app-view')
    const studio = readFileSync(join(wurzel, 'src/studio/studio.ts'), 'utf8')
    expect(studio).toMatch(/classList\.add\('studio-controlled'\)/)
    // Editor-Deep-Link darf die Bibliothek nicht früh erzwingen
    expect(html).toMatch(/URLSearchParams\(location\.search\)\.get\('edit'\)/)
    expect(html).toMatch(/dabei && !\(edit && edit\.length > 0\)/)
  })

  it('blendet die Gast-Nav auf öffentlichen Seiten sofort aus', () => {
    // Das Umschalt-CSS steht seit Etappe 7 in src/page-elements.css und gilt
    // damit für alle Produkt-Seiten; die Landing hat es weiterhin selbst (sie
    // bindet die Bausteine nicht ein, ihre Kopfleiste ist eine andere).
    const bausteine = readFileSync(join(wurzel, 'src/page-elements.css'), 'utf8')
    expect(bausteine).toContain(`html.${NAV_RETURNING_CLASS} [data-guest]`)
    expect(bausteine).toContain(`html:not(.${NAV_RETURNING_CLASS}) [data-signed-in]`)

    // Landing: Markup und Regeln noch in der Seite (eigene Nav).
    const landing = readFileSync(join(wurzel, 'index.html'), 'utf8')
    expect(landing).toContain(`${SESSION_NOTICE_COOKIE}=`)
    expect(landing).toContain(NAV_RETURNING_CLASS)
    expect(landing).toContain('data-guest')
    expect(landing).toContain('data-signed-in')
    expect(landing).toContain(`html.${NAV_RETURNING_CLASS} [data-guest]`)

    // Produkt-Seiten: Cookie-Skript + Klasse in der Seite; data-guest/dabei
    // kommen aus appHeaderHtml (eine Quelle), die Regeln aus grundelemente.
    const kopf = appHeaderHtml({ active: 'gallery' })
    expect(kopf).toContain('data-guest')
    expect(kopf).toContain('data-signed-in')

    for (const datei of ['galerie.html', 'profil.html', 'konto.html']) {
      const html = readFileSync(join(wurzel, datei), 'utf8')
      expect(html, datei).toContain(`${SESSION_NOTICE_COOKIE}=`)
      expect(html, datei).toContain(NAV_RETURNING_CLASS)
      expect(html, datei).toContain('/src/page-elements.css')
      expect(html, datei).toContain('mountAppHeader')
    }
  })

  it('speichert und löscht den Profil-Cache im localStorage', () => {
    const storage: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v
      },
      removeItem: (k: string) => {
        delete storage[k]
      },
      clear: () => {},
      length: 0,
      key: () => null,
    }

    expect(readProfileCache()).toBeNull()

    rememberProfileCache({ name: 'Henrik', initial: 'H', avatarUrl: '/avatar.jpg' })
    expect(readProfileCache()).toEqual({ name: 'Henrik', initial: 'H', avatarUrl: '/avatar.jpg' })

    forgetProfileCache()
    expect(readProfileCache()).toBeNull()
  })

  it('hält Frontend und Server auf demselben Hinweis-Cookie', () => {
    const app = readFileSync(join(wurzel, 'server/src/app.ts'), 'utf8')
    expect(app).toContain(`'${SESSION_NOTICE_COOKIE}'`)
  })
})
