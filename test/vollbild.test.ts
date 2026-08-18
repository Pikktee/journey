import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { vollbildMoeglich, imVollbild, betreteVollbild, verlasseVollbild } from '../src/vollbild'

// Die Umgebung ist `node` (vitest.config.js) — es gibt also kein `document`.
// Das ist hier kein Hindernis, sondern der Punkt: Das Modul fragt nur nach
// FÄHIGKEITEN, nie nach einem Gerät, und darf an keiner fehlenden Fähigkeit
// hängen bleiben.

type Stub = Record<string, unknown>

const setzeDokument = (d: Stub | null) => {
  if (d) (globalThis as unknown as { document: unknown }).document = d
  else delete (globalThis as unknown as { document?: unknown }).document
}

let urspruenglich: unknown
beforeEach(() => {
  urspruenglich = (globalThis as unknown as { document?: unknown }).document
})
afterEach(() => {
  setzeDokument((urspruenglich as Stub) ?? null)
  vi.restoreAllMocks()
})

describe('vollbildMoeglich', () => {
  it('sagt nein, wo der Browser es nicht kann (iPhone vor Safari 26, iframe ohne allow)', () => {
    setzeDokument({ fullscreenEnabled: false, documentElement: {} })
    expect(vollbildMoeglich()).toBe(false)
  })

  it('nimmt auch die alte Schreibweise mit `webkit`', () => {
    setzeDokument({ webkitFullscreenEnabled: true, documentElement: {} })
    expect(vollbildMoeglich()).toBe(true)
  })
})

describe('betreteVollbild', () => {
  it('ruft gar nicht erst, wenn der Browser es nicht kann', () => {
    const requestFullscreen = vi.fn()
    setzeDokument({ fullscreenEnabled: false, documentElement: { requestFullscreen } })
    betreteVollbild()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('ruft nicht zweimal, wenn schon Vollbild steht', () => {
    const requestFullscreen = vi.fn()
    setzeDokument({
      fullscreenEnabled: true,
      fullscreenElement: {},
      documentElement: { requestFullscreen },
    })
    expect(imVollbild()).toBe(true)
    betreteVollbild()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('ruft mit Vorsatz, wo es die unpräfixierte Fassung nicht gibt', () => {
    const webkitRequestFullscreen = vi.fn()
    setzeDokument({ webkitFullscreenEnabled: true, documentElement: { webkitRequestFullscreen } })
    betreteVollbild()
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce()
  })

  // Die eigentliche Zusage des Moduls: Vollbild ist Komfort, Abspielen ist der
  // Zweck. Beide Wege, auf denen ein Browser ablehnen kann, dürfen den
  // Start-Handler nicht abreißen — sonst startet die Tour nicht, WEIL das
  // Vollbild nicht klappte.
  it('bricht nicht ab, wenn der Aufruf wirft', () => {
    setzeDokument({
      fullscreenEnabled: true,
      documentElement: {
        requestFullscreen: () => {
          throw new TypeError('nicht erlaubt')
        },
      },
    })
    expect(() => betreteVollbild()).not.toThrow()
  })

  it('lässt keine unbehandelte Ablehnung zurück, wenn das Promise scheitert', async () => {
    const abgelehnt = Promise.reject(new TypeError('keine Nutzergeste'))
    setzeDokument({ fullscreenEnabled: true, documentElement: { requestFullscreen: () => abgelehnt } })
    expect(() => betreteVollbild()).not.toThrow()
    // Hängt an der Ablehnung noch kein `catch`, meldet Node sie beim nächsten
    // Durchlauf der Warteschlange als unhandledRejection.
    await new Promise((r) => setTimeout(r, 0))
    await expect(abgelehnt).rejects.toThrow()
  })
})

describe('verlasseVollbild', () => {
  it('tut nichts, wenn gar kein Vollbild steht', () => {
    const exitFullscreen = vi.fn()
    setzeDokument({ fullscreenEnabled: true, fullscreenElement: null, exitFullscreen })
    verlasseVollbild()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  it('räumt ab, wenn eines steht', () => {
    const exitFullscreen = vi.fn(() => Promise.resolve())
    setzeDokument({ fullscreenEnabled: true, fullscreenElement: {}, exitFullscreen })
    verlasseVollbild()
    expect(exitFullscreen).toHaveBeenCalledOnce()
  })

  it('bricht nicht ab, wenn das Abräumen scheitert', () => {
    setzeDokument({
      fullscreenElement: {},
      exitFullscreen: () => {
        throw new Error('nein')
      },
    })
    expect(() => verlasseVollbild()).not.toThrow()
  })
})
