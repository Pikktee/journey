#!/usr/bin/env node
/**
 * Erzeugt das Vorschaubild für geteilte Links (`public/og/maptale.jpg`, 1200 × 630).
 *
 *   node scripts/gen-og-bild.mjs
 *
 * Das ist das Bild, das WhatsApp, Slack, Mastodon oder LinkedIn neben einem
 * Maptale-Link zeigen. Es ist ABGELEITET, kein generiertes Bild: Grund ist das
 * Landing-Hero (`public/landing/hero.jpg`), darüber liegen Verlauf, Wortmarke
 * und Claim. Deshalb steht hier ein Skript und nicht bloß eine JPEG-Datei —
 * ändert sich das Hero oder die Wortmarke, wird das Bild neu gerendert statt
 * von Hand nachgebaut.
 *
 * Drei Dinge sind Absicht:
 *
 * 1. **1200 × 630.** Das ist das Maß, auf das die Vorschaukarten aller großen
 *    Dienste zuschneiden (1,91 : 1). Ein anderes Seitenverhältnis wird
 *    beschnitten — und zwar an genau der Stelle, an der die Wortmarke steht.
 * 2. **JPEG, nicht PNG.** Ein Foto als PNG ist hier gut 4 MB; mehrere Dienste
 *    holen das Bild bei jedem Teilen neu, und manche geben ab ~5 MB auf.
 * 3. **Outfit lokal einbinden.** Headless-Chromium hat keinen Netzzugang zu
 *    Google Fonts und keine Systemschrift, die passt — ohne `@font-face` auf
 *    `android/app/src/main/res/font/outfit.ttf` stünde dort Times New Roman.
 *    Dieselbe Falle wie beim Mail-Logo (s. scripts/gen-logo.mjs).
 *
 * Gerendert wird mit dem Chromium, den Playwright ohnehin im Cache hat — kein
 * npm-Paket nötig, nur der Binary.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const ZIEL = join(WURZEL, 'public/og/maptale.jpg')
const BREITE = 1200
const HOEHE = 630

/** Der Chromium aus dem Playwright-Cache — der neuste, der installiert ist. */
function findeChromium() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  const kandidaten = execFileSync('sh', [
    '-c',
    `ls -d ${cache}/chromium-* 2>/dev/null | sort -V | tail -1`,
  ])
    .toString()
    .trim()
  if (!kandidaten) throw new Error(`Kein Chromium in ${cache} — npx playwright install chromium`)
  // Der App-Name wechselte über die Playwright-Versionen („Chromium.app" →
  // „Google Chrome for Testing.app"), deshalb gesucht statt getippt.
  const bin = execFileSync('sh', [
    '-c',
    `ls -d ${kandidaten}/chrome-mac-*/*.app/Contents/MacOS/* 2>/dev/null | head -1`,
  ])
    .toString()
    .trim()
  if (!bin || !existsSync(bin)) throw new Error(`Chromium-Binary fehlt unter ${kandidaten}`)
  return bin
}

const alsDataUri = (pfad, typ) =>
  `data:${typ};base64,${readFileSync(join(WURZEL, pfad)).toString('base64')}`

const seite = `<!doctype html>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'Outfit';
    src: url('${alsDataUri('android/app/src/main/res/font/outfit.ttf', 'font/ttf')}');
    font-weight: 400 700;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${BREITE}px; height: ${HOEHE}px; overflow: hidden; }
  .karte {
    position: relative;
    width: ${BREITE}px;
    height: ${HOEHE}px;
    background: #0A0D14 url('${alsDataUri('public/landing/hero.jpg', 'image/jpeg')}') center 38% / cover no-repeat;
    font-family: 'Outfit', sans-serif;
    color: #F2EDE3;
  }
  /* Der Verlauf ist nicht Deko: Auf dem hellen Talboden des Hero wäre die
     cremefarbene Wortmarke sonst unlesbar. */
  .schleier {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(10, 13, 20, 0.55) 0%, rgba(10, 13, 20, 0) 38%),
      linear-gradient(0deg, rgba(6, 9, 14, 0.94) 8%, rgba(6, 9, 14, 0.45) 42%, rgba(6, 9, 14, 0) 68%);
  }
  .inhalt {
    position: absolute;
    left: 76px;
    right: 76px;
    bottom: 68px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .marke { display: flex; align-items: center; gap: 16px; }
  .marke img { width: 60px; height: 60px; display: block; }
  .marke span { font-size: 52px; font-weight: 600; letter-spacing: -0.02em; }
  .claim { font-size: 34px; font-weight: 400; line-height: 1.25; color: rgba(242, 237, 227, 0.86); max-width: 900px; }
  /* Ein Amber-Faden am unteren Rand — dieselbe Sonne wie im Zeichen. */
  .faden { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: linear-gradient(90deg, #F59E0B, #FF6F52); }
</style>
<div class="karte">
  <div class="schleier"></div>
  <div class="inhalt">
    <div class="marke">
      <img src="${alsDataUri('public/logo-mark.svg', 'image/svg+xml')}" alt="" />
      <span>Maptale</span>
    </div>
    <p class="claim">Deine Reisen als filmischer 3D-Flug über echtes Gelände</p>
  </div>
  <div class="faden"></div>
</div>`

const tmp = join(WURZEL, 'public/og/.og-bild.html')
const roh = join(WURZEL, 'public/og/.og-bild.png')
mkdirSync(dirname(ZIEL), { recursive: true })
writeFileSync(tmp, seite)

execFileSync(findeChromium(), [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${BREITE},${HOEHE}`,
  `--screenshot=${roh}`,
  `file://${tmp}`,
])

// sips liegt auf jedem Mac; ImageMagick wäre eine Abhängigkeit für einen
// Formatwechsel.
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', roh, '--out', ZIEL], {
  stdio: 'ignore',
})
rmSync(tmp)
rmSync(roh)

console.log(`geschrieben: ${ZIEL}`)
