// Ton-Klips auf der Filmzeit-Achse (Etappe 4, docs/architecture/zeitleiste-umbau.md §2E).
//
// Ein Ton-Klip hängt seit dieser Etappe an der REISE, nicht an einer festen
// Filmsekunde — der „connected clip" aus Final Cut. Er merkt sich:
//
//   anker         WO auf der Reise (Aufnahmezeit, sekundengenau)
//   versatzFilmS  wo genau (FILMsekunden relativ zum Anker — darf in einer
//                 Standzeit liegen, was reine Aufnahmezeit nicht kann, §1)
//   dauerFilmS    wie lang im Film (Musik läuft in Echtzeit, sie dehnt sich
//                 nicht mit der Kamera → 1 Filmsekunde = 1 Dateisekunde)
//   einstiegS     wo IN der Datei (linker Trim)
//   loop          ob über das Dateiende hinaus wiederholt wird
//
// Dadurch rückt Ton mit, wenn Standzeiten oder die Fortbewegung sich ändern —
// vorher war er das einzige Element, das liegen blieb.
//
// ZWEI REGELN tragen das Trimmen, und beide gehen leicht verloren:
//
//  1. Der Anschlag ist an BEIDEN Kanten das MATERIAL. Trimmen legt frei, was
//     da ist, und erfindet nichts; Stille entsteht durch eine Lücke ZWISCHEN
//     Klips, nie in einem.
//  2. Loop hebt NUR den RECHTEN Anschlag auf. `el.loop` springt am Dateiende
//     auf den Dateianfang — eine Wiederholung VOR dem Anfang gibt es nicht.
//     (Der erste Wurf erlaubte links Beliebiges und ließ den Versatz modulo in
//     die Datei wandern: das Stück setzte mitten drin ein, obwohl man „mehr vom
//     Anfang" gezogen hatte. Vom Nutzer gefunden.)
//
// Alles hier ist DOM-frei und unter Vitest getestet; die Verdrahtung (Ziehen,
// Wellenform, Inspector) liegt in editor.ts.

import { isoToOffset, offsetToIso, type AudioEntry } from './edit-model.js'
import {
  filmTimeAtRecordingTime,
  filmToOffset,
  recordingTimeAtFilmTime,
  type TimelineAxis,
} from './timeline.js'

/** Kürzester Klip in Filmsekunden — darunter ist er nicht mehr zu greifen. */
export const AUDIO_MIN_S = 0.2

/** Ein aufgelöster Ton-Klip: wo er im FILM liegt und was er aus seiner Datei zeigt. */
export interface AudioClip {
  /** Index im Overlay-Array — die Identität (zwei Klips dürfen dieselbe Datei tragen) */
  index: number
  type: 'music' | 'sfx'
  file: string
  filmVon: number
  filmBis: number
  /** Einstieg in die Datei (s) */
  startS: number
  loop: boolean
  /** Länge der Datei (s), sofern gemessen — der Anschlag beider Kanten */
  fileS?: number
  /** Unterzeile bei Überlappung (der Player MISCHT, also stapelt die Leiste) */
  lane: number
  /**
   * Trägt der Eintrag noch die alte `from`/`to`-Verankerung? Dann ist seine Lage
   * aus der Aufnahmezeit abgeleitet — beim ersten Eingriff wird sie festgeschrieben.
   */
  legacyAnchored: boolean
  /**
   * Steht die Länge AUSDRÜCKLICH im Overlay — oder ist sie nur abgeleitet?
   *
   * Abgeleitet ist sie bei Musik ohne `to` („bis zum Tour-Ende") und bei einem
   * Effekt, dessen Breite aus der gemessenen Datei kommt. Eine bloße
   * Verschiebung darf sie NICHT festschreiben: Aus „läuft bis zum Schluss"
   * würde sonst still eine feste Dauer, und aus einem One-Shot ein Bereich, der
   * beim Scrubben anders anspringt. Erst wer an einer Kante zieht, sagt etwas
   * über die Länge.
   */
  hasExplicitLength: boolean
}

/** Was eine Geste ins Overlay schreibt. */
export interface AudioClipPatch {
  anchor: string
  offsetFilmS: number
  durationFilmS?: number
  startS?: number
}

/**
 * Filmsekunde → Anker + Versatz.
 *
 * Der Anker ist ein ISO-Zeitstempel und damit sekundengenau; die Feinlage
 * übernimmt der Versatz. Genau dafür gibt es ihn: Ohne ihn schnappte jeder
 * Klip beim Anfassen auf die nächste volle Sekunde der Aufnahmezeit — und
 * innerhalb eines Halts, wo es gar keine unterscheidbare Aufnahmezeit gibt,
 * fielen alle Lagen auf die linke Haltkante zusammen.
 */
export function anchorClips(
  axis: TimelineAxis,
  startIso: string,
  filmVon: number,
): { anchor: string; offsetFilmS: number } {
  if (!axis.curve) return { anchor: offsetToIso(startIso, filmVon), offsetFilmS: 0 }
  const offsetS = recordingTimeAtFilmTime(axis.curve, filmVon)
  // Auf ganze Sekunden runden: `offsetToIso` schreibt einen sekundengenauen
  // Stempel, und was dabei verlorenginge, landete sonst still im Versatz.
  const anchorS = Math.round(offsetS)
  return {
    anchor: offsetToIso(startIso, anchorS),
    offsetFilmS: roundTo(filmVon - filmTimeAtRecordingTime(axis.curve, anchorS), 3),
  }
}

/** Auf `stellen` Nachkommastellen runden — hält das Overlay lesbar und stabil. */
function roundTo(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/**
 * Filmlage EINES Eintrags auflösen — neue Verankerung bevorzugt, `from`/`to`
 * als Fallback.
 *
 * Der Fallback ist keine Übergangslösung, sondern der Vertrag: Ein Overlay von
 * vor Etappe 4 bleibt lesbar und rendert unverändert, bis jemand den Klip
 * anfasst.
 */
function resolvePosition(
  a: AudioEntry,
  startIso: string,
  axis: TimelineAxis,
  fileS: number | undefined,
): { filmVon: number; filmBis: number; legacyAnchored: boolean; hasExplicitLength: boolean } {
  const totalS = axis.curve?.totalS ?? 0
  const isNew =
    a.anchor !== undefined || a.offsetFilmS !== undefined || a.durationFilmS !== undefined
  const baseIso = a.anchor ?? a.from
  const filmVon =
    filmToOffset(axis, isoToOffset(startIso, baseIso)) + (isNew ? (a.offsetFilmS ?? 0) : 0)

  let filmBis: number
  let hasExplicitLength = true
  if (a.durationFilmS !== undefined) {
    filmBis = filmVon + a.durationFilmS
  } else if (a.type === 'music' && a.to !== undefined) {
    filmBis = filmToOffset(axis, isoToOffset(startIso, a.to))
  } else if (a.type === 'music') {
    // Musik ohne Ende läuft bis zum Tour-Ende (so rendert es die Pipeline).
    filmBis = totalS
    hasExplicitLength = false
  } else {
    // Ein Effekt klingt, solange seine DATEI dauert — der Player spielt sie
    // aus. Die Marke ohne Länge war eine Lüge der ANZEIGE, nicht des Films;
    // sobald die Datei gemessen ist, zeigt die Leiste, was ohnehin passiert.
    filmBis = fileS !== undefined && fileS > 0 ? filmVon + fileS : filmVon
    hasExplicitLength = false
  }
  return { filmVon, filmBis: Math.max(filmVon, filmBis), legacyAnchored: !isNew, hasExplicitLength }
}

/**
 * Alle Ton-Klips auflösen und in Unterzeilen stapeln.
 *
 * `fileDurations` sind die gemessenen Dateilängen (der Editor misst sie lazy per
 * `loadedmetadata`); fehlt eine, bleibt der Klip ohne Materialanschlag und ein
 * Effekt ohne Breite — nichts bricht, es wird nur weniger gezeigt.
 */
export function resolveAudioClips(
  audio: readonly AudioEntry[],
  startIso: string,
  axis: TimelineAxis,
  fileDurations?: ReadonlyMap<string, number>,
): AudioClip[] {
  const clips: AudioClip[] = []
  audio.forEach((a, index) => {
    const fileS = fileDurations?.get(a.file)
    const position = resolvePosition(a, startIso, axis, fileS)
    if (!Number.isFinite(position.filmVon)) return
    clips.push({
      index,
      type: a.type,
      file: a.file,
      filmVon: position.filmVon,
      filmBis: position.filmBis,
      startS: a.startS ?? 0,
      loop: a.loop ?? a.type === 'music',
      ...(fileS !== undefined ? { fileS } : {}),
      lane: 0,
      legacyAnchored: position.legacyAnchored,
      hasExplicitLength: position.hasExplicitLength,
    })
  })
  distributeLanes(clips)
  return clips
}

/**
 * Überlappende Klips in Unterzeilen legen (greedy, klassische Intervall-Färbung).
 *
 * Der Player MISCHT überlappenden Ton — je Spur ein eigenes Element. Wer sie
 * deckungsgleich übereinander zeichnete, machte den unteren unsichtbar UND
 * ungreifbar. Anders als vorher stapeln sich jetzt auch Effekte: seit sie eine
 * Breite haben, können sie einander überdecken.
 */
function distributeLanes(clips: AudioClip[]): void {
  const sorted = [...clips].sort((a, b) => a.filmVon - b.filmVon || a.index - b.index)
  const laneEnds: number[] = []
  for (const k of sorted) {
    let lane = laneEnds.findIndex((end) => end <= k.filmVon)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    // Ein Klip ohne Breite (unvermessener Effekt) belegt seine Zeile trotzdem
    // für einen Moment — sonst lägen zwei Pins am selben Ort übereinander.
    laneEnds[lane] = Math.max(k.filmBis, k.filmVon + AUDIO_MIN_S)
    k.lane = lane
  }
}

/** Zahl der Unterzeilen (mindestens 1) — für die Höhe der Bahn. */
export function audioLanes(clips: readonly AudioClip[]): number {
  return clips.reduce((max, k) => Math.max(max, k.lane + 1), 1)
}

/** Ergebnis einer Trimm-Geste: was geschrieben wird und ob das Material endet. */
export interface TrimResult {
  patch: AudioClipPatch
  /** true = die Kante steht am Material und geht nicht weiter */
  atLimit: boolean
}

/**
 * Klip als Ganzes an eine neue Filmposition setzen.
 *
 * Der Inhalt bleibt, was er ist (Einstieg und Länge unverändert) — nur der
 * Anker wandert. Genau das macht ihn zum „connected clip": Er hängt danach an
 * einer anderen Stelle der REISE und rückt mit ihr mit.
 */
export function moveAudioClip(
  axis: TimelineAxis,
  startIso: string,
  clip: AudioClip,
  newFilmVon: number,
): AudioClipPatch {
  const totalS = axis.curve?.totalS ?? 0
  const length = clip.filmBis - clip.filmVon
  // Ein Klip mit fester Länge bleibt ganz in der Tour; einer, der bis zum Ende
  // läuft, darf überall hin (er wird nur kürzer).
  const rightLimit = clip.hasExplicitLength ? Math.max(0, totalS - length) : totalS
  const fromS = Math.max(0, Math.min(newFilmVon, rightLimit))
  return {
    ...anchorClips(axis, startIso, fromS),
    ...(clip.hasExplicitLength && length > 0 ? { durationFilmS: roundTo(length, 3) } : {}),
    ...(clip.startS > 0 ? { startS: roundTo(clip.startS, 3) } : {}),
  }
}

/**
 * LINKE Kante: Anfang UND Datei-Einstieg wandern gemeinsam (FCPX).
 *
 * Der Inhalt bleibt an seinem Platz im Film, vorne fällt etwas weg — man legt
 * frei, statt zu verschieben. Anschlag ist der DATEIANFANG, und daran ändert
 * Loop nichts: Vor dem Anfang gibt es nichts zu wiederholen.
 */
export function trimLeft(
  axis: TimelineAxis,
  startIso: string,
  clip: AudioClip,
  newFilmVon: number,
): TrimResult {
  // Wie weit die Kante nach LINKS darf, sagt der Einstieg: so viel Datei liegt
  // vor dem, was gerade zu hören ist.
  const minFrom = clip.filmVon - clip.startS
  // Nach rechts darf sie bis kurz vor die andere Kante — ein Klip ohne Länge
  // wäre nicht mehr zu greifen.
  const maxFrom = clip.filmBis - AUDIO_MIN_S
  const target = Math.max(minFrom, Math.min(newFilmVon, maxFrom))
  const delta = target - clip.filmVon
  return {
    patch: {
      ...anchorClips(axis, startIso, target),
      durationFilmS: roundTo(clip.filmBis - target, 3),
      startS: roundTo(Math.max(0, clip.startS + delta), 3),
    },
    atLimit: newFilmVon < minFrom,
  }
}

/**
 * RECHTE Kante: nur das Ende.
 *
 * Ohne Loop ist der Anschlag das Material — was hinter dem Dateiende läge, ist
 * Stille, und Stille gehört zwischen die Klips, nicht in einen. MIT Loop fällt
 * genau dieser eine Anschlag weg: die Datei fängt am Ende wieder von vorn an.
 */
export function trimRight(
  axis: TimelineAxis,
  startIso: string,
  clip: AudioClip,
  newFilmBis: number,
): TrimResult {
  const minTo = clip.filmVon + AUDIO_MIN_S
  // Rest des Materials hinter dem Einstieg. Unbekannt (noch nicht gemessen) →
  // kein Anschlag: lieber ziehen lassen als eine Kante, die grundlos klemmt.
  const maxTo =
    !clip.loop && clip.fileS !== undefined
      ? clip.filmVon + Math.max(0, clip.fileS - clip.startS)
      : Infinity
  const target = Math.max(minTo, Math.min(newFilmBis, maxTo))
  return {
    // Die linke Kante bewegt sich nicht — sie wird nur mitgeschrieben, damit
    // ein Klip in alter Verankerung mit derselben Geste fest wird.
    patch: {
      ...anchorClips(axis, startIso, clip.filmVon),
      durationFilmS: roundTo(target - clip.filmVon, 3),
      ...(clip.startS > 0 ? { startS: roundTo(clip.startS, 3) } : {}),
    },
    atLimit: newFilmBis > maxTo,
  }
}

/**
 * Loop-Wert, der beim ROLLENwechsel das Verhalten erhält.
 *
 * Die Vorgabe hängt an der Rolle (Filmmusik wiederholt, Szenenton nicht). Ohne
 * diese Umrechnung kippte ein Klip ohne eigenes `loop` beim Umschalten still um
 * — aus einer durchlaufenden Atmosphäre würde ein einmaliger Knall, ohne dass
 * jemand etwas über die Wiederholung gesagt hätte. `undefined` heißt: die neue
 * Vorgabe trifft es ohnehin, das Feld gehört nicht ins Overlay.
 */
export function loopAfterRoleChange(
  clip: AudioClip,
  newRole: 'music' | 'sfx',
): boolean | undefined {
  return clip.loop === (newRole === 'music') ? undefined : clip.loop
}

/**
 * Wiederholung umlegen — und den Klip dabei ans Material zurückholen.
 *
 * Loop AUS heißt: der rechte Materialanschlag gilt wieder. Ein Klip, der unter
 * Loop über sein Dateiende hinausgewachsen war, hinge sonst mit einem stummen
 * Rest da — und Stille gehört ZWISCHEN die Klips, nie in einen. Man müsste ihn
 * von Hand zurechtziehen, um zu sehen, wo sein Material endet.
 *
 * Loop AN nimmt den Anschlag nur weg; die Länge bleibt, wie sie ist.
 */
export function setLoop(
  axis: TimelineAxis,
  startIso: string,
  clip: AudioClip,
  loop: boolean,
): AudioClipPatch {
  // Ohne gemessene Datei gibt es keinen Anschlag, an den man zurückholen
  // könnte — dann bliebe nur, die Länge grundlos festzuschreiben.
  if (loop || clip.fileS === undefined) return commitAudioClip(axis, startIso, clip)
  return trimRight(axis, startIso, { ...clip, loop: false }, clip.filmBis).patch
}

/**
 * Die Filmlage eines Klips unverändert festschreiben — die Aufwertung.
 *
 * Muster von `materializeTravelModes`/`writeWeatherFixed`, mit einem Unterschied:
 * Dort MUSS die ganze Stufenfunktion auf einmal fest werden, weil eine einzelne
 * neue Grenze die späteren Abschnitte mitrisse. Ton-Klips sind dagegen
 * unabhängige Objekte — festgeschrieben wird nur der, den man anfasst. Alle
 * anderen bleiben in ihrer alten Verankerung und rendern unverändert.
 */
export function commitAudioClip(
  axis: TimelineAxis,
  startIso: string,
  clip: AudioClip,
): AudioClipPatch {
  return {
    ...anchorClips(axis, startIso, clip.filmVon),
    ...(clip.hasExplicitLength && clip.filmBis > clip.filmVon
      ? { durationFilmS: roundTo(clip.filmBis - clip.filmVon, 3) }
      : {}),
    ...(clip.startS > 0 ? { startS: roundTo(clip.startS, 3) } : {}),
  }
}

/**
 * Wellenform-Hintergrund: Breite und Versatz des DATEI-Streifens unter dem Klip.
 *
 * Die Wellenform gehört zur DATEI, nicht zum Klip — sie liegt in Dateibreite
 * hinter ihm und ist um den Einstieg nach links verschoben. Beim Trimmen wandert
 * dadurch der AUSSCHNITT: man sieht, was man wegschneidet. Gestaucht (Wellenform
 * auf Klipbreite) sähe jeder Trim wie ein Tempowechsel aus.
 *
 * `repeats` ist die Zahl der Dateidurchläufe, die der Klip überdeckt —
 * nur bei Loop mehr als eine.
 *
 * GERECHNET WIRD IN ANTEILEN DER GANZEN ACHSE, nicht in Pixeln. Das ist keine
 * Geschmacksfrage: Zoomen baut die Bahnen NICHT neu, es schreibt nur
 * `--timeline-width` fort (`setScale`) — Klips und Marken folgen über
 * `calc(anteil * var(--timeline-width))`. Feste Pixel hier blieben auf dem
 * Maßstab stehen, der beim letzten Render galt: Die Wellenform behielt ihre
 * Größe und endete nach dem Hineinzoomen weit vor dem Klip. Als Anteil
 * ausgedrückt skaliert der Browser sie mit, ohne dass etwas neu gebaut wird.
 *
 * Bezug ist `totalFilmS`, weil genau dafür `--timeline-width` steht
 * (`timeWidthPx` = totalFilmS × pxProFilmS — und zwar in genau dem Fall, in
 * dem eine Filmsekunde überhaupt existiert; ohne Kurve fällt die Breite auf
 * die Fensterbreite zurück, und dann gibt es hier nichts zu zeichnen).
 */
export function waveformPosition(
  clip: AudioClip,
  totalFilmS: number,
): { widthFraction: number; offsetFraction: number; repeats: number } | null {
  if (!(clip.fileS && clip.fileS > 0) || !(totalFilmS > 0)) return null
  const clipS = clip.filmBis - clip.filmVon
  const repeats = clip.loop ? Math.max(1, Math.ceil((clip.startS + clipS) / clip.fileS)) : 1
  return {
    widthFraction: clip.fileS / totalFilmS,
    offsetFraction: -clip.startS / totalFilmS,
    repeats,
  }
}
