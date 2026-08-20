#!/usr/bin/env node
/**
 * Prüft die Abbildungstabelle der Englisch-Migration
 * (docs/specs/abbildungstabelle.tsv, Konzept §11).
 *
 * Vier Prüfungen, und jede hat einen Fehler im Blick, den sonst niemand sieht:
 *
 * 1. FORM: sechs Spalten je Zeile, keine leere Pflichtspalte. Eine verrutschte Zeile
 *    macht aus dem Fundort eine Welle und fällt sonst erst beim Umbenennen auf.
 * 2. WIDERSPRUCH: derselbe Ist-Name am selben Fundort mit zwei Zielformen. Das ist der
 *    einzige echte Fehler dieser Tabelle: Ein Agent müsste raten, welche gilt.
 * 3. KOLLISION: zwei verschiedene Ist-Namen, die in derselben Datei und derselben Art
 *    auf DIESELBE Zielform zeigen. Nach dem Umbenennen stünden zwei Dinge unter einem Namen.
 * 4. SPIEGEL: Namen, die in zwei getrennt kompilierten Welten leben (src/, server/src,
 *    android/, scripts/). Kein Compiler verbindet sie, und die Drift-Wächter vergleichen
 *    VERHALTEN, nicht Namen: Laufen die Zielformen auseinander, fällt das nirgends auf.
 *    Das ist die Nahtliste aus §3.3, hier maschinell erhoben.
 *
 * Homonyme (gleicher Ist-Name, verschiedene Fundorte, verschiedene Ziele) sind KEIN
 * Fehler, sondern der Grund für die Fundort-Spalte: `titelbild` ist `banner` im Profil
 * und `cover` in der Tour. Sie werden gezählt und gelistet, nicht beanstandet.
 *
 * Aufruf: node scripts/abbildungstabelle-pruefen.mjs [--json]
 * Exit-Code 1, wenn Form, Widerspruch oder Kollision etwas finden.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const TABELLE = join(WURZEL, 'docs/specs/abbildungstabelle.tsv')
const SPALTEN = ['ist', 'ziel', 'art', 'fundort', 'welle', 'bemerkung']

const roh = readFileSync(TABELLE, 'utf8')
  .split('\n')
  .filter((z) => z.trim() !== '')
const formfehler = []
if (roh[0].split('\t').join(',') !== SPALTEN.join(',')) formfehler.push('Kopfzeile weicht ab')

const zeilen = []
roh.slice(1).forEach((z, i) => {
  const t = z.split('\t')
  const nr = i + 2
  if (t.length !== 6) {
    formfehler.push(`Zeile ${nr}: ${t.length} Spalten statt 6`)
    return
  }
  const [ist, ziel, art, fundort, welle, bemerkung] = t.map((x) => x.trim())
  if (!ist || !ziel || !art) formfehler.push(`Zeile ${nr}: leere Pflichtspalte`)
  zeilen.push({ ist, ziel, art, fundort, welle, bemerkung, nr })
})

/** Gruppiert Zeilen unter einem Schlüssel. */
const grupp = (schluessel) => {
  const m = new Map()
  for (const z of zeilen) {
    const s = schluessel(z)
    if (!m.has(s)) m.set(s, [])
    m.get(s).push(z)
  }
  return m
}

const widersprueche = []
for (const [, g] of grupp((z) => `${z.ist} | ${z.art} | ${z.fundort}`)) {
  if (new Set(g.map((z) => z.ziel)).size > 1) {
    widersprueche.push(g.map((z) => `Zeile ${z.nr}: ${z.ist} → ${z.ziel}`).join('  gegen  '))
  }
}

const kollisionen = []
for (const [s, g] of grupp((z) => `${z.ziel} | ${z.art} | ${z.fundort}`)) {
  if (s.startsWith('bleibt |')) continue
  const namen = new Set(g.filter((z) => z.ziel !== z.ist).map((z) => z.ist))
  if (namen.size > 1)
    kollisionen.push(`${[...namen].join(' und ')} → ${g[0].ziel} (${g[0].fundort})`)
}

const homonyme = []
for (const [ist, g] of grupp((z) => z.ist)) {
  const ziele = [...new Set(g.map((z) => z.ziel))]
  if (ziele.length > 1)
    homonyme.push({ ist, ziele, wo: g.map((z) => `${z.ziel} ← ${z.art} ${z.fundort}`) })
}

/** In welcher getrennt kompilierten Welt liegt dieser Fundort? */
const welt = (f) => {
  if (/server\/src|server\//.test(f)) return 'server'
  if (/android/.test(f)) return 'android'
  if (/scripts\//.test(f)) return 'scripts'
  if (/(^|[\s,;])src\/|\.html/.test(f)) return 'web'
  return null
}
const spiegel = []
for (const [ist, g] of grupp((z) => z.ist)) {
  // Je Art getrennt: eine Funktion und eine CSS-Klasse gleichen Namens sind kein Spiegel.
  const proArt = new Map()
  for (const z of g) {
    if (!proArt.has(z.art)) proArt.set(z.art, [])
    proArt.get(z.art).push(z)
  }
  for (const [art, gg] of proArt) {
    const proWelt = new Map()
    for (const z of gg) {
      const w = welt(z.fundort)
      if (w) proWelt.set(w, z.ziel)
    }
    if (proWelt.size > 1 && new Set(proWelt.values()).size > 1) {
      spiegel.push({ ist, art, paare: [...proWelt].map(([w, z]) => `${w}=${z}`).join(' vs ') })
    }
  }
}

const jeWelle = {}
const jeArt = {}
for (const z of zeilen) {
  jeWelle[z.welle] = (jeWelle[z.welle] ?? 0) + 1
  jeArt[z.art] = (jeArt[z.art] ?? 0) + 1
}

const bericht = {
  eintraege: zeilen.length,
  jeWelle: Object.fromEntries(Object.entries(jeWelle).sort()),
  jeArt: Object.fromEntries(Object.entries(jeArt).sort((a, b) => b[1] - a[1])),
  vorschlaege: zeilen.filter((z) => z.bemerkung.startsWith('VORSCHLAG')).length,
  eingefroren: zeilen.filter((z) => z.ziel === 'bleibt').length,
  formfehler,
  widersprueche,
  kollisionen,
  homonyme: homonyme.length,
  homonymListe: homonyme,
  spiegelUneinig: spiegel,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(bericht, null, 2))
} else {
  console.log(`Abbildungstabelle: ${bericht.eintraege} Einträge`)
  console.log(
    `  je Welle:  ${Object.entries(bericht.jeWelle)
      .map(([w, n]) => `${w}: ${n}`)
      .join(', ')}`,
  )
  console.log(`  Vorschläge ohne Glossar-Deckung: ${bericht.vorschlaege}`)
  console.log(`  eingefroren (Zielform "bleibt"): ${bericht.eingefroren}`)
  console.log(`  Homonyme (gewollt, je Fundort verschieden): ${bericht.homonyme}`)
  console.log('')
  const melde = (titel, liste) => {
    console.log(`${liste.length === 0 ? 'OK  ' : 'FEHLER '} ${titel}: ${liste.length}`)
    liste
      .slice(0, 20)
      .forEach((e) =>
        console.log(`      ${typeof e === 'string' ? e : `${e.ist} [${e.art}] ${e.paare}`}`),
      )
    if (liste.length > 20) console.log(`      (und ${liste.length - 20} weitere)`)
  }
  melde('Formfehler', formfehler)
  melde('Widersprüche (gleicher Name, gleicher Ort, zwei Ziele)', widersprueche)
  melde('Kollisionen (zwei Namen, ein Ziel am selben Ort)', kollisionen)
  console.log('')
  console.log(`HINSEHEN  Spiegel mit uneinigen Zielformen: ${spiegel.length}`)
  spiegel.forEach((s) => console.log(`      ${s.ist} [${s.art}]  ${s.paare}`))
}

process.exit(formfehler.length || widersprueche.length || kollisionen.length ? 1 : 0)
