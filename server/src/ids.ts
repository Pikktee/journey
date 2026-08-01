// ID-Erzeugung: unerratbare, URL-taugliche IDs mit Typ-Präfix.
// Die Unerratbarkeit trägt die v1-Sichtbarkeit `unlisted` (teilbarer Link).

import { customAlphabet } from 'nanoid'

// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
const nano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', 14)

export const neueTourId = (): string => `t_${nano()}`
export const neueUserId = (): string => `u_${nano()}`
export const neueSessionId = (): string => `s_${nano()}${nano()}`
export const neuesTokenSecret = (): string => `lhb_${nano()}${nano()}${nano()}`

// Einladungscodes werden vorgelesen und abgetippt, nicht kopiert-und-eingefügt:
// deshalb Versalien in zwei Gruppen und ohne alles, was sich verwechseln lässt
// (0/O, 1/I/L, 2/Z, 5/S, 8/B). Der Rest der Sicherheit kommt von der Bremse an
// der Registrier-Route — 26^8 Möglichkeiten sind bei 5 Versuchen je 10 Minuten
// weit außerhalb dessen, was sich raten lässt.
const codeNano = customAlphabet('ACDEFGHJKMNPQRTUVWXY34679', 4)
export const neuerEinladungsCode = (): string => `${codeNano()}-${codeNano()}`
