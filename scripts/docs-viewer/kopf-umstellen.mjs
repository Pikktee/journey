#!/usr/bin/env node
/*
 * Einmal-Skript: die Prosa-Kopfzeile eines Dokuments in Front Matter wandeln.
 *
 *   node scripts/docs-viewer/kopf-umstellen.mjs --trocken   # nur berichten
 *   node scripts/docs-viewer/kopf-umstellen.mjs             # schreiben
 *
 * ES IST ABSICHTLICH FEIGE. Gewandelt wird nur, wo der Kopf VOLLSTÄNDIG aus
 * bekannten Feldern besteht; alles andere bleibt liegen und wird gemeldet.
 * Die Köpfe im Bestand sind Prosa und keine Datensätze:
 *
 *   „Stand 2026-07-22, geplant, noch nicht gebaut. Ziel: Wer nur Fotos hat …"
 *
 * Dort steht ein Datum, ein Status UND der erste Satz des Dokuments in einer
 * Zeile. Wer das automatisch zerlegt, verschiebt Fließtext in ein Metafeld —
 * und merkt es nie wieder, weil der Viewer danach ordentlich aussieht. Solche
 * Fälle gehören auf die Hand-Liste am Ende des Laufs.
 *
 * Der Rückfall auf die Prosa-Zeile bleibt im Viewer bestehen (`kopf.mjs`), das
 * Skript ist also kein Muss: Was es liegen lässt, erscheint weiterhin richtig.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

import { DOCS, WURZEL, dateienUnter } from './sammeln.mjs'
import { schreibeYaml, teileKopf, saeubere } from './kopf.mjs'

const FELDNAMEN = new Map([
  ['stand', 'stand'],
  ['status', 'status'],
  ['betrifft', 'betrifft'],
  ['systemteile', 'systemteile'],
  ['archiviert aus', 'archiviert_aus'],
])

/** Ein Datum am Anfang eines Wertes: „2026-08-17", „7. August 2026", „August 2026". */
const DATUM =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*\d{4}|(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*\d{4})/

class NichtWandelbar extends Error {}

/**
 * Beginnt dieser Absatz mit einem Feldnamen? Nur dann ist er ein Kopf.
 *
 * Die Sterne fallen vorher weg: Der Bestand schreibt `**Stand:**`, `Stand:`
 * und `**Stand**:` — drei Schreibweisen für dieselbe Angabe, und ein Muster,
 * das alle drei mit Alternativen abdeckt, liest niemand mehr.
 */
const FELDMUSTER = /^(Stand|Status|Betrifft|Systemteile|Archiviert aus)\s*:?\s*(.*)$/i

function ohneSterne(text) {
  return text.replace(/\*\*/g, '').trim()
}

function istKopfblock(text) {
  const treffer = FELDMUSTER.exec(ohneSterne(text))
  // „Standarddarstellung" beginnt mit „Stand": ohne den Doppelpunkt oder ein
  // folgendes Leerzeichen wäre jeder solche Absatz ein Kopf.
  return !!treffer && /^[:\s]/.test(ohneSterne(text).slice(treffer[1].length))
}

/**
 * Der Kopfblock: ein zusammenhängender Absatz, der mit einem Feldnamen
 * beginnt. Er steht meist direkt unter der Überschrift, bei einigen Dokumenten
 * aber hinter einem „**Ziel:**"-Absatz — gesucht wird deshalb in den ersten
 * Absätzen und nicht nur im ersten. Ein Kopf darf umbrechen (die
 * Bestandsdokumente tun es), endet aber an der nächsten Leerzeile.
 */
function findeBlock(zeilen) {
  let i = 0
  while (i < zeilen.length && !/^#\s/.test(zeilen[i])) i++
  if (i === zeilen.length) throw new NichtWandelbar('keine Überschrift')
  i++
  for (let absatz = 0; absatz < 4 && i < zeilen.length; absatz++) {
    while (i < zeilen.length && !zeilen[i].trim()) i++
    const von = i
    while (i < zeilen.length && zeilen[i].trim()) i++
    if (i === von) break
    const text = zeilen.slice(von, i).join(' ')
    if (istKopfblock(text)) return { von, bis: i, text }
    // Ein Codeblock oder eine Tabelle: ab hier fängt der Inhalt an.
    if (/^(```|\||>|#)/.test(zeilen[von].trim())) break
  }
  throw new NichtWandelbar('kein Kopf')
}

/**
 * Zerlegt den Block in Felder. Wirft, sobald ein Stück übrig bleibt, das kein
 * Feld ist — der Rest des Absatzes gehört dann zum Text und nicht in den Kopf.
 */
function zerlege(blockText) {
  const daten = {}
  const stuecke = blockText.split('·')
  for (const stueck of stuecke) {
    const roh = ohneSterne(stueck)
    if (!roh) continue
    const treffer = istKopfblock(stueck) ? FELDMUSTER.exec(roh) : null
    if (!treffer) {
      // Ein namenloses Stück direkt hinter dem Stand IST der Status — so liest
      // es jeder Mensch („Stand: 6. August 2026 · Etappen 1–7 umgesetzt").
      // Nur wenn es ein ganzer Satz mit Fortsetzung ist, ist es Fließtext.
      const wert = saeubere(roh).replace(/[.]$/, '')
      if (daten.stand && !daten.status && wert.length <= 110 && !/[.!?]\s+\S/.test(wert)) {
        daten.status = wert
        continue
      }
      throw new NichtWandelbar(`kein Feld: „${kurz(roh)}"`)
    }
    const feld = FELDNAMEN.get(treffer[1].toLowerCase())
    const wert = saeubere(treffer[2])
    if (!wert) continue

    if (feld === 'stand') {
      const datum = DATUM.exec(wert)
      if (!datum) throw new NichtWandelbar(`Stand ohne Datum: „${kurz(wert)}"`)
      daten.stand = normalisiereDatum(datum[1])
      const rest = wert.slice(datum[1].length).replace(/^[\s,;.]+/, '')
      if (rest) {
        // Was hinter dem Datum steht, ist ein Status („nichts davon umgesetzt")
        // ODER der Anfang des Dokuments („Ziel: Wer nur Fotos hat …"). Ein
        // ganzer Satz mit Punkt und Fortsetzung ist Zweites.
        if (/[.!?]\s+\S/.test(rest) || rest.length > 90)
          throw new NichtWandelbar(`Prosa hinter dem Stand: „${kurz(rest)}"`)
        if (daten.status) throw new NichtWandelbar('zwei Status-Angaben')
        daten.status = rest.replace(/[.]$/, '')
      }
      continue
    }

    if (feld === 'betrifft' || feld === 'systemteile') {
      daten[feld] = trenneAufzaehlung(wert)
      continue
    }

    if (daten[feld]) throw new NichtWandelbar(`${feld} steht zweimal`)
    daten[feld] = wert.replace(/[.]$/, '')
  }
  if (!Object.keys(daten).length) throw new NichtWandelbar('keine Felder gefunden')
  return daten
}

/**
 * Eine Aufzählung am Komma trennen — aber NICHT innerhalb einer Klammer.
 * „Web-Player (`src/tour.ts`, `src/main.ts`), Studio-UI (…)" sind zwei
 * Einträge und nicht vier; naiv getrennt entstehen Bruchstücke mit halben
 * Klammern, die man später einzeln nachbessern müsste.
 */
function trenneAufzaehlung(wert) {
  const teile = []
  let tiefe = 0
  let sammel = ''
  for (const zeichen of wert) {
    if (zeichen === '(' || zeichen === '[') tiefe++
    else if (zeichen === ')' || zeichen === ']') tiefe = Math.max(0, tiefe - 1)
    if (zeichen === ',' && tiefe === 0) {
      teile.push(sammel)
      sammel = ''
      continue
    }
    sammel += zeichen
  }
  teile.push(sammel)
  return teile
    .map((s) =>
      saeubere(s)
        .replace(/^und\s+/, '')
        .replace(/[.]$/, ''),
    )
    .filter(Boolean)
}

/** ISO ist die eine Schreibweise, die sich sortieren lässt. */
function normalisiereDatum(roh) {
  const MONATE = [
    'januar',
    'februar',
    'märz',
    'april',
    'mai',
    'juni',
    'juli',
    'august',
    'september',
    'oktober',
    'november',
    'dezember',
  ]
  if (/^\d{4}-\d{2}-\d{2}$/.test(roh)) return roh
  const tag = /^(\d{1,2})\.\s*([A-Za-zä]+)\s*(\d{4})$/.exec(roh)
  if (tag) {
    const m = MONATE.indexOf(tag[2].toLowerCase())
    if (m >= 0)
      return `${tag[3]}-${String(m + 1).padStart(2, '0')}-${String(tag[1]).padStart(2, '0')}`
  }
  // „August 2026" bleibt „August 2026": Ein erfundener Tag wäre eine Genauigkeit,
  // die das Dokument nie behauptet hat.
  return roh
}

function kurz(s) {
  return s.length > 48 ? s.slice(0, 45) + '…' : s
}

/* ── Lauf ─────────────────────────────────────────────────────────────── */

const trocken = process.argv.includes('--trocken')
const dateien = dateienUnter(DOCS, '.md').filter((p) => !/README\.md$|roadmap\.md$/.test(p))

const gewandelt = []
const vonHand = []
const ohneKopf = []

for (const abs of dateien) {
  const rel = relative(WURZEL, abs)
  const roh = readFileSync(abs, 'utf8')
  if (teileKopf(roh).roh != null) continue // hat schon Front Matter

  const zeilen = roh.split('\n')
  let block
  let daten
  try {
    block = findeBlock(zeilen)
    daten = zerlege(block.text)
  } catch (fehler) {
    if (!(fehler instanceof NichtWandelbar)) throw fehler
    ;(/kein Kopf|keine Felder|keine Überschrift/.test(fehler.message) ? ohneKopf : vonHand).push(
      `${rel} — ${fehler.message}`,
    )
    continue
  }

  // Der Block hatte vor und hinter sich eine Leerzeile. Nimmt man ihn heraus,
  // stehen die beiden nebeneinander — im Markdown unsichtbar, im Diff jeder
  // späteren Änderung aber eine Zeile, über die jemand stolpert.
  const ohneBlock = [...zeilen.slice(0, block.von), ...zeilen.slice(block.bis)]
  if (block.von > 0 && !ohneBlock[block.von - 1]?.trim() && !ohneBlock[block.von]?.trim())
    ohneBlock.splice(block.von, 1)
  const koerper = ohneBlock.join('\n').replace(/^(#\s.+\n)\n+/, '$1\n')
  const neu = `---\n${schreibeYaml(daten)}\n---\n\n${koerper.replace(/^\n+/, '')}`
  gewandelt.push(rel)
  if (!trocken) writeFileSync(abs, neu.endsWith('\n') ? neu : neu + '\n')
}

console.log(`\n${trocken ? 'TROCKENLAUF — ' : ''}${gewandelt.length} Dokumente gewandelt`)
for (const z of gewandelt) console.log(`  ✓ ${z}`)
if (vonHand.length) {
  console.log(`\n${vonHand.length} von Hand (Kopf ist Prosa, nicht Datensatz):`)
  for (const z of vonHand) console.log(`  · ${z}`)
}
if (ohneKopf.length) console.log(`\n${ohneKopf.length} ohne Kopfzeile — nichts zu tun`)
