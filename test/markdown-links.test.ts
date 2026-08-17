// Markdown-Links: zeigt jeder Verweis noch dorthin, wo er hinzeigen soll?
//
// Die Doku dieses Projekts ist Arbeitsmaterial, keine Zierde — Coding-Agenten
// lesen die CLAUDE.md-Dateien und folgen von dort in den Code. Ein toter Link
// fällt niemandem auf: Die Datei rendert weiter, nur führt sie ins Nichts.
// Beim Anlegen dieses Wächters waren es 114 tote Links in 10 Dateien, aus drei
// Ursachen, die alle stumm bleiben:
//
//   1. Wurzel-relative Pfade in verschachtelten CLAUDE.md — `server/CLAUDE.md`
//      verwies auf `server/src/…`, was von `server/` aus `server/server/src/…`
//      ist. Mit 39 + 33 + 8 Treffern die größte Gruppe, und ausgerechnet in den
//      Dateien, die am häufigsten gelesen werden.
//   2. Der Umzug `docs/*.md` → `docs/<ordner>/*.md` (2026-08-04): `../src/…`
//      blieb stehen, richtig wäre seither `../../src/…`.
//   3. Die TypeScript-Migration (2026-08-11): `.js`-Endungen auf Dateien, die
//      es nur noch als `.ts` gibt.
//
// Repariert wurden sie am 2026-08-12 von Hand; dieser Test verhindert den
// Rückfall. Er prüft NUR die Existenz des Ziels — nicht, ob ein `#L123`-Anker
// noch auf die gemeinte Zeile zeigt. Das wäre schön, ginge aber nur, solange
// niemand die Datei umformatiert.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `docs/archive/` ist ausgenommen — und zwar ausdrücklich, nicht aus Bequemlichkeit.
 *
 * Ein Archivblatt beschreibt einen Code-Stand, den es nicht mehr gibt;
 * `renderer-plan.md` sagt in seinem eigenen Kopf: „Dieses Blatt ist Historie —
 * die Dateiverweise zeigen ins Leere." Sieben der dort verlinkten Dateien
 * (`deckscene.js`, `buildings.js`, `photoreal.js` …) wurden mit dem
 * Renderer-Labor gelöscht, `audiotracks.d.ts` mit der TypeScript-Migration. Es
 * gibt kein Ziel, auf das man sie umbiegen KÖNNTE, und sie auf die heutigen
 * Dateien zu richten behauptete eine Kontinuität, die es nicht gibt.
 *
 * Deckungsgleich mit der Ansage in docs/README.md („`archive/` ignorieren —
 * widerspricht oft dem Ist-Stand") und in der Wurzel-CLAUDE.md.
 */
const AUSGENOMMEN = ['docs/archive/']

/**
 * Alle VERSIONIERTEN Markdown-Dateien, wurzel-relativ.
 *
 * Bewusst `git ls-files` und kein Verzeichnis-Durchlauf: Das ist die präzise
 * Definition von „gehört zu diesem Repo" und lässt sich nicht von einer zweiten
 * Auscheckung im Baum täuschen. Genau daran ist die erste Fassung dieses Tests
 * gescheitert — ein Aufgaben-Chip legt Git-Worktrees unter `.claude/worktrees/`
 * an, und der Durchlauf prüfte die dortige KOPIE der Doku mit; der Test schlug
 * dadurch je nach Zustand des Arbeitsverzeichnisses an oder nicht. Nebenbei
 * fällt damit auch node_modules, dist/ und `server/daten/` weg, ohne dass eine
 * Ausschlussliste gepflegt werden muss.
 *
 * Der Preis: Eine noch nicht eingecheckte neue Datei wird nicht geprüft. Sie
 * wird es, sobald sie committet ist — und vorher gibt es nichts zu schützen.
 */
function markdownDateien(): string[] {
  const roh = execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: wurzel, encoding: 'utf8' })
  return roh.split('\0').filter(Boolean)
}

/**
 * Inline-Links `[text](ziel)` samt Bildern `![alt](ziel)` — beide treffen auf
 * dasselbe Muster. Referenz-Links (`[text][marke]`) und Spitzklammern
 * (`](<pfad>)`) kommen im Bestand nicht vor; käme eine Form dazu, bliebe sie
 * hier stumm unerkannt statt fälschlich zu scheitern.
 */
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** Ziele, die kein Pfad im Repo sind. */
const EXTERN = /^(?:https?:|mailto:|tel:|data:|#)/

/**
 * Codeblöcke fallen heraus: Was in einem Block steht, ist ein BEISPIEL und kein
 * Verweis — im gerenderten Markdown ist es nicht einmal anklickbar. Die Anleitung
 * zum Anlegen neuer Doku (`.claude/skills/doku-anlegen/`) zeigt genau so eine
 * Zeile mit einem erfundenen Dateinamen; auf eine echte Datei gerichtet wäre das
 * Beispiel eine Behauptung über ein anderes Dokument.
 *
 * Der Preis ist klein: Ein Link im Block, der ins Leere zeigt, bleibt
 * unbemerkt — er ist ohnehin kein Weg, den jemand geht.
 */
function ohneCodebloecke(text: string): string {
  let drin = false
  return text
    .split('\n')
    .map((zeile) => {
      if (/^\s{0,3}(```|~~~)/.test(zeile)) {
        drin = !drin
        return ''
      }
      return drin ? '' : zeile
    })
    .join('\n')
}

describe('Markdown-Links zeigen auf existierende Dateien', () => {
  const dateien = markdownDateien().filter((d) => !AUSGENOMMEN.some((a) => d.startsWith(a)))

  it('findet überhaupt Dateien (sonst prüft der Wächter nichts)', () => {
    // Ohne diese Probe wäre ein kaputter Sammler ein grüner Test: Er liefe über
    // eine leere Liste und meldete nie etwas. Beim Anlegen waren es 39 Dateien.
    expect(dateien.length).toBeGreaterThan(30)
    expect(dateien).toContain('CLAUDE.md')
    expect(dateien).toContain('DESIGN.md')
    expect(dateien).toContain('README.md')
    expect(dateien).toContain('server/CLAUDE.md')
    expect(dateien).toContain('src/studio/CLAUDE.md')
    expect(dateien).toContain('docs/README.md')
  })

  it('kein Link zeigt ins Leere', () => {
    // ALLE Fehler auf einmal melden, nicht den ersten: Wer eine Datei
    // verschiebt, reißt selten genau einen Link mit.
    const tot: string[] = []
    for (const datei of dateien) {
      const basis = join(wurzel, dirname(datei))
      const text = ohneCodebloecke(readFileSync(join(wurzel, datei), 'utf8'))
      for (const treffer of text.matchAll(LINK)) {
        const ziel = treffer[1] as string
        if (EXTERN.test(ziel)) continue
        const pfad = ziel.split('#')[0] as string
        if (!pfad) continue // reiner Anker auf dieselbe Datei
        if (!existsSync(resolve(basis, decodeURIComponent(pfad)))) tot.push(`${datei} → ${ziel}`)
      }
    }
    expect(tot, `Tote Links:\n  ${tot.join('\n  ')}`).toEqual([])
  })

  it('Links sind relativ zur Datei selbst, nicht zur Repo-Wurzel', () => {
    // Die Falle, die 80 der 114 Fehler verursacht hat: In server/CLAUDE.md sieht
    // `server/src/app.ts` richtig aus, ist aber von dort aus falsch. Der Test
    // oben fängt das ab — dieser hier nennt die Ursache beim Namen, damit die
    // Meldung erklärt, was zu tun ist.
    const verdaechtig: string[] = []
    for (const datei of dateien) {
      const basis = dirname(datei)
      if (basis === '.') continue // die Wurzel-Dateien dürfen so schreiben
      const text = ohneCodebloecke(readFileSync(join(wurzel, datei), 'utf8'))
      for (const treffer of text.matchAll(LINK)) {
        const ziel = treffer[1] as string
        if (EXTERN.test(ziel) || ziel.startsWith('.')) continue
        const pfad = (ziel.split('#')[0] as string).replace(/\/$/, '')
        // Auflösbar von der Wurzel, aber nicht vom eigenen Ordner? Dann ist es
        // ein wurzel-relativer Pfad an der falschen Stelle.
        if (pfad && existsSync(join(wurzel, pfad)) && !existsSync(resolve(wurzel, basis, pfad))) {
          verdaechtig.push(`${datei} → ${ziel}  (wurzel-relativ; gemeint ist wohl ${relative(basis, pfad).split(sep).join('/')})`)
        }
      }
    }
    expect(verdaechtig, `Wurzel-relative Links außerhalb der Repo-Wurzel:\n  ${verdaechtig.join('\n  ')}`).toEqual([])
  })
})
