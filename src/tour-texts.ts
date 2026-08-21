/**
 * Die Texte des Startscreens — was gezeigt wird und was nicht.
 *
 * DOM-frei und ohne Import, damit Player, Studio und die Tests dieselbe Antwort
 * bekommen. Drei Entscheidungen stehen hier, und alle drei sind an einer
 * Beobachtung aus dem Player gewachsen, nicht am Datenmodell:
 *
 *  · Die BESCHREIBUNG hat eine Grenze (BESCHREIBUNG_MAX). Sie am Startscreen zu
 *    klemmen hieße raten, wo ein Satz endet, und zwar bei jeder Bildschirm-
 *    breite anders. Das Studio begrenzt deshalb schon beim Schreiben; was aus
 *    der Zeit davor länger ist, kürzt `truncateDescription` an der WORTGRENZE.
 *    Dieselbe Mechanik wie `alsBeschreibung` in server/src/seiten.ts, die die
 *    Vorschaukarte geteilter Links baut — nur mit der kleineren Zahl.
 *  · Die ROUTE erscheint nur, wenn sie etwas beiträgt. Bei aufgezeichneten
 *    Touren kommen Titel UND Stationen aus denselben zwei geocodierten
 *    Endpunkten, die Zeile wiederholte den Titel dann wortgleich („Runde bei
 *    Völklingen“ über „Völklingen“). Erst ein selbst geschriebener Titel macht
 *    die Stationen wieder zu einer eigenen Auskunft.
 *  · Die FILMDAUER wird gerundet und nicht abgeschnitten: „2:40“ für 159,6 s
 *    ist die ehrlichere Angabe als „2:39“.
 */

/** Zeichen, die eine Beschreibung tragen darf — Studio-Feld und Anzeige. */
export const DESCRIPTION_MAX = 150

/**
 * Eine Beschreibung, wie sie auf dem Startscreen steht: Leerraum normalisiert,
 * bei Überlänge an der letzten Wortgrenze gekappt. Leer wird zu `null`, damit
 * der Aufrufer die Zeile ganz weglassen kann statt einen leeren Absatz zu
 * setzen.
 */
export function truncateDescription(
  raw: string | null | undefined,
  max = DESCRIPTION_MAX,
): string | null {
  const text = raw?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const gap = cut.lastIndexOf(' ')
  // Steht die letzte Lücke ganz vorn (ein sehr langes Wort), wird hart gekappt —
  // sonst bliebe von einer 150-Zeichen-Grenze ein Fragment von zehn Zeichen.
  return `${(gap > max * 0.6 ? cut.slice(0, gap) : cut).trimEnd()}…`
}

/**
 * Soll die Stationszeile stehen? Ja, sobald eine Station nicht schon im Titel
 * vorkommt. Verglichen wird ohne Groß-/Kleinschreibung und ohne das Markup des
 * Titels (`titleHtml` trägt ein `<br />`).
 */
export function showRoute(stops: readonly string[], title: string): boolean {
  const withoutMarkup = title
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
  const real = stops.map((s) => s.trim()).filter(Boolean)
  if (!real.length) return false
  return real.some((s) => !withoutMarkup.includes(s.toLowerCase()))
}

/** Filmsekunden als „2:40“ bzw. „1:02:40“, kaufmännisch gerundet. */
export function formatFilmDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const twoDigits = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${twoDigits(m)}:${twoDigits(s)}` : `${m}:${twoDigits(s)}`
}

/**
 * Die Kennzahlen des Startscreens, in der Reihenfolge, in der sie stehen.
 *
 * Eine Null ist keine Angabe: „0 hm“ behauptet, es gäbe einen Wert, und stand
 * im Player neben „0.1 km“ wie ein Defekt. Solche Chips fallen weg statt eine
 * Null zu zeigen. Die Distanz trägt ein Dezimalkomma, weil der Rest der
 * Oberfläche das auch tut.
 */
export function stats(values: {
  filmDurationS?: number | null
  km?: number | null
  elevationGain?: number | null
  photos: number
}): Array<{ kind: 'dauer' | 'km' | 'hm' | 'fotos'; text: string }> {
  const out: Array<{ kind: 'dauer' | 'km' | 'hm' | 'fotos'; text: string }> = []
  if (values.filmDurationS != null && values.filmDurationS > 0)
    out.push({ kind: 'dauer', text: `${formatFilmDuration(values.filmDurationS)} Min` })
  if (values.km != null && values.km > 0)
    out.push({ kind: 'km', text: `${values.km.toFixed(1).replace('.', ',')} km` })
  if (values.elevationGain != null && values.elevationGain >= 1)
    out.push({ kind: 'hm', text: `${Math.round(values.elevationGain)} hm` })
  if (values.photos > 0)
    out.push({ kind: 'fotos', text: `${values.photos} ${values.photos === 1 ? 'Foto' : 'Fotos'}` })
  return out
}
