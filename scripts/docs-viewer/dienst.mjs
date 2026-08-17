/*
 * Die schreibende Seite des Doku-Viewers: bearbeiten, archivieren, zurückholen.
 *
 * Sie hängt NUR am Dev-Server (`vite.config.js`, `apply: 'serve'`) und ist
 * damit so lokal wie der Ordner, in den sie schreibt. Als Datei geöffnet
 * (`file://`) gibt es keinen Server und deshalb auch keine Knöpfe — der Viewer
 * bleibt dort, was er war: eine Lesefassung.
 *
 * DREI REGELN, und die erste ist die wichtigste:
 *
 * 1. Geschrieben wird ausschließlich in `docs/` und in die Handbuch-Dateien an
 *    der Wurzel. Jeder Pfad wird aufgelöst und danach geprüft — nicht vorher:
 *    `docs/../src/main.ts` sieht als Zeichenkette harmlos aus und zeigt doch
 *    aus dem Ordner heraus.
 * 2. Verschoben wird mit `git mv`, wo Git die Datei kennt. Ein blankes
 *    `rename` zeigt im Diff eine gelöschte und eine neue Datei; die Historie
 *    eines Konzepts ist aber das Interessanteste daran.
 * 3. Nach jeder Änderung baut der Aufrufer neu. Sonst zeigt die Seite den
 *    Stand von vorhin und man ändert dieselbe Stelle zweimal.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { WURZEL, DOCS } from './sammeln.mjs'

/** Ordner unter `docs/`, in die zurückgeholt werden darf. */
export const ZIELBEREICHE = ['concepts', 'architecture', 'specs', 'ops']

class DienstFehler extends Error {}

/**
 * Löst einen repo-relativen Pfad auf und prüft, ob er beschrieben werden darf.
 * Erlaubt sind Markdown und HTML unter `docs/` sowie die Markdown-Dateien an
 * der Wurzel des Repos (das Handbuch).
 */
export function pruefePfad(rel, { mussExistieren = true } = {}) {
  if (typeof rel !== 'string' || !rel.trim()) throw new DienstFehler('Kein Pfad angegeben')
  const abs = resolve(WURZEL, rel)
  const imDocs = abs === DOCS || abs.startsWith(DOCS + '/')
  const imHandbuch = abs.startsWith(WURZEL + '/') && !relative(WURZEL, abs).includes('/')
  if (!imDocs && !imHandbuch) throw new DienstFehler(`Außerhalb der Doku: ${rel}`)
  if (!/\.(md|html)$/.test(abs)) throw new DienstFehler(`Nur .md und .html: ${rel}`)
  if (abs.includes('/_site/')) throw new DienstFehler('Die Ausgabe wird nicht bearbeitet')
  if (mussExistieren && !existsSync(abs)) throw new DienstFehler(`Gibt es nicht: ${rel}`)
  return abs
}

/**
 * Wohin eine Datei beim Archivieren wandert und wo sie herkam.
 * `docs/concepts/x.md` → `docs/archive/x.md`,
 * `docs/mockups/y.html` → `docs/archive/mockups/y.html`.
 */
export function archivZiel(rel) {
  const abs = pruefePfad(rel)
  const inDocs = relative(DOCS, abs)
  if (inDocs.startsWith('archive/')) throw new DienstFehler('Liegt schon im Archiv')
  if (!inDocs.includes('/')) throw new DienstFehler('Nur Dokumente aus einem Bereich')
  const [, ...rest] = inDocs.split('/')
  const unter = inDocs.startsWith('mockups/') ? join('archive', 'mockups') : 'archive'
  return join(DOCS, unter, rest.join('/'))
}

/** Wohin eine archivierte Datei zurückkehrt. */
export function rueckZiel(rel, bereich) {
  const abs = pruefePfad(rel)
  const inDocs = relative(DOCS, abs)
  if (!inDocs.startsWith('archive/')) throw new DienstFehler('Liegt nicht im Archiv')
  const name = inDocs.split('/').pop()
  if (inDocs.startsWith('archive/mockups/')) return join(DOCS, 'mockups', name)
  if (!ZIELBEREICHE.includes(bereich)) throw new DienstFehler(`Unbekannter Bereich: ${bereich}`)
  return join(DOCS, bereich, name)
}

function verschiebe(vonAbs, nachAbs) {
  if (existsSync(nachAbs)) throw new DienstFehler(`Dort liegt schon etwas: ${relative(WURZEL, nachAbs)}`)
  mkdirSync(dirname(nachAbs), { recursive: true })
  try {
    // `git mv` behält die Historie sichtbar; ohne Git-Kenntnis der Datei
    // scheitert es, und dann tut es ein gewöhnliches Umbenennen.
    execFileSync('git', ['mv', relative(WURZEL, vonAbs), relative(WURZEL, nachAbs)], {
      cwd: WURZEL,
      stdio: 'pipe',
    })
  } catch {
    renameSync(vonAbs, nachAbs)
  }
  return relative(WURZEL, nachAbs)
}

/* ── Die vier Aktionen ────────────────────────────────────────────────── */

export function leseQuelle(rel) {
  return readFileSync(pruefePfad(rel), 'utf8')
}

export function schreibeQuelle(rel, text) {
  if (typeof text !== 'string') throw new DienstFehler('Kein Text')
  const abs = pruefePfad(rel)
  // Eine leere Datei ist fast immer ein Unfall (leeres Feld, abgestürzter
  // Editor) und der Verlust wäre still — die Datei sähe danach normal aus.
  if (!text.trim()) throw new DienstFehler('Leerer Text wird nicht gespeichert')
  writeFileSync(abs, text.endsWith('\n') ? text : text + '\n')
  return relative(WURZEL, abs)
}

export function archiviere(rel) {
  const abs = pruefePfad(rel)
  const herkunft = relative(DOCS, abs).split('/')[0]
  const neu = verschiebe(abs, archivZiel(rel))
  // Die HERKUNFT wandert mit: Im Viewer hängt das Archiv unter dem Bereich, aus
  // dem ein Dokument kam. Die Git-Historie kennt sie zwar auch (Rename), aber
  // nur solange niemand die Datei danach noch einmal verschiebt — und sie
  // beantwortet die Frage nicht beim Lesen der Datei selbst.
  const ziel = join(WURZEL, neu)
  if (ziel.endsWith('.md')) {
    const text = readFileSync(ziel, 'utf8')
    if (!/^Archiviert aus:/m.test(text))
      writeFileSync(ziel, text.replace(/^(#\s+.+\n)/, `$1\nArchiviert aus: ${herkunft}\n`))
  }
  return neu
}

export function holeZurueck(rel, bereich) {
  const neu = verschiebe(pruefePfad(rel), rueckZiel(rel, bereich))
  const ziel = join(WURZEL, neu)
  if (ziel.endsWith('.md')) {
    const text = readFileSync(ziel, 'utf8')
    // Zurückgeholt heißt: nicht mehr archiviert. Bliebe die Zeile stehen,
    // stünde das Dokument im Viewer wieder unter „Archiv".
    writeFileSync(ziel, text.replace(/^Archiviert aus:.*\n\n?/m, ''))
  }
  return neu
}

/** Baut den Viewer neu — ohne Vorschau-Screenshots, das dauert sonst zu lang. */
export function baueNeu() {
  execFileSync('node', [join(WURZEL, 'scripts', 'docs-viewer', 'build.mjs'), '--ohne-bilder'], {
    cwd: WURZEL,
    stdio: 'pipe',
  })
}

/**
 * Führt eine Aktion aus und baut danach neu. Rückgabe geht als JSON an die
 * Seite; ein Fehler wird zur Meldung, nicht zum Absturz des Dev-Servers.
 */
export function fuehreAus(aktion, daten = {}) {
  switch (aktion) {
    case 'quelle':
      return { text: leseQuelle(daten.datei) }
    case 'stand': {
      // Für die Leiste, die der Dev-Server einem geöffneten Prototyp mitgibt:
      // Welche Phasen gibt es, in welcher steht diese Datei, liegt sie im
      // Archiv? Sie kann das nicht wissen — sie läuft in fremdem HTML.
      const rel = relative(DOCS, pruefePfad(daten.datei))
      const zeilen = existsSync(ROADMAP()) ? roadmapZeilen() : []
      const phasen = []
      let phase = ''
      let aktuell = ''
      for (const zeile of zeilen) {
        const kopf = zeile.match(/^##\s+(.+)$/)
        if (kopf) {
          aktuell = kopf[1].split('·')[0].trim()
          phasen.push(aktuell)
          continue
        }
        const punkt = zeile.match(/^\*\s+\[[^\]]+\]\(([^)]+)\)/)
        if (punkt && punkt[1] === rel) phase = aktuell
      }
      return { phasen, phase, archiv: rel.startsWith('archive/'), titel: rel.split('/').pop() }
    }
    case 'speichern': {
      const pfad = schreibeQuelle(daten.datei, daten.text)
      baueNeu()
      return { pfad, meldung: `Gespeichert: ${pfad}` }
    }
    case 'archivieren': {
      const pfad = archiviere(daten.datei)
      baueNeu()
      return { pfad, meldung: `Archiviert: ${pfad}` }
    }
    case 'roadmap': {
      // Eine Aktion für beide Richtungen: Ohne Phase fliegt der Eintrag raus.
      const pfad = roadmapSetzen(daten.datei, daten.phase, daten.titel)
      baueNeu()
      return {
        pfad,
        meldung: daten.phase ? `Auf die Roadmap: ${daten.phase}` : 'Von der Roadmap genommen',
      }
    }
    case 'zurueckholen': {
      const pfad = holeZurueck(daten.datei, daten.bereich)
      baueNeu()
      return { pfad, meldung: `Zurückgeholt: ${pfad}` }
    }
    default:
      throw new DienstFehler(`Unbekannte Aktion: ${aktion}`)
  }
}

/* ── Roadmap pflegen ──────────────────────────────────────────────────────
 * Geschrieben wird in `docs/roadmap.md`, und zwar zeilenweise: Die Datei ist
 * für Menschen gemacht und bleibt es. Ein Eintrag ist eine Listenzeile unter
 * einer `##`-Überschrift; „verschieben" heißt entfernen und neu einfügen.
 *
 * Der Text nach dem Gedankenstrich (der nächste Schritt) wird beim Verschieben
 * MITGENOMMEN — er gehört zum Eintrag, nicht zur Phase. */

const ROADMAP = () => join(DOCS, 'roadmap.md')

/** Der Pfad, wie er in roadmap.md steht: relativ zu `docs/`. */
function roadmapPfad(rel) {
  return relative(DOCS, pruefePfad(rel))
}

function roadmapZeilen() {
  if (!existsSync(ROADMAP())) throw new DienstFehler('docs/roadmap.md fehlt')
  return readFileSync(ROADMAP(), 'utf8').split('\n')
}

/** Entfernt jede Listenzeile, die auf diese Datei zeigt. Gibt den Schritt zurück. */
function loeseHeraus(zeilen, pfad) {
  let schritt = ''
  const uebrig = zeilen.filter((zeile) => {
    const treffer = zeile.match(/^\*\s+\[[^\]]+\]\(([^)]+)\)\s*(?:[—–-]\s*(.*))?$/)
    if (!treffer || treffer[1] !== pfad) return true
    if (treffer[2]) schritt = treffer[2].trim()
    return false
  })
  return { uebrig, schritt, gefunden: uebrig.length !== zeilen.length }
}

export function roadmapEntfernen(rel) {
  const pfad = roadmapPfad(rel)
  const { uebrig, gefunden } = loeseHeraus(roadmapZeilen(), pfad)
  if (!gefunden) throw new DienstFehler('Steht nicht auf der Roadmap')
  writeFileSync(ROADMAP(), uebrig.join('\n'))
  return pfad
}

export function roadmapSetzen(rel, phase, beschriftung) {
  const pfad = roadmapPfad(rel)
  if (!phase) return roadmapEntfernen(rel)
  const { uebrig, schritt } = loeseHeraus(roadmapZeilen(), pfad)

  // Eingefügt wird ans ENDE der Phase, nicht an ihren Anfang: Die Reihenfolge
  // innerhalb einer Phase ist eine Rangfolge, und ein neuer Eintrag drängelt
  // sich sonst vor alles, was schon abgewogen wurde.
  let start = -1
  for (let i = 0; i < uebrig.length; i++) {
    const kopf = uebrig[i].match(/^##\s+(.+)$/)
    if (!kopf) continue
    const name = kopf[1].split('·')[0].trim()
    if (start === -1 && name === phase) start = i
    else if (start !== -1) break
  }
  if (start === -1) throw new DienstFehler(`Unbekannte Phase: ${phase}`)

  let ende = start + 1
  let letzterPunkt = -1
  for (; ende < uebrig.length; ende++) {
    if (/^##\s+/.test(uebrig[ende])) break
    if (/^\*\s+/.test(uebrig[ende])) letzterPunkt = ende
  }
  const zeile = `* [${beschriftung || basename(pfad)}](${pfad})${schritt ? ' — ' + schritt : ''}`
  const stelle = letzterPunkt === -1 ? ende : letzterPunkt + 1
  uebrig.splice(stelle, 0, zeile)
  writeFileSync(ROADMAP(), uebrig.join('\n'))
  return pfad
}
