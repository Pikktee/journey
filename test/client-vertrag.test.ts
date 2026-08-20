// Der Client hält den Vertrag mit dem Server ein — und mit seiner eigenen Seite.
//
// Drei Nähte, die kein Compiler sieht und die am 2026-08-20 alle drei
// gleichzeitig gerissen sind (Welle 1 der Englisch-Migration, Befunde in
// docs/specs/welle-1-stand.md):
//
//   1. ADRESSEN. `src/admin/api.ts` zeigte vollständig auf Pfade, die es nicht
//      mehr gab. Die Verwaltung war tot, alle 957 Tests grün.
//   2. DOM-KENNUNGEN. `studio.ts` suchte `library`, im HTML stand `bibliothek`.
//      Das Modul starb beim Start, die Seite zeigte ewig ihre Ladekacheln.
//   3. VERTRAGSWERTE IM MARKUP. `<option value="nutzer">` gegen ein Schema, das
//      nur noch `user` kennt: 400 bei jedem Anlegen eines Kontos.
//
// Alle drei sind mechanisch prüfbar, und genau das tut diese Datei. Sie liest
// den Server als TEXT (`server/` ist eine eigene tsconfig-Welt, ein Import
// scheiterte an TS7016) — dieselbe Bauart wie der Vhost-Abgleich in
// test/routen.test.ts.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const lies = (p: string): string => readFileSync(join(wurzel, p), 'utf8')

/** Alle Dateien unter `ordner`, die auf eine der Endungen passen. */
function dateien(ordner: string, endungen: readonly string[]): string[] {
  const gefunden: string[] = []
  const gehe = (rel: string): void => {
    for (const eintrag of readdirSync(join(wurzel, rel), { withFileTypes: true })) {
      const p = `${rel}/${eintrag.name}`
      if (eintrag.isDirectory()) gehe(p)
      else if (endungen.some((e) => eintrag.name.endsWith(e))) gefunden.push(p)
    }
  }
  gehe(ordner)
  return gefunden
}

const HTML_SEITEN = [
  'index.html',
  'erlebnis.html',
  'studio.html',
  'galerie.html',
  'profil.html',
  'konto.html',
  'admin.html',
  'feedback.html',
].filter((d) => existsSync(join(wurzel, d)))

// ————————————————————————————————————————————————————————————————
// 1. Adressen: Jeder Aufruf trifft eine registrierte Route
// ————————————————————————————————————————————————————————————————

/** `/api/tours/:id/media` → `/api/tours/:x/media`; Template-Literale werden zu `:x`. */
function normPfad(p: string): string {
  return p
    .replace(/\$\{[^}]*\}/g, ':x')
    .replace(/\/:[a-zA-Z]+/g, '/:x')
    .split('?')[0]!
    .replace(/\/$/, '')
}

/**
 * Trifft der Aufruf die Route?
 *
 * Ein Aufrufpfad kann einen Query-Teil im Template tragen
 * (`/api/admin/audit-log${seit ? `?since=…` : ''}`). Verschachtelte
 * Template-Ausdrücke lassen sich nicht sauber normalisieren, deshalb gilt hier
 * der Teil VOR dem ersten `$` als Präfix: Er muss eine Route sein oder auf
 * einer enden.
 */
function trifft(pfad: string, routen: ReadonlySet<string>): boolean {
  if (routen.has(pfad)) return true
  const praefix = (pfad.split('$')[0] ?? '').replace(/\/$/, '')
  return praefix.length > 5 && routen.has(praefix)
}

/** Die bei Fastify registrierten Pfade, aus dem Quelltext gelesen. */
function serverRouten(): Set<string> {
  const routen = new Set<string>()
  for (const f of [...dateien('server/src/routes', ['.ts']), 'server/src/app.ts']) {
    if (!existsSync(join(wurzel, f))) continue
    for (const m of lies(f).matchAll(/['"`](\/api\/[a-zA-Z0-9/:._-]+)['"`]/g))
      routen.add(normPfad(m[1] ?? ''))
  }
  return routen
}

/** Jeder Pfad, den Web oder Skripte anfassen — mit Fundort für die Fehlermeldung. */
function clientPfade(): { datei: string; zeile: number; pfad: string }[] {
  const treffer: { datei: string; zeile: number; pfad: string }[] = []
  const quellen = [...dateien('src', ['.ts']), ...dateien('scripts', ['.mjs', '.ts'])]
  for (const f of quellen) {
    const s = lies(f)
    for (const m of s.matchAll(
      /(?:fetch|anfrage[A-Za-z]*|api)\s*(?:<[^>]*>)?\(\s*(?:[a-zA-Z.]+\s*,\s*)?[`'"]([^`'"]+)[`'"]/g,
    )) {
      const roh = m[1] ?? ''
      // Nur echte API-Adressen: absolute Pfade unter /api, oder relative, die
      // über den BASIS-Präfix der Client-Module dorthin zeigen.
      if (!roh.startsWith('/')) continue
      const voll = roh.startsWith('/api') ? roh : `/api${roh}`
      if (!voll.startsWith('/api/')) continue
      treffer.push({
        datei: f,
        zeile: s.slice(0, m.index).split('\n').length,
        pfad: normPfad(voll),
      })
    }
  }
  return treffer
}

describe('Client-Adressen gegen die Server-Routen', () => {
  it('ruft nur Pfade auf, die der Server registriert', () => {
    const routen = serverRouten()
    expect(routen.size, 'keine Route gefunden — liest der Scanner noch mit?').toBeGreaterThan(50)
    const tot = clientPfade().filter((t) => !trifft(t.pfad, routen))
    expect(
      tot.map((t) => `${t.datei}:${t.zeile} → ${t.pfad}`),
      'Diese Adressen gibt es serverseitig nicht (mehr).',
    ).toEqual([])
  })
})

// ————————————————————————————————————————————————————————————————
// 2. DOM-Kennungen: Jeder Selektor findet sein Element
// ————————————————————————————————————————————————————————————————

/** Die Module, die eine Seite lädt — samt ihrer relativen Importe, transitiv. */
function moduleDerSeite(html: string): string[] {
  const start = [...html.matchAll(/(?:src|from)=["']\/src\/([^"']+)["']/g)].map(
    (m) => `src/${m[1]}`,
  )
  const inline = [...html.matchAll(/from ['"]\/src\/([^'"]+)['"]/g)].map((m) => `src/${m[1]}`)
  const gesehen = new Set<string>()
  const offen = [...start, ...inline]
  while (offen.length) {
    const f = offen.pop()
    if (f === undefined) continue
    if (gesehen.has(f) || !existsSync(join(wurzel, f))) continue
    gesehen.add(f)
    for (const m of lies(f).matchAll(/from ['"]([^'"]+)['"]/g)) {
      const ziel = m[1] ?? ''
      if (!ziel.startsWith('.')) continue
      const abs = resolve(dirname(join(wurzel, f)), ziel).slice(wurzel.length + 1)
      offen.push(abs.replace(/\.js$/, '.ts'))
    }
  }
  return [...gesehen]
}

/** `$('foo')`, `$<HTMLInputElement>('foo')`, `getElementById('foo')`. */
function selektoren(quelle: string): { id: string; zeile: number }[] {
  const treffer: { id: string; zeile: number }[] = []
  for (const m of quelle.matchAll(
    /(?:\$(?:<[^>]*>)?|getElementById)\(\s*['"]([a-z][a-zA-Z0-9-]*)['"]\s*\)/g,
  ))
    treffer.push({ id: m[1] ?? '', zeile: quelle.slice(0, m.index).split('\n').length })
  return treffer
}

describe('DOM-Kennungen gegen das Markup', () => {
  for (const seite of HTML_SEITEN) {
    it(`${seite}: jeder Selektor ihrer Module findet ein Element`, () => {
      const html = lies(seite)
      const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1] ?? ''))
      const module = moduleDerSeite(html)
      // Was ein Modul selbst ins DOM schreibt, steht in keiner HTML-Datei —
      // `id="neu-leer-hinweis"` entsteht in einem Template-String. Diese
      // Kennungen zählen wie die des Markups, sonst meldet der Wächter jede
      // dynamisch gebaute Bühne.
      for (const modul of module)
        for (const m of lies(modul).matchAll(/\bid=["']([^"'$]+)["']/g)) ids.add(m[1] ?? '')
      const fehlend: string[] = []
      for (const modul of module) {
        for (const { id, zeile } of selektoren(lies(modul))) {
          // Ein Modul kann auf mehreren Seiten laufen und dort Elemente suchen,
          // die es nur woanders gibt — deshalb zählt nur, was KEINE Seite hat.
          if (ids.has(id)) continue
          if (HTML_SEITEN.some((s) => new RegExp(`id=["']${id}["']`).test(lies(s)))) continue
          if (module.some((m) => new RegExp(`id=["']${id}["']`).test(lies(m)))) continue
          fehlend.push(`${modul}:${zeile} sucht #${id}`)
        }
      }
      expect(fehlend, 'Diese Elemente gibt es in keiner HTML-Datei.').toEqual([])
    })
  }
})

// ————————————————————————————————————————————————————————————————
// 3. Vertragswerte im Markup: gegen die Abbildungstabelle
// ————————————————————————————————————————————————————————————————

/**
 * Die Wellen, deren Umbenennungen im Code stehen.
 *
 * Wächst mit dem Vorhaben: Wer Welle 2 baut, trägt die 2 hier ein — im selben
 * Commit wie `status` und `stand` des Konzepts. Ohne diesen Handgriff prüft
 * der Wächter die neue Welle nicht, und das ist die einzige Stelle, an der er
 * still zu wenig tut.
 */
const GEBAUTE_WELLEN = new Set(['1', '2'])

/**
 * Ist-Werte aus gebauten Wellen: Wörter, die im Markup nichts mehr zu suchen
 * haben, weil der Server sie nicht mehr kennt.
 *
 * Warum die Tabelle und keine Heuristik: Der erste Anlauf verglich die id des
 * `<select>` mit dem Feldnamen des Server-Schemas — und übersah genau den
 * echten Fehler, weil die id deutsch ist (`kd-rolle`) und das Feld englisch
 * (`role`). Die Abbildungstabelle kennt beide Seiten; sie ist die Quelle, aus
 * der ohnehin jede Welle arbeitet.
 */
function veralteteWerte(): Map<string, string> {
  const nach = new Map<string, string>()
  const [, ...zeilen] = lies('docs/specs/abbildungstabelle.tsv').trim().split('\n')
  for (const zeile of zeilen) {
    const [ist, ziel, art, , welle] = zeile.split('\t')
    if (!ist || !ziel || !art?.endsWith('-wert')) continue
    if (welle === undefined || !GEBAUTE_WELLEN.has(welle)) continue
    if (ist === ziel) continue // „bleibt“-Zeilen und schon englische Werte
    nach.set(ist, ziel)
  }
  return nach
}

/**
 * Attribute, deren Werte NICHT zum Vertrag gehören, obwohl sie so heißen.
 *
 * Drei Homonyme, und jedes ist genau der Fall, für den die Abbildungstabelle
 * eine Fundort-Spalte hat: `data-spur="musik"` ist die Bahn der Zeitleiste
 * (Welle 4), nicht der Ton-Typ `audio[].typ`; `data-wlevel="mittel"` ist die
 * Wetterstärke des Players (Welle 5), nicht das Kamera-Preset; und
 * `data-modus="warteliste"` schaltet die Anmeldebühne um (Welle 4), es ist
 * kein Mail-Vorlagen-Schlüssel. Wer eine Zeile ergänzt, prüft vorher, ob der
 * Wert wirklich nie zum Server geht.
 */
const KEINE_VERTRAGSWERTE = new Set(['data-spur', 'data-wlevel', 'data-modus'])

describe('Vertragswerte im Markup', () => {
  it('kein value- oder data-Attribut trägt einen Wert aus einer gebauten Welle', () => {
    const alt = veralteteWerte()
    expect(alt.size, 'keine Wert-Zeilen gefunden — steht die Tabelle noch?').toBeGreaterThan(20)
    const verdacht: string[] = []
    for (const seite of HTML_SEITEN) {
      const s = lies(seite)
      for (const m of s.matchAll(/\s(value|data-[a-z-]+)=["']([^"']+)["']/g)) {
        if (KEINE_VERTRAGSWERTE.has(m[1] ?? '')) continue
        const ziel = alt.get(m[2] ?? '')
        if (!ziel) continue
        const zeile = s.slice(0, m.index).split('\n').length
        verdacht.push(`${seite}:${zeile} trägt "${m[2]}" — der Server kennt nur "${ziel}"`)
      }
    }
    expect(
      verdacht,
      'Diese Werte lehnt der Server ab (400) oder vergleicht sie ins Leere.',
    ).toEqual([])
  })
})
