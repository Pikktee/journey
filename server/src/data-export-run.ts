/**
 * Der Lauf: Daten sammeln, ZIP bauen, ablegen, Mail schicken.
 *
 * Die drei Teile stehen bewusst getrennt — [export.ts](./export.ts) verwaltet
 * die Aufträge und die ZIP-Mechanik, [exportinhalt.ts](./exportinhalt.ts) sagt,
 * WAS hineingehört, und hier wird es zusammengeführt.
 *
 * **Er läuft ohne jemanden, der auf ihn wartet.** Angestoßen wird er, nachdem
 * die Route längst geantwortet hat; wer das Ergebnis will, bekommt es per
 * Mail. Deshalb darf hier nichts werfen, was nicht gefangen wird: Ein
 * abgestürzter Lauf ohne Eintrag hinterließe ein Konto, das für immer
 * „exportiert gerade" ist (der UNIQUE-Index lässt keinen zweiten zu).
 */
import { Readable } from 'node:stream'
import type { Db } from './db.js'
import { ARCHIVE_FILE, type ArchiveEntry, buildArchive } from './data-export.js'
import {
  type AccountDetails,
  type TourDetails,
  isCompressed,
  buildReadme,
  tourFolder,
} from './data-export-content.js'
import type { Storage } from './storage.js'

export type RunDependencies = {
  db: Db
  /** Ablage der Touren (Medien, tour.json …). */
  storage: Storage
  /** Ablage der Archive — ein Bereich je Auftrag. */
  archive: Storage
  /** Obergrenze fürs Schreiben; großzügig, das Archiv ist so groß wie das Konto. */
  maxBytes: number
}

/** Sammelt die Konto-Angaben so, wie sie im Export erscheinen. */
export function collectAccount(db: Db, benutzerId: string): AccountDetails | null {
  const u = db
    .prepare(
      `SELECT email, name, handle, created_at, email_verified, role, display_name, bio, location, website,
              instagram, profile_visibility, search_indexing, newsletter
       FROM users WHERE id = ?`,
    )
    .get(benutzerId) as
    | {
        email: string
        name: string
        handle: string | null
        created_at: string
        email_verified: number
        role: string
        display_name: string | null
        bio: string | null
        location: string | null
        website: string | null
        instagram: string | null
        profile_visibility: string
        search_indexing: number
        newsletter: number
      }
    | undefined
  if (!u) return null
  const historie = db
    .prepare(
      `SELECT at AS zeitpunkt, state AS zustand, source AS quelle, text_version AS textfassung
       FROM newsletter_consents WHERE user_id = ? ORDER BY at`,
    )
    .all(benutzerId) as Array<{
    zeitpunkt: string
    zustand: string
    quelle: string
    textfassung: string
  }>
  const pushGeraete = db
    .prepare(
      `SELECT platform, token, created_at, last_seen_at FROM push_devices
       WHERE user_id = ? ORDER BY created_at`,
    )
    .all(benutzerId) as Array<{
    platform: string
    token: string
    created_at: string
    last_seen_at: string
  }>
  return {
    email: u.email,
    name: u.name,
    handle: u.handle,
    angelegtAm: u.created_at,
    emailBestaetigt: !!u.email_verified,
    rolle: u.role,
    profil: {
      anzeigename: u.display_name,
      bio: u.bio,
      ort: u.location,
      website: u.website,
      instagram: u.instagram,
      sichtbarkeit: u.profile_visibility,
      inSuchmaschinen: !!u.search_indexing,
    },
    newsletter: { aktuell: !!u.newsletter, historie },
    pushGeraete: pushGeraete.map((g) => ({
      plattform: g.platform,
      token: g.token,
      angelegtAm: g.created_at,
      zuletztGesehenAm: g.last_seen_at,
    })),
  }
}

/** Die Touren eines Kontos, in der Reihenfolge der Bibliothek. */
export function collectTours(db: Db, benutzerId: string): TourDetails[] {
  const zeilen = db
    .prepare(
      `SELECT id, no, title, description, visibility, status, created_at, updated_at, stats_json
       FROM tours WHERE owner_id = ? ORDER BY no`,
    )
    .all(benutzerId) as Array<{
    id: string
    no: number
    title: string | null
    description: string | null
    visibility: string
    status: string
    created_at: string
    updated_at: string
    stats_json: string | null
  }>
  return zeilen.map((z) => ({
    id: z.id,
    nummer: z.no,
    titel: z.title,
    beschreibung: z.description,
    sichtbarkeit: z.visibility,
    status: z.status,
    angelegtAm: z.created_at,
    geaendertAm: z.updated_at,
    // Als Objekt, nicht als eingebetteter String: Wer das JSON weiterverarbeitet,
    // soll nicht ein zweites Mal parsen müssen.
    statistik: z.stats_json ? JSON.parse(z.stats_json) : null,
  }))
}

/**
 * Die Liste der Dateien, aus denen das Archiv entsteht.
 *
 * Getrennt vom Packen, damit sie prüfbar ist: Ob eine Tour mit ihren Medien
 * vollständig drin ist, entscheidet sich hier — und ein vergessener Ordner
 * fällt in einem Test auf, nicht erst im entpackten ZIP.
 */
export async function collectEntries(
  deps: Pick<RunDependencies, 'db' | 'storage'>,
  benutzerId: string,
  erstelltAm: string,
): Promise<ArchiveEntry[]> {
  const konto = collectAccount(deps.db, benutzerId)
  if (!konto) throw new Error('Konto nicht gefunden')
  const touren = collectTours(deps.db, benutzerId)

  const eintraege: ArchiveEntry[] = [
    { name: 'liesmich.txt', inhalt: buildReadme(konto, touren, erstelltAm) },
    { name: 'konto.json', inhalt: JSON.stringify(konto, null, 2) },
    { name: 'touren.json', inhalt: JSON.stringify(touren, null, 2) },
  ]

  for (const tour of touren) {
    const ordner = `touren/${tourFolder(tour.nummer, tour.titel)}`
    const dateien = await deps.storage.alleDateien(tour.id).catch(() => [])
    for (const datei of dateien) {
      // Der Zwischenspeicher der Anreicherung bleibt draußen: Er ist unser
      // Rechenweg (Ortsnamen, Wetterabrufe), nicht die Auskunft — und beim
      // nächsten Rendern ohnehin wieder anders.
      if (datei.pfad === 'enrichment.json') continue
      // `original/manifest.json` → `manifest.json`, `edits.json` →
      // `bearbeitung.json`: Im Archiv zählt, was jemand beim Öffnen versteht,
      // nicht wie wir die Datei intern führen.
      const ziel =
        datei.pfad === 'original/manifest.json'
          ? 'manifest.json'
          : datei.pfad === 'edits.json'
            ? 'bearbeitung.json'
            : datei.pfad
      eintraege.push({
        name: `${ordner}/${ziel}`,
        inhalt: () => deps.storage.leseStream(tour.id, datei.pfad),
        gepackt: isCompressed(datei.pfad),
      })
    }
  }
  return eintraege
}

/**
 * Baut das Archiv und legt es ab. Gibt Größe und Dateizahl zurück.
 *
 * Der Strom geht direkt von yazl in die Ablage — nichts davon liegt vollständig
 * im Arbeitsspeicher.
 */
export async function buildAndStore(
  deps: RunDependencies,
  auftragId: string,
  benutzerId: string,
  erstelltAm: string,
): Promise<{ bytes: number; dateien: number }> {
  const eintraege = await collectEntries(deps, benutzerId, erstelltAm)
  const strom = buildArchive(eintraege)
  const info = await deps.archive.schreibeStream(
    auftragId,
    ARCHIVE_FILE,
    strom as Readable,
    deps.maxBytes,
  )
  return { bytes: info.groesse, dateien: eintraege.length }
}
