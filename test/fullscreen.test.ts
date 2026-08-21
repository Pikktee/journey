import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fullscreenAvailable,
  fullscreenWanted,
  isFullscreen,
  enterFullscreen,
  exitFullscreen,
} from '../src/fullscreen'

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
    expect(fullscreenAvailable()).toBe(false)
  })

  it('nimmt auch die alte Schreibweise mit `webkit`', () => {
    setzeDokument({ webkitFullscreenEnabled: true, documentElement: {} })
    expect(fullscreenAvailable()).toBe(true)
  })
})

describe('vollbildErwuenscht', () => {
  const setzeFenster = (mm: unknown) => {
    ;(globalThis as unknown as { window: unknown }).window = { matchMedia: mm }
  }
  afterEach(() => delete (globalThis as unknown as { window?: unknown }).window)

  it('sagt ja bei Finger ohne Maus (Telefon, Tablet)', () => {
    setzeFenster((q: string) => ({ matches: q === '(hover: none) and (pointer: coarse)' }))
    expect(fullscreenWanted()).toBe(true)
  })

  it('sagt nein am Schreibtisch — auch mit Berührungsbildschirm', () => {
    // Ein Notebook mit Touchscreen hat ein Trackpad: hover: hover, pointer: fine.
    setzeFenster(() => ({ matches: false }))
    expect(fullscreenWanted()).toBe(false)
  })

  it('sagt nein, wo es matchMedia gar nicht gibt', () => {
    setzeFenster(undefined)
    expect(fullscreenWanted()).toBe(false)
  })
})

describe('betreteVollbild', () => {
  it('ruft gar nicht erst, wenn der Browser es nicht kann', () => {
    const requestFullscreen = vi.fn()
    setzeDokument({ fullscreenEnabled: false, documentElement: { requestFullscreen } })
    enterFullscreen()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('ruft nicht zweimal, wenn schon Vollbild steht', () => {
    const requestFullscreen = vi.fn()
    setzeDokument({
      fullscreenEnabled: true,
      fullscreenElement: {},
      documentElement: { requestFullscreen },
    })
    expect(isFullscreen()).toBe(true)
    enterFullscreen()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it('ruft die präfixierte Fassung, wo es die andere nicht gibt', () => {
    const webkitRequestFullscreen = vi.fn()
    setzeDokument({ webkitFullscreenEnabled: true, documentElement: { webkitRequestFullscreen } })
    enterFullscreen()
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
    expect(() => enterFullscreen()).not.toThrow()
  })

  it('lässt keine unbehandelte Ablehnung zurück, wenn das Promise scheitert', async () => {
    const abgelehnt = Promise.reject(new TypeError('keine Nutzergeste'))
    setzeDokument({
      fullscreenEnabled: true,
      documentElement: { requestFullscreen: () => abgelehnt },
    })
    expect(() => enterFullscreen()).not.toThrow()
    // Hängt an der Ablehnung noch kein `catch`, meldet Node sie beim nächsten
    // Durchlauf der Warteschlange als unhandledRejection.
    await new Promise((r) => setTimeout(r, 0))
    await expect(abgelehnt).rejects.toThrow()
  })
})

describe('verlasseVollbild', () => {
  it('tut nichts, wenn gar kein Vollbild steht', () => {
    const raeumAb = vi.fn()
    setzeDokument({ fullscreenEnabled: true, fullscreenElement: null, exitFullscreen: raeumAb })
    exitFullscreen()
    expect(raeumAb).not.toHaveBeenCalled()
  })

  it('räumt ab, wenn eines steht', () => {
    const raeumAb = vi.fn(() => Promise.resolve())
    setzeDokument({ fullscreenEnabled: true, fullscreenElement: {}, exitFullscreen: raeumAb })
    exitFullscreen()
    expect(raeumAb).toHaveBeenCalledOnce()
  })

  it('bricht nicht ab, wenn das Abräumen scheitert', () => {
    setzeDokument({
      fullscreenElement: {},
      exitFullscreen: () => {
        throw new Error('nein')
      },
    })
    expect(() => exitFullscreen()).not.toThrow()
  })
})
