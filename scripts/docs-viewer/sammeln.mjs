/*
 * Liest `docs/` ein und macht daraus ein Modell: Bereiche, Dokumente, Mockups,
 * Querverweise.
 *
 * Zwei Dinge, die man leicht anders bauen würde und die dann schlechter sind:
 *
 * 1. Der KLAPPENTEXT kommt aus `docs/README.md`, nicht aus dem Dokument. Der
 *    Index dort ist von Hand geschrieben und sagt in einem Satz, wofür ein
 *    Dokument gut ist; der erste Absatz des Dokuments sagt meist etwas anderes
 *    (Ziel, Vorbedingung, Lizenz-Warnung). Fehlt ein Eintrag, fällt es auf den
 *    ersten Absatz zurück — dann steht dort etwas Brauchbares statt nichts.
 * 2. Die QUERVERWEISE werden in beide Richtungen geführt. Ein Konzept nennt
 *    seine Vorbedingungen; interessant ist aber genauso, WER auf ein Dokument
 *    zeigt. Beides zusammen ist die Karte am Ende der Übersicht.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

import { kopfAusHtml, kopfVon, saeubere } from './kopf.mjs'

export { saeubere }

/** Die Bereiche in Lesereihenfolge. `ton` ist die Leitfarbe, `motiv` das SVG. */
export const BEREICHE = [
  {
    id: 'handbuch',
    name: 'Handbuch',
    kurz: 'Grundlage',
    motiv: 'kompass',
    ton: '#ff6f52',
    text: 'Die Dateien an der Wurzel: Marke, Repo-Anleitung, die CLAUDE.md je Bereich.',
  },
  {
    id: 'architecture',
    name: 'Architektur',
    kurz: 'Gebaut',
    motiv: 'schichten',
    ton: '#3ecf8e',
    text: 'Umgesetzte Entscheidungen. Wie das Ding heute wirklich funktioniert.',
  },
  {
    id: 'concepts',
    name: 'Konzepte',
    kurz: 'Geplant',
    motiv: 'horizont',
    ton: '#f59e0b',
    text: 'Entwürfe und offene Vorhaben. Manches halb gebaut, manches nur gedacht.',
  },
  {
    id: 'specs',
    name: 'Spezifikationen',
    kurz: 'Verbindlich',
    motiv: 'raster',
    ton: '#c58bff',
    text: 'Datenformate und Schnittstellen. Wer ein Feld hinzufügt, liest hier.',
  },
  {
    id: 'ops',
    name: 'Betrieb',
    kurz: 'Runbooks',
    motiv: 'route',
    ton: '#5b9dff',
    text: 'Deployment, Release, Zugänge. Schritt für Schritt, zum Nachmachen.',
  },
  // Das Archiv ist KEIN eigener Bereich mehr, sondern hängt unter dem Bereich,
  // aus dem ein Dokument kam (Kopfzeile „Archiviert aus: …"). Eine eigene
  // Kachel führte in einen Raum, in dem Konzepte und Architektur-Notizen
  // durcheinanderlagen — und ihre Nachbarschaft blieb genau dort, wo sie
  // hingehört: bei den Dokumenten, die dieselbe Sache betreffen.
]

/**
 * Ein Bereich, den oben niemand beschrieben hat.
 *
 * Ein neuer Ordner unter `docs/` soll IM VIEWER ERSCHEINEN, nicht still in den
 * Archiv-Topf fallen: Wer `docs/forschung/` anlegt, hat einen Bereich gemeint.
 * Er bekommt hier ein Gerüst und erscheint sofort — mit einer Warnung beim
 * Bauen, damit ihm jemand Farbe, Motiv und einen Satz gibt.
 */
function bereichAusOrdner(id) {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    kurz: 'Neu',
    motiv: 'raster',
    ton: '#a7b1bf',
    text: `Ordner \`docs/${id}/\`. Noch ohne Beschreibung in scripts/docs-viewer/sammeln.mjs.`,
    ergaenzt: true,
  }
}

const BEREICH_NACH_ID = new Map(BEREICHE.map((b) => [b.id, b]))

/** Unterordner von `docs/`, die Dokumente enthalten — die Wahrheit auf der Platte. */
function ordnerMitDokumenten() {
  return [
    ...new Set(
      dateienUnter(DOCS, '.md')
        .map((p) => relative(DOCS, p))
        .filter((p) => p.includes('/') && basename(p) !== 'README.md' && !p.startsWith('archive/'))
        .map((p) => p.split('/')[0]),
    ),
  ]
}

/**
 * Die Bereichsliste für DIESEN Lauf: die beschriebenen zuerst, danach jeder
 * Ordner, den niemand beschrieben hat. Beschriebene Bereiche ohne Dokumente
 * fallen raus — eine leere Kachel wäre eine Auskunft über nichts.
 */
export function bereicheDieserDoku() {
  const vorhanden = ordnerMitDokumenten()
  const beschrieben = BEREICHE.filter((b) => b.id === 'handbuch' || vorhanden.includes(b.id))
  const ergaenzt = vorhanden
    .filter((id) => !BEREICH_NACH_ID.has(id))
    .sort()
    .map(bereichAusOrdner)
  for (const b of ergaenzt) BEREICH_NACH_ID.set(b.id, b)
  // Die Ergänzten stehen VOR dem Archiv: Neues gehört nach vorn, Historie
  // bleibt hinten.
  const archivIndex = beschrieben.findIndex((b) => b.id === 'archive')
  if (archivIndex === -1) return [...beschrieben, ...ergaenzt]
  return [...beschrieben.slice(0, archivIndex), ...ergaenzt, ...beschrieben.slice(archivIndex)]
}

/** Wurzel des Repos, egal von wo das Skript gestartet wird. */
export const WURZEL = resolve(dirname(new URL(import.meta.url).pathname), '..', '..')
export const DOCS = join(WURZEL, 'docs')

/* ── Dateien finden ───────────────────────────────────────────────────── */

/** Ordner, die nie Doku enthalten — `node_modules` liegt auch unter `server/`. */
const NICHT_HINEIN = new Set(['node_modules', '_site', 'dist', 'build', 'coverage', 'daten'])

export function dateienUnter(ordner, endung) {
  if (!existsSync(ordner)) return []
  const gefunden = []
  for (const eintrag of readdirSync(ordner)) {
    if (eintrag.startsWith('.') || NICHT_HINEIN.has(eintrag)) continue
    const pfad = join(ordner, eintrag)
    if (statSync(pfad).isDirectory()) gefunden.push(...dateienUnter(pfad, endung))
    else if (eintrag.endsWith(endung)) gefunden.push(pfad)
  }
  return gefunden.sort()
}

/* ── Metadaten aus dem Text ───────────────────────────────────────────── */

/** Erste `# `-Zeile. Ohne sie nimmt der Dateiname die Rolle ein. */
function titelAus(text, datei) {
  const treffer = text.match(/^#\s+(.+)$/m)
  return treffer ? saeubere(treffer[1]) : basename(datei, '.md')
}

/**
 * Der Kopf eines Dokuments steht als Front Matter darin, wo einer gepflegt
 * wird, und sonst als Prosa-Zeile darunter. Beides liest `kopf.mjs`; hier wird
 * nur noch benutzt, was dabei herauskommt. Ohne Kopf bleibt es leer — ein
 * erfundener Status wäre schlimmer als keiner.
 */

/**
 * Aus dem Status-Satz wird eine Ampel. Die Reihenfolge der Prüfungen ist die
 * Substanz: „teilweise gebaut" enthält „gebaut", darf aber nicht grün werden,
 * und „nichts gebaut" erst recht nicht.
 */
export function ampelAus(kopf, bereichId, archiviert = false) {
  if (archiviert) return { art: 'ruht', wort: 'Historie' }
  const s = (kopf.status || '').toLowerCase()
  if (!s) return null
  // „noch nicht gebaut" und „nichts davon umgesetzt" enthalten beide Wörter,
  // an denen die späteren Prüfungen hängen — sie müssen VOR ihnen stehen, sonst
  // wird ein ungebautes Konzept grün.
  if (
    /nichts gebaut|noch nicht gebaut|nicht gebaut|nichts davon umgesetzt|nicht umgesetzt|vertagt|entwurf|konzept,|geplant|nur gedacht|verworfen/.test(
      s,
    )
  )
    return { art: 'offen', wort: 'Entwurf' }
  if (/teilweise|etappe|paket|offen|steht aus|rest/.test(s))
    return { art: 'unterwegs', wort: 'Unterwegs' }
  if (/gebaut|live|erledigt|abgeschlossen|fertig/.test(s))
    return { art: 'fertig', wort: 'Gebaut' }
  return { art: 'unterwegs', wort: 'Unterwegs' }
}

/** Erster echter Absatz — Fallback für den Klappentext. */
function ersterAbsatzAus(text) {
  const zeilen = text.split('\n')
  let sammel = []
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i].trim()
    if (!z) {
      if (sammel.length) break
      continue
    }
    if (z.startsWith('#') || z.startsWith('```') || z.startsWith('|') || z.startsWith('>')) {
      if (sammel.length) break
      continue
    }
    if (/^(Stand|Status|Betrifft):/.test(z)) continue
    sammel.push(z)
    if (sammel.join(' ').length > 260) break
  }
  const satz = saeubere(sammel.join(' '))
  return satz.length > 250 ? satz.slice(0, 247).replace(/\s\S*$/, '') + '…' : satz
}

/** Überschriften für das Inhaltsverzeichnis und die Suche. */
function ueberschriftenAus(text) {
  const raus = []
  let imBlock = false
  for (const zeile of text.split('\n')) {
    if (/^```/.test(zeile)) imBlock = !imBlock
    if (imBlock) continue
    const t = zeile.match(/^(#{2,3})\s+(.+)$/)
    if (t) raus.push({ ebene: t[1].length, titel: saeubere(t[2]) })
  }
  return raus
}

/** Links auf andere Dokumente — absolut aufgelöst, damit sie vergleichbar sind. */
function verweiseAus(text, datei) {
  const raus = new Set()
  for (const t of text.matchAll(/\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
    const ziel = t[1]
    if (/^https?:/.test(ziel)) continue
    const abs = resolve(dirname(datei), ziel)
    if (abs.startsWith(WURZEL)) raus.add(abs)
  }
  return [...raus]
}

/* ── Git ──────────────────────────────────────────────────────────────── */

/**
 * Letzte Änderung und Zahl der Überarbeitungen. Ein Dokument, das zwölfmal
 * angefasst wurde, ist ein anderes als eines, das einmal hingelegt wurde —
 * und ohne Git-Datum wäre die Sortierung „zuletzt geändert" geraten.
 */
function gitStandFuer(pfade) {
  const stand = new Map()
  try {
    const roh = execFileSync(
      'git',
      ['log', '--format=%H|%aI', '--name-only', '--', ...pfade],
      { cwd: WURZEL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    let datum = ''
    for (const zeile of roh.split('\n')) {
      if (/^[0-9a-f]{7,}\|/.test(zeile)) {
        datum = zeile.split('|')[1]
        continue
      }
      const pfad = zeile.trim()
      if (!pfad) continue
      const vorher = stand.get(pfad)
      if (!vorher) stand.set(pfad, { datum, aenderungen: 1 })
      else vorher.aenderungen++
    }
  } catch {
    /* kein Git, keine Historie — die Seite steht trotzdem. */
  }
  return stand
}

/* ── Klappentexte aus docs/README.md ──────────────────────────────────── */

/**
 * Der handgeschriebene Index ist die beste Quelle für „wofür ist das da".
 * Gelesen werden Listenzeilen der Form `* [`datei.md`](pfad) — Text.`
 */
function klappentexteAusIndex() {
  const pfad = join(DOCS, 'README.md')
  if (!existsSync(pfad)) return new Map()
  const raus = new Map()
  for (const zeile of readFileSync(pfad, 'utf8').split('\n')) {
    const t = zeile.match(/^\*\s+\[[^\]]+\]\(([^)]+\.md)\)\s*[—–-]\s*(.+)$/)
    if (!t) continue
    raus.set(t[1].replace(/^\.\//, ''), saeubere(t[2]))
  }
  return raus
}

/* ── Öffentlich ───────────────────────────────────────────────────────── */

/**
 * Die Wurzel-Dateien. Sie stehen absichtlich NICHT unter `docs/` (ein Agent
 * soll sie im Repo finden, ohne einen Ordner zu kennen), gehören im Viewer aber
 * nach vorn: Ohne DESIGN.md und die CLAUDE.md-Dateien liest man die Konzepte
 * ohne ihren Rahmen.
 */
/**
 * Wo im Repo Handbuch-Dateien liegen dürfen. Gesucht wird JEDE `CLAUDE.md`
 * unter diesen Wurzeln plus die drei Wurzel-Dateien — eine neue
 * `src/galerie/CLAUDE.md` erscheint dadurch von selbst. Die Tabelle unten gibt
 * nur noch Titel und Klappentext, wo jemand sie geschrieben hat; sie ist
 * Redaktion, keine Bedingung fürs Erscheinen.
 */
const HANDBUCH_WURZELN = ['src', 'server', 'android', 'scripts', 'test']

const HANDBUCH = [
  ['CLAUDE.md', 'Projekt-Handbuch', 'Das Buch zum Repo: Aufbau, Player-Engine, Routen, Konventionen. Wer eines der anderen Dokumente liest, hat meist hier angefangen.'],
  ['DESIGN.md', 'Design System', 'Marke, Farben, Typografie und die UI-Regeln. Verbindliche Quelle; basis.css und Theme.kt sind Ableitungen davon.'],
  ['README.md', 'Repo-Anleitung', 'Was Maptale ist und wie man es startet. Der Einstieg für alle, die das Repo zum ersten Mal öffnen.'],
  ['src/studio/CLAUDE.md', 'Handbuch: Studio', 'Zeitleiste, Editor, Upload-Befund, Ton-Klips. Lädt automatisch, sobald unter src/studio/ gearbeitet wird.'],
  ['server/CLAUDE.md', 'Handbuch: Backend', 'Anreicherungs-Pipeline, Konten, Mails, Quota. Was der Server aus Rohdaten und Overlay macht.'],
  ['src/admin/CLAUDE.md', 'Handbuch: Verwaltung', 'Die Reiter der Benutzerverwaltung, das Protokoll und die Fallen ihrer Dialoge.'],
  ['android/CLAUDE.md', 'Handbuch: Android', 'Aufnahme-App: Architektur, Upload-Fluss, Room-Migrationen, WebView-Sitzung.'],
]

/**
 * Alle Handbuch-Dateien: die drei an der Wurzel und jede `CLAUDE.md` unter den
 * bekannten Wurzeln. Die Reihenfolge folgt der Tabelle; was dort nicht steht,
 * hängt sich alphabetisch hinten an, statt zu fehlen.
 */
function handbuchDateien() {
  const ausTabelle = HANDBUCH.map(([p]) => join(WURZEL, p)).filter((p) => existsSync(p))
  const gefunden = HANDBUCH_WURZELN.flatMap((w) => dateienUnter(join(WURZEL, w), 'CLAUDE.md'))
  const zusaetzlich = gefunden.filter((p) => !ausTabelle.includes(p)).sort()
  return { dateien: [...ausTabelle, ...zusaetzlich], zusaetzlich }
}

/**
 * Titel einer Handbuch-Datei, die in der Tabelle nicht steht. Die erste
 * Überschrift einer `CLAUDE.md` heißt oft „CLAUDE.md" und sagt damit nichts —
 * der Ordner sagt es.
 */
function handbuchTitel(rel, text) {
  if (basename(rel) !== 'CLAUDE.md') return titelAus(text, rel)
  const ordner = dirname(rel)
  return ordner === '.' ? 'Projekt-Handbuch' : `Handbuch: ${ordner}`
}

export function sammleDokumente() {
  const klappentexte = klappentexteAusIndex()
  // README.md ist der Index und roadmap.md die Steuerdatei der Roadmap —
  // beide sind Quellen des Viewers und keine Dokumente in ihm.
  const ausDocs = dateienUnter(DOCS, '.md').filter(
    (p) => !['README.md', 'roadmap.md'].includes(basename(p)),
  )
  const { dateien: ausWurzel } = handbuchDateien()
  const git = gitStandFuer(['docs', ...ausWurzel.map((p) => relative(WURZEL, p))])

  const dokumente = [...ausWurzel, ...ausDocs].map((abs) => {
    const imHandbuch = !abs.startsWith(DOCS + '/')
    const rel = relative(imHandbuch ? WURZEL : DOCS, abs)
    const imRepo = relative(WURZEL, abs)
    // Der ROHE Inhalt geht in den Editor, der KÖRPER in alles andere: Front
    // Matter ist eine Angabe über das Dokument und kein Teil seines Textes —
    // stünde er drin, zählte er als Lesezeit mit, würde durchsucht und
    // erschiene als erster Absatz.
    const roh = readFileSync(abs, 'utf8')
    // Der Kopf wird nur unter `docs/` gelesen. `DESIGN.md` an der Wurzel trägt
    // selbst einen YAML-Block (Google-DESIGN.md-Format) — und der IST dort der
    // Inhalt: Farben, Schrift, Maße. Als Metadaten gedeutet verschwände das
    // halbe Design-System aus der Ansicht, ohne dass eine Zeile fehlte.
    const kopf = imHandbuch ? kopfVon('') : kopfVon(roh)
    const text = imHandbuch ? roh : kopf.koerper
    const archiviert = !imHandbuch && rel.startsWith('archive/')
    // Ein archiviertes Dokument gehört weiterhin zu seinem Bereich — es steht
    // dort nur unter einer eigenen Überschrift. Ohne Herkunftszeile landet es
    // bei den Konzepten: der Ort, aus dem erfahrungsgemäß fast alles kommt.
    const bereichId = archiviert
      ? (kopf.archiviertAus ?? 'concepts')
      : imHandbuch
        ? 'handbuch'
        : rel.split('/')[0]
    const bereich = BEREICH_NACH_ID.get(bereichId) ?? BEREICH_NACH_ID.get('concepts')
    const ziel = imHandbuch
      ? `handbuch/${rel.replace(/\.md$/, '').replace(/\//g, '-').toLowerCase()}.html`
      : rel.replace(/\.md$/, '.html')
    const worte = text.split(/\s+/).filter(Boolean).length
    return {
      abs,
      quelle: relative(WURZEL, abs),
      ziel,
      bereich: bereich.id,
      titel: imHandbuch
        ? (HANDBUCH.find(([p]) => p === rel)?.[1] ?? handbuchTitel(rel, text))
        : titelAus(text, rel),
      klappentext: imHandbuch
        ? (HANDBUCH.find(([p]) => p === rel)?.[2] ?? ersterAbsatzAus(text))
        : klappentexte.get(rel) || ersterAbsatzAus(text),
      kopf,
      archiviert,
      ampel: imHandbuch
        ? { art: 'verbindlich', wort: 'Verbindlich' }
        : ampelAus(kopf, bereich.id, archiviert),
      ueberschriften: ueberschriftenAus(text),
      verweise: verweiseAus(text, abs),
      rueckverweise: [],
      teile: systemteileVon(text, {
        quelle: relative(WURZEL, abs),
        genannt: kopf.systemteile,
      }),
      worte,
      minuten: Math.max(1, Math.round(worte / 220)),
      geaendert: git.get(imRepo)?.datum || '',
      aenderungen: git.get(imRepo)?.aenderungen || 0,
      text,
    }
  })

  // Rückverweise: erst wenn alle da sind, kann man sie eintragen.
  const nachAbs = new Map(dokumente.map((d) => [d.abs, d]))
  for (const d of dokumente)
    for (const v of d.verweise) nachAbs.get(v)?.rueckverweise.push(d.abs)

  return dokumente
}

/**
 * Mockups sind HTML-Prototypen. Ihr Titel steht im `<title>`, ihr Klappentext
 * im Index — beides ohne DOM-Parser, ein Prototyp hat genau einen Titel.
 *
 * Stand und Status kommen aus `<meta name="maptale:…">`: HTML kennt kein Front
 * Matter, aber dieselbe Frage („ist dieser Entwurf noch aktuell?") stellt sich
 * an einem Prototyp genauso, und bisher konnte er sie nicht beantworten.
 */
export function sammleMockups() {
  const klappentexte = klappentexteAusIndex()
  const git = gitStandFuer(['docs/mockups', 'docs/archive/mockups'])
  return dateienUnter(join(DOCS, 'mockups'), '.html')
    .concat(dateienUnter(join(DOCS, 'archive', 'mockups'), '.html'))
    .map((p) => {
      const rel = relative(DOCS, p)
      const text = readFileSync(p, 'utf8')
      const titel = text.match(/<title>([^<]*)<\/title>/i)
      const archiv = rel.startsWith('archive/')
      const kopf = kopfAusHtml(text)
      const imRepo = relative(WURZEL, p)
      return {
        quelle: rel,
        quellePfad: imRepo,
        kopf,
        ampel: archiv ? { art: 'ruht', wort: 'Historie' } : ampelAus(kopf, 'mockups', false),
        geaendert: git.get(imRepo)?.datum || '',
        name: basename(rel, '.html'),
        // „Mockup — Maptale App, Bilder hinzufügen" wird zu „Maptale App,
        // Bilder hinzufügen": Das Wort „Mockup" steht schon über der Kachel,
        // und ein Schnitt am ersten Gedankenstrich ließe nur es übrig.
        titel: titel
          ? saeubere(titel[1])
              .replace(/^Mockup\s*[—–·|-]\s*/i, '')
              .replace(/\s*[·|]\s*Maptale\s*$/i, '')
          : basename(rel, '.html'),
        klappentext: klappentexte.get(rel) || '',
        teile: systemteileVon(text, {
          name: basename(rel, '.html'),
          quelle: 'docs/' + rel,
          genannt: kopf.systemteile,
        }),
        archiv,
        vorschau: `vorschau/${rel.replace(/[/.]/g, '-')}.webp`,
        // Jeder Prototyp hat seine eigene Seite im Viewer — die Kachel führt
        // dorthin und nicht mehr direkt in ein neues Fenster.
      }
    })
}

/**
 * Ist dieses Vorhaben durch? Gemeint ist der PLAN, nicht das Produkt: „Pakete
 * A–G gebaut, der Plan ist damit abgearbeitet" heißt erledigt, auch wenn der
 * Text danach noch freie Stücke aufzählt. „Etappen 0–6 gebaut" heißt es nicht;
 * dort stehen die nächsten Etappen noch aus.
 */
export function istErledigt(status) {
  const s = (status || '').toLowerCase()
  if (!s) return false
  return /abgearbeitet|abgeschlossen|erledigt|fertig gebaut|vollständig/.test(s)
}

/**
 * Die Roadmap aus `docs/roadmap.md`.
 *
 * Sie wird GELESEN, nicht abgeleitet: Eine Reihenfolge ist eine Entscheidung,
 * und aus Dateien lässt sie sich nicht erraten. Was der Generator dagegen tut,
 * ist Buch führen — jedes Konzept, das in keiner Phase steht, kommt als „noch
 * nicht eingeplant" zurück. So fällt ein vergessenes Dokument auf, statt still
 * zu fehlen; das ist die eine Sorte Vollständigkeit, die eine Roadmap braucht.
 *
 * Der STATUS steht bewusst nicht hier, sondern im Dokument selbst. Zwei
 * Wahrheiten über denselben Gegenstand laufen sonst auseinander, und die
 * gepflegtere ist immer die, die beim Arbeiten sowieso angefasst wird.
 */
export function sammleRoadmap(dokumente, mockups = []) {
  const datei = join(DOCS, 'roadmap.md')
  const nachAbs = new Map(dokumente.map((d) => [d.abs, d]))
  // Mockups zählen mit: Ein Prototyp IST oft der nächste Schritt („so soll es
  // aussehen"), und ihn auf der Roadmap zu verbieten hieße, ihn zu vergessen.
  const mockupNachAbs = new Map(mockups.map((m) => [join(DOCS, m.quelle), m]))
  if (!existsSync(datei)) return { phasen: [], offen: [], unbekannt: [], phasenNamen: [] }

  const phasen = []
  const unbekannt = []
  let aktuell = null
  for (const zeile of readFileSync(datei, 'utf8').split('\n')) {
    const ueberschrift = zeile.match(/^##\s+(.+)$/)
    if (ueberschrift) {
      const [name, zeitraum = ''] = saeubere(ueberschrift[1]).split('·').map((t) => t.trim())
      aktuell = { name, zeitraum, text: '', eintraege: [] }
      phasen.push(aktuell)
      continue
    }
    if (!aktuell) continue
    const punkt = zeile.match(/^\*\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*(.+))?$/)
    if (punkt) {
      const abs = resolve(DOCS, punkt[2])
      const { schritt, wartetAuf } = zerlegeSchritt(punkt[3])
      // Die Beschriftung aus roadmap.md IST der Kartentitel — dort steht der
      // kurze Name, den jemand für diesen Plan gewählt hat. Nur wo noch der
      // Dateiname steht (die alte Form), nimmt die Karte den Dokumenttitel.
      const beschriftung = /\.(md|html)$/.test(punkt[1].replace(/`/g, '')) ? '' : saeubere(punkt[1])
      const dok = nachAbs.get(abs)
      const mockup = mockupNachAbs.get(abs)
      if (dok)
        aktuell.eintraege.push({ art: 'dokument', dok, quelle: dok.quelle, schritt, beschriftung, wartetAuf })
      else if (mockup)
        aktuell.eintraege.push({
          art: 'mockup',
          mockup,
          quelle: 'docs/' + mockup.quelle,
          schritt,
          beschriftung,
          wartetAuf,
        })
      else unbekannt.push(punkt[2])
      continue
    }
    const text = zeile.trim()
    if (text && !text.startsWith('*') && !aktuell.text) aktuell.text = saeubere(text)
  }

  /*
   * „Nicht eingeplant" war ein Sammeltopf mit drei verschiedenen Dingen:
   * Vergessenes, Erledigtes („Pakete A–G gebaut, der Plan ist abgearbeitet")
   * und ein Backlog, das selbst eine Ideensammlung ist. Als eine Liste gelesen
   * behauptete er drei Versäumnisse, wo eines war. Also getrennt.
   */
  const eingeplant = new Set(
    phasen.flatMap((p) => p.eintraege.map((e) => (e.art === 'mockup' ? e.mockup.quelle : e.dok.abs))),
  )
  // Archivierte Konzepte gehören nicht auf die Roadmap: Sie sind erledigt
  // oder verworfen, und als „noch nicht eingeplant" zu erscheinen wäre eine
  // Aufforderung, sie einzuplanen.
  const uebrig = dokumente.filter(
    (d) => d.bereich === 'concepts' && !d.archiviert && !eingeplant.has(d.abs),
  )
  const erledigt = uebrig.filter((d) => istErledigt(d.kopf.status))
  const offen = uebrig.filter((d) => !istErledigt(d.kopf.status))

  /*
   * „Ohne Phase" ist zwei verschiedene Dinge, und das teurere davon ging darin
   * unter: ein Vorhaben, an dem SCHON GEARBEITET WIRD, das aber in keiner Phase
   * steht. Genau das ist gerade der Fall — ein Konzept auf „Etappe 1 gebaut"
   * erscheint auf der Roadmap überhaupt nicht, weil niemand es eingeplant hat.
   * Das ist dieselbe Frage wie „Stand prüfen", nur andersherum: Dort widerspricht
   * der Stand der Phase, hier gibt es gar keine.
   */
  const imCode = offen.filter((d) => ['unterwegs', 'fertig'].includes(d.ampel?.art))
  const nurGedacht = offen.filter((d) => !imCode.includes(d))

  verketteBlockaden(phasen.flatMap((p) => p.eintraege), nachAbs, mockupNachAbs)

  return {
    phasen: phasen.filter((p) => p.eintraege.length),
    offen,
    imCode,
    nurGedacht,
    unbekannt,
    // Die Namen ALLER Phasen (auch der leeren) — die Auswahlfelder im Viewer
    // müssen auch in eine noch leere Phase einsortieren können.
    erledigt,
    phasenNamen: phasen.map((p) => p.name),
    eingeplant,
  }
}

/* ── Blockaden ────────────────────────────────────────────────────────────
 * Die wichtigste Angabe der ganzen Datei stand bisher als Prosa in einer Zeile
 * („Esri-Lizenz klären: sie blockiert den Video-Export") und war damit für die
 * Ansicht unsichtbar. Aus einer sortierten Liste wird erst mit ihr ein Ablauf.
 *
 * Notiert wird sie am WARTENDEN Eintrag (`[wartet auf: …]`), nicht am
 * blockierenden: Wer etwas einplant, weiß in diesem Moment, worauf es wartet —
 * die andere Richtung müsste man in einer fremden Zeile nachtragen und würde
 * sie vergessen. Die Gegenrichtung leitet der Sammler ab, damit sie nicht
 * auseinanderlaufen kann.
 *
 * In der Zeile und nicht als Unterpunkt, weil `roadmapSetzen` beim Verschieben
 * einer Phase GANZE ZEILEN umhängt: Ein Unterpunkt bliebe zurück.
 */

/** Trennt `[wartet auf: pfad]` vom nächsten Schritt. */
function zerlegeSchritt(roh) {
  if (!roh) return { schritt: '', wartetAuf: '' }
  const treffer = roh.match(/\s*\[wartet auf:\s*([^\]]+)\]\s*$/i)
  return {
    schritt: saeubere(treffer ? roh.slice(0, treffer.index) : roh),
    wartetAuf: treffer ? treffer[1].trim() : '',
  }
}

/** Hängt beide Richtungen an die Einträge: `wartet` und `blockiert`. */
function verketteBlockaden(eintraege, nachAbs, mockupNachAbs) {
  const nachQuelle = new Map(eintraege.map((e) => [e.quelle, e]))
  for (const e of eintraege) {
    e.wartet = null
    e.blockiert = e.blockiert || []
  }
  for (const e of eintraege) {
    if (!e.wartetAuf) continue
    const abs = resolve(DOCS, e.wartetAuf)
    const ziel = nachAbs.get(abs) ?? mockupNachAbs.get(abs)
    if (!ziel) continue
    const quelle = ziel.abs ? relative(WURZEL, ziel.abs) : 'docs/' + ziel.quelle
    const eintragDesZiels = nachQuelle.get(quelle)
    e.wartet = { quelle, titel: kurzTitel(eintragDesZiels, ziel), ziel: zielSeite(ziel) }
    // Die Gegenrichtung nur, wenn das Ziel selbst auf der Roadmap steht — sonst
    // gibt es keine Karte, an der sie stehen könnte.
    if (eintragDesZiels)
      eintragDesZiels.blockiert.push({
        quelle: e.quelle,
        titel: kurzTitel(e, e.dok ?? e.mockup),
        ziel: zielSeite(e.dok ?? e.mockup),
      })
  }
}

/** Der Name, den ein Eintrag auf der Karte trägt. */
function kurzTitel(eintrag, objekt) {
  if (eintrag?.beschriftung) return eintrag.beschriftung
  return String(objekt?.titel ?? '').replace(/^(Konzept|Umbauplan|Umsetzung):\s*/, '')
}

function zielSeite(objekt) {
  return objekt?.ziel ?? objekt?.quelle ?? ''
}

/* ── Ist der Status veraltet? ─────────────────────────────────────────────
 * Der `status`-Satz ist eine BEHAUPTUNG von Hand, und seine einzige Schwäche
 * ist stilles Veralten: Wer eine Etappe baut und vergisst, den Satz
 * nachzuziehen, hinterlässt eine Doku, die aussieht wie gepflegt.
 *
 * ZWEIMAL VERSUCHT, ES AM CODE ZU MESSEN, und zweimal verworfen: Ob die Dateien
 * aus `betrifft` sich bewegt haben, sagt nichts über das Vorhaben —
 * `src/ui.ts` und `src/studio/editor.ts` werden von allem angefasst. Die
 * Prüfung schlug bei 7 bis 8 von 17 Konzepten an, fast immer falsch, und eine
 * Warnung, die meistens falsch ist, erzieht zum Wegsehen.
 *
 * Was BLEIBT, ist die Frage ohne Korrelation: Ein Vorhaben, das laut Roadmap
 * LÄUFT und dessen Kopf seit Wochen unangetastet ist, ist entweder nicht mehr
 * in Arbeit oder sein Stand ist alt. Beides will man wissen, und beides steht
 * ohne Umweg in den Daten.
 */
const STAND_FRIST_TAGE = 21

export function standVeraltet(dok, heute = Date.now()) {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dok.kopf?.stand || '').trim())
  // Ohne Tagesdatum stellt sich die Frage nicht: „August 2026" nennt
  // absichtlich keinen Tag, und einen zu erfinden wäre eine Genauigkeit, die
  // das Dokument nie zugesagt hat.
  if (!treffer) return null
  const tage = Math.floor((heute - Date.UTC(+treffer[1], +treffer[2] - 1, +treffer[3])) / 86400000)
  return tage >= STAND_FRIST_TAGE ? { stand: treffer[0], tage } : null
}

/** Bilder aus `docs/mockups/**` — die Galerie am Ende der Mockup-Seite. */
export function sammleBilder() {
  const raus = []
  for (const endung of ['.jpg', '.jpeg', '.png', '.webp'])
    for (const p of dateienUnter(join(DOCS, 'mockups'), endung))
      raus.push({ quelle: relative(DOCS, p), name: basename(p) })
  return raus.sort((a, b) => a.quelle.localeCompare(b.quelle))
}

export { BEREICH_NACH_ID }

/* ── Systemteile ──────────────────────────────────────────────────────────
 * Neben dem Bereich („wie verbindlich ist das?") die zweite Achse: WELCHEN
 * TEIL DES PRODUKTS betrifft es? Ein Dokument hat meist mehrere — ein Konzept
 * zum Video-Export betrifft Player und Studio, eines zu Tracker-Anbindungen
 * Backend und App.
 *
 * Abgeleitet, nicht gepflegt: Die Dokumente nennen ihre Dateien ohnehin
 * (`src/studio/editor.ts`, `server/src/pipeline/…`), und eine Liste, die
 * jemand von Hand nachziehen müsste, ist beim nächsten Dokument vergessen —
 * dieselbe Erfahrung wie bei den Bereichen. Wo die Ableitung danebenliegt,
 * übersteuert eine Kopfzeile `Systemteile: Studio, Android-App`.
 */
export const SYSTEMTEILE = [
  { id: 'android', name: 'Android-App', regeln: ['android/'] },
  { id: 'backend', name: 'Backend', regeln: ['server/'] },
  { id: 'studio', name: 'Studio', regeln: ['src/studio/', 'studio.html'] },
  { id: 'verwaltung', name: 'Verwaltung', regeln: ['src/admin/', 'admin.html'] },
  {
    id: 'oeffentlich',
    name: 'Öffentliche Seiten',
    regeln: ['src/galerie/', 'src/profil/', 'src/konto/', 'galerie.html', 'profil.html', 'konto.html'],
  },
  { id: 'landing', name: 'Landing', regeln: ['index.html'] },
  { id: 'player', name: 'Player', regeln: ['src/', 'erlebnis.html'] },
  { id: 'betrieb', name: 'Betrieb', regeln: ['deploy/', '.github/', 'docker', 'scripts/', 'Caddyfile'] },
]

const TEIL_NACH_NAME = new Map(
  SYSTEMTEILE.flatMap((t) => [
    [t.name.toLowerCase(), t.id],
    [t.id, t.id],
  ]),
)

/** Welcher Systemteil gehört zu diesem Pfad? Die REIHENFOLGE ist die Regel:
 *  `src/studio/…` ist Studio und nicht Player, obwohl beides auf `src/` passt. */
function teilFuerPfad(pfad) {
  for (const teil of SYSTEMTEILE) if (teil.regeln.some((r) => pfad.includes(r))) return teil.id
  return null
}

/** Pfade, die ein Dokument nennt — als Link ODER als Code-Schnipsel im Text. */
const PFAD_MUSTER =
  /(?:\(|`|\s)((?:\.\.\/)*(?:src|server|android|deploy|scripts|test|public|\.github)\/[A-Za-z0-9_./-]+|(?:index|studio|erlebnis|galerie|profil|konto|admin)\.html)/g

export function systemteileVon(text, { name = '', quelle = '', genannt = [] } = {}) {
  // 1. Ausdrücklich genannt schlägt alles — aus dem Kopf der Datei (Front
  //    Matter, `<meta>`) oder aus der alten Zeile `Systemteile: …` im Text.
  const ausZeile = text.slice(0, 1600).match(/^\s*Systemteile:\s*(.+)$/m)
  const worte = genannt.length ? genannt : ausZeile ? ausZeile[1].split(/[,;·]/) : []
  if (worte.length) {
    const ids = worte.map((s) => TEIL_NACH_NAME.get(saeubere(s).toLowerCase())).filter(Boolean)
    if (ids.length) return [...new Set(ids)]
  }

  // 2. Sonst zählen, was das Dokument nennt.
  const zaehler = new Map()
  for (const treffer of text.matchAll(PFAD_MUSTER)) {
    const teil = teilFuerPfad(treffer[1].replace(/^(\.\.\/)+/, ''))
    if (teil) zaehler.set(teil, (zaehler.get(teil) ?? 0) + 1)
  }
  // 3. Der EIGENE ORT wiegt schwer: Das Handbuch des Studios verweist mehr auf
  //    den Server als auf sich selbst — nach reiner Zählung wäre es ein
  //    Backend-Dokument. Wo eine Datei liegt, ist die verlässlichere Auskunft
  //    darüber, worum es geht.
  const eigener = quelle ? teilFuerPfad(quelle) : null
  if (eigener) zaehler.set(eigener, (zaehler.get(eigener) ?? 0) + 6)

  // 4. Der Dateiname eines Mockups sagt es oft direkter als sein Inhalt.
  const ausName = {
    app: 'android',
    player: 'player',
    studio: 'studio',
    live: 'oeffentlich',
    landing: 'landing',
  }[name.split('-')[0]]
  if (ausName) zaehler.set(ausName, (zaehler.get(ausName) ?? 0) + 3)

  if (!zaehler.size) return []
  // Ein beiläufiger Verweis macht ein Backend-Dokument nicht zum Player-Text:
  // Es zählt, was mehrfach ODER mit spürbarem Anteil vorkommt — und in jedem
  // Fall der Spitzenreiter, sonst stünde ein Dokument ganz ohne Zuordnung da.
  const summe = [...zaehler.values()].reduce((s, n) => s + n, 0)
  const spitze = Math.max(...zaehler.values())
  return SYSTEMTEILE.filter((t) => {
    const n = zaehler.get(t.id) ?? 0
    return n === spitze || n >= 2 || n >= summe * 0.25
  }).map((t) => t.id)
}
