// Passwort-Hashing mit argon2id (@node-rs/argon2, vorkompiliert — kein node-gyp).
// Eigene kleine Hülle, damit Aufrufer nie direkt an der Bibliothek hängen.

import { hash, verify } from '@node-rs/argon2'

// OWASP-empfohlene Parameter für argon2id (Stand 2026): 19 MiB, t=2, p=1
const PARAMETER = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export async function hashePasswort(passwort: string): Promise<string> {
  return hash(passwort, PARAMETER)
}

export async function pruefePasswort(passwortHash: string, passwort: string): Promise<boolean> {
  try {
    return await verify(passwortHash, passwort)
  } catch {
    return false
  }
}
