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
import { ARCHIV_DATEI, type ArchivEintrag, baueArchiv } from './export.js'
import {
  type KontoAngaben,
  type TourAngaben,
  istGepackt,
  liesmich,
  tourOrdner,
} from './exportinhalt.js'
import type { Storage } from './storage.js'

export type LaufAbhaengigkeiten = {
  db: Db
  /** Ablage der Touren (Medien, tour.json …). */
  storage: Storage
  /** Ablage der Archive — ein Bereich je Auftrag. */
  archive: Storage
  /** Obergrenze fürs Schreiben; großzügig, das Archiv ist so groß wie das Konto. */
  maxBytes: number
}

/** Sammelt die Konto-Angaben so, wie sie im Export erscheinen. */
export function sammleKonto(db: Db, benutzerId: string): KontoAngaben | null {
  const u = db
    .prepare(
      `SELECT email, name, handle, created_at, email_verified, rolle, anzeigename, bio, ort, website,
              instagram, profil_sichtbarkeit, suchmaschinen, newsletter
       FROM users WHERE id = ?`,
    )
    .get(benutzerId) as
    | {
        email: string
        name: string
        handle: string | null
        created_at: string
        email_verified: number
        rolle: string
        anzeigename: string | null
        bio: string | null
        ort: string | null
        website: string | null
        instagram: string | null
        profil_sichtbarkeit: string
        suchmaschinen: number
        newsletter: number
      }
    | undefined
  if (!u) return null
  const historie = db
    .prepare(
      `SELECT zeitpunkt, zustand, quelle, textfassung FROM newsletter_einwilligungen
       WHERE benutzer_id = ? ORDER BY zeitpunkt`,
    )
    .all(benutzerId) as Array<{
    zeitpunkt: string
    zustand: string
    quelle: string
    textfassung: string
  }>
  const pushGeraete = db
    .prepare(
      `SELECT plattform, token, angelegt_am, zuletzt_gesehen_am FROM push_geraete
       WHERE benutzer_id = ? ORDER BY angelegt_am`,
    )
    .all(benutzerId) as Array<{
    plattform: string
    token: string
    angelegt_am: string
    zuletzt_gesehen_am: string
  }>
  return {
    email: u.email,
    name: u.name,
    handle: u.handle,
    angelegtAm: u.created_at,
    emailBestaetigt: !!u.email_verified,
    rolle: u.rolle,
    profil: {
      anzeigename: u.anzeigename,
      bio: u.bio,
      ort: u.ort,
      website: u.website,
      instagram: u.instagram,
      sichtbarkeit: u.profil_sichtbarkeit,
      inSuchmaschinen: !!u.suchmaschinen,
    },
    newsletter: { aktuell: !!u.newsletter, historie },
    pushGeraete: pushGeraete.map((g) => ({
      plattform: g.plattform,
      token: g.token,
      angelegtAm: g.angelegt_am,
      zuletztGesehenAm: g.zuletzt_gesehen_am,
    })),
  }
}

/** Die Touren eines Kontos, in der Reihenfolge der Bibliothek. */
export function sammleTouren(db: Db, benutzerId: string): TourAngaben[] {
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
export async function sammleEintraege(
  deps: Pick<LaufAbhaengigkeiten, 'db' | 'storage'>,
  benutzerId: string,
  erstelltAm: string,
): Promise<ArchivEintrag[]> {
  const konto = sammleKonto(deps.db, benutzerId)
  if (!konto) throw new Error('Konto nicht gefunden')
  const touren = sammleTouren(deps.db, benutzerId)

  const eintraege: ArchivEintrag[] = [
    { name: 'liesmich.txt', inhalt: liesmich(konto, touren, erstelltAm) },
    { name: 'konto.json', inhalt: JSON.stringify(konto, null, 2) },
    { name: 'touren.json', inhalt: JSON.stringify(touren, null, 2) },
  ]

  for (const tour of touren) {
    const ordner = `touren/${tourOrdner(tour.nummer, tour.titel)}`
    const dateien = await deps.storage.alleDateien(tour.id).catch(() => [])
    for (const datei of dateien) {
      // Der Zwischenspeicher der Anreicherung bleibt draußen: Er ist unser
      // Rechenweg (Ortsnamen, Wetterabrufe), nicht die Auskunft — und beim
      // nächsten Rendern ohnehin wieder anders.
      if (datei.pfad === 'anreicherung.json') continue
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
        gepackt: istGepackt(datei.pfad),
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
export async function baueUndLege(
  deps: LaufAbhaengigkeiten,
  auftragId: string,
  benutzerId: string,
  erstelltAm: string,
): Promise<{ bytes: number; dateien: number }> {
  const eintraege = await sammleEintraege(deps, benutzerId, erstelltAm)
  const strom = baueArchiv(eintraege)
  const info = await deps.archive.schreibeStream(
    auftragId,
    ARCHIV_DATEI,
    strom as Readable,
    deps.maxBytes,
  )
  return { bytes: info.groesse, dateien: eintraege.length }
}
