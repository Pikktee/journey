// Remote-Touren: lädt aufgezeichnete Touren vom Maptale-Backend (/tour/t_<id>)
// und adaptiert das Server-JSON (`maptale/tour@2`) auf die cfg-Form der
// statischen TOURS-Registry — der restliche Player merkt keinen Unterschied.

import { STUDIO_GAIN_DEFAULT } from './audiotracks.js'
import type { TourAudio } from './tours.js'

/** Ein Medium der Tour — für den Player ein „Foto" mit optionalem Video-Typ (M4). */
export interface RemoteMedium {
  id: string
  type: 'photo' | 'video'
  src: string
  title: string
  caption: string
  /** null = unplatziert (M6): kein Track-Anker, wird nicht abgespielt */
  anchor: [number, number] | null
  /** Herkunft des Ankers (M6): gps | time | manual | unplaced */
  placement?: string
  takenAt: string
  durationS?: number
  poster?: string
  /** Kachel-Fassung (Listen, Pin-Köpfe); fehlt bei unaufbereitetem Altbestand */
  thumb?: string
  /** Anzeige-Optionen aus dem Studio (Kreativbaukasten): Haltedauer + Ken-Burns */
  display?: { holdS?: number; kenBurns?: boolean }
  /** Platz im Foto-Stopp (0-basiert) — greift in gruppiereStopps (src/geo.ts) */
  order?: number
}

/** Server-JSON `maptale/tour@2` (Ausschnitt, den der Player braucht). */
export interface TourJsonAntwort {
  schema: string
  id: string
  status?: string
  error?: string | null
  no: string
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  /** Ob der Player den „Ziel erreicht"-Screen zeigt */
  showFinale?: boolean
  finaleTitle: string
  description: string | null
  /**
   * Wer die Tour aufgenommen hat. Steht NICHT in der gerenderten Datei, sondern
   * setzt die Route bei jeder Auslieferung frisch ein (server/src/routes/tours.ts)
   * — ein eingebackener Name wäre nach dem nächsten Wechsel falsch. Fehlt, wenn
   * niemand einen Anzeigenamen gesetzt hat; `handle`/`id` nur bei öffentlichem
   * Profil, sonst gibt es keine Seite, auf die der Name führen könnte.
   */
  author?: {
    displayName: string
    avatarUrl: string | null
    id?: string
    handle?: string | null
  }
  time: { start: string; end: string; zone: string }
  segments: Array<{
    mode: string
    label: string
    pts: Array<[number, number, number]>
    /** Streckenanteil je Punkt, roh gemessen (E11); fehlt bei Altbestand */
    f?: number[]
  }>
  media: RemoteMedium[]
  /** Wetter-Keyframes über den Streckenanteil f (kommt in M2 vom Server) */
  weather?: Array<{ f: number; mode: string; k: number; source?: string }>
  timeline?: Array<{ f: number; t: string }>
  /**
   * Kamera-Keyframes (Kreativbaukasten): Preset ab dieser Stelle. `f` ist der
   * Streckenanteil, `filmS` die Filmsekunde (E10) — sie geht vor, wo sie steht.
   */
  camera?: Array<{ f: number; preset: string; scale?: number; filmS?: number }>
  /** Kamera-Momente: Punkt-Ereignisse (Umkreisen/…) mit Streckenanteil und Filmsekunde */
  moments?: Array<{ f: number; kind: string; durationS?: number; filmS?: number }>
  /** Audio-Spuren: Musik-Bereiche [f0,f1) + SFX (f0=f1), dazu ihre Film-Anker (E10) */
  audio?: Array<{
    type: string
    src: string
    f0: number
    f1: number
    gain?: number
    loop?: boolean
    startS?: number
    filmS?: number
    filmToS?: number
  }>
  stats: { km: number; gainM: number }
}

/** cfg-Form, die main.ts versteht (Felder wie in src/tours.ts) plus Remote-Extras. */
export interface RemoteTourCfg {
  id: string
  no: string
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  /** Der Satz unter dem Titel — aus dem Studio, gekürzt in src/tour-texts.ts. */
  description?: string | null
  /** Aufnehmer der Tour; fehlt bei Konten ohne Anzeigenamen */
  author?: NonNullable<TourJsonAntwort['author']>
  /** true = Endscreen; fehlt/false = zurück zum Startscreen */
  showFinale?: boolean
  finaleTitle: string
  time: { start: string; end: string; zone: string }
  segments: Array<{
    mode: string
    label: string
    pts: Array<[number, number, number]>
    /** Streckenanteil je Punkt (E11) — main.ts baut daraus die f→s-Tabelle */
    f?: number[]
  }>
  photos: Array<{
    src: string
    title: string
    caption: string
    anchor: [number, number]
    takenAt: string
    type: 'photo' | 'video'
    durationS?: number
    poster?: string
    thumb?: string
    display?: { holdS?: number; kenBurns?: boolean }
  }>
  /**
   * Wetter-Keyframes ROH, über den Streckenanteil f — anders als die
   * kuratierten Touren, die ihre Timeline in km führen (src/tours.ts).
   * Bis E11 rechnete der Adapter hier `km = f · Gesamt-km` und der Player
   * `s = km · 1000`; beides zusammen war der Rückfall `f × total` mit
   * Zwischenschritt. main.ts übersetzt jetzt über die Wegpunkt-Tabelle.
   */
  weatherF?: Array<{ f: number; mode: string; k: number }>
  timeline?: Array<{ f: number; t: string }>
  /** Kamera-Keyframes (roh — main.ts übersetzt f bzw. filmS selbst) */
  camera?: Array<{ f: number; preset: string; scale?: number; filmS?: number }>
  /** Kamera-Momente (roh, f-basiert — main.ts verankert sie an s) */
  moments?: Array<{ f: number; kind: string; durationS?: number; filmS?: number }>
  /** Tour-eigene Audio-Spuren (roh — main.ts übersetzt in Filmsekunden) */
  audio?: TourAudio[]
  /**
   * Master über `audio`. Bei aufgezeichneten Touren immer 1: `gain` kommt aus
   * dem Regler des Studios und ist bereits der Pegel, den der Autor beim
   * Schneiden gehört hat (s. TourConfig.audioPegel). KEIN Server-Feld — die
   * Aussage gehört zur Herkunft der Tour, nicht zu ihren Daten.
   */
  audioPegel?: number
  stats: { km: number; gainM: number }
}

export class RemoteTourError extends Error {
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
 * **Alles f-Verankerte geht ROH durch.** Wetter, Kamera-Keyframes, Momente und
 * Ton-Bereiche behalten ihr `f`; main.ts übersetzt es EINMAL beim Laden über
 * die Wegpunkt-Tabelle nach Streckenmetern (src/route-anchors.ts) und rechnet
 * danach nur noch in Metern. Der Adapter rechnete früher `km = f · Gesamt-km`
 * — das war der Rückfall `f × total` in Verkleidung.
 */
export function adaptTour(tour: TourJsonAntwort): RemoteTourCfg {
  if (tour.schema !== 'maptale/tour@2') {
    throw new RemoteTourError(
      tour.status === 'processing'
        ? 'Die Tour wird noch verarbeitet. Gleich noch einmal versuchen.'
        : `Tour nicht abspielbar (Status: ${tour.status ?? 'unbekannt'}${tour.error ? `, ${tour.error}` : ''})`,
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
    // Die Beschreibung. Sie stand im Antwort-Typ, kam aber nie in der cfg an —
    // der Editor pflegte sie, die Datenbank hielt sie, und der Player warf sie
    // an genau dieser Stelle weg.
    description: tour.description,
    ...(tour.author ? { author: tour.author } : {}),
    showFinale: tour.showFinale === true,
    finaleTitle: tour.finaleTitle,
    time: tour.time,
    segments: tour.segments,
    // Fotos UND Videos (M4): beide werden im Foto-Overlay als Stopp gezeigt,
    // Videos halten bis zum Ende statt für eine feste Dauer (tour.ts/ui.ts).
    // Unplatzierte Medien (anker null, M6) hat der Player nirgends zu verorten.
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
        ...(m.thumb !== undefined ? { thumb: m.thumb } : {}),
        ...(m.display !== undefined ? { display: m.display } : {}),
        ...(m.order !== undefined ? { order: m.order } : {}),
      })),
    stats: tour.stats,
  }
  if (tour.weather?.length) {
    // Roh durchreichen (f-basiert) — die Übersetzung nach Streckenmetern macht
    // main.ts über die Wegpunkt-Tabelle. Kaputte f fliegen raus (Muster
    // createTimeAt); leere Ergebnisse lassen das Feld ganz weg.
    const keyframes = tour.weather.filter((w) => Number.isFinite(w.f))
    if (keyframes.length) cfg.weatherF = keyframes.map((w) => ({ f: w.f, mode: w.mode, k: w.k }))
  }
  if (tour.timeline?.length) cfg.timeline = tour.timeline
  // Kamera-Keyframes + Audio-Spuren ROH durchreichen (f-basiert — main.ts
  // rechnet frac = tour.s/route.total selbst). Kaputte f-Werte fliegen raus
  // (Muster createTimeAt); leere Ergebnisse lassen das Feld ganz weg.
  if (tour.camera?.length) {
    // Ein kaputter `filmS` fällt weg statt den Keyframe mitzunehmen — main.ts
    // rechnet ihn dann wie bei Bestandsdaten aus `f`.
    const kamera = tour.camera
      .filter((k) => Number.isFinite(k.f))
      .map(({ filmS, ...rest }) =>
        Number.isFinite(filmS) ? { ...rest, filmS: filmS as number } : rest,
      )
    if (kamera.length) cfg.camera = kamera
  }
  if (tour.moments?.length) {
    // f muss endlich sein (landet als s-Anker in der Engine); dauerS optional,
    // aber wenn gesetzt endlich (sonst NaN-Timer im Moment-Zweig).
    const momente = tour.moments.filter(
      (m) => Number.isFinite(m.f) && (m.durationS === undefined || Number.isFinite(m.durationS)),
    )
    if (momente.length) cfg.moments = momente
  }
  if (tour.audio?.length) {
    // gain ist optional — aber wenn gesetzt, muss er endlich sein: NaN liefe
    // sonst bis in el.volume und würfe dort im Abspiel-Timer Exceptions.
    // `startS` ist der Einstieg in die Datei (Etappe 4) — ein NaN darüber
    // landete in el.currentTime und riss dort die Wiedergabe ab.
    const spuren = tour.audio.filter(
      (a) =>
        Number.isFinite(a.f0) &&
        Number.isFinite(a.f1) &&
        (a.gain === undefined || Number.isFinite(a.gain)) &&
        (a.startS === undefined || (Number.isFinite(a.startS) && a.startS >= 0)),
    )
    if (spuren.length) {
      // `gain` auffüllen statt dem Player seine eigene Vorgabe (1.0) zu lassen:
      // Bis zu dieser Änderung schrieb enrich.ts das Feld nur bei ausdrücklich
      // gesetzter Lautstärke — jedes VORHANDENE tour.json kommt also ohne, und
      // ohne diesen Rückfall klängen genau die Bestandstouren zu laut, bis
      // jemand sie neu rendert.
      // Ein kaputter Film-Anker verschweigt die Spur NICHT — er fällt weg, und
      // main.ts rechnet die Filmsekunde wie bei Bestandsdaten aus `f0`/`f1`.
      // Die Spur wegzuwerfen wäre die teurere Reaktion: Sie klänge dann gar nicht.
      cfg.audio = spuren.map((a) => ({
        ...a,
        gain: a.gain ?? STUDIO_GAIN_DEFAULT,
        ...(Number.isFinite(a.filmS) ? { filmS: a.filmS } : {}),
        ...(Number.isFinite(a.filmToS) ? { filmToS: a.filmToS } : {}),
      }))
      // Der Pegel einer aufgezeichneten Tour ist ABSOLUT: `gain` kommt aus dem
      // Regler im Studio und wird dort ohne Master vorgehört. Deshalb hier 1
      // statt der 0.22 der kuratierten Touren (s. TourConfig.audioPegel).
      cfg.audioPegel = 1
    }
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
      const mid = (lo + hi) >> 1
      if (punkte[mid]!.f < f) lo = mid + 1
      else hi = mid
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
    throw new RemoteTourError(`Tour „${id}" nicht gefunden (HTTP ${antwort.status})`)
  }
  return adaptTour((await antwort.json()) as TourJsonAntwort)
}

/**
 * Eigene Server-Touren für den Tour-Picker (nur mit gültiger Anmeldung —
 * anonym liefert die Liste 401 und der Picker bleibt statisch).
 */
export async function loadServerTours(
  basisUrl = '',
): Promise<Array<{ id: string; title: string | null; status: string }>> {
  try {
    const antwort = await fetch(`${basisUrl}/api/tours`, { credentials: 'same-origin' })
    if (!antwort.ok) return []
    const json = (await antwort.json()) as {
      tours: Array<{ id: string; title: string | null; status: string }>
    }
    return json.tours.filter((t) => t.status === 'ready')
  } catch {
    return []
  }
}
