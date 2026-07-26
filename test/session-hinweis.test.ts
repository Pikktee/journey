import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SESSION_HINWEIS_COOKIE,
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
  })

  it('hält Frontend und Server auf demselben Hinweis-Cookie', () => {
    const app = readFileSync(join(wurzel, 'server/src/app.ts'), 'utf8')
    expect(app).toContain(`'${SESSION_HINWEIS_COOKIE}'`)
  })
})
