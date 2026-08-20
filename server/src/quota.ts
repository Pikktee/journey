// Speicher-Quota pro Benutzer (M9). Deckelt den VPS-Platz und — mittelbar — die
// Kosten der Vision-Klassifikation, damit die Selbst-Registrierung nicht zum
// offenen Fass wird. Die Nutzung wird bei Bedarf aus dem Storage summiert
// (keine mitgeführte Zählung, die driften könnte): die Tour-Zahl pro Benutzer
// ist klein, ein rekursives stat je Upload ist vernachlässigbar.

import type { Db } from './db.js'
import type { Storage } from './storage.js'

export interface QuotaStand {
  used: number
  limit: number
  free: number
}

/**
 * Woraus der belegte Platz besteht — die vier Abschnitte des Balkens im Konto.
 *
 * Warum überhaupt aufgeschlüsselt: „248 von 2048 MB" beantwortet nicht die
 * Frage, die man vor dem Balken hat — nämlich WAS man wegräumen könnte. Vier
 * Arten sind das, was sich sinnvoll unterscheiden lässt; feiner wird es eine
 * Dateiliste, und die ist der Editor.
 *
 * `sonstiges` ist kein Rest-Eimer aus Bequemlichkeit, sondern die Zusicherung,
 * dass die Summe der Teile die Gesamtsumme IST: Eine Aufschlüsselung, die
 * weniger ergibt als der Balken zeigt, ist schlimmer als keine.
 */
export interface SpeicherAufteilung {
  /** Fotos: Anzeige- und Kachelfassungen der Bilder. */
  photos: number
  /** Videos samt Poster-Standbild. */
  videos: number
  /** Eigene Klänge — Bibliothek des Kontos und in Touren gelegte Audiodateien. */
  audio: number
  /** Aufzeichnung: Manifest, GPS-Track, Overlay und gerendertes Tour-JSON. */
  recordings: number
  other: number
}

const BILD_ENDUNGEN = /\.(jpe?g|png|webp|avif|heic)$/i
const VIDEO_ENDUNGEN = /\.(mp4|mov|m4v|webm)$/i
const AUDIO_ENDUNGEN = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i

/**
 * Ein Dateipfad → seine Art.
 *
 * Nach der ENDUNG und nicht nach dem Ordner: In `media/` liegen Fotos, Videos,
 * Poster und die im Editor gelegten Klänge nebeneinander — der Ordner sagt nur,
 * dass es kein Datensatz ist. Alles außerhalb von `media/` ist die Aufzeichnung
 * selbst (Manifest, Track, `edits.json`, `tour.json`, `enrichment.json`); sie
 * ist winzig, steht aber im Balken, damit die Teile die Summe ergeben.
 */
export function artDerDatei(pfad: string): keyof SpeicherAufteilung {
  if (AUDIO_ENDUNGEN.test(pfad)) return 'audio'
  if (!pfad.startsWith('media/')) return 'recordings'
  if (BILD_ENDUNGEN.test(pfad)) return 'photos'
  if (VIDEO_ENDUNGEN.test(pfad)) return 'videos'
  return 'other'
}

const LEERE_AUFTEILUNG = (): SpeicherAufteilung => ({
  photos: 0,
  videos: 0,
  audio: 0,
  recordings: 0,
  other: 0,
})

/**
 * Summiert die Bytes aller Touren eines Benutzers über den Storage — plus die
 * benutzerweite Audio-Bibliothek (`<userId>/audio/` im benutzerStorage): auch
 * sie belegt VPS-Platz, sonst wäre sie ein Quota-Schlupfloch. Der Avatar bleibt
 * bewusst außen vor (fixe Obergrenze, kein nennenswerter Platz).
 */
export async function benutzteBytes(
  db: Db,
  storage: Storage,
  benutzerStorage: Storage,
  userId: string,
): Promise<number> {
  const zeilen = db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{
    id: string
  }>
  let summe = 0
  for (const { id } of zeilen) summe += await storage.gesamtGroesse(id)
  for (const datei of await benutzerStorage.listeDateien(userId, 'audio')) summe += datei.groesse
  return summe
}

export async function quotaStand(
  db: Db,
  storage: Storage,
  benutzerStorage: Storage,
  userId: string,
  limit: number,
): Promise<QuotaStand> {
  const benutzt = await benutzteBytes(db, storage, benutzerStorage, userId)
  return { used: benutzt, limit, free: Math.max(0, limit - benutzt) }
}

/**
 * Derselbe belegte Platz, nur nach Art aufgeschlüsselt (Kontoeinstellungen).
 *
 * Läuft über dieselben Quellen wie `benutzteBytes` — Touren plus die
 * benutzerweite Klangbibliothek —, damit die Summe der Teile dem Balken
 * entspricht. Avatar und Titelbild bleiben wie dort außen vor.
 */
export async function speicherAufteilung(
  db: Db,
  storage: Storage,
  benutzerStorage: Storage,
  userId: string,
): Promise<SpeicherAufteilung> {
  const aufteilung = LEERE_AUFTEILUNG()
  const zeilen = db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{
    id: string
  }>
  for (const { id } of zeilen) {
    for (const datei of await storage.alleDateien(id)) {
      aufteilung[artDerDatei(datei.pfad)] += datei.groesse
    }
  }
  for (const datei of await benutzerStorage.listeDateien(userId, 'audio'))
    aufteilung.audio += datei.groesse
  return aufteilung
}

/**
 * Prüft, ob noch `zusatzBytes` in die Quota passen. Gibt bei Überschreitung eine
 * fertige Fehlermeldung zurück (sonst null) — die Upload-Routen antworten damit
 * mit 413. Bewusst eine Vorab-Prüfung: der eigentliche Stream-Guard
 * (maxMediumBytes) bleibt die harte Grenze pro Datei.
 */
export async function pruefeQuota(
  db: Db,
  storage: Storage,
  benutzerStorage: Storage,
  userId: string,
  limit: number,
  zusatzBytes: number,
): Promise<string | null> {
  const benutzt = await benutzteBytes(db, storage, benutzerStorage, userId)
  if (benutzt + zusatzBytes > limit) {
    const mb = (b: number): string => (b / (1024 * 1024)).toFixed(0)
    return `Speicherplatz erschöpft: ${mb(benutzt)} von ${mb(limit)} MB belegt`
  }
  return null
}
