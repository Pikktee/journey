// Deckt sich die Dauer eines echten Durchlaufs mit der Achse?
//
// **Abnahmekriterium für Etappe 4** (Gleichlauf-Konzept §12): unter 1 %, vorher
// 9–13 %. Gemessen wird die WANDUHR eines vollständigen Durchlaufs bei Tempo 8
// (bei 1× dauerte er so lange wie der Film) und mit dem Faktor zurückgerechnet —
// die Filmuhr läuft seit Etappe 1 in Echtzeit, ein Bildratenverlust verkürzt
// die Fahrt also nicht mehr, sondern lässt Bilder aus. Genau deshalb wird die
// verworfene Zeit mitgemeldet: Wäre sie groß, wäre die Zahl daneben.
//
// Aufruf (Dev-Server über devhub, nicht selbst starten):
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/durchlauf-gegen-achse.mjs
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')
const BASIS = 'http://maptale.localhost:5123'
const TOUREN = (process.env['TOUREN'] ?? 't_av6FvtBXV2eFEx,t_cGuHmm3vMa4ggQ,t_TeH5rXaXkTKxZm,t_MpDncFJcwYupqG').split(',')
const TEMPO = 8

const browser = await chromium.launch({ channel: 'chromium', args: ['--mute-audio'] })
for (const tour of TOUREN) {
  const seite = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await seite.goto(`${BASIS}/tour/${tour}`, { waitUntil: 'domcontentloaded' })
  await seite.waitForFunction(() => window.__j?.tour, null, { timeout: 45000 })
  const gesamt = await seite.evaluate(() => window.__j.filmachse.gesamtS)
  await seite.evaluate((t) => {
    document.getElementById('btn-start').click()
    window.__j.tour.mult = t
    window.__messung = { start: performance.now(), ende: null }
    const beobachte = () => {
      const tr = window.__j.tour
      if (tr.filmS >= window.__j.filmachse.gesamtS - 0.05 || tr.phase === 'intro' || tr.phase === 'finale') {
        if (!window.__messung.ende) window.__messung.ende = performance.now()
        return
      }
      requestAnimationFrame(beobachte)
    }
    requestAnimationFrame(beobachte)
  }, TEMPO)
  await seite.waitForFunction(() => window.__messung?.ende, null, { timeout: 180000 }).catch(() => {})
  const m = await seite.evaluate(() => ({
    wand: window.__messung.ende ? (window.__messung.ende - window.__messung.start) / 1000 : null,
    verworfen: window.__j.uhr.verworfenS,
    pausiert: window.__j.uhr.pausiertS,
  }))
  const film = m.wand === null ? null : m.wand * TEMPO
  console.log(
    `${tour}  Achse ${gesamt.toFixed(1)} s  ·  Durchlauf ${film === null ? '—' : film.toFixed(1) + ' s'}` +
      (film === null ? '' : `  ·  Abweichung ${(((film - gesamt) / gesamt) * 100).toFixed(2)} %`) +
      `  (verworfen ${m.verworfen.toFixed(2)} s)`,
  )
  await seite.context().close()
}
await browser.close()
