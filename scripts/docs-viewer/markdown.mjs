/*
 * Markdown → HTML für den Viewer.
 *
 * Die eigentliche Arbeit ist nicht das Rendern (das macht `marked`), sondern
 * das UMSCHREIBEN DER LINKS. Die Dokumente liegen in `docs/`, die Seiten in
 * `docs/_site/` — jeder relative Verweis geht damit eine Ebene zu kurz. Drei
 * Sorten Ziel müssen dabei auseinandergehalten werden:
 *
 *   1. ein anderes Dokument   → auf dessen erzeugte Seite (bleibt im Viewer)
 *   2. eine Datei im Repo     → auf die Rohdatei (öffnet im Browser als Text)
 *   3. eine fremde Adresse    → unverändert, aber sichtbar als extern
 *
 * Ohne (1) klickt man sich aus dem Viewer heraus in eine rohe .md-Datei; ohne
 * (2) zeigen die vielen Verweise auf `src/…` ins Leere.
 */

import { Marked } from 'marked'
import { dirname, relative, resolve, join, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { WURZEL, DOCS } from './sammeln.mjs'

const SITE = join(DOCS, '_site')

/** Anker-Kennung aus einer Überschrift. Umlaute werden übertragen, nicht entfernt. */
export function anker(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[&<>"']/g, '')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'abschnitt'
  )
}

export function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ── Code einfärben ───────────────────────────────────────────────────────
 * Bewusst klein gehalten: Zeichenketten, Kommentare, Zahlen, Schlüsselwörter.
 * Eine echte Grammatik-Bibliothek wöge mehr als der ganze Viewer, und in
 * Konzept-Dokumenten stehen Ausschnitte, keine Programme. */

const SCHLUESSEL =
  /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|new|await|async|try|catch|throw|typeof|interface|type|extends|implements|public|private|null|undefined|true|false|this)\b/g

const ZIFFERN = 'ABCDEFGHIJ'

function faerbe(code, sprache) {
  const marken = []
  // Der Platzhalter steht zwischen zwei Steuerzeichen und trägt seinen Index
  // als GROSSBUCHSTABEN. Ziffern würde die Zahlen-Regel unten selbst wieder
  // einfärben, Kleinbuchstaben könnten zufällig ein Schlüsselwort bilden.
  const zuMarke = (n) => String(n).replace(/\d/g, (d) => ZIFFERN[Number(d)])
  const merke = (art, inhalt) => {
    marken.push('<span class="tok-' + art + '">' + inhalt + '</span>')
    return '\u0001' + zuMarke(marken.length - 1) + '\u0002'
  }

  let s = escape(code)
  if (sprache === 'json') {
    s = s.replace(/&quot;(?:[^&\\]|\\.)*?&quot;(?=\s*:)/g, (m) => merke('schl', m))
    s = s.replace(/&quot;(?:[^&\\]|\\.)*?&quot;/g, (m) => merke('str', m))
  } else {
    if (['bash', 'sh', 'shell', 'yaml', 'conf', 'nginx'].includes(sprache))
      s = s.replace(/(^|\s)(#[^\n]*)/g, (m, vor, k) => vor + merke('kom', k))
    s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => merke('kom', m))
    s = s.replace(/\/\/[^\n]*/g, (m) => merke('kom', m))
    s = s.replace(/(&#39;|&quot;|`)(?:\\.|(?!\1)[\s\S])*?\1/g, (m) => merke('str', m))
    s = s.replace(SCHLUESSEL, (m) => merke('schl', m))
  }
  s = s.replace(/\b\d+(?:[.,]\d+)?\b/g, (m) => merke('num', m))
  return s.replace(/\u0001([A-J]+)\u0002/g, (_, m) =>
    marken[Number(m.replace(/[A-J]/g, (c) => String(ZIFFERN.indexOf(c))))],
  )
}

/* ── Renderer ─────────────────────────────────────────────────────────── */

/**
 * @param dok      das Dokument, das gerendert wird (braucht `abs`, `ziel`, `text`)
 * @param nachAbs  Map absoluter Quellpfad → Dokument, für Verweise untereinander
 */
export function rendere(dok, nachAbs) {
  const ausgabeOrdner = dirname(join(SITE, dok.ziel))
  const ueberschriften = []
  const vergeben = new Map()

  const eindeutig = (id) => {
    const n = (vergeben.get(id) ?? 0) + 1
    vergeben.set(id, n)
    return n === 1 ? id : `${id}-${n}`
  }

  const wegAuf = (href) => {
    if (!href) return { href: '#', art: 'tot' }
    if (/^(https?:|mailto:|#)/.test(href))
      return { href, art: href.startsWith('#') ? 'intern' : 'extern' }
    const [pfad, fragment = ''] = href.split('#')
    let abs
    try {
      abs = resolve(dirname(dok.abs), decodeURI(pfad))
    } catch {
      abs = resolve(dirname(dok.abs), pfad)
    }
    const ziel = nachAbs.get(abs)
    const rest = fragment ? '#' + fragment : ''
    if (ziel) return { href: relative(ausgabeOrdner, join(SITE, ziel.ziel)) + rest, art: 'doc' }
    if (!existsSync(abs)) return { href, art: 'tot' }
    // Beiwerk aus docs/ (Bilder, HTML-Prototypen) liegt gespiegelt in der
    // Ausgabe — dorthin zeigen, nicht auf das Original daneben: Über den
    // Dev-Server ist /doku/ ein eigener Ast, aus dem `..` hinausführt.
    if (abs.startsWith(DOCS + '/') && !abs.endsWith('.md')) {
      const gespiegelt = join(SITE, relative(DOCS, abs))
      return { href: relative(ausgabeOrdner, gespiegelt) + rest, art: 'datei' }
    }
    const weg = relative(ausgabeOrdner, abs) || basename(abs)
    return { href: weg + rest, art: abs.startsWith(WURZEL) ? 'datei' : 'extern' }
  }

  const marked = new Marked({ gfm: true, breaks: false })

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inhalt = this.parser.parseInline(tokens)
        const id = eindeutig(anker(inhalt))
        if (depth >= 2 && depth <= 3)
          ueberschriften.push({ id, ebene: depth, titel: inhalt.replace(/<[^>]+>/g, '') })
        if (depth === 1) return `<h1 id="${id}">${inhalt}</h1>\n`
        return `<h${depth} id="${id}"><a class="ankerlink" href="#${id}" aria-label="Link zu diesem Abschnitt">#</a>${inhalt}</h${depth}>\n`
      },
      code({ text, lang }) {
        const sprache = (lang || '').split(/\s+/)[0]
        // Mermaid bleibt Quelltext; gezeichnet wird erst im Browser.
        if (sprache === 'mermaid')
          return `<div class="mermaid-huelle"><pre class="mermaid">${escape(text)}</pre></div>\n`
        const kennung = sprache ? `<span class="code-sprache">${escape(sprache)}</span>` : ''
        return `<figure class="codeblock">${kennung}<pre><code>${faerbe(text, sprache)}</code></pre></figure>\n`
      },
      link({ href, title, tokens }) {
        const inhalt = this.parser.parseInline(tokens)
        const { href: ziel, art } = wegAuf(href)
        const titelAttr = title ? ` title="${escape(title)}"` : ''
        if (art === 'extern')
          return `<a href="${escape(ziel)}" class="link-extern" target="_blank" rel="noopener"${titelAttr}>${inhalt}</a>`
        if (art === 'datei')
          return `<a href="${escape(ziel)}" class="link-datei"${titelAttr}>${inhalt}</a>`
        if (art === 'tot') return `<span class="link-tot" title="Ziel nicht gefunden">${inhalt}</span>`
        return `<a href="${escape(ziel)}"${titelAttr}>${inhalt}</a>`
      },
      image({ href, title, text }) {
        const { href: ziel } = wegAuf(href)
        const unterschrift = title || text
        return `<figure class="bild"><img src="${escape(ziel)}" alt="${escape(text || '')}" loading="lazy" />${
          unterschrift ? `<figcaption>${escape(unterschrift)}</figcaption>` : ''
        }</figure>`
      },
      table({ header, rows }) {
        const kopf = header.map((z) => `<th>${this.parser.parseInline(z.tokens)}</th>`).join('')
        const koerper = rows
          .map(
            (r) =>
              `<tr>${r.map((z) => `<td>${this.parser.parseInline(z.tokens)}</td>`).join('')}</tr>`,
          )
          .join('\n')
        return `<div class="tabelle-huelle"><table><thead><tr>${kopf}</tr></thead><tbody>${koerper}</tbody></table></div>\n`
      },
      blockquote({ tokens }) {
        return `<blockquote class="merksatz">${this.parser.parse(tokens)}</blockquote>\n`
      },
    },
  })

  // Ein YAML-Kopf (DESIGN.md) ist Inhalt, kein Beiwerk — er wird als Codeblock
  // gezeigt. Ohne diese Zeile zerlegt Markdown ihn in eine Linie plus einen
  // Absatz aus zusammengelaufenen Schlüssel-Wert-Paaren.
  const text = dok.text.replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/, '```yaml\n$1\n```\n')
  return { html: marked.parse(text), ueberschriften }
}
