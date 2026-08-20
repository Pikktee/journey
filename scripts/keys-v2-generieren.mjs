// Erzeugt `server/src/migrations/keys-v2.ts` aus der Abbildungstabelle.
//
// Die Abbildung der Start-Migration ist DIESELBE Tabelle wie im Code und keine
// zweite Liste (§4.3 des Englisch-Konzepts). Abgeschrieben würde sie am ersten
// Tag stimmen und am zweiten nicht mehr — also wird sie erzeugt, aus den Zeilen
// der Arten `json-feld`, `json-wert` und `schema-kennung` mit `welle = 1`.
//
// Lauf: `node scripts/keys-v2-generieren.mjs` (schreibt die Datei; der Diff ist
// die Gegenprobe). Ein Test hält sie danach gegen die Schema-Dateien.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..')
const zeilen = readFileSync(join(wurzel, 'docs/specs/abbildungstabelle.tsv'), 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map((z) => {
    const [ist, ziel, art, fundort, welle] = z.split('\t')
    return { ist, ziel, art, fundort, welle }
  })
  .filter((z) => z.welle === '1')

/** Welche Datei eine Zeile betrifft — aus dem Fundort, nicht geraten. */
function dateiVon(fundort) {
  const f = fundort.toLowerCase()
  if (f.includes('manifest.json') || f.includes('upload@2') || f.includes('schema/upload'))
    return 'manifest'
  // Der Körper von `PUT /api/tours/:id/edits` IST edits.json — die Tabelle führt
  // einige seiner Felder als `api-feld` statt als `json-feld` (etwa `typ`), und
  // ohne diese Zeile fiele genau das durch.
  if (f.includes('edits.json') || f.includes('edits@2') || f.includes('schema/edits'))
    return 'edits'
  if (f.includes('/edits')) return 'edits'
  if (f.includes('anreicherung.json') || f.includes('enrichment@2')) return 'enrichment'
  return null
}

const felder = { manifest: {}, edits: {}, enrichment: {} }
// Ein Nachtrag, den die Tabelle nicht führt: `videoMeta[].dauerS` heißt seit
// Welle 1 `durationS`. Der Typ (`VideoMeta`) ist Server-intern und gehört
// eigentlich in Welle 2 — er liegt aber IM CACHE, und ein Cache-Eintrag, dessen
// Feld der neue Code nicht findet, kostet je Video einen Transcode.
const NACHTRAG_ENRICHMENT = { dauerS: 'durationS' }
const werte = { manifest: {}, edits: {}, enrichment: {} }
const kennungen = {}

for (const z of zeilen) {
  if (z.art === 'schema-kennung') {
    if (z.ziel === 'entfällt') continue
    kennungen[z.ist] = z.ziel
    continue
  }
  const datei = dateiVon(z.fundort)
  if (!datei) continue
  if (z.art === 'json-feld' || z.art === 'api-feld') felder[datei][z.ist] = z.ziel
  // Ein Wert gehört zu EINEM Feld — der Fundort nennt es („edits.json
  // audio[].typ; tour.json audio[].type"). Genommen wird das Feld aus dem
  // Abschnitt DIESER Datei, nicht das erstbeste im Satz.
  if (z.art === 'json-wert' || z.art === 'api-wert') {
    const abschnitt = z.fundort
      .split(';')
      .map((t) => t.trim())
      .find((t) => dateiVon(t) === datei)
    const feld = abschnitt?.match(/(?:\[\])?\.(\w+)\s*$/)?.[1]
    if (!feld) continue
    ;(werte[datei][feld] ??= {})[z.ist] = z.ziel
  }
}

// Die Werte hängen am NEUEN Feldnamen: Die Migration benennt erst um und
// ersetzt dann. Am alten Namen nachgeschlagen liefe die Ersetzung ins Leere.
for (const datei of Object.keys(werte)) {
  const umbenannt = {}
  for (const [feld, paare] of Object.entries(werte[datei])) {
    umbenannt[felder[datei][feld] ?? feld] = paare
  }
  werte[datei] = umbenannt
}

// Die Alt-Kennungen `luhambo/*@1` gehören dazu: Die ältesten Touren tragen sie
// noch, und ohne diese Zeilen fielen genau die durch (§4.3).
for (const [alt, neu] of Object.entries({ ...kennungen })) {
  if (alt.startsWith('maptale/')) kennungen[alt.replace('maptale/', 'luhambo/')] = neu
}

const sortiert = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const tief = (o) =>
  Object.fromEntries(Object.entries(sortiert(o)).map(([k, v]) => [k, sortiert(v)]))

const kopf = `// ERZEUGT — nicht von Hand ändern.
//
// Quelle: docs/specs/abbildungstabelle.tsv (Zeilen mit welle=1 und den Arten
// json-feld, json-wert, schema-kennung). Neu erzeugen mit
// \`node scripts/keys-v2-generieren.mjs\`.
//
// Die Start-Migration (§4.3 des Englisch-Konzepts) bildet damit die Schlüssel
// der drei Dateien auf Platte ab — \`tour.json\` steht bewusst NICHT dabei: die
// wird nicht umgeschrieben, sondern neu gerendert.

/** Alte Schema-Kennung → neue (beide Präfixe, s. §4.3). */
export const SCHEMA_KENNUNGEN: Readonly<Record<string, string>> = ${JSON.stringify(sortiert(kennungen), null, 2)} as const

/** Feldnamen je Datei: alt → neu. */
export const FELDER = {
  manifest: ${JSON.stringify(sortiert(felder.manifest), null, 2).replace(/\n/g, '\n  ')},
  edits: ${JSON.stringify(sortiert(felder.edits), null, 2).replace(/\n/g, '\n  ')},
  enrichment: ${JSON.stringify(sortiert({ ...felder.enrichment, ...NACHTRAG_ENRICHMENT }), null, 2).replace(/\n/g, '\n  ')},
} as const

/**
 * Werte je Datei und FELD: alt → neu.
 *
 * Feldweise und nicht global, weil derselbe Wortlaut in zwei Feldern
 * Verschiedenes heißt — \`mode: 'rain'\` bleibt, \`typ: 'musik'\` wird \`music\`.
 * Geprüft wird gegen den NEUEN Feldnamen, denn die Felder wandern zuerst.
 */
export const WERTE = {
  manifest: ${JSON.stringify(tief(werte.manifest), null, 2).replace(/\n/g, '\n  ')},
  edits: ${JSON.stringify(tief(werte.edits), null, 2).replace(/\n/g, '\n  ')},
  enrichment: ${JSON.stringify(tief(werte.enrichment), null, 2).replace(/\n/g, '\n  ')},
} as const
`
const ziel = join(wurzel, 'server/src/migrations/keys-v2.ts')
writeFileSync(ziel, kopf)
// Durch Prettier schicken statt seine Regeln hier nachzubauen: Sonst fiele
// `npm run format:check` nach jedem Neuerzeugen um.
execFileSync('npx', ['prettier', '--write', ziel], { cwd: wurzel, stdio: 'ignore' })
console.log(
  `keys-v2.ts erzeugt: ${Object.keys(kennungen).length} Kennungen, ` +
    `${Object.keys(felder.manifest).length}/${Object.keys(felder.edits).length}/${Object.keys(felder.enrichment).length} Felder`,
)
