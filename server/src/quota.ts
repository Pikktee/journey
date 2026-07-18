// Speicher-Quota pro Benutzer (M9). Deckelt den VPS-Platz und — mittelbar — die
// Kosten der Vision-Klassifikation, damit die Selbst-Registrierung nicht zum
// offenen Fass wird. Die Nutzung wird bei Bedarf aus dem Storage summiert
// (keine mitgeführte Zählung, die driften könnte): die Tour-Zahl pro Benutzer
// ist klein, ein rekursives stat je Upload ist vernachlässigbar.

import type { Db } from './db.js'
import type { Storage } from './storage.js'

export interface QuotaStand {
  benutzt: number
  limit: number
  frei: number
}

/** Summiert die Bytes aller Touren eines Benutzers über den Storage. */
export async function benutzteBytes(db: Db, storage: Storage, userId: string): Promise<number> {
  const zeilen = db.prepare('SELECT id FROM tours WHERE owner_id = ?').all(userId) as Array<{ id: string }>
  let summe = 0
  for (const { id } of zeilen) summe += await storage.gesamtGroesse(id)
  return summe
}

export async function quotaStand(db: Db, storage: Storage, userId: string, limit: number): Promise<QuotaStand> {
  const benutzt = await benutzteBytes(db, storage, userId)
  return { benutzt, limit, frei: Math.max(0, limit - benutzt) }
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
  userId: string,
  limit: number,
  zusatzBytes: number,
): Promise<string | null> {
  const benutzt = await benutzteBytes(db, storage, userId)
  if (benutzt + zusatzBytes > limit) {
    const mb = (b: number): string => (b / (1024 * 1024)).toFixed(0)
    return `Speicherplatz erschöpft: ${mb(benutzt)} von ${mb(limit)} MB belegt`
  }
  return null
}
