// Zeitleiste des Editors (Kreativbaukasten): reine Skalen- und Positions-
// Helfer über der Aufnahme-Zeitachse. Alles hier ist DOM-frei und unter
// Vitest testbar — die Leisten-Verdrahtung (Drag, Hover, Render) liegt in
// editor.ts. Positionen sind Anteile 0..1 der Aufnahmespanne, KEIN f
// (Streckenanteil): die Leiste zeigt die ZEIT der Aufzeichnung, damit
// Trim/Grenzen/Audio exakt an den absoluten Zeit-Ankern des Overlays hängen.

import {
  isoZuOffset,
  offsetZuIso,
  projiziereAufTrack,
  type AnzeigeAbschnitt,
  type AudioEintrag,
  type EditOverlay,
  type KameraPreset,
  type MediumAnzeige,
  type MomentArt,
  type Modus,
  type TrackPunkt,
  type WetterModus,
} from './editmodell.js'

/** Zeitspanne der Aufzeichnung: Offsets (s) des ersten/letzten Trackpunkts. */
export interface ZeitSkala {
  vonS: number
  bisS: number
}

export function baueSkala(track: readonly TrackPunkt[]): ZeitSkala | null {
  const erster = track[0]
  const letzter = track[track.length - 1]
  if (!erster || !letzter || letzter[3] <= erster[3]) return null
  return { vonS: erster[3], bisS: letzter[3] }
}

/** Zeit-Offset (s) → Anteil 0..1 auf der Leiste (geklemmt). */
export function anteilZuOffset(skala: ZeitSkala, anteil: number): number {
  const a = Math.max(0, Math.min(1, anteil))
  return skala.vonS + a * (skala.bisS - skala.vonS)
}

export function offsetZuAnteil(skala: ZeitSkala, tOffsetS: number): number {
  return Math.max(0, Math.min(1, (tOffsetS - skala.vonS) / (skala.bisS - skala.vonS)))
}

/**
 * Wird ein Audio-Eintrag beim Rendern verworfen, weil er vollständig außerhalb
 * des (getrimmten) Tracks liegt? Spiegelt die Pipeline-Semantik (enrich.ts):
 * SFX außerhalb [Start,Ende] fliegen raus, Musik mit leerer geklemmter Spanne
 * ebenso — der Editor warnt dann, statt still nichts abzuspielen.
 */
export function audioWirdVerworfen(
  a: AudioEintrag,
  edits: EditOverlay,
  startIso: string,
  skala: ZeitSkala,
): boolean {
  const vonS = edits.trim?.start !== undefined ? isoZuOffset(startIso, edits.trim.start) : skala.vonS
  const bisS = edits.trim?.ende !== undefined ? isoZuOffset(startIso, edits.trim.ende) : skala.bisS
  const abS = isoZuOffset(startIso, a.ab)
  if (a.typ === 'sfx') return abS < vonS || abS > bisS
  const endeS = a.bis !== undefined ? isoZuOffset(startIso, a.bis) : bisS
  return Math.min(endeS, bisS) <= Math.max(abS, vonS)
}

// — Bausteine der Leiste (alle Positionen als Anteil 0..1) —

export interface ZeitBand {
  von: number
  bis: number
  mode: Modus
  aktiv: boolean
}

/** Modus-Bänder aus den Anzeige-Abschnitten (gleiche Quelle wie der Karten-Track). */
export function baueBaender(abschnitte: readonly AnzeigeAbschnitt[], skala: ZeitSkala): ZeitBand[] {
  return abschnitte
    .map((a) => {
      const erster = a.pts[0] as TrackPunkt
      const letzter = a.pts[a.pts.length - 1] as TrackPunkt
      return { von: offsetZuAnteil(skala, erster[3]), bis: offsetZuAnteil(skala, letzter[3]), mode: a.mode, aktiv: a.aktiv }
    })
    .filter((b) => b.bis > b.von)
}

export interface MedienDot {
  id: string
  anteil: number
  type: 'photo' | 'video'
  geloescht: boolean
}

/**
 * Wiedergabe-Position der Medien auf der Zeitachse: der Anker wird auf die
 * Track-Linie projiziert, sein Zeit-Offset bestimmt den Dot. Unplatzierte
 * (anchor null) erscheinen nicht — der Editor zählt sie separat.
 */
export function baueMedienDots(
  medien: readonly MediumAnzeige[],
  track: readonly TrackPunkt[],
  skala: ZeitSkala,
): MedienDot[] {
  const dots: MedienDot[] = []
  for (const m of medien) {
    if (!m.anchor || m.geloescht) continue
    const projektion = projiziereAufTrack(track, m.anchor[0], m.anchor[1])
    dots.push({ id: m.id, anteil: offsetZuAnteil(skala, projektion.punkt[3]), type: m.type, geloescht: m.geloescht })
  }
  return dots.sort((a, b) => a.anteil - b.anteil)
}

/** Abschnitt gleichen Zustands — mit Anfang UND Ende. */
export interface ZustandsBand<T> {
  von: number
  bis: number
  wert: T
  /**
   * ISO-Anker der Grenze, die dieses Band eröffnet — null beim Grundband vor
   * der ersten Grenze. Identität für Ziehen/Entfernen (wie bei den Pins zuvor).
   */
  ab: string | null
}

/**
 * Grenzen („gilt ab T") in lückenlose Bänder übersetzen: jedes Band reicht bis
 * zur nächsten Grenze, das letzte bis ans Ende der Leiste.
 *
 * Der Punkt der Übung: Eine Grenze zeigt nur, wo ein Zustand ANFÄNGT — wo er
 * aufhört, musste man sich bisher aus der nächsten Grenze zusammenreimen. Als
 * Band ist beides dieselbe Kante.
 */
export function baueZustandsBaender<T>(
  grenzen: ReadonlyArray<{ ab: string; wert: T }>,
  startIso: string,
  skala: ZeitSkala,
  grund: T,
): Array<ZustandsBand<T>> {
  const sortiert = grenzen
    .map((g) => ({ ab: g.ab, wert: g.wert, anteil: offsetZuAnteil(skala, isoZuOffset(startIso, g.ab)) }))
    .filter((g) => Number.isFinite(g.anteil))
    .sort((a, b) => a.anteil - b.anteil)

  const baender: Array<ZustandsBand<T>> = []
  let von = 0
  let wert = grund
  let ab: string | null = null
  for (const g of sortiert) {
    baender.push({ von, bis: g.anteil, wert, ab })
    von = g.anteil
    wert = g.wert
    ab = g.ab
  }
  baender.push({ von, bis: 1, wert, ab })
  // Null-breite Bänder (Grenze bei 0, zwei Grenzen auf demselben Punkt) fallen weg
  return baender.filter((b) => b.bis > b.von)
}

/** Default-Haltedauer eines Fotos — entspricht „Auto (5 s)" im Editor. */
export const HALTEDAUER_DEFAULT_S = 5

export interface AudioBalken {
  /** Index im Overlay-Array (Identität für Patch/Entfernen) */
  index: number
  typ: 'musik' | 'sfx'
  von: number
  /** bei sfx gleich `von` */
  bis: number
  datei: string
  /**
   * Unterzeile innerhalb der Musik-Bahn (0-basiert). Der Player MISCHT
   * überlappende Musik-Bereiche (je Spur ein eigenes Element — Musik plus
   * Atmosphäre gleichzeitig ist gewollt); deckungsgleich übereinander
   * gezeichnet wäre der untere Klip aber unsichtbar und ungreifbar. Wie in
   * einem Schnittprogramm rückt ein überlappender Klip deshalb eine Zeile
   * tiefer. Effekt-Pins haben ihre eigene Lane oben und bleiben bei 0.
   */
  lane: number
}

export function baueAudioBalken(audio: readonly AudioEintrag[], startIso: string, skala: ZeitSkala): AudioBalken[] {
  const balken: AudioBalken[] = []
  audio.forEach((a, index) => {
    const von = isoZuOffset(startIso, a.ab)
    if (!Number.isFinite(von)) return
    const vonAnteil = offsetZuAnteil(skala, von)
    let bisAnteil = vonAnteil
    if (a.typ === 'musik') {
      const bis = a.bis !== undefined ? isoZuOffset(startIso, a.bis) : skala.bisS
      bisAnteil = Number.isFinite(bis) ? offsetZuAnteil(skala, bis) : 1
    }
    balken.push({ index, typ: a.typ, von: vonAnteil, bis: bisAnteil, datei: a.datei, lane: 0 })
  })
  // Unterzeilen für überlappende Musik-Klips: klassische Intervall-Färbung —
  // nach Beginn sortiert bekommt jeder Klip die oberste Zeile, deren letzter
  // Klip vor ihm endet. Die Zuordnung ist stabil gegenüber dem Overlay-Index
  // (Sortierung nur fürs Färben; zurück kommt die Original-Reihenfolge).
  const musik = balken.filter((b) => b.typ === 'musik').sort((a, b) => a.von - b.von || a.index - b.index)
  const laneEnden: number[] = []
  for (const b of musik) {
    let lane = laneEnden.findIndex((ende) => ende <= b.von)
    if (lane === -1) {
      lane = laneEnden.length
      laneEnden.push(0)
    }
    laneEnden[lane] = b.bis
    b.lane = lane
  }
  return balken
}

/** Zahl der Unterzeilen der Musik-Bahn (mindestens 1) — für ihre Höhe. */
export function musikLanes(balken: readonly AudioBalken[]): number {
  return balken.reduce((max, b) => (b.typ === 'musik' ? Math.max(max, b.lane + 1) : max), 1)
}

// — Zeit-Eingabe im Inspector —
//
// Ein Zeitfeld zeigt „14:03" und meint einen Offset in Sekunden seit Tourbeginn.
// Die Rückrichtung läuft bewusst über die DIFFERENZ zur angezeigten Zeit statt
// über eine echte Wanduhr→Zeitpunkt-Umkehrung: Letztere müsste die Zeitzone
// invertieren und stolperte über Sommerzeit-Sprünge und über Touren, die über
// Mitternacht laufen.

/** „14:03", „1403", „14.3" → Minuten seit Mitternacht; null bei Unsinn. */
export function parseUhrMinuten(text: string): number | null {
  const roh = text.trim()
  const treffer = /^(\d{1,2})\s*[:.\s]?\s*(\d{2})$/.exec(roh)
  if (!treffer) return null
  const std = Number(treffer[1])
  const min = Number(treffer[2])
  if (!(std >= 0 && std <= 23 && min >= 0 && min <= 59)) return null
  return std * 60 + min
}

/**
 * Neue Uhrzeit im Feld → neuer Zeit-Offset (s). Gerechnet wird die Differenz zur
 * bisher angezeigten Zeit; „00:05" nach „23:50" heißt deshalb +15 Minuten und
 * nicht ein Sprung um fast einen ganzen Tag zurück.
 */
export function uhrDiffZuOffset(altOffsetS: number, altText: string, neuText: string): number | null {
  const alt = parseUhrMinuten(altText)
  const neu = parseUhrMinuten(neuText)
  if (alt === null || neu === null) return null
  let diffMin = neu - alt
  if (diffMin > 720) diffMin -= 1440
  if (diffMin < -720) diffMin += 1440
  return altOffsetS + diffMin * 60
}

// — Fokus: die gemeinsame Auswahl von Zeitleiste, Karte und Inspector —
//
// Gespeichert wird bewusst nur die IDENTITÄT. Bänder entstehen aus Overlay +
// Track und würden als kopierte Spanne veralten, sobald man eine Grenze
// verschiebt; `loeseFokusAuf` löst sie deshalb bei JEDEM Render neu auf.

export type Fokus =
  | { art: 'modus'; bezugS: number }
  | { art: 'kamera'; bezugS: number }
  | { art: 'wetter'; bezugS: number }
  | { art: 'moment'; ab: string }
  | { art: 'audio'; index: number }
  | { art: 'medium'; id: string }

/** Aufgelöster Fokus: was der Inspector zeigt und was auf der Karte leuchtet. */
export interface FokusZiel {
  art: Fokus['art']
  vonS: number
  bisS: number
  /**
   * Overlay-Grenze, die dieses Band ERÖFFNET — null heißt: das Band stammt aus
   * der Aufzeichnung (oder ist das Grundband) und lässt sich nicht entfernen,
   * nur überschreiben. Im Inspector ist „Beginnt um" dann fest.
   */
  ab: string | null
  /**
   * Grenze, die dieses Band SCHLIESST (= eröffnet das nächste). Anfang des
   * einen und Ende des anderen Zustands sind dieselbe Kante — über dieses Feld
   * kann der Inspector auch das Ende verschieben. null = Band endet am Tourende.
   */
  naechsteAb: string | null
  mode?: Modus
  preset?: KameraPreset
  wetterMode?: WetterModus
  staerke?: number
  momentArt?: MomentArt
  dauerS?: number
  index?: number
  id?: string
}

/** Liegt `offsetS` (etwa) auf der Grenze `ab`? Toleranz gegen Rundung. */
const grenzeBei = (
  grenzen: ReadonlyArray<{ ab: string }>,
  startIso: string,
  offsetS: number,
): string | null => grenzen.find((g) => Math.abs(isoZuOffset(startIso, g.ab) - offsetS) < 1)?.ab ?? null

/**
 * Eine Zustands-Grenze bleibt zwischen ihren Nachbarn. Ohne diese Klemme
 * überholt ein schneller Zug die nächste Grenze: die Reihenfolge der Zustände
 * wäre danach eine andere als die, die man beim Anfassen sah, und der gezogene
 * Abschnitt selbst wäre verschwunden.
 *
 * `punkteS` (Trackzeiten) ist optional und nur noch für Spuren nötig, die
 * Zustand ausschließlich an Stützpunkten auswerten. Fortbewegung interpoliert
 * Zwischenzeiten auf die Linie (`zerlegeFuerAnzeige`) — dort reicht eine
 * Sekunde Abstand, sonst rastete die Kante auf dünnen Tracks in großen
 * Schritten. Ohne `punkteS` genügt diese Sekunde sowieso: zwei Grenzen auf
 * derselben Sekunde verschlucken sich gegenseitig (Ersetzen-Semantik).
 */
export function klemmeGrenze(
  grenzen: ReadonlyArray<{ ab: string }>,
  altAb: string,
  startIso: string,
  offsetS: number,
  punkteS?: readonly number[],
): number {
  const zeiten = grenzen
    .map((g) => isoZuOffset(startIso, g.ab))
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b)
  const eigen = isoZuOffset(startIso, altAb)
  const vorher = zeiten.filter((s) => s < eigen).pop()
  const nachher = zeiten.find((s) => s > eigen)
  /** Späteste Zeit, die den Abschnitt bis `grenzeS` noch mit einem Punkt füllt. */
  const letzterPunktVor = (grenzeS: number): number =>
    punkteS?.filter((p) => p < grenzeS).pop() ?? grenzeS - 1
  const ersterPunktNach = (grenzeS: number): number => punkteS?.find((p) => p > grenzeS) ?? grenzeS + 1

  let wert = offsetS
  if (vorher !== undefined) wert = Math.max(wert, ersterPunktNach(vorher))
  if (nachher !== undefined) wert = Math.min(wert, letzterPunktVor(nachher))
  return wert
}

export function loeseFokusAuf(
  fokus: Fokus | null,
  edits: EditOverlay,
  abschnitte: readonly AnzeigeAbschnitt[],
  track: readonly TrackPunkt[],
  startIso: string,
  medien: readonly MediumAnzeige[],
): FokusZiel | null {
  if (!fokus) return null
  const skala = baueSkala(track)
  if (!skala) return null

  if (fokus.art === 'modus') {
    // Aus den Anzeige-Abschnitten: die tragen echte Trackpunkte, also echte Zeiten
    const i = abschnitte.findIndex((a) => {
      const von = (a.pts[0] as TrackPunkt)[3]
      const bis = (a.pts[a.pts.length - 1] as TrackPunkt)[3]
      return fokus.bezugS >= von && fokus.bezugS <= bis
    })
    const treffer = abschnitte[i]
    if (!treffer) return null
    const vonS = (treffer.pts[0] as TrackPunkt)[3]
    const bisS = (treffer.pts[treffer.pts.length - 1] as TrackPunkt)[3]
    // Verantwortliche Grenze: die letzte, die zu Bandbeginn schon gilt und
    // denselben Modus setzt.
    let ab: string | null = null
    for (const g of edits.modi ?? []) {
      const gS = isoZuOffset(startIso, g.ab)
      if (!Number.isFinite(gS) || gS > vonS + 1) break
      if (g.mode === treffer.mode) ab = g.ab
    }
    // Fehlt sie, stammt die Kante aus der Aufzeichnung — sie bekommt trotzdem
    // eine Identität, damit sie sich anfassen lässt (`materialisiereModi`
    // schreibt die erkannte Aufteilung beim ersten Zug fest). NUR echte
    // Modus-Wechsel zählen: eine Trim-Kante teilt das Band ebenfalls, ist aber
    // keine Grenze — würde man an ihr ziehen, entstünde ein Wechsel aus dem
    // Nichts. Der Tour-Anfang bleibt fest.
    const wechselBei = (nachbar: AnzeigeAbschnitt | undefined, offsetS: number): string | null =>
      nachbar && nachbar.mode !== treffer.mode ? offsetZuIso(startIso, offsetS) : null
    return {
      art: 'modus',
      vonS,
      bisS,
      ab: ab ?? wechselBei(abschnitte[i - 1], vonS),
      naechsteAb: grenzeBei(edits.modi ?? [], startIso, bisS) ?? wechselBei(abschnitte[i + 1], bisS),
      mode: treffer.mode,
    }
  }

  if (fokus.art === 'kamera' || fokus.art === 'wetter') {
    const istWetter = fokus.art === 'wetter'
    // Wetter-Grund ist „klar" (off), sobald IRGENDeine Grenze existiert — dann
    // ersetzt das Overlay das Auto-Wetter vollständig; sonst „automatisch".
    const grenzen = istWetter
      ? (edits.wetter ?? []).map((g) => ({ ab: g.ab, wert: g.mode as KameraPreset | WetterModus }))
      : (edits.kamera ?? []).map((g) => ({ ab: g.ab, wert: g.preset as KameraPreset | WetterModus }))
    const grund: KameraPreset | WetterModus | null = istWetter && grenzen.length > 0 ? 'off' : null
    const baender = baueZustandsBaender(grenzen, startIso, skala, grund)
    const i = baender.findIndex(
      (b) => fokus.bezugS >= anteilZuOffset(skala, b.von) && fokus.bezugS <= anteilZuOffset(skala, b.bis),
    )
    const treffer = baender[i]
    if (!treffer) return null
    const ziel: FokusZiel = {
      art: fokus.art,
      vonS: anteilZuOffset(skala, treffer.von),
      bisS: anteilZuOffset(skala, treffer.bis),
      ab: treffer.ab,
      naechsteAb: baender[i + 1]?.ab ?? null,
    }
    if (treffer.wert) {
      if (istWetter) ziel.wetterMode = treffer.wert as WetterModus
      else ziel.preset = treffer.wert as KameraPreset
    }
    if (istWetter && treffer.ab !== null) {
      const staerke = edits.wetter?.find((g) => g.ab === treffer.ab)?.staerke
      if (staerke !== undefined) ziel.staerke = staerke
    }
    if (!istWetter && treffer.ab !== null) {
      const feinSkala = edits.kamera?.find((g) => g.ab === treffer.ab)?.skala
      if (feinSkala !== undefined) ziel.staerke = feinSkala
    }
    return ziel
  }

  if (fokus.art === 'moment') {
    const m = (edits.momente ?? []).find((x) => x.ab === fokus.ab)
    if (!m) return null
    const s = isoZuOffset(startIso, m.ab)
    return {
      art: 'moment',
      vonS: s,
      bisS: s,
      ab: m.ab,
      naechsteAb: null,
      momentArt: m.art,
      ...(m.dauerS !== undefined ? { dauerS: m.dauerS } : {}),
    }
  }

  if (fokus.art === 'audio') {
    const a = (edits.audio ?? [])[fokus.index]
    if (!a) return null
    const vonS = isoZuOffset(startIso, a.ab)
    const bisS = a.typ === 'sfx' ? vonS : a.bis !== undefined ? isoZuOffset(startIso, a.bis) : skala.bisS
    return { art: 'audio', vonS, bisS, ab: a.ab, naechsteAb: null, index: fokus.index }
  }

  const m = medien.find((x) => x.id === fokus.id)
  if (!m?.anchor) return null
  const p = projiziereAufTrack(track, m.anchor[0], m.anchor[1])
  return { art: 'medium', vonS: p.punkt[3], bisS: p.punkt[3], ab: null, naechsteAb: null, id: m.id }
}

/** Trim-Griffe als Anteile (Default 0/1, wenn kein Trim gesetzt). */
export function baueTrimGriffe(edits: EditOverlay, startIso: string, skala: ZeitSkala): { start: number; ende: number } {
  const start = edits.trim?.start !== undefined ? offsetZuAnteil(skala, isoZuOffset(startIso, edits.trim.start)) : 0
  const ende = edits.trim?.ende !== undefined ? offsetZuAnteil(skala, isoZuOffset(startIso, edits.trim.ende)) : 1
  return { start, ende }
}

// — Wiedergabedauer schätzen —
//
// Die Zeitleiste zeigt AUFNAHMEZEIT; wie lang die fertige Animation läuft, ist
// eine andere Größe (die Engine fährt die Strecke mit eigenem Tempo ab und hält
// an jedem Foto an). Beides auf einer Achse zu zeigen wäre verwirrend — deshalb
// nur diese eine Zahl.
//
// Die drei Konstanten spiegeln src/tour.js. Ein Drift-Wächter in
// test/studio-baukasten.test.ts vergleicht sie mit der Engine.

/** `baseSpeed` in src/tour.js: Streckenfortschritt bei 1× in m/s. */
const BASIS_TEMPO_MS = 120
/** Spiegel von MODE_SPEED (src/tour.js). */
const TEMPO: Record<Modus, number> = { walk: 0.4, bike: 1, moped: 1.15, jeep: 1.45, tram: 1.25, ferry: 2.5 }
/** `HOLD_HIDE` (5,2 s Anzeige) + `HOLD_AUSBLEND` (0,8 s) in src/tour.js. */
const HALT_ENGINE_S = 5.2
const HALT_AUSBLEND_S = 0.8

/** Meter zwischen zwei Trackpunkten (lokale Plattkarte — auf Segmentlänge genau genug). */
function meterZwischen(a: TrackPunkt, b: TrackPunkt): number {
  const kx = 111_320 * Math.cos((a[1] * Math.PI) / 180)
  const dx = (b[0] - a[0]) * kx
  const dy = (b[1] - a[1]) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Grobe Laufzeit der fertigen Animation in Sekunden: Fahrzeit je Abschnitt
 * (Länge ÷ modusabhängiges Tempo) plus die Haltezeit an jedem Foto.
 *
 * BEWUSST eine Näherung: Die Engine glättet und resampled die Route beim Laden
 * (buildRoute), beschleunigt weich an und hat ein Intro, das läuft, bis der
 * Zuschauer startet. Für die Frage „grob zwei Minuten oder eher zehn?" reicht
 * das; deshalb wird der Wert auch mit „~" angezeigt.
 */
export function schaetzeAnimationsdauer(
  abschnitte: ReadonlyArray<{ mode: Modus; aktiv: boolean; pts: readonly TrackPunkt[] }>,
  haltedauernS: readonly number[],
): number {
  let sekunden = 0
  for (const a of abschnitte) {
    if (!a.aktiv) continue // weggetrimmt: läuft nicht mit
    let meter = 0
    for (let i = 1; i < a.pts.length; i++) {
      meter += meterZwischen(a.pts[i - 1] as TrackPunkt, a.pts[i] as TrackPunkt)
    }
    sekunden += meter / (BASIS_TEMPO_MS * (TEMPO[a.mode] ?? 1))
  }
  for (const halt of haltedauernS) sekunden += halt + HALT_AUSBLEND_S
  return sekunden
}

/** Haltedauer eines Fotos, wie die Engine sie anwendet (display.holdS oder Default). */
export function haltedauerS(display?: { holdS?: number }): number {
  return display?.holdS ?? HALT_ENGINE_S
}

/**
 * Dauer in Sekunden → kurze Anzeige („2:05 Std", „14 Min", „38 Sek").
 * Für den Inspector: Zu einem Band gehört nicht nur „ab wann", sondern auch,
 * wie lange es gilt.
 */
export function formatiereDauer(sekunden: number): string {
  const s = Math.max(0, Math.round(sekunden))
  if (s < 60) return `${s} Sek`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} Min`
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std`
}

// — Maßband —
//
// Beim Hineinzoomen wird Platz frei, also darf die Skala feiner werden. Die
// Stufe ist die FEINSTE, bei der zwei Beschriftungen noch `MARKE_MIN_PX`
// auseinanderliegen; reicht selbst die gröbste nicht (sehr lange Tour, ganz
// herausgezoomt), wird sie genommen und die Beschriftungen rücken zusammen.

/** Stufen in Minuten, aufsteigend — von der Minute bis zum Tag. */
const STUFEN_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440] as const
/** Mindestabstand zweier Beschriftungen in px (eine „HH:MM" ist ~34 px breit). */
const MARKE_MIN_PX = 58
/** Halbe Beschriftungsbreite — darunter würde die Marke am Rand angeschnitten. */
const MARKE_HALB_PX = 20

/** Feinste Stufe (Minuten), die bei diesem Maßstab noch lesbar bleibt. */
export function waehleStufe(pxProMin: number): number {
  for (const s of STUFEN_MIN) {
    if (s * pxProMin >= MARKE_MIN_PX) return s
  }
  return STUFEN_MIN[STUFEN_MIN.length - 1] as number
}

function zeitFormat(zone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: zone })
  } catch {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
  }
}

/**
 * Versatz der Zone zu UTC in Minuten, zum Zeitpunkt `ms`. Über formatToParts,
 * weil `Date` selbst nur die Zone des Browsers kennt — die Tour kann in einer
 * anderen liegen (Koh Pha-ngan: +07).
 */
function zonenVersatzMin(ms: number, zone: string): number {
  let teile: Intl.DateTimeFormatPart[]
  try {
    teile = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms))
  } catch {
    return -new Date(ms).getTimezoneOffset()
  }
  const w = (typ: string) => Number(teile.find((t) => t.type === typ)?.value ?? '0')
  // Stunde 24 kommt bei hour12:false für Mitternacht vor — Date.UTC verkraftet das.
  const alsUtc = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour'), w('minute'), w('second'))
  return Math.round((alsUtc - ms) / 60000)
}

/**
 * Wanduhrzeit (als wäre sie UTC) → echter Zeitpunkt. Zwei Durchgänge, weil der
 * Versatz selbst vom Zeitpunkt abhängt: die erste Schätzung kann bei einer
 * Sommerzeit-Umstellung eine Stunde danebenliegen.
 */
function lokalZuAbsolut(lokalMs: number, zone: string): number {
  const ersterVersuch = lokalMs - zonenVersatzMin(lokalMs, zone) * 60000
  return lokalMs - zonenVersatzMin(ersterVersuch, zone) * 60000
}

export interface Massbandmarke {
  anteil: number
  text: string
  /** volle Stunde — kräftigerer Teilstrich als die Zwischenstufen */
  voll: boolean
  /** am Rand angeschnitten? Dann links- statt mittenbündig ausrichten. */
  rand: 'anfang' | 'ende' | null
}

/**
 * Beschriftete Marken der Zeitachse. Das Raster liegt auf der LOKALEN Uhrzeit
 * der Tour (also „15:00", nicht „15:07 = Tourbeginn + 2 h") — sonst liest sich
 * die Achse wie eine Stoppuhr statt wie eine Uhr.
 */
export function baueMassband(
  startIso: string,
  skala: ZeitSkala,
  zone: string,
  pxProMin: number,
): Massbandmarke[] {
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return []
  const vonMs = startMs + skala.vonS * 1000
  const bisMs = startMs + skala.bisS * 1000
  const spanneMin = (bisMs - vonMs) / 60000
  if (!(spanneMin > 0)) return []

  const stufeMin = waehleStufe(pxProMin)
  const rasterMs = stufeMin * 60000
  const breitePx = spanneMin * pxProMin
  const fmt = zeitFormat(zone)

  const versatz = zonenVersatzMin(vonMs, zone) * 60000
  let lokal = Math.ceil((vonMs + versatz) / rasterMs) * rasterMs

  const marken: Massbandmarke[] = []
  // In der Sommerzeit-LÜCKE gibt es Wanduhrzeiten, die nie stattfinden (02:30
  // am Umstellungstag). Die Rückrechnung liefert dann denselben Zeitpunkt wie
  // eine spätere Marke — ohne diese Sperre stünde die Stunde doppelt und die
  // Achse liefe rückwärts.
  let letztesMs = -Infinity
  // Deckel gegen Endlosschleifen bei absurden Eingaben (pxProMin ~ 0).
  for (let i = 0; i < 5000; i++) {
    const ms = lokalZuAbsolut(lokal, zone)
    if (ms > bisMs) break
    if (ms >= vonMs && ms > letztesMs) {
      letztesMs = ms
      const anteil = offsetZuAnteil(skala, (ms - startMs) / 1000)
      const x = anteil * breitePx
      marken.push({
        anteil,
        text: fmt.format(new Date(ms)),
        voll: lokal % 3_600_000 === 0,
        rand: x < MARKE_HALB_PX ? 'anfang' : x > breitePx - MARKE_HALB_PX ? 'ende' : null,
      })
    }
    lokal += rasterMs
  }
  return marken
}

// — Streckenmeter —
//
// Die Leiste zeigt Zeit, die Kopf-Uhr daneben aber „19,2 km / 41,8 km": wo auf
// der STRECKE steht der Abspielkopf? Dafür einmal die kumulierten Meter je
// Trackpunkt aufbauen und zwischen den Punkten linear interpolieren.

/** Kumulierte Streckenmeter je Trackpunkt (Index-gleich zu `track`). */
export function kumMeter(track: readonly TrackPunkt[]): number[] {
  const kum: number[] = new Array(track.length)
  kum[0] = 0
  for (let i = 1; i < track.length; i++) {
    kum[i] = (kum[i - 1] as number) + meterZwischen(track[i - 1] as TrackPunkt, track[i] as TrackPunkt)
  }
  return kum
}

/** Zurückgelegte Meter zum Zeit-Offset (s), zwischen den Punkten interpoliert. */
export function meterZuOffset(kum: readonly number[], track: readonly TrackPunkt[], tOffsetS: number): number {
  if (track.length === 0) return 0
  const erster = track[0] as TrackPunkt
  const letzter = track[track.length - 1] as TrackPunkt
  if (tOffsetS <= erster[3]) return 0
  if (tOffsetS >= letzter[3]) return (kum[kum.length - 1] as number) ?? 0
  let i = 1
  while (i < track.length - 1 && (track[i] as TrackPunkt)[3] < tOffsetS) i++
  const a = track[i - 1] as TrackPunkt
  const b = track[i] as TrackPunkt
  const spanne = b[3] - a[3]
  const f = spanne > 0 ? (tOffsetS - a[3]) / spanne : 0
  return (kum[i - 1] as number) + f * ((kum[i] as number) - (kum[i - 1] as number))
}

/** Zeit-Offset (s) zu zurückgelegten Metern — Umkehrung von `meterZuOffset`. */
export function offsetBeiMeter(kum: readonly number[], track: readonly TrackPunkt[], meter: number): number {
  if (track.length === 0) return 0
  const erster = track[0] as TrackPunkt
  const letzter = track[track.length - 1] as TrackPunkt
  const max = (kum[kum.length - 1] as number) ?? 0
  if (meter <= 0) return erster[3]
  if (meter >= max) return letzter[3]
  let i = 1
  while (i < kum.length - 1 && (kum[i] as number) < meter) i++
  const a = kum[i - 1] as number
  const b = kum[i] as number
  const spanne = b - a
  const f = spanne > 0 ? (meter - a) / spanne : 0
  const ta = (track[i - 1] as TrackPunkt)[3]
  const tb = (track[i] as TrackPunkt)[3]
  return ta + f * (tb - ta)
}

/**
 * Nach dem Zoomen die Ansicht so scrollen, dass der Anker (Anteil 0..1) wieder
 * an derselben Stelle im Fenster steht — sonst springt der Blick beim Zoomen
 * irgendwohin. `spurXpx` ist die feste Breite der Namensspalte links.
 */
export function ankerScroll(ankerAnteil: number, zeitBreitePx: number, zielVx: number, spurXpx: number): number {
  return Math.max(0, spurXpx + ankerAnteil * zeitBreitePx - zielVx)
}
