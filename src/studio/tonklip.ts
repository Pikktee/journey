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

import { isoZuOffset, offsetZuIso, type AudioEintrag } from './editmodell.js'
import { filmBeiZeit, filmZuOffset, zeitBeiFilm, type Achse } from './zeitleiste.js'

/** Kürzester Klip in Filmsekunden — darunter ist er nicht mehr zu greifen. */
export const TON_MIN_S = 0.2

/** Ein aufgelöster Ton-Klip: wo er im FILM liegt und was er aus seiner Datei zeigt. */
export interface TonKlip {
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
  dateiS?: number
  /** Unterzeile bei Überlappung (der Player MISCHT, also stapelt die Leiste) */
  lane: number
  /**
   * Trägt der Eintrag noch die alte `from`/`to`-Verankerung? Dann ist seine Lage
   * aus der Aufnahmezeit abgeleitet — beim ersten Eingriff wird sie festgeschrieben.
   */
  altVerankert: boolean
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
  laengeGesetzt: boolean
}

/** Was eine Geste ins Overlay schreibt. */
export interface TonPatch {
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
export function verankere(
  achse: Achse,
  startIso: string,
  filmVon: number,
): { anchor: string; offsetFilmS: number } {
  if (!achse.kurve) return { anchor: offsetZuIso(startIso, filmVon), offsetFilmS: 0 }
  const offsetS = zeitBeiFilm(achse.kurve, filmVon)
  // Auf ganze Sekunden runden: `offsetZuIso` schreibt einen sekundengenauen
  // Stempel, und was dabei verlorenginge, landete sonst still im Versatz.
  const ankerS = Math.round(offsetS)
  return {
    anchor: offsetZuIso(startIso, ankerS),
    offsetFilmS: rundeAuf(filmVon - filmBeiZeit(achse.kurve, ankerS), 3),
  }
}

/** Auf `stellen` Nachkommastellen runden — hält das Overlay lesbar und stabil. */
function rundeAuf(wert: number, stellen: number): number {
  const f = 10 ** stellen
  return Math.round(wert * f) / f
}

/**
 * Filmlage EINES Eintrags auflösen — neue Verankerung bevorzugt, `from`/`to`
 * als Fallback.
 *
 * Der Fallback ist keine Übergangslösung, sondern der Vertrag: Ein Overlay von
 * vor Etappe 4 bleibt lesbar und rendert unverändert, bis jemand den Klip
 * anfasst.
 */
function loeseLage(
  a: AudioEintrag,
  startIso: string,
  achse: Achse,
  dateiS: number | undefined,
): { filmVon: number; filmBis: number; altVerankert: boolean; laengeGesetzt: boolean } {
  const gesamtS = achse.kurve?.gesamtS ?? 0
  const neu = a.anchor !== undefined || a.offsetFilmS !== undefined || a.durationFilmS !== undefined
  const basisIso = a.anchor ?? a.from
  const filmVon =
    filmZuOffset(achse, isoZuOffset(startIso, basisIso)) + (neu ? (a.offsetFilmS ?? 0) : 0)

  let filmBis: number
  let laengeGesetzt = true
  if (a.durationFilmS !== undefined) {
    filmBis = filmVon + a.durationFilmS
  } else if (a.type === 'music' && a.to !== undefined) {
    filmBis = filmZuOffset(achse, isoZuOffset(startIso, a.to))
  } else if (a.type === 'music') {
    // Musik ohne Ende läuft bis zum Tour-Ende (so rendert es die Pipeline).
    filmBis = gesamtS
    laengeGesetzt = false
  } else {
    // Ein Effekt klingt, solange seine DATEI dauert — der Player spielt sie
    // aus. Die Marke ohne Länge war eine Lüge der ANZEIGE, nicht des Films;
    // sobald die Datei gemessen ist, zeigt die Leiste, was ohnehin passiert.
    filmBis = dateiS !== undefined && dateiS > 0 ? filmVon + dateiS : filmVon
    laengeGesetzt = false
  }
  return { filmVon, filmBis: Math.max(filmVon, filmBis), altVerankert: !neu, laengeGesetzt }
}

/**
 * Alle Ton-Klips auflösen und in Unterzeilen stapeln.
 *
 * `dateiDauern` sind die gemessenen Dateilängen (der Editor misst sie lazy per
 * `loadedmetadata`); fehlt eine, bleibt der Klip ohne Materialanschlag und ein
 * Effekt ohne Breite — nichts bricht, es wird nur weniger gezeigt.
 */
export function loeseTonKlips(
  audio: readonly AudioEintrag[],
  startIso: string,
  achse: Achse,
  dateiDauern?: ReadonlyMap<string, number>,
): TonKlip[] {
  const klips: TonKlip[] = []
  audio.forEach((a, index) => {
    const dateiS = dateiDauern?.get(a.file)
    const lage = loeseLage(a, startIso, achse, dateiS)
    if (!Number.isFinite(lage.filmVon)) return
    klips.push({
      index,
      type: a.type,
      file: a.file,
      filmVon: lage.filmVon,
      filmBis: lage.filmBis,
      startS: a.startS ?? 0,
      loop: a.loop ?? a.type === 'music',
      ...(dateiS !== undefined ? { dateiS } : {}),
      lane: 0,
      altVerankert: lage.altVerankert,
      laengeGesetzt: lage.laengeGesetzt,
    })
  })
  verteileLanes(klips)
  return klips
}

/**
 * Überlappende Klips in Unterzeilen legen (greedy, klassische Intervall-Färbung).
 *
 * Der Player MISCHT überlappenden Ton — je Spur ein eigenes Element. Wer sie
 * deckungsgleich übereinander zeichnete, machte den unteren unsichtbar UND
 * ungreifbar. Anders als vorher stapeln sich jetzt auch Effekte: seit sie eine
 * Breite haben, können sie einander überdecken.
 */
function verteileLanes(klips: TonKlip[]): void {
  const sortiert = [...klips].sort((a, b) => a.filmVon - b.filmVon || a.index - b.index)
  const laneEnden: number[] = []
  for (const k of sortiert) {
    let lane = laneEnden.findIndex((end) => end <= k.filmVon)
    if (lane === -1) {
      lane = laneEnden.length
      laneEnden.push(0)
    }
    // Ein Klip ohne Breite (unvermessener Effekt) belegt seine Zeile trotzdem
    // für einen Moment — sonst lägen zwei Pins am selben Ort übereinander.
    laneEnden[lane] = Math.max(k.filmBis, k.filmVon + TON_MIN_S)
    k.lane = lane
  }
}

/** Zahl der Unterzeilen (mindestens 1) — für die Höhe der Bahn. */
export function tonLanes(klips: readonly TonKlip[]): number {
  return klips.reduce((max, k) => Math.max(max, k.lane + 1), 1)
}

/** Ergebnis einer Trimm-Geste: was geschrieben wird und ob das Material endet. */
export interface TrimErgebnis {
  patch: TonPatch
  /** true = die Kante steht am Material und geht nicht weiter */
  amAnschlag: boolean
}

/**
 * Klip als Ganzes an eine neue Filmposition setzen.
 *
 * Der Inhalt bleibt, was er ist (Einstieg und Länge unverändert) — nur der
 * Anker wandert. Genau das macht ihn zum „connected clip": Er hängt danach an
 * einer anderen Stelle der REISE und rückt mit ihr mit.
 */
export function verschiebeTon(
  achse: Achse,
  startIso: string,
  klip: TonKlip,
  neuFilmVon: number,
): TonPatch {
  const gesamtS = achse.kurve?.gesamtS ?? 0
  const laenge = klip.filmBis - klip.filmVon
  // Ein Klip mit fester Länge bleibt ganz in der Tour; einer, der bis zum Ende
  // läuft, darf überall hin (er wird nur kürzer).
  const rechteGrenze = klip.laengeGesetzt ? Math.max(0, gesamtS - laenge) : gesamtS
  const fromS = Math.max(0, Math.min(neuFilmVon, rechteGrenze))
  return {
    ...verankere(achse, startIso, fromS),
    ...(klip.laengeGesetzt && laenge > 0 ? { durationFilmS: rundeAuf(laenge, 3) } : {}),
    ...(klip.startS > 0 ? { startS: rundeAuf(klip.startS, 3) } : {}),
  }
}

/**
 * LINKE Kante: Anfang UND Datei-Einstieg wandern gemeinsam (FCPX).
 *
 * Der Inhalt bleibt an seinem Platz im Film, vorne fällt etwas weg — man legt
 * frei, statt zu verschieben. Anschlag ist der DATEIANFANG, und daran ändert
 * Loop nichts: Vor dem Anfang gibt es nichts zu wiederholen.
 */
export function trimmeLinks(
  achse: Achse,
  startIso: string,
  klip: TonKlip,
  neuFilmVon: number,
): TrimErgebnis {
  // Wie weit die Kante nach LINKS darf, sagt der Einstieg: so viel Datei liegt
  // vor dem, was gerade zu hören ist.
  const minVon = klip.filmVon - klip.startS
  // Nach rechts darf sie bis kurz vor die andere Kante — ein Klip ohne Länge
  // wäre nicht mehr zu greifen.
  const maxVon = klip.filmBis - TON_MIN_S
  const ziel = Math.max(minVon, Math.min(neuFilmVon, maxVon))
  const delta = ziel - klip.filmVon
  return {
    patch: {
      ...verankere(achse, startIso, ziel),
      durationFilmS: rundeAuf(klip.filmBis - ziel, 3),
      startS: rundeAuf(Math.max(0, klip.startS + delta), 3),
    },
    amAnschlag: neuFilmVon < minVon,
  }
}

/**
 * RECHTE Kante: nur das Ende.
 *
 * Ohne Loop ist der Anschlag das Material — was hinter dem Dateiende läge, ist
 * Stille, und Stille gehört zwischen die Klips, nicht in einen. MIT Loop fällt
 * genau dieser eine Anschlag weg: die Datei fängt am Ende wieder von vorn an.
 */
export function trimmeRechts(
  achse: Achse,
  startIso: string,
  klip: TonKlip,
  neuFilmBis: number,
): TrimErgebnis {
  const minBis = klip.filmVon + TON_MIN_S
  // Rest des Materials hinter dem Einstieg. Unbekannt (noch nicht gemessen) →
  // kein Anschlag: lieber ziehen lassen als eine Kante, die grundlos klemmt.
  const maxBis =
    !klip.loop && klip.dateiS !== undefined
      ? klip.filmVon + Math.max(0, klip.dateiS - klip.startS)
      : Infinity
  const ziel = Math.max(minBis, Math.min(neuFilmBis, maxBis))
  return {
    // Die linke Kante bewegt sich nicht — sie wird nur mitgeschrieben, damit
    // ein Klip in alter Verankerung mit derselben Geste fest wird.
    patch: {
      ...verankere(achse, startIso, klip.filmVon),
      durationFilmS: rundeAuf(ziel - klip.filmVon, 3),
      ...(klip.startS > 0 ? { startS: rundeAuf(klip.startS, 3) } : {}),
    },
    amAnschlag: neuFilmBis > maxBis,
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
export function loopNachRollenwechsel(klip: TonKlip, neu: 'music' | 'sfx'): boolean | undefined {
  return klip.loop === (neu === 'music') ? undefined : klip.loop
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
export function setzeLoop(achse: Achse, startIso: string, klip: TonKlip, loop: boolean): TonPatch {
  // Ohne gemessene Datei gibt es keinen Anschlag, an den man zurückholen
  // könnte — dann bliebe nur, die Länge grundlos festzuschreiben.
  if (loop || klip.dateiS === undefined) return schreibeTonFest(achse, startIso, klip)
  return trimmeRechts(achse, startIso, { ...klip, loop: false }, klip.filmBis).patch
}

/**
 * Die Filmlage eines Klips unverändert festschreiben — die Aufwertung.
 *
 * Muster von `materialisiereModi`/`schreibeWetterFest`, mit einem Unterschied:
 * Dort MUSS die ganze Stufenfunktion auf einmal fest werden, weil eine einzelne
 * neue Grenze die späteren Abschnitte mitrisse. Ton-Klips sind dagegen
 * unabhängige Objekte — festgeschrieben wird nur der, den man anfasst. Alle
 * anderen bleiben in ihrer alten Verankerung und rendern unverändert.
 */
export function schreibeTonFest(achse: Achse, startIso: string, klip: TonKlip): TonPatch {
  return {
    ...verankere(achse, startIso, klip.filmVon),
    ...(klip.laengeGesetzt && klip.filmBis > klip.filmVon
      ? { durationFilmS: rundeAuf(klip.filmBis - klip.filmVon, 3) }
      : {}),
    ...(klip.startS > 0 ? { startS: rundeAuf(klip.startS, 3) } : {}),
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
 * `wiederholungen` ist die Zahl der Dateidurchläufe, die der Klip überdeckt —
 * nur bei Loop mehr als eine.
 *
 * GERECHNET WIRD IN ANTEILEN DER GANZEN ACHSE, nicht in Pixeln. Das ist keine
 * Geschmacksfrage: Zoomen baut die Bahnen NICHT neu, es schreibt nur
 * `--zeit-breite` fort (`setzeMassstab`) — Klips und Marken folgen über
 * `calc(anteil * var(--zeit-breite))`. Feste Pixel hier blieben auf dem
 * Maßstab stehen, der beim letzten Render galt: Die Wellenform behielt ihre
 * Größe und endete nach dem Hineinzoomen weit vor dem Klip. Als Anteil
 * ausgedrückt skaliert der Browser sie mit, ohne dass etwas neu gebaut wird.
 *
 * Bezug ist `gesamtFilmS`, weil genau dafür `--zeit-breite` steht
 * (`zeitBreitePx` = gesamtFilmS × pxProFilmS — und zwar in genau dem Fall, in
 * dem eine Filmsekunde überhaupt existiert; ohne Kurve fällt die Breite auf
 * die Fensterbreite zurück, und dann gibt es hier nichts zu zeichnen).
 */
export function wellenLage(
  klip: TonKlip,
  gesamtFilmS: number,
): { breiteAnteil: number; versatzAnteil: number; wiederholungen: number } | null {
  if (!(klip.dateiS && klip.dateiS > 0) || !(gesamtFilmS > 0)) return null
  const klipS = klip.filmBis - klip.filmVon
  const wiederholungen = klip.loop
    ? Math.max(1, Math.ceil((klip.startS + klipS) / klip.dateiS))
    : 1
  return {
    breiteAnteil: klip.dateiS / gesamtFilmS,
    versatzAnteil: -klip.startS / gesamtFilmS,
    wiederholungen,
  }
}
