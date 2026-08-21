// Wie schnell SIEHT die Fahrt aus — und wo weicht sie von der Absicht ab?
//
// Zwei Zahlen, und beide beantworten eine Beschwerde, die man sonst nur fühlen
// kann („das geht hier extrem schnell los"):
//
// 1. **Sichtbares ÷ gemeintes Tempo.** Die Filmachse rechnet in ROHEN
//    Wegpunkt-Metern, die Kamera fährt auf der gezeichneten (Catmull-Rom-)
//    Route. Wo die länger ist, muss die Kamera schneller werden — und der
//    Überschuss der Glättung sitzt in den KURVEN. Vor dem Vorverdichten
//    (`VERTEX_MAX_M` in src/geo.ts) lief Stockholm auf 2,2 % seines Films mehr
//    als 50 % zu schnell, in der Spitze 4,9-fach.
//
// 2. **Bildschirm-Tempo = Fahrtempo ÷ Kameradistanz.** Das ist ungefähr die
//    Winkelgeschwindigkeit, mit der die Landschaft durchs Bild zieht. Die Modi
//    sind darauf abgestimmt (0,167–0,202 /s über alle sechs), eine Fährfahrt
//    sieht im eingeschwungenen Zustand also so schnell aus wie ein Fußweg.
//    Auffällig wird nur der ÜBERGANG — und genau deshalb folgt die
//    Kameradistanz derselben Rampe wie das Tempo (`FilmTrack.scaleAtS`).
//
// Aufruf (Dev-Server über devhub, nicht selbst starten):
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/bildschirmtempo.mjs
//   TOUREN=stockholm,kohphangan node …
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')
const BASIS = process.env['MAPTALE_WEB'] ?? 'http://maptale.localhost:5123'
const TOUREN = (process.env['TOUREN'] ?? 'stockholm,kohphangan,oberland').split(',')

const browser = await chromium.launch({ channel: 'chromium', args: ['--mute-audio'] })
console.log(
  'Tour          sichtbar ÷ gemeint (p95 / p99 / max / Anteil > 1,5×)   Bildschirm-Tempo (p50 / p99 / max)',
)
for (const tour of TOUREN) {
  const seite = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 } })
  ).newPage()
  await seite.goto(`${BASIS}/tour/${tour}`, { waitUntil: 'domcontentloaded' })
  await seite.waitForFunction(() => window.__maptale?.tour, null, { timeout: 45000 })
  const r = await seite.evaluate(() => {
    const w = window,
      t = w.__maptale.tour,
      a = w.__maptale.filmAxis
    /** lower_bound-Interpolation wie in src/film-axis.ts — die Achse liegt als Rohdaten vor. */
    const ip = (xs, ys, x) => {
      if (x <= xs[0]) return ys[0]
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
      let lo = 0,
        hi = xs.length - 1
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (xs[m] < x) lo = m + 1
        else hi = m
      }
      const sp = xs[lo] - xs[lo - 1]
      return ys[lo - 1] + (sp > 0 ? (x - xs[lo - 1]) / sp : 1) * (ys[lo] - ys[lo - 1])
    }
    const H = 0.05
    const fehler = []
    const schirm = []
    for (let f = 0; f <= a.totalS; f += 0.05) {
      if (t.film.stopAtFilmTime(f)) continue
      const s = t.film.sAtFilmTime(f)
      const vRoute = (t.film.sAtFilmTime(f + H) - s) / H
      const vRoh = (ip(a.filmS, a.sM, f + H) - ip(a.filmS, a.sM, f)) / H
      if (vRoh > 1) fehler.push(vRoute / vRoh)
      const abstand = t.preset.behind * t.film.scaleAtS(s).behind
      if (abstand > 0 && vRoute > 1) schirm.push(vRoute / abstand)
    }
    const q = (arr, p) => {
      const x = [...arr].sort((u, v) => u - v)
      return x[Math.floor(p * (x.length - 1))] ?? NaN
    }
    return {
      f95: q(fehler, 0.95),
      f99: q(fehler, 0.99),
      fmax: q(fehler, 1),
      ueber: fehler.filter((x) => x > 1.5).length / Math.max(1, fehler.length),
      s50: q(schirm, 0.5),
      s99: q(schirm, 0.99),
      smax: q(schirm, 1),
    }
  })
  console.log(
    `${tour.padEnd(13)} ${r.f95.toFixed(2).padStart(5)} / ${r.f99.toFixed(2)} / ${r.fmax.toFixed(2)} / ${(r.ueber * 100).toFixed(2)} %` +
      `${''.padEnd(20)}${r.s50.toFixed(3)} / ${r.s99.toFixed(3)} / ${r.smax.toFixed(3)} /s`,
  )
  await seite.context().close()
}
await browser.close()
