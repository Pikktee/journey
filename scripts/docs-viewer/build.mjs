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
  renameSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ICONS } from './icons.mjs'
import {
  WURZEL,
  DOCS,
  bereicheDieserDoku,
  SYSTEMTEILE,
  sammleDokumente,
  sammleMockups,
  sammleBilder,
  sammleRoadmap,
  standVeraltet,
  verknuepfeMockups,
} from './sammeln.mjs'
import { rendere } from './markdown.mjs'
import {
  uebersichtSeite,
  bereichSeite,
  dokumentSeite,
  mockupSeite,
  kartenSeite,
} from './seiten.mjs'

/*
 * Gebaut wird NEBEN der Ausgabe, getauscht wird am Ende in einem Zug.
 *
 * Vorher wurde `docs/_site/` in-place geleert und wieder gefüllt: Dazwischen
 * lag rund eine Sekunde, in der es keine `index.html` gab — und der
 * Dev-Server antwortete jeder Anfrage in diesem Fenster mit „Die Doku ist
 * noch nicht gebaut". Genau dort hinein fällt der Reload nach dem
 * Archivieren, weshalb die Aktion aussah, als hätte sie den Viewer zerlegt.
 * Zwei Umbenennungen später ist das Fenster so lang wie ein `rename` — und
 * ein FEHLGESCHLAGENER Bau lässt die alte Fassung stehen, statt sie zu
 * löschen und nichts an ihre Stelle zu setzen.
 */
const ZIEL = join(DOCS, '_site')
/*
 * Der Bauordner trägt die PROZESSNUMMER, und das ist keine Kosmetik: Der
 * Wächter des Dev-Servers baut nebenher, und wer gleichzeitig `npm run docs`
 * aufruft, hatte sonst zwei Läufe in EINEM Ordner — der zweite leert ihn,
 * während der erste hineinschreibt, und getauscht wird ein halbes
 * Verzeichnis (zuletzt: `assets/` ohne Blätter, die Doku stand ungestaltet
 * da). Mit eigenem Ordner je Lauf tauschen beide nacheinander eine
 * vollständige Fassung; die letzte gewinnt.
 */
const SITE = join(DOCS, `_site.bau.${process.pid}`)
const VORIG = join(DOCS, `_site.alt.${process.pid}`)
const HIER = dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const oeffnen = args.includes('--oeffnen')

/* Der Bauordner gehört DIESEM Prozess: Endet er, ist der Ordner Müll — auch
 * und gerade, wenn er über einen Fehler endet. */
process.on('exit', () => rmSync(SITE, { recursive: true, force: true }))

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
// Die Beziehung Konzept↔Mockup wird abgeleitet, bevor irgendetwas gerendert
// wird: Beide Seiten zeigen sie an, und beide bekommen sie aus derselben Quelle.
verknuepfeMockups(dokumente, mockups)
const roadmap = sammleRoadmap(dokumente, mockups)
const nachAbs = new Map(dokumente.map((d) => [d.abs, d]))

// Der Bauordner beginnt leer — er ist der Rest eines abgebrochenen Laufs oder
// gibt es noch gar nicht. Die einmal geladene Schrift wandert aus der
// stehenden Ausgabe herüber, sonst hinge jeder Bau wieder am Netz.
rmSync(SITE, { recursive: true, force: true })
/* Ein abgestürzter Lauf lässt seinen Ordner liegen. Er gehört einem Prozess,
 * den es nicht mehr gibt, also räumt ihn niemand außer dem nächsten Bau —
 * und der wartet dafür eine Stunde ab, um keinem laufenden dazwischenzukommen. */
for (const eintrag of readdirSync(DOCS))
  if (/^_site\.(bau|alt)\./.test(eintrag) && join(DOCS, eintrag) !== SITE) {
    const alter = Date.now() - statSync(join(DOCS, eintrag)).mtimeMs
    if (alter > 60 * 60 * 1000) rmSync(join(DOCS, eintrag), { recursive: true, force: true })
  }
mkdirSync(join(SITE, 'assets'), { recursive: true })
if (existsSync(join(ZIEL, 'assets', 'outfit.woff2')))
  cpSync(join(ZIEL, 'assets', 'outfit.woff2'), join(SITE, 'assets', 'outfit.woff2'))

/*
 * Alles, was in `docs/` KEIN Markdown ist, wird mitkopiert: die HTML-Mockups
 * und ihre Bilder.
 *
 * Vorher zeigten die Kacheln mit `../mockups/…` auf das Original neben der
 * Ausgabe. Als Datei geöffnet ging das gut, über den Dev-Server nicht: `/doku/`
 * ist dort ein eigener Ast, `..` führt aus ihm heraus auf `/mockups/…` — eine
 * Adresse, die es nicht gibt. Vite antwortete mit seinem Fallback, also mit der
 * Landing; die Mockups führten auf den Startscreen und die Bilder blieben
 * kaputte Rahmen. Eine Spiegelung im Ausgabeordner löst beide Wege zugleich.
 */
function spiegleBeiwerk(von, nachRel = '') {
  for (const eintrag of readdirSync(von, { withFileTypes: true })) {
    // `_site`, `_site.neu`, `_site.alt`: die Ausgabe spiegelt sich nicht selbst.
    if (eintrag.name.startsWith('.') || eintrag.name.startsWith('_site')) continue
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
const SCHRIFT_URL = 'https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2'
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
  schreibe(
    dok.ziel,
    dokumentSeite({
      dok,
      html,
      ueberschriften,
      dokumente,
      bereiche: BEREICHE,
      nachAbs,
      roadmap,
      schriftLokal,
    }),
  )
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
  schreibe(
    `${bereich.id}/index.html`,
    bereichSeite({ bereich, dokumente, bereiche: BEREICHE, roadmap, schriftLokal }),
  )
}

/* Übersicht, Mockups, Karte */
schreibe(
  'index.html',
  uebersichtSeite({ bereiche: BEREICHE, dokumente, mockups, bilder, roadmap, schriftLokal }),
)
schreibe('mockups.html', mockupSeite({ mockups, bereiche: BEREICHE, roadmap, schriftLokal }))
schreibe('karte.html', kartenSeite({ dokumente, bereiche: BEREICHE, schriftLokal }))
schreibe('assets/index.js', 'window.DOCS_INDEX = ' + JSON.stringify(index) + ';\n')

/* Vorschauen */

/* Was der Bau NICHT von selbst weiß — einmal laut sagen, statt still zu raten. */
for (const bereich of BEREICHE.filter((b) => b.ergaenzt))
  console.warn(
    `  ! Bereich "${bereich.id}" ist neu und noch nicht beschrieben — Farbe, Motiv und Satz in scripts/docs-viewer/sammeln.mjs ergänzen`,
  )
for (const pfad of roadmap.unbekannt)
  console.warn(`  ! docs/roadmap.md verweist auf ${pfad} — Datei fehlt oder wurde umbenannt`)
/* Bilder, die kein Mockup benutzt: Sie liegen in den Mockup-Ordnern, werden
 * aber von keiner Datei dort referenziert — meist Reste einer alten Fassung.
 * Der Viewer zeigt sie nicht mehr (sie sind Beiwerk, keine Doku); gemeldet
 * werden sie trotzdem, sonst wüchse der Ordner still weiter. */
const genutzt = mockups.map((m) => readFileSync(join(DOCS, m.quelle), 'utf8')).join('\n')
const verwaist = bilder.filter(
  (bild) => !genutzt.includes(bild.quelle.replace('mockups/', '')) && !genutzt.includes(bild.name),
)
if (verwaist.length)
  console.log(
    `  Bildmaterial: ${verwaist.length} von ${bilder.length} Bildern nutzt kein Mockup (${verwaist
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
      .join(
        ', ',
      )}${ohneTeil.length > 3 ? ', …' : ''}) — "systemteile: [Studio, Backend]" im Front Matter hilft`,
  )
/* Ein Mockup in `roadmap.md` ist kein Tippfehler, sondern eine Regel, die
 * jemand nicht kannte — also wird er benannt statt stumm übergangen. */
for (const pfad of roadmap.prototypen ?? [])
  console.warn(
    `  ! docs/roadmap.md nennt das Mockup ${pfad} — auf die Roadmap kommen KONZEPTE.\n` +
      '    Lege ein Konzept an, verlinke das Mockup darin und plane das Konzept ein.',
  )
const ohneKonzept = mockups.filter((m) => !m.archiv && !m.konzepte.length)
if (ohneKonzept.length)
  console.log(
    `  Mockups: ${ohneKonzept.length} von ${mockups.filter((m) => !m.archiv).length} gehören zu keinem Konzept — kein Fehler (manches wurde gezeichnet und direkt gebaut), aber eine Beziehung, die der Viewer dann nicht zeigen kann`,
  )
if (roadmap.offen.length)
  console.log(
    `  Roadmap: ${roadmap.offen.length} Konzepte ohne Phase (stehen unter „Noch nicht eingeplant")`,
  )

/* Ein Konzept auf der Roadmap ohne `icon:` bekommt das neutrale Blatt — kein
 * Fehler, aber in einer Spalte, in der jede andere Karte ihr eigenes Zeichen
 * trägt, liest sich das Blatt als „hierzu fehlt etwas". Gemeldet wird es
 * deshalb hier und nicht in der Ansicht. */
const ohneIcon = roadmap.phasen.flatMap((p) => p.eintraege).filter((e) => !ICONS[e.dok.kopf.icon])
if (ohneIcon.length)
  console.log(
    `  Zeichen: ${ohneIcon.length} Roadmap-Konzepte ohne gültiges „icon:" (${ohneIcon
      .map((e) => e.quelle.replace('docs/concepts/', ''))
      .slice(0, 3)
      .join(
        ', ',
      )}${ohneIcon.length > 3 ? ', …' : ''}) — die Namen stehen in scripts/docs-viewer/icons.mjs`,
  )

/* Der `status`-Satz ist von Hand gepflegt, und sein einziger Feind ist stilles
 * Veralten. Gemeldet wird deshalb nur der Fall ohne Ratespiel: Was laut Roadmap
 * LÄUFT und dessen Kopf seit Wochen unangetastet ist, ist entweder nicht mehr
 * in Arbeit oder sein Stand ist alt. */
const laufendeDoks = (roadmap.phasen[0]?.eintraege ?? []).map((e) => e.dok).filter(Boolean)
const alt = laufendeDoks.map((d) => [d, standVeraltet(d)]).filter(([, v]) => v)
if (alt.length) {
  console.log(
    `  Stand prüfen: ${alt.length} laufende${alt.length === 1 ? 's Vorhaben' : ' Vorhaben'} mit unangetastetem Kopf:`,
  )
  for (const [d, v] of alt) console.log(`    ${d.quelle} — stand ${v.stand}, vor ${v.tage} Tagen`)
}

const worte = dokumente.reduce((s, d) => s + d.worte, 0)
console.log(
  `  ${dokumente.length} Dokumente · ${Math.round(worte / 1000)}k Wörter · ${mockups.length} Mockups · ${bilder.length} Bilder`,
)
console.log(`  fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
console.log(
  '  Ansehen: http://maptale.localhost:5123/doku/ (devhub) oder docs/_site/index.html öffnen',
)

/*
 * Der Tausch. Zwischen den beiden Umbenennungen liegt der einzige Moment, in
 * dem `docs/_site/` fehlt — deshalb stehen sie direkt hintereinander und
 * NICHTS dazwischen.
 */
for (let versuch = 0; ; versuch++) {
  try {
    rmSync(VORIG, { recursive: true, force: true })
    if (existsSync(ZIEL)) renameSync(ZIEL, VORIG)
    renameSync(SITE, ZIEL)
    break
  } catch (fehler) {
    // Zwei Läufe zugleich: Der andere hat `_site` in genau dem Augenblick
    // wieder angelegt, in dem dieser es weggeräumt sah — dann ist das
    // Umbenennen ein `ENOTEMPTY`. Der nächste Anlauf räumt es mit.
    if (versuch >= 3) throw fehler
  }
}
rmSync(VORIG, { recursive: true, force: true })

if (oeffnen) execFileSync('open', [join(ZIEL, 'index.html')])
