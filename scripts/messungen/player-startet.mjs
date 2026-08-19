// Rauchtest: Startet der Player überhaupt?
//
// Die Frage klingt trivial und ist die einzige, die KEIN Test dieses Repos
// beantwortet: `tsc` sieht keinen Laufzeitfehler, die Vitest-Suite ist DOM-frei,
// der Build bündelt nur. Genau dadurch ist einmal ein Einzeiler durchgerutscht
// (`window.__j.anker = …`, gesetzt bevor `window.__j` existierte): Typecheck,
// 621 Tests und Build blieben grün, der Player brach beim Laden mit
// `Cannot set properties of undefined` ab und startete auf `main` nicht mehr.
//
// Fünf Sekunden Laufzeit. Wer `main.ts`, `tour.ts`, `ui.ts` oder ein Modul
// darunter anfasst, sollte ihn danach einmal laufen lassen — er prüft nicht,
// ob etwas RICHTIG ist, sondern ob überhaupt etwas läuft.
//
// Aufruf (Dev-Server über devhub, nicht selbst starten):
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/player-startet.mjs
//   TOUREN=t_abc,kohphangan node …   (Vorgabe: eine aufgezeichnete und eine kuratierte)
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')

const BASIS = process.env['MAPTALE_WEB'] ?? 'http://maptale.localhost:5123'
const TOUREN = (process.env['TOUREN'] ?? 't_cGuHmm3vMa4ggQ,kohphangan').split(',')

// Bekanntes Rauschen der lokalen Instanz: Umami ist dort nicht erreichbar.
const EGAL = [/analytics\.maptale\.io/, /status of 400/]

const browser = await chromium.launch({
  channel: 'chromium', // volles Headless: die Shell drosselt rAF (s. README, Falle 1)
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})

let fehlgeschlagen = 0
for (const tour of TOUREN) {
  const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const seite = await kontext.newPage()
  const meldungen = []
  seite.on('console', (m) => {
    if (m.type() === 'error') meldungen.push(m.text())
  })
  seite.on('pageerror', (e) => meldungen.push(`pageerror: ${e.message}`))

  let stand = { ok: false, grund: 'unbekannt' }
  try {
    await seite.goto(`${BASIS}/tour/${tour}`, { waitUntil: 'domcontentloaded' })
    // `__j.tour` entsteht erst im `map.on('load')`-Callback — damit deckt das
    // Warten die ganze Kette ab: Modul geladen, Tour-Daten da, Karte bereit.
    await seite.waitForFunction(() => window.__j?.tour, null, { timeout: 45000 })
    await seite.evaluate(() => document.getElementById('btn-start').click())
    await seite.waitForTimeout(2500)
    stand = await seite.evaluate(() => {
      const t = window.__j.tour
      return {
        ok: t.s >= 0 && Number.isFinite(t.s),
        grund: '',
        phase: t.phase,
        s: Math.round(t.s),
        anker: window.__j.anker ?? '—',
        achse: window.__j.filmachse ? Math.round(window.__j.filmachse.gesamtS) + ' s' : '—',
        verworfenS: window.__j.uhr ? +window.__j.uhr.verworfenS.toFixed(2) : null,
      }
    })
  } catch (e) {
    stand = { ok: false, grund: String(e).split('\n')[0] }
  }

  const echte = meldungen.filter((m) => !EGAL.some((r) => r.test(m)))
  const gut = stand.ok && echte.length === 0
  if (!gut) fehlgeschlagen++
  console.log(`${gut ? '✓' : '✗'} ${tour}`)
  if (stand.ok) {
    console.log(
      `    Phase ${stand.phase} · km ${(stand.s / 1000).toFixed(1)} · Anker ${stand.anker} · Achse ${stand.achse}`,
    )
  } else {
    console.log(`    startet nicht: ${stand.grund}`)
  }
  for (const m of echte) console.log(`    Konsole: ${m}`)
  await kontext.close()
}

await browser.close()
if (fehlgeschlagen > 0) {
  console.error(`\n${fehlgeschlagen} von ${TOUREN.length} Touren starten nicht.`)
  process.exit(1)
}
console.log(`\n${TOUREN.length} von ${TOUREN.length} starten.`)
