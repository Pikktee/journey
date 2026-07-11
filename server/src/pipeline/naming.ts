// Auto-Benennung: Start-/Zielpunkt → Ortsnamen (Reverse-Geocoding) → Titel,
// Stops und Intro-Texte. Der Geocoder steckt hinter einem Interface: Nominatim
// in Produktion, ein Fake in Tests — und die App darf bereits offline benannt
// haben (dann wird hier gar nicht geocodiert).

export interface Geocoder {
  /** Ortsname zu einer Koordinate, null wenn nicht auflösbar. */
  ortsname(lng: number, lat: number): Promise<string | null>
}

/** Nominatim (OSM) — bitte fair nutzen: eigener User-Agent, keine Request-Flut. */
export class NominatimGeocoder implements Geocoder {
  constructor(
    private readonly basisUrl = 'https://nominatim.openstreetmap.org',
    private readonly userAgent = 'Luhambo/0.1 (kontakt: siehe Repo)',
  ) {}

  async ortsname(lng: number, lat: number): Promise<string | null> {
    try {
      const url = `${this.basisUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=de`
      const antwort = await fetch(url, { headers: { 'User-Agent': this.userAgent } })
      if (!antwort.ok) return null
      const json = (await antwort.json()) as { address?: Record<string, string> }
      const a = json.address ?? {}
      return a.village ?? a.town ?? a.city ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county ?? null
    } catch {
      return null
    }
  }
}

export class FesterGeocoder implements Geocoder {
  constructor(private readonly antworten: ReadonlyArray<string | null>) {}
  private index = 0
  async ortsname(): Promise<string | null> {
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

/**
 * Erzeugt die Anzeige-Texte einer Tour. Ein vom Nutzer vergebener Titel hat
 * immer Vorrang; geocodiert wird nur für die automatische Benennung und die
 * Stops-Zeile.
 */
export async function benenneTour(args: {
  nutzerTitel: string | null
  startPunkt: [number, number]
  zielPunkt: [number, number]
  zeitStart: string
  zone: string
  geocoder: Geocoder
}): Promise<Benennung> {
  const { nutzerTitel, startPunkt, zielPunkt, zeitStart, zone, geocoder } = args
  const datum = datumDeutsch(zeitStart, zone)

  const startOrt = await geocoder.ortsname(startPunkt[0], startPunkt[1])
  const zielOrt = await geocoder.ortsname(zielPunkt[0], zielPunkt[1])

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

  return {
    title,
    brandTitle: title,
    titleHtml: titleZuHtml(title),
    kicker: `Aufgezeichnet am ${datum}`,
    stops: stops.length ? stops : [title],
    finaleTitle: zielOrt ?? stops[stops.length - 1] ?? title,
  }
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
