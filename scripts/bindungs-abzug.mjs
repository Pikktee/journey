#!/usr/bin/env node
// Bindungs-Abzug: für JEDE Identifier-Stelle unter src/ und test/ notieren, auf
// welche Deklaration sie auflöst. Vor und nach einer Umbenennung laufen lassen;
// der Abzug muss Zeile für Zeile gleich sein.
//
// Warum es diesen Wächter gibt: In Welle 4 hat `fenster` → `window` in
// wireTimeline die GLOBALE window verdeckt, und 17 window.addEventListener der
// Pointer-Gesten zeigten danach auf das Spuren-Fenster statt aufs Dokument.
// Beides ist EventTarget — tsc schwieg, kein Test wurde rot. Der Abzug hat es
// in zwei Sekunden gezeigt.
//
// Drei Dinge, die ihn erst brauchbar machen:
//
//  - Verglichen wird über die Deklarations-ZEILE, nicht über eine laufende
//    Nummer über alle Deklarationen: Sobald eine Eigenschaft dazukommt,
//    verrutschte sonst alles darunter und der Abzug wäre überall rot.
//  - Die NAMEN stehen nicht im Abzug. Sie ändern sich ja gerade; es zählt
//    allein, welche Stelle auf welche Deklaration zeigt.
//  - Die SPALTE steht nicht darin. Ein längerer Zielname verschiebt jede
//    weitere Stelle derselben Zeile, ohne dass sich eine Bindung ändert.
//    Stattdessen die laufende Nummer INNERHALB der Zeile.
//
//   node scripts/bindungs-abzug.mjs > /tmp/vorher.txt
//   … umbenennen …
//   node scripts/bindungs-abzug.mjs --alias /tmp/dateien.tsv > /tmp/nachher.txt
//   diff /tmp/vorher.txt /tmp/nachher.txt   # muss leer sein
//
// --alias nimmt eine TSV-Datei "alter Pfad<TAB>neuer Pfad" und schreibt jeden
// Pfad des Abzugs auf den ALTEN Namen zurück. Ohne sie wäre jede
// Dateiumbenennung ein Diff über die halbe Datei, und der echte Befund darin
// unsichtbar.

import ts from 'typescript'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const argumente = process.argv.slice(2)
const aliasIndex = argumente.indexOf('--alias')
const aliasDatei = aliasIndex >= 0 ? argumente[aliasIndex + 1] : null
const wurzel = resolve(argumente.find((a, i) => !a.startsWith('--') && i !== aliasIndex + 1) ?? '.')

/** neuer Pfad → alter Pfad, damit beide Abzüge dieselben Namen tragen. */
const zurueck = new Map()
if (aliasDatei) {
  for (const zeile of readFileSync(aliasDatei, 'utf8').split('\n')) {
    const [alt, neu] = zeile.split('\t')
    if (alt && neu) zurueck.set(neu.trim(), alt.trim())
  }
}

function sammle(ordner, treffer = []) {
  for (const eintrag of readdirSync(ordner)) {
    if (eintrag === 'node_modules' || eintrag.startsWith('.')) continue
    const pfad = join(ordner, eintrag)
    if (statSync(pfad).isDirectory()) sammle(pfad, treffer)
    else if (/\.tsx?$/.test(eintrag)) treffer.push(pfad)
  }
  return treffer
}

const dateien = [join(wurzel, 'src'), join(wurzel, 'test')].flatMap((o) => sammle(o)).sort()

const programm = ts.createProgram(dateien, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  strict: true,
  allowJs: false,
  noEmit: true,
  skipLibCheck: true,
  resolveJsonModule: true,
})
const pruefer = programm.getTypeChecker()

function name(quelle) {
  const datei = quelle.fileName
  if (datei.includes('node_modules')) return 'lib:' + datei.replace(/^.*\//, '')
  const rel = relative(wurzel, datei)
  return zurueck.get(rel) ?? rel
}

function ort(knoten) {
  const quelle = knoten.getSourceFile()
  if (!quelle) return '?'
  const { line } = quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle))
  return `${name(quelle)}:${line + 1}`
}

function ziel(symbol) {
  if (!symbol) return '<ungebunden>'
  // Aliase (Importe) auf ihre Quelle auflösen: sonst zeigte jede Import-Stelle
  // auf die Import-Zeile, und ein umsortierter Importblock wäre ein Befund.
  let s = symbol
  if (s.flags & ts.SymbolFlags.Alias) {
    try {
      s = pruefer.getAliasedSymbol(s)
    } catch {
      /* nicht auflösbar: dann eben das Alias selbst */
    }
  }
  const deklarationen = s.getDeclarations()
  if (!deklarationen?.length) return '<intrinsisch>'
  return deklarationen.map(ort).sort().join('+')
}

const zeilen = []
for (const datei of dateien) {
  const quelle = programm.getSourceFile(datei)
  if (!quelle) continue
  const kurz = name(quelle)
  const stellen = []
  const lauf = (knoten) => {
    if (ts.isIdentifier(knoten) || ts.isPrivateIdentifier(knoten)) stellen.push(knoten)
    ts.forEachChild(knoten, lauf)
  }
  ts.forEachChild(quelle, lauf)
  // Nach Quellposition ordnen und erst dann durchzählen: die AST-Reihenfolge
  // ist bei einzelnen Konstrukten nicht die des Textes, und die laufende Nummer
  // innerhalb der Zeile muss beide Abzüge gleich treffen.
  stellen.sort((a, b) => a.getStart(quelle) - b.getStart(quelle))
  const proZeile = new Map()
  for (const knoten of stellen) {
    const { line } = quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle))
    const nr = (proZeile.get(line) ?? 0) + 1
    proZeile.set(line, nr)
    zeilen.push(`${kurz}\t${line + 1}\t${nr}\t${ziel(pruefer.getSymbolAtLocation(knoten))}`)
  }
}

zeilen.sort()
process.stdout.write(zeilen.join('\n') + '\n')
process.stderr.write(`${zeilen.length} Identifier-Stellen in ${dateien.length} Dateien\n`)
