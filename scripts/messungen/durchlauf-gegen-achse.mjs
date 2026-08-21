// Deckt sich die Dauer eines echten Durchlaufs mit der Achse?
//
// **Abnahmekriterium für Etappe 4** (Gleichlauf-Konzept §12): unter 1 %, vorher
// 9–13 %. Gemessen wird die WANDUHR eines vollständigen Durchlaufs im
// Schnelllauf (bei 1× dauerte er so lange wie der Film) und mit dem Faktor
// zurückgerechnet — die Filmuhr läuft seit Etappe 1 in Echtzeit, ein
// Bildratenverlust verkürzt die Fahrt also nicht mehr, sondern lässt Bilder aus.
// Genau deshalb wird die verworfene Zeit mitgemeldet: Wäre sie groß, wäre die
// Zahl daneben.
//
// **Der Faktor wird je Tour gewählt, nicht fest gesetzt.** Erkannt wird das Ende
// erst im nächsten Bild, und ein Bild ist bei Tempo 8 rund 0,6 Filmsekunden —
// auf einer 54-Sekunden-Tour allein 1,1 % Messfehler. Rund 30 Sekunden Wanduhr
// je Lauf halten ihn unter zwei Zehnteln.
//
// Aufruf (Dev-Server über devhub, nicht selbst starten):
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/durchlauf-gegen-achse.mjs
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')
const BASIS = 'http://maptale.localhost:5123'
const TOUREN = (
  process.env['TOUREN'] ?? 't_av6FvtBXV2eFEx,t_cGuHmm3vMa4ggQ,t_TeH5rXaXkTKxZm,t_MpDncFJcwYupqG'
).split(',')
/** Rund 30 s Wanduhr je Lauf: kurze Touren langsamer, lange schneller. */
const tempoFuer = (gesamtS) => Math.max(1, Math.min(8, Math.round(gesamtS / 30)))

const browser = await chromium.launch({ channel: 'chromium', args: ['--mute-audio'] })
for (const tour of TOUREN) {
  const seite = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 } })
  ).newPage()
  await seite.goto(`${BASIS}/tour/${tour}`, { waitUntil: 'domcontentloaded' })
  await seite.waitForFunction(() => window.__maptale?.tour, null, { timeout: 45000 })
  const gesamt = await seite.evaluate(() => window.__maptale.filmAxis.totalS)
  const TEMPO = tempoFuer(gesamt)
  await seite.evaluate((t) => {
    document.getElementById('btn-start').click()
    window.__maptale.tour.mult = t
    window.__messung = { start: performance.now(), ende: null }
    const beobachte = () => {
      const tr = window.__maptale.tour
      if (
        tr.filmS >= window.__maptale.filmAxis.totalS - 0.05 ||
        tr.phase === 'intro' ||
        tr.phase === 'finale'
      ) {
        if (!window.__messung.ende) window.__messung.ende = performance.now()
        return
      }
      requestAnimationFrame(beobachte)
    }
    requestAnimationFrame(beobachte)
  }, TEMPO)
  await seite
    .waitForFunction(() => window.__messung?.ende, null, { timeout: 180000 })
    .catch(() => {})
  const m = await seite.evaluate(() => ({
    wand: window.__messung.ende ? (window.__messung.ende - window.__messung.start) / 1000 : null,
    verworfen: window.__maptale.clock.droppedS,
    pausiert: window.__maptale.clock.pausedS,
  }))
  const film = m.wand === null ? null : m.wand * TEMPO
  console.log(
    `${tour}  Achse ${gesamt.toFixed(1)} s  ·  ${TEMPO}×  ·  Durchlauf ${film === null ? '—' : film.toFixed(1) + ' s'}` +
      (film === null ? '' : `  ·  Abweichung ${(((film - gesamt) / gesamt) * 100).toFixed(2)} %`) +
      `  (verworfen ${m.verworfen.toFixed(2)} s)`,
  )
  await seite.context().close()
}
await browser.close()
