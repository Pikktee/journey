/**
 * Die Sätze zu den beiden Schaltern „Öffentliches Profil" und „In
 * Suchmaschinen erscheinen".
 *
 * Eigene Datei, weil beide Schalter an ZWEI Stellen stehen: im Bearbeiten-Modal
 * der Profilseite und in den Kontoeinstellungen. Der Zustand konnte nie
 * auseinanderlaufen (beide schreiben dasselbe Feld) — der Wortlaut schon, und
 * genau das war passiert.
 *
 * Sie sagen den ZUSTAND, nicht die Funktion des Schalters: „Dein Profil ist
 * unter … für alle sichtbar" ist eine Auskunft, „Macht dein Profil sichtbar"
 * wäre eine Bedienungsanleitung für etwas, das man gerade vor sich sieht.
 */

/** Unter dem Schalter „Öffentliches Profil". */
export function profileVisibilitySentence(isPublic: boolean, address: string): string {
  return isPublic
    ? `Dein Profil ist unter ${address} für alle sichtbar.`
    : 'Dein Profil ist nur für dich sichtbar.'
}

/**
 * Unter dem Schalter „In Suchmaschinen erscheinen".
 *
 * Der dritte Fall ist der wichtigste: Bei privatem Profil ist der Schalter
 * folgenlos, und die Zeile sagt warum — sonst legt man ihn um und wundert sich,
 * dass nichts passiert.
 */
export function searchIndexingSentence(enabled: boolean, profileIsPublic: boolean): string {
  if (!profileIsPublic) return 'Wirkt erst, wenn dein Profil öffentlich ist.'
  return enabled
    ? 'Dein Profil darf in den Suchergebnissen auftauchen.'
    : 'Dein Profil bleibt aus den Suchergebnissen heraus.'
}
