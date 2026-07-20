// Remote-Touren: lädt aufgezeichnete Touren vom Luhambo-Backend (?tour=srv:<id>)
// und adaptiert das Server-JSON (`luhambo/tour@1`) auf die cfg-Form der
// statischen TOURS-Registry — der restliche Player merkt keinen Unterschied.
// Neue Web-Module entstehen in TypeScript; der Bestand bleibt bewusst JS.

/** Ein Medium der Tour — für den Player ein „Foto" mit optionalem Video-Typ (M4). */
export interface RemoteMedium {
  id: string
  type: 'photo' | 'video'
  src: string
  title: string
  caption: string
  /** null = unplatziert (M6): kein Track-Anker, wird nicht abgespielt */
  anchor: [number, number] | null
  /** Herkunft des Ankers (M6): gps | zeit | manuell | unplatziert */
  placement?: string
  takenAt: string
  durationS?: number
  poster?: string
  /** Anzeige-Optionen aus dem Studio (Kreativbaukasten): Haltedauer + Ken-Burns */
  display?: { holdS?: number; kenBurns?: boolean }
}

/** Server-JSON `luhambo/tour@1` (Ausschnitt, den der Player braucht). */
export interface TourJsonAntwort {
  schema: string
  id: string
  status?: string
  fehler?: string | null
  no: string
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  finaleTitle: string
  description: string | null
  time: { start: string; end: string; zone: string }
  segments: Array<{ mode: string; label: string; pts: Array<[number, number, number]> }>
  media: RemoteMedium[]
  /** Wetter-Keyframes über den Streckenanteil f (kommt in M2 vom Server) */
  weather?: Array<{ f: number; mode: string; k: number; source?: string }>
  timeline?: Array<{ f: number; t: string }>
  /** Kamera-Keyframes über den Streckenanteil f (Kreativbaukasten): Preset ab f */
  camera?: Array<{ f: number; preset: string; skala?: number }>
  /** Kamera-Momente über den Streckenanteil f: Punkt-Ereignisse (Umkreisen/…) */
  moments?: Array<{ f: number; art: string; dauerS?: number }>
  /** Audio-Spuren über den Streckenanteil f: Musik-Bereiche [f0,f1) + SFX (f0=f1) */
  audio?: Array<{ type: string; src: string; f0: number; f1: number; gain?: number }>
  stats: { km: number; gainM: number }
}

/** cfg-Form, die main.js versteht (Felder wie in src/tours.js) plus Remote-Extras. */
export interface RemoteTourCfg {
  id: string
  no: string
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  finaleTitle: string
  time: { start: string; end: string; zone: string }
  segments: Array<{ mode: string; label: string; pts: Array<[number, number, number]> }>
  photos: Array<{
    src: string
    title: string
    caption: string
    anchor: [number, number]
    takenAt: string
    type: 'photo' | 'video'
    durationS?: number
    poster?: string
    display?: { holdS?: number; kenBurns?: boolean }
  }>
  /** Kuratierte Wetter-Timeline im Player-Format (km entlang der Route) */
  weather?: Array<{ km: number; mode: string; k: number }>
  timeline?: Array<{ f: number; t: string }>
  /** Kamera-Keyframes (roh, f-basiert — main.js rechnet frac = s/total selbst) */
  camera?: Array<{ f: number; preset: string; skala?: number }>
  /** Kamera-Momente (roh, f-basiert — main.js verankert sie an s) */
  moments?: Array<{ f: number; art: string; dauerS?: number }>
  /** Tour-eigene Audio-Spuren (roh, f-basiert — audiotracks.js spielt sie ab) */
  audio?: Array<{ type: string; src: string; f0: number; f1: number; gain?: number }>
  stats: { km: number; gainM: number }
}

export class RemoteTourFehler extends Error {
  constructor(
    message: string,
    /** Verarbeitungsstatus des Servers, falls die Tour noch nicht abspielbar ist */
    public readonly status?: string,
  ) {
    super(message)
    this.name = 'RemoteTourFehler'
  }
}

/**
 * Adaptiert das Server-JSON auf die cfg-Form. Reine Funktion (der fetch steckt
 * in loadRemoteTour) — direkt testbar.
 *
 * Wetter: der Server liefert Keyframes über den Streckenanteil f; der Player
 * spielt kuratierte Timelines in km ab (main.js koppelt cfg.weather mit Vorrang
 * vor dem Client-Auto-Wetter). km = f · Gesamt-km des Servers — die minimale
 * Abweichung zum Client-Resampling ist bei Wetter-Grenzen bedeutungslos.
 */
export function adaptiereTour(tour: TourJsonAntwort): RemoteTourCfg {
  if (tour.schema !== 'luhambo/tour@1') {
    throw new RemoteTourFehler(
      tour.status === 'verarbeitung'
        ? 'Die Tour wird noch verarbeitet — gleich noch einmal versuchen.'
        : `Tour nicht abspielbar (Status: ${tour.status ?? 'unbekannt'}${tour.fehler ? `, ${tour.fehler}` : ''})`,
      tour.status,
    )
  }
  const cfg: RemoteTourCfg = {
    id: tour.id,
    no: tour.no,
    brandTitle: tour.brandTitle,
    kicker: tour.kicker,
    titleHtml: tour.titleHtml,
    stops: tour.stops,
    finaleTitle: tour.finaleTitle,
    time: tour.time,
    segments: tour.segments,
    // Fotos UND Videos (M4): beide werden im Foto-Overlay als Stopp gezeigt,
    // Videos halten bis zum Ende statt für eine feste Dauer (tour.js/ui.js).
    // Unplatzierte Medien (anchor null, M6) hat der Player nirgends zu verorten.
    photos: tour.media
      .filter((m) => Array.isArray(m.anchor))
      .map((m) => ({
        src: m.src,
        title: m.title,
        caption: m.caption,
        anchor: m.anchor as [number, number],
        takenAt: m.takenAt,
        type: m.type,
        ...(m.durationS !== undefined ? { durationS: m.durationS } : {}),
        ...(m.poster !== undefined ? { poster: m.poster } : {}),
        ...(m.display !== undefined ? { display: m.display } : {}),
      })),
    stats: tour.stats,
  }
  if (tour.weather?.length) {
    cfg.weather = tour.weather.map((w) => ({ km: w.f * tour.stats.km, mode: w.mode, k: w.k }))
  }
  if (tour.timeline?.length) cfg.timeline = tour.timeline
  // Kamera-Keyframes + Audio-Spuren ROH durchreichen (f-basiert — main.js
  // rechnet frac = tour.s/route.total selbst). Kaputte f-Werte fliegen raus
  // (Muster createTimeAt); leere Ergebnisse lassen das Feld ganz weg.
  if (tour.camera?.length) {
    const kamera = tour.camera.filter((k) => Number.isFinite(k.f))
    if (kamera.length) cfg.camera = kamera
  }
  if (tour.moments?.length) {
    // f muss endlich sein (landet als s-Anker in der Engine); dauerS optional,
    // aber wenn gesetzt endlich (sonst NaN-Timer im Moment-Zweig).
    const momente = tour.moments.filter((m) => Number.isFinite(m.f) && (m.dauerS === undefined || Number.isFinite(m.dauerS)))
    if (momente.length) cfg.moments = momente
  }
  if (tour.audio?.length) {
    // gain ist optional — aber wenn gesetzt, muss er endlich sein: NaN liefe
    // sonst bis in el.volume und würfe dort im Abspiel-Timer Exceptions.
    const spuren = tour.audio.filter(
      (a) => Number.isFinite(a.f0) && Number.isFinite(a.f1) && (a.gain === undefined || Number.isFinite(a.gain)),
    )
    if (spuren.length) cfg.audio = spuren
  }
  return cfg
}

/**
 * Nichtlineare Pseudo-Zeit (M2): stückweise lineare Abbildung Streckenanteil →
 * Zeitstempel (ms) aus den timeline-Stützstellen des Servers — Pausen sind dort
 * bereits auf 2 min komprimiert, die Pseudo-Sonne springt beim Überfahren also
 * nicht. Ohne (brauchbare) Timeline fällt die Abbildung auf die lineare
 * Interpolation t0→t1 zurück — exakt das Verhalten der statischen Touren.
 */
export function createTimeAt(
  timeline: Array<{ f: number; t: string }> | undefined,
  t0: number,
  t1: number,
): (frac: number) => number {
  const clamp = (x: number) => Math.max(0, Math.min(1, x))
  const linear = (frac: number) => t0 + clamp(frac) * (t1 - t0)
  if (!timeline?.length) return linear
  const punkte = timeline
    .map((e) => ({ f: e.f, t: Date.parse(e.t) }))
    .filter((e) => Number.isFinite(e.f) && Number.isFinite(e.t))
    .sort((a, b) => a.f - b.f)
  if (punkte.length < 2) return linear
  const erster = punkte[0]!
  const letzter = punkte[punkte.length - 1]!
  return (frac: number) => {
    const f = clamp(frac)
    if (f <= erster.f) return erster.t
    if (f >= letzter.f) return letzter.t
    // Binärsuche: erste Stützstelle mit punkte[hi].f >= f
    let lo = 0
    let hi = punkte.length - 1
    while (lo < hi) {
      const mitte = (lo + hi) >> 1
      if (punkte[mitte]!.f < f) lo = mitte + 1
      else hi = mitte
    }
    const b = punkte[hi]!
    const a = punkte[hi - 1]!
    const spanne = b.f - a.f
    return spanne <= 0 ? b.t : a.t + ((f - a.f) / spanne) * (b.t - a.t)
  }
}

/** Tour vom Backend laden; wirft RemoteTourFehler bei 404/Verarbeitung/Fehler. */
export async function loadRemoteTour(id: string, basisUrl = ''): Promise<RemoteTourCfg> {
  const antwort = await fetch(`${basisUrl}/api/tours/${encodeURIComponent(id)}`)
  if (!antwort.ok) {
    throw new RemoteTourFehler(`Tour „${id}" nicht gefunden (HTTP ${antwort.status})`)
  }
  return adaptiereTour((await antwort.json()) as TourJsonAntwort)
}

/**
 * Eigene Server-Touren für den Tour-Picker (nur mit gültiger Anmeldung —
 * anonym liefert die Liste 401 und der Picker bleibt statisch).
 */
export async function ladeServerTouren(
  basisUrl = '',
): Promise<Array<{ id: string; title: string | null; status: string }>> {
  try {
    const antwort = await fetch(`${basisUrl}/api/tours`, { credentials: 'same-origin' })
    if (!antwort.ok) return []
    const json = (await antwort.json()) as { tours: Array<{ id: string; title: string | null; status: string }> }
    return json.tours.filter((t) => t.status === 'bereit')
  } catch {
    return []
  }
}
