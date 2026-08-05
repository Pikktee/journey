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
  punktZuOffset,
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

/**
 * Aufnahmezeit ↔ Fahr- und Haltezeit des FILMS, beide Arrays monoton
 * nicht-fallend. Duplikate in `tS` sind Foto-Halte (Zeit steht, Film läuft) —
 * ein „Sprung"; konstante `filmS` über wachsendem `tS` sind reale Pausen —
 * ein „Plateau".
 */
export interface AchsenKurve {
  tS: number[]
  filmS: number[]
  /** Filmzeit der ganzen Achse inkl. Halte (letzter filmS-Wert) */
  gesamtS: number
}

/**
 * Die Achse der Zeitleiste. Mit `kurve` ist die Leiste FILM-proportional:
 * gleich breit heißt gleich lang im fertigen Film (eine Fähre schrumpft, ein
 * Foto-Halt bekommt seine Standzeit als Breite, eine reale Pause verschwindet
 * fast). Ohne `kurve` bleibt sie linear über der Aufnahmezeit — der Fallback
 * für degenerierte Touren und der Not-Schalter des Umbaus.
 */
export interface Achse extends ZeitSkala {
  kurve?: AchsenKurve
  /**
   * Die eingewebten Halte als INTERVALLE (Filmsekunden). Die Achse weiß als
   * Einzige, wie viel Filmzeit jeder Halt belegt — ohne diese Liste gibt es die
   * Auskunft „steht der Kopf in einem Halt, und wo darin?" nicht: in
   * AUFNAHMEzeit hat ein Halt keine Ausdehnung (zwei Stützstellen auf derselben
   * Sekunde), jede Rückrechnung fällt auf seine linke Kante.
   */
  halte?: readonly HaltIntervall[]
}

export function baueSkala(track: readonly TrackPunkt[]): ZeitSkala | null {
  const erster = track[0]
  const letzter = track[track.length - 1]
  if (!erster || !letzter || letzter[3] <= erster[3]) return null
  return { vonS: erster[3], bisS: letzter[3] }
}

/**
 * Anteil 0..1 auf der Leiste → Zeit-Offset (s), geklemmt. Auf der Filmzeit-
 * Achse liefert ein Anteil INNERHALB eines Halt-Sprungs die Halt-Zeit —
 * die Interpolation zwischen zwei gleichen `tS`-Stützstellen ist konstant.
 */
export function anteilZuOffset(skala: ZeitSkala | Achse, anteil: number): number {
  const a = Math.max(0, Math.min(1, anteil))
  const kurve = (skala as Achse).kurve
  if (kurve) return interpoliere(kurve.filmS, kurve.tS, a * kurve.gesamtS)
  return skala.vonS + a * (skala.bisS - skala.vonS)
}

/**
 * Zeit-Offset (s) → Anteil 0..1, geklemmt. Auf der Filmzeit-Achse landet die
 * Halt-Zeit selbst am Sprung-ANFANG (lower_bound trifft die erste Stützstelle
 * der Stufe); knapp danach liegt hinter dem Sprung.
 */
export function offsetZuAnteil(skala: ZeitSkala | Achse, tOffsetS: number): number {
  const kurve = (skala as Achse).kurve
  if (kurve) return interpoliere(kurve.tS, kurve.filmS, tOffsetS) / kurve.gesamtS
  return Math.max(0, Math.min(1, (tOffsetS - skala.vonS) / (skala.bisS - skala.vonS)))
}

/** Film-Sekunde der ACHSE (inkl. Halte) zu einem Zeit-Offset — für Kopf-Uhr
 *  und Spielkurve. Ohne Kurve linear auf [0, 1] skaliert (degenerierter Fall). */
export function filmZuOffset(achse: Achse, tOffsetS: number): number {
  if (achse.kurve) return interpoliere(achse.kurve.tS, achse.kurve.filmS, tOffsetS)
  return offsetZuAnteil(achse, tOffsetS)
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
  /**
   * Spanne eines Ton-Klips in AUFNAHMEZEIT-Offsets, aufgelöst über die
   * Film-Achse (der Aufrufer kennt sie, dieses Modul nicht).
   *
   * Ohne sie fiele die Auflösung auf `ab`/`bis` zurück — und die haben seit
   * Etappe 4 keinen Vorrang mehr: Der Inspector zeigte dann die ALTE Lage,
   * während die Leiste daneben die neue zeichnet.
   */
  tonSpanne?: (index: number) => { vonS: number; bisS: number } | null,
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
    const ausAchse = tonSpanne?.(fokus.index)
    const vonS = ausAchse ? ausAchse.vonS : isoZuOffset(startIso, a.ab)
    const bisS = ausAchse
      ? ausAchse.bisS
      : a.typ === 'sfx'
        ? vonS
        : a.bis !== undefined
          ? isoZuOffset(startIso, a.bis)
          : skala.bisS
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
export const HALT_ENGINE_S = 5.2
export const HALT_AUSBLEND_S = 0.8

/** Film-Tempo eines Modus in m/s — die EINE Formel für Schätzung und Kurve. */
const tempoMs = (mode: Modus): number => BASIS_TEMPO_MS * (TEMPO[mode] ?? 1)

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
    sekunden += fahrzeitS(a)
  }
  for (const halt of haltedauernS) sekunden += halt + HALT_AUSBLEND_S
  return sekunden
}

/** Fahr-Filmzeit eines Abschnitts (s): Länge ÷ modusabhängiges Tempo. */
function fahrzeitS(a: { mode: Modus; pts: readonly TrackPunkt[] }): number {
  let meter = 0
  for (let i = 1; i < a.pts.length; i++) {
    meter += meterZwischen(a.pts[i - 1] as TrackPunkt, a.pts[i] as TrackPunkt)
  }
  return meter / tempoMs(a.mode)
}

/** Haltedauer eines Fotos, wie die Engine sie anwendet (display.holdS oder Default). */
export function haltedauerS(display?: { holdS?: number }): number {
  return display?.holdS ?? HALT_ENGINE_S
}

/**
 * Filmzeit, die EINE Aufnahme im Halt belegt (ohne Ausblendung).
 *
 * Für ein Video ist das seine echte Länge und sonst nichts: Der Player läuft
 * bis zum Ende der Datei, `display.holdS` ist dort wirkungslos (src/tour.js) —
 * ein Griff dafür wäre eine Lüge. Kennt der Server die Länge noch nicht
 * (unverarbeiteter Altbestand, `dauerS` fehlt), bleibt es bei der Foto-Annahme;
 * die Leiste zeigt dann zu wenig, aber nichts bricht.
 */
export function aufnahmeHaltS(m: {
  type: 'photo' | 'video'
  dauerS?: number
  display?: { holdS?: number }
  trim?: { vonS: number; bisS?: number }
}): number {
  if (m.type === 'video' && m.dauerS !== undefined && m.dauerS > 0) return videoFilmS(m.dauerS, m.trim)
  return haltedauerS(m.display)
}

/**
 * Video-Schnitt auf das MATERIAL klemmen — Spiegel von `klemmeSchnitt`
 * (server/src/pipeline/video.ts), wo er tatsächlich angewandt wird.
 *
 * `null` heißt „kein wirksamer Schnitt" = ganze Datei. Die Regeln stehen
 * zweimal, weil sie an zwei Orten gebraucht werden: Der Server MUSS klemmen
 * (er schneidet), die Leiste SOLL dieselbe Breite zeigen — sonst plant man
 * einen Schnitt und sieht später einen anderen. Ein Drift-Wächter in
 * test/studio-baukasten.test.ts hält beide zusammen.
 */
export function klemmeVideoTrim(
  trim: { vonS: number; bisS?: number } | undefined,
  dateiS: number,
): { vonS: number; bisS: number } | null {
  if (!trim || !(dateiS > 0)) return null
  const vonS = Math.min(Math.max(0, trim.vonS), dateiS)
  const bisS = trim.bisS === undefined ? dateiS : Math.min(Math.max(0, trim.bisS), dateiS)
  if (!(bisS - vonS > VIDEO_TRIM_MIN_S)) return null
  if (vonS <= 0 && bisS >= dateiS) return null // Vollschnitt ist kein Schnitt
  return { vonS, bisS }
}

/** Kürzester Video-Ausschnitt (s) — Spiegel der Schranke in video.ts. */
export const VIDEO_TRIM_MIN_S = 0.05

/**
 * Filmzeit eines Videos: die getrimmte Länge, sonst die ganze Datei.
 *
 * Hier entsteht der RIPPLE aus §2F, ohne dass ihn jemand programmiert:
 * Ein Video liegt in einer Halt-Kette, die keine Lücken kennt. Wird es kürzer,
 * wird sein Halt schmaler, die Achse baut sich neu — und alles Folgende rückt
 * vor. Eine Lücke kann gar nicht entstehen.
 */
export function videoFilmS(dateiS: number, trim?: { vonS: number; bisS?: number }): number {
  const geklemmt = klemmeVideoTrim(trim, dateiS)
  return geklemmt ? geklemmt.bisS - geklemmt.vonS : dateiS
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

// — Filmkurve (Wiedergabe) —
//
// Übersetzt zwischen Achsen-ANTEIL und FILMSEKUNDE der Wiedergabe — das
// Tempo-Gesetz des Abspielens (abspielen.ts). Auf der film-proportionalen
// Achse ist sie die Identität; Plateaus entstehen über weggetrimmten
// Bereichen (`baueSpielKurve`), die der Kopf überfliegt.
//
// Beide Richtungen laufen über dieselbe lower_bound-Interpolation. Deren eine
// Konvention trägt alle Sonderfälle: Über einem Plateau ist `filmS` konstant
// — die Umkehrung liefert dort die FRÜHESTE Stützstelle, also den Moment des
// Ankommens (dieselbe Wahl wie `zeitZurPosition` im Server).

/** Achsen-Anteil ↔ Filmsekunden, beide Arrays monoton nicht-fallend. */
export interface Filmkurve {
  anteile: number[]
  filmS: number[]
  /** Filmzeit der ganzen Wiedergabe (letzter filmS-Wert) */
  gesamtS: number
}

/**
 * Stückweise lineare Auswertung ys(x) über monoton nicht-fallendem xs.
 * lower_bound: erster Index mit xs[i] ≥ x — bei Duplikat-Stufen in xs landet
 * ein exakter Treffer damit auf der ERSTEN Stützstelle der Stufe, knapp
 * darüber hinter der letzten. Außerhalb wird geklemmt.
 */
function interpoliere(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length
  if (n === 0) return 0
  if (x <= (xs[0] as number)) return ys[0] as number
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mitte = (lo + hi) >> 1
    if ((xs[mitte] as number) < x) lo = mitte + 1
    else hi = mitte
  }
  const a = xs[lo - 1] as number
  const b = xs[lo] as number
  const spanne = b - a
  const u = spanne > 0 ? (x - a) / spanne : 1
  return (ys[lo - 1] as number) + u * ((ys[lo] as number) - (ys[lo - 1] as number))
}

/** Fahr-Filmsekunde an einem Achsen-Anteil. */
export function filmBei(kurve: Filmkurve, anteil: number): number {
  return interpoliere(kurve.anteile, kurve.filmS, anteil)
}

/** Achsen-Anteil zu einer Fahr-Filmsekunde (Umkehrung; Plateau → Ankunft). */
export function anteilBei(kurve: Filmkurve, filmS: number): number {
  return interpoliere(kurve.filmS, kurve.anteile, filmS)
}

// — Filmzeit-ACHSE —
//
// Ab hier wird die Kurve zur Leiste selbst: Position ∝ Filmzeit. Anders als
// die Spielplan-Kurve (oben) rechnet die Achsen-Kurve in ZEIT-OFFSETS und
// enthält die Foto-Halte als Sprünge — bei foto-lastigen Kurztouren IST der
// Film überwiegend Standzeit (56-min-Beispiel: ~48 s Halte vs. ~8 s Fahrt);
// ohne die Halte fände der Großteil des Films auf null Breite statt.

/** Eine Aufnahme innerhalb eines Halts — Kette statt Stapel (docs §2A). */
export interface HaltStueck {
  id: string
  /** Filmzeit dieser Aufnahme inkl. ihrer Ausblendung */
  dauerS: number
}

/** Ein Halt für die Achse: wo er liegt und wie viel Filmzeit er kostet. */
export interface AchsenHalt {
  offsetS: number
  breiteS: number
  /**
   * Was für ein Halt das ist (im Editor: Aufnahmen oder Kamera-Moment). Für die
   * Achse sind alle Halte gleich — sie kosten Filmzeit und kosten keine
   * Aufnahmezeit; das Wort braucht nur, wer den Stand benennen will.
   */
  art?: string
  /**
   * Wer diesen Halt bildet — Indizes in der Liste des Aufrufers (im Editor die
   * Stopps). Die Achse rechnet damit nicht, sie reicht sie durch: Wer beim
   * Kopfstand „Halt · ‹Titel›" schreiben will, braucht den Rückweg zum Objekt.
   */
  indizes?: readonly number[]
  /**
   * Die Aufnahmen des Halts in Abspielreihenfolge. Erst damit lässt sich sagen,
   * WELCHE Aufnahme gerade steht — ein Halt mit drei Fotos ist im Film eine
   * Folge von dreien, kein einzelner Block.
   */
  stuecke?: readonly HaltStueck[]
}

/** Ein eingewebter Halt: dazu, wo er im FILM liegt. */
export interface HaltIntervall extends AchsenHalt {
  filmVon: number
  filmBis: number
}

/** Wo der Kopf in einem Halt steht — die Auskunft für die Statuszeile. */
export interface HaltStand {
  /** Index in `achse.halte` */
  index: number
  halt: HaltIntervall
  /** verstrichene Standzeit (s) */
  imHaltS: number
  /** verbleibende Standzeit (s) */
  restS: number
  /** Welche Aufnahme des Halts gerade steht — fehlt, wenn keine bekannt sind. */
  stueck?: {
    /** 1-basiert, wie es in der Statuszeile steht */
    nr: number
    anzahl: number
    id: string
    /** verstrichene Zeit IN dieser Aufnahme */
    imS: number
    dauerS: number
  }
}

/**
 * Steht die Filmsekunde `filmS` in einem Halt — und wo darin?
 *
 * Die Ankunft (`filmVon`) zählt dazu, die Abfahrt (`filmBis`) nicht: dort läuft
 * die Fahrt schon wieder. Ausnahme ist das Ende der Achse — endet der Film in
 * einem Halt, steht der Kopf dort bis zur letzten Sekunde in ihm und nicht im
 * Nichts dahinter.
 */
export function haltBeiFilmS(achse: Achse, filmS: number): HaltStand | null {
  const halte = achse.halte
  if (!halte?.length) return null
  const ende = achse.kurve?.gesamtS ?? 0
  for (const [index, halt] of halte.entries()) {
    if (filmS < halt.filmVon) return null // Halte sind sortiert — ab hier kommt nur Späteres
    // Toleranz gegen die Rundung der Achsen-Summe: der letzte Halt endet
    // rechnerisch selten exakt auf `gesamtS`.
    const amEnde = halt.filmBis >= ende - 1e-6
    const drin = filmS < halt.filmBis || (amEnde && filmS <= ende + 1e-6)
    if (drin) {
      const imHaltS = Math.min(Math.max(filmS - halt.filmVon, 0), halt.breiteS)
      const stueck = stueckBei(halt.stuecke, imHaltS)
      return { index, halt, imHaltS, restS: halt.breiteS - imHaltS, ...(stueck ? { stueck } : {}) }
    }
  }
  return null
}

/** Welche Aufnahme der Kette bei `imHaltS` läuft (letzte gewinnt am Ende). */
function stueckBei(
  stuecke: readonly HaltStueck[] | undefined,
  imHaltS: number,
): HaltStand['stueck'] | null {
  if (!stuecke?.length) return null
  let gelaufen = 0
  for (const [i, s] of stuecke.entries()) {
    const letzte = i === stuecke.length - 1
    if (imHaltS < gelaufen + s.dauerS || letzte) {
      return {
        nr: i + 1,
        anzahl: stuecke.length,
        id: s.id,
        imS: Math.min(Math.max(imHaltS - gelaufen, 0), s.dauerS),
        dauerS: s.dauerS,
      }
    }
    gelaufen += s.dauerS
  }
  return null
}

// — Szenen-Bahn: ein Halt ist eine KETTE, kein Stapel —
//
// Der „Cluster" war nie ein eigenes Ding, sondern die Folge zusammenfallender
// Anker — als Stapel gezeichnet, weil PUNKTE an derselben Stelle
// übereinanderlägen. Klips mit Breite haben das Problem nicht: jede Aufnahme
// belegt ihre eigene Filmzeit (Standzeit bzw. Videolänge, je plus Ausblendung),
// und die Kette liegt lückenlos hintereinander.

/** Eine Aufnahme als Klip der Szenen-Bahn — von Filmsekunde bis Filmsekunde. */
export interface SzenenKlip {
  id: string
  /** Index des Halts in `achse.halte` — der Rückweg zur Kette */
  haltIndex: number
  /** Platz in der Kette (0-basiert) und deren Länge */
  platz: number
  anzahl: number
  filmVon: number
  filmBis: number
}

/**
 * Die Klips aller Halte, in Abspielreihenfolge. Halte ohne bekannte Stücke
 * (Kamera-Momente: sie halten den Film an, aber keine Aufnahme steht dahinter)
 * bleiben außen vor — sie haben ihre eigene Bahn.
 */
export function baueSzenenKlips(achse: Achse): SzenenKlip[] {
  const klips: SzenenKlip[] = []
  for (const [haltIndex, halt] of (achse.halte ?? []).entries()) {
    const stuecke = halt.stuecke
    if (!stuecke?.length) continue
    let film = halt.filmVon
    for (const [platz, s] of stuecke.entries()) {
      klips.push({ id: s.id, haltIndex, platz, anzahl: stuecke.length, filmVon: film, filmBis: film + s.dauerS })
      film += s.dauerS
    }
  }
  return klips
}

/** Einfüge-Platz in einer Kette samt der Filmsekunde, an der die Marke steht. */
export interface KettenPlatz {
  /** 0..n — vor dem ersten Klip bis hinter den letzten */
  platz: number
  /** Filmsekunde der Fuge (dort steht die Einfügemarke) */
  filmS: number
}

/**
 * Wohin fällt ein Klip, der bei `filmS` losgelassen wird? Entschieden wird an
 * der MITTE jedes Klips: bis dahin gehört der Zeiger noch davor. Ein Vergleich
 * gegen die Kanten ließe die Marke erst umspringen, wenn man den Nachbarn
 * schon ganz überfahren hat.
 */
export function platzInKette(halt: HaltIntervall, filmS: number): KettenPlatz {
  let fuge = halt.filmVon
  let platz = 0
  for (const s of halt.stuecke ?? []) {
    if (filmS < fuge + s.dauerS / 2) break
    platz += 1
    fuge += s.dauerS
  }
  return { platz, filmS: fuge }
}

/**
 * `id` an Platz `platz` der Liste schieben (Platz zählt die FUGEN, 0..n).
 * Wandert der Eintrag nach hinten, rückt alles dazwischen um eins vor —
 * deshalb `platz - 1`, sonst landete er immer eine Stelle zu weit rechts.
 */
export function ordneEin(ids: readonly string[], id: string, platz: number): string[] {
  const von = ids.indexOf(id)
  if (von < 0) return [...ids]
  const nach = Math.max(0, Math.min(ids.length - 1, platz > von ? platz - 1 : platz))
  if (nach === von) return [...ids]
  const folge = [...ids]
  folge.splice(von, 1)
  folge.splice(nach, 0, id)
  return folge
}

/**
 * Halt, in dessen INNEREM `filmS` liegt — das Andockziel eines Klip-Zugs.
 *
 * Anders als `haltBeiFilmS` zählen die Kanten NICHT dazu: genau dort beginnt
 * bzw. endet die Fahrt, und ein Klip, der an der Ankunft schon andockte,
 * ließe sich nicht mehr davor absetzen.
 */
export function haltInnenBei(achse: Achse, filmS: number): HaltIntervall | null {
  for (const halt of achse.halte ?? []) {
    if (filmS <= halt.filmVon) break // Halte sind sortiert
    if (filmS < halt.filmBis) return halt
  }
  return null
}

/** Grenzen der Standzeit (s) — Spiegel des Server-Schemas (schema/edits.ts). */
export const STANDZEIT_MIN_S = 2
export const STANDZEIT_MAX_S = 60

/**
 * Standzeit auf gültige Grenzen und Zehntelsekunden bringen. Ohne die Rundung
 * schriebe jeder Zieh-Frame eine neue Nachkommastelle ins Overlay; ohne die
 * Klemme liefe der Griff in einen Wert, den der Server beim Speichern ablehnt.
 */
export function klemmeStandzeit(sekunden: number): number {
  const s = Math.round(sekunden * 10) / 10
  return Math.max(STANDZEIT_MIN_S, Math.min(STANDZEIT_MAX_S, s))
}

/** Filmsekunde → Anteil 0..1 auf der Leiste (die Achse IST film-proportional). */
export function filmZuAnteil(achse: Achse, filmS: number): number {
  const gesamt = achse.kurve?.gesamtS ?? 0
  return gesamt > 0 ? Math.max(0, Math.min(1, filmS / gesamt)) : 0
}

/** Anteil 0..1 → Filmsekunde. */
export function anteilZuFilm(achse: Achse, anteil: number): number {
  return Math.max(0, Math.min(1, anteil)) * (achse.kurve?.gesamtS ?? 0)
}

/** Sekunden für die Statuszeile: „2,1" — eine Nachkommastelle, deutsches Komma. */
const sekText = (s: number): string => s.toFixed(1).replace('.', ',')

/** Sekunden mit Einheit („5,2 s") — für Klip-Beschriftung und Dauer-Blase. */
export function formatiereSekunden(sekunden: number): string {
  return `${sekText(sekunden)} s`
}

/**
 * Der Halt-Stand als Satzteil: „Aufnahme 2 von 3 · 2,1 s von 6,0 s".
 *
 * Bei einer einzigen Aufnahme bleibt das Zählwerk weg — „Aufnahme 1 von 1"
 * sagt nichts, was man nicht sieht. Ohne bekannte Stücke zählt die Zeit im
 * ganzen Halt.
 */
export function beschreibeHaltStand(stand: HaltStand): string {
  const s = stand.stueck
  if (!s) return `${sekText(stand.imHaltS)} s von ${sekText(stand.halt.breiteS)} s`
  const zeit = `${sekText(s.imS)} s von ${sekText(s.dauerS)} s`
  return s.anzahl > 1 ? `Aufnahme ${s.nr} von ${s.anzahl} · ${zeit}` : zeit
}

/**
 * Kopfposition um `deltaFilmS` verschieben (Pfeiltasten), geklemmt auf die
 * Achse. Führende Größe ist die FILMsekunde — genau deshalb überspringt der
 * Schritt keinen Halt mehr: in Aufnahmezeit gerechnet fiel er auf die linke
 * Haltkante zurück und kam an einem 6-s-Halt nie vorbei (docs §1).
 */
export function schrittFilmS(achse: Achse, filmS: number, deltaFilmS: number): number {
  const gesamt = achse.kurve?.gesamtS ?? 0
  return Math.max(0, Math.min(gesamt, filmS + deltaFilmS))
}

/**
 * Die Filmzeit-Achse aus Anzeige-Abschnitten und Foto-Halten.
 *
 * Trim wird bewusst IGNORIERT (alle Abschnitte zählen voll): die Achse ist
 * Bearbeitungsfläche — ein weggetrimmter Rand mit Breite 0 wäre nicht mehr
 * anfassbar. Wie lang der Film WIRKLICH läuft, sagt die Spielkurve
 * (`baueSpielKurve`), die über getrimmte Bereiche hinwegfliegt.
 *
 * Degeneriert-Wächter: erst NACH dem Einweben der Halte — eine Foto-Tour ohne
 * nennenswerte Fahrstrecke hat trotzdem einen echten Film (fast nur
 * Standzeiten; 8 Fotos ≈ 48 s), und genau dort wäre eine lineare
 * Aufnahmezeit-Achse am falschesten. Ohne Fahrzeit UND ohne Halte kommt die
 * Achse OHNE Kurve zurück (linearer Fallback).
 */
export function baueAchse(
  abschnitte: ReadonlyArray<{ mode: Modus; aktiv: boolean; pts: readonly TrackPunkt[] }>,
  halte: readonly AchsenHalt[],
  skala: ZeitSkala,
): Achse {
  const tS: number[] = []
  const filmS: number[] = []
  let film = 0
  for (const a of abschnitte) {
    const tempo = tempoMs(a.mode)
    for (let i = 0; i < a.pts.length; i++) {
      const p = a.pts[i] as TrackPunkt
      if (i > 0) film += meterZwischen(a.pts[i - 1] as TrackPunkt, p) / tempo
      const letzter = tS.length - 1
      if (letzter >= 0 && tS[letzter] === p[3] && filmS[letzter] === film) continue
      tS.push(p[3])
      filmS.push(film)
    }
  }
  if (tS.length < 2) return { ...skala, halte: [] }

  const intervalle = webeHalte(tS, filmS, halte)
  film = filmS[filmS.length - 1] as number

  if (film < 1) return { ...skala, halte: [] }
  return { ...skala, kurve: { tS, filmS, gesamtS: film }, halte: intervalle }
}

/**
 * Halte als Sprünge in eine (tS, filmS)-Kurve einweben — an der Halt-Zeit zwei
 * Stützstellen (Film vor und nach der Standzeit), alle späteren Werte heben
 * sich um die Breite. Weil aufsteigend gewebt wird, trägt `filmAmHalt` die
 * früheren Halte schon — die Intervalle stimmen ohne Nachrechnen.
 *
 * Beide Kurven mit Halten teilen sich diese Stelle: die ganze Achse
 * (`baueAchse`) und das Zug-Fenster einer Fortbewegungs-Grenze
 * (`baueGrenzKurve`). Zwei Fassungen liefen an den Rundungen auseinander, und
 * die Grenze landete beim Loslassen neben der Ziellinie.
 */
function webeHalte(tS: number[], filmS: number[], halte: readonly AchsenHalt[]): HaltIntervall[] {
  const intervalle: HaltIntervall[] = []
  for (const h of [...halte].sort((a, b) => a.offsetS - b.offsetS)) {
    if (!(h.breiteS > 0)) continue
    const filmAmHalt = interpoliere(tS, filmS, h.offsetS)
    // Einfügeposition: hinter alle Stützstellen ≤ Halt-Zeit
    let i = tS.length
    while (i > 0 && (tS[i - 1] as number) > h.offsetS) i--
    for (let j = i; j < tS.length; j++) filmS[j] = (filmS[j] as number) + h.breiteS
    tS.splice(i, 0, h.offsetS, h.offsetS)
    filmS.splice(i, 0, filmAmHalt, filmAmHalt + h.breiteS)
    intervalle.push({ ...h, filmVon: filmAmHalt, filmBis: filmAmHalt + h.breiteS })
  }
  return intervalle
}

// — Der Zug einer FORTBEWEGUNGS-Grenze: analytisch, nicht per Bisektion —
//
// Die Grenze beeinflusst die Abbildung, auf der sie selbst liegt: im Tempo je
// Modus steckt die Filmzeit, eine verschobene Kante dehnt oder staucht also die
// Achse. Mit der Achse des letzten Frames gerechnet sprang die Kante beim
// Loslassen um 116 px (docs §2D).
//
// Der Ausweg im Konzept war eine Bisektion (14 Achsenbauten je Zieh-Frame). An
// echten Tracks gemessen trägt die nicht: 335 Punkte kosten 0,6 ms, aber 10 000
// Punkte 12,5 ms — über dem 8-ms-Budget, und das ohne den Rest des Frames.
//
// Sie ist auch unnötig. Die Filmposition der Grenze hängt NUR von dem ab, was
// VOR ihr liegt: bis zur vorigen Grenze ändert sich gar nichts, und dazwischen
// gilt das Tempo des LINKEN Bands — unabhängig davon, wohin man zieht. Also ist
// F(t) eine feste, stückweise lineare, monotone Funktion, die man EINMAL beim
// Zug-Start aufbaut und danach in beide Richtungen auswertet. Exakt statt auf
// 0,2 s genau, und je Frame nur eine Interpolation.

/**
 * Film ↔ Aufnahmezeit im Zug-Fenster einer Fortbewegungs-Grenze.
 *
 * `vonS`/`bisS` sind die Nachbargrenzen (oder die Enden der Tour), `mode` der
 * Modus LINKS der gezogenen Kante, `filmBeiVon` ihre Filmsekunde in der
 * aktuellen Achse. Halte im Fenster kosten Filmzeit, ohne von der Grenze
 * abzuhängen — sie werden als dieselben Sprünge eingewebt wie in der Achse.
 *
 * Null, wenn im Fenster keine zwei Trackpunkte liegen: dann gibt es nichts zu
 * ziehen.
 */
export function baueGrenzKurve(
  track: readonly TrackPunkt[],
  vonS: number,
  bisS: number,
  mode: Modus,
  filmBeiVon: number,
  halte: readonly AchsenHalt[],
): AchsenKurve | null {
  const pts = punkteZwischen(track, vonS, bisS)
  if (pts.length < 2) return null
  const tempo = tempoMs(mode)
  const tS: number[] = []
  const filmS: number[] = []
  let film = filmBeiVon
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as TrackPunkt
    if (i > 0) film += meterZwischen(pts[i - 1] as TrackPunkt, p) / tempo
    tS.push(p[3])
    filmS.push(film)
  }
  // Ein Halt GENAU auf der linken Fensterkante zählt schon zu `filmBeiVon`
  // (lower_bound trifft die Stützstelle vor dem Sprung) — sonst zählte er
  // doppelt und die Kante liefe um seine Standzeit davon.
  webeHalte(tS, filmS, halte.filter((h) => h.offsetS > vonS && h.offsetS <= bisS))
  return { tS, filmS, gesamtS: filmS[filmS.length - 1] as number }
}

/** Trackpunkte im Zeitfenster, mit interpolierten Rändern (nie leer bei Bedarf). */
function punkteZwischen(track: readonly TrackPunkt[], vonS: number, bisS: number): TrackPunkt[] {
  const rand = (t: number): TrackPunkt | null => punktZuOffset(track, t)
  const links = rand(vonS)
  const rechts = rand(bisS)
  if (!links || !rechts) return []
  const mitte = track.filter((p) => p[3] > vonS && p[3] < bisS)
  return [links, ...mitte, rechts]
}

/** Aufnahmezeit zu einer Filmsekunde (Umkehrung; außerhalb geklemmt). */
export function zeitBeiFilm(kurve: AchsenKurve, filmS: number): number {
  return interpoliere(kurve.filmS, kurve.tS, filmS)
}

/** Filmsekunde zu einer Aufnahmezeit. */
export function filmBeiZeit(kurve: AchsenKurve, tOffsetS: number): number {
  return interpoliere(kurve.tS, kurve.filmS, tOffsetS)
}

/**
 * Filmdauer der GANZEN Tour, wenn die Grenze bei `tOffsetS` läge.
 *
 * Auch das braucht keine zweite Achse: Verschiebt man die Kante, wechselt
 * genau die Strecke zwischen alter und neuer Lage den Modus. Ihre Filmzeit
 * ändert sich um die Differenz der Kehrwerte der Tempi — alles andere bleibt.
 * (Für die Vorschau „Film 3:00 → 3:29" im Zug-Etikett.)
 */
export function filmDauerBeiGrenze(
  gesamtS: number,
  meterAlt: number,
  meterNeu: number,
  links: Modus,
  rechts: Modus,
): number {
  return gesamtS + (meterNeu - meterAlt) * (1 / tempoMs(links) - 1 / tempoMs(rechts))
}

// — Einrasten an Haltkanten —
//
// Toleranz in AUFNAHMEzeit, nicht in Filmsekunden: 0,01 Filmsekunden schmolzen
// auf dem Rückweg durch die Achse auf ein halbes Tausendstel und verloren gegen
// die lower_bound-Konvention — die Kante landete bis 71 px neben der Ziellinie
// (docs §5.6). Eine halbe Sekunde Aufnahmezeit ist eindeutig und auf der Leiste
// unsichtbar schmal.

/** Wie nah an einer Haltkante gerastet wird (Aufnahme-Sekunden). */
export const RAST_TOLERANZ_S = 0.5
/**
 * Abstand für „hinter dem Halt". Nicht kleiner: Overlay-Anker sind ISO-Zeiten
 * mit SEKUNDEN-Auflösung (`offsetZuIso` schneidet die Millisekunden ab) — ein
 * Epsilon fiele auf dieselbe Sekunde zurück und die Kante schnappte sichtbar
 * vor den Halt.
 */
export const RAST_HINTER_S = 1

export interface Rastung {
  tOffsetS: number
  /** Halt, an dem gerastet wurde — null heißt: freie Lage */
  halt: HaltIntervall | null
  /** true = hinter dem Halt (er läuft davor ab) */
  hinter: boolean
}

/**
 * Eine Loslass-Zeit an eine Haltkante rasten.
 *
 * Zwei Wege führen hin: Die Zeit liegt in Toleranz-Nähe einer Halt-Zeit, ODER
 * die Filmsekunde liegt IM Halt — dort gibt es in Aufnahmezeit gar keine
 * Zwischenposition, jede Rückrechnung fällt ohnehin auf seine linke Kante. Auf
 * welcher Seite die Grenze landet, entscheidet die Zeigerhälfte des Halts.
 *
 * `halte`, `filmS` und `tOffsetS` müssen aus DERSELBEN Abbildung stammen — und
 * das ist die, die der Nutzer SIEHT: die Achse. Beim Zug einer
 * Fortbewegungs-Grenze ist die Versuchung groß, hier die Grenzkurve zu nehmen
 * (in ihr rechnet der Zug ja seine Landezeit). Das geht zweimal schief: mit
 * gemischten Systemen rastet der Zug am falschen Halt, und mit durchgehend
 * Kurven-Koordinaten rastet er an einem Halt, der 159 px neben dem Zeiger
 * gezeichnet ist — richtig gerechnet, aber unbedienbar. Wo der Halt beim
 * Loslassen LANDET, ist eine andere Frage; sie hat mit dem Zielen nichts zu tun.
 *
 * Zurück kommt die Landezeit als AUFNAHMEzeit — die ist in beiden Systemen
 * dieselbe Größe und deshalb der einzige saubere Übergabepunkt.
 */
export function rasteAnHalt(
  halte: readonly HaltIntervall[],
  tOffsetS: number,
  filmS: number,
): Rastung {
  let treffer: HaltIntervall | null = null
  let bestAb = Infinity
  for (const h of halte) {
    const drin = filmS > h.filmVon && filmS < h.filmBis
    const ab = Math.abs(h.offsetS - tOffsetS)
    if (!drin && ab > RAST_TOLERANZ_S) continue
    if (drin || ab < bestAb) {
      bestAb = drin ? -1 : ab
      treffer = h
    }
  }
  if (!treffer) return { tOffsetS, halt: null, hinter: false }
  const hinter = filmS >= (treffer.filmVon + treffer.filmBis) / 2
  return { tOffsetS: treffer.offsetS + (hinter ? RAST_HINTER_S : 0), halt: treffer, hinter }
}

/**
 * Die Zug-Filmsekunde in ihr Fenster klemmen — in PIXELN, nicht in Sekunden.
 *
 * Mit ±1 s konnten zwei Grenzen so nah zusammenrücken, dass das Band dazwischen
 * unsichtbar und unanfassbar wurde (dieselbe Sorge wie `klemmeGrenze`, die
 * mindestens einen Trackpunkt im Abschnitt lässt). Ein Mindestabstand in
 * Pixeln hält das Band greifbar, egal wie die Achse dort gestaucht ist.
 */
export const BAND_MIN_PX = 14

export function klemmeFilmS(filmS: number, minFilmS: number, maxFilmS: number, pxProFilmS: number): number {
  const luft = pxProFilmS > 0 ? BAND_MIN_PX / pxProFilmS : 0
  const min = minFilmS + luft
  const max = maxFilmS - luft
  // Ist das Fenster schmaler als zweimal Luft, bleibt nur seine Mitte übrig —
  // besser als eine Klemme, die sich selbst überkreuzt.
  if (max <= min) return (minFilmS + maxFilmS) / 2
  return Math.max(min, Math.min(max, filmS))
}

/**
 * Abspiel-Kurve über der Achse: Achsen-Anteil → Filmsekunden der WIEDERGABE.
 * Ohne Trim die Identität (die Achse ist ja schon film-proportional); mit
 * Trim Plateaus über den inaktiven Bereichen — der Kopf fliegt darüber
 * hinweg, statt hypothetische Randbereiche abzuspielen.
 */
export function baueSpielKurve(
  achse: Achse,
  abschnitte: ReadonlyArray<{ aktiv: boolean; pts: readonly TrackPunkt[] }>,
): Filmkurve {
  const kurve = achse.kurve
  if (!kurve) return { anteile: [0, 1], filmS: [0, 1], gesamtS: 1 }
  if (abschnitte.every((a) => a.aktiv)) {
    return { anteile: [0, 1], filmS: [0, kurve.gesamtS], gesamtS: kurve.gesamtS }
  }
  const anteile: number[] = [0]
  const filmS: number[] = [0]
  let film = 0
  for (const a of abschnitte) {
    const vonT = (a.pts[0] as TrackPunkt)[3]
    const bisT = (a.pts[a.pts.length - 1] as TrackPunkt)[3]
    if (a.aktiv) film += filmZuOffset(achse, bisT) - filmZuOffset(achse, vonT)
    anteile.push(offsetZuAnteil(achse, bisT))
    filmS.push(film)
  }
  anteile.push(1)
  filmS.push(film)
  return film >= 1 ? { anteile, filmS, gesamtS: film } : { anteile: [0, 1], filmS: [0, 1], gesamtS: 1 }
}

// — Maßband —
//
// Die Achse ist film-proportional, das Maßband zählt deshalb FILMZEIT („0:30",
// „1:00") — gleichmäßige Marken statt des alten Wanduhr-Rasters (die Uhrzeit
// der Aufnahme steht weiter in Kopf-Uhr und Inspector). Beim Hineinzoomen wird
// Platz frei, also darf die Skala feiner werden: die Stufe ist die FEINSTE,
// bei der zwei Beschriftungen noch `MARKE_MIN_PX` auseinanderliegen.

/** Stufen in Film-Sekunden, aufsteigend — von der Sekunde bis zur Stunde. */
const STUFEN_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] as const
/** Mindestabstand zweier Beschriftungen in px (eine „m:ss" ist ~34 px breit). */
const MARKE_MIN_PX = 58
/** Halbe Beschriftungsbreite — darunter würde die Marke am Rand angeschnitten. */
const MARKE_HALB_PX = 20

/** Feinste Stufe (Film-Sekunden), die bei diesem Maßstab noch lesbar bleibt. */
export function waehleFilmStufe(pxProS: number): number {
  for (const s of STUFEN_S) {
    if (s * pxProS >= MARKE_MIN_PX) return s
  }
  return STUFEN_S[STUFEN_S.length - 1] as number
}

/** Filmzeit als „m:ss", ab einer Stunde „h:mm:ss". */
export function formatiereFilmzeit(sekunden: number): string {
  const s = Math.max(0, Math.round(sekunden))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  if (mm < 60) return `${mm}:${ss}`
  return `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}`
}

export interface Massbandmarke {
  anteil: number
  text: string
  /** volle Minute — kräftigerer Teilstrich als die Zwischenstufen */
  voll: boolean
  /** am Rand angeschnitten? Dann links- statt mittenbündig ausrichten. */
  rand: 'anfang' | 'ende' | null
}

/**
 * Beschriftete Marken der Filmzeit-Achse. Weil die Achse film-linear ist,
 * liegen die Marken äquidistant — auch mitten in einem Foto-Halt vergeht
 * Filmzeit, dort stehen sie genauso. Ohne Kurve (degenerierte Tour) gibt es
 * nichts Sinnvolles zu beschriften: leeres Band.
 */
export function baueFilmMassband(achse: Achse, pxProS: number): Massbandmarke[] {
  const gesamtS = achse.kurve?.gesamtS
  if (!gesamtS || !(pxProS > 0)) return []

  const stufeS = waehleFilmStufe(pxProS)
  const breitePx = gesamtS * pxProS
  const marken: Massbandmarke[] = []
  for (let filmT = 0; filmT <= gesamtS; filmT += stufeS) {
    const anteil = filmT / gesamtS
    const x = anteil * breitePx
    marken.push({
      anteil,
      text: formatiereFilmzeit(filmT),
      voll: filmT % 60 === 0,
      rand: x < MARKE_HALB_PX ? 'anfang' : x > breitePx - MARKE_HALB_PX ? 'ende' : null,
    })
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
