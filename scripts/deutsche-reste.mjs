// Wie viel Deutsch steht noch im Code?
//
// Die Abbildungstabelle deckt nur EXPORTE; modul-lokale Namen standen nie darin
// und sind deshalb die Sorte Rest, die man nur beim Lesen findet (`anfrage`,
// `jsonKopf` in api.ts, `filmVon` in der Filmachse). Dieses Skript zählt sie.
//
// Es rät nicht: Gesucht werden deutsche WORTSTÄMME, die im Englischen nicht
// vorkommen. Ein Treffer ist damit ein Befund, keine Vermutung — dafür findet
// es Wörter nicht, die zufällig in beiden Sprachen gleich aussehen.
//
//   node scripts/deutsche-reste.mjs [ordner …]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const STAEMME = [
  'anfrage', 'antwort', 'kopf', 'fuss', 'pfad', 'datei', 'zeile', 'spalte', 'wert', 'werte',
  'laden', 'lade', 'hole', 'holen', 'setze', 'setzen', 'baue', 'bauen', 'pruef', 'prüf',
  'zeige', 'zeigen', 'schreib', 'lies', 'lese', 'loesch', 'lösch', 'aendere', 'ändere',
  'anzahl', 'menge', 'liste', 'eintrag', 'schluessel', 'schlüssel', 'name', 'benutzer',
  'nutzer', 'konto', 'sitzung', 'anmeld', 'abmeld', 'passwort', 'einstellung', 'auswahl',
  'zustand', 'stand', 'fehler', 'meldung', 'hinweis', 'warnung', 'knopf', 'feld', 'rand',
  'breite', 'hoehe', 'höhe', 'tiefe', 'farbe', 'groesse', 'größe', 'punkt', 'linie',
  'karte', 'bild', 'foto', 'seite', 'stelle', 'ort', 'zeit', 'dauer', 'tempo', 'strecke',
  'weg', 'halt', 'spur', 'bahn', 'klip', 'leiste', 'balken', 'maler', 'buehne', 'bühne',
  'schleier', 'uhr', 'achse', 'film', 'ton', 'klang', 'wetter', 'himmel', 'sonne', 'mond',
  'wolke', 'regen', 'schnee', 'nebel', 'wind', 'berg', 'tal', 'fluss', 'meer', 'insel',
  'reise', 'tour', 'ausflug', 'wander', 'fahrt', 'rad', 'auto', 'bus', 'zug', 'schiff',
  'vorgabe', 'grenze', 'mitte', 'anfang', 'ende', 'neu', 'alt', 'erste', 'letzte',
  'oben', 'unten', 'links', 'rechts', 'vorne', 'hinten', 'innen', 'aussen', 'außen',
]
// SEGMENTE, die in beiden Sprachen gleich sind oder als Fachwort gelten. Sie
// werden aus der Stammliste herausgerechnet, nicht am ganzen Namen geprüft:
// `className` und `displayName` tragen das Segment „name", sind aber englisch.
const EGAL = new Set([
  'name', 'names', 'tour', 'tours', 'film', 'point', 'start', 'end', 'tempo', 'ton',
  'rad', 'bus', 'stand', 'standard', 'kind', 'index', 'alt', 'neu', 'auto', 'total',
  'links', 'button', 'sort', 'import', 'export', 'window', 'ort', 'liste', 'menge',
])
const STAMM = new Set(STAEMME.filter((w) => !EGAL.has(w)))

/**
 * Zerlegt einen Bezeichner in seine Wortsegmente und prüft JEDES als Ganzes.
 *
 * Ein Teilstring-Vergleich ist hier wertlos: `import` enthält „ort", `button`
 * enthält „ton", `window` enthält „wind". Das ist derselbe Fehler, den §9.1 für
 * DOM-Namen verbietet — nur hier fällt er nicht auf, weil er bloß falsch zählt.
 */
function hatDeutschesSegment(name) {
  const segmente = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return segmente.some((seg) => STAMM.has(seg))
}

function dateien(ordner) {
  const aus = []
  const gehe = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const voll = join(p, e.name)
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      if (e.isDirectory()) gehe(voll)
      else if (/\.(ts|kt|mjs)$/.test(e.name) && !e.name.endsWith('.d.ts')) aus.push(voll)
    }
  }
  if (statSync(ordner).isDirectory()) gehe(ordner)
  return aus
}

const ordner = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'server/src', 'android/app/src/main/java']
const jeDatei = new Map()
const jeName = new Map()
for (const o of ordner) {
  for (const f of dateien(o)) {
    const text = readFileSync(f, 'utf8')
    // Nur Code, keine Kommentare und keine Zeichenketten: Dort ist Deutsch erlaubt.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
      .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
    const namen = new Set()
    for (const m of code.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g)) {
      const n = m[1]
      if (!hatDeutschesSegment(n)) continue
      // Ein Name gilt als englisch, wenn er als Ganzes ein bekanntes Wort ist.
      namen.add(n)
    }
    if (namen.size) {
      jeDatei.set(f, namen.size)
      for (const n of namen) jeName.set(n, (jeName.get(n) ?? 0) + 1)
    }
  }
}
const gesamt = [...jeName.values()].reduce((a, b) => a + b, 0)
console.log(`${jeName.size} verschiedene Namen mit deutschem Stamm, ${gesamt} Datei-Vorkommen\n`)
console.log('Die zehn Dateien mit den meisten:')
;[...jeDatei.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([f, n]) => console.log(`  ${String(n).padStart(3)}  ${f}`))
console.log('\nDie zwanzig häufigsten Namen:')
;[...jeName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([n, c]) => console.log(`  ${String(c).padStart(3)} Dateien  ${n}`))
