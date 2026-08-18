// Auto-Benennung: Start-/Zielpunkt → Ortsnamen (Reverse-Geocoding) → Titel,
// Stops und Intro-Texte. Der Geocoder steckt hinter einem Interface: Nominatim
// in Produktion, ein Fake in Tests — und die App darf bereits offline benannt
// haben (dann wird hier gar nicht geocodiert).

export interface Geocoder {
  /** Ortsname zu einer Koordinate, null wenn nicht auflösbar. */
  ortsname(lng: number, lat: number): Promise<string | null>
  /**
   * Die Adress-Ebenen derselben Stelle, von fein nach grob: „Völklingen",
   * „Regionalverband Saarbrücken", „Saarland", „Deutschland".
   *
   * Optional, damit Tests und der feste Geocoder unverändert bleiben. Sie sind
   * die Vorschläge für die Dachzeile im Studio — vorher behielten wir vom
   * Geocoding genau einen Treffer einer festen Prioritätenkette und warfen den
   * Rest weg, obwohl die Antwort ihn schon enthielt.
   */
  ortsebenen?(lng: number, lat: number): Promise<string[]>
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
  private letzte: { schluessel: string; adresse: Record<string, string> | null } | null = null

  private async adresse(lng: number, lat: number): Promise<Record<string, string> | null> {
    const schluessel = `${lng},${lat}`
    if (this.letzte?.schluessel === schluessel) return this.letzte.adresse
    let adresse: Record<string, string> | null = null
    try {
      const url = `${this.basisUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=de`
      const antwort = await fetch(url, { headers: { 'User-Agent': this.userAgent } })
      if (antwort.ok) {
        const json = (await antwort.json()) as { address?: Record<string, string> }
        adresse = json.address ?? {}
      }
    } catch {
      adresse = null
    }
    this.letzte = { schluessel, adresse }
    return adresse
  }

  async ortsname(lng: number, lat: number): Promise<string | null> {
    const a = await this.adresse(lng, lat)
    if (!a) return null
    return a.village ?? a.town ?? a.city ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county ?? null
  }

  async ortsebenen(lng: number, lat: number): Promise<string[]> {
    const a = await this.adresse(lng, lat)
    return a ? ebenenAusAdresse(a) : []
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
export function ebenenAusAdresse(a: Record<string, string>): string[] {
  const kandidaten = [
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
  const aus: string[] = []
  for (const k of kandidaten) {
    const wert = k?.trim()
    if (wert && !aus.includes(wert)) aus.push(wert)
  }
  return aus
}

export class FesterGeocoder implements Geocoder {
  /** Zahl der ortsname-Aufrufe — Tests prüfen damit die Geocoding-Vermeidung. */
  public aufrufe = 0
  constructor(private readonly antworten: ReadonlyArray<string | null>) {}
  private index = 0
  async ortsname(): Promise<string | null> {
    this.aufrufe++
    return this.antworten[this.index++] ?? null
  }
}

export interface Benennung {
  title: string
  brandTitle: string
  titleHtml: string
  kicker: string
  stops: string[]
  finaleTitle: string
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const datumDeutsch = (iso: string, zone: string): string => {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return 'unbekanntem Datum' // defensive Rückfallebene (POST validiert bereits)
  try {
    return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: zone }).format(ms)
  } catch {
    return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(ms)
  }
}

/** Reverse-Geocoding-Ergebnis der beiden Endpunkte — reine Funktion der
 *  Koordinaten (unabhängig von Trim/Titel), daher der cachebare Teil. */
export interface Endpunkte {
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
export async function geocodiereEndpunkte(
  geocoder: Geocoder,
  startPunkt: [number, number],
  zielPunkt: [number, number],
): Promise<Endpunkte> {
  const startOrt = await geocoder.ortsname(startPunkt[0], startPunkt[1])
  // Die Ebenen VOR dem Zielpunkt holen: Der Nominatim-Geocoder hält genau eine
  // Antwort vor, ein Aufruf für den Zielpunkt dazwischen würfe sie weg und
  // kostete eine zweite Abfrage derselben Stelle.
  const startEbenen = (await geocoder.ortsebenen?.(startPunkt[0], startPunkt[1])) ?? []
  const zielOrt = await geocoder.ortsname(zielPunkt[0], zielPunkt[1])
  return { startOrt, zielOrt, ...(startEbenen.length ? { startEbenen } : {}) }
}

/**
 * Erzeugt die Anzeige-Texte aus den (ggf. gecachten) Ortsnamen — REIN, ohne
 * Netz. Ein vom Nutzer vergebener Titel hat immer Vorrang; `stops`/`finaleTitle`
 * kommen dagegen immer aus den Ortsnamen. Deshalb wird hier bei JEDEM Render neu
 * zusammengebaut (der Titel kann sich per PATCH ändern, ohne dass neu geocodiert
 * werden muss).
 */
export function baueBenennung(args: {
  startOrt: string | null
  zielOrt: string | null
  nutzerTitel: string | null
  /**
   * Die Dachzeile, wie sie im Studio steht. `null` heißt „nie gesetzt" und
   * nimmt die Vorbelegung (den Startort einer Rundtour), der LEERE String heißt
   * „ausdrücklich keine Zeile". Beides ist unterscheidbar, weil nur so jemand
   * die Zeile auch wieder loswerden kann.
   */
  dachzeile?: string | null
  zeitStart: string
  zone: string
}): Benennung {
  const { startOrt, zielOrt, nutzerTitel, dachzeile, zeitStart, zone } = args
  const datum = datumDeutsch(zeitStart, zone)

  const rundtour = startOrt !== null && startOrt === zielOrt
  const stops = rundtour ? [startOrt] : [startOrt, zielOrt].filter((o): o is string => o !== null)

  let title: string
  if (nutzerTitel && nutzerTitel.trim()) {
    title = nutzerTitel.trim()
  } else if (rundtour) {
    title = `Runde bei ${startOrt}`
  } else if (startOrt && zielOrt) {
    title = `${startOrt} → ${zielOrt}`
  } else {
    title = `Tour vom ${datum}`
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
  const kicker = dachzeile === null || dachzeile === undefined ? (rundtour ? (startOrt ?? '') : '') : dachzeile.trim()

  return {
    title,
    brandTitle: title,
    titleHtml: titleZuHtml(title),
    kicker,
    stops: stops.length ? stops : [title],
    finaleTitle: zielOrt ?? stops[stops.length - 1] ?? title,
  }
}

/**
 * Benennung in einem Rutsch (Geocoding + Zusammenbau) — Bequemlichkeit für
 * Direktaufrufe und Tests. Der Produktionspfad (Anreicherung) nutzt stattdessen
 * `geocodiereEndpunkte` (gecacht) + `baueBenennung` (pro Render).
 */
export async function benenneTour(args: {
  nutzerTitel: string | null
  dachzeile?: string | null
  startPunkt: [number, number]
  zielPunkt: [number, number]
  zeitStart: string
  zone: string
  geocoder: Geocoder
}): Promise<Benennung> {
  const { nutzerTitel, dachzeile, startPunkt, zielPunkt, zeitStart, zone, geocoder } = args
  const orte = await geocodiereEndpunkte(geocoder, startPunkt, zielPunkt)
  return baueBenennung({ ...orte, nutzerTitel, dachzeile: dachzeile ?? null, zeitStart, zone })
}

/**
 * Intro-Titel mit Zeilenumbruch: bevorzugt am „→", sonst an der Wortgrenze,
 * die die Zeilen am ausgewogensten teilt. Namen werden HTML-escaped — nur
 * unser <br /> ist Markup.
 */
export function titleZuHtml(title: string): string {
  const pfeil = title.indexOf('→')
  if (pfeil > 0) {
    const links = escapeHtml(title.slice(0, pfeil).trim())
    const rechts = escapeHtml(title.slice(pfeil).trim())
    return `${links}<br />${rechts}`
  }
  const woerter = title.split(/\s+/)
  if (woerter.length < 2) return escapeHtml(title)
  let besteTrennung = 1
  let besteDifferenz = Number.POSITIVE_INFINITY
  for (let i = 1; i < woerter.length; i++) {
    const linksLaenge = woerter.slice(0, i).join(' ').length
    const rechtsLaenge = woerter.slice(i).join(' ').length
    const differenz = Math.abs(linksLaenge - rechtsLaenge)
    if (differenz < besteDifferenz) {
      besteDifferenz = differenz
      besteTrennung = i
    }
  }
  const links = escapeHtml(woerter.slice(0, besteTrennung).join(' '))
  const rechts = escapeHtml(woerter.slice(besteTrennung).join(' '))
  return `${links}<br />${rechts}`
}
