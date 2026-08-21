// Beweist den Mechanismus: Wieviel Zeit verwirft der Deckel `min(dt, 0.05)`?
// Gemessen an den echten Frame-Abständen derselben rAF-Kette, in der tick() läuft.
// Playwright ist keine Abhängigkeit dieses Projekts (es wird nur für Messungen
// gebraucht, nicht für Build oder Tests). Pfad über PLAYWRIGHT auflösen:
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/…
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')
const DROSSEL = Number(process.argv[2] ?? 1)
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
})
const seite = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const cdp = await seite.context().newCDPSession(seite)
await seite.goto('http://maptale.localhost:5123/tour/t_cGuHmm3vMa4ggQ', {
  waitUntil: 'domcontentloaded',
})
await seite.waitForFunction(() => window.__maptale?.tour, null, { timeout: 60000 })
await seite.evaluate(() => document.getElementById('btn-start').click())
await seite.waitForTimeout(2000)
if (DROSSEL > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: DROSSEL })
const r = await seite.evaluate(async () => {
  const d = []
  let last = performance.now()
  const bis = last + 20000
  await new Promise((fertig) => {
    const z = () => {
      const n = performance.now()
      d.push((n - last) / 1000)
      last = n
      if (n < bis) requestAnimationFrame(z)
      else fertig()
    }
    requestAnimationFrame(z)
  })
  const echt = d.reduce((a, x) => a + x, 0)
  const gezaehlt = d.reduce((a, x) => a + Math.min(x, 0.05), 0)
  const ueber = d.filter((x) => x > 0.05)
  d.sort((a, b) => a - b)
  return {
    frames: d.length,
    echt,
    gezaehlt,
    fps: d.length / echt,
    p50: d[Math.floor(d.length * 0.5)] * 1000,
    p95: d[Math.floor(d.length * 0.95)] * 1000,
    max: d[d.length - 1] * 1000,
    anteilUeber: ueber.length / d.length,
  }
})
console.log(`\n— Drosselung ${DROSSEL}× —`)
console.log(`  ${r.frames} Frames in ${r.echt.toFixed(1)} s → ${r.fps.toFixed(1)} fps`)
console.log(
  `  Frame-Zeit  p50 ${r.p50.toFixed(1)} ms · p95 ${r.p95.toFixed(1)} ms · max ${r.max.toFixed(0)} ms`,
)
console.log(`  Frames über dem 50-ms-Deckel: ${(r.anteilUeber * 100).toFixed(1)} %`)
console.log(
  `  Von ${r.echt.toFixed(1)} s Echtzeit zählt die Engine ${r.gezaehlt.toFixed(1)} s → verworfen: ${(r.echt - r.gezaehlt).toFixed(1)} s (${(((r.echt - r.gezaehlt) / r.echt) * 100).toFixed(1)} %)`,
)
await browser.close()
