// Bild gegen Ton nach einer Zeit im HINTERGRUND.
//
// Der Drosselungs-Lauf (bild-gegen-tonuhr.mjs) sieht diesen Fall nicht: Dort
// laufen beide Uhren, nur unterschiedlich schnell. Im Hintergrund steht die
// eine ganz — die <audio>-Elemente aber nicht, sie hängen an der Wanduhr des
// Browsers. Genau das war der Befund aus §4.1 des Konzepts, und genau das
// prüft dieses Skript.
//
// Es läuft ZWEIMAL: einmal wie ausgeliefert, einmal mit überschriebenem
// `uhr.laeuft` — also mit dem Gate-Verhalten, das der Ton vor dem Nachtrag
// hatte. Ein Lauf allein zeigte nur einen Zustand; zwei zeigen die Wirkung.
//
// Der Hintergrund muss HERGESTELLT werden, und die Reihenfolge ist Teil der
// Sache: erst die rAF-Kette kappen (im Hintergrund-Tab feuert sie nicht mehr —
// läuft sie weiter, hebt die Selbstheilung der Uhr die Pause nach zwei Frames
// wieder auf), dann `visibilityState: 'hidden'` samt Ereignis.
// `page.bringToFront()` taugt dafür NICHT: In Headless erzeugt es weder das
// Ereignis noch hält es rAF an (s. Falle 5 in README.md).
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')

const TOUR = 't_cGuHmm3vMa4ggQ'
const BASIS = process.env['MAPTALE_WEB'] ?? 'http://maptale.localhost:5123'
const HINTERGRUND_MS = 6000

async function lauf(altesGate) {
  const browser = await chromium.launch({
    channel: 'chromium',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  })
  const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const seite = await kontext.newPage()
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
  await seite.waitForFunction(() => window.__j?.tour, null, { timeout: 60000 })
  await seite.evaluate(() => document.getElementById('btn-start').click())
  await seite.waitForTimeout(4000)

  if (altesGate) {
    await seite.evaluate(() => {
      Object.defineProperty(window.__j.tour.uhr, 'laeuft', { get: () => true, configurable: true })
    })
  }

  const ergebnis = await seite.evaluate(async (msImHintergrund) => {
    const t = window.__j.tour
    const warte = (ms) => new Promise((r) => setTimeout(r, ms))
    const tonEl = () => (window.__toene ?? []).find((e) => e.currentSrc)
    const ton = tonEl()
    const vorher = {
      s: t.s,
      ton: ton ? ton.currentTime : null,
      quelle: ton?.currentSrc.split('/').pop() ?? null,
    }

    // 1. rAF-Kette kappen — wie im Hintergrund-Tab.
    const echtesRaf = window.requestAnimationFrame.bind(window)
    let frames = 0
    window.requestAnimationFrame = () => {
      frames++
      return 0
    }
    // 2. Seite als versteckt melden.
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await warte(msImHintergrund)

    const mitten = {
      s: t.s,
      ton: ton ? ton.currentTime : null,
      tonLaeuft: ton ? !ton.paused : null,
    }

    // 3. Zurück in den Vordergrund.
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.requestAnimationFrame = echtesRaf
    echtesRaf(window.__j.tour.tick.bind(window.__j.tour)) // Kette wieder anwerfen
    await warte(500)

    const nachher = {
      s: t.s,
      ton: ton ? ton.currentTime : null,
      tonLaeuft: ton ? !ton.paused : null,
    }
    return {
      vorher,
      mitten,
      nachher,
      angefragteFrames: frames,
      uhr: {
        pausen: t.uhr.pausen,
        pausiertS: t.uhr.pausiertS,
        selbstweiter: t.uhr.selbstweiter,
        verworfenS: t.uhr.verworfenS,
      },
    }
  }, HINTERGRUND_MS)
  await browser.close()
  return ergebnis
}

for (const altesGate of [true, false]) {
  const e = await lauf(altesGate)
  const dS = e.mitten.s - e.vorher.s
  const dTon = e.vorher.ton !== null ? e.mitten.ton - e.vorher.ton : null
  console.log(`\n— ${altesGate ? 'altes Gate (uhr.laeuft überschrieben)' : 'wie ausgeliefert'} —`)
  console.log(`  Tonquelle:              ${e.vorher.quelle ?? '(keine)'}`)
  console.log(`  Bild im Hintergrund:    ${dS.toFixed(1)} m`)
  console.log(
    `  Ton im Hintergrund:     ${dTon === null ? '(kein Element)' : `+${dTon.toFixed(2)} s`} (läuft: ${e.mitten.tonLaeuft})`,
  )
  console.log(`  rAF-Anfragen (gekappt): ${e.angefragteFrames}`)
  console.log(
    `  Uhr: pausen=${e.uhr.pausen} pausiertS=${e.uhr.pausiertS.toFixed(2)} selbstweiter=${e.uhr.selbstweiter}`,
  )
  console.log(
    `  nach der Rückkehr:      Ton läuft: ${e.nachher.tonLaeuft}, Bild +${(e.nachher.s - e.mitten.s).toFixed(1)} m`,
  )
}
