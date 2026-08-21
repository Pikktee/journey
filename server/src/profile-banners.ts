/**
 * Die mitgelieferten Titelbilder — Server-Kopie von
 * [src/profile/profile-banners.ts](../../src/profile/profile-banners.ts).
 *
 * Zweite Fassung derselben Liste, wie bei `handle.ts` und `webpfade.ts`: Der
 * Server hat einen eigenen `rootDir` und kann `src/` nicht importieren. Ein
 * Drift-Wächter in [test/seiten.test.ts](../test/seiten.test.ts) vergleicht
 * beide.
 *
 * **Warum der Server das überhaupt braucht.** Für die Vorschaukarte eines
 * Profils ohne eigenes Titelbild. Zeigte die Karte im Chat das Marken-Bild und
 * die Seite dahinter ein Bergpass-Banner, wären es zwei verschiedene Auskünfte
 * über dieselbe Seite. Die PRÜFUNG eines gesetzten Titelbilds bleibt davon
 * unberührt — sie sieht weiter nur die Form des Namens an
 * (`isBannerSuggestion` in `profilfelder.ts`), denn ein erfundener Name
 * kostet nichts außer einem leeren Banner beim Urheber.
 */

/** Nur die Dateinamen; die Alternativtexte braucht allein der Dialog. */
export const BANNER_FILES: readonly string[] = [
  'serpentinen.jpg',
  'kueste.jpg',
  'nachtstadt.jpg',
  'wueste.jpg',
]

/**
 * Welches Bild ein Profil bekommt, das keines gewählt hat — deterministisch aus
 * dem Handle. Wortgleich mit der Web-Fassung: Ein anderer Streuwert hieße, dass
 * Vorschaukarte und Banner verschiedene Bilder zeigen.
 */
export function defaultBanner(schluessel: string | null | undefined): string {
  const wort = schluessel?.trim().toLowerCase() ?? ''
  let summe = 0
  for (let i = 0; i < wort.length; i++) summe = (summe * 31 + wort.charCodeAt(i)) % 100_000
  return BANNER_FILES[summe % BANNER_FILES.length]!
}
