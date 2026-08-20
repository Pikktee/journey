// Start-Migration: die JSON-Dateien im Datenordner auf Welle 1
// ([konzept_codebase_english_refactoring.md](../../../docs/concepts/konzept_codebase_english_refactoring.md) §4.3).
//
// **Warum im Server und nicht als Skript unter `scripts/`.** Auf dem VPS läuft
// nur die API im Container, die Daten liegen unter `/srv/maptale/daten`; jede
// Dev-Instanz, jede Smoke-Instanz (`MAPTALE_DATEN_DIR`) und jeder Snapshot von
// vor Welle 1 brauchen dasselbe Werkzeug. Und zwischen `docker compose up` des
// neuen Images und einem Skriptlauf läse der neue Code alte Schlüssel.
//
// **Das ist kein Rückwärtsleser.** Sie liest die alte Form genau einmal, in
// Ruhe, vor dem ersten Request — und schreibt sie um. Danach gibt es nur noch
// eine Form.
//
// **`daten/.schema` ist eine LEITER, kein Schalter** — wie `user_version`.
// Fehlt der Marker, gilt Stand 1. Wird die Welle später in Teilschritte
// gebrochen, bringt jeder seinen eigenen Stand mit; ein Schalter liefe beim
// zweiten Schritt gegen Daten, deren Stand er nicht kennt.
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FELDER, SCHEMA_KENNUNGEN, WERTE } from './keys-v2.js'

/** Stand, den diese Fassung herstellt. */
export const DATEN_STAND = 2

const MARKER = '.schema'
const MANIFEST = 'original/manifest.json'
const EDITS = 'edits.json'
const ANREICHERUNG_ALT = 'anreicherung.json'
const ENRICHMENT = 'enrichment.json'

type Datei = keyof typeof FELDER

/** JSON-Wert mit umbenannten Schlüsseln und Werten — rekursiv, ohne Sonderfälle. */
export function bildeAb(wert: unknown, datei: Datei): unknown {
  if (Array.isArray(wert)) return wert.map((x) => bildeAb(x, datei))
  if (!wert || typeof wert !== 'object') return wert
  const felder = FELDER[datei] as Record<string, string>
  const werte = WERTE[datei] as Record<string, Record<string, string>>
  const neu: Record<string, unknown> = {}
  for (const [schluessel, inhalt] of Object.entries(wert as Record<string, unknown>)) {
    const name = felder[schluessel] ?? schluessel
    const abgebildet = bildeAb(inhalt, datei)
    // Werte hängen am FELD: `mode: 'rain'` bleibt, `type: 'musik'` wird `music`.
    neu[name] =
      typeof abgebildet === 'string' ? (werte[name]?.[abgebildet] ?? abgebildet) : abgebildet
  }
  return neu
}

/** Schema-Kennung nachziehen; unbekannte bleiben stehen (und fallen später auf). */
function mitKennung(objekt: Record<string, unknown>): Record<string, unknown> {
  const alt = objekt['schema']
  if (typeof alt === 'string' && SCHEMA_KENNUNGEN[alt]) objekt['schema'] = SCHEMA_KENNUNGEN[alt]
  return objekt
}

/** Datei lesen, abbilden, atomar zurückschreiben. Fehlt sie, passiert nichts. */
async function migriereDatei(
  pfad: string,
  datei: Datei,
  nachbearbeiten?: (o: Record<string, unknown>) => void,
  zielPfad = pfad,
): Promise<boolean> {
  let roh: string
  try {
    roh = await readFile(pfad, 'utf8')
  } catch {
    return false
  }
  const objekt = mitKennung(bildeAb(JSON.parse(roh), datei) as Record<string, unknown>)
  nachbearbeiten?.(objekt)
  // Schreiben in `.neu`, dann `rename` — ein Abbruch mitten im Schreiben darf
  // keine halbe Datei hinterlassen.
  await writeFile(`${zielPfad}.neu`, JSON.stringify(objekt, null, 2))
  await rename(`${zielPfad}.neu`, zielPfad)
  if (zielPfad !== pfad) await rm(pfad, { force: true })
  return true
}

/**
 * Die Signaturen werden NEU BERECHNET, nicht abgebildet.
 *
 * `trimSignature` und `videoCutSignature` sind kein Schlüssel, sondern
 * stringifiziertes JSON der Edits. Nach der Umbenennung `start/ende` und
 * `vonS/bisS` passte die gespeicherte Zeichenkette nie wieder zur neu
 * gerechneten — jede Tour liefe in die volle Anreicherung samt Geocoding und
 * bezahlter Bildanalyse.
 */
type Signaturen = {
  trimSignature: (edits: unknown) => string
  videoCutSignature: (edits: unknown) => string
}

/** Ein Tour-Ordner: Manifest, Overlay, Cache. */
async function migriereTour(ordner: string, signaturen: Signaturen): Promise<void> {
  await migriereDatei(join(ordner, MANIFEST), 'manifest')
  const editsPfad = join(ordner, EDITS)
  await migriereDatei(editsPfad, 'edits')
  let edits: unknown = null
  try {
    edits = JSON.parse(await readFile(editsPfad, 'utf8'))
  } catch {
    /* keine Overlay-Datei — dann gelten die Signaturen des leeren Overlays */
  }
  await migriereDatei(
    join(ordner, ANREICHERUNG_ALT),
    'enrichment',
    (cache) => {
      cache['trimSignature'] = signaturen.trimSignature(edits)
      if ('videoCutSignature' in cache)
        cache['videoCutSignature'] = signaturen.videoCutSignature(edits)
    },
    join(ordner, ENRICHMENT),
  )
}

/**
 * Der Benutzer-Ordner: `titelbild/` heißt `banner/`.
 *
 * Nur die Spalte umzubenennen bräche jedes Banner, nur die Werte ohne die
 * Dateien ebenso — deshalb wandern Ordner und Wert in EINEM Schritt (§4.2).
 * Die mitgelieferten Vorschläge (`kueste.jpg`) tragen keinen Schrägstrich und
 * bleiben unangetastet.
 */
async function migriereBenutzer(
  benutzerDir: string,
  setzeBanner: (userId: string, wert: string) => void,
): Promise<void> {
  let ids: string[]
  try {
    ids = (await readdir(benutzerDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return
  }
  for (const id of ids) {
    const alt = join(benutzerDir, id, 'titelbild')
    const neu = join(benutzerDir, id, 'banner')
    try {
      await stat(alt)
    } catch {
      continue
    }
    await rename(alt, neu)
    for (const datei of await readdir(neu)) setzeBanner(id, `banner/${datei}`)
  }
}

export interface StartMigrationDeps {
  datenDir: string
  /** Tour-Ordner (die IDs) — der Storage weiß, wo sie liegen. */
  tourIds: () => Promise<string[]>
  signaturen: Signaturen
  /** `users.banner` auf den neuen Pfad ziehen. */
  setzeBanner: (userId: string, wert: string) => void
  protokoll?: (nachricht: string) => void
}

/**
 * Einmal-Lauf beim Start. Idempotent: Der Marker sagt, was schon geschehen ist.
 * Gibt zurück, ob etwas getan wurde.
 */
export async function fuehreStartMigrationAus(deps: StartMigrationDeps): Promise<boolean> {
  const markerPfad = join(deps.datenDir, MARKER)
  let stand = 1
  try {
    stand = Number.parseInt(await readFile(markerPfad, 'utf8'), 10) || 1
  } catch {
    /* kein Marker = Stand 1 */
  }
  if (stand >= DATEN_STAND) return false

  const ids = await deps.tourIds()
  deps.protokoll?.(`Start-Migration auf Stand ${DATEN_STAND}: ${ids.length} Tour-Ordner`)
  for (const id of ids) {
    await migriereTour(join(deps.datenDir, 'tours', id), deps.signaturen)
  }
  await migriereBenutzer(join(deps.datenDir, 'benutzer'), deps.setzeBanner)
  await writeFile(markerPfad, String(DATEN_STAND))
  deps.protokoll?.('Start-Migration fertig')
  return true
}
