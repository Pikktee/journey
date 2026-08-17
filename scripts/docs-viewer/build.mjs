#!/usr/bin/env node
/*
 * Baut den Doku-Viewer nach `docs/_site/`.
 *
 *   npm run docs                 alles bauen, Vorschauen nur für geänderte Mockups
 *   npm run docs -- --ohne-bilder  ohne Screenshots (schnell)
 *   npm run docs -- --neu          alle Vorschauen neu aufnehmen
 *   npm run docs -- --oeffnen      danach im Browser öffnen
 *
 * Die Ausgabe ist LOKAL und steht in `.gitignore`: Sie enthält die internen
 * Konzepte (Monetarisierung, Verträge, Zugänge) und hat auf dem Server nichts
 * zu suchen. Sie ist außerdem kein Vite-Einstieg — `npm run build` sieht sie
 * gar nicht.
 */

import {
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  WURZEL,
  DOCS,
  bereicheDieserDoku,
  SYSTEMTEILE,
  sammleDokumente,
  sammleMockups,
  sammleBilder,
  sammleRoadmap,
} from './sammeln.mjs'
import { rendere } from './markdown.mjs'
import {
  uebersichtSeite,
  bereichSeite,
  dokumentSeite,
  mockupSeite,
  kartenSeite,
} from './seiten.mjs'
import { nimmVorschauenAuf } from './vorschau.mjs'

const SITE = join(DOCS, '_site')
const HIER = dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const ohneBilder = args.includes('--ohne-bilder')
const neuBauen = args.includes('--neu')
const oeffnen = args.includes('--oeffnen')

const schreibe = (rel, inhalt) => {
  const pfad = join(SITE, rel)
  mkdirSync(dirname(pfad), { recursive: true })
  writeFileSync(pfad, inhalt)
}

/* ── Marke ────────────────────────────────────────────────────────────── */

/** Das Logo als Favicon; fehlt es, tut es ein gezeichneter Ersatz. */
function markeSvg() {
  const quelle = join(WURZEL, 'public', 'logo-mark.svg')
  if (existsSync(quelle)) return readFileSync(quelle, 'utf8')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <path d="M4 24 C 10 24, 9 10, 16 10 S 24 20, 28 8" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
    <circle cx="16" cy="10" r="3.5" fill="#ff6f52"/>
  </svg>`
}

/* ── Lauf ─────────────────────────────────────────────────────────────── */

console.log('Doku-Viewer bauen …')
const t0 = Date.now()

const BEREICHE = bereicheDieserDoku()
const dokumente = sammleDokumente()
const mockups = sammleMockups()
const bilder = sammleBilder()
const roadmap = sammleRoadmap(dokumente, mockups)
const nachAbs = new Map(dokumente.map((d) => [d.abs, d]))

// Die Ausgabe wird VOLLSTÄNDIG geleert, nur die Vorschaubilder bleiben: Sie
// sind teuer und hängen allein an den Mockups. Gezielt einzelne Ordner zu
// löschen ließ die Seiten eines Bereichs stehen, den es nicht mehr gibt —
// erreichbar über alte Links, aber von nichts mehr verlinkt.
if (existsSync(SITE))
  for (const eintrag of readdirSync(SITE)) {
    if (eintrag === 'vorschau') continue
    // Die einmal geladene Schrift überlebt das Leeren — sonst hinge jeder Bau
    // wieder am Netz.
    if (eintrag === 'assets' && existsSync(join(SITE, 'assets', 'outfit.woff2'))) {
      const bewahrt = readFileSync(join(SITE, 'assets', 'outfit.woff2'))
      rmSync(join(SITE, eintrag), { recursive: true, force: true })
      mkdirSync(join(SITE, 'assets'), { recursive: true })
      writeFileSync(join(SITE, 'assets', 'outfit.woff2'), bewahrt)
      continue
    }
    rmSync(join(SITE, eintrag), { recursive: true, force: true })
  }
mkdirSync(SITE, { recursive: true })

/*
 * Alles, was in `docs/` KEIN Markdown ist, wird mitkopiert: die HTML-Prototypen
 * und ihre Bilder.
 *
 * Vorher zeigten die Kacheln mit `../mockups/…` auf das Original neben der
 * Ausgabe. Als Datei geöffnet ging das gut, über den Dev-Server nicht: `/doku/`
 * ist dort ein eigener Ast, `..` führt aus ihm heraus auf `/mockups/…` — eine
 * Adresse, die es nicht gibt. Vite antwortete mit seinem Fallback, also mit der
 * Landing; die Prototypen führten auf den Startscreen und die Bilder blieben
 * kaputte Rahmen. Eine Spiegelung im Ausgabeordner löst beide Wege zugleich.
 */
function spiegleBeiwerk(von, nachRel = '') {
  for (const eintrag of readdirSync(von, { withFileTypes: true })) {
    if (eintrag.name.startsWith('.') || eintrag.name === '_site') continue
    const quelle = join(von, eintrag.name)
    const rel = nachRel ? `${nachRel}/${eintrag.name}` : eintrag.name
    if (eintrag.isDirectory()) spiegleBeiwerk(quelle, rel)
    else if (!eintrag.name.endsWith('.md')) {
      mkdirSync(dirname(join(SITE, rel)), { recursive: true })
      cpSync(quelle, join(SITE, rel))
    }
  }
}
spiegleBeiwerk(DOCS)

/*
 * Die Schrift kommt LOKAL, nicht vom CDN.
 *
 * Über Google Fonts sind es zwei Roundtrips (Stylesheet, dann die woff2) —
 * bis die zweite da ist, zeichnet der Browser den metrischen Ersatz, und beim
 * Wechsel springt die Seite sichtbar. Auf einer Doku, die man dutzende Male am
 * Tag öffnet, ist das der auffälligste Fehler überhaupt. Einmal geladen liegt
 * sie in `assets/` und wird nie wieder geholt; ohne Netz bleibt es beim
 * bisherigen Weg (der Link steht dann weiterhin in der Seite).
 */
const SCHRIFT_URL =
  'https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2'
const schriftDatei = join(SITE, 'assets', 'outfit.woff2')
let schriftLokal = existsSync(schriftDatei)
if (!schriftLokal) {
  try {
    const antwort = await fetch(SCHRIFT_URL)
    if (!antwort.ok) throw new Error(String(antwort.status))
    mkdirSync(dirname(schriftDatei), { recursive: true })
    writeFileSync(schriftDatei, Buffer.from(await antwort.arrayBuffer()))
    schriftLokal = true
    console.log('  Schrift Outfit geladen (einmalig, danach lokal)')
  } catch (fehler) {
    console.warn(`  ! Schrift nicht geladen (${fehler.message}) — die Seiten holen sie vom CDN`)
  }
}

/* Blätter, Skript, Marke */
cpSync(join(HIER, 'assets'), join(SITE, 'assets'), { recursive: true })
cpSync(join(WURZEL, 'src', 'basis.css'), join(SITE, 'assets', 'basis.css'))
schreibe('assets/marke.svg', markeSvg())

/* Dokumentseiten */
const index = []
for (const dok of dokumente) {
  const { html, ueberschriften } = rendere(dok, nachAbs)
  schreibe(dok.ziel, dokumentSeite({ dok, html, ueberschriften, dokumente, bereiche: BEREICHE, nachAbs, roadmap, schriftLokal }))
  index.push({
    t: dok.titel,
    z: dok.ziel,
    b: BEREICHE.find((b) => b.id === dok.bereich)?.name ?? '',
    // Archiviertes wird in der Trefferliste gekennzeichnet und leicht
    // abgewertet — es steht dort mit demselben Anspruch wie alles andere.
    a: dok.archiviert ? 1 : 0,
    k: dok.klappentext,
    // Systemteile gehen als Namen in den Index: „android" tippt niemand, wenn
    // im Chip „Android-App" steht.
    s: (dok.teile ?? []).map((id) => SYSTEMTEILE.find((t) => t.id === id)?.name ?? id),
    u: ueberschriften.map((u) => ({ t: u.titel.replace(/<[^>]+>/g, ''), i: u.id })),
    // Der Volltext geht klein und ohne Auszeichnung in den Index: Er wird nur
    // durchsucht und als Auszug gezeigt, nicht dargestellt.
    v: dok.text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*_>`|\[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .slice(0, 24000),
  })
}

/* Ebene 2: je Bereich eine Seite */
for (const bereich of BEREICHE) {
  if (!dokumente.some((d) => d.bereich === bereich.id)) continue
  schreibe(`${bereich.id}/index.html`, bereichSeite({ bereich, dokumente, bereiche: BEREICHE, roadmap, schriftLokal }))
}

/* Übersicht, Mockups, Karte */
schreibe('index.html', uebersichtSeite({ bereiche: BEREICHE, dokumente, mockups, bilder, roadmap, schriftLokal }))
schreibe('mockups.html', mockupSeite({ mockups, bereiche: BEREICHE, roadmap, schriftLokal }))
schreibe('karte.html', kartenSeite({ dokumente, bereiche: BEREICHE, schriftLokal }))
schreibe('assets/index.js', 'window.DOCS_INDEX = ' + JSON.stringify(index) + ';\n')

/* Vorschauen */
let bericht = { aufgenommen: 0, uebersprungen: mockups.length, grund: 'übersprungen (--ohne-bilder)' }
if (!ohneBilder) bericht = await nimmVorschauenAuf(mockups, DOCS, SITE, { neuBauen })

/* Was der Bau NICHT von selbst weiß — einmal laut sagen, statt still zu raten. */
for (const bereich of BEREICHE.filter((b) => b.ergaenzt))
  console.warn(
    `  ! Bereich "${bereich.id}" ist neu und noch nicht beschrieben — Farbe, Motiv und Satz in scripts/docs-viewer/sammeln.mjs ergänzen`,
  )
for (const pfad of roadmap.unbekannt)
  console.warn(`  ! docs/roadmap.md verweist auf ${pfad} — Datei fehlt oder wurde umbenannt`)
/* Bilder, die kein Prototyp benutzt: Sie liegen in den Mockup-Ordnern, werden
 * aber von keiner Datei dort referenziert — meist Reste einer alten Fassung.
 * Der Viewer zeigt sie nicht mehr (sie sind Beiwerk, keine Doku); gemeldet
 * werden sie trotzdem, sonst wüchse der Ordner still weiter. */
const genutzt = mockups.map((m) => readFileSync(join(DOCS, m.quelle), 'utf8')).join('\n')
const verwaist = bilder.filter(
  (bild) => !genutzt.includes(bild.quelle.replace('mockups/', '')) && !genutzt.includes(bild.name),
)
if (verwaist.length)
  console.log(
    `  Bildmaterial: ${verwaist.length} von ${bilder.length} Bildern nutzt kein Prototyp (${verwaist
      .slice(0, 3)
      .map((x) => x.quelle)
      .join(', ')}${verwaist.length > 3 ? ', …' : ''})`,
  )

const ohneTeil = dokumente.filter((d) => !d.teile.length)
if (ohneTeil.length)
  console.log(
    `  Systemteile: ${ohneTeil.length} Dokumente ohne Zuordnung (${ohneTeil
      .slice(0, 3)
      .map((d) => d.quelle)
      .join(', ')}${ohneTeil.length > 3 ? ', …' : ''}) — eine Zeile "Systemteile: …" im Kopf hilft`,
  )
if (roadmap.offen.length)
  console.log(`  Roadmap: ${roadmap.offen.length} Konzepte ohne Phase (stehen unter „Noch nicht eingeplant")`)

const worte = dokumente.reduce((s, d) => s + d.worte, 0)
console.log(
  `  ${dokumente.length} Dokumente · ${Math.round(worte / 1000)}k Wörter · ${mockups.length} Mockups · ${bilder.length} Bilder`,
)
console.log(
  `  Vorschauen: ${bericht.aufgenommen} neu, ${bericht.uebersprungen} unverändert${bericht.grund ? ' — ' + bericht.grund : ''}`,
)
console.log(`  fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
console.log('  Ansehen: http://maptale.localhost:5123/doku/ (devhub) oder docs/_site/index.html öffnen')

if (oeffnen) execFileSync('open', [join(SITE, 'index.html')])
