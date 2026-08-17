// Anreicherungs-Pipeline: rendert aus dem unantastbaren Original-Upload
// (Manifest + Medien) das abspielfertige Tour-JSON (`maptale/tour@1`).
// Umfang: Benennung, Track-Vereinfachung, Statistik, Medien-URLs, Timeline
// (nichtlineare Pseudo-Zeit, M2) und Auto-Wetter (Open-Meteo, M2).
// Später ergänzt (gleiche Stelle, gleiche Signatur): Bildanalyse (M5),
// GPX-Quelle + Medien-Platzierung (M6), Edit-Overlay (M7).

import { STUDIO_PEGEL, type EditOverlay, type MomentArt } from '../schema/edits.js'
import type { UploadManifest, UploadPunkt } from '../schema/upload.js'
import { mediumDateiname } from '../schema/upload.js'
import { wendeEditsAufSegmenteAn, wendeMedienEditsAn } from './edits.js'
import {
  type AchsenHalt,
  baueAchsenHalte,
  baueFilmAchse,
  baueMomentHalte,
  filmBeiZeit,
  projiziereAufReihe,
  zeitBeiFilm,
} from './filmachse.js'
import { berechneStats, vereinfacheIndizes, type TourStats } from './geo.js'
import { baueSignatur } from './signatur.js'
import { baueBenennung, benenneTour, type Benennung, type Endpunkte, type Geocoder } from './naming.js'
import { platziereMedien, type Platzierung } from './placement.js'
import type { FotoMeta } from './bild.js'
import type { VideoMeta } from './video.js'
import type { BildBefund } from './vision.js'
import { verfeinereWetterMitFotos } from './vision.js'
import { berechneWetter, wetterAusOverlay, type WetterKeyframe, type WetterQuelle } from './weather.js'
import { baueZeitreihe, destilliereTimeline, positionZurZeit } from './zeit.js'

export const TOUR_SCHEMA_ID = 'maptale/tour@1'

/** Abspielfertiges Tour-JSON — bewusst nah an der cfg-Form des Players. */
export interface TourJson {
  schema: typeof TOUR_SCHEMA_ID
  id: string
  no: string
  status: 'bereit'
  brandTitle: string
  kicker: string
  titleHtml: string
  stops: string[]
  /** Ob der Player den „Ziel erreicht"-Screen zeigt (sonst zurück zum Start) */
  showFinale: boolean
  finaleTitle: string
  description: string | null
  time: { start: string; end: string; zone: string }
  segments: Array<{
    mode: string
    label: string
    pts: Array<[number, number, number]>
    /**
     * Streckenanteil je Punkt von `pts`, auf der ROHEN Geometrie gemessen (E11).
     * Damit übersetzt der Player jeden `f`-Anker exakt in seine Streckenmeter,
     * statt `f × route.total` zu rechnen. Fehlt bei Touren, die vor E11
     * gerendert wurden — dort bleibt es beim Rückfall.
     */
    f?: number[]
  }>
  media: Array<{
    id: string
    type: 'photo' | 'video'
    src: string
    title: string
    caption: string
    /** Anker [lng,lat] auf dem Track; null = unplatziert (Player überspringt, Editor setzt, M6/M7) */
    anchor: [number, number] | null
    /** Herkunft des Ankers (M6): gps | zeit | manuell | unplatziert */
    placement: Platzierung
    takenAt: string
    durationS?: number
    /** Video-Standbild fürs Foto-Overlay (M4) */
    poster?: string
    /** Kachel-Fassung für Listen und Zeitleiste (bild.ts); fehlt bei Altbestand */
    thumb?: string
    /** Anzeige-Optionen des Foto-Stopps aus dem Edit-Overlay (Baukasten) */
    display?: { holdS?: number; kenBurns?: boolean }
    /** Platz innerhalb des Foto-Stopps (0-basiert, aus dem Edit-Overlay) */
    reihe?: number
  }>
  /** Stützstellen Streckenanteil → Pseudo-Zeit (Pausen komprimiert, M2) */
  timeline?: Array<{ f: number; t: string }>
  /** Auto-Wetter-Keyframes (M2, Open-Meteo; ab M5 auch source "photo") */
  weather?: Array<{ f: number; mode: string; k: number; source: string }>
  /**
   * Kamera-Keyframes. `f` ist der Streckenanteil, `filmS` die Filmsekunde
   * (E10) — der Player nimmt `filmS`, wo es steht, sonst `f` wie bisher.
   */
  camera?: Array<{ f: number; preset: string; skala?: number; filmS?: number }>
  /**
   * Kamera-Momente. `filmS` ist hier eine AUSKUNFT: Der Player verankert einen
   * Moment weiter an `f`, weil die Film-Achse aus den Momenten gebaut wird.
   */
  moments?: Array<{ f: number; art: string; dauerS?: number; filmS?: number }>
  audio?: Array<{
    type: string
    src: string
    f0: number
    f1: number
    gain?: number
    /** Wiederholung; fehlt = Vorgabe des Players (Musik loopt, SFX nicht) */
    loop?: boolean
    /** Einstieg in die Datei (s) — Start-Seek beim Eintritt in den Bereich */
    startS?: number
    /**
     * Filmsekunde des Einsatzes (E10) — geht `f0` vor. Sie ist die einzige
     * Größe, die einen Klip MITTEN in einer Standzeit verorten kann: Dort läuft
     * der Film, während die Strecke steht, und jedes `f` fällt auf die
     * Halt-Kante.
     */
    filmS?: number
    /** Filmsekunde des Endes; nur bei Bereichen (ein One-Shot hat keine) */
    filmBisS?: number
  }>
  stats: TourStats
}

// Alle Modi aus MODI (schema/upload.ts) — fehlt einer, zeigt der Player den
// rohen Schlüssel („moped" statt „Moped").
const MODE_LABELS: Record<string, string> = {
  walk: 'Zu Fuß',
  bike: 'Rad',
  moped: 'Moped',
  jeep: 'Jeep',
  tram: 'Tram',
  ferry: 'Fähre',
}

/** Titelbild in zwei Größen: groß für Detailansichten, Kachel für Listen. */
export interface Titelbild {
  /** Anzeigegröße (Foto-Fassung bzw. Video-Standbild) */
  cover: string
  /** Kachel-Fassung; null bei Altbestand ohne aufbereitete Fassungen */
  thumb: string | null
}

/**
 * Titelbild einer fertig gerenderten Tour. Die Wahl des Nutzers
 * (`edits.titelbild`) gewinnt; zeigt sie ins Leere (gelöschtes oder unbekanntes
 * Medium), wird still das erste platzierte Foto genommen. Ein Video taugt nur
 * mit Standbild.
 *
 * Beide Größen kommen aus DERSELBEN Wahl — eine zweite Funktion mit eigener
 * Reihenfolge liefe irgendwann auseinander und zeigte in der Liste ein anderes
 * Bild als in der Ansicht.
 */
export function bestimmeCover(media: TourJson['media'], titelbild?: string): Titelbild | null {
  const gewaehlt = titelbild ? media.find((m) => m.id === titelbild) : undefined
  const alsTitel = (m: TourJson['media'][number] | undefined): Titelbild | null => {
    if (!m) return null
    const gross = m.type === 'photo' ? m.src : m.poster
    return gross ? { cover: gross, thumb: m.thumb ?? null } : null
  }
  return (
    alsTitel(gewaehlt) ??
    alsTitel(media.find((m) => m.type === 'photo' && m.anchor)) ??
    alsTitel(media.find((m) => m.type === 'video' && m.anchor && m.poster)) ??
    // Auch ein unplatziertes Foto ist ein besseres Titelbild als gar keins
    alsTitel(media.find((m) => m.type === 'photo'))
  )
}

const uhrzeit = (iso: string, zone: string): string => {
  try {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(
      new Date(iso),
    )
  } catch {
    return ''
  }
}

export interface EnrichEingabe {
  tourId: string
  /** Fortlaufende Nummer aus der DB */
  nummer: number
  manifest: UploadManifest
  /** Nutzer-Overrides aus der DB (PATCH); null = Auto-Benennung */
  titelOverride: string | null
  beschreibungOverride: string | null
  /** Endscreen zeigen? Default false — die meisten Touren haben kein konkretes Ziel */
  showFinale?: boolean
  /** Zielname für den Endscreen; null/leer = geocodierter Ortsname */
  finaleZielOverride?: string | null
  /** Edit-Overlay (M7): Trim/Modus-Grenzen/Medien-Overrides; null = keins */
  edits?: EditOverlay | null
  /** Vorhandene Audio-Dateinamen unter media/ (Baukasten) — edits.audio-Verweise ohne Datei werden übersprungen */
  audioDateien?: readonly string[]
  /** Dateinamen der benutzerweiten Audio-Bibliothek des Tour-Eigentümers
   *  (quelle 'benutzer') — Verweise ohne Datei werden ebenso übersprungen */
  benutzerAudioDateien?: readonly string[]
  /** Geocoder für die Auto-Benennung. Optional: ist `orte` vorgegeben (Cache),
   *  wird NICHT geocodiert und der Geocoder nicht gebraucht. */
  geocoder?: Geocoder
  /** Vorgegebene Ortsnamen aus dem Anreicherungs-Cache. Ist es gesetzt, wird die
   *  Benennung daraus + dem aktuellen Titel lokal gebaut (kein Netz). */
  orte?: Endpunkte
  /** Auto-Wetter-Quelle; fehlt sie, bleibt `weather` weg (Client-Fallback) */
  wetter?: WetterQuelle | null
  /** Vorgegebene rohe Wetter-Keyframes aus dem Cache. `undefined` = aus der
   *  Quelle berechnen; `null`/`[]` = kein Auto-Wetter. Die Foto-Verfeinerung
   *  (M5) läuft danach IMMER lokal, weil sie an den platzierten Fotos hängt. */
  wetterRoh?: WetterKeyframe[] | null
  /** Aufbereitete Video-Metadaten je Medien-ID (M4; Dauer/Poster/Auslieferungspfad) */
  videoMeta?: Map<string, VideoMeta>
  /** Aufbereitete Bild-Fassungen je Medien-ID (bild.ts; Anzeige + Kachel).
   *  Fehlt der Eintrag, bleibt es beim Original — so bleibt Altbestand spielbar. */
  fotoMeta?: Map<string, FotoMeta>
  /** Bild-Befunde je Medien-ID (M5; vom Aufrufer per Klassifikator vorbereitet) —
   *  verfeinern das Auto-Wetter lokal am Foto-Anker. Fehlt die Map, bleibt das
   *  Wetter exakt wie in M2 (No-Op ohne konfigurierten Klassifikator). */
  bildBefunde?: Map<string, BildBefund>
  /** Hinweis-Kanal für nicht-fatale Ausfälle (z. B. Wetterdienst down) */
  protokoll?: (nachricht: string) => void
}

/**
 * Kern der Pipeline — reine Funktion über der Eingabe (I/O macht der Aufrufer:
 * Manifest lesen, tour.json schreiben, Status setzen). Dadurch vollständig
 * ohne Netz und Dateisystem testbar.
 */
export async function reichereAn(eingabe: EnrichEingabe): Promise<TourJson> {
  const {
    tourId,
    nummer,
    manifest,
    titelOverride,
    beschreibungOverride,
    showFinale = false,
    finaleZielOverride = null,
    edits,
    audioDateien,
    benutzerAudioDateien,
    geocoder,
    orte,
    wetter,
    wetterRoh,
    videoMeta,
    fotoMeta,
    bildBefunde,
    protokoll,
  } = eingabe

  // Segmente kommen entweder direkt aus dem Manifest oder — bei GPX-Quelle —
  // vom Aufrufer bereits geparst hineingereicht (verarbeite in tours.ts).
  // Das Edit-Overlay (M7) greift direkt danach: Trim + Modus-Grenzen formen
  // den Track, ALLES Nachgelagerte (Benennung, Timeline, Wetter, Platzierung)
  // rechnet auf dem bearbeiteten Stand.
  const startMs = Date.parse(manifest.time.start)
  const endeMs = Date.parse(manifest.time.end)
  const rohSegmente = wendeEditsAufSegmenteAn(manifest.segments ?? [], edits, startMs)
  if (!rohSegmente.length) throw new Error('Kein Track übrig (Segmente fehlen oder der Trim entfernt alles)')
  const erstesSegment = rohSegmente[0]
  const letztesSegment = rohSegmente[rohSegmente.length - 1]
  if (!erstesSegment || !letztesSegment) throw new Error('Manifest ohne Segmente')
  const startPunkt = erstesSegment.pts[0] as UploadPunkt
  const zielPunkt = letztesSegment.pts[letztesSegment.pts.length - 1] as UploadPunkt

  // Benennung: bevorzugt aus gecachten Ortsnamen + aktuellem Titel lokal bauen
  // (kein Netz); nur ohne Cache wird direkt geocodiert (Direktaufruf/Test).
  const nutzerTitel = titelOverride ?? manifest.title ?? null
  let benennung: Benennung
  if (orte) {
    benennung = baueBenennung({ ...orte, nutzerTitel, zeitStart: manifest.time.start, zone: manifest.time.zone })
  } else {
    if (!geocoder) throw new Error('reichereAn: weder orte noch geocoder übergeben')
    benennung = await benenneTour({
      nutzerTitel,
      startPunkt: [startPunkt[0], startPunkt[1]],
      zielPunkt: [zielPunkt[0], zielPunkt[1]],
      zeitStart: manifest.time.start,
      zone: manifest.time.zone,
      geocoder,
    })
  }

  // Zeitreihe der ROHEN (getrimmten) Punkte: Sie trägt die kumulierte Distanz,
  // aus der jedes `f` dieses Tour-JSONs entsteht — Timeline, Kamera-Keyframes,
  // Ton-Bereiche, Wetter UND seit E11 der Wegpunkt selbst.
  const reihe = baueZeitreihe(rohSegmente)

  // Statistik auf den ROHDATEN (volle Auflösung), Ausgabe-Punkte vereinfacht.
  const stats = berechneStats(rohSegmente)
  // Je ausgeliefertem Wegpunkt sein `f` (E11, Gleichlauf-Konzept §8D). Ohne das
  // Feld muss der Player `f × route.total` rechnen — und seine Route ist durch
  // Catmull-Rom + 14-m-Resampling 2,2–3,0 % länger als die Rohgeometrie, in der
  // hier gemessen wird, UNGLEICHMÄSSIG verteilt. Der Rest ist nicht clientseitig
  // zu beheben: `vereinfacheSegment` wirft Punkte weg, die Länge tragen.
  // Das Feld ist additiv — `maptale/tour@1` bleibt, Bestandstouren bekommen es
  // bei ihrem nächsten Render.
  let punktIndex = 0
  const segments = rohSegmente.map((seg) => {
    const basis = punktIndex
    punktIndex += seg.pts.length
    const indizes = vereinfacheIndizes(seg.pts)
    const eintrag: TourJson['segments'][number] = {
      mode: seg.mode,
      label: seg.label ?? MODE_LABELS[seg.mode] ?? seg.mode,
      pts: indizes.map((i): [number, number, number] => {
        const p = seg.pts[i] as UploadPunkt
        return [p[0], p[1], p[2]]
      }),
    }
    // gesamtM = 0 gibt es nur bei einer Tour ohne Ausdehnung — dort wäre jedes
    // `f` eine Null-Division, und der Rückfall im Player ist genauso gut.
    if (reihe.gesamtM > 0) {
      // GERUNDET, und das ist kein Kosmetik-Schritt: Roh serialisiert JSON jede
      // Zahl mit bis zu 17 signifikanten Stellen (`0.057312851865195705`), also
      // ~21 Zeichen je Punkt. Auf der größten lokalen Tour sind das +19,8 % auf
      // das `tour.json` — mehr als die +17,8 %, mit denen das Gleichlauf-Konzept
      // den Export der Filmachse ABLEHNT (§12). Acht Nachkommastellen kosten
      // +11,2 % und sind absurd genau: Bei 41,8 km Streckenlänge entspricht
      // 1e-8 einem Weg von 0,4 mm.
      eintrag.f = indizes.map((i) => Number((((reihe.punkte[basis + i]?.dist ?? 0) / reihe.gesamtM)).toFixed(8)))
    }
    return eintrag
  })

  // Medien-Platzierung (M6): jedem Medium einen Track-Anker geben (GPS nah am
  // Track, sonst Zeit-Mapping, sonst unplatziert). Unplatzierte bleiben mit im
  // tour.json (fürs Studio/den Editor), der Player überspringt sie (kein Anker).
  const alleTrackpunkte = rohSegmente.flatMap((s) => s.pts)
  const media = wendeMedienEditsAn(platziereMedien(manifest.media, alleTrackpunkte, startMs), edits)
    // `|| 0`: ein (schema-durchgerutschtes) unparsebares takenAt darf die
    // Sortierung nicht in NaN-Vergleiche kippen (undefinierte Reihenfolge)
    .sort((a, b) => (Date.parse(a.medium.takenAt) || 0) - (Date.parse(b.medium.takenAt) || 0))
    .map(({ medium: m, anchor, placement }) => {
      // Video-Aufbereitung (M4) liefert Dauer, Poster und den Auslieferungspfad
      // (transkodiert oder Original). Fehlt sie (Foto, oder Aufbereitung fiel
      // aus), bleibt es beim Original ohne Poster.
      const meta = videoMeta?.get(m.id)
      // Fotos werden in einer Anzeige-Fassung ausgeliefert (bild.ts); das
      // Original ist danach verworfen. Ohne Fassung — Altbestand oder
      // fehlgeschlagene Aufbereitung — bleibt der Originalname stehen.
      const fassungen = fotoMeta?.get(m.id)
      const datei = meta?.videoDatei ?? fassungen?.anzeigeDatei ?? mediumDateiname(m)
      // Uhrzeit NUR, wenn takenAt in der Tour-Zeitspanne liegt — mtime-Fallback-
      // Zeiten tourfremder Dateien sind Unsinn (Bughunt-Befund).
      const takenMs = Date.parse(m.takenAt)
      const art = m.type === 'video' ? 'Video' : 'Foto'
      const inSpanne = Number.isFinite(takenMs) && takenMs >= startMs && takenMs <= endeMs
      const zeitangabe = inSpanne ? `${art} · ${uhrzeit(m.takenAt, manifest.time.zone)}` : art
      // Hat der Nutzer das Medium beschriftet, gehört SEIN Text nach oben: der
      // Player zeigt `title` groß und `caption` klein darunter. „Foto · 14:32"
      // als Überschrift zu setzen und den einzigen menschlichen Satz in die
      // Unterzeile zu verbannen, hatte die Sache genau verkehrt herum.
      const nutzertext = m.caption?.trim() ?? ''
      const eintrag: TourJson['media'][number] = {
        id: m.id,
        type: m.type,
        src: `/api/media/${tourId}/${datei}`,
        title: nutzertext || zeitangabe,
        caption: nutzertext ? zeitangabe : '',
        anchor,
        placement,
        takenAt: m.takenAt,
      }
      const dauer = meta?.dauerS ?? m.durationS
      if (dauer !== undefined) eintrag.durationS = dauer
      if (meta?.posterDatei) eintrag.poster = `/api/media/${tourId}/${meta.posterDatei}`
      if (fassungen?.thumbDatei) eintrag.thumb = `/api/media/${tourId}/${fassungen.thumbDatei}`
      // Anzeige-Optionen aus dem Overlay (Baukasten) — nur wenn dort gesetzt
      const display = edits?.medien?.[m.id]?.display
      if (display) eintrag.display = display
      // Platz im Foto-Stopp: wirkt erst im Player, wo die Gruppierung entsteht
      const reihe = edits?.medien?.[m.id]?.reihe
      if (reihe !== undefined) eintrag.reihe = reihe
      return eintrag
    })

  // Nichtlineare Pseudo-Zeit: Stützstellen f→Zeit mit komprimierten Pausen.
  // Auto-Wetter ist eine ANREICHERUNG, kein Muss — fällt die Quelle aus, wird
  // `weather` weggelassen und der Player nutzt sein Client-Auto-Wetter.
  const timeline = destilliereTimeline(reihe, manifest.time.start)

  // Kamera-Keyframes (Baukasten): absolute `ab`-Zeiten → Streckenanteil f über
  // die Zeitreihe des GETRIMMTEN Tracks (tSek relativ zu manifest.time.start,
  // exakt wie die tOffsets der Punkte). positionZurZeit klemmt außerhalb —
  // eine Grenze vor dem Trim-Start landet auf f des Track-Anfangs (gewollt:
  // „gilt ab hier" bleibt auch nach dem Beschneiden wahr).
  // Kamera-Momente: Punkt-Ereignisse. Wie Kamera-Grenzen an f verankert; ein
  // Moment hinter dem (getrimmten) Track-Ende ergibt keinen Sinn → verwerfen.
  //
  // Sie stehen VOR der Achse, weil sie zu ihr gehören: Ein Moment hält den Film
  // an, seine Standzeit ist Achsenbreite. Ein hinter dem Track-Ende verworfener
  // Moment darf die Achse nicht verlängern — deshalb ist es genau die gefilterte
  // Liste, die unten in die Halte geht.
  let momentHalte: AchsenHalt[] = []
  let gefilterteMomente: Array<{ offsetS: number; art: MomentArt; dauerS: number | undefined }> = []
  if (edits?.momente?.length) {
    const trackEndeSek = reihe.punkte[reihe.punkte.length - 1]?.tSek
    gefilterteMomente = edits.momente
      .map((m) => ({ offsetS: (Date.parse(m.ab) - startMs) / 1000, art: m.art, dauerS: m.dauerS }))
      .filter((m) => Number.isFinite(m.offsetS))
      .filter((m) => {
        if (trackEndeSek === undefined || m.offsetS <= trackEndeSek) return true
        protokoll?.(`Kamera-Moment hinter dem Track-Ende übersprungen (${m.art})`)
        return false
      })
      .sort((a, b) => a.offsetS - b.offsetS)
    momentHalte = baueMomentHalte(gefilterteMomente)
  }

  /**
   * Die Film-Achse der Tour — Aufnahmezeit ↔ Strecke ↔ Filmsekunde.
   *
   * Sie stand bis E10 im Audio-Block und wurde nur gebaut, wenn ein Klip die
   * neuen Anker-Felder benutzte. Seit E10 bekommt JEDES Ereignis seine
   * Filmsekunde mit ins Tour-JSON (Ton-Klips, Kamera-Keyframes, Momente), also
   * braucht sie jeder Zweig — einmal gebaut, von allen gelesen.
   *
   * Ihre Halte sind die Aufnahmen (Standzeit + Ausblendung) und die Momente;
   * exakt dieselben, mit denen der Player seine Achse baut (src/filmachse.ts).
   * `null` nur bei einer degenerierten Tour ohne Zeitreihe — dann bleibt es
   * überall beim reinen `f`, also beim Verhalten von vorher.
   */
  const achse =
    reihe.punkte.length > 0
      ? baueFilmAchse(reihe, [
          ...baueAchsenHalte(
            media
              .filter((m) => m.anchor)
              .map((m) => {
                const ort = projiziereAufReihe(reihe, (m.anchor as [number, number])[0], (m.anchor as [number, number])[1])
                return {
                  type: m.type,
                  meter: ort.meter,
                  offsetS: ort.offsetS,
                  ...(m.durationS !== undefined ? { dauerS: m.durationS } : {}),
                  ...(m.display ? { display: m.display } : {}),
                }
              }),
          ),
          // Momente halten den Film genauso an wie eine Aufnahme — im Studio
          // kosten sie längst Achsenbreite (achsenHalte in editor.ts). Fehlten
          // sie hier, klänge jeder Ton-Klip, dessen Versatz über einen Moment
          // reicht, im Render an einer anderen Stelle als im Editor.
          ...momentHalte,
        ])
      : null

  /**
   * Filmsekunde eines Ereignisses fürs Tour-JSON — gerundet wie `segments[].f`.
   *
   * Acht Nachkommastellen, aus demselben Grund wie dort: Roh serialisiert JSON
   * bis zu 17 signifikante Stellen, und ein Feld je Ereignis kostete damit mehr
   * als die Filmachse, deren Export das Gleichlauf-Konzept ausdrücklich ablehnt
   * (§12). Ohne Achse gibt es keine Filmsekunde — dann bleibt das Feld weg und
   * der Player rechnet wie bisher aus `f`.
   */
  const filmZahl = (filmS: number): number => Number(filmS.toFixed(8))
  const filmFeld = (tSek: number): number | undefined =>
    achse ? filmZahl(filmBeiZeit(achse, tSek)) : undefined

  let camera: TourJson['camera']
  if (edits?.kamera?.length) {
    // Eine Grenze HINTER dem (getrimmten) Track-Ende würde auf f=1 geklemmt —
    // die Kamera schaltete dann sichtbar exakt am Finale um, wo die Grenze nie
    // gemeint war → verwerfen. Vor dem Start bleibt die Klemmung („gilt ab hier").
    const trackEndeSek = reihe.punkte[reihe.punkte.length - 1]?.tSek
    const keyframes = edits.kamera
      .map((g) => ({ abMs: Date.parse(g.ab), preset: g.preset, skala: g.skala }))
      .filter((g) => Number.isFinite(g.abMs))
      .filter((g) => {
        if (trackEndeSek === undefined || (g.abMs - startMs) / 1000 <= trackEndeSek) return true
        protokoll?.(`Kamera-Grenze hinter dem Track-Ende übersprungen (${g.preset})`)
        return false
      })
      // positionZurZeit ist monoton in der Zeit → nach `ab` sortiert ist auch
      // f sortiert; bei gleichem f gewinnt unten der spätere `ab`.
      .sort((a, b) => a.abMs - b.abMs)
      .map((g) => {
        const tSek = (g.abMs - startMs) / 1000
        const filmS = filmFeld(tSek)
        return {
          f: positionZurZeit(reihe, tSek).f,
          preset: g.preset,
          ...(g.skala !== undefined && g.skala !== 1 ? { skala: g.skala } : {}),
          ...(filmS !== undefined ? { filmS } : {}),
        }
      })
    const dedupliziert: NonNullable<TourJson['camera']> = []
    for (const k of keyframes) {
      const letzter = dedupliziert[dedupliziert.length - 1]
      if (letzter && letzter.f === k.f) {
        letzter.preset = k.preset
        if (k.skala !== undefined) letzter.skala = k.skala
        else delete letzter.skala
        // Der spätere Keyframe gewinnt — auch mit seiner Filmsekunde. Bei
        // gleichem `f` können sie sich unterscheiden: genau dann, wenn beide
        // in derselben Standzeit liegen.
        if (k.filmS !== undefined) letzter.filmS = k.filmS
      } else dedupliziert.push(k)
    }
    if (dedupliziert.length) camera = dedupliziert
  }

  let moments: TourJson['moments']
  if (gefilterteMomente.length) {
    moments = gefilterteMomente.map((m) => {
      const filmS = filmFeld(m.offsetS)
      return {
        f: positionZurZeit(reihe, m.offsetS).f,
        art: m.art,
        ...(m.dauerS !== undefined ? { dauerS: m.dauerS } : {}),
        // Die Filmsekunde des Moments ist eine AUSKUNFT, kein Eingang: Der
        // Player verankert ihn weiter an `f`, weil die Achse aus den Momenten
        // gebaut wird und ein Moment über sie zu verorten ein Kreis wäre
        // (s. src/main.ts). Sie steht hier, damit ein Leser des Tour-JSON
        // dieselbe Filmzeit sieht wie Editor und Player.
        ...(filmS !== undefined ? { filmS } : {}),
      }
    })
  }

  // Audio-Spuren (Baukasten): absolute Zeiten → f-Bereiche. Fehlende Dateien
  // und Bereiche, die der Trim vollständig entfernt hat, werden mit Warnung
  // übersprungen — ein kaputter Verweis darf den Render nie scheitern lassen.
  let audio: TourJson['audio']
  if (edits?.audio?.length) {
    const vorhandene = new Set(audioDateien ?? [])
    const benutzerVorhandene = new Set(benutzerAudioDateien ?? [])
    const ersterPunkt = reihe.punkte[0]
    const letzterPunkt = reihe.punkte[reihe.punkte.length - 1]
    /** Streckenanteil zu einer Filmsekunde (über die Achse zurück in die Zeit). */
    const fBeiFilm = (filmS: number): number =>
      positionZurZeit(reihe, zeitBeiFilm(achse as NonNullable<typeof achse>, filmS)).f
    const spuren: NonNullable<TourJson['audio']> = []
    for (const spur of edits.audio) {
      const ausBibliothek = spur.quelle === 'bibliothek'
      const ausBenutzer = spur.quelle === 'benutzer'
      // Tour-lokale Dateien müssen unter media/ liegen, Benutzer-Uploads in der
      // Bibliothek des Eigentümers; kuratierte Effekte sind global
      // (public/audio/sfx/) und werden hier nicht geprüft.
      if (!ausBibliothek && !ausBenutzer && !vorhandene.has(spur.datei)) {
        protokoll?.(`Audio-Datei fehlt: ${spur.datei}`)
        continue
      }
      if (ausBenutzer && !benutzerVorhandene.has(spur.datei)) {
        protokoll?.(`Bibliotheks-Audio fehlt: ${spur.datei}`)
        continue
      }
      // Die Film-Verankerung gilt nur, wenn sie auch benutzt wird UND die Achse
      // steht (eine degenerierte Tour hat keine). Sonst der Weg von vorher —
      // Bestands-Overlays laufen dadurch buchstäblich durch denselben Code.
      const filmVerankert =
        achse !== null && (spur.anker !== undefined || spur.versatzFilmS !== undefined || spur.dauerFilmS !== undefined)
      const tAb = (Date.parse(spur.anker ?? spur.ab) - startMs) / 1000
      const tBis = spur.bis !== undefined ? (Date.parse(spur.bis) - startMs) / 1000 : undefined
      let f0: number
      let f1: number
      // Die Filmsekunden des Klips (E10) — die eigentliche Auskunft, seit der
      // Player in Filmzeit rechnet. `undefined` nur ohne Achse.
      let filmVonS: number | undefined
      let filmBisS: number | undefined
      if (filmVerankert) {
        // Anker → Filmsekunde → Versatz drauf → zurück in Zeit und Anteil.
        const filmVon = filmBeiZeit(achse, tAb) + (spur.versatzFilmS ?? 0)
        f0 = fBeiFilm(filmVon)
        filmVonS = filmVon
        if (spur.dauerFilmS !== undefined) {
          filmBisS = filmVon + spur.dauerFilmS
          f1 = fBeiFilm(filmBisS)
        } else if (spur.typ === 'musik') {
          filmBisS = tBis !== undefined ? filmBeiZeit(achse, tBis) : achse.gesamtS
          f1 = tBis !== undefined ? positionZurZeit(reihe, tBis).f : 1
        } else {
          filmBisS = filmVon
          f1 = f0
        }
      } else {
        f0 = positionZurZeit(reihe, tAb).f
        filmVonS = achse ? filmBeiZeit(achse, tAb) : undefined
        if (spur.typ === 'musik') {
          f1 = tBis !== undefined ? positionZurZeit(reihe, tBis).f : 1
          filmBisS = achse ? (tBis !== undefined ? filmBeiZeit(achse, tBis) : achse.gesamtS) : undefined
        } else {
          // SFX: One-Shot exakt bei f0. Liegt `ab` außerhalb des (getrimmten)
          // Tracks, würde die Klemmung den Knall an den Tour-Start/-Ende legen,
          // wo er nie gemeint war → überspringen.
          if (ersterPunkt && letzterPunkt && (tAb < ersterPunkt.tSek || tAb > letzterPunkt.tSek)) {
            protokoll?.(`Audio außerhalb des Tracks übersprungen: ${spur.datei}`)
            continue
          }
          f1 = f0
        }
      }
      // Ein Musik-Klip ohne Ausdehnung wäre stumm (`istAktiv` prüft
      // Von ≤ x < Bis) — nur gilt das seit E10 in FILMZEIT und nicht mehr im
      // Streckenanteil. Genau darin liegt der Unterschied: Ein Klip, der ganz
      // in einer Standzeit oder einer Ex-Pause liegt, fällt im `f`-Raum auf
      // einen Punkt zusammen (dort steht die Strecke, während der Film läuft)
      // und wurde deshalb bis hierher VERWORFEN. Er hat sehr wohl eine Länge,
      // man muss sie nur in der richtigen Größe messen. Übrig bleibt der Fall,
      // in dem auch der Film keine Zeit dafür hat — etwa eine Spanne, die der
      // Trim vollständig vor den Track-Anfang klemmt.
      const leer = filmVonS !== undefined && filmBisS !== undefined ? !(filmBisS > filmVonS) : f1 <= f0
      if (spur.typ === 'musik' && leer) {
        protokoll?.(`Audio außerhalb des Tracks übersprungen: ${spur.datei}`)
        continue
      }
      spuren.push({
        type: spur.typ === 'musik' ? 'music' : 'sfx',
        // Bibliothek: statisch ausgeliefert (wie ambient.mp3). Benutzer-Upload:
        // über die Tour ausgeliefert, damit deren Sichtbarkeit den Zugriff regelt.
        src: ausBibliothek
          ? `/audio/sfx/${spur.datei}`
          : ausBenutzer
            ? `/api/tours/${tourId}/bibliothek-audio/${spur.datei}`
            : `/api/media/${tourId}/${spur.datei}`,
        f0,
        f1,
        // IMMER mitschreiben, anders als loop/startS darunter: Der Player kennt
        // die Vorgabe des Studio-Reglers (0.8) nicht, und ohne Wert spielte er
        // mit 1.0 — der Film klänge lauter als der Schnitt. Der Wert ist hier
        // absolut; den Master setzt remote.ts auf 1 (s. TourConfig.audioPegel).
        gain: spur.lautstaerke ?? STUDIO_PEGEL,
        // Nur mitschreiben, was ausdrücklich gesetzt ist: Der Player kennt
        // dieselben Vorgaben (Musik loopt, SFX nicht) und würde sie sonst aus
        // einem geschriebenen Wert lesen statt aus der Regel — Bestandsdaten
        // bekämen ein Feld, das sie nie hatten.
        ...(spur.loop !== undefined ? { loop: spur.loop } : {}),
        ...(spur.einstiegS ? { startS: spur.einstiegS } : {}),
        // Die Film-Anker (E10). `filmS` steht bei jedem Klip, `filmBisS` nur bei
        // einem BEREICH: Ein One-Shot hat keine Länge, und ein zweites Feld mit
        // demselben Wert wäre eine Angabe über nichts. Der Player fällt je
        // Endpunkt einzeln auf `f0`/`f1` zurück — ein Bereich ohne `filmBisS`
        // bleibt dadurch ein Bereich.
        ...(filmVonS !== undefined ? { filmS: filmZahl(filmVonS) } : {}),
        ...(filmBisS !== undefined && filmVonS !== undefined && filmBisS > filmVonS
          ? { filmBisS: filmZahl(filmBisS) }
          : {}),
      })
    }
    // Sortiert nach FILMSEKUNDE, wo es sie gibt: Zwei Klips in derselben
    // Standzeit haben dasselbe `f0` und stünden sonst in beliebiger Reihenfolge.
    spuren.sort((a, b) => (a.filmS ?? a.f0) - (b.filmS ?? b.f0) || a.f0 - b.f0)
    if (spuren.length) audio = spuren
  }

  let weather: TourJson['weather']
  if (edits?.wetter?.length) {
    // Studio-Wetter (Baukasten): eine bewusst gesetzte Stufenfunktion ersetzt
    // das Auto-Wetter VOLLSTÄNDIG — auch die Foto-Verfeinerung entfällt, weil der
    // Nutzer hier korrigiert, was Open-Meteo/Bildanalyse falsch hatten.
    const keyframes = wetterAusOverlay(edits.wetter, reihe, startMs)
    if (keyframes.length) weather = keyframes
  } else {
    // Roh-Wetter: bevorzugt vorgegeben (Anreicherungs-Cache, kein Netz); sonst aus
    // der Quelle berechnen (Direktaufruf/Test). `wetterRoh === undefined` heißt
    // „nicht im Cache" → berechnen; `null`/`[]` heißt „berechnet, aber kein Wetter".
    const wetterVorgegeben = wetterRoh !== undefined
    try {
      let keyframes: WetterKeyframe[]
      if (wetterVorgegeben) {
        keyframes = wetterRoh ?? []
      } else if (wetter) {
        keyframes = await berechneWetter({ reihe, startIso: manifest.time.start, quelle: wetter })
      } else {
        keyframes = []
      }
      // Bildanalyse (M5): platzierte Fotos mit Befund lokal auf ihre f-Position
      // abbilden (Aufnahmezeit → Zeitreihe, wie die Kamera-Keyframes) und das
      // API-Wetter dort verfeinern. Ohne Befunde bleibt `keyframes` unberührt.
      if (keyframes.length && bildBefunde?.size) {
        const fotos: Array<{ f: number; befund: BildBefund }> = []
        for (const m of media) {
          if (m.type !== 'photo' || m.anchor === null) continue // nur platzierte Fotos
          const befund = bildBefunde.get(m.id)
          if (!befund) continue
          const tSek = (Date.parse(m.takenAt) - startMs) / 1000
          if (!Number.isFinite(tSek)) continue
          fotos.push({ f: positionZurZeit(reihe, tSek).f, befund })
        }
        if (fotos.length) keyframes = verfeinereWetterMitFotos(keyframes, fotos)
      }
      if (keyframes.length) weather = keyframes
    } catch (fehler) {
      protokoll?.(`Auto-Wetter nicht verfügbar (${tourId}): ${(fehler as Error).message}`)
    }
  }

  return {
    schema: TOUR_SCHEMA_ID,
    id: tourId,
    no: `N°${String(nummer).padStart(2, '0')}`,
    status: 'bereit',
    brandTitle: benennung.brandTitle,
    kicker: benennung.kicker,
    titleHtml: benennung.titleHtml,
    stops: benennung.stops,
    showFinale,
    finaleTitle: (finaleZielOverride?.trim() || benennung.finaleTitle),
    description: beschreibungOverride ?? manifest.description ?? null,
    time: manifest.time,
    segments,
    media,
    ...(timeline ? { timeline } : {}),
    ...(weather ? { weather } : {}),
    ...(camera ? { camera } : {}),
    ...(moments ? { moments } : {}),
    ...(audio ? { audio } : {}),
    // Die Bibliothek zeigt jede Tour als Kachel: Anzahl der Aufnahmen und die
    // Form der Route stehen deshalb mit in der Statistik. Beides fällt hier
    // ohnehin an — die Liste soll dafür keine Tour-Dateien öffnen müssen.
    stats: {
      ...stats,
      fotos: media.filter((m) => m.anchor).length,
      ...(() => {
        const spur = baueSignatur(segments.flatMap((s) => s.pts.map((p) => [p[0], p[1]] as const)))
        return spur ? { spur } : {}
      })(),
      ...(achse ? { filmS: Math.round(achse.gesamtS * 10) / 10 } : {}),
      ...(showFinale ? { finale: true } : {}),
    },
  }
}
