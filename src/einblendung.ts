// Die Foto-Karte: Zahlen und Regeln, die Player UND Editor gemeinsam gehören.
//
// Beide zeigen dieselbe Einblendung — der Player als Bühne, der Editor als
// Vorschau auf der Karte. Was BEIDE wissen müssen, steht hier; wie sie es
// darstellen, bleibt getrennt (der Player läuft linear in Echtzeit, im Editor
// wird gescrubbt — ein gemeinsames DOM-Bauteil müsste beide Zeitmodelle
// tragen, s. docs/concepts/konzept_gleichlauf_player_editor.md §6A/§9).
//
// Warum eine eigene Datei und nicht `tour.ts`: Die Engine importiert MapLibre.
// Das Studio lädt MapLibre erst mit dem Editor nach; ein Import aus `tour.ts`
// zöge es ins Basis-Bundle. Und `ui.ts` importiert `tour.ts` nicht (nur
// umgekehrt) — eine exportierte Konstante dort wäre ein Import-Zyklus.
//
// Diese Datei ist DOM-frei und ohne Importe: Sie muss vom Player, vom Studio
// und aus Tests gleichermaßen benutzbar sein.

/**
 * Sekunden, die eine Foto-Karte sichtbar steht (Vorgabe).
 *
 * `display.holdS` aus dem Studio übersteuert sie pro Medium; für ein VIDEO ist
 * sie wirkungslos, dort zählt die Dateilänge (src/tour.ts, `advancePhoto`).
 *
 * Die Zahl hat zwei erzwungene Spiegel, die sie nicht importieren können —
 * `HALT_ENGINE_S` in server/src/pipeline/filmtempo.ts (eigener `rootDir`) und
 * in src/studio/zeitleiste.ts (kein `tour.ts`-Import, s. o.). Beide werden
 * gegen DIESE Datei bewacht.
 */
export const HOLD_HIDE = 5.2

/** Sekunden Ausblend-Animation nach der Anzeige, bevor es weitergeht. */
export const HOLD_AUSBLEND = 0.8

/**
 * Standzeit EINER Aufnahme im Halt (ohne Ausblendung) — die Filmzeit, die sie
 * kostet.
 *
 * Für ein Video ist das seine Länge und sonst nichts: Der Player läuft bis zum
 * Dateiende, `display.holdS` ist dort wirkungslos. Kennt niemand die Länge
 * (unverarbeiteter Altbestand), bleibt es bei der Foto-Annahme — und zwar in
 * Player UND Editor gleich (Konzept, Falle 4).
 *
 * Der Editor legt für seinen Video-SCHNITT noch eine Klemme darum
 * (`aufnahmeHaltS` in src/studio/zeitleiste.ts); die Regel darunter ist diese.
 */
export function standzeitS(m: {
  type?: 'photo' | 'video'
  /** Länge des Videos in Sekunden */
  dauerS?: number
  display?: { holdS?: number }
}): number {
  if (m.type === 'video' && m.dauerS !== undefined && m.dauerS > 0) return m.dauerS
  return m.display?.holdS ?? HOLD_HIDE
}

/**
 * Filmzeit, die eine Aufnahme im Halt insgesamt einnimmt — Standzeit UND
 * Ausblendung.
 *
 * Das ist die Länge ihres KLIPS: Der Editor zeichnet ihn so auf die Zeitleiste,
 * die Achse reiht die Aufnahmen eines Halts danach aneinander, und beide Bühnen
 * lassen ihre Karte genau so lange liegen. Bis E15 rechnete der Player daneben
 * mit `holdS + 1.8` für den Ken-Burns-Zug — die eine Sekunde aus §6C des
 * Gleichlauf-Konzepts.
 */
export function klipDauerS(standS: number): number {
  return standS + HOLD_AUSBLEND
}

/**
 * Füllstand des Anzeige-Balkens (0..1) an der Stelle `imS` eines Klips.
 *
 * Er wird bei jedem Kopfschritt GESETZT und nicht über eine Dauer animiert:
 * Eine Animation kennt nur „seit dem Start" und stünde beim Scrubben und nach
 * jeder Pause neben der Wahrheit.
 */
export function balkenAnteil(imS: number, dauerS: number): number {
  if (!(dauerS > 0)) return 0
  return Math.max(0, Math.min(1, imS / dauerS))
}

/** Die vier Zeiten der pausierten Karten-Animationen (Sekunden). */
export interface KartenZeiten {
  /** Negatives Delay der Auftritts-Animationen — der Stand IM Klip. */
  zeitS: number
  /** Dauer des Ken-Burns-Zugs: die volle Klip-Länge. */
  kbDauerS: number
  /** Delay des Abgangs; positiv, solange er noch aussteht. */
  ausZeitS: number
  /** Dauer des Abgangs. */
  ausDauerS: number
}

/**
 * Aus dem Stand im Klip die Delays der dauerhaft PAUSIERTEN Animationen.
 *
 * Das ist die Technik, mit der ein Standbild aus einer Animation gezogen wird:
 * Die Animation läuft nie, ihr Fortschritt kommt aus einem negativen Delay.
 * Deshalb erscheint die Karte auch rückwärts und beim Scrubben mit dem Bild,
 * das an DIESER Filmsekunde gilt — eine Wanduhr-Transition kann das nicht, sie
 * startet beim Klassenwechsel und läuft danach für sich.
 *
 * Der Abgang liegt in den letzten `HOLD_AUSBLEND` des Klips, also genau in der
 * Spanne, um die der Klip länger ist als die Standzeit.
 */
export function kartenZeiten(imS: number, dauerS: number): KartenZeiten {
  const klipS = Math.max(0.1, dauerS)
  const ausDauerS = Math.min(HOLD_AUSBLEND, klipS)
  return { zeitS: -imS, kbDauerS: klipS, ausZeitS: klipS - ausDauerS - imS, ausDauerS }
}

/**
 * Ein Video steht nicht auf dem letzten Frame, sondern kurz davor — sonst
 * klemmt der Browser `currentTime` still.
 */
const VIDEO_ENDE_S = 0.04

/**
 * Die Stelle IM Video, die zum Stand `imS` des Klips gehört — geklemmt an die
 * Schnittkanten.
 *
 * Der Klip ist um die Ausblendung länger als das Material (und bei einem
 * rechten Schnitt endet es noch früher). Ohne Klemme läuft `vonS + imS` über
 * das Ende hinaus: Der Browser klemmt `currentTime` still, die Abweichung
 * wächst mit jedem Frame über die Nachzieh-Schwelle — und die Wiedergabe seekte
 * in JEDEM Frame ans Ende, während `ended`/`play()` sich abwechselten. Das war
 * das Zittern am Klip-Ende. `ausgelaufen` sagt, dass ab hier nur noch das
 * letzte Bild steht, also weder gespielt noch nachgezogen werden muss.
 *
 * Der Player liefert geschnittene Dateien aus (`vonS` = 0), der Editor den
 * ungeschnittenen Master mit beiden Kanten — die Rechnung ist dieselbe.
 */
export function videoStandS(
  vonS: number,
  endeS: number,
  imS: number,
): { zielS: number; ausgelaufen: boolean } {
  const letzterFrameS = Math.max(vonS, endeS - VIDEO_ENDE_S)
  const roh = vonS + Math.max(0, imS)
  return { zielS: Math.min(roh, letzterFrameS), ausgelaufen: roh >= letzterFrameS }
}

/**
 * Grenzen des Seitenverhältnisses der Foto-Karte (Breite ÷ Höhe).
 *
 * Extreme Panoramen und Hochformate würden die Bühne sonst sprengen: Ein
 * 3:1-Panorama wäre breiter als das Fenster, ein 9:19-Handyfoto höher.
 */
export const AR_MIN = 0.62
export const AR_MAX = 1.85

/**
 * Seitenverhältnis eines Mediums für die Karte — gemessen und geklemmt.
 *
 * Der entscheidende Teil ist, dass überhaupt GEMESSEN wird: Ein fest gesetztes
 * 3:2 mit `object-fit: cover` schneidet ein Hochformat auf den Mittelstreifen,
 * und genau den will die Karte zeigen. Mit passendem Rahmen füllt `cover` das
 * Bild, ohne etwas wegzunehmen.
 *
 * `null` bei unbekannten Maßen (Bild noch nicht geladen, Video ohne Metadaten)
 * — der Aufrufer lässt dann das bisherige Verhältnis stehen, statt auf einen
 * Vorgabewert zurückzuspringen: Ein Zwischen-Reset ließe den Rahmen zucken.
 */
export function klemmeSeitenverhaeltnis(breite: number, hoehe: number): number | null {
  if (!(breite > 0) || !(hoehe > 0)) return null
  return Math.max(AR_MIN, Math.min(AR_MAX, breite / hoehe))
}

/**
 * Länge des AUSSCHNITTS eines Videos — die Strecke, über die geblendet wird.
 *
 * Die Ton-Hülle (`videoTonHuelle`) legt Ein- und Ausblende an die Kanten dieses
 * Ausschnitts, nicht an die der Datei. Beide Bühnen rechnen ihn deshalb aus,
 * und sie rechneten ihn VERSCHIEDEN: Der Player nahm `endeS` roh, der Editor
 * `endeS - vonS`. Beides war an seiner Stelle richtig — der Player liefert die
 * geschnittene Fassung aus (`vonS` = 0), der Editor den ungeschnittenen Master
 * mit beiden Kanten —, aber es waren zwei Formeln für eine Regel: Wer im Player
 * je einen linken Schnitt zuließe, hätte dort eine zu lange Ausblende und
 * niemanden, der es meldet.
 *
 * Ohne rechten Schnitt (`endeS` unendlich oder fehlend) gilt das Dateiende.
 * Dieselbe Kantenlage wie `videoStandS` — die beiden gehören zusammen.
 */
export function ausschnittDauerS(dateiDauerS: number, vonS = 0, endeS?: number): number {
  const ende = endeS !== undefined && Number.isFinite(endeS) ? endeS : dateiDauerS
  return Math.max(0, (Number.isFinite(ende) ? ende : 0) - Math.max(0, vonS))
}

/**
 * Die OPTIK der Foto-Karte — die Zahlen, die auf allen Bühnen dieselben sein
 * sollen.
 *
 * Bis hierher standen sie dreimal da: im Player (`src/style.css`), im Editor
 * (`studio.html`) und im Video-Export (`src/exportfilm.ts`, Canvas). Die Zeiten
 * waren geteilt und blieben deckungsgleich; die WERTE waren es nicht und liefen
 * an acht Stellen auseinander — Ken-Burns-Ende, Entwickeln-Ende, Ruhewinkel,
 * Blitz, Schleier und zwei Rückfalldauern. Keine dieser Abweichungen war eine
 * Entscheidung, aber jede sah nach einer aus. Genau das ist der Grund für diese
 * Tabelle: Sie macht Absicht von Versehen unterscheidbar
 * (docs/concepts/konzept_kartenleinwand.md §3.7).
 *
 * Die Regel dazu: **Was auf zwei Bühnen gleich aussehen soll, kommt aus einer
 * Zahl hier; was verschieden sein darf, steht als benannte Bühnen-Variante
 * daneben (`KARTE_BUEHNE`) — mit ihrem Grund.** Ein Wert, der auf zwei Bühnen
 * zufällig anders ist, gilt danach als Fehler und nicht als Geschmack.
 *
 * Bewacht von test/einblendung-css.test.ts, das CSS und HTML gegen diese
 * Tabelle liest. Nach Etappe 2 des Konzepts steht die Player-Optik nicht mehr
 * in `style.css`, sondern im Maler — die Tabelle überlebt das, der Lesecode des
 * Wächters für diese eine Seite nicht.
 */
export const KARTE = {
  /**
   * Ken Burns: Anfangs- und Endgröße des Bildes im Rahmen. Es zoomt HERAUS.
   *
   * Die Richtung ist die Bildsprache der Foto-Stopps und keine Nuance: Der
   * Export zoomt heute in die Gegenrichtung (§2.1, wird in Etappe 2 behoben).
   * Das Ende stand im Player auf 1.01 und im Editor auf 1.02; gemeint ist
   * 1.02, denn der Reduced-Motion-Block BEIDER Bühnen legt die stehende Karte
   * seit jeher auf genau diese Größe. Wer den Player als Vorbild nimmt, weil er
   * die Hauptbühne ist, zementiert den Ausreißer.
   */
  kenBurnsVon: 1.12,
  kenBurnsBis: 1.02,

  /**
   * Größe der stehenden Karte: wenn Ken Burns für das Medium abgeschaltet ist
   * (`display.kenBurns === false`) und bei `prefers-reduced-motion`.
   *
   * Das ist kein eigener Wert, sondern das ENDE des Zugs — die Ruhe, die der
   * Zug ansteuert. Vorher standen dafür drei Zahlen im Repo: `transform: none`
   * (= 1.0) im Player, `scale(1.04)` im Editor, und in beiden
   * Reduced-Motion-Blöcken `scale(1.02)`. Die dritte war die richtige.
   */
  ruheSkala: 1.02,

  /**
   * Rückfalldauer des Ken-Burns-Zugs, falls `--kb-dauer`/`--fe-kb-dauer` fehlt.
   *
   * Abgeleitet, nicht gewählt: `klipDauerS(HOLD_HIDE)` = 5,2 + 0,8. Der Player
   * stand auf 7 s, der Editor auf 6 s — und weil ein Rückfallwert nur greift,
   * wenn die Custom Property fehlt, sieht man den Unterschied dort nie als
   * Bruch, sondern als leicht anderen Film. Das ist die heimtückischste Sorte
   * Abweichung, die dieses Konzept kennt.
   */
  kbDauerRueckfallS: HOLD_HIDE + HOLD_AUSBLEND,

  /**
   * „Entwickeln": die Filterblende, mit der das Foto wie ein Sofortbild kommt.
   *
   * Das Ende ist nicht neutral, sondern behält einen minimalen Druck-Look
   * (Kontrast +2 %, Sättigung +5 %) — im Player ist es zugleich der
   * Grundzustand des Bildes. Der Editor endete auf `filter: none` und zeigte
   * dasselbe Foto dadurch dauerhaft eine Spur flacher.
   */
  entwickelnDauerS: 1.6,
  entwickelnVon: { brightness: 1.45, contrast: 0.82, saturate: 0.55 },
  entwickelnBis: { brightness: 1, contrast: 1.02, saturate: 1.05 },

  /**
   * Auftritt: Blende und Flug laufen gleichzeitig mit verschiedenen Kurven,
   * die Blende setzt `blendeVersatzS` später ein.
   */
  blendeDauerS: 0.5,
  blendeVersatzS: 0.04,
  flugDauerS: 0.95,
  flugKurve: 'cubic-bezier(0.19, 1.16, 0.32, 1)',

  /**
   * Geometrie des Auftritts — ohne die Flugweite, die eine Bühnen-Variante ist
   * (s. `KARTE_BUEHNE`).
   *
   * Die Winkel waren es NICHT: 1.4° gegen 1.6° Startdrehung, 10° gegen 9°
   * Kippung, −0.4° gegen −0.5° Ruhelage. Drei Paare, bei denen sich nicht sagen
   * ließ, welche Zahl gemeint war.
   */
  flugSkala: 0.9,
  flugDrehungGrad: 1.4,
  flugKippungGrad: 10,
  ruheDrehungGrad: -0.4,

  /** Abgang: die Karte hebt ab, schrumpft leicht und dreht sich weg. */
  abgangHubPx: -22,
  abgangSkala: 0.96,
  abgangDrehungGrad: -1.4,

  /**
   * Kamerablitz beim Erreichen des Halts.
   *
   * Er hängt am Kopf und nicht an einem Timer — sonst feuerte er bei jedem
   * Überfahren neu. Player und Editor blitzten 750 gegen 700 ms, mit Spitze bei
   * 10 % gegen 12 % und um 0,05 verschiedenen Deckkräften im Verlauf.
   */
  blitzDauerS: 0.75,
  /** Anteil der Dauer, an dem die Spitze liegt. */
  blitzSpitzeBei: 0.1,
  blitzSpitze: 0.95,
  /** Mitte des Radialverlaufs in Anteilen der Fläche. */
  blitzMitteX: 0.5,
  blitzMitteY: 0.45,
  /** Deckkraft des Verlaufs innen und am mittleren Halt. */
  blitzInnen: 0.95,
  blitzAussen: 0.55,

  /**
   * Schleier hinter der Karte.
   *
   * Er bleibt auf beiden Bildschirm-Bühnen eine DOM-Schicht mit
   * `backdrop-filter` — auf einer Leinwand hat der kein Gegenstück, und der
   * naheliegende Ausweg über einen eingefrorenen Puffer trägt nicht (Konzept
   * §4). Die Farbe ist bewusst hell: Das frühere 0.5-Schwarz lief über dunklen
   * Szenen mit Vignette und Cine-Balken auf einen schwarzen Bildrand hinaus;
   * die Trennung übernimmt der Blur. Der Editor stand auf 0.34 mit blur(10px)
   * und ohne Entsättigung, also genau in die zurückgenommene Richtung.
   */
  schleierFarbe: 'rgba(6, 10, 16, 0.3)',
  schleierBlurPx: 14,
  schleierSaturate: 0.85,
  schleierBrightness: 0.96,

  /** Eckenradius des Bildrahmens innerhalb der Karte. */
  rahmenRadiusPx: 5,
} as const

/**
 * Was zwischen den Bühnen verschieden sein DARF — benannt und mit Grund.
 *
 * Der Sinn dieser zweiten Tabelle liegt nicht in den Werten, sondern darin,
 * dass es sie gibt: Ohne sie wäre die nächste Vereinheitlichung eine
 * Verschlechterung, weil niemand mehr sähe, dass hier eine Entscheidung steht.
 */
export const KARTE_BUEHNE = {
  /**
   * Flugweite des Auftritts.
   *
   * Der Player zeigt die Karte fast bildschirmfüllend; ein Anflug über 70 px
   * ist dort ein kurzer Weg. Die Editor-Karte liegt klein auf der Karten-Bühne
   * wie auf einem Leuchttisch — dieselben 70 px wären dort mehr als eine halbe
   * Kartenhöhe.
   */
  flugHubPx: { player: 70, editor: 48 },
} as const

/**
 * Bekannte Abweichungen des Video-Exports von der Tabelle — Etappe 1 behebt
 * sie NICHT, sie benennt sie.
 *
 * Der Export ist in dieser Etappe der dritte Vergleichspunkt und nichts sonst:
 * Er malt die Karte von Hand auf seine Komposition, ohne DOM und ohne CSS, und
 * dieser Nachbau verschwindet mit Etappe 2 vollständig. Ihn jetzt Zahl für Zahl
 * nachzuziehen hieße, Code zu pflegen, der gelöscht wird.
 *
 * Wozu die Liste dann? Damit sie SCHRUMPFT. Der Wächter prüft, dass jede hier
 * genannte Abweichung im Export tatsächlich noch so dasteht — wer eine behebt
 * oder den Nachbau entfernt, muss die Zeile hier streichen. Ohne das wäre die
 * Liste nach Etappe 2 eine Beschreibung von Code, den es nicht mehr gibt.
 *
 * `spur` ist die Stelle in src/exportfilm.ts, an der die Abweichung steht.
 */
export const KARTE_EXPORT_ABWEICHUNGEN: readonly {
  was: string
  spur: string
  soll: string
}[] = [
  {
    was: 'Ken Burns läuft in die GEGENRICHTUNG — das Bild zoomt hinein statt heraus, linear über feste 6 s statt über die Klip-Länge.',
    spur: '1 + 0.06 * Math.min(1, imS / 6)',
    soll: 'kenBurnsVon → kenBurnsBis über die Klip-Länge',
  },
  {
    was: 'Das „Entwickeln" fehlt ganz.',
    spur: 'ctx.drawImage(quelle,',
    soll: 'entwickelnVon → entwickelnBis über entwickelnDauerS',
  },
  {
    was: 'Der Auftritt ist eine lineare Deckkraft ohne Flug — keine Geometrie, keine Kurve.',
    spur: 'if (imS < 0.5) a = Math.max(0, imS / 0.5)',
    soll: 'Blende UND Flug, mit flugKurve',
  },
  {
    was: 'Kamerablitz, Standzeit-Balken und die Kennzahlen-Pillen fehlen.',
    spur: 'const textH = titel || unter ?',
    soll: 'Blitz, Balken (balkenAnteil) und Pillen wie auf der Bühne',
  },
  {
    was: 'Der Schleier ist eine flache Füllung — das ist gewollt (Konzept §4, der Export komponiert selbst), aber die FARBE weicht zusätzlich ab.',
    spur: "ctx.fillStyle = 'rgba(6, 10, 16, 0.28)'",
    soll: 'schleierFarbe (flach: benannte Variante, 0.28 statt 0.3: nicht)',
  },
  {
    was: 'Das Seitenverhältnis ist roh statt geklemmt.',
    spur: '(quelle.naturalWidth || 3) / (quelle.naturalHeight || 2)',
    soll: 'klemmeSeitenverhaeltnis',
  },
  {
    was: 'Texte werden aus dem DOM zurückgelesen, das der Player gerade gefüllt hat.',
    spur: "layer.querySelector('.photo-title')?.textContent",
    soll: 'dieselben Daten wie der Player, nicht dessen Ergebnis',
  },
]

/**
 * Reihenfolge der Aufnahmen INNERHALB eines Halts.
 *
 * `reihe` ist eine Entscheidung des Autors und schlägt deshalb alles andere;
 * ohne sie gilt die natürliche Ordnung der jeweiligen Bühne. Und die ist
 * verschieden, notwendigerweise: Der Player kennt seine Fotos über die
 * Streckenmeter (`s`), das Studio über die Aufnahmezeit (`takenAt`) — dort ist
 * eine Aufnahme ohne verlässlichen Ort trotzdem einzuordnen. Deshalb ist der
 * Zweitschlüssel ein Argument und keine feste Regel: Was geteilt wird, ist der
 * VORRANG, nicht die Messung.
 *
 * Vorher stand die Rechnung zweimal da — in `gruppiereStopps` ([geo.ts](geo.ts))
 * und in `sortiereItems` ([studio/stopps.ts](studio/stopps.ts)) —, gekoppelt
 * durch einen Wächter, der den Quelltext des Players nach
 * `a.reihe ?? Number.POSITIVE_INFINITY` absuchte. Ein Regex auf einen Rumpf
 * hält keine Regel zusammen: Er hätte jede Umformulierung als Bruch gemeldet
 * und jede echte Änderung der Studio-Seite durchgelassen.
 *
 * Ohne `reihe` zählt die Aufnahme als „ganz hinten" (nicht als 0) — sonst
 * schöbe sich ein unbenanntes Bild vor eines, das der Autor ausdrücklich an
 * den Anfang gestellt hat. Stabil bei Gleichstand, und die Eingabe bleibt
 * unangetastet.
 */
export function reihenfolgeImHalt<T extends { reihe?: number }>(
  items: readonly T[],
  natuerlich: (x: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const ra = a.reihe ?? Number.POSITIVE_INFINITY
    const rb = b.reihe ?? Number.POSITIVE_INFINITY
    return ra === rb ? natuerlich(a) - natuerlich(b) : ra - rb
  })
}
