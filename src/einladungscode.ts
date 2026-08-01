// Die Form eines Einladungscodes: vier Zeichen, Bindestrich, vier Zeichen.
//
// Codes werden abgetippt, nicht kopiert — deshalb räumt diese Funktion beim
// Tippen auf, statt hinterher zu meckern: Kleinbuchstaben werden groß, alles
// Ungültige fällt weg, und der Bindestrich setzt sich von selbst. Der Server
// normalisiert dasselbe noch einmal (server/src/auth/einladungen.ts); hier geht
// es nur darum, dass das Feld unter dem Finger richtig aussieht.

/** Zeichen je Gruppe — spiegelt `neuerEinladungsCode` in server/src/ids.ts. */
const GRUPPE = 4

export function formatiereEinladungscode(roh: string): string {
  const zeichen = roh
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, GRUPPE * 2)
  return zeichen.length > GRUPPE ? `${zeichen.slice(0, GRUPPE)}-${zeichen.slice(GRUPPE)}` : zeichen
}

/** Ist der Code vollständig getippt? (Nur die Form — ob er GILT, weiß der Server.) */
export const codeVollstaendig = (wert: string): boolean =>
  formatiereEinladungscode(wert).length === GRUPPE * 2 + 1
