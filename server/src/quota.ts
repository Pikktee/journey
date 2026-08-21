// Speicher-Quota pro Benutzer (M9). Deckelt den VPS-Platz und — mittelbar — die
// Kosten der Vision-Klassifikation, damit die Selbst-Registrierung nicht zum
// offenen Fass wird. Die Nutzung wird bei Bedarf aus dem Storage summiert
// (keine mitgeführte Zählung, die driften könnte): die Tour-Zahl pro Benutzer
// ist klein, ein rekursives stat je Upload ist vernachlässigbar.

import type { Db } from './db.js'
import type { Storage } from './storage.js'

export interface QuotaStatus {
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
 * `other` ist kein Rest-Eimer aus Bequemlichkeit, sondern die Zusicherung,
 * dass die Summe der Teile die Gesamtsumme IST: Eine Aufschlüsselung, die
 * weniger ergibt als der Balken zeigt, ist schlimmer als keine.
 */
export interface StorageBreakdown {
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

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|heic)$/i
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm)$/i
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i

/**
 * Ein Dateipfad → seine Art.
 *
 * Nach der ENDUNG und nicht nach dem Ordner: In `media/` liegen Fotos, Videos,
 * Poster und die im Editor gelegten Klänge nebeneinander — der Ordner sagt nur,
 * dass es kein Datensatz ist. Alles außerhalb von `media/` ist die Aufzeichnung
 * selbst (Manifest, Track, `edits.json`, `tour.json`, `enrichment.json`); sie
 * ist winzig, steht aber im Balken, damit die Teile die Summe ergeben.
 */
export function fileType(path: string): keyof StorageBreakdown {
  if (AUDIO_EXTENSIONS.test(path)) return 'audio'
  if (!path.startsWith('media/')) return 'recordings'
  if (IMAGE_EXTENSIONS.test(path)) return 'photos'
  if (VIDEO_EXTENSIONS.test(path)) return 'videos'
  return 'other'
}

const emptyBreakdown = (): StorageBreakdown => ({
  photos: 0,
  videos: 0,
  audio: 0,
  recordings: 0,
  other: 0,
})

/**
 * Summiert die Bytes aller Touren eines Benutzers über den Storage — plus die
 * benutzerweite Audio-Bibliothek (`<userId>/audio/` im userStorage): auch
 * sie belegt VPS-Platz, sonst wäre sie ein Quota-Schlupfloch. Der Avatar bleibt
 * bewusst außen vor (fixe Obergrenze, kein nennenswerter Platz).
 */
export async function usedBytes(
  db: Db,
  storage: Storage,
  userStorage: Storage,
  userId: string,
): Promise<number> {
  const rows = db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{
    id: string
  }>
  let sum = 0
  for (const { id } of rows) sum += await storage.totalSize(id)
  for (const file of await userStorage.listFiles(userId, 'audio')) sum += file.size
  return sum
}

export async function quotaStatus(
  db: Db,
  storage: Storage,
  userStorage: Storage,
  userId: string,
  limit: number,
): Promise<QuotaStatus> {
  const used = await usedBytes(db, storage, userStorage, userId)
  return { used: used, limit, free: Math.max(0, limit - used) }
}

/**
 * Derselbe belegte Platz, nur nach Art aufgeschlüsselt (Kontoeinstellungen).
 *
 * Läuft über dieselben Quellen wie `usedBytes` — Touren plus die
 * benutzerweite Klangbibliothek —, damit die Summe der Teile dem Balken
 * entspricht. Avatar und Titelbild bleiben wie dort außen vor.
 */
export async function storageBreakdown(
  db: Db,
  storage: Storage,
  userStorage: Storage,
  userId: string,
): Promise<StorageBreakdown> {
  const breakdown = emptyBreakdown()
  const rows = db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{
    id: string
  }>
  for (const { id } of rows) {
    for (const file of await storage.allFiles(id)) {
      breakdown[fileType(file.path)] += file.size
    }
  }
  for (const file of await userStorage.listFiles(userId, 'audio')) breakdown.audio += file.size
  return breakdown
}

/**
 * Prüft, ob noch `zusatzBytes` in die Quota passen. Gibt bei Überschreitung eine
 * fertige Fehlermeldung zurück (sonst null) — die Upload-Routen antworten damit
 * mit 413. Bewusst eine Vorab-Prüfung: der eigentliche Stream-Guard
 * (maxMediumBytes) bleibt die harte Grenze pro Datei.
 */
export async function checkQuota(
  db: Db,
  storage: Storage,
  userStorage: Storage,
  userId: string,
  limit: number,
  extraBytes: number,
): Promise<string | null> {
  const used = await usedBytes(db, storage, userStorage, userId)
  if (used + extraBytes > limit) {
    const mb = (b: number): string => (b / (1024 * 1024)).toFixed(0)
    return `Speicherplatz erschöpft: ${mb(used)} von ${mb(limit)} MB belegt`
  }
  return null
}
