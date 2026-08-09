// ID-Erzeugung: unerratbare, URL-taugliche IDs mit Typ-Präfix.
// Die Unerratbarkeit trägt die v1-Sichtbarkeit `unlisted` (teilbarer Link).

import { customAlphabet } from 'nanoid'

// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
const nano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', 14)

export const neueTourId = (): string => `t_${nano()}`
// Nachgereichte Medien (die IDs beim Anlegen vergibt der Client): kurz, weil
// die ID in jedem Medien-URL steht — Eindeutigkeit sichert der Aufrufer per
// Abgleich gegen das Manifest, nicht die Länge.
const nanoKurz = customAlphabet('23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', 10)
export const neueMediumId = (): string => `n_${nanoKurz()}`
export const neueUserId = (): string => `u_${nano()}`
export const neueSessionId = (): string => `s_${nano()}${nano()}`
// Doppelte Länge wie eine Tour-Kennung: Sie steht im Download-Link eines
// Archivs, das ALLE Daten eines Kontos enthält. Signiert ist der Link
// zusätzlich (s. export.ts) — das hier ist die zweite Mauer, nicht die einzige.
export const neueExportId = (): string => `x_${nano()}${nano()}`
export const neuesTokenSecret = (): string => `lhb_${nano()}${nano()}${nano()}`

// Einladungscodes werden vorgelesen und abgetippt, nicht kopiert-und-eingefügt:
// deshalb Versalien in zwei Gruppen und ohne alles, was sich verwechseln lässt
// (0/O, 1/I/L, 2/Z, 5/S, 8/B). Der Rest der Sicherheit kommt von der Bremse an
// der Registrier-Route — 26^8 Möglichkeiten sind bei 5 Versuchen je 10 Minuten
// weit außerhalb dessen, was sich raten lässt.
const codeNano = customAlphabet('ACDEFGHJKMNPQRTUVWXY34679', 4)
export const neuerEinladungsCode = (): string => `${codeNano()}-${codeNano()}`
