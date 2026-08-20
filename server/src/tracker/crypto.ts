// Verschlüsselung der OAuth-Tokens fremder Anbieter (AES-256-GCM).
//
// Warum überhaupt: In `tracker_verknuepfungen` liegt ein Zugriffstoken, mit dem
// jeder, der die Datenbankdatei in die Hand bekommt, die Trainingsdaten fremder
// Konten beim ANBIETER abrufen kann — eine Datei-Kopie (Backup, Kopie zum
// Debuggen) wäre sonst dasselbe wie ein Satz fremder Zugangsdaten.
//
// GCM und nicht CBC: Es soll nicht nur unlesbar, sondern auch unveränderbar
// sein. Ohne Authentifizierung ließe sich der Geheimtext gezielt kippen, und
// entschlüsselt käme etwas heraus, das nach einem Token aussieht.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const ALGO = 'aes-256-gcm'
/** 96 Bit — die für GCM vorgesehene IV-Länge (längere werden intern gehasht). */
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Der Schlüssel wird aus der Umgebungsvariable GEHASHT, nicht roh verwendet.
 *
 * AES-256 verlangt exakt 32 Byte; eine Passphrase aus der Umgebung hat eine
 * beliebige Länge. Sie zu beschneiden oder aufzufüllen wäre die stille
 * Variante, an der man bei zu kurzen Werten Entropie verliert, ohne es zu
 * merken. SHA-256 ist hier ausreichend: Die Variable ist ein generiertes
 * Geheimnis, kein von Menschen gewähltes Passwort — eine langsame
 * Schlüsselableitung (scrypt) schützt gegen Wörterbuchangriffe, die es hier
 * nicht gibt, und liefe bei JEDEM Entschlüsseln.
 */
function schluessel(geheimnis: string): Buffer {
  return createHash('sha256').update(geheimnis, 'utf8').digest()
}

/**
 * Klartext → `v1.<iv>.<tag>.<geheimtext>`, alles base64url.
 *
 * Das Präfix ist die Stelle, an der ein späterer Wechsel des Verfahrens
 * ansetzt: Ohne Versionsmarke müsste man raten, wie eine vorhandene Zeile
 * entstanden ist, und ein Umstieg wäre nur mit einer Migration über alle
 * Verknüpfungen zu haben.
 */
export function encrypt(klartext: string, geheimnis: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, schluessel(geheimnis), iv)
  const daten = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    daten.toString('base64url'),
  ].join('.')
}

/**
 * Zurück zum Klartext. Wirft bei falschem Schlüssel, fremdem Format oder
 * verändertem Geheimtext — der Aufrufer behandelt das wie eine kaputte
 * Verknüpfung (Status `abgelaufen`), nicht wie einen Serverfehler.
 */
export function decrypt(gepackt: string, geheimnis: string): string {
  const teile = gepackt.split('.')
  if (teile.length !== 4 || teile[0] !== 'v1') throw new Error('Unbekanntes Token-Format')
  const [, ivB64 = '', tagB64 = '', datenB64 = ''] = teile
  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Token beschädigt')
  const decipher = createDecipheriv(ALGO, schluessel(geheimnis), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(Buffer.from(datenB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * Zwei Geheimnisse ohne Zeitleck vergleichen (Webhook-Signaturen, `state`).
 *
 * Ein gewöhnliches `===` bricht beim ersten ungleichen Byte ab; wer die
 * Antwortzeit misst, rät eine Signatur Zeichen für Zeichen. Die Längen werden
 * VOR dem Vergleich geprüft, weil `timingSafeEqual` bei ungleicher Länge wirft
 * — dass die Länge durchsickert, ist dabei belanglos.
 */
export function timingSafeEquals(a: string, b: string): boolean {
  const pa = Buffer.from(a, 'utf8')
  const pb = Buffer.from(b, 'utf8')
  return pa.length === pb.length && timingSafeEqual(pa, pb)
}
