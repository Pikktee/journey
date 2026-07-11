// ID-Erzeugung: unerratbare, URL-taugliche IDs mit Typ-Präfix.
// Die Unerratbarkeit trägt die v1-Sichtbarkeit `unlisted` (teilbarer Link).

import { customAlphabet } from 'nanoid'

// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
const nano = customAlphabet('23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', 14)

export const neueTourId = (): string => `t_${nano()}`
export const neueUserId = (): string => `u_${nano()}`
export const neueSessionId = (): string => `s_${nano()}${nano()}`
export const neuesTokenSecret = (): string => `lhb_${nano()}${nano()}${nano()}`
