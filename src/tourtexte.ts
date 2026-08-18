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
 *    der Zeit davor länger ist, kürzt `kuerzeBeschreibung` an der WORTGRENZE.
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
export const BESCHREIBUNG_MAX = 150

/**
 * Eine Beschreibung, wie sie auf dem Startscreen steht: Leerraum normalisiert,
 * bei Überlänge an der letzten Wortgrenze gekappt. Leer wird zu `null`, damit
 * der Aufrufer die Zeile ganz weglassen kann statt einen leeren Absatz zu
 * setzen.
 */
export function kuerzeBeschreibung(roh: string | null | undefined, max = BESCHREIBUNG_MAX): string | null {
  const text = roh?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= max) return text
  const knapp = text.slice(0, max)
  const luecke = knapp.lastIndexOf(' ')
  // Steht die letzte Lücke ganz vorn (ein sehr langes Wort), wird hart gekappt —
  // sonst bliebe von einer 150-Zeichen-Grenze ein Fragment von zehn Zeichen.
  return `${(luecke > max * 0.6 ? knapp.slice(0, luecke) : knapp).trimEnd()}…`
}

/**
 * Soll die Stationszeile stehen? Ja, sobald eine Station nicht schon im Titel
 * vorkommt. Verglichen wird ohne Groß-/Kleinschreibung und ohne das Markup des
 * Titels (`titleHtml` trägt ein `<br />`).
 */
export function zeigeRoute(stops: readonly string[], titel: string): boolean {
  const ohneMarkup = titel
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
  const echte = stops.map((s) => s.trim()).filter(Boolean)
  if (!echte.length) return false
  return echte.some((s) => !ohneMarkup.includes(s.toLowerCase()))
}

/** Filmsekunden als „2:40“ bzw. „1:02:40“, kaufmännisch gerundet. */
export function formatiereFilmdauer(sekunden: number): string {
  const gesamt = Math.max(0, Math.round(sekunden))
  const s = gesamt % 60
  const m = Math.floor(gesamt / 60) % 60
  const h = Math.floor(gesamt / 3600)
  const zwei = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${zwei(m)}:${zwei(s)}` : `${m}:${zwei(s)}`
}

/**
 * Die Kennzahlen des Startscreens, in der Reihenfolge, in der sie stehen.
 *
 * Eine Null ist keine Angabe: „0 hm“ behauptet, es gäbe einen Wert, und stand
 * im Player neben „0.1 km“ wie ein Defekt. Solche Chips fallen weg statt eine
 * Null zu zeigen. Die Distanz trägt ein Dezimalkomma, weil der Rest der
 * Oberfläche das auch tut.
 */
export function kennzahlen(werte: {
  filmDauerS?: number | null
  km?: number | null
  hoehenmeter?: number | null
  fotos: number
}): Array<{ art: 'dauer' | 'km' | 'hm' | 'fotos'; text: string }> {
  const aus: Array<{ art: 'dauer' | 'km' | 'hm' | 'fotos'; text: string }> = []
  if (werte.filmDauerS != null && werte.filmDauerS > 0)
    aus.push({ art: 'dauer', text: `${formatiereFilmdauer(werte.filmDauerS)} Min` })
  if (werte.km != null && werte.km > 0)
    aus.push({ art: 'km', text: `${werte.km.toFixed(1).replace('.', ',')} km` })
  if (werte.hoehenmeter != null && werte.hoehenmeter >= 1)
    aus.push({ art: 'hm', text: `${Math.round(werte.hoehenmeter)} hm` })
  if (werte.fotos > 0) aus.push({ art: 'fotos', text: `${werte.fotos} ${werte.fotos === 1 ? 'Foto' : 'Fotos'}` })
  return aus
}
