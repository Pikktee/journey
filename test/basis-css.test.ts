// Drift-Wächter für das Design-System: DESIGN.md ist die Quelle, src/basis.css
// die Ableitung. Dieselbe Bauart wie der Wächter für die Server-Kopie von
// handle.ts oder die TRAVEL_MODES-Liste — beide Seiten liegen in verschiedenen Dateien
// und müssen dasselbe sagen.
//
// Was er verhindert, ist der Befund, der zu Etappe 7 geführt hat: 4519 Zeilen
// Inline-CSS in neun HTML-Dateien, ZWEI Namenssysteme für dieselben Farben und
// rohe Hex-Werte in den Regeln, obwohl daneben Variablen definiert waren. Wer
// eines davon wieder anfängt, merkt es hier statt in einem halben Jahr.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// vite.config.js ist JS ohne Typdeklaration — der Wächter prüft das Verhalten
// des Plugins, nicht seine Signatur.
// @ts-expect-error — kein Typdeklarationsfile für die Vite-Konfiguration
import { GETEILTE_BLAETTER, basisZuerst } from '../vite.config.js'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const lies = (p: string): string => readFileSync(join(wurzel, p), 'utf8')

/** Alle TS/JS unter einem Verzeichnis — für die vom Skript gesetzten Variablen. */
function skripte(verzeichnis: string): string[] {
  return readdirSync(verzeichnis, { withFileTypes: true }).flatMap((eintrag) => {
    const pfad = join(verzeichnis, eintrag.name)
    if (eintrag.isDirectory()) return skripte(pfad)
    return /\.(ts|js)$/.test(eintrag.name) ? [pfad] : []
  })
}

const DESIGN = lies('DESIGN.md')
const BASIS = lies('src/basis.css')

/** Die HTML-Einstiege. `public/404.html` steht außerhalb des Builds — s. unten. */
const SEITEN = [
  'index.html',
  'galerie.html',
  'erlebnis.html',
  'studio.html',
  'konto.html',
  'profil.html',
  'admin.html',
  'datenschutz.html',
  'impressum.html',
]

/** Stilblätter, die die Tokens benutzen (aber nicht definieren). */
const BLAETTER = [
  'src/style.css',
  'src/rechtstext.css',
  'src/grundelemente.css',
  'src/werkzeug.css',
]

/** Ein flacher YAML-Abschnitt aus dem Kopf von DESIGN.md, Kommentare weg. */
function ausDesign(abschnitt: string): Record<string, string> {
  const kopf = DESIGN.split('---')[1] ?? ''
  const zeilen = kopf.split('\n')
  const start = zeilen.findIndex((z) => z.startsWith(`${abschnitt}:`))
  expect(start, `Abschnitt „${abschnitt}" fehlt im YAML-Kopf von DESIGN.md`).toBeGreaterThan(-1)
  const werte: Record<string, string> = {}
  for (const zeile of zeilen.slice(start + 1)) {
    if (/^\S/.test(zeile)) break
    // Der Kommentar beginnt bei ` #`, nicht bei `#` — sonst schnitte er jeden
    // Hex-Wert ab, und der Wächter prüfte nur noch die rgba-Farben.
    const ohneKommentar = zeile.replace(/\s+#(?!\w{3,8}"?\s*$).*$/, '')
    const treffer = ohneKommentar.match(/^\s{2}([\w-]+):\s*"?(.+?)"?\s*$/)
    if (treffer?.[1] && treffer[2] !== undefined) werte[treffer[1]] = treffer[2].trim()
  }
  return werte
}

/** `--name: wert;` aus einem Stilblatt sammeln. */
function eigenschaften(source: string): Record<string, string> {
  const aus: Record<string, string> = {}
  for (const [, name, wert] of source.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm))
    if (name && wert) aus[name] = wert.trim()
  return aus
}

/** Was `:root` in basis.css setzt. */
const TOKENS = eigenschaften(BASIS)

/** Ein Token, das es geben MUSS — sonst ist der Wächter selbst kaputt. */
function token(name: string): string {
  const wert = TOKENS[name]
  expect(wert, `${name} fehlt in src/basis.css`).toBeDefined()
  return wert ?? ''
}

/**
 * DESIGN.md-Name → CSS-Variable. Steht hier und nicht in basis.css, weil es die
 * Abbildung ZWISCHEN beiden ist; dieselbe Tabelle steht in DESIGN.md im
 * Abschnitt „Ein Namenssystem".
 */
const NAMEN: Record<string, string> = {
  primary: '--akzent',
  amber: '--akzent',
  secondary: '--akzent-2',
  coral: '--akzent-2',
  text: '--text',
  'on-surface': '--text',
  muted: '--text-gedaempft',
  faint: '--text-zart',
  bg: '--bg',
  surface: '--bg',
  'bg-deep': '--bg-tief',
  line: '--linie',
  topbar: '--topbar-bg',
  'topbar-border': '--rand',
  'on-cta': '--auf-akzent',
  'surface-1': '--fl-1',
  'surface-2': '--fl-2',
  'surface-3': '--fl-3',
  'border-strong': '--rand-hell',
  'text-2': '--text-2',
  'text-3': '--text-3',
  card: '--tafel',
  success: '--gruen',
  danger: '--rot',
  info: '--blau',
  'accent-violet': '--lila',
  warning: '--warn',
  glass: '--glas',
  'glass-border': '--glas-rand',
  paper: '--papier',
}

/** `#F59E0B` und `#f59e0b` sind dieselbe Farbe; `rgba(…)` normalisiert auf Kommaform. */
const gleich = (a: string, b: string): boolean =>
  a.toLowerCase().replace(/\s+/g, '') === b.toLowerCase().replace(/\s+/g, '')

describe('DESIGN.md ↔ src/basis.css', () => {
  it('trägt jede Farbe aus dem YAML-Kopf mit demselben Wert', () => {
    const farben = ausDesign('colors')
    expect(Object.keys(farben).length).toBeGreaterThan(20)
    for (const [name, wert] of Object.entries(farben)) {
      const variable = NAMEN[name]
      expect(variable, `Für „colors.${name}" fehlt der CSS-Name in NAMEN`).toBeDefined()
      const hat = token(variable ?? '')
      expect(
        gleich(hat, wert),
        `colors.${name}: DESIGN.md sagt ${wert}, basis.css sagt ${hat}`,
      ).toBe(true)
    }
  })

  it('trägt jede Radius-Stufe mit demselben Wert', () => {
    const stufen = ausDesign('rounded')
    expect(Object.keys(stufen)).toEqual(['sm', 'md', 'lg', 'card', 'xl', 'full'])
    for (const [name, wert] of Object.entries(stufen)) {
      const variable = name === 'card' ? '--radius-karte' : `--radius-${name}`
      const hat = token(variable)
      expect(
        gleich(hat, wert),
        `rounded.${name}: DESIGN.md sagt ${wert}, basis.css sagt ${hat}`,
      ).toBe(true)
    }
  })

  it('trägt Kopfleistenhöhe, Inhaltsbreite und Schatten aus DESIGN.md', () => {
    const masse = ausDesign('spacing')
    expect(gleich(token('--wrap'), masse.wrap ?? '')).toBe(true)
    expect(gleich(token('--topbar-h'), masse['topbar-h'] ?? '')).toBe(true)
    const tiefe = ausDesign('elevation')
    expect(gleich(token('--schatten'), tiefe.shadow ?? '')).toBe(true)
    expect(gleich(token('--fokus-ring'), tiefe['focus-ring'] ?? '')).toBe(true)
  })
})

describe('Ein Namenssystem', () => {
  it('lässt keine HTML-Datei eigene Farb-Tokens definieren', () => {
    // Genau das war der Befund: dieselben Farben, in neun Dateien nebeneinander
    // gepflegt. Erlaubt bleiben Maße und seitenspezifische Werte (--wrap,
    // --spur-x, --luft-band …) — die gehören der Seite, nicht der Marke.
    for (const datei of SEITEN) {
      const eigene = [...lies(datei).matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\()/gm)]
      expect(
        eigene.map((m) => m[1]),
        `${datei} definiert eigene Farb-Tokens — sie gehören nach src/basis.css`,
      ).toEqual([])
    }
  })

  it('schreibt keinen Token-Wert irgendwo sonst roh hin', () => {
    // Die zweite Hälfte des Befunds: `#10151d` und `#222b37` standen in den
    // Regeln, obwohl daneben `--fl-1` und `--rand` definiert waren.
    const werte = new Map(
      Object.entries(TOKENS)
        .filter(([, wert]) => /^#[0-9a-fA-F]{3,8}$/.test(wert))
        .map(([name, wert]) => [wert.toLowerCase(), name]),
    )
    for (const datei of [...SEITEN, ...BLAETTER]) {
      // Geprüft werden die CSS-REGELN, nicht das Markup: Ein Inline-SVG mit
      // `stop-color="#F59E0B"` ist eine Verlaufsdefinition im Dokument, kein
      // zweiter Ort für die Marke — und `fill` nimmt keine Variable, wenn das
      // SVG später als Data-URI oder Datei wandert.
      const regeln = datei.endsWith('.css')
        ? lies(datei)
        : [...lies(datei).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '').join('\n')
      // Data-URLs tragen ihre Farben als %23xxxxxx im Pfad — dort gibt es keine
      // Variablen, das ist kein Drift, sondern die Grenze des Formats.
      const ohneDatenUrls = regeln.replace(/url\("data:[^"]*"\)/g, '')
      for (const [wert, name] of werte) {
        const treffer = ohneDatenUrls.match(new RegExp(`${wert}\\b`, 'i'))
        expect(treffer, `${datei} schreibt ${wert} roh hin — dafür gibt es ${name}`).toBeNull()
      }
    }
  })

  it('lässt keine Akzentfarbe roh in einer Regel stehen', () => {
    // Der zweite Befund derselben Sorte, und der teurere: Nicht der EXAKTE
    // Token-Wert stand in den Regeln, sondern ein ZWILLING davon. Der Player
    // trug `#f8bb4b → #ef8c37` als Startknopf, dazu `rgba(245, 165, 36, …)` als
    // Schatten und `#171106` als Text darauf — drei Ambertöne, die es im
    // Namenssystem nicht gibt. Der Test oben griff nicht, weil er nur nach den
    // Token-Werten selbst sucht, und so driftete die einzige Seite ab, auf der
    // die Marke am größten steht.
    //
    // Geprüft wird deshalb die FAMILIE, nicht der Wert: Was warm und kräftig
    // ist (Farbton 15°–55°, Sättigung über 45 %), gehört in den Regeln aus
    // `var(--akzent)`, `var(--akzent-2)` oder `var(--auf-akzent)` zu kommen —
    // für Deckkraft über `color-mix(in srgb, var(--akzent) 35%, transparent)`.
    const warm = (r: number, g: number, b: number): boolean => {
      const max = Math.max(r, g, b) / 255
      const min = Math.min(r, g, b) / 255
      if (max === min) return false
      const l = (max + min) / 2
      const s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
      const rn = r / 255
      const gn = g / 255
      const bn = b / 255
      let h = 0
      if (max === rn) h = ((gn - bn) / (max - min)) % 6
      else if (max === gn) h = (bn - rn) / (max - min) + 2
      else h = (rn - gn) / (max - min) + 4
      h = (h * 60 + 360) % 360
      return h >= 15 && h <= 55 && s > 0.45
    }

    const funde = (datei: string): string[] => {
      const inhalt = lies(datei)
      const regeln = datei.endsWith('.css')
        ? inhalt
        : [...inhalt.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '').join('\n')
      const ohne = regeln.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, '')
      const treffer = new Set<string>()
      for (const [ganz, hex] of ohne.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const r = Number.parseInt((hex ?? '').slice(0, 2), 16)
        const g = Number.parseInt((hex ?? '').slice(2, 4), 16)
        const b = Number.parseInt((hex ?? '').slice(4, 6), 16)
        if (warm(r, g, b)) treffer.add(ganz)
      }
      for (const [ganz, r, g, b] of ohne.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g))
        if (warm(Number(r), Number(g), Number(b))) treffer.add(`${ganz})`)
      return [...treffer].sort()
    }

    // Der Player ist bereinigt und bleibt es.
    for (const datei of [
      'src/style.css',
      'src/grundelemente.css',
      'src/rechtstext.css',
      'src/werkzeug.css',
      'erlebnis.html',
    ])
      expect(
        funde(datei),
        `${datei} schreibt eine Akzentfarbe roh hin — var(--akzent)/var(--akzent-2) oder color-mix nehmen`,
      ).toEqual([])

    // Der Bestand: Studio, Konto, Profil, Admin und die Landing tragen dieselben
    // Zwillinge, teils als eigene Aufhellungen auf Akzentflächen. Sie stehen
    // hier als ZAHL und nicht als Freibrief — die Liste darf schrumpfen, nicht
    // wachsen. Wer eine Seite anfasst, räumt sie mit auf.
    const bestand: Record<string, number> = {
      'index.html': 4,
      'studio.html': 13,
      'konto.html': 4,
      'profil.html': 3,
      'admin.html': 3,
    }
    for (const [datei, erlaubt] of Object.entries(bestand)) {
      const anzahl = funde(datei).length
      expect(
        anzahl,
        `${datei} hat jetzt ${anzahl} rohe Akzentfarben statt ${erlaubt} — die Bestandsliste darf nur kleiner werden`,
      ).toBeLessThanOrEqual(erlaubt)
    }
  })

  it('zeigt den Fokus auf genau eine Art je Element', () => {
    // Der Befund: Ein Textfeld im Studio trug DREI gleichzeitige Signale —
    // amber gefärbter Rand, 2px-Outline mit Abstand daneben und eine dunklere
    // Fläche. Die Outline stammte aus der allgemeinen Regel, der Rand aus der
    // Feld-Regel, und beide trafen zu. DESIGN.md kennt seither zwei Fälle:
    // Rand vorhanden → Rand + `--fokus-ring`, kein Rand → Outline mit 2px.
    //
    // Geprüft werden die zwei Dinge, die man beim nächsten Mal falsch macht:
    // ein anderer Offset (er war einmal 2px, einmal 3px, einmal -2px) und ein
    // selbst gemischter Halo statt des Tokens.
    const OFFSET_AUSNAHMEN = [
      // Beide beschneiden ihren Überstand (`overflow: hidden` bzw. bündige
      // Panel-Spalte) — außen läge die Outline unter der Kante.
      '.karte-haupt:focus-visible',
      '.insp-info summary:focus-visible',
    ]
    for (const datei of [...SEITEN, ...BLAETTER, 'public/404.html']) {
      const inhalt = lies(datei)
      const regeln = datei.endsWith('.css')
        ? inhalt
        : [...inhalt.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '').join('\n')
      const ohneKommentare = regeln.replace(/\/\*[\s\S]*?\*\//g, '')

      for (const [block] of ohneKommentare.matchAll(/[^{}]*:focus[^{}]*\{[^}]*\}/g)) {
        if (!/outline-offset/.test(block)) continue
        const offset = block.match(/outline-offset:\s*(-?[\d.]+px)/)?.[1]
        const negativErlaubt = OFFSET_AUSNAHMEN.some((a) => block.includes(a.split(':')[0] ?? ''))
        expect(
          offset === '2px' || (negativErlaubt && offset === '-2px'),
          `${datei}: outline-offset ${offset} — DESIGN.md sagt 2px (nach innen nur, wo der Überstand beschnitten wird)`,
        ).toBe(true)
      }

      // Ein Halo darf nur aus dem Token kommen. Selbst gemischt lief er schon
      // dreifach auseinander: 15 %, 22 % und 55 % Amber für dieselbe Sache.
      for (const [block] of ohneKommentare.matchAll(/[^{}]*:focus[^{}]*\{[^}]*\}/g)) {
        const schatten = block.match(/box-shadow:\s*([^;]+);/)?.[1]?.trim()
        if (!schatten || schatten === 'none') continue
        expect(
          schatten.includes('var(--fokus-ring)'),
          `${datei}: eigener Fokus-Schatten „${schatten}" — var(--fokus-ring) nehmen`,
        ).toBe(true)
      }
    }
  })

  it('benutzt keine Variable, die es nicht gibt', () => {
    // Zwei solche Stellen gab es: `var(--text-3)` im Passwortfeld (das
    // Augen-Icon erbte deshalb die Textfarbe) und `var(--ok, #56c271)` im
    // Studio — eine fünfte Grünstufe, die niemand definiert hatte.
    const quellen = [...SEITEN, ...BLAETTER, 'src/basis.css', 'public/404.html']
    const namen = (source: string, muster: RegExp): string[] =>
      [...source.matchAll(muster)].map((m) => m[1]).filter((n): n is string => Boolean(n))

    const definiert = new Set<string>()
    for (const datei of quellen)
      for (const n of namen(lies(datei), /(--[\w-]+)\s*:/g)) definiert.add(n)
    // Vom Skript gesetzte Variablen (Zoom der Zeitleiste, Fortschrittsbalken,
    // Tastaturhöhe der App): Sie stehen im TS/JS, nicht im CSS — mal als
    // `setProperty('--x', …)`, mal als `style="--x: …"` in einem Template.
    for (const datei of skripte(join(wurzel, 'src'))) {
      const quelle = readFileSync(datei, 'utf8')
      for (const n of namen(quelle, /setProperty\(\s*'(--[\w-]+)'/g)) definiert.add(n)
      for (const n of namen(quelle, /(--[\w-]+):\s*\$\{/g)) definiert.add(n)
    }

    for (const datei of quellen) {
      // Kommentare weg: Eine Erklärung darf den Namen nennen, den sie erklärt.
      const inhalt = lies(datei)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
      const benutzt = namen(inhalt, /var\((--[\w-]+)/g)
      const fehlend = [...new Set(benutzt)].filter((n) => !definiert.has(n))
      expect(fehlend, `${datei} liest Variablen, die nirgends gesetzt werden`).toEqual([])
    }
  })
})

describe('Die geteilten Blätter erreichen die Seiten', () => {
  it('bindet basis.css in jeden Einstieg ein', () => {
    for (const datei of SEITEN) {
      const inhalt = lies(datei)
      const direkt = inhalt.includes('/src/basis.css')
      // Impressum und Datenschutz ziehen sie über rechtstext.css herein: Beide
      // kommen bewusst ohne JS aus und sollen bei EINEM Stylesheet bleiben.
      const ueberRechtstext =
        inhalt.includes('/src/rechtstext.css') && lies('src/rechtstext.css').includes('basis.css')
      expect(direkt || ueberRechtstext, `${datei} bindet die Marken-Tokens nicht ein`).toBe(true)
    }
  })

  it('hält public/404.html von Hand auf denselben Werten', () => {
    // Sie liegt außerhalb des Builds — eine Fehlerseite muss auch dann stehen,
    // wenn genau das Bundle fehlt, das sie melden soll. Der Preis ist eine
    // zweite Kopie der Werte, und die prüft dieser Test.
    const seite = lies('public/404.html')
    const eigene: Record<string, string> = Object.fromEntries(
      [...seite.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], (m[2] ?? '').trim()]),
    )
    // Die Fehlerseite trägt nur einen Teil der Tokens; geprüft wird, was sie hat.
    const geprueft = Object.keys(eigene).filter((name) => TOKENS[name])
    expect(geprueft.length, '404.html trägt gar keine Marken-Tokens mehr').toBeGreaterThan(4)
    for (const name of geprueft) {
      expect(
        gleich(eigene[name] ?? '', token(name)),
        `404.html: ${name} ist ${eigene[name]}, basis.css sagt ${TOKENS[name]}`,
      ).toBe(true)
    }
    // Und sie darf keinen Verweis auf ein gehashtes Asset tragen.
    expect(seite).not.toContain('/src/basis.css')
  })

  it('lädt die Blätter in der Reihenfolge, in der sie gelten müssen', () => {
    // Die Reihenfolge ist keine Kosmetik: `.km-eintrag` aus grundelemente.css
    // überschreibt bewusst den Werkzeug-Knopf.
    for (const datei of ['studio.html', 'admin.html']) {
      const inhalt = lies(datei)
      const stellen = GETEILTE_BLAETTER.map((b: string) => inhalt.indexOf(`/src/${b}.css`))
      expect(
        stellen.every((s: number) => s > -1),
        `${datei} bindet nicht alle drei Blätter ein`,
      ).toBe(true)
      expect(
        [...stellen].sort((a: number, b: number) => a - b),
        `${datei}`,
      ).toEqual(stellen)
      // Und alle vor dem Stilblock der Seite.
      expect(Math.max(...stellen)).toBeLessThan(inhalt.indexOf('<style>'))
    }
  })
})

describe('basisZuerst() (vite.config.js)', () => {
  // Der Schritt, der nach dem Bauen die Reihenfolge wiederherstellt. Vite hängt
  // gebautes CSS ans ENDE des <head> — im Dev fällt das nicht auf, in
  // Produktion schlägt die Basis dann alles, was die Seite anders macht.
  const hook = basisZuerst().transformIndexHtml.handler
  const bundle = {
    'assets/a.css': { source: ':root{--blatt-basis:1}' },
    'assets/b.css': { source: ':root{--blatt-werkzeug:1}' },
    'assets/c.css': { source: ':root{--blatt-grundelemente:1}' },
    'assets/d.css': { source: '.irgendwas{color:red}' },
  }

  it('zieht die Verweise vor den Stilblock der Seite', () => {
    const html = `<head>\n  <style>\n    .x { color: red }\n  </style>\n  <link rel="stylesheet" href="/assets/a.css">\n</head>`
    const aus = hook(html, { bundle })
    expect(aus.indexOf('/assets/a.css')).toBeLessThan(aus.indexOf('<style>'))
  })

  it('bringt die drei Blätter in ihre Reihenfolge', () => {
    const html =
      `<head>\n  <style>.x{color:red}</style>\n` +
      `  <link rel="stylesheet" href="/assets/c.css">\n` +
      `  <link rel="stylesheet" href="/assets/a.css">\n` +
      `  <link rel="stylesheet" href="/assets/d.css">\n` +
      `  <link rel="stylesheet" href="/assets/b.css">\n</head>`
    const aus = hook(html, { bundle })
    const stelle = (n: string): number => aus.indexOf(`/assets/${n}.css`)
    expect(stelle('a')).toBeLessThan(stelle('b'))
    expect(stelle('b')).toBeLessThan(stelle('c'))
    // Was kein Blatt ist, bleibt hinten — aber immer noch vor dem <style>.
    expect(stelle('c')).toBeLessThan(stelle('d'))
    expect(stelle('d')).toBeLessThan(aus.indexOf('<style>'))
  })

  it('lässt sich vom Wort <style> in einem Kommentar nicht täuschen', () => {
    // Genau das ist passiert: Die Erklärung über dem Verweis nannte das Wort,
    // die Links landeten IM Kommentar, und die Seite kam ganz ohne Stylesheet.
    // Sichtbar war das nur im gebauten Stand.
    const html =
      `<head>\n  <!-- steht vor dem <style>-Block -->\n  <style>.x{color:red}</style>\n` +
      `  <link rel="stylesheet" href="/assets/a.css">\n</head>`
    const aus = hook(html, { bundle })
    expect(aus).toContain('<!-- steht vor dem <style>-Block -->')
    expect(aus.indexOf('/assets/a.css')).toBeGreaterThan(aus.indexOf('-->'))
    // Der ECHTE Stilblock, nicht das Wort im Kommentar.
    expect(aus.indexOf('/assets/a.css')).toBeLessThan(aus.indexOf('<style>.x'))
  })
})
