// Läuft der Playhead durch einen Halt — und bleibt die Regie am Ort?
//
// Abnahme für Etappe 5 (Konzept §12, „Die Leiste"). Drei Fragen, die sich nur
// im laufenden Player beantworten lassen:
//
//   1. Läuft der Kopf durch einen Foto-Halt SICHTBAR durch? Vorher stand er
//      dort still (die Leiste rechnete in Streckenanteilen, und im Halt steht
//      die Strecke) und sprang danach über die Standzeit hinweg.
//   2. Landet ein Scrub MITTEN in einem Halt — statt auf seiner Ankunft?
//   3. Bekommt die Tag/Nacht-Regie unverändert den STRECKENanteil? Das ist
//      Falle 1 des Konzepts: `frac` bedeutet seit dieser Etappe zwei Dinge, und
//      mit dem falschen wanderte die Sonne im Halt weiter, während der Film steht.
//
// Aufruf (Dev-Server über devhub, nicht selbst starten):
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/leiste-filmlinear.mjs
//   TOUREN=kohphangan,t_abc node …
const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')

const BASIS = process.env['MAPTALE_WEB'] ?? 'http://maptale.localhost:5123'
const TOUREN = (process.env['TOUREN'] ?? 't_cGuHmm3vMa4ggQ,kohphangan').split(',')

const browser = await chromium.launch({
  channel: 'chromium', // volles Headless: die Shell drosselt rAF (s. README, Falle 1)
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})

let fehler = 0
for (const tour of TOUREN) {
  const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const seite = await kontext.newPage()
  await seite.goto(`${BASIS}/tour/${tour}`, { waitUntil: 'domcontentloaded' })
  await seite.waitForFunction(() => window.__j?.tour, null, { timeout: 45000 })
  await seite.evaluate(() => document.getElementById('btn-start').click())

  // — Regie-Mitschnitt: was bekommt onTick? —
  await seite.evaluate(() => {
    const t = window.__j.tour
    const echt = t.ui.onTick
    window.__regie = []
    t.ui.onTick = (frac) => {
      window.__regie.push([frac, t.s / t.route.total])
      echt?.(frac)
    }
  })

  // — Den ersten Foto-Halt suchen und kurz davor einsteigen —
  const halt = await seite.evaluate(() => {
    const a = window.__j.filmachse
    const h = a.halte.find((x) => x.stopp)
    return h ? { von: h.filmVon, bis: h.filmBis, gesamt: a.gesamtS } : null
  })
  if (!halt) {
    console.log(`✗ ${tour}: kein Foto-Halt in der Achse`)
    fehler++
    await kontext.close()
    continue
  }

  await seite.evaluate((h) => {
    window.__j.tour.seek(Math.max(0, h.von - 1.2) / h.gesamt)
    window.__j.tour.setPlaying(true)
  }, halt)

  // Pro Frame mitschreiben: Kopfposition, Balken, Filmsekunde, Streckenmeter
  const proben = await seite.evaluate(async (h) => {
    const t = window.__j.tour
    const kopf = document.getElementById('progress-head')
    const balken = document.getElementById('prog-rect')
    const bis = performance.now() + (h.bis - h.von + 2.4) * 1000
    const raus = []
    await new Promise((fertig) => {
      const schritt = () => {
        raus.push({
          zeit: performance.now() / 1000,
          filmS: t.filmS,
          s: t.s,
          kopf: parseFloat(kopf.style.left),
          balken: parseFloat(balken.getAttribute('width')),
        })
        if (performance.now() < bis) requestAnimationFrame(schritt)
        else fertig()
      }
      requestAnimationFrame(schritt)
    })
    return raus
  }, halt)

  // Frames INNERHALB des Halts: dort steht die Strecke — der Kopf darf es nicht.
  // Gemessen wird nicht „bewegt sich in jedem Frame" (die Telemetrie läuft im
  // 10-Hz-Takt, dazwischen steht die Zahl per Konstruktion), sondern der LÄNGSTE
  // Stillstand und der zurückgelegte Weg. Vorher war beides der ganze Halt.
  const imHalt = proben.filter((p) => p.filmS > halt.von + 0.05 && p.filmS < halt.bis - 0.05)
  let laengsterStillstandS = 0
  let stehtSeit = imHalt[0]?.zeit ?? 0
  for (let i = 1; i < imHalt.length; i++) {
    if (imHalt[i].kopf > imHalt[i - 1].kopf) stehtSeit = imHalt[i].zeit
    else laengsterStillstandS = Math.max(laengsterStillstandS, imHalt[i].zeit - stehtSeit)
  }
  const kopfWeg = imHalt.length ? imHalt[imHalt.length - 1].kopf - imHalt[0].kopf : 0
  const kopfSoll = ((halt.bis - halt.von - 0.1) / halt.gesamt) * 100
  // Kontrolle, dass der Halt überhaupt einer ist: die Strecke steht still
  const streckeSpanne = imHalt.length ? imHalt[imHalt.length - 1].s - imHalt[0].s : -1

  // — Scrub in die MITTE des Halts —
  const mitte = await seite.evaluate(async (h) => {
    const t = window.__j.tour
    t.beginScrub((h.von + h.bis) / 2 / h.gesamt)
    t.scrub((h.von + h.bis) / 2 / h.gesamt)
    // Die Karte legt der nächste Kopfschritt hin — sie ist eine Funktion der
    // Filmzeit und wird im Frame gestellt, nicht im Aufruf.
    await new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))
    const karte = document.getElementById('photo-card')
    return {
      filmS: t.filmS,
      ziel: (h.von + h.bis) / 2,
      imHalt: !!t.halt,
      karteSichtbar: parseFloat(getComputedStyle(karte).opacity) > 0.01,
      kartenZeit: getComputedStyle(karte).getPropertyValue('--karte-zeit').trim(),
    }
  }, halt)

  const regie = await seite.evaluate(() => window.__regie ?? [])
  const regieAbweichung = regie.reduce((m, [frac, s]) => Math.max(m, Math.abs(frac - s)), 0)

  const ok =
    imHalt.length > 4 &&
    laengsterStillstandS < 0.35 && // 10-Hz-Takt plus Luft — nicht die Standzeit
    Math.abs(kopfWeg - kopfSoll) < 0.15 &&
    Math.abs(streckeSpanne) < 1 &&
    Math.abs(mitte.filmS - mitte.ziel) < 0.05 &&
    mitte.imHalt &&
    mitte.karteSichtbar &&
    regieAbweichung < 1e-9
  if (!ok) fehler++
  console.log(`${ok ? '✓' : '✗'} ${tour}`)
  console.log(`    Halt ${halt.von.toFixed(1)}–${halt.bis.toFixed(1)} s · ${imHalt.length} Frames darin`)
  console.log(`    Kopf wandert ${kopfWeg.toFixed(2)} % (Soll ${kopfSoll.toFixed(2)} %) · längster Stillstand ${laengsterStillstandS.toFixed(2)} s · Strecke wandert ${streckeSpanne.toFixed(2)} m`)
  console.log(`    Scrub in die Mitte: ${mitte.filmS.toFixed(2)} s (Ziel ${mitte.ziel.toFixed(2)}) · im Halt ${mitte.imHalt} · Karte ${mitte.karteSichtbar} (--karte-zeit ${mitte.kartenZeit || '—'})`)
  console.log(`    Regie bekommt den Streckenanteil, Abweichung ${regieAbweichung.toExponential(1)} (${regie.length} Takte)`)
  await kontext.close()
}

await browser.close()
console.log(`\n${TOUREN.length - fehler} von ${TOUREN.length} in Ordnung.`)
process.exit(fehler ? 1 : 0)
