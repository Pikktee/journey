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
export interface Banner {
  file: string
  /** Die Bildunterschrift unter der Kachel — kurz, damit sie in eine Zeile passt. */
  name: string
  /** Wird als Alternativtext gelesen, wenn das Bild nicht lädt. */
  alt: string
}

export const BANNERS: readonly Banner[] = [
  { file: 'serpentinen.jpg', name: 'Bergpass', alt: 'Serpentinen am Bergpass' },
  { file: 'kueste.jpg', name: 'Küstenstraße', alt: 'Küstenstraße über dem Meer' },
  { file: 'nachtstadt.jpg', name: 'Stadt bei Nacht', alt: 'Stadt bei Nacht' },
  { file: 'wueste.jpg', name: 'Wüstenpiste', alt: 'Piste durch die Wüste' },
]

/** Öffentlicher Pfad eines mitgelieferten Bildes — dieselbe Form wie im Server. */
export function bannerPath(file: string): string {
  return `/titelbilder/${file}`
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
export function defaultBanner(key: string | null | undefined): string {
  const images = BANNERS
  const word = key?.trim().toLowerCase() ?? ''
  let sum = 0
  for (let i = 0; i < word.length; i++) sum = (sum * 31 + word.charCodeAt(i)) % 100_000
  return images[sum % images.length]!.file
}
