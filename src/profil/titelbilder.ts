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
  /** Wird als Alternativtext gelesen, wenn das Bild nicht lädt. */
  wort: string
}

export const TITELBILDER: readonly Titelbild[] = [
  { datei: 'serpentinen.jpg', wort: 'Serpentinen am Bergpass' },
  { datei: 'kueste.jpg', wort: 'Küstenstraße über dem Meer' },
  { datei: 'nachtstadt.jpg', wort: 'Stadt bei Nacht' },
  { datei: 'wueste.jpg', wort: 'Piste durch die Wüste' },
]

/** Öffentlicher Pfad eines mitgelieferten Bildes — dieselbe Form wie im Server. */
export function titelbildPfad(datei: string): string {
  return `/titelbilder/${datei}`
}
