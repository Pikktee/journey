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

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

import { WURZEL, DOCS, dateienUnter } from './sammeln.mjs'
import { setzeKopf } from './kopf.mjs'

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
      writeFileSync(ziel, setzeKopf(text, { archiviert_aus: herkunft }))
  }
  return neu
}

export function holeZurueck(rel, bereich) {
  const neu = verschiebe(pruefePfad(rel), rueckZiel(rel, bereich))
  const ziel = join(WURZEL, neu)
  if (ziel.endsWith('.md')) {
    const text = readFileSync(ziel, 'utf8')
    // Zurückgeholt heißt: nicht mehr archiviert. Blieben die Angaben stehen,
    // stünde das Dokument im Viewer wieder unter „Archiv" — in beiden
    // Schreibweisen, denn beide werden gelesen.
    writeFileSync(ziel, setzeKopf(text, { archiviert_aus: null }).replace(/^Archiviert aus:.*\n\n?/m, ''))
  }
  return neu
}

/* ── Im Editor öffnen ─────────────────────────────────────────────────────
 * Der Viewer zeigt, in welcher Datei etwas steht; von dort ist es ein Klick
 * bis zur Stelle, an der man es ändert. Ein `vscode://`-Link im Markup wäre
 * kürzer, würde aber auf einen bestimmten Editor festlegen — welcher hier
 * läuft, weiß nur dieser Rechner.
 *
 * `$EDITOR` und `$VISUAL` werden ABSICHTLICH NICHT gefragt. Sie benennen den
 * Editor für ein TERMINAL, und auf diesem Rechner steht dort `vi`: Ein
 * losgelassenes `vi` ohne Terminal öffnet nichts, beendet sich stumm — und die
 * Seite meldete „In vi geöffnet". Ein Knopf, der Erfolg behauptet und nichts
 * tut, ist schlimmer als keiner. Wer einen eigenen Editor will, setzt
 * `MAPTALE_EDITOR`; ist es einer für das Terminal, sagt der Dienst das.
 */

/**
 * Fenster-Editoren in der Reihenfolge, in der nach ihnen gesucht wird —
 * erst als Befehl im Pfad, dann als App.
 *
 * Der zweite Weg ist nötig, weil der Dev-Server über `devhub` startet und
 * dessen `PATH` nicht der einer Anmeldeshell ist: Ein CLI-Kürzel, das im
 * Terminal liegt, kann dort fehlen. `open -a` braucht keines.
 */
const EDITOREN = [
  { befehl: 'cursor', app: '/Applications/Cursor.app' },
  { befehl: 'code', app: '/Applications/Visual Studio Code.app' },
  { befehl: 'zed', app: '/Applications/Zed.app' },
  { befehl: 'subl', app: '/Applications/Sublime Text.app' },
  { befehl: 'mate', app: '/Applications/TextMate.app' },
]

/** Editoren, die ein Terminal brauchen. Losgelassen tun sie nichts Sichtbares. */
const IM_TERMINAL = new Set(['vi', 'vim', 'nvim', 'nano', 'pico', 'ed', 'emacs', 'micro', 'helix', 'hx'])

function imPfad(name) {
  try {
    execFileSync('which', [name], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Welcher Befehl öffnet eine Datei in einem Fenster? Gibt die Argumentliste
 * zurück, an die der Pfad angehängt wird — oder `null`.
 */
export function editorBefehl(umgebung = process.env, pruefe = { imPfad, existiert: existsSync }) {
  const gesetzt = String(umgebung.MAPTALE_EDITOR || '').trim()
  if (gesetzt) {
    const teile = gesetzt.split(/\s+/)
    const name = basename(teile[0])
    if (IM_TERMINAL.has(name))
      throw new DienstFehler(
        `MAPTALE_EDITOR ist „${name}" — das braucht ein Terminal und öffnet hier kein Fenster.`,
      )
    if (teile[0].includes('/') || pruefe.imPfad(teile[0])) return teile
    // Kein Kürzel im Pfad, aber ein Name, den wir als App kennen? Dann war die
    // Absicht klar — „zed" heißt „öffne es in Zed", nicht „führe zed aus". Nur
    // das CLI-Kürzel fehlt, und `open -a` braucht keines.
    const bekannt = EDITOREN.find((e) => e.befehl === name && pruefe.existiert(e.app))
    if (bekannt) return ['open', '-a', bekannt.app]
    throw new DienstFehler(`MAPTALE_EDITOR „${teile[0]}" ist nicht im Pfad.`)
  }

  for (const editor of EDITOREN) {
    if (pruefe.imPfad(editor.befehl)) return [editor.befehl]
    if (pruefe.existiert(editor.app)) return ['open', '-a', editor.app]
  }
  // Zuletzt das System entscheiden lassen: `open` nimmt, was für `.md`
  // eingestellt ist. Findet sich auch das nicht, bleibt der Pfad zum Kopieren.
  if (process.platform === 'darwin') return ['open']
  return null
}

export function oeffneImEditor(rel) {
  const abs = pruefePfad(rel)
  const befehl = editorBefehl()
  if (!befehl) throw new DienstFehler('Keinen Editor gefunden — MAPTALE_EDITOR setzen')

  // Losgelassen und nicht abgewartet: Ein Editor, der im Vordergrund bleibt,
  // hielte die Antwort auf, und die Seite wartete auf ein Fenster. Ein FEHLER
  // beim Starten wird aber noch abgefangen — sonst behauptet die Meldung etwas,
  // was nicht passiert ist, und man sucht den Fehler an der Datei.
  return new Promise((fertig, fehler) => {
    const kind = execFile(befehl[0], [...befehl.slice(1), abs], { cwd: WURZEL }, (f) => {
      if (f) fehler(new DienstFehler(`${befehl[0]} ließ sich nicht starten: ${f.message}`))
    })
    kind.unref?.()
    // Wer bis hierher lebt, ist gestartet. Auf das Ende zu warten wäre falsch:
    // `cursor <datei>` kehrt sofort zurück, `open -a` auch — ein Editor, der
    // offen bleibt, täte es nie.
    setTimeout(() => fertig({ befehl: benennung(befehl), pfad: relative(WURZEL, abs) }), 120)
  })
}

/** „open -a /Applications/Cursor.app" heißt für einen Menschen „Cursor". */
function benennung(befehl) {
  if (befehl[0] === 'open' && befehl[1] === '-a') return basename(befehl[2], '.app')
  return befehl[0]
}

/* ── Umbenennen ───────────────────────────────────────────────────────────
 * Zwei Namen, die man leicht für einen hält: die ÜBERSCHRIFT (was jemand
 * liest) und der DATEINAME (worauf alles zeigt). Der Viewer ändert beide in
 * einem Zug, denn wer eins von beidem ändert, meint fast immer beide.
 *
 * Der teure Teil ist nicht das Verschieben, sondern die VERWEISE: Ein Konzept
 * wird von README, Roadmap, Handbuch und anderen Konzepten genannt, jeweils
 * relativ zum eigenen Ort. Bliebe einer davon stehen, wäre die Umbenennung
 * ein stiller toter Link — und tote Links merkt man erst, wenn man sie braucht.
 */

/** Ein Dateiname, der in einer URL und in einem Repo unauffällig bleibt. */
export function saubererName(roh) {
  const name = String(roh || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (!name) throw new DienstFehler('Kein Dateiname')
  return name
}

/** Setzt die erste Überschrift bzw. den `<title>` — je nach Art der Datei. */
function setzeTitel(abs, titel) {
  const text = readFileSync(abs, 'utf8')
  if (abs.endsWith('.md')) {
    if (!/^#\s+.+$/m.test(text)) throw new DienstFehler('Dokument hat keine Überschrift')
    return text.replace(/^#\s+.+$/m, `# ${titel}`)
  }
  const alt = text.match(/<title>([^<]*)<\/title>/i)
  if (!alt) throw new DienstFehler('Prototyp hat keinen <title>')
  // Das Präfix „Mockup — " bleibt: Der Viewer schneidet es beim Anzeigen weg,
  // und im Browser-Tab eines geöffneten Prototyps ist es die einzige Auskunft
  // darüber, dass man einen Entwurf ansieht.
  const praefix = /^Mockup\s*[—–·|-]\s*/i.exec(alt[1])
  return text.replace(/<title>[^<]*<\/title>/i, `<title>${(praefix?.[0] ?? '') + titel}</title>`)
}

/** Jede Datei der Doku, in der ein Verweis stehen kann. */
function verweisDateien() {
  const inDocs = [...dateienUnter(DOCS, '.md'), ...dateienUnter(DOCS, '.html')]
  const imHandbuch = dateienUnter(WURZEL, '.md').filter((p) => !relative(WURZEL, p).includes('/'))
  return [...inDocs, ...imHandbuch]
}

/**
 * Zieht alle Verweise auf `vonAbs` nach `nachAbs`. Verglichen werden AUFGELÖSTE
 * Pfade und nicht Zeichenketten: Dasselbe Ziel heißt aus `docs/concepts/` `x.md`
 * und aus der Wurzel `docs/concepts/x.md`, und ein Suchen-und-Ersetzen über den
 * alten Dateinamen träfe zusätzlich jede Erwähnung im Fließtext.
 */
export function ziehVerweiseNach(vonAbs, nachAbs, namen = {}) {
  const beruehrt = []
  for (const datei of verweisDateien()) {
    if (datei === nachAbs) continue
    const alt = readFileSync(datei, 'utf8')
    let neu = alt

    // Markdown-Links zuerst, weil bei ihnen auch die BESCHRIFTUNG mitgehen
    // kann: In `docs/roadmap.md` steht der Titel im Linktext, im Index oft der
    // Dateiname. Bliebe er stehen, zeigte der Link richtig und läse sich falsch.
    neu = neu.replace(/\[([^\]\n]*)\]\(([^)\s#]+)(#[^)\s]*)?\)/g, (ganz, text, ziel, anker = '') => {
      if (/^(https?:|mailto:|#|\/)/.test(ziel)) return ganz
      if (resolve(dirname(datei), decodeURI(ziel)) !== vonAbs) return ganz
      return `[${neueBeschriftung(text, namen)}](${relative(dirname(datei), nachAbs)}${anker})`
    })

    neu = neu.replace(/(href="|href='|src="|src=')([^"'\s#]+)((?:#[^"'\s]*)?)/g, (ganz, vor, ziel, anker) => {
      if (/^(https?:|mailto:|#|\/)/.test(ziel)) return ganz
      if (resolve(dirname(datei), decodeURI(ziel)) !== vonAbs) return ganz
      return vor + relative(dirname(datei), nachAbs) + anker
    })

    if (neu !== alt) {
      writeFileSync(datei, neu)
      beruehrt.push(relative(WURZEL, datei))
    }
  }
  return beruehrt
}

/**
 * Nur eine Beschriftung, die NUR der alte Name war, wird ersetzt. „Verweist auf
 * [den Video-Export](…)" ist ein Satzteil und gehört dem Autor des Satzes —
 * eine Umbenennung darf ihm nicht in den Text schreiben.
 */
function neueBeschriftung(text, { alterTitel, neuerTitel, alteDatei, neueDatei } = {}) {
  const roh = text.replace(/`/g, '').trim()
  const wieDatei = (name) => name && (roh === name || roh === name.replace(/\.(md|html)$/, ''))
  if (alterTitel && neuerTitel && roh === alterTitel) return text.replace(alterTitel, neuerTitel)
  if (wieDatei(alteDatei) && neueDatei)
    return text.replace(roh, roh.endsWith('.md') || roh.endsWith('.html') ? neueDatei : neueDatei.replace(/\.(md|html)$/, ''))
  return text
}

export function benenneUm(rel, { titel = '', name = '' } = {}) {
  const abs = pruefePfad(rel)
  const alterTitel = titelVon(abs)
  const neuerTitel = String(titel || '').trim()
  if (neuerTitel) writeFileSync(abs, setzeTitel(abs, neuerTitel))

  const endung = extname(abs)
  const alterName = basename(abs, endung)
  const neuerName = name ? saubererName(name).replace(new RegExp(`${endung}$`), '') : alterName
  if (neuerName === alterName) return { pfad: relative(WURZEL, abs), verweise: [] }

  const ziel = join(dirname(abs), neuerName + endung)
  const neu = verschiebe(abs, ziel)
  return {
    pfad: neu,
    verweise: ziehVerweiseNach(abs, ziel, {
      alterTitel,
      neuerTitel: neuerTitel || alterTitel,
      alteDatei: alterName + endung,
      neueDatei: neuerName + endung,
    }),
  }
}

/** Die Überschrift bzw. der `<title>`, wie er JETZT dasteht. */
function titelVon(abs) {
  const text = readFileSync(abs, 'utf8')
  const treffer = abs.endsWith('.md')
    ? text.match(/^#\s+(.+)$/m)
    : text.match(/<title>([^<]*)<\/title>/i)
  return treffer ? treffer[1].replace(/^Mockup\s*[—–·|-]\s*/i, '').trim() : ''
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
export async function fuehreAus(aktion, daten = {}) {
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
    case 'oeffnen': {
      // Kein Neubau: Es hat sich nichts geändert, es liegt nur ein Fenster
      // mehr offen. Abgewartet wird nur, ob der Start überhaupt klappt.
      const { befehl, pfad } = await oeffneImEditor(daten.datei)
      return { pfad, meldung: `In ${befehl} geöffnet: ${pfad}` }
    }
    case 'umbenennen': {
      const { pfad, verweise } = benenneUm(daten.datei, daten)
      baueNeu()
      return {
        pfad,
        verweise,
        meldung: verweise.length
          ? `Umbenannt: ${pfad} (${verweise.length} ${verweise.length === 1 ? 'Verweis' : 'Verweise'} nachgezogen)`
          : `Umbenannt: ${pfad}`,
      }
    }
    case 'roadmap-verschieben': {
      const { pfad, phase } = roadmapVerschieben(daten.datei, daten.phase, daten.reihenfolge)
      baueNeu()
      return { pfad, meldung: `Nach „${phase}" verschoben` }
    }
    case 'roadmap-ordnen': {
      const { bewegt } = roadmapOrdnen(daten.phase, daten.reihenfolge)
      if (!bewegt) return { meldung: 'Reihenfolge unverändert' }
      baueNeu()
      return { meldung: 'Reihenfolge gespeichert' }
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
export function loeseHeraus(zeilen, pfad) {
  let schritt = ''
  let beschriftung = ''
  const uebrig = zeilen.filter((zeile) => {
    const treffer = zeile.match(/^\*\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*(.*))?$/)
    if (!treffer || treffer[2] !== pfad) return true
    // Der LINKTEXT ist der Name auf der Roadmap-Karte, von Hand kurz gewählt
    // („Studio-Editor zerlegen"). Ein Phasenwechsel über das Menü löst die
    // Zeile heraus und schreibt sie neu — ohne diese Zeile mit dem
    // Dokumenttitel als Beschriftung, und der ist wieder lang („Umbauplan:
    // Studio-Editor zerlegen (editor.ts)"). Das Verschieben hätte den Namen
    // stillschweigend zurückgesetzt.
    if (!/\.(md|html)$/.test(treffer[1].replace(/`/g, ''))) beschriftung = treffer[1].trim()
    if (treffer[3]) schritt = treffer[3].trim()
    return false
  })
  return { uebrig, schritt, beschriftung, gefunden: uebrig.length !== zeilen.length }
}

export function roadmapEntfernen(rel) {
  const pfad = roadmapPfad(rel)
  const { uebrig, gefunden } = loeseHeraus(roadmapZeilen(), pfad)
  if (!gefunden) throw new DienstFehler('Steht nicht auf der Roadmap')
  writeFileSync(ROADMAP(), uebrig.join('\n'))
  return pfad
}

/**
 * Verschiebt einen Eintrag INNERHALB seiner Phase um einen Platz.
 *
 * Die Reihenfolge in einer Phase ist eine Rangfolge — bisher konnte man sie nur
 * in `roadmap.md` von Hand ändern, und der Viewer hängte neue Einträge stumm
 * ans Ende. Getauscht werden ganze ZEILEN mit dem nächsten Listenpunkt; an der
 * Phasengrenze passiert nichts, denn ein Sprung über sie hinweg wäre ein
 * Phasenwechsel und dafür gibt es das Menü.
 */
/**
 * Ordnet die Listenzeilen EINER Phase in der übergebenen Reihenfolge neu.
 *
 * Die ganze Reihenfolge statt eines Tauschs: Ein Zug mit der Maus kann an jede
 * Stelle gehen, und wer zwei Plätze überspringt, will nicht zwei Anfragen. Was
 * in `pfade` fehlt, behält seine relative Lage am Ende — so kann eine veraltete
 * Seite die Datei nicht leer räumen.
 *
 * Reine Funktion über Zeilen, damit sie prüfbar ist, ohne in `roadmap.md` zu
 * schreiben.
 */
export function ordnePhase(zeilen, phase, pfade) {
  const istPunkt = (z) => /^\*\s+\[[^\]]+\]\(/.test(z)
  const pfadVon = (z) => z.match(/^\*\s+\[[^\]]+\]\(([^)]+)\)/)?.[1] ?? ''

  let start = -1
  for (let i = 0; i < zeilen.length; i++) {
    const kopf = zeilen[i].match(/^##\s+(.+)$/)
    if (!kopf) continue
    if (kopf[1].split('·')[0].trim() === phase) {
      start = i
      break
    }
  }
  if (start === -1) return null

  // Die Punkte dieser Phase, mit ihren Zeilennummern.
  const stellen = []
  for (let i = start + 1; i < zeilen.length && !/^##\s+/.test(zeilen[i]); i++)
    if (istPunkt(zeilen[i])) stellen.push(i)
  if (!stellen.length) return null

  const vorhanden = stellen.map((i) => zeilen[i])
  const nachPfad = new Map(vorhanden.map((z) => [pfadVon(z), z]))
  const gewuenscht = pfade.map((p) => nachPfad.get(p)).filter(Boolean)
  const rest = vorhanden.filter((z) => !gewuenscht.includes(z))
  const neu = [...gewuenscht, ...rest]
  if (neu.every((z, k) => z === vorhanden[k])) return null

  const kopie = [...zeilen]
  stellen.forEach((zeile, k) => {
    kopie[zeile] = neu[k]
  })
  return kopie
}

export function roadmapOrdnen(phase, pfade) {
  if (!Array.isArray(pfade) || !pfade.length) throw new DienstFehler('Keine Reihenfolge angegeben')
  const inDocs = pfade.map((p) => relative(DOCS, pruefePfad(p)))
  const neu = ordnePhase(roadmapZeilen(), String(phase || ''), inDocs)
  if (!neu) return { bewegt: false }
  writeFileSync(ROADMAP(), neu.join('\n'))
  return { bewegt: true }
}

/**
 * Ein Zug in eine andere Spalte: Phase wechseln UND die Reihenfolge dort setzen.
 *
 * Zwei Schritte, ein Aufruf — und der erste ist der vorhandene Phasenwechsel,
 * damit Kurzname, nächster Schritt und `[wartet auf: …]` mitgehen. Sie
 * nachzubauen wäre die zweite Stelle, an der dieselbe Zeile entsteht.
 */
export function roadmapVerschieben(rel, phase, reihenfolge) {
  // ERST prüfen, DANN schreiben. Zwei Schreibvorgänge hintereinander, und der
  // zweite scheitert: Dann steht die Phase schon woanders, während die Meldung
  // „Außerhalb der Doku" behauptet, es sei nichts passiert. Genau so gesehen,
  // an einem falschen Pfad in der Reihenfolge.
  const liste = Array.isArray(reihenfolge) ? reihenfolge : []
  for (const p of liste) pruefePfad(p)

  const pfad = roadmapSetzen(rel, phase)
  if (liste.length) roadmapOrdnen(phase, liste)
  return { pfad, phase }
}

export function roadmapSetzen(rel, phase, beschriftung) {
  const pfad = roadmapPfad(rel)
  if (!phase) return roadmapEntfernen(rel)
  const { uebrig, schritt, beschriftung: vorhanden } = loeseHeraus(roadmapZeilen(), pfad)

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
  // Ein vorhandener Kurzname schlägt den übergebenen Titel: Wer eine Phase
  // wechselt, will nicht den Namen ändern.
  const zeile = `* [${vorhanden || beschriftung || basename(pfad)}](${pfad})${schritt ? ' — ' + schritt : ''}`
  const stelle = letzterPunkt === -1 ? ende : letzterPunkt + 1
  uebrig.splice(stelle, 0, zeile)
  writeFileSync(ROADMAP(), uebrig.join('\n'))
  return pfad
}
