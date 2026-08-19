/*
 * Die HTML-Seiten des Viewers: Übersicht, Bereich, Dokument, Mockups, Karte.
 *
 * DREI EBENEN, und das ist die eigentliche Gestaltung:
 *
 *   1. Übersicht  — wo anfangen, die Bereiche, was zuletzt passiert ist
 *   2. Bereich    — die Dokumente EINES Bereichs, nach Status filterbar
 *   3. Dokument   — der Text selbst
 *
 * Die erste Fassung zeigte JEDES Dokument als Karte untereinander auf der
 * Übersicht. Das war vollständig und unbrauchbar: Wer nicht schon wusste, was
 * er sucht, hat auf der Startseite gescrollt statt gelesen. Jede Ebene
 * beantwortet jetzt genau eine Frage und verweist für die nächste weiter.
 *
 * Der Viewer läuft unter `/doku` im Dev-Server UND als Datei per Doppelklick.
 * Der zweite Fall ist der strengere und bestimmt die Technik: KEIN `fetch`,
 * KEINE ES-Module. Der Suchindex kommt als klassisches Skript, das eine
 * globale Variable setzt; die Blätter hängen als gewöhnliche `<link>`.
 */

import { escape } from './markdown.mjs'
import { motiv, titelgrafik, verweiskarte } from './grafiken.mjs'
import { icon } from './icons.mjs'
import { ZIELBEREICHE } from './dienst.mjs'
import { SYSTEMTEILE } from './sammeln.mjs'

const TEIL_NAME = new Map(SYSTEMTEILE.map((t) => [t.id, t.name]))

/** Anzeigenamen der Orte, an die man zurückholen kann. */
const BEREICHSNAME = {
  concepts: 'Konzepte',
  architecture: 'Architektur',
  specs: 'Spezifikationen',
  ops: 'Betrieb',
  // Ein Mockup hat mit den Bereichen nichts zu tun — es kommt aus
  // `docs/mockups/` und kehrt genau dorthin zurück.
  mockups: 'Mockups',
}

const AMPEL_WORT = {
  verbindlich: 'Verbindlich',
  fertig: 'Gebaut',
  unterwegs: 'Unterwegs',
  offen: 'Entwurf',
  ruht: 'Historie',
  ohne: 'Ohne Angabe',
}

/** `../` so oft, wie die Zielseite tief liegt. */
function hoch(ziel) {
  const tiefe = ziel.split('/').length - 1
  return tiefe ? '../'.repeat(tiefe) : ''
}

/**
 * Wie lange ist das her?
 *
 * Relativ, weil das die Frage ist, die man an eine Doku stellt („ist das noch
 * aktuell?") — ein Datum muss man dafür erst im Kopf ausrechnen. Ab etwa einem
 * Monat kippt es ins Absolute: „vor 7 Wochen" sagt weniger als „Juni 2026",
 * weil man ab dort ohnehin in Monaten denkt.
 */
function zeitRelativ(iso) {
  if (!iso) return { text: '', titel: '' }
  const tage = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  const genau = new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  if (tage <= 0) return { text: 'heute', titel: genau, frisch: true }
  if (tage === 1) return { text: 'gestern', titel: genau, frisch: true }
  if (tage < 7) return { text: `vor ${tage} Tagen`, titel: genau, frisch: true }
  if (tage < 14) return { text: 'letzte Woche', titel: genau }
  if (tage < 35) return { text: `vor ${Math.round(tage / 7)} Wochen`, titel: genau }
  return {
    text: new Date(iso).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }),
    titel: genau,
  }
}

function datum(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Der Stand, wie ein Mensch ihn schreibt: „17. August 2026".
 *
 * Im Dokument steht ISO, weil sich das sortieren lässt — gelesen wird es aber
 * von Menschen, und `2026-08-17` ist eine Sortierschlüssel-Schreibweise. Was
 * KEIN vollständiges Datum ist, bleibt unangetastet: „August 2026" behauptet
 * absichtlich keinen Tag, und einen zu erfinden wäre eine Genauigkeit, die das
 * Dokument nie zugesagt hat.
 */
function standLang(roh) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(roh || '').trim())
  if (!iso) return String(roh || '')
  return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function ampelChip(ampel) {
  if (!ampel) return ''
  return `<span class="ampel ampel-${ampel.art}">${escape(AMPEL_WORT[ampel.art] || ampel.wort)}</span>`
}

/* ── Gerüst ───────────────────────────────────────────────────────────── */

function huelle({ titel, ziel, klasse = '', inhalt, mermaid = false, schriftLokal = false }) {
  const auf = hoch(ziel)
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(titel)} · Maptale-Doku</title>
<link rel="icon" href="${auf}assets/marke.svg" />
${
  schriftLokal
    ? // Vorgeladen und lokal: Ohne das Preload beginnt der Browser erst nach
      // dem Blatt zu laden, und genau dazwischen liegt der sichtbare Wechsel.
      `<link rel="preload" href="${auf}assets/outfit.woff2" as="font" type="font/woff2" crossorigin />`
    : `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" />`
}
<!-- Die Tokens der Marke, beim Bauen aus src/basis.css kopiert. Sie stehen VOR
     dem Blatt des Viewers, damit dessen Regeln bei gleicher Spezifität gewinnen. -->
<link rel="stylesheet" href="${auf}assets/basis.css" />
<link rel="stylesheet" href="${auf}assets/stil.css" />
</head>
<body class="${klasse}" data-auf="${auf}">
<script>
  /* Läuft die Seite über einen Dienst, der schreiben kann? Das entscheidet
     die Klasse "mit-dienst" am body, und sie entscheidet über LAYOUT: mit den Aktionsknöpfen
     ist eine Mockup-Kachel 191 statt 185 Pixel hoch. Bis hierher setzte
     viewer.js die Klasse — das Blatt liegt aber am Ende der Seite, also malte
     der Browser einmal ohne und gleich darauf mit, und das ganze Gitter
     sprang um sechs Pixel je Zeile. Hier steht es VOR dem Inhalt, damit es
     schon im ersten Bild gilt. */
  if (/^https?:$/.test(location.protocol)) document.body.classList.add('mit-dienst')
</script>
${inhalt}
${umbenennenSchicht()}
<script src="${auf}assets/index.js"></script>
<script src="${auf}assets/viewer.js"></script>
${
  mermaid
    ? `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>window.mermaid&&mermaid.initialize({startOnLoad:true,theme:'dark',themeVariables:{fontFamily:'Outfit, sans-serif',primaryColor:'#161e2c',primaryTextColor:'#f2ede3',primaryBorderColor:'#f59e0b',lineColor:'#7e8a99',secondaryColor:'#111722',tertiaryColor:'#1e283a'}})</script>`
    : ''
}
</body>
</html>`
}

/**
 * Umbenennen: Überschrift und Dateiname in einem Zug.
 *
 * ZWEI Felder und nicht eins, weil es zwei verschiedene Dinge sind — was
 * jemand liest und worauf alles zeigt. Sie hängen aber zusammen: Ändert man nur
 * die Überschrift, heißt die Datei danach noch wie die alte Idee, und der
 * nächste sucht sie unter ihrem neuen Namen. Deshalb schlägt die Maske aus dem
 * Titel einen Dateinamen VOR und lässt ihn stehen, sobald jemand ihn anfasst.
 *
 * Die Schicht liegt in jeder Seite, weil in jeder Seite Objekte stehen. Sie ist
 * leer, bis ein Menü sie füllt — ein Dialog je Kachel wären auf der Übersicht
 * vierzig.
 */
function umbenennenSchicht() {
  return `<div class="schicht umbenennen-schicht" data-umbenennen-schicht hidden>
  <div class="schicht-tafel" role="dialog" aria-modal="true" aria-labelledby="umbenennen-titel">
    <h2 id="umbenennen-titel">Umbenennen</h2>
    <label class="feld">
      <span>Titel</span>
      <input type="text" data-umbenennen-titel autocomplete="off" spellcheck="false" />
    </label>
    <label class="feld">
      <span>Dateiname</span>
      <input type="text" data-umbenennen-name autocomplete="off" spellcheck="false" />
      <small data-umbenennen-pfad></small>
    </label>
    <p class="schicht-hinweis">Verweise in <code>docs/</code> und im Handbuch werden nachgezogen.</p>
    <div class="schicht-fuss">
      <button type="button" class="knopf knopf-haupt" data-umbenennen-los>Umbenennen</button>
      <button type="button" class="knopf" data-umbenennen-ab>Abbrechen</button>
    </div>
  </div>
</div>`
}

function kopfleiste(ziel, bereiche) {
  const auf = hoch(ziel)
  return `<header class="kopf">
  <a class="marke" href="${auf}index.html">
    <img src="${auf}assets/marke.svg" alt="" width="26" height="26" />
    <span>Maptale<b>Doku</b></span>
  </a>
  <nav class="kopf-nav">
    <div class="kopf-menue">
      <button type="button" data-menue-knopf aria-expanded="false">Bereiche <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 L6 6.5 L11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
      <div class="kopf-klappe" data-menue hidden>
        ${bereiche
          .map(
            (b) =>
              `<a href="${auf}${b.id}/index.html" style="--ton:${b.ton}"><i></i>${escape(b.name)}</a>`,
          )
          .join('')}
      </div>
    </div>
    <a href="${auf}mockups.html">Mockups</a>
    <a href="${auf}karte.html">Netz</a>
  </nav>
  <button class="suchknopf" data-suche-oeffnen type="button"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="13.5" y1="13.5" x2="18" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Suchen</span><kbd>⌘K</kbd></button>
</header>`
}

function suchschicht() {
  return `<div class="such-schicht" data-such-schicht hidden>
  <div class="such-tafel" role="dialog" aria-label="Dokumente durchsuchen">
    <input type="search" placeholder="Titel, Abschnitt oder Text …" data-such-feld autocomplete="off" spellcheck="false" />
    <ul class="such-treffer" data-such-treffer></ul>
    <div class="such-fuss"><kbd>↑</kbd><kbd>↓</kbd> wählen · <kbd>⏎</kbd> öffnen · <kbd>esc</kbd> schließen</div>
  </div>
</div>`
}

/**
 * Ein Tupfer mit Erklärung. Für Vermerke, die den GENERATOR erklären (woher
 * etwas kommt, wie es gepflegt wird) — nicht für Lesehilfen zum Inhalt: Unter
 * jeder Überschrift ein Satz Kleingedrucktes macht die Seite voll, und gelesen
 * wird er genau einmal.
 */
function hinweis(text) {
  return `<span class="hinweis"><button type="button" aria-label="${escape(text.replace(/<[^>]+>/g, ''))}">i</button><span class="hinweis-blase" role="tooltip" hidden>${text}</span></span>`
}

/**
 * Ein aufklappbarer ABSCHNITT.
 *
 * Vorher war das eine Pille unter dem Inhalt — und die stand da wie ein
 * vergessener Knopf: Man sah nicht, wozu sie gehört, und „Bildmaterial (19)"
 * neben dem Nichts sagt nicht, dass darunter ein ganzer Bereich liegt. Ein
 * Abschnitt trägt eine Kopfzeile über die volle Breite, mit Titel, Zahl und
 * einem Winkel, der sich beim Öffnen dreht — dieselbe Form wie jede andere
 * Überschrift der Seite, nur eben klappbar.
 *
 * @param titel   die Überschrift
 * @param zahl    was drinsteckt (als Zahl neben dem Titel)
 * @param inhalt  das HTML darunter
 * @param opt     { satz: erklärender Halbsatz, offen: von Anfang an offen }
 */
function falte(titel, zahl, inhalt, opt = {}) {
  return `<details class="falte"${opt.offen ? ' open' : ''}>
    <summary>
      <span class="falte-kopf">
        <span class="falte-titel">${escape(titel)}</span>
        ${zahl != null ? `<span class="falte-zahl">${escape(String(zahl))}</span>` : ''}
      </span>
      ${opt.satz ? `<span class="falte-satz">${escape(opt.satz)}</span>` : ''}
      <svg class="falte-winkel" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 2.5 L6 6.5 L11 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </summary>
    <div class="falte-inhalt">${inhalt}</div>
  </details>`
}

/**
 * Der Fuß trägt dieselben drei Links wie Impressum und Datenschutz:
 * Startseite · Impressum · Datenschutz.
 *
 * Sie zeigen auf die ECHTEN Seiten und nicht auf Dateien im Viewer — beide
 * bestehen nur gebaut, und die Doku liegt daneben. Deshalb absolute Pfade, die
 * am selben Host aufgehen: Der Viewer läuft unter `/doku/` desselben
 * Dev-Servers, unter dem auch `/impressum` liegt. Als Datei geöffnet (`file://`)
 * gibt es keinen Host — dort führen sie ins Leere, und das ist der Preis dafür,
 * dass die Doku überhaupt ohne Server lesbar ist.
 */
function fussleiste() {
  const links = [
    ['/', 'Startseite'],
    ['/impressum', 'Impressum'],
    ['/datenschutz', 'Datenschutz'],
  ]
  return `<footer class="fuss">
    <p>Maptale-Doku${hinweis(
      'Erzeugt aus <code>docs/</code> mit <code>npm run docs</code>. Die Seiten liegen unter <code>docs/_site/</code>, stehen in <code>.gitignore</code> und gehen nie mit dem Deploy raus.',
    )}</p>
    <nav class="fuss-links" aria-label="Rechtliches">${links
      .map(([ziel, wort]) => `<a href="${ziel}">${escape(wort)}</a>`)
      .join('<span class="fuss-sep" aria-hidden="true">·</span>')}</nav>
  </footer>`
}

/** Bilder nach ihrem Ordner, mit einem Namen, den man lesen kann. */
const BILDGRUPPEN = {
  'mockups/landing': 'Landing-Aufnahmen',
  'mockups/titelbilder': 'Mitgelieferte Titelbilder',
  'mockups/tourbilder': 'Bilder der Demo-Touren',
}

function bilderNachOrdner(bilder) {
  const gruppen = new Map()
  for (const b of bilder) {
    const ordner = b.quelle.split('/').slice(0, -1).join('/')
    if (!gruppen.has(ordner)) gruppen.set(ordner, [])
    gruppen.get(ordner).push(b)
  }
  return [...gruppen].map(([ordner, eigene]) => ({
    ordner,
    name: BILDGRUPPEN[ordner] ?? ordner.split('/').pop(),
    bilder: eigene,
  }))
}

/* ── Bausteine ────────────────────────────────────────────────────────── */

/* ── Aktionen ─────────────────────────────────────────────────────────────
 * EIN Menü für alle Objekte: Dokument, Mockup, Karte, Einzelseite. Vorher
 * standen Auswahlfeld und zwei Knöpfe offen in der Kachel — drei Bedienelemente
 * neben zwei Zeilen Text, und die Kachel las sich wie ein Steuerpult statt wie
 * ein Dokument. Die Aktionen sind selten, der Inhalt ist immer da: Also gehört
 * der Inhalt nach vorn und die Aktion unter einen Griff.
 *
 * Das Menü steht im Markup jeder Kachel, wird aber nur mit laufendem Dienst
 * eingeblendet (`body.mit-dienst`).
 */
function aktionsmenue({
  datei,
  titel,
  imArchiv,
  zurueck = '',
  phasen = [],
  phase = '',
  oeffnen = '',
}) {
  const roadmap = phasen.length
    ? `<div class="menue-titel">Roadmap</div>
       ${phasen
         .map(
           (name) =>
             `<button type="button" class="menue-eintrag${name === phase ? ' gewaehlt' : ''}" data-roadmap-phase="${escape(name)}">${escape(name)}</button>`,
         )
         .join('')}
       <button type="button" class="menue-eintrag${phase ? '' : ' gewaehlt'}" data-roadmap-phase="">Nicht eingeplant</button>
       <hr />`
    : ''

  /*
   * Zurückgeholt wird an den Ort, aus dem die Datei KAM — die Auswahl war eine
   * Frage, deren Antwort danebensteht. Ein Mockup kommt immer aus
   * `docs/mockups/` und hat mit den Bereichen nichts zu tun; bei einem
   * Dokument nennt `archiviert_aus` im Kopf die Herkunft, und die steht dort,
   * seit das Archivieren sie hineinschreibt.
   *
   * Gefragt wird nur noch im einen Fall, in dem die Frage echt ist: ein altes
   * archiviertes Dokument ohne Herkunftszeile. Der Viewer zeigt es unter
   * „Konzepte", aber das ist geraten — und ein geratener Ort, der sich beim
   * Zurückholen als endgültig herausstellt, ist schlechter als eine Frage.
   */
  const ablage = imArchiv
    ? zurueck
      ? `<button type="button" class="menue-eintrag" data-zurueckholen data-bereich="${zurueck}">Zurück nach ${escape(BEREICHSNAME[zurueck] ?? zurueck)}</button>`
      : `<div class="menue-titel">Zurückholen nach</div>
       ${ZIELBEREICHE.map(
         (b) =>
           `<button type="button" class="menue-eintrag" data-zurueckholen data-bereich="${b}">${escape(BEREICHSNAME[b] ?? b)}</button>`,
       ).join('')}`
    : `<button type="button" class="menue-eintrag gefahr" data-archivieren>Archivieren</button>`

  // Umbenennen, Editor und Pfad stehen an JEDEM Objekt: Man sucht sie dort, wo
  // man das Objekt gerade vor sich hat, und nicht auf einer eigenen Seite.
  const werkzeug = `<button type="button" class="menue-eintrag" data-umbenennen>Umbenennen …</button>
     <button type="button" class="menue-eintrag" data-editor-oeffnen>Im Editor öffnen</button>
     <button type="button" class="menue-eintrag" data-pfad-kopieren>Pfad kopieren</button>
     <hr />`

  return `<div class="aktionen" data-aktionen data-datei="${escape(datei)}" data-titel="${escape(titel)}">
    <button type="button" class="aktionen-knopf" data-aktionen-knopf aria-haspopup="menu" aria-expanded="false" aria-label="Weitere Aktionen">
      <svg viewBox="0 0 16 4" aria-hidden="true"><circle cx="2" cy="2" r="1.6"/><circle cx="8" cy="2" r="1.6"/><circle cx="14" cy="2" r="1.6"/></svg>
    </button>
    <div class="aktionen-klappe" data-aktionen-klappe role="menu" hidden>
      ${oeffnen}
      ${werkzeug}
      ${roadmap}
      ${ablage}
    </div>
  </div>`
}

/**
 * Die Systemteile eines Dokuments als Chips.
 *
 * Ab fünf Teilen steht dort EIN Wort statt einer Reihe: Ein Text, der fast
 * alles betrifft (die Wurzel-CLAUDE.md), sagt mit sieben Chips nichts mehr —
 * er sagt „überall", und genau das schreibt der Chip dann hin.
 */
function teilChips(teile, max = 3) {
  if (!teile || !teile.length) return ''
  if (teile.length >= 5) return '<span class="teil-chip weit">Produktweit</span>'
  const sichtbar = teile.slice(0, max)
  const rest = teile.length - sichtbar.length
  return (
    sichtbar
      .map((id) => `<span class="teil-chip">${escape(TEIL_NAME.get(id) ?? id)}</span>`)
      .join('') + (rest > 0 ? `<span class="teil-chip mehr">+${rest}</span>` : '')
  )
}

/** Der Phasen-Chip einer Karte — sichtbar, ohne dass man das Menü öffnet. */
function phasenChip(phase) {
  return phase ? `<span class="phasen-chip">${escape(phase)}</span>` : ''
}

/** In welcher Phase steht diese Datei? */
function phaseVon(roadmap, quelle) {
  return roadmap?.phasen.find((ph) => ph.eintraege.some((e) => e.quelle === quelle))?.name ?? ''
}

/**
 * Die Reihenfolge, in der die Kacheln STEHEN — dieselbe, die viewer.js unter
 * „zuletzt geändert" herstellt.
 *
 * Vorher kamen sie in Dateinamen-Reihenfolge aus dem Verzeichnis, und das
 * Blatt sortierte sie beim Laden um: Die Seite stand einen Moment falsch da
 * und sprang dann. Sortiert wird weiterhin im Browser (die Auswahl kann ja
 * wechseln), er findet die Liste jetzt nur schon in seiner Voreinstellung vor.
 * Wer den Vergleich hier ändert, ändert ihn dort mit — sonst springt es wieder.
 */
function nachDatum(liste) {
  return liste.slice().sort((a, b) => {
    const da = a.geaendert || ''
    const db = b.geaendert || ''
    if (!da && !db) return 0
    // Ohne Datum (ungetrackt) ans Ende: Eine fehlende Angabe führt keine Liste an.
    if (!da) return 1
    if (!db) return -1
    return db.localeCompare(da)
  })
}

/* ── Karten ───────────────────────────────────────────────────────────────
 * Die Kachel ist EIN Ziel: Die ganze Fläche ist der Link (`.karte-flaeche`
 * liegt als Overlay darüber), das Menü liegt darüber und fängt seine Klicks
 * selbst ab. Verschachtelte `<a>`- und `<button>`-Elemente wären ungültiges
 * Markup und mit der Tastatur eine Falle.
 */
function dokumentKarte(d, auf, ton, roadmap) {
  const phase = phaseVon(roadmap, d.quelle)
  const zeit = zeitRelativ(d.geaendert)
  const verweise = d.verweise.length + d.rueckverweise.length
  return `<article class="dok-karte" style="--ton:${ton}"
     data-ampel="${d.ampel?.art ?? 'ohne'}" data-teile="${(d.teile ?? []).join(' ')}"
     data-datum="${escape(d.geaendert || '')}" data-titel="${escape(d.titel.toLowerCase())}"
     data-minuten="${d.minuten}" data-verweise="${verweise}"
     data-suchtext="${escape((d.titel + ' ' + d.klappentext).toLowerCase())}">
    <a class="karte-flaeche" href="${auf}${escape(d.ziel)}"><span class="nur-vorlesen">${escape(d.titel)} öffnen</span></a>
    <div class="karte-marken">${ampelChip(d.ampel)}${phasenChip(phase)}${teilChips(d.teile, 2)}</div>
    <h3>${escape(d.titel)}</h3>
    <p>${escape(d.klappentext)}</p>
    <footer class="karte-fuss">
      <span class="karte-meta">
        ${
          zeit.text
            ? `<span class="meta-zeit${zeit.frisch ? ' frisch' : ''}" title="Zuletzt geändert: ${escape(zeit.titel)}">${escape(zeit.text)}</span>`
            : ''
        }
        ${
          /*
           * Statt der LESEZEIT die Zahl der Verweise.
           *
           * „30 min" beantwortete eine Frage, die man an eine Kachel nicht
           * stellt: Man sucht hier, welches Dokument man aufmacht, nicht wie
           * lange man dann liest — und im Dokument selbst steht die Länge
           * ohnehin (Kopftafel „Länge: 30 min · 7.400 Wörter"). Die Verweise
           * dagegen sagen etwas über den Rang eines Dokuments im Bestand, und
           * bis hierher konnte man danach SORTIEREN („meist verlinkt"), ohne
           * die Zahl je zu sehen.
           */
          verweise
            ? `<span class="meta-verweise" title="${d.rueckverweise.length} nennen dieses Dokument, ${d.verweise.length} werden hier genannt">${verweise} ${verweise === 1 ? 'Verweis' : 'Verweise'}</span>`
            : ''
        }
      </span>
      ${aktionsmenue({
        datei: d.quelle,
        titel: d.titel,
        imArchiv: d.archiviert,
        zurueck: d.kopf.archiviertAus ?? '',
        phasen: d.archiviert ? [] : (roadmap?.phasenNamen ?? []),
        phase,
      })}
    </footer>
  </article>`
}

/**
 * Die Mockup-Kachel. Sie führt auf die DETAILSEITE und nicht mehr direkt in den
 * Mockup: Ein Klick, der ein neues Fenster öffnet, ist eine Einbahnstraße —
 * und alles, was man über das Mockup wissen will (wozu, seit wann, welche
 * Phase), passt nicht in eine Kachel.
 */
function mockupKarte(m, auf, roadmap) {
  const phase = phaseVon(roadmap, 'docs/' + m.quelle)
  const zeit = zeitRelativ(m.geaendert)
  // Die Kachel führt DIREKT in das Mockup. Eine Zwischenseite dazwischen
  // beantwortete keine Frage, die die Kachel nicht schon beantwortet — und wer
  // auf ein Mockup klickt, will das Mockup sehen. Roadmap und Archiv liegen im
  // Menü der Kachel und in der Leiste, die der Dev-Server dem Mockup
  // mitgibt.
  return `<article class="mockup" id="${escape(m.name)}" data-teile="${(m.teile ?? []).join(' ')}"
     data-titel="${escape(m.titel.toLowerCase())}" data-datum="${escape(m.geaendert || '')}" data-minuten="0" data-verweise="0"
     data-suchtext="${escape((m.titel + ' ' + (m.klappentext || '')).toLowerCase())}">
    <a class="karte-flaeche" href="${auf}${escape(m.quelle)}" target="_blank" rel="noopener"><span class="nur-vorlesen">${escape(m.titel)} öffnen</span></a>
    <div class="mockup-text">
      <div class="karte-marken">${m.archiv ? '<span class="ampel ampel-ruht">Archiv</span>' : ''}${teilChips(
        m.teile,
        2,
      )}${
        // Die ABWESENHEIT gehört zu den Marken, nicht in die Wertzeile. Als
        // „Konzept — keines verlinkt" stand sie im selben Grau wie ein
        // ausgefüllter Wert und ging unter; hier oben landet das Auge zuerst.
        // In Warnfarbe wie „Stand prüfen" auf der Roadmap: ein Hinweis zum
        // Nachsehen, kein Alarm — bei einem Drittel der Mockups ist es in
        // Ordnung so.
        (m.konzepte ?? []).length || m.archiv
          ? ''
          : '<span class="marke-fehlt" title="Kein Konzept verlinkt dieses Mockup. Entweder wurde es gezeichnet und direkt gebaut, oder der Link im Konzept fehlt.">ohne Konzept</span>'
      }</div>
      <h3>${escape(m.titel)}</h3>
      ${m.klappentext ? `<p>${escape(m.klappentext)}</p>` : ''}
      ${
        /*
         * WOZU gehört dieser Entwurf? Die Frage stellt man sich bei jedem
         * Mockup, und bis hierher stand die Antwort nur im Fließtext des
         * Konzepts — also genau dort, wo man sie nicht sucht.
         *
         * Als Satzanfang („Gehört zu Live mitverfolgen") war sie zu leise: Man
         * musste lesen, um zu merken, dass da eine BEZIEHUNG steht und keine
         * Bildunterschrift. Jetzt ein benanntes Etikett — „Konzept" sagt, was
         * das Folgende ist, und der Titel daneben ist der Link. Dieselbe Form
         * wie in der Kopftafel eines Dokuments: Etikett, dann Wert.
         */
        (m.konzepte ?? []).length
          ? `<div class="mockup-konzept"><span class="mockup-konzept-etikett">${
              m.konzepte.length === 1 ? 'Konzept' : 'Konzepte'
            }</span><span class="mockup-konzept-wert">${m.konzepte
              .map(
                (k) =>
                  `<a href="${auf}${escape(k.ziel)}" title="${escape(k.titel)}">${escape(
                    k.titel.replace(/^(Konzept|Umbauplan|Umsetzung):\s*/, ''),
                  )}</a>`,
              )
              .join('<span class="tafel-punkt">·</span>')}</span></div>`
          : // Die Zeile bleibt als LEERE Spur stehen, wo kein Konzept verlinkt
            // ist: Sie hält die Kachel auf derselben Höhe wie ihre Nachbarn. Die
            // Auskunft trägt die Marke oben, hier steht nichts — kein grauer
            // Ersatztext, der wie ein Wert aussieht.
            '<div class="mockup-konzept leer" aria-hidden="true"></div>'
      }
      <footer class="karte-fuss">
        <span class="karte-meta">
          ${
            /*
             * Wann zuletzt geändert — dieselbe Angabe wie auf den Dokument-
             * Kacheln, und aus demselben Grund: Ein Mockup von vorgestern
             * und einer vom letzten Frühjahr sind verschiedene Dinge, und
             * ansehen muss man beiden das bisher nicht. Sie stand nicht einmal
             * im Markup — die Kachel trug `data-datum=""`, wodurch die
             * Voreinstellung „zuletzt geändert" alle Mockups für gleich alt
             * hielt und faktisch nach nichts sortierte.
             */
            zeit.text
              ? `<span class="meta-zeit${zeit.frisch ? ' frisch' : ''}" title="Zuletzt geändert: ${escape(zeit.titel)}">${escape(zeit.text)}</span>`
              : ''
          }
        </span>
        ${aktionsmenue({
          datei: 'docs/' + m.quelle,
          titel: m.titel,
          imArchiv: m.archiv,
          zurueck: 'mockups',
          // KEINE Phasen: Auf die Roadmap kommen Konzepte. Ein Menü, das eine
          // Phase anbietet, die der Sammler danach verweigert, wäre eine
          // Einladung in eine Sackgasse.
          phasen: [],
          oeffnen: `<a class="menue-eintrag" href="${auf}${escape(m.quelle)}" target="_blank" rel="noopener">Mockup öffnen ↗</a><hr />`,
        })}
      </footer>
    </div>
  </article>`
}

/** Wie viele Dokumente eines Bereichs in welchem Zustand sind. */
function ampelBalken(eigene) {
  // „ohne" zählt mit, sonst LÜGT der Balken: Fünf gefärbte von neunzehn
  // Dokumenten füllten ihn sonst zur Hälfte grün und zur Hälfte amber.
  const arten = ['verbindlich', 'fertig', 'unterwegs', 'offen', 'ruht', 'ohne']
  const zahlen = arten.map((a) => eigene.filter((d) => (d.ampel?.art ?? 'ohne') === a).length)
  const summe = zahlen.reduce((s, n) => s + n, 0)
  if (!summe) return ''
  return `<div class="verteilung" role="img" aria-label="${arten
    .map((a, i) => (zahlen[i] ? `${zahlen[i]} ${AMPEL_WORT[a]}` : ''))
    .filter(Boolean)
    .join(', ')}">
    ${arten
      .map((a, i) =>
        zahlen[i]
          ? `<i class="ampel-${a}" style="flex:${zahlen[i]}" title="${zahlen[i]} ${AMPEL_WORT[a]}"></i>`
          : '',
      )
      .join('')}
  </div>`
}

/* ── Ebene 1: Übersicht ───────────────────────────────────────────────── */

/**
 * Die Roadmap als Spuren: eine Spalte je Phase.
 *
 * Zwei Quellen für zwei verschiedene Fragen: die REIHENFOLGE steht in
 * `docs/roadmap.md` (eine Entscheidung), der STAND im Dokument selbst
 * (`Status:`-Zeile). Stünde beides in der Roadmap, wäre die zweite Angabe die,
 * die niemand nachzieht.
 *
 * Vier Dinge, die eine Roadmap-Ansicht leisten muss und die vorher fehlten:
 *
 * 1. WIE WEIT? Die Ampel sagte nur „Unterwegs" — der Statussatz des Dokuments
 *    sagt „Etappen 0–6 gebaut, Polar live" oder „Server und Studio gebaut, App
 *    offen". Genau das ist die Antwort, also steht sie auf der Karte.
 * 2. WIDERSPRÜCHE ZEIGEN. Ein Vorhaben in „In Arbeit", dessen Status „nichts
 *    gebaut" sagt, ist entweder falsch einsortiert oder sein Status ist alt.
 *    Eine Ansicht, die das glättet, ist hübsch und wertlos.
 * 3. WAS RUHT? „In Arbeit" seit zwei Wochen unberührt ist die interessanteste
 *    Zahl einer Roadmap. Sie steht im Git-Datum und wurde weggeworfen.
 * 4. GEWICHT NACH WICHTIGKEIT. „Angedacht" war die größte Spalte, „In Arbeit"
 *    die wichtigste. Der Blick folgt der Fläche, also folgt die Fläche jetzt
 *    der Phase: vorne ausführlich, hinten knapp.
 */
function roadmapAbschnitt(roadmap, bereiche) {
  if (!roadmap || !roadmap.phasen.length) return ''
  const ton = bereiche.find((b) => b.id === 'concepts')?.ton ?? 'var(--akzent)'

  /*
   * EIN Satz je Karte, und zwar der NÄCHSTE SCHRITT.
   *
   * Vorher standen Statussatz und nächster Schritt übereinander, beide als
   * Fließtext derselben Größe, der erste auf 64 Zeichen gekappt („Etappe 1
   * gebaut und auf Player-Technik zurückgeführt, nächste…"). Zwei angeschnittene
   * Sätze in einer schmalen Spalte liest niemand, und sie sagten halb dasselbe.
   *
   * Die Roadmap beantwortet „was ist zu tun" — das „wie weit" steht einen Klick
   * entfernt im Dokument und hier im Tooltip. Sichtbar bleibt der Stand nur, wo
   * er der Phase WIDERSPRICHT: „Stand prüfen" ist keine Wiederholung, sondern
   * ein Fund.
   */
  /*
   * EINE Karte, in jeder Phase dieselbe.
   *
   * Vorher hing ihr INHALT an der Phase: Der nächste Schritt wurde nur in den
   * ersten beiden Spalten gerendert, „Stand prüfen" nur in der ersten. Solange
   * eine Karte dort blieb, wo sie gebaut wurde, ging das gut. Seit man sie
   * ZIEHEN kann, ist es ein Fehler: Ein Eintrag aus „Angedacht" landete in
   * „In Arbeit" und stand dort ohne seinen Schritt zwischen Nachbarn, die alle
   * einen haben — und umgekehrt schleppte einer seinen Schritt in eine Spalte,
   * in der keiner steht.
   *
   * Deshalb trägt jede Karte ALLES, was sie hat, und die Phase entscheidet nur
   * über die DARSTELLUNG. Die läuft über CSS am Elternteil (`.rm-phase.stufe-2 …`)
   * und passt sich damit von selbst an, sobald die Karte umzieht — ohne dass
   * jemand DOM umschreiben muss.
   *
   * Denselben Weg geht der Widerspruchs-Marker: Er steht immer im Markup,
   * `data-ampel` am Eintrag sagt, ob das Dokument „nichts gebaut" meldet, und
   * sichtbar macht ihn erst die Regel für die laufende Phase. Als
   * JS-Berechnung wäre er nach jedem Zug veraltet.
   */
  const eintrag = (e) => {
    const titel =
      e.beschriftung || String(e.dok.titel).replace(/^(Konzept|Umbauplan|Umsetzung):\s*/, '')
    const status = e.dok.kopf.status
    const ampel = e.dok.ampel?.art ?? ''

    /*
     * NUR die wartende Seite trägt eine Marke.
     *
     * Die Gegenrichtung („blockiert Video-Export" an der Monetarisierung) leitet
     * der Sammler weiter ab — sie steht in `e.blockiert` und ist die Grundlage
     * dafür, dass die Beziehung überhaupt geprüft werden kann. Gezeigt wird sie
     * nicht: Dieselbe Abhängigkeit stand damit zweimal auf derselben Seite, und
     * handeln muss man an der wartenden Karte. Dort ändert die Marke, was man
     * tun kann; an der blockierenden war sie eine Auskunft über den Nachbarn.
     */
    const marken = []
    if (e.wartet)
      marken.push(
        `<a class="rm-kette wartet" href="${escape(e.wartet.ziel)}"
            title="Kann erst weitergehen, wenn das erledigt ist">wartet auf ${escape(e.wartet.titel)}</a>`,
      )

    // Der GRIFF macht sichtbar, dass die Rangfolge veränderbar ist. Ohne ihn
    // war die Karte ziehbar und niemand konnte es wissen. Er ist ein Knopf,
    // damit ihn die Tastatur erreicht, und liegt in einer eigenen Spalte —
    // absolut über dem Text lag er auf den ersten Buchstaben.
    const griff = `<button type="button" class="rm-griff" data-rm-griff aria-label="Verschieben (Pfeiltasten, Ziehen zwischen den Spalten)" title="Ziehen — auch in eine andere Phase"><i></i><i></i><i></i></button>`

    return `<li data-datei="${escape(e.quelle)}" data-ampel="${escape(ampel)}">
      ${griff}
      ${
        /*
         * Das Zeichen des Konzepts (Feld `icon:` im Kopf, Satz in icons.mjs).
         * Achtzehn Karten in drei Spalten sahen sich alle gleich an; wer eine
         * Roadmap überfliegt, sucht aber nicht Text, sondern WIEDER. Es steht
         * VOR dem Titel und nicht im Titel-Link: Anklickbar ist der Name, das
         * Zeichen ist eine Marke, kein zweites Ziel.
         */
        ''
      }<span class="rm-marke">${icon(e.dok.kopf.icon, 'rm-icon')}</span>
      <span class="rm-inhalt">
        <a class="rm-ziel" href="${escape(e.dok.ziel)}"${status ? ` title="${escape(status)}"` : ''}>
          <span class="rm-titel">${escape(titel)}</span>
        </a>
        ${e.schritt ? `<span class="rm-schritt">${escape(e.schritt)}</span>` : ''}
        ${marken.length ? `<span class="rm-ketten">${marken.join('')}</span>` : ''}
        ${
          status
            ? `<span class="rm-fuss"><span class="rm-warnung" title="Die Phase sagt „läuft", das Dokument sagt „${escape(status)}". Eines von beidem ist nicht mehr wahr.">Stand prüfen</span></span>`
            : ''
        }
      </span>
      <button type="button" class="rm-weg" data-roadmap-weg data-datei="${escape(e.quelle)}"
              title="Von der Roadmap nehmen" aria-label="Von der Roadmap nehmen">×</button>
    </li>`
  }

  const phase = (ph, i) => `<section class="rm-phase stufe-${i}${i === 0 ? ' jetzt' : ''}">
    <header>
      <div class="rm-kopf">
        <h3>${escape(ph.name)}</h3>
        <span class="rm-zahl">${ph.eintraege.length}</span>
      </div>
    </header>
    <ol class="rm-liste" data-phase="${escape(ph.name)}">${ph.eintraege.map(eintrag).join('')}</ol>
    <div class="rm-leer">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
        <path d="M12 4v9"/>
        <path d="M8.5 9.5 12 13l3.5-3.5"/>
      </svg>
      <b>Diese Phase ist leer</b>
      <span>Karte aus einer anderen Spalte hierher ziehen</span>
    </div>
  </section>`

  /*
   * Über den Spalten steht, was man sonst zusammenzählen müsste — und ein Fund,
   * den die Spalten NICHT zeigen können: ein Vorhaben, an dem schon gearbeitet
   * wird, das aber in keiner Phase steht. Es taucht auf der Roadmap gar nicht
   * auf, und genau deshalb fällt es niemandem auf.
   */
  const imCode = roadmap.imCode ?? []
  const hinweisZeile = imCode.length
    ? `<p class="rm-fund">
        <b>${imCode.length} ${imCode.length === 1 ? 'Vorhaben ist' : 'Vorhaben sind'} im Code, aber in keiner Phase.</b>
        ${imCode
          .map(
            (d) =>
              `<a href="${escape(d.ziel)}">${escape(d.titel.replace(/^(Konzept|Umbauplan|Umsetzung):\s*/, ''))}</a>`,
          )
          .join('<i>·</i>')}
      </p>`
    : ''

  const nebenbei = []
  if (roadmap.erledigt?.length)
    nebenbei.push(
      falte(
        'Abgearbeitet',
        roadmap.erledigt.length,
        `<ol class="rm-liste rm-offen">${roadmap.erledigt
          .map((d) => eintrag({ dok: d, quelle: d.quelle, schritt: '' }))
          .join('')}</ol>`,
      ),
    )
  const nurGedacht = roadmap.nurGedacht ?? roadmap.offen
  if (nurGedacht.length)
    nebenbei.push(
      falte(
        'Ohne Phase',
        nurGedacht.length,
        `<ol class="rm-liste rm-offen">${nurGedacht
          .map((d) => eintrag({ dok: d, quelle: d.quelle, schritt: '' }))
          .join('')}</ol>`,
      ),
    )

  return `<section class="streifen" id="roadmap" style="--ton:${ton}">
    <div class="streifen-kopf">
      <h2>Roadmap${hinweis(
        'Grobe Reihenfolge, keine Zusage. Die Reihenfolge wird in <code>docs/roadmap.md</code> gepflegt, der Stand kommt aus dem <code>status</code>-Feld der Dokumente. Wo beides sich widerspricht, steht „Stand prüfen". „Code bewegt" misst an den Dateien, die ein Konzept unter <code>betrifft</code> nennt.',
      )}</h2>
    </div>
    ${hinweisZeile}
    <div class="roadmap">${roadmap.phasen.map(phase).join('')}</div>
    ${nebenbei.join('')}
  </section>`
}

/** Ein Statussatz auf Kartenlänge — ohne den Halbsatz zu zerhacken. */
function kurzSatz(text, max) {
  const rein = text.replace(/\s+/g, ' ').trim()
  if (rein.length <= max) return rein
  const schnitt = rein.slice(0, max)
  const letzte = Math.max(schnitt.lastIndexOf(','), schnitt.lastIndexOf(' '))
  return schnitt.slice(0, letzte > max * 0.6 ? letzte : max).trimEnd() + '…'
}

export function uebersichtSeite({ bereiche, dokumente, mockups, bilder, roadmap, schriftLokal }) {
  const nachQuelle = new Map(dokumente.map((d) => [d.quelle, d]))
  const zuletzt = [...dokumente]
    .filter((d) => d.geaendert)
    .sort((a, b) => b.geaendert.localeCompare(a.geaendert))
  // Archiviertes wird auch angefasst (Umbenennen, Verschieben, ein Nachtrag),
  // gehört aber nicht in die fünf Zeilen, die jeder liest: „zuletzt bewegt"
  // liest man als „das ist gerade dran". Weggelassen wird es nicht — es steht
  // im Aufklapper darunter, mit seinem grauen Bereichsnamen.
  const aktuelle = zuletzt.filter((d) => !d.archiviert)
  const rest = zuletzt.filter((d) => !aktuelle.slice(0, 5).includes(d))

  const zeile = (d) => `<li style="--ton:${bereiche.find((b) => b.id === d.bereich)?.ton}">
      <span class="zeit">${escape(datum(d.geaendert))}</span>
      <a href="${escape(d.ziel)}">${escape(d.titel)}</a>
      <span class="zeit-bereich">${escape(bereiche.find((b) => b.id === d.bereich)?.name ?? '')}</span>
    </li>`

  const inhalt = `${kopfleiste('index.html', bereiche)}
<main class="uebersicht">
  <section class="titel">
    <div class="titel-text">
      <span class="augenmerk">Interne Dokumentation</span>
      <h1>Alles, was über <em>Maptale</em> aufgeschrieben ist.</h1>
      <p class="titel-bilanz">
        <b>${dokumente.length}</b> Dokumente in <b>${bereiche.length}</b> Bereichen,
        dazu <b>${mockups.length}</b> Mockups.
      </p>
      <div class="titel-knoepfe">
        <button class="knopf knopf-haupt" type="button" data-suche-oeffnen>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="13.5" y1="13.5" x2="18" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          Alles durchsuchen <kbd>⌘K</kbd>
        </button>
        <a class="knopf" href="#roadmap">Roadmap ansehen</a>
      </div>
    </div>
    <div class="titel-bild">${titelgrafik()}</div>
  </section>

  ${roadmapAbschnitt(roadmap, bereiche)}

  <section class="streifen" id="bereiche">
    <div class="streifen-kopf">
      <h2>Die Bereiche${hinweis(
        'Jeder Bereich hat eine eigene Seite, und seine Farbe begleitet ihn durch den ganzen Viewer. Der Balken unten zeigt, wie viele Dokumente darin gebaut, unterwegs oder Entwurf sind.',
      )}</h2>
    </div>
    <div class="bereich-gitter" style="--spalten:${bereiche.length}">
      ${bereiche
        .map((b) => {
          const eigene = dokumente.filter((d) => d.bereich === b.id)
          if (!eigene.length) return ''
          return `<a class="bereich-kachel" href="${b.id}/index.html" style="--ton:${b.ton}">
            <div class="kachel-motiv">${motiv(b.motiv)}</div>
            <div class="kachel-text">
              <div class="kachel-kopf">
                <span class="bereich-kurz">${escape(b.kurz)}</span>
                <span class="bereich-zahl">${eigene.length}</span>
              </div>
              <h3>${escape(b.name)}</h3>
              <p>${escape(b.text)}</p>
              ${ampelBalken(eigene)}
            </div>
          </a>`
        })
        .join('')}
    </div>
  </section>

  <section class="streifen">
    <div class="streifen-kopf"><h2>Zuletzt bewegt</h2></div>
    <ol class="zeitstrahl">${aktuelle.slice(0, 5).map(zeile).join('')}</ol>
    ${
      rest.length
        ? falte(
            'Ältere Änderungen',
            rest.length,
            `<ol class="zeitstrahl">${rest.map(zeile).join('')}</ol>`,
            {
              satz: 'Was davor angefasst wurde, inklusive Archiv.',
            },
          )
        : ''
    }
  </section>

</main>
${fussleiste()}
${suchschicht()}`

  return huelle({
    titel: 'Übersicht',
    ziel: 'index.html',
    klasse: 'seite-uebersicht',
    inhalt,
    schriftLokal,
  })
}

/**
 * Die Filterleiste einer Liste: EIN Suchfeld, EIN Auswahlfeld je Achse, EIN
 * Zähler.
 *
 * Vorher standen dort zwei Reihen Pillen mit zusammen elf Knöpfen — darunter
 * zweimal „Alle" („Alle Teile" und „Alle"), also zweimal dasselbe Wort für
 * zwei verschiedene Dinge. Eine Auswahl mit sieben Optionen ist ein Feld und
 * keine Reihe: Sie zeigt, WAS gewählt ist, statt alles gleichzeitig anzubieten,
 * und die Zeile bleibt eine Zeile.
 */
function filterleiste(sammlung, { platzhalter = 'Filtern …', mitStatus = false } = {}) {
  const teileZaehler = new Map()
  for (const x of sammlung)
    for (const id of x.teile ?? []) teileZaehler.set(id, (teileZaehler.get(id) ?? 0) + 1)
  const teile = SYSTEMTEILE.filter((t) => teileZaehler.has(t.id))

  const arten = ['verbindlich', 'fertig', 'unterwegs', 'offen', 'ruht', 'ohne'].filter((a) =>
    sammlung.some((d) => (d.ampel?.art ?? 'ohne') === a),
  )
  const statusZahl = (a) => sammlung.filter((d) => (d.ampel?.art ?? 'ohne') === a).length

  const feld = (name, label, optionen) =>
    optionen.length < 2
      ? ''
      : `<span class="filterwahl">
          <span class="filterwahl-name">${escape(label)}</span>
          <select class="wz-wahl" data-${name} aria-label="${escape(label)}">
            <option value="alle">alle</option>
            ${optionen.map((o) => `<option value="${o.wert}">${escape(o.text)}</option>`).join('')}
          </select>
        </span>`

  return `<div class="werkzeugleiste">
    <input type="search" class="filterfeld" placeholder="${escape(platzhalter)}" data-filter-feld autocomplete="off" />
    ${feld(
      'teilwahl',
      'Systemteil',
      teile.map((t) => ({ wert: t.id, text: `${t.name} (${teileZaehler.get(t.id)})` })),
    )}
    ${
      mitStatus
        ? feld(
            'statuswahl',
            'Zustand',
            arten.map((a) => ({ wert: a, text: `${AMPEL_WORT[a]} (${statusZahl(a)})` })),
          )
        : ''
    }
    ${
      // Die Liste kam bisher in DATEINAMEN-Reihenfolge — für den Leser eine
      // zufällige Ordnung (alle „konzept_*" landen beieinander, weil sie so
      // heißen). Voreinstellung ist deshalb „zuletzt geändert".
      sammlung.length > 2
        ? `<span class="filterwahl">
            <span class="filterwahl-name">Sortierung</span>
            <select class="wz-wahl" data-sortierung aria-label="Sortierung">
              <option value="datum">zuletzt geändert</option>
              <option value="titel">A bis Z</option>
              <option value="kurz">kürzeste zuerst</option>
              <option value="verweise">meist verlinkt</option>
            </select>
          </span>`
        : ''
    }
    <span class="filter-zaehler" data-zaehler>${sammlung.length} ${sammlung.length === 1 ? 'Eintrag' : 'Einträge'}</span>
  </div>`
}

/**
 * Die Systemteil-Filter einer Liste. Angeboten wird nur, was in DIESER Liste
 * vorkommt — ein Filter „Android-App" über einer Liste ohne ein einziges
 * App-Dokument ist eine Falle, die man einmal anklickt und dann nicht mehr.
 */
function teilFilter(sammlung) {
  const zaehler = new Map()
  for (const x of sammlung)
    for (const id of x.teile ?? []) zaehler.set(id, (zaehler.get(id) ?? 0) + 1)
  const vorhanden = SYSTEMTEILE.filter((t) => zaehler.has(t.id))
  if (vorhanden.length < 2) return ''
  return `<div class="filterchips teil-filter" data-teilfilter>
    <button type="button" class="filterchip an" data-teil="alle">Alle Teile</button>
    ${vorhanden
      .map(
        (t) =>
          `<button type="button" class="filterchip" data-teil="${t.id}">${escape(t.name)} <b>${zaehler.get(t.id)}</b></button>`,
      )
      .join('')}
  </div>`
}

/* ── Ebene 2: Bereichsseite ───────────────────────────────────────────── */

export function bereichSeite({ bereich, dokumente, bereiche, roadmap, schriftLokal }) {
  const ziel = `${bereich.id}/index.html`
  const auf = hoch(ziel)
  const alle = dokumente.filter((d) => d.bereich === bereich.id)
  const eigene = alle.filter((d) => !d.archiviert)
  const archiv = alle.filter((d) => d.archiviert)

  const inhalt = `${kopfleiste(ziel, bereiche)}
<main class="uebersicht schmal" style="--ton:${bereich.ton}">
  <section class="bereich-titel">
    <div class="bereich-titel-motiv">${motiv(bereich.motiv)}</div>
    <div>
      <div class="brotkrumen"><a href="${auf}index.html">Übersicht</a><i>/</i><span>${escape(bereich.name)}</span></div>
      <h1>${escape(bereich.name)}</h1>
      <p>${escape(bereich.text)}</p>
    </div>
  </section>

  ${filterleiste(eigene, { platzhalter: `In ${bereich.name} filtern …`, mitStatus: true })}

  <div class="karten" data-karten>${nachDatum(eigene)
    .map((d) => dokumentKarte(d, auf, bereich.ton, roadmap))
    .join('\n')}</div>
  <p class="leer-hinweis" data-leer hidden>Nichts gefunden. Filter zurücksetzen oder <button type="button" class="alsLink" data-suche-oeffnen>alles durchsuchen</button>.</p>

  ${
    archiv.length
      ? falte(
          'Archiv',
          archiv.length,
          `<div class="karten archiv-gitter">${archiv
            .map((d) => dokumentKarte(d, auf, bereich.ton, roadmap))
            .join('\n')}</div>`,
          {
            satz: 'Erledigtes und Verworfenes aus diesem Bereich. Nicht als Implementierungsquelle nutzen.',
          },
        )
      : ''
  }
</main>
${fussleiste()}
${suchschicht()}`

  return huelle({ titel: bereich.name, ziel, klasse: 'seite-bereich', inhalt, schriftLokal })
}

/* ── Ebene 3: Dokumentseite ───────────────────────────────────────────── */

/**
 * Die Knöpfe, die schreiben. Sie stehen im Markup IMMER, werden aber erst
 * eingeblendet, wenn die Seite über HTTP kam (`body.mit-dienst`, gesetzt in
 * viewer.js): Als Datei geöffnet gibt es keinen Server, der sie beantworten
 * könnte — ein Knopf, der nichts tut, ist schlechter als keiner.
 */
function werkzeuge(dok, roadmap) {
  const imArchiv = dok.archiviert
  const phase = phaseVon(roadmap, dok.quelle)
  return `<span class="werkzeuge" data-werkzeuge data-datei="${escape(dok.quelle)}">
    <button type="button" class="wz wz-haupt" data-bearbeiten>Bearbeiten</button>
    ${aktionsmenue({
      datei: dok.quelle,
      titel: dok.titel,
      imArchiv,
      zurueck: dok.kopf.archiviertAus ?? '',
      phasen: imArchiv ? [] : (roadmap?.phasenNamen ?? []),
      phase,
    })}
  </span>`
}

/**
 * Die Kopftafel über dem Text: was das Dokument über sich sagt, plus die Datei,
 * in der es steht.
 *
 * Vorher stand beides nicht da. Der STATUS steckte im Fließtext des Dokuments
 * („Stand: … · Status: … · Betrifft: …") und war damit eine Zeile Prosa unter
 * vielen; die DATEI stand als Fußnote am Ende. Beides ist aber genau das, was
 * man beim Aufschlagen wissen will: Gilt das noch, und wo ändere ich es?
 *
 * Die Zeile aus dem Fließtext ist dafür ERSATZLOS entfallen (Front Matter, s.
 * `kopf.mjs`) — hätte man sie stehen lassen, stünde derselbe Stand zweimal auf
 * der Seite, und beim nächsten Mal wäre eine der beiden Angaben alt.
 */
function kopftafel(dok, roadmap) {
  const zeile = (name, inhalt, titel = '') =>
    inhalt
      ? `<div><dt${titel ? ` title="${escape(titel)}"` : ''}>${escape(name)}</dt><dd>${inhalt}</dd></div>`
      : ''

  // Pfade als eigene Marken. Nur durch Kommas getrennt gingen die Trenner
  // zwischen den Mono-Zeichen unter, und die Aufzählung las sich als ein Pfad.
  //
  // Ohne `betrifft` im Kopf steht hier die ABGELEITETE Antwort auf dieselbe
  // Frage: die Systemteile. Sie standen vorher als Marken über dem Titel und
  // waren dort neben der Pfadliste eine zweite Auskunft über dasselbe — die
  // Kompression von genau diesen Pfaden. Jetzt erscheint sie nur, wo die
  // ausführliche Antwort fehlt, und das ist bei jedem Dokument ohne Kopf.
  const betrifft = dok.kopf.betrifft.length
    ? dok.kopf.betrifft.map((b) => `<code>${escape(b)}</code>`).join('')
    : teilChips(dok.teile, 4)

  // Der Status steht IMMER hier und nirgends sonst. Wo das Dokument einen Satz
  // dazu hat, ist es dieser Satz; wo nicht, das Wort der Ampel („Verbindlich"
  // bei den Handbuch-Dateien). Vorher war es beides an zwei Orten — als Pille
  // über dem Titel und als Satz darunter —, und die Pille sagte weniger.
  const statusWort =
    dok.kopf.status || (dok.ampel ? AMPEL_WORT[dok.ampel.art] || dok.ampel.wort : '')
  const status = statusWort
    ? `<span class="tafel-status" data-art="${dok.ampel?.art ?? 'ruht'}">${escape(statusWort)}</span>`
    : ''

  // „Stand" ist die Behauptung des Autors, „Geändert" die Auskunft von Git.
  // Sie stehen ABSICHTLICH nebeneinander: Erst im Vergleich sagen sie etwas —
  // „Stand: März, geändert: gestern" heißt, dass der Stand nicht stimmt. Als
  // Marke über dem Titel („zuletzt 17. Aug.") stand das Git-Datum in derselben
  // Form wie der Stand und war von ihm nicht zu unterscheiden.
  const geaendert = zeitRelativ(dok.geaendert)

  // Behauptung und Gegenprobe in EINER Zeile: „17. August 2026 · geändert
  // heute". Als zwei Zeilen las man zwei Daten, als eine liest man den
  // Vergleich — und der ist die Auskunft. „Stand: März, geändert: gestern"
  // heißt, dass der Stand nicht stimmt.
  const stand = [
    dok.kopf.stand ? `<span class="tafel-datum">${escape(standLang(dok.kopf.stand))}</span>` : '',
    // Das Wort „geändert" steht nur, wo links ein Stand daneben steht — dort
    // trennt es die beiden Angaben. Ohne Stand trägt es das Etikett, und
    // „Geändert: geändert vor 4 Tagen" sagt es zweimal.
    geaendert.text
      ? `<span class="tafel-leise" title="${escape(geaendert.titel)}">${
          dok.kopf.stand ? 'geändert ' : ''
        }${escape(geaendert.text)}</span>`
      : '',
    // Der Weg in den Verlauf steht HIER und nicht als eigene Zeile: Er
    // beantwortet dieselbe Frage wie Stand und Änderungsdatum, nur
    // ausführlich. Als eigene Tafelzeile wäre er eine dritte Angabe über
    // dasselbe.
    (dok.verlauf ?? []).length
      ? `<a class="tafel-tat" href="#verlauf">Verlauf (${dok.verlauf.length})</a>`
      : '',
  ]
    .filter(Boolean)
    .join('<span class="tafel-punkt">·</span>')

  return `<dl class="kopftafel">
    ${zeile(
      dok.kopf.stand ? 'Stand' : 'Geändert',
      stand,
      dok.kopf.stand
        ? 'Links, was das Dokument über seinen Stand sagt. Rechts, wann die Datei zuletzt angefasst wurde (aus der Git-Historie).'
        : 'Letzte Änderung an der Datei, aus der Git-Historie',
    )}
    ${zeile('Status', status)}
    ${zeile('Roadmap', escape(phaseVon(roadmap, dok.quelle) || ''), 'Phase in docs/roadmap.md')}
    ${zeile(
      (dok.prototypen ?? []).length === 1 ? 'Mockup' : 'Mockups',
      (dok.prototypen ?? [])
        .map(
          (p) =>
            `<a class="tafel-tat" href="${escape(hoch(dok.ziel) + p.quelle)}" target="_blank" rel="noopener">${escape(p.titel)}</a>`,
        )
        .join('<span class="tafel-punkt">·</span>'),
      'HTML-Entwürfe, die dieses Dokument verlinkt',
    )}
    ${zeile('Betrifft', betrifft)}
    ${zeile(
      'Länge',
      // Eigene Zeile und nicht bei der Datei: Dort standen Pfad, Lesezeit und
      // zwei Aktionen zusammen auf 493 von 501 Pixeln, und die Aktionen fielen
      // in die zweite Reihe. Mit der Wortzahl daneben sagt die Zeile außerdem
      // mehr als die Pille „30 min" über dem Titel je gesagt hat.
      `<span class="tafel-datum">${dok.minuten} min</span> Lesezeit
       <span class="tafel-punkt">·</span>
       <span class="tafel-leise">${dok.worte.toLocaleString('de-DE')} Wörter</span>`,
    )}
    ${zeile(
      'Datei',
      `<button type="button" class="tafel-pfad" data-pfad-kopieren
               title="Pfad in die Zwischenablage kopieren">${escape(dok.quelle)}</button>
       <span class="tafel-taten">
         <button type="button" class="tafel-tat nur-dienst" data-editor-oeffnen>Editor</button>
         <a class="tafel-tat" href="${escape(hoch(dok.ziel) + '../../' + dok.quelle)}">Quelltext</a>
       </span>`,
    )}
  </dl>`
}

/* ── Verlauf ──────────────────────────────────────────────────────────────
 * Was ein Dokument über sich sagt, steht in seinem Kopf; was mit ihm passiert
 * IST, stand bis hierher nur in der Git-Historie — also außerhalb des Viewers.
 * Beides nebeneinander beantwortet die Frage, die man an eine Doku stellt:
 * Stimmt das noch, und wenn nicht, seit wann?
 *
 * DREI ENTSCHEIDUNGEN:
 *
 * 1. **Die Kopfänderung steht ÜBER dem Betreff, nicht darunter.** Sie ist die
 *    Auskunft, wegen der die Liste existiert („Status: Entwurf → Etappe 1
 *    gebaut"); der Commit-Betreff ist die Begleitung dazu. In der zweiten
 *    Zeile las man erst vierzig Betreffs und fand die drei Sprünge nicht.
 * 2. **Zugeklappt, aber nicht versteckt.** Ein `<details>` mit der Zahl in der
 *    Zusammenfassung: Wer den Verlauf sucht, sieht sofort, dass es ihn gibt;
 *    wer das Dokument liest, bekommt keine vierzig Zeilen Fußnote.
 * 3. **Kein Klick auf eine alte Fassung.** Der Verlauf sagt, WANN sich etwas
 *    geändert hat. Alte Fassungen zu rendern hieße, jede davon als Seite zu
 *    bauen — und der gebaute Viewer liegt lokal in `docs/_site/`.
 */

/** Ein Commit-Eintrag: Kopfänderung, Datum, Betreff, Kürzel. */
function verlaufEintrag(c) {
  const zeit = zeitRelativ(c.datum)
  const kopf = (c.kopf ?? [])
    .map(
      (k) =>
        `<span class="verlauf-feld"><b>${escape(k.etikett)}</b><span class="verlauf-wert">${
          k.von
            ? `<span class="verlauf-alt">${escape(k.von)}</span><i>→</i>`
            : '<span class="verlauf-neu-marke">neu</span>'
        }<span class="verlauf-neu">${escape(k.nach || '—')}</span></span></span>`,
    )
    .join('')
  return `<li${kopf ? ' class="hat-kopf"' : ''}>
    <div class="verlauf-zeile">
      <time datetime="${escape(c.datum)}" title="${escape(zeit.titel)}">${escape(datum(c.datum))}</time>
      <span class="verlauf-betreff">${escape(c.betreff)}</span>
      <button type="button" class="verlauf-sha" data-sha-kopieren
              title="Commit ${escape(c.sha)} — klicken kopiert das Kürzel">${escape(c.kurz)}</button>
    </div>
    ${kopf ? `<div class="verlauf-kopf">${kopf}</div>` : ''}
  </li>`
}

/**
 * Der Verlauf unter dem Text. Ohne Git (oder ohne einen einzigen Commit) fällt
 * er ganz weg — eine leere Klappe wäre eine Auskunft über nichts.
 */
function verlaufBlock(dok) {
  const commits = dok.verlauf ?? []
  if (!commits.length && !dok.offen) return ''
  const spruenge = commits.reduce((n, c) => n + ((c.kopf ?? []).length ? 1 : 0), 0)
  return `<section class="verlauf" id="verlauf">
    <details>
      <summary>
        <span class="verlauf-titel">Verlauf</span>
        <span class="verlauf-menge">${commits.length} ${
          commits.length === 1 ? 'Überarbeitung' : 'Überarbeitungen'
        }${spruenge ? ` · ${spruenge}× Kopf geändert` : ''}</span>
      </summary>
      <ol class="verlauf-liste">
        ${
          // Der Arbeitsstand steht ganz oben und ist kein Commit. Ohne ihn
          // endete die Liste beim vorletzten Stand — und die eigene Änderung
          // von eben sähe aus, als wäre sie verloren.
          dok.offen
            ? `<li class="verlauf-offen"><div class="verlauf-zeile">
                 <time>jetzt</time>
                 <span class="verlauf-betreff">Arbeitsstand, noch nicht committet</span>
               </div></li>`
            : ''
        }
        ${commits.map(verlaufEintrag).join('\n')}
      </ol>
    </details>
  </section>`
}

/** HTML-Entitäten zurück in Text — die fünf, die `escape()` erzeugt, plus Zahlen. */
function entkodiere(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, zahl) => String.fromCharCode(Number(zahl)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Bindet ein abschließendes Zeichen-Kürzel (das ✅ hinter „Etappe 3") mit einem
 * geschützten Leerzeichen an das letzte Wort.
 *
 * In der schmalen Inhaltsspalte brach es sonst als EINZIGES Zeichen in eine
 * zweite Zeile — bei acht Etappen-Überschriften untereinander sah das
 * Verzeichnis dadurch aus, als stünde die Hälfte der Einträge doppelt. Der Text
 * selbst bleibt unangetastet: Es ist eine Setzregel der Spalte, keine Änderung
 * am Dokument.
 */
function zusammenAmEnde(titel) {
  return String(titel).replace(/ (\p{Extended_Pictographic}[\uFE0F]?)\s*$/u, '\u00a0$1')
}

/**
 * Schiebt einen Block hinter die erste `h1` des gerenderten Textes.
 *
 * Die Tafel gehört UNTER den Titel und nicht darüber: Sie sagt etwas über
 * dieses Dokument, und wovon sie redet, weiß man erst, wenn man seinen Namen
 * gelesen hat. Über der Überschrift stand sie wie ein Vorwort ohne Bezug.
 * Fehlt die `h1` (ein Dokument ohne Überschrift), kommt sie davor — dann ist
 * sie das Erste, was dasteht, und das ist immer noch richtig.
 */
function nachDerUeberschrift(html, block) {
  const ende = html.indexOf('</h1>')
  if (ende === -1) return block + html
  const schnitt = ende + '</h1>'.length
  return html.slice(0, schnitt) + block + html.slice(schnitt)
}

/** Der Editor. Leer im Markup — den Text holt viewer.js beim Öffnen frisch. */
function schreibtisch(dok) {
  return `<section class="schreibtisch" data-schreibtisch hidden>
    <div class="schreibtisch-kopf">
      <span><b>Quelltext bearbeiten</b> <code>${escape(dok.quelle)}</code></span>
      <span class="schreibtisch-hinweis" data-schreibtisch-hinweis>⌘S speichert, Esc bricht ab</span>
    </div>
    <textarea class="schreibfeld" data-schreibfeld spellcheck="false"></textarea>
    <div class="schreibtisch-fuss">
      <button type="button" class="knopf knopf-haupt" data-speichern>Speichern</button>
      <button type="button" class="knopf" data-abbrechen>Abbrechen</button>
    </div>
  </section>`
}

/**
 * Die Seitenleiste zeigt den EIGENEN Bereich offen und die übrigen als
 * zugeklappte Gruppen. Alle Titel gleichzeitig waren eine Wand, in der der
 * aktuelle Eintrag unterging — und die Nachbarn eines Dokuments stehen fast
 * immer in seinem eigenen Bereich.
 */
function seitenleiste(dokumente, bereiche, dok, auf) {
  return `<aside class="leiste">
    <div class="leiste-innen">
      <a class="leiste-zurueck" href="${auf}index.html">← Übersicht</a>
      ${bereiche
        .map((b) => {
          const alle = dokumente.filter((d) => d.bereich === b.id)
          // ARCHIVIERTES steht hier nicht. Es hängt zwar unter seinem Bereich
          // (das ist richtig), aber die Leiste ist die Nachbarschaft, in der
          // man weiterliest — und in „Architektur" waren 3 von 7 Einträgen
          // Historie, die den heutigen Stand oft gerade NICHT beschreibt. Die
          // Bereichsseite zeigt es weiter, dort hinter einer eigenen Falte;
          // der Weg dorthin ist „Alle in … →" am Fuß der Gruppe.
          const eigene = alle.filter((d) => !d.archiviert)
          // Die eine Ausnahme: das Dokument, das gerade offen ist. Fehlte es,
          // stünde man in einer Liste ohne sich selbst und die Leiste hätte
          // keinen Bezug mehr zur Seite.
          const liste = alle.some((d) => d.archiviert && d.ziel === dok.ziel)
            ? [...eigene, alle.find((d) => d.ziel === dok.ziel)]
            : eigene
          if (!liste.length) return ''
          const hier = b.id === dok.bereich
          return `<details class="leiste-gruppe" style="--ton:${b.ton}"${hier ? ' open' : ''}>
            <summary><span>${escape(b.name)}</span><b>${eigene.length}</b></summary>
            <ul>${liste
              .map(
                (d) =>
                  `<li><a href="${auf}${escape(d.ziel)}"${d.ziel === dok.ziel ? ' class="hier" aria-current="page"' : ''}${
                    d.archiviert ? ' data-archiv="1"' : ''
                  }>${escape(d.titel)}${
                    d.archiviert ? '<span class="leiste-archiv">Archiv</span>' : ''
                  }</a></li>`,
              )
              .join('')}
            <li class="leiste-alle"><a href="${auf}${b.id}/index.html">Alle in ${escape(b.name)} →</a></li></ul>
          </details>`
        })
        .join('')}
    </div>
  </aside>`
}

export function dokumentSeite({
  dok,
  html,
  ueberschriften,
  dokumente,
  bereiche,
  nachAbs,
  roadmap,
  schriftLokal,
}) {
  const auf = hoch(dok.ziel)
  const bereich = bereiche.find((b) => b.id === dok.bereich)
  /*
   * Über dem Titel stehen KEINE Marken mehr.
   *
   * Dort standen fünf: „Entwurf", „In Arbeit", „Player", „20 min" und daneben
   * „Bearbeiten" — ein Zustand, eine Planung, eine Zuordnung, eine Kennzahl und
   * eine HANDLUNG, alle in derselben Größe und alle pillenförmig. Drei Register
   * in einer Reihe lassen sich nicht überfliegen: Man muss jede Marke lesen, um
   * zu wissen, ob sie etwas sagt oder etwas tut.
   *
   * Getrennt ist es einfach: Die Zeile über dem Titel trägt links den Weg
   * (Brotkrumen) und rechts die Werkzeuge. Alles Faktische steht in der
   * Kopftafel unter dem Titel — jede Angabe mit ihrem Etikett davor, und damit
   * benannt statt erraten.
   */

  const verwandt = (liste, wort) => {
    const eintraege = liste.map((a) => nachAbs.get(a)).filter(Boolean)
    if (!eintraege.length) return ''
    return `<div class="verwandt-block">
      <h4>${escape(wort)} (${eintraege.length})</h4>
      <ul>${eintraege
        .map(
          (d) =>
            `<li style="--ton:${bereiche.find((b) => b.id === d.bereich)?.ton}"><a href="${auf}${escape(d.ziel)}">${escape(d.titel)}</a></li>`,
        )
        .join('')}</ul>
    </div>`
  }

  const inhalt = `${kopfleiste(dok.ziel, bereiche)}
<div class="lesen">
  ${seitenleiste(dokumente, bereiche, dok, auf)}
  <main class="text" style="--ton:${bereich?.ton}">
    <!-- EINE Zeile, ZWEI Register: links wo man ist, rechts was man tun kann.
         Vorher standen dort außerdem Zustand, Phase und Lesezeit — drei
         Pillen, die aussahen wie Knöpfe und nebeneinander nicht zu
         unterscheiden waren. Fakten stehen jetzt ausschließlich in der
         Kopftafel unter dem Titel, Handlungen ausschließlich hier. -->
    <div class="dok-kopfzeile">
      <div class="brotkrumen">
        <a href="${auf}index.html">Übersicht</a><i>/</i>
        <a href="${auf}${dok.bereich}/index.html">${escape(bereich?.name ?? '')}</a>
      </div>
      ${werkzeuge(dok, roadmap)}
    </div>
    ${
      dok.archiviert
        ? `<p class="archiv-warnung"><b>Archiviert.</b> Erledigtes oder Verworfenes. Der Text
             beschreibt oft NICHT den heutigen Stand — als Implementierungsquelle ist er
             ungeeignet, als Begründung, warum etwas so wurde, oft die einzige Quelle.</p>`
        : ''
    }
    <article class="prosa" data-prosa>${nachDerUeberschrift(html, kopftafel(dok, roadmap))}</article>
    ${schreibtisch(dok)}
    ${verlaufBlock(dok)}
    <footer class="dok-fussnote">
      ${verwandt(dok.verweise, 'Zeigt auf')}
      ${verwandt(dok.rueckverweise, 'Wird genannt von')}
    </footer>
  </main>
  <nav class="inhalt" aria-label="Inhalt dieses Dokuments">
    <div class="inhalt-innen">
      <span class="inhalt-titel">Auf dieser Seite</span>
      <div class="fortschritt"><i data-fortschritt></i></div>
      <ul>${ueberschriften
        .map((u) => {
          // Die Titel kommen aus dem GERENDERTEN Markdown und sind damit schon
          // HTML-kodiert. Ein zweites `escape()` machte aus „Do's" ein sichtbares
          // „Do&#39;s" — also erst zurück in Text, dann einmal sauber kodieren.
          const roh = entkodiere(u.titel)
          return `<li class="e${u.ebene}"><a href="#${u.id}" title="${escape(roh)}">${escape(
            zusammenAmEnde(roh),
          )}</a></li>`
        })
        .join('')}</ul>
    </div>
  </nav>
</div>
${suchschicht()}`

  return huelle({
    titel: dok.titel,
    ziel: dok.ziel,
    klasse: 'seite-dokument',
    inhalt,
    schriftLokal,
    mermaid: /```mermaid/.test(dok.text),
  })
}

/* ── Mockups ──────────────────────────────────────────────────────────── */

export function mockupSeite({ mockups, bereiche, roadmap, schriftLokal }) {
  const aktuell = mockups.filter((m) => !m.archiv)
  const alt = mockups.filter((m) => m.archiv)

  const inhalt = `${kopfleiste('mockups.html', bereiche)}
<main class="uebersicht schmal">
  <section class="seiten-titel">
    <div class="brotkrumen"><a href="index.html">Übersicht</a><i>/</i><span>Mockups</span></div>
    <h1>Mockups${hinweis(
      'Die Mockups liegen in <code>docs/mockups/</code>; die Vorschaubilder nimmt der Generator beim Bauen mit einem Headless-Chrome auf.',
    )}</h1>
    <p>HTML-Mockups als Vorlage. Ein Klick öffnet das Mockup in einem neuen Tab.</p>
  </section>

  <section class="streifen">
    <div class="streifen-kopf"><h2>Aktuelle Vorlagen <span class="zahl">${aktuell.length}</span></h2></div>
    ${filterleiste(aktuell, { platzhalter: 'Mockups filtern …' })}
    <div class="mockup-gitter" data-karten>${nachDatum(aktuell)
      .map((m) => mockupKarte(m, '', roadmap))
      .join('\n')}</div>
  </section>

  ${
    alt.length
      ? `<section class="streifen">
    ${falte(
      'Archiv',
      alt.length,
      `<div class="mockup-gitter archiv-gitter">${alt.map((m) => mockupKarte(m, '', roadmap)).join('\n')}</div>`,
      { satz: 'Historische Mockups. Nicht als Vorlage nutzen.' },
    )}
  </section>`
      : ''
  }
</main>
${fussleiste()}
${suchschicht()}`

  return huelle({
    titel: 'Mockups',
    ziel: 'mockups.html',
    klasse: 'seite-mockups',
    inhalt,
    schriftLokal,
  })
}

/* ── Karte ────────────────────────────────────────────────────────────── */

export function kartenSeite({ dokumente, bereiche, schriftLokal }) {
  /*
   * Diese Seite hat keinen Fließtext, sondern eine FLÄCHE — also bekommt sie
   * den ganzen Viewport. Titel, Suche und Filter schweben als Glas darüber
   * statt darüber zu stehen: Jede Zeile Kopf ist eine Zeile weniger Graph, und
   * bei einem Graphen ist die Fläche der Inhalt.
   */
  const inhalt = `${kopfleiste('karte.html', bereiche)}
<main class="karten-vollflaeche">
  <div class="karte-fenster" data-karte-fenster>
    ${verweiskarte(dokumente, bereiche)}

    <div class="karte-hud hud-links">
      <div class="brotkrumen"><a href="index.html">Übersicht</a><i>/</i><span>Netz</span></div>
      <h1>Verweise${hinweis(
        'Jeder Punkt ist ein Dokument, seine Größe die Zahl seiner Verweise. Zeigen hebt die Nachbarschaft hervor, ein Klick hält sie fest, ein Doppelklick öffnet das Dokument. Die Lage rechnet ein Kräfte-Layout beim Bauen: Was aufeinander zeigt, rückt zusammen. Wer auf niemanden zeigt und von niemandem genannt wird, steht in der Ablage darunter. Ein gestrichelter Ring heißt: zu diesem Dokument gibt es ein Mockup.',
      )}</h1>
      <input type="search" class="filterfeld karten-suchfeld" placeholder="Hervorheben …" data-karte-suche autocomplete="off" />
      <div class="filterchips" data-karte-bereiche>
        ${bereiche
          .map(
            (b) =>
              `<button type="button" class="filterchip an" data-bereich="${b.id}" style="--ton:${b.ton}" title="${escape(b.name)} ein- und ausblenden"><i></i>${escape(b.name)}</button>`,
          )
          .join('')}
      </div>
      ${(() => {
        /*
         * Die zweite Achse ist im Graphen ein AUSWAHLFELD und keine Chipreihe:
         * Neun Systemteile unter sechs Bereichsfarben wären fünfzehn Pillen in
         * einem Kasten, der über dem Bild schwebt — der Filter verdeckte dann
         * das, wonach man filtert. Die Bereiche bleiben Chips, weil sie
         * zugleich die Legende der Farben sind; die Teile haben keine Farbe.
         *
         * Sie hebt hervor statt auszublenden: Ein Systemteil ohne seine
         * Nachbarn beantwortet die Frage nicht, die man an eine Verweiskarte
         * stellt.
         */
        const vorhanden = SYSTEMTEILE.filter((teil) =>
          dokumente.some((d) => (d.teile ?? []).includes(teil.id)),
        )
        return vorhanden.length < 2
          ? ''
          : `<span class="karte-teilwahl">
              <span class="filterwahl-name">Systemteil</span>
              <select class="wz-wahl" data-karte-teil aria-label="Systemteil hervorheben">
                <option value="alle">alle</option>
                ${vorhanden
                  .map((teil) => `<option value="${teil.id}">${escape(teil.name)}</option>`)
                  .join('')}
              </select>
            </span>`
      })()}
    </div>

    <div class="karten-steuer">
      <button type="button" class="karten-knopf" data-zoom="-1" aria-label="Verkleinern">−</button>
      <button type="button" class="karten-knopf" data-zoom="1" aria-label="Vergrößern">+</button>
      <button type="button" class="karten-knopf breit" data-zoom="0">Zurücksetzen</button>
      <button type="button" class="karten-knopf breit" data-vollbild>Vollbild</button>
    </div>
    <span class="karten-tipp">Doppelklick öffnet · Scrollen zoomt · Ziehen verschiebt</span>
  </div>
</main>
${suchschicht()}`
  return huelle({
    titel: 'Verweis-Netz',
    ziel: 'karte.html',
    klasse: 'seite-karte',
    inhalt,
    schriftLokal,
  })
}
