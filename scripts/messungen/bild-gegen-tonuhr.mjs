// Bilduhr gegen Tonuhr: Wie weit laufen sie unter Last auseinander?
//
// Das Bild zählt aufsummierte, bei 50 ms geklemmte Frame-Zeit (tour.ts:791),
// der Ton die Echtzeit-Uhr seines <audio>-Elements. Jedes Frame über 50 ms
// verliert die Differenz — der Ton nicht. Gemessen mit CDP-CPU-Drosselung.
// Playwright ist keine Abhängigkeit dieses Projekts (es wird nur für Messungen
// gebraucht, nicht für Build oder Tests). Pfad über PLAYWRIGHT auflösen:
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/…
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')

const TOUR = process.env['TOUR'] ?? 't_cGuHmm3vMa4ggQ'
const BASIS = process.env['MAPTALE_WEB'] ?? 'http://maptale.localhost:5123'
const DROSSEL = Number(process.argv[2] ?? 1)
const SEKUNDEN = 25

const browser = await chromium.launch({
  channel: 'chromium', // volles Headless statt chrome-headless-shell: dort läuft rAF gedrosselt
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const seite = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const cdp = await seite.context().newCDPSession(seite)

// Audio-Elemente einsammeln (hängen nicht im DOM)
await seite.addInitScript(() => {
  window.__toene = []
  const E = window.Audio
  window.Audio = function (...a) {
    const el = new E(...a)
    window.__toene.push(el)
    return el
  }
  window.Audio.prototype = E.prototype
})

await seite.goto(`${BASIS}/tour/${TOUR}`, { waitUntil: 'domcontentloaded' })
await seite.waitForFunction(() => window.__maptale?.tour, null, { timeout: 60000 })

// Frames zählen, um die tatsächliche Bildrate zu kennen
await seite.evaluate(() => {
  window.__frames = 0
  const z = () => {
    window.__frames++
    requestAnimationFrame(z)
  }
  requestAnimationFrame(z)
})

await seite.evaluate(() => document.getElementById('btn-start').click())
await seite.waitForTimeout(3000) // Anfahrrampe abwarten

if (DROSSEL > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: DROSSEL })

// Nur STETIGE Fahrt messen: Halte und Rampen raus. Je 250 ms eine Probe;
// gezählt wird ein Intervall nur, wenn Phase davor UND danach 'ride' ist und
// die Engine auf Zieltempo läuft (keine Anfahr-/Ausrollrampe).
const TEMPO = { walk: 0.4, bike: 1, moped: 1.15, jeep: 1.45, tram: 1.25, ferry: 2.5 }

const ergebnis = await seite.evaluate(
  async ([sekunden, tempoTab]) => {
    const t = window.__maptale.tour
    const warte = (ms) => new Promise((r) => setTimeout(r, ms))
    const ton0 = () => (window.__toene ?? []).find((e) => e.currentSrc && !e.paused) ?? null
    let dsSumme = 0
    let dtSumme = 0
    let zielSumme = 0
    let vorher = { s: t.s, w: performance.now(), phase: t.phase, speed: t.speed }
    const tA = ton0()
    const tonStart = tA ? tA.currentTime : null
    const wStart = performance.now()
    const fStart = window.__frames
    const ende = performance.now() + sekunden * 1000
    while (performance.now() < ende) {
      await warte(250)
      const jetzt = { s: t.s, w: performance.now(), phase: t.phase, speed: t.speed }
      const ziel = 120 * (tempoTab[t.modeAt(t.s).mode] ?? 1)
      // Zieltempo erreicht? (>97 % — schließt beide Rampen aus)
      if (
        vorher.phase === 'ride' &&
        jetzt.phase === 'ride' &&
        vorher.speed > ziel * 0.97 &&
        jetzt.speed > ziel * 0.97
      ) {
        dsSumme += jetzt.s - vorher.s
        dtSumme += (jetzt.w - vorher.w) / 1000
        zielSumme += ziel * ((jetzt.w - vorher.w) / 1000)
      }
      vorher = jetzt
    }
    const tB = ton0()
    return {
      dsSumme,
      dtSumme,
      zielSumme,
      wall: (performance.now() - wStart) / 1000,
      fps: (window.__frames - fStart) / ((performance.now() - wStart) / 1000),
      ton: tB && tonStart !== null ? tB.currentTime - tonStart : null,
    }
  },
  [SEKUNDEN, TEMPO],
)

const anteil = ergebnis.zielSumme > 0 ? ergebnis.dsSumme / ergebnis.zielSumme : Number.NaN
console.log(`\n— CPU-Drosselung ${DROSSEL}\u00d7 —`)
console.log(`  Bildrate:                 ${ergebnis.fps.toFixed(1)} fps`)
console.log(
  `  gewertete Fahrtzeit:      ${ergebnis.dtSumme.toFixed(1)} s von ${ergebnis.wall.toFixed(1)} s`,
)
console.log(`  zur\u00fcckgelegt:              ${ergebnis.dsSumme.toFixed(0)} m`)
console.log(`  bei Zieltempo erwartet:   ${ergebnis.zielSumme.toFixed(0)} m`)
console.log(`  \u2192 Bilduhr l\u00e4uft mit         ${(anteil * 100).toFixed(1)} % der Echtzeit`)
console.log(`  \u2192 Versatz zum Ton nach 5 min Film: ${((1 - anteil) * 300).toFixed(0)} s`)

await browser.close()
