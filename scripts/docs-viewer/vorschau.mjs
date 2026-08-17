/*
 * Vorschaubilder der HTML-Mockups.
 *
 * Warum überhaupt Bilder und nicht ein `<iframe>`? Weil der Viewer als Datei
 * geöffnet wird: Chrome behandelt jede `file://`-Seite als eigene Herkunft und
 * lädt in einem Rahmen nichts nach. Ein Screenshot ist zugleich schneller —
 * zwanzig eingebettete Prototypen wären zwanzig laufende Seiten.
 *
 * Fehlt Chrome, ist das kein Fehler: Die Kacheln zeigen dann ihren Titel ohne
 * Bild (`onerror` in der Seite), und der Rest des Viewers steht.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { readdirSync } from 'node:fs'

const KANDIDATEN = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].filter(Boolean)

/** Auch der Playwright-Cache zählt — dort liegt auf diesem Rechner ein Chromium. */
function ausPlaywrightCache() {
  const wurzel = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(wurzel)) return []
  return readdirSync(wurzel)
    .filter((n) => n.startsWith('chromium'))
    .map((n) => join(wurzel, n, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
}

function findeChrome() {
  return [...KANDIDATEN, ...ausPlaywrightCache()].find((p) => p && existsSync(p)) || null
}

/**
 * @param mockups  Liste aus `sammleMockups()`
 * @param docs     absoluter Pfad auf `docs/`
 * @param ziel     absoluter Pfad auf `docs/_site`
 */
export async function nimmVorschauenAuf(mockups, docs, ziel, { neuBauen = false } = {}) {
  const offen = mockups.filter((m) => {
    const bild = join(ziel, m.vorschau)
    if (neuBauen || !existsSync(bild)) return true
    // Ein Prototyp, der sich seit der Aufnahme nicht geändert hat, wird nicht
    // noch einmal gerendert — sonst kostet jeder Lauf eine halbe Minute.
    return statSync(join(docs, m.quelle)).mtimeMs > statSync(bild).mtimeMs
  })
  if (!offen.length) return { aufgenommen: 0, uebersprungen: mockups.length, grund: '' }

  const chrome = findeChrome()
  if (!chrome)
    return {
      aufgenommen: 0,
      uebersprungen: mockups.length,
      grund: 'kein Chrome gefunden (CHROME_PATH setzen)',
    }

  let puppeteer
  try {
    puppeteer = (await import('puppeteer-core')).default
  } catch {
    return { aufgenommen: 0, uebersprungen: mockups.length, grund: 'puppeteer-core fehlt' }
  }

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--allow-file-access-from-files', '--hide-scrollbars', '--force-color-profile=srgb'],
  })
  let aufgenommen = 0
  try {
    for (const m of offen) {
      const telefon = /^app-|live-ansicht/.test(m.name)
      const seite = await browser.newPage()
      await seite.setViewport({
        width: telefon ? 460 : 1280,
        height: telefon ? 940 : 900,
        deviceScaleFactor: 2,
      })
      try {
        // `domcontentloaded` statt `networkidle0`: Ein Prototyp, der eine
        // Schrift oder ein Bild aus dem Netz zieht, wird sonst nie „ruhig" und
        // kostet jeden Lauf die volle Zeitsperre (der CI-Branding-Mockup tat
        // genau das). Die Wartezeit unten holt das Nachladen ein.
        await seite.goto('file://' + join(docs, m.quelle), {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        })
        // Web-Fonts und Bilder dürfen ankommen, bevor ausgelöst wird.
        await seite.evaluate(() => document.fonts && document.fonts.ready)
        await new Promise((r) => setTimeout(r, 700))
        const datei = join(ziel, m.vorschau)
        mkdirSync(dirname(datei), { recursive: true })
        await seite.screenshot({ path: datei, type: 'webp', quality: 80 })
        aufgenommen++
      } catch (fehler) {
        console.warn(`  ! Vorschau für ${m.quelle} misslungen: ${fehler.message}`)
      } finally {
        await seite.close()
      }
    }
  } finally {
    await browser.close()
  }
  return { aufgenommen, uebersprungen: mockups.length - offen.length, grund: '' }
}
