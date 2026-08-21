// Die Form eines Einladungscodes: vier Zeichen, Bindestrich, vier Zeichen.
//
// Codes werden abgetippt, nicht kopiert — deshalb räumt diese Funktion beim
// Tippen auf, statt hinterher zu meckern: Kleinbuchstaben werden groß, alles
// Ungültige fällt weg, und der Bindestrich setzt sich von selbst. Der Server
// normalisiert dasselbe noch einmal (server/src/auth/einladungen.ts); hier geht
// es nur darum, dass das Feld unter dem Finger richtig aussieht.

/** Zeichen je Gruppe — spiegelt `neuerEinladungsCode` in server/src/ids.ts. */
const GROUP = 4

export function formatInvitationCode(raw: string): string {
  const chars = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, GROUP * 2)
  return chars.length > GROUP ? `${chars.slice(0, GROUP)}-${chars.slice(GROUP)}` : chars
}

/** Ist der Code vollständig getippt? (Nur die Form — ob er GILT, weiß der Server.) */
export const codeComplete = (value: string): boolean =>
  formatInvitationCode(value).length === GROUP * 2 + 1
