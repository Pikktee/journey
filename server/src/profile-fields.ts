/**
 * Website und Instagram auf ihre NACKTE Form bringen — `henrikheil.net`,
 * `henrik.unterwegs`.
 *
 * Gespeichert wird ohne Schema und ohne `@`, weil dieselbe Adresse sonst in
 * drei Schreibweisen in der Spalte stünde: getippt, eingefügt und aus dem
 * Browser kopiert. Das Schema gehört zur Anzeige (die Profilseite baut daraus
 * `https://…`), nicht zum Wert.
 *
 * Das läuft NUR hier, nicht auch im Browser: Der Server ist die Instanz, die
 * schreibt, und eine zweite Fassung derselben Regeln im Web wäre die nächste
 * Kopie, die auseinanderläuft (s. handle.ts, wo sie unvermeidlich war). Das
 * Formular zeigt `https://` und `@` als feststehendes Vorzeichen an — das ist
 * Anzeige, keine Regel.
 */

/** Was nach dem Aufräumen übrig bleiben muss, damit es eine Adresse sein kann. */
const WEB_ALLOWED = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i

/**
 * Ein mitgeliefertes Titelbild — nur der Dateiname, kein Pfad.
 *
 * WELCHE vier es gibt, weiß der Server bewusst nicht: Die Auswahl steht im
 * Dialog (`src/profile/profile-banners.ts`), die Bilder liegen als statische Dateien
 * im Build. Hier wird nur die FORM geprüft — kein Schrägstrich, kein `..` —,
 * denn der Wert landet in einer URL. Ein erfundener Name kostet nichts: Dann
 * lädt das eigene Banner nicht, und sonst passiert nichts.
 */
const SUGGESTION = /^[a-z0-9-]+\.jpg$/

export function isBannerSuggestion(value: string): boolean {
  return SUGGESTION.test(value)
}

/**
 * Öffentliche Adresse des Titelbilds — statische Datei oder eigener Upload.
 *
 * Unterschieden wird am Schrägstrich: Ein Vorschlag ist ein blanker Dateiname,
 * ein eigenes Bild liegt unter `banner/<zeitstempel>.jpg` im Benutzer-Storage.
 * Der Dateiname hängt wie beim Avatar als `?v=` dran und bricht den Cache.
 */
export function bannerUrl(userId: string, value: string | null): string | null {
  if (!value) return null
  if (!value.includes('/')) return `/titelbilder/${value}`
  return `/api/users/${userId}/banner?v=${encodeURIComponent(value)}`
}

/**
 * `https://henrikheil.net/` → `henrikheil.net`.
 *
 * Ein abschließender Schrägstrich fällt weg (er ist bedeutungslos und sähe in
 * der Chip-Beschriftung nach Tippfehler aus), ein Pfad bleibt dagegen stehen:
 * Wer auf eine Unterseite verweist, meint sie auch. Was nicht wie eine Domain
 * aussieht, wird verworfen statt „repariert" — ein halb geratener Link führt
 * ins Leere, und das fällt erst dem Leser auf.
 */
export function normalizeWebsite(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
  if (!value) return null
  return WEB_ALLOWED.test(value) ? value.slice(0, 200) : null
}

/**
 * `@henrik.unterwegs`, `instagram.com/henrik.unterwegs/` → `henrik.unterwegs`.
 *
 * Instagram erlaubt 1–30 Zeichen aus Buchstaben, Ziffern, Punkt und
 * Unterstrich. Wer eine ganze Profil-URL einfügt, meint den Namen darin —
 * deshalb wird sie zerlegt, statt sie abzulehnen.
 */
export function normalizeInstagram(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^(?:www\.)?instagram\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '')
  if (!value) return null
  return /^[A-Za-z0-9._]{1,30}$/.test(value) ? value : null
}
