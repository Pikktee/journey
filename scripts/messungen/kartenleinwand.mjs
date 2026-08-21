// Abnahme der Kartenleinwand, Etappe 2 — die zwei Zahlen, die ins Konzept gehören.
//
// docs/concepts/konzept_kartenleinwand.md, Etappe 2 und §5A. Drei Messungen,
// von denen keine im Unit-Test möglich ist, weil alle drei eine echte Leinwand
// und ein echtes Foto brauchen:
//
//   1. BILDVERGLEICH bei gleichem Format. Der Player malt mit
//      `bedienungSteht`/`ruhig` nach Umgebung und ohne Schleier (der liegt als
//      DOM darunter), der Film ohne Bedienung und mit flacher Füllung. Verglichen
//      wird die KARTE — sie muss Pixel für Pixel dieselbe sein. Der Schleier
//      darf abweichen: benannte Bühnen-Variante (§4).
//      `body.ui-clean` ist Pflicht, sonst vergleicht man den Stand der
//      Steuerleiste (§5, „Skalierungsmodell").
//   2. ENTWICKELN-TOLERANZ. Die 1,6 s des „Entwickelns" sind eine Überblendung
//      zweier gepufferter Fassungen und nicht `ctx.filter` pro Frame (§5A).
//      Das ist eine NÄHERUNG: Die drei Filterwerte multiplizieren sich, und
//      `brightness(1.45)` schneidet Lichter ab. Gemessen wird gegen die
//      ideale Kurve — Anfang und Ende exakt, dazwischen eine Toleranz, die
//      hier ERMITTELT und nicht geraten wird.
//   3. LEISTUNG am selben Halt. Frame-Zeit über die ganze Standzeit.
//
// Aufruf (Dev-Server über devhub, nicht selbst starten):
//   PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/kartenleinwand.mjs
//   MAPTALE_WEB=http://journey-vorher.localhost:5125 NUR=leistung node …   (Vorher-Messung)

const { chromium } = await import(process.env['PLAYWRIGHT'] ?? 'playwright')

const BASIS = process.env['MAPTALE_WEB'] ?? 'http://maptale.localhost:5123'
const TOUR = process.env['TOUR'] ?? 'kohphangan'
const NUR = process.env['NUR'] ?? 'alles'
/** Das Format der Abnahme — Player und Film bekommen genau dieses. */
const FORMAT = { width: 1920, height: 1080 }

const browser = await chromium.launch({
  channel: 'chromium', // volles Headless: die Shell drosselt rAF (s. README, Falle 1)
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const kontext = await browser.newContext({ viewport: FORMAT })
const seite = await kontext.newPage()
seite.on('pageerror', (e) => console.log(`  ! Seitenfehler: ${e.message}`))

await seite.goto(`${BASIS}/tour/${TOUR}`, { waitUntil: 'domcontentloaded' })
await seite.waitForFunction(() => window.__maptale?.tour, null, { timeout: 60000 })
await seite.evaluate(() => document.getElementById('btn-start').click())

// In den ersten Foto-Halt, und zwar auf eine Filmsekunde NACH dem Entwickeln:
// Dort gilt der harte Vergleich (Etappe 2, „Zwei Zeitfenster, zwei Maßstäbe").
const halt = await seite.evaluate(() => {
  const a = window.__maptale.filmAxis
  const h = a.stops.find((x) => x.stop)
  return h ? { von: h.filmVon, bis: h.filmBis, gesamt: a.totalS } : null
})
if (!halt) {
  console.log('✗ kein Foto-Halt in der Achse — nichts zu messen')
  await browser.close()
  process.exit(1)
}

// `ui-clean` von Hand: Der Auto-Rückzug braucht 3,2 s Ruhe, und ohne ihn
// vergleicht der Test die Steuerleiste mit.
//
// Und die Wiedergabe bleibt AN, bis der Stand steht: Die Karte ist eine Funktion
// der Filmzeit, aber gemalt wird sie im Kopfschritt — bei angehaltener Uhr läuft
// keiner, und `kartenStand()` wäre `null`. Erst danach anhalten, damit der
// Vergleich auf einer stehenden Filmsekunde rechnet.
await seite.evaluate((h) => {
  document.body.classList.add('ui-clean')
  window.__maptale.tour.setPlaying(true)
  window.__maptale.tour.seek((h.von + 3) / h.gesamt)
}, halt)
await seite.waitForTimeout(900)
await seite.evaluate(() => window.__maptale.tour.setPlaying(false))
await seite.waitForTimeout(200)

const stand = await seite.evaluate(() => {
  const t = window.__maptale.tour
  return {
    filmS: t.filmS,
    liegt: !!document.getElementById('card'),
    hatStand: !!window.__maptale.cardState(),
  }
})
if (!stand.liegt || !stand.hatStand) {
  console.log(`✗ keine Karte auf der Bühne (Leinwand ${stand.liegt}, Stand ${stand.hatStand})`)
  await browser.close()
  process.exit(1)
}
console.log(`  Halt bei Filmsekunde ${stand.filmS.toFixed(2)} (Klip-Stand steht)`)

/** Zwei Bildpuffer gleicher Größe vergleichen: Maximum und Mittel je Kanal. */
const VERGLEICH = `(a, b) => {
  let max = 0, summe = 0, n = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(a[i + k] - b[i + k])
      if (d > max) max = d
      summe += d
      n++
    }
  }
  return { max, mittel: summe / n }
}`

let fehler = 0

// — 1. Bildvergleich Bühne gegen Film, gleiches Format —
if (NUR === 'alles' || NUR === 'bild') {
  const ergebnis = await seite.evaluate(async (code) => {
    const maler = await import('/src/card-painter.ts')
    const vergleiche = eval(code)
    const breite = window.innerWidth
    const hoehe = window.innerHeight
    // Denselben Stand zweimal malen: einmal wie der Bildschirm ihn bekommt,
    // einmal wie der Film. Die Eingaben sind bis auf die beiden benannten
    // Unterschiede identisch — es ist derselbe Maler und derselbe Klip.
    const stand = window.__maptale.cardState()
    const male = (buehne) => {
      const c = document.createElement('canvas')
      c.width = breite
      c.height = hoehe
      const x = c.getContext('2d')
      const e = maler.paintCard(x, { width: breite, height: hoehe, ...buehne }, stand)
      return { ctx: x, rects: e.rects }
    }
    const buehne = male({ controls: 0, calm: false, scrim: 'off' })
    const film = male({ controls: 0, calm: false, scrim: 'flat' })
    if (!buehne.rects) return { fehler: 'Karte liegt nicht auf der Bühne' }
    const r = buehne.rects.card
    const g = maler.cardGeometry({ width: breite, height: hoehe }, stand.medium, {
      factsOwnLine: false,
    })
    // Verglichen wird das INNERE der Karte, um den Eckenradius eingerückt: Dort
    // ist das Papier deckend, und nur dort ist der Schleier ohne Einfluss. Durch
    // die runden Ecken und den weichen Schatten schaut er hindurch — das ist die
    // benannte Bühnen-Variante und kein Fehler. Wer über den ganzen
    // Umschließungskasten vergleicht, misst genau den einen Unterschied, der
    // erlaubt ist (gemessen: max 68 von 255 an den Kanten).
    const rand = Math.ceil(g.cardRadius) + 1
    const kasten = [
      Math.round(r.x) + rand,
      Math.round(r.y) + rand,
      Math.round(r.width) - rand * 2,
      Math.round(r.height) - rand * 2,
    ]
    const a = buehne.ctx.getImageData(...kasten).data
    const b = film.ctx.getImageData(...kasten).data
    // Und die GEOMETRIE muss über beide Wege dieselbe sein — das ist die Aussage
    // des Skalierungsmodells, und ein Pixelvergleich allein würde sie verfehlen,
    // wenn sich beide Seiten gleich verschöben.
    const gleich = JSON.stringify(buehne.rects) === JSON.stringify(film.rects)
    return {
      ...vergleiche(a, b),
      gleich,
      flaeche: `${kasten[2]}×${kasten[3]}`,
      karte: { breite: Math.round(r.width), hoehe: Math.round(r.height) },
      bild: { breite: Math.round(g.image.width), hoehe: Math.round(g.image.height) },
      titelPx: Number(g.text.title.fontPx.toFixed(2)),
      mass: buehne.rects.scale,
      lage: buehne.rects.layout,
    }
  }, VERGLEICH)

  if (ergebnis.fehler) {
    console.log(`✗ Bildvergleich: ${ergebnis.fehler}`)
    fehler++
  } else {
    const ok = ergebnis.max === 0 && ergebnis.gleich
    console.log(`${ok ? '✓' : '✗'} Bildvergleich Bühne ↔ Film bei ${FORMAT.width}×${FORMAT.height}`)
    console.log(
      `    Karte ${ergebnis.karte.breite}×${ergebnis.karte.hoehe} px · Bild ${ergebnis.bild.breite}×${ergebnis.bild.hoehe} · Titel ${ergebnis.titelPx} px · Maßstab ${ergebnis.mass.toFixed(3)} · Lage ${ergebnis.lage}`,
    )
    console.log(`    Geometrie identisch: ${ergebnis.gleich ? 'ja' : 'NEIN'}`)
    console.log(
      `    Abweichung im Karteninneren (${ergebnis.flaeche}): max ${ergebnis.max}, Mittel ${ergebnis.mittel.toFixed(4)} (von 255)`,
    )
    if (!ok) fehler++
  }
}

// — 2. Toleranz des „Entwickelns" —
if (NUR === 'alles' || NUR === 'entwickeln') {
  const ergebnis = await seite.evaluate(async (code) => {
    const maler = await import('/src/card-painter.ts')
    const { CARD } = await import('/src/card-timing.ts')
    const vergleiche = eval(code)
    const stand = window.__maptale.cardState()
    if (!stand.source) return { fehler: 'keine Zeichenquelle' }
    const breite = window.innerWidth
    const hoehe = window.innerHeight
    const g = maler.cardGeometry({ width: breite, height: hoehe }, stand.medium, {
      factsOwnLine: false,
    })

    /** Das IDEAL: ein `ctx.filter` mit der interpolierten Kurve, pro Bild neu. */
    const ideal = (t) => {
      const c = document.createElement('canvas')
      c.width = Math.round(g.image.width)
      c.height = Math.round(g.image.height)
      const x = c.getContext('2d')
      const w = (von, bis) => von + (bis - von) * t
      x.filter = `brightness(${w(CARD.developFrom.brightness, CARD.developTo.brightness)}) contrast(${w(CARD.developFrom.contrast, CARD.developTo.contrast)}) saturate(${w(CARD.developFrom.saturate, CARD.developTo.saturate)})`
      // `cover` wie im Maler, aber ohne Ken Burns: Gemessen wird der FILTER.
      const q = stand.source
      const arQ = q.width / q.height
      const arR = c.width / c.height
      let zb = c.width
      let zh = c.height
      if (arQ > arR) zb = c.height * arQ
      else zh = c.width / arQ
      x.drawImage(q.image, (c.width - zb) / 2, (c.height - zh) / 2, zb, zh)
      return x.getImageData(0, 0, c.width, c.height).data
    }

    /** Die FASSUNG des Malers: zwei Puffer, eine Überblendung. */
    const gemalt = (t) => {
      const c = document.createElement('canvas')
      c.width = Math.round(g.image.width)
      c.height = Math.round(g.image.height)
      const x = c.getContext('2d')
      const mach = (filter) => {
        const p = document.createElement('canvas')
        p.width = c.width
        p.height = c.height
        const y = p.getContext('2d')
        y.filter = filter
        const q = stand.source
        const arQ = q.width / q.height
        const arR = c.width / c.height
        let zb = c.width
        let zh = c.height
        if (arQ > arR) zb = c.height * arQ
        else zh = c.width / arQ
        y.drawImage(q.image, (p.width - zb) / 2, (p.height - zh) / 2, zb, zh)
        return p
      }
      const f = (v) => `brightness(${v.brightness}) contrast(${v.contrast}) saturate(${v.saturate})`
      if (t < 1) x.drawImage(mach(f(CARD.developFrom)), 0, 0)
      if (t > 0) {
        x.globalAlpha = t
        x.drawImage(mach(f(CARD.developTo)), 0, 0)
      }
      return x.getImageData(0, 0, c.width, c.height).data
    }

    const proben = []
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      proben.push({ t, ...vergleiche(gemalt(t), ideal(t)) })
    }
    return { proben, dauerS: CARD.developDurationS }
  }, VERGLEICH)

  if (ergebnis.fehler) {
    console.log(`✗ Entwickeln-Toleranz: ${ergebnis.fehler}`)
    fehler++
  } else {
    const enden = ergebnis.proben.filter((p) => p.t === 0 || p.t === 1)
    const mitte = ergebnis.proben.filter((p) => p.t > 0 && p.t < 1)
    const endenOk = enden.every((p) => p.max === 0)
    const maxMitte = Math.max(...mitte.map((p) => p.max))
    console.log(
      `${endenOk ? '✓' : '✗'} „Entwickeln" über ${ergebnis.dauerS} s: Anfang und Ende exakt`,
    )
    for (const p of ergebnis.proben) {
      console.log(
        `    t=${p.t.toFixed(2)}  max ${String(p.max).padStart(3)}  Mittel ${p.mittel.toFixed(2)}`,
      )
    }
    console.log(`    → Toleranz für das Fenster: ${maxMitte} von 255 im Maximum`)
    if (!endenOk) fehler++
  }
}

// — 3. Leistung über die ganze Standzeit —
if (NUR === 'alles' || NUR === 'leistung') {
  await seite.evaluate((h) => {
    window.__maptale.tour.seek(Math.max(0, h.von - 0.6) / h.gesamt)
    window.__maptale.tour.setPlaying(true)
  }, halt)
  const leistung = await seite.evaluate((h) => {
    const dauerMs = (h.bis - h.von + 1.2) * 1000
    return new Promise((fertig) => {
      const dt = []
      let vor = performance.now()
      const bis = vor + dauerMs
      const schritt = (jetzt) => {
        dt.push(jetzt - vor)
        vor = jetzt
        if (jetzt < bis) requestAnimationFrame(schritt)
        else {
          const sortiert = [...dt].sort((a, b) => a - b)
          fertig({
            frames: dt.length,
            mittel: dt.reduce((s, v) => s + v, 0) / dt.length,
            median: sortiert[Math.floor(sortiert.length / 2)],
            p95: sortiert[Math.floor(sortiert.length * 0.95)],
            max: sortiert[sortiert.length - 1],
            verworfen: window.__maptale.clock?.droppedFrames ?? 0,
          })
        }
      }
      requestAnimationFrame(schritt)
    })
  }, halt)
  console.log(`✓ Frame-Zeit über den Halt (${leistung.frames} Bilder)`)
  console.log(
    `    Mittel ${leistung.mittel.toFixed(2)} ms · Median ${leistung.median.toFixed(2)} ms · p95 ${leistung.p95.toFixed(2)} ms · max ${leistung.max.toFixed(2)} ms`,
  )
  console.log(
    `    ≈ ${(1000 / leistung.mittel).toFixed(1)} Bilder/s · verworfene Frames: ${leistung.verworfen}`,
  )
}

await browser.close()
process.exit(fehler ? 1 : 0)
