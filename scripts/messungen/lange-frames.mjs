// Woher kommen die einzelnen Ruckler? Frame-Abstände plus LoAF-Attribution.
//
// Der Unterschied zu frame-verlust.mjs: Der misst, wieviel Zeit ein Deckel
// verwirft, dieser hier sucht die VERURSACHER einzelner langer Frames. Chrome
// liefert dafür `long-animation-frame`-Einträge samt Skript, Funktion und
// Blockierdauer. Damit fiel auf, dass die DEM-Bereinigung im Main-Thread lief
// (30 s Fahrt: 1007 ms in 14 Aufrufen, längstes Frame 704 ms); nach dem Umzug
// in den Worker blieb das längste Frame bei 58 ms.
//
// Zwei Dinge, die die Messung sonst wertlos machen: `channel: 'chromium'` ist
// Pflicht (die Headless-Shell drosselt rAF, s. README), und ein Ausreißer im
// ersten Lauf nach dem Seitenaufbau ist Kompilierung und kein Ruckler. Deshalb
// laufen drei Sekunden Vorlauf, bevor gezählt wird.
//
//   PLAYWRIGHT=… node scripts/messungen/lange-frames.mjs [ms]
//   TOUR=http://…/tour/t_xyz  überschreibt die gemessene Tour.
const { chromium } = await import(process.env['PLAYWRIGHT'])
const URL_ = process.env['TOUR'] ?? 'http://maptale.localhost:5123/tour/kohphangan'
const DAUER = Number(process.argv[2] ?? 30000)
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
})
const seite = await browser.newPage({ viewport: { width: 1440, height: 900 } })
seite.on('console', (m) => {
  if (m.type() === 'error') console.log('[konsole]', m.text().slice(0, 200))
})
await seite.goto(URL_, { waitUntil: 'domcontentloaded' })
await seite.waitForFunction(() => window.__maptale?.tour, null, { timeout: 60000 })
await seite.evaluate(() => document.getElementById('btn-start')?.click())
await seite.waitForTimeout(3000)

const r = await seite.evaluate(async (dauer) => {
  const loaf = []
  const po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) loaf.push(e.toJSON())
  })
  try {
    po.observe({ type: 'long-animation-frame', buffered: true })
  } catch {}
  const d = []
  let last = performance.now()
  const bis = last + dauer
  await new Promise((fertig) => {
    const z = () => {
      const n = performance.now()
      d.push(n - last)
      last = n
      if (n < bis) requestAnimationFrame(z)
      else fertig()
    }
    requestAnimationFrame(z)
  })
  po.disconnect()
  d.sort((a, b) => a - b)
  const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))]
  return {
    frames: d.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: d[d.length - 1],
    ueber33: d.filter((x) => x > 33).length,
    ueber50: d.filter((x) => x > 50).length,
    ueber100: d.filter((x) => x > 100).length,
    clock: { ...window.__maptale.clock },
    loaf: loaf.map((e) => ({
      dur: Math.round(e.duration),
      block: Math.round(e.blockingDuration),
      render: Math.round(e.styleAndLayoutStart ? e.styleAndLayoutStart - e.renderStart : 0),
      scripts: (e.scripts || [])
        .map((s) => ({
          d: Math.round(s.duration),
          inv: s.invoker,
          typ: s.invokerType,
          src: (s.sourceURL || '').split('/').pop(),
          fn: s.sourceFunctionName,
        }))
        .filter((s) => s.d >= 3),
    })),
  }
}, DAUER)

console.log(
  `Frames ${r.frames} · p50 ${r.p50.toFixed(1)} ms · p95 ${r.p95.toFixed(1)} · p99 ${r.p99.toFixed(1)} · max ${r.max.toFixed(0)}`,
)
console.log(
  `>33ms: ${r.ueber33} (${((r.ueber33 / r.frames) * 100).toFixed(2)} %) · >50ms: ${r.ueber50} · >100ms: ${r.ueber100}`,
)
console.log(
  `Uhr: verworfen ${r.clock.droppedS?.toFixed?.(2)} s in ${r.clock.droppedFrames} Frames · längstes Frame ${(r.clock.longestFrameS * 1000).toFixed(0)} ms`,
)
const lang = r.loaf.filter((e) => e.dur >= 30).sort((a, b) => b.dur - a.dur)
console.log(`\nLoAF-Einträge gesamt ${r.loaf.length}, davon >=30 ms: ${lang.length}`)
for (const e of lang.slice(0, 20)) {
  console.log(
    `  ${e.dur} ms (blockierend ${e.block}, Style+Layout ${e.render})  ${e.scripts.map((s) => `${s.src}:${s.fn || s.inv} ${s.d}ms`).join(' | ') || '— kein Skript >3ms (Renderer/GPU/GC)'}`,
  )
}
const nachFn = new Map()
for (const e of r.loaf)
  for (const s of e.scripts) {
    const k = `${s.src}:${s.fn || s.inv}`
    const v = nachFn.get(k) ?? { n: 0, sum: 0, max: 0 }
    v.n++
    v.sum += s.d
    v.max = Math.max(v.max, s.d)
    nachFn.set(k, v)
  }
console.log('\nSkript-Zeit summiert (>=3 ms je Aufruf):')
for (const [k, v] of [...nachFn].sort((a, b) => b[1].sum - a[1].sum).slice(0, 15))
  console.log(
    `  ${String(v.sum).padStart(6)} ms  n=${String(v.n).padStart(4)}  max ${String(v.max).padStart(4)} ms  ${k}`,
  )
await browser.close()
