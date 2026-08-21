// Auto-Benennung: Start-/Zielpunkt → Ortsnamen (Reverse-Geocoding) → Titel,
// Stops und Intro-Texte. Der Geocoder steckt hinter einem Interface: Nominatim
// in Produktion, ein Fake in Tests — und die App darf bereits offline benannt
// haben (dann wird hier gar nicht geocodiert).

export interface Geocoder {
  /** Ortsname zu einer Koordinate, null wenn nicht auflösbar. */
  placeName(lng: number, lat: number): Promise<string | null>
  /**
   * Die Adress-Ebenen derselben Stelle, von fein nach grob: „Völklingen",
   * „Regionalverband Saarbrücken", „Saarland", „Deutschland".
   *
   * Optional, damit Tests und der feste Geocoder unverändert bleiben. Sie sind
   * die Vorschläge für die Dachzeile im Studio — vorher behielten wir vom
   * Geocoding genau einen Treffer einer festen Prioritätenkette und warfen den
   * Rest weg, obwohl die Antwort ihn schon enthielt.
   */
  placeLevels?(lng: number, lat: number): Promise<string[]>
}

/** Nominatim (OSM) — bitte fair nutzen: eigener User-Agent, keine Request-Flut. */
export class NominatimGeocoder implements Geocoder {
  constructor(
    private readonly basisUrl = 'https://nominatim.openstreetmap.org',
    private readonly userAgent = 'Maptale/0.1 (https://maptale.io)',
  ) {}

  /**
   * Die letzte Antwort, damit `ortsname` und `ortsebenen` derselben Stelle
   * EINEN Aufruf teilen. Nominatim bittet ausdrücklich um sparsame Nutzung, und
   * beide Fragen beantwortet dieselbe Adress-Aufteilung.
   */
  private last: { key: string; address2: Record<string, string> | null } | null = null

  private async address2(lng: number, lat: number): Promise<Record<string, string> | null> {
    const key = `${lng},${lat}`
    if (this.last?.key === key) return this.last.address2
    let address2: Record<string, string> | null = null
    try {
      const url = `${this.basisUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=de`
      const response = await fetch(url, { headers: { 'User-Agent': this.userAgent } })
      if (response.ok) {
        const json = (await response.json()) as { address?: Record<string, string> }
        address2 = json.address ?? {}
      }
    } catch {
      address2 = null
    }
    this.last = { key, address2 }
    return address2
  }

  async placeName(lng: number, lat: number): Promise<string | null> {
    const a = await this.address2(lng, lat)
    if (!a) return null
    return (
      a.village ?? a.town ?? a.city ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county ?? null
    )
  }

  async placeLevels(lng: number, lat: number): Promise<string[]> {
    const a = await this.address2(lng, lat)
    return a ? levelsFromAddress(a) : []
  }
}

/**
 * Die Adress-Aufteilung zu einer Liste von fein nach grob, ohne Dubletten.
 *
 * Bewusst NICHT der Straßenname und nicht die Hausnummer: Die Dachzeile steht
 * über dem Titel einer Reise, nicht über einer Anschrift. Was ein
 * Sehenswürdigkeits-Name wäre (`tourism`, `attraction`), kommt bei `zoom=14`
 * ohnehin nicht mit — wer ihn will, schreibt ihn selbst hinein.
 */
export function levelsFromAddress(a: Record<string, string>): string[] {
  const candidates = [
    a.village,
    a.hamlet,
    a.suburb,
    a.town,
    a.city,
    a.municipality,
    a.county,
    a.state,
    a.country,
  ]
  const out: string[] = []
  for (const k of candidates) {
    const value = k?.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

export class FixedGeocoder implements Geocoder {
  /** Zahl der ortsname-Aufrufe — Tests prüfen damit die Geocoding-Vermeidung. */
  public calls = 0
  constructor(private readonly responses: ReadonlyArray<string | null>) {}
  private index = 0
  async placeName(): Promise<string | null> {
    this.calls++
    return this.responses[this.index++] ?? null
  }
}

export interface Naming {
  title: string
  brandTitle: string
  titleHtml: string
  kicker: string
  stops: string[]
  finaleTitle: string
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const germanDate = (iso: string, zone: string): string => {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 'unbekanntem Datum' // defensive Rückfallebene (POST validiert bereits)
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: zone,
    }).format(ms)
  } catch {
    return new Intl.DateTimeFormat('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(ms)
  }
}

/** Reverse-Geocoding-Ergebnis der beiden Endpunkte — reine Funktion der
 *  Koordinaten (unabhängig von Trim/Titel), daher der cachebare Teil. */
export interface Endpoints {
  startOrt: string | null
  zielOrt: string | null
  /**
   * Die Adress-Ebenen des STARTpunkts (fein → grob) als Vorschläge für die
   * Dachzeile. Fehlt bei Caches aus der Zeit davor und bei Geocodern, die sie
   * nicht liefern — dann bietet das Studio nur den Ortsnamen an.
   */
  startEbenen?: string[]
}

/**
 * Der EINZIGE Netz-Schritt der Benennung: die beiden Endpunkte zu Ortsnamen
 * auflösen. Bewusst getrennt vom Zusammenbau der Texte, damit die Anreicherung
 * das Ergebnis cachen kann (Ortsname einer Koordinate ist ein fixer Fakt).
 */
export async function geocodeEndpoints(
  geocoder: Geocoder,
  startPoint: [number, number],
  endPoint: [number, number],
): Promise<Endpoints> {
  const startOrt = await geocoder.placeName(startPoint[0], startPoint[1])
  // Die Ebenen VOR dem Zielpunkt holen: Der Nominatim-Geocoder hält genau eine
  // Antwort vor, ein Aufruf für den Zielpunkt dazwischen würfe sie weg und
  // kostete eine zweite Abfrage derselben Stelle.
  const startEbenen = (await geocoder.placeLevels?.(startPoint[0], startPoint[1])) ?? []
  const zielOrt = await geocoder.placeName(endPoint[0], endPoint[1])
  return { startOrt, zielOrt, ...(startEbenen.length ? { startEbenen } : {}) }
}

/**
 * Erzeugt die Anzeige-Texte aus den (ggf. gecachten) Ortsnamen — REIN, ohne
 * Netz. Ein vom Nutzer vergebener Titel hat immer Vorrang; `stops`/`finaleTitle`
 * kommen dagegen immer aus den Ortsnamen. Deshalb wird hier bei JEDEM Render neu
 * zusammengebaut (der Titel kann sich per PATCH ändern, ohne dass neu geocodiert
 * werden muss).
 */
export function buildNaming(args: {
  startOrt: string | null
  zielOrt: string | null
  userTitle: string | null
  /**
   * Die Dachzeile, wie sie im Studio steht. `null` heißt „nie gesetzt" und
   * nimmt die Vorbelegung (den Startort einer Rundtour), der LEERE String heißt
   * „ausdrücklich keine Zeile". Beides ist unterscheidbar, weil nur so jemand
   * die Zeile auch wieder loswerden kann.
   */
  kickerText?: string | null
  timeStart: string
  zone: string
}): Naming {
  const { startOrt, zielOrt, userTitle, kickerText, timeStart, zone } = args
  const date = germanDate(timeStart, zone)

  const roundTrip = startOrt !== null && startOrt === zielOrt
  const stops = roundTrip ? [startOrt] : [startOrt, zielOrt].filter((o): o is string => o !== null)

  let title: string
  if (userTitle && userTitle.trim()) {
    title = userTitle.trim()
  } else if (roundTrip) {
    title = `Runde bei ${startOrt}`
  } else if (startOrt && zielOrt) {
    title = `${startOrt} → ${zielOrt}`
  } else {
    title = `Tour vom ${date}`
  }

  // Die Dachzeile.
  //
  // Bis hierher stand dort „Aufgezeichnet am 14. Mai 2026" — ein Datum, in der
  // kräftigsten Farbe der Seite, über dem Titel. Das Datum steht jetzt in der
  // Herkunftszeile neben dem Namen, und die Dachzeile gehört dem Autor.
  //
  // Die VORBELEGUNG gibt es nur bei der Rundtour: Dort nennt der Titel schon
  // den Ort („Runde bei Völklingen"), und die Zeile darüber ordnet ihn ein. Bei
  // A nach B stehen beide Orte bereits im Titel oder in der Stationszeile — ein
  // Startort obendrüber wäre die dritte Nennung derselben Gegend.
  const kicker =
    kickerText === null || kickerText === undefined
      ? roundTrip
        ? (startOrt ?? '')
        : ''
      : kickerText.trim()

  return {
    title,
    brandTitle: title,
    titleHtml: titleToHtml(title),
    kicker,
    stops: stops.length ? stops : [title],
    finaleTitle: zielOrt ?? stops[stops.length - 1] ?? title,
  }
}

/**
 * Benennung in einem Rutsch (Geocoding + Zusammenbau) — Bequemlichkeit für
 * Direktaufrufe und Tests. Der Produktionspfad (Anreicherung) nutzt stattdessen
 * `geocodeEndpoints` (gecacht) + `buildNaming` (pro Render).
 */
export async function nameTour(args: {
  userTitle: string | null
  kickerText?: string | null
  startPoint: [number, number]
  endPoint: [number, number]
  timeStart: string
  zone: string
  geocoder: Geocoder
}): Promise<Naming> {
  const { userTitle, kickerText, startPoint, endPoint, timeStart, zone, geocoder } = args
  const places = await geocodeEndpoints(geocoder, startPoint, endPoint)
  return buildNaming({ ...places, userTitle, kickerText: kickerText ?? null, timeStart, zone })
}

/**
 * Intro-Titel mit Zeilenumbruch: bevorzugt am „→", sonst an der Wortgrenze,
 * die die Zeilen am ausgewogensten teilt. Namen werden HTML-escaped — nur
 * unser <br /> ist Markup.
 */
export function titleToHtml(title: string): string {
  const arrow = title.indexOf('→')
  if (arrow > 0) {
    const left = escapeHtml(title.slice(0, arrow).trim())
    const right = escapeHtml(title.slice(arrow).trim())
    return `${left}<br />${right}`
  }
  const words = title.split(/\s+/)
  if (words.length < 2) return escapeHtml(title)
  let bestSplit = 1
  let bestDifference = Number.POSITIVE_INFINITY
  for (let i = 1; i < words.length; i++) {
    const leftLength = words.slice(0, i).join(' ').length
    const rightLength = words.slice(i).join(' ').length
    const difference = Math.abs(leftLength - rightLength)
    if (difference < bestDifference) {
      bestDifference = difference
      bestSplit = i
    }
  }
  const left = escapeHtml(words.slice(0, bestSplit).join(' '))
  const right = escapeHtml(words.slice(bestSplit).join(' '))
  return `${left}<br />${right}`
}
