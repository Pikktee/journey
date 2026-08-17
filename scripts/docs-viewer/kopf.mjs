/*
 * Der Kopf eines Dokuments: strukturierte Metadaten lesen und schreiben.
 *
 * Bis hierher stand der Stand eines Dokuments als PROSA unter der Überschrift
 * („Stand: 2026-08-17 · Status: **Entwurf, nichts gebaut** · Betrifft: …") und
 * vier Regexe zerlegten sie. Das trug, solange niemand die Reihenfolge tauschte,
 * ein `·` in einen Statussatz schrieb oder die Zeile über zwei Zeilen umbrach —
 * alles drei kam vor. Front Matter ist dieselbe Angabe an einer Stelle, an der
 * sie eindeutig ist, und sie kostet nichts beim Lesen: Der Viewer zeigt sie als
 * Leiste über dem Text, GitHub als Tabelle.
 *
 * DREI REGELN, damit daraus kein Pflegeschema wird:
 *
 * 1. **Der Kopf trägt nur, was NICHT ableitbar ist.** Bereich, Lesezeit,
 *    Änderungsdatum, Verweise und Rückverweise stehen NICHT darin — der
 *    Generator kennt sie besser als jede gepflegte Angabe. Systemteile stehen
 *    nur darin, wo die Ableitung danebenliegt.
 * 2. **`status` bleibt FREITEXT, kein Enum.** „Etappen 0–6 gebaut, Polar live"
 *    ist die wertvollste Angabe der Roadmap-Karte; ein `status: unterwegs`
 *    wäre die Ampel ohne ihren Grund. Die Ampel wird aus dem Satz abgeleitet.
 * 3. **Die Prosa-Zeile bleibt lesbar.** Wo kein Front Matter steht, gilt
 *    weiter der alte Kopf — ein Dokument von 2026-07 muss nicht angefasst
 *    werden, um im Viewer zu erscheinen.
 *
 * Für Mockups gibt es kein Front Matter: HTML hat keins. Ihr Gegenstück sind
 * `<meta name="maptale:status" …>`-Angaben im Kopf der Datei, mit denselben
 * Namen — damit trägt ein Prototyp endlich Stand und Systemteile, die er
 * vorher gar nicht ausdrücken konnte.
 */

/** Die erlaubten Felder, in der Reihenfolge, in der sie geschrieben werden. */
export const FELDER = ['stand', 'status', 'betrifft', 'systemteile', 'archiviert_aus']

const LISTENFELDER = new Set(['betrifft', 'systemteile'])

/* ── Lesen ────────────────────────────────────────────────────────────── */

/**
 * Trennt Front Matter vom Text. Anerkannt wird nur ein Block, der in der
 * ERSTEN Zeile beginnt: `---` mitten im Dokument ist eine waagerechte Linie,
 * und die kommt in unseren Konzepten vor.
 */
export function teileKopf(text) {
  const treffer = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!treffer) return { roh: null, daten: {}, koerper: text }
  return {
    roh: treffer[1],
    daten: leseYaml(treffer[1]),
    koerper: text.slice(treffer[0].length).replace(/^\r?\n/, ''),
  }
}

/**
 * Ein sehr kleiner YAML-Teilbereich: Skalare, Klammerlisten (`[a, b]`) und
 * Strichlisten. Bewusst kein `yaml`-Paket — der Viewer soll ohne Abhängigkeit
 * bauen, und was hier nicht gelesen wird, soll auch niemand schreiben.
 */
export function leseYaml(roh) {
  const daten = {}
  const zeilen = String(roh).split(/\r?\n/)
  let offen = null
  for (const zeile of zeilen) {
    if (!zeile.trim() || /^\s*#/.test(zeile)) continue
    const punkt = /^\s+-\s*(.*)$/.exec(zeile)
    if (punkt && offen) {
      const wert = schaeleWert(punkt[1])
      if (wert) daten[offen].push(wert)
      continue
    }
    const paar = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(zeile)
    if (!paar) continue
    const [, name, rest] = paar
    offen = null
    if (!rest.trim()) {
      // Ein Name ohne Wert kündigt eine Strichliste an. Bleibt sie leer, ist
      // das Feld leer und nicht „vorhanden mit Wert null".
      daten[name] = []
      offen = name
      continue
    }
    const klammer = /^\[(.*)\]$/.exec(rest.trim())
    daten[name] = klammer
      ? klammer[1]
          .split(',')
          .map((s) => schaeleWert(s))
          .filter(Boolean)
      : schaeleWert(rest)
  }
  return daten
}

/** Anführungszeichen und Kommentare abziehen. */
function schaeleWert(roh) {
  let wert = String(roh).trim()
  const zitat = /^(['"])([\s\S]*)\1$/.exec(wert)
  if (zitat) return zitat[2].trim()
  wert = wert.replace(/\s+#\s.*$/, '')
  return wert.trim()
}

/* ── Schreiben ────────────────────────────────────────────────────────── */

/**
 * Serialisiert die Felder. Listen mit mehr als einem Eintrag werden zu
 * Strichlisten: `betrifft: [src/ui.ts, src/style.css, erlebnis.html]` wird in
 * einer Zeile schnell länger als der Bildschirm, und der Kopf ist auch etwas
 * zum Lesen.
 */
export function schreibeYaml(daten) {
  const zeilen = []
  const namen = [...FELDER, ...Object.keys(daten).filter((n) => !FELDER.includes(n))]
  for (const name of namen) {
    const wert = daten[name]
    if (wert == null || wert === '' || (Array.isArray(wert) && !wert.length)) continue
    if (Array.isArray(wert)) {
      if (wert.length === 1) zeilen.push(`${name}: [${zitiere(wert[0], true)}]`)
      else {
        zeilen.push(`${name}:`)
        for (const eintrag of wert) zeilen.push(`  - ${zitiere(eintrag)}`)
      }
    } else zeilen.push(`${name}: ${zitiere(wert)}`)
  }
  return zeilen.join('\n')
}

/**
 * Zitiert nur, wo es sein muss. Ein Statussatz mit Doppelpunkt („Etappe 1:
 * gebaut") bräche die Zeile sonst in zwei Felder — und Anführungszeichen um
 * jeden Wert machten den Kopf zu Maschinentext.
 */
function zitiere(wert, inKlammer = false) {
  const s = String(wert)
  const heikel =
    /:\s/.test(s) ||
    /^[[\]{}>|*&!%@`'"#-]/.test(s) ||
    /\s$|^\s/.test(s) ||
    (inKlammer && /[,[\]]/.test(s))
  return heikel ? `'${s.replace(/'/g, "''")}'` : s
}

/**
 * Setzt Felder im Kopf einer Datei. `null` als Wert entfernt ein Feld; fehlt
 * der Block, entsteht er vor der Überschrift. Der Körper bleibt Zeichen für
 * Zeichen, wie er war — diese Funktion schreibt auch in Dateien, die jemand
 * gerade offen hat.
 */
export function setzeKopf(text, aenderungen) {
  const { roh, daten, koerper } = teileKopf(text)
  const neu = { ...daten }
  for (const [name, wert] of Object.entries(aenderungen)) {
    if (wert == null || wert === '' || (Array.isArray(wert) && !wert.length)) delete neu[name]
    else neu[name] = wert
  }
  const block = schreibeYaml(neu)
  if (!block) return roh == null ? text : koerper
  return `---\n${block}\n---\n\n${roh == null ? text.replace(/^\n+/, '') : koerper}`
}

/* ── Die alte Prosa-Zeile ─────────────────────────────────────────────── */

/** Markdown-Auszeichnung aus einer Zeile lösen — sie soll als Text stehen. */
export function saeubere(zeile) {
  return String(zeile)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Der Kopf als Prosa, wie ihn die Dokumente vor der Umstellung trugen:
 * „Stand: … · Status: **…** · Betrifft: …". Bleibt als Rückfall, damit ein
 * Dokument nicht angefasst werden muss, um im Viewer vollständig zu erscheinen.
 */
export function kopfAusProsa(text) {
  const kopf = {}
  const anfang = text.slice(0, 1400)
  const stand = anfang.match(/Stand:\s*\*{0,2}([^·\n*]+)\*{0,2}/)
  if (stand) kopf.stand = saeubere(stand[1]).replace(/\.$/, '')
  const status = anfang.match(/Status:\s*\*{0,2}([^·\n]+?)\*{0,2}\s*(?:·|$)/m)
  if (status) kopf.status = saeubere(status[1])
  const betrifft = anfang.match(/Betrifft:\s*([^\n]+(?:\n[^\n#][^\n]*)?)/)
  if (betrifft) kopf.betrifft = saeubere(betrifft[1]).replace(/[.,]$/, '')
  const her = anfang.match(/^Archiviert aus:\s*(\S+)/m)
  if (her) kopf.archiviert_aus = saeubere(her[1])
  const teile = anfang.match(/^\s*Systemteile:\s*(.+)$/m)
  if (teile) kopf.systemteile = teile[1].split(/[,;·]/).map(saeubere).filter(Boolean)
  return kopf
}

/* ── Das eine Ergebnis ────────────────────────────────────────────────── */

/**
 * Was der Viewer über ein Dokument weiß, aus beiden Quellen: Front Matter
 * schlägt Prosa, Feld für Feld. Nicht Block gegen Block — ein Dokument, dessen
 * Kopf nur `stand:` trägt, soll seine übrigen Angaben nicht verlieren.
 *
 * `betrifft` kommt immer als Liste zurück, egal wie es dastand. Als Zeichenkette
 * hätte jede Anzeige sie selbst wieder zerlegen müssen.
 */
export function kopfVon(text) {
  const { roh, daten, koerper } = teileKopf(text)
  const prosa = kopfAusProsa(koerper)
  const zusammen = { ...prosa }
  for (const [name, wert] of Object.entries(daten))
    if (wert != null && wert !== '' && !(Array.isArray(wert) && !wert.length)) zusammen[name] = wert

  return {
    stand: alsText(zusammen.stand),
    status: alsText(zusammen.status),
    betrifft: alsListe(zusammen.betrifft),
    systemteile: alsListe(zusammen.systemteile),
    archiviertAus: alsText(zusammen.archiviert_aus) || null,
    strukturiert: roh != null,
    koerper,
  }
}

/** Kopfangaben eines Prototyps: `<meta name="maptale:stand" content="…">`. */
export function kopfAusHtml(text) {
  const daten = {}
  const kopfEnde = text.search(/<\/head>/i)
  const bereich = kopfEnde > 0 ? text.slice(0, kopfEnde) : text.slice(0, 4000)
  for (const t of bereich.matchAll(
    /<meta\s+[^>]*name=["']maptale:([a-z_]+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi,
  ))
    daten[t[1]] = t[2].trim()
  return {
    stand: alsText(daten.stand),
    status: alsText(daten.status),
    betrifft: alsListe(daten.betrifft),
    systemteile: alsListe(daten.systemteile),
    archiviertAus: alsText(daten.archiviert_aus) || null,
    strukturiert: Object.keys(daten).length > 0,
  }
}

function alsText(wert) {
  if (wert == null) return ''
  return Array.isArray(wert) ? wert.join(', ') : String(wert).trim()
}

function alsListe(wert) {
  if (wert == null || wert === '') return []
  if (Array.isArray(wert)) return wert.map((s) => String(s).trim()).filter(Boolean)
  return String(wert)
    .split(/[,;·]|\s+und\s+/)
    .map((s) => saeubere(s))
    .filter(Boolean)
}
