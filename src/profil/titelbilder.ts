/**
 * Die mitgelieferten Titelbilder — die Auswahl im Dialog.
 *
 * Die Dateien liegen in `public/titelbilder/` und gehen als statische Dateien
 * über Nginx, nie durch die API (der Server prüft nur die FORM des Namens,
 * s. server/src/profilfelder.ts). Wer eines austauscht, ändert hier den Namen
 * mit — ein Eintrag ohne Datei zeigt eine leere Kachel, eine Datei ohne Eintrag
 * ist unerreichbar.
 *
 * Vier, nicht mehr: Das Raster bleibt zweizeilig, und die Wahl soll eine
 * Entscheidung sein, kein Katalog. Sie unterscheiden sich bewusst in
 * Landschaft, Tageszeit und Farbklima — sie stehen nebeneinander und müssen auf
 * einen Blick auseinanderzuhalten sein. Erzeugt über fal.ai,
 * s. scripts/gen-profil-titelbilder.mjs.
 */
export interface Titelbild {
  datei: string
  /** Die Bildunterschrift unter der Kachel — kurz, damit sie in eine Zeile passt. */
  name: string
  /** Wird als Alternativtext gelesen, wenn das Bild nicht lädt. */
  wort: string
}

export const TITELBILDER: readonly Titelbild[] = [
  { datei: 'serpentinen.jpg', name: 'Bergpass', wort: 'Serpentinen am Bergpass' },
  { datei: 'kueste.jpg', name: 'Küstenstraße', wort: 'Küstenstraße über dem Meer' },
  { datei: 'nachtstadt.jpg', name: 'Stadt bei Nacht', wort: 'Stadt bei Nacht' },
  { datei: 'wueste.jpg', name: 'Wüstenpiste', wort: 'Piste durch die Wüste' },
]

/** Öffentlicher Pfad eines mitgelieferten Bildes — dieselbe Form wie im Server. */
export function titelbildPfad(datei: string): string {
  return `/titelbilder/${datei}`
}

/**
 * Welches Bild ein Profil bekommt, das keines gewählt hat.
 *
 * Ein leeres Banner ist keine Zurückhaltung, sondern ein Loch: 230 px graue
 * Fläche über jedem Profil, das noch nicht in den Einstellungen war — also
 * über den meisten. Die vier Bilder liegen ohnehin im Build.
 *
 * Gewählt wird DETERMINISTISCH aus dem Handle und nicht zufällig: Beim nächsten
 * Laden dasselbe Profil mit einem anderen Kopfbild zu sehen, sähe nach Fehler
 * aus, und zwei Personen mit verschiedenen Adressen bekommen so meist
 * verschiedene Bilder. Der Streuwert ist eine simple Summenfunktion — es geht
 * um Verteilung, nicht um Kryptografie.
 */
export function standardTitelbild(schluessel: string | null | undefined): string {
  const bilder = TITELBILDER
  const wort = schluessel?.trim().toLowerCase() ?? ''
  let summe = 0
  for (let i = 0; i < wort.length; i++) summe = (summe * 31 + wort.charCodeAt(i)) % 100_000
  return bilder[summe % bilder.length]!.datei
}
