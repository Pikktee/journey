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
 * `STOP_ENGINE_S` in server/src/pipeline/filmtempo.ts (eigener `rootDir`) und
 * in src/studio/timeline.ts (kein `tour.ts`-Import, s. o.). Beide werden
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
 * (`mediumHoldS` in src/studio/timeline.ts); die Regel darunter ist diese.
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
 * Bereitschaftsstufen eines `<video>` (`HTMLMediaElement.readyState`) — als
 * Namen, weil die Nachführung unten drei davon unterscheidet und `>= 2` nichts
 * darüber sagt, was an der Stelle entschieden wird.
 */
/** Maße und Dauer stehen, ein Frame noch nicht (`HAVE_METADATA`). */
export const VIDEO_HAT_MASSE = 1
/** Für die aktuelle Stelle liegt ein Frame vor (`HAVE_CURRENT_DATA`). */
export const VIDEO_HAT_FRAME = 2
/** Es ist genug gepuffert, um weiterzulaufen (`HAVE_FUTURE_DATA`). */
export const VIDEO_LAEUFT_WEITER = 3

/** Abweichung, ab der im LAUF nachgesucht wird. */
export const VIDEO_DRIFT_LAUF_S = 0.5
/** Abweichung, ab der im STAND nachgesucht wird (Scrubben, Pause, Rückwärts). */
export const VIDEO_DRIFT_STAND_S = 0.04
/** Wanduhr-Ruhe zwischen zwei Suchläufen im Lauf. */
export const VIDEO_SUCH_PAUSE_S = 0.5

/** Was ein Video-Element über sich sagt — alles, was die Nachführung braucht. */
export interface VideoLage {
  /** Die Stelle, an der der FILM steht (aus `videoStandS`). */
  zielS: number
  /** Die Stelle, an der das VIDEO steht (`currentTime`). */
  istS: number
  /** Filmzeit läuft vorwärts in Tempo 1 und der Ausschnitt ist nicht ausgelaufen. */
  laeuft: boolean
  paused: boolean
  seeking: boolean
  readyState: number
  /** Wanduhr-Sekunden seit dem letzten BEGONNENEN Suchlauf. */
  seitSuchlaufS: number
  /**
   * Der Video-Export braucht EXAKT den Frame dieser Filmsekunde.
   *
   * Dort vergeht je Filmbild 0,3 bis 2 Sekunden Wanduhr — ein Video, das
   * nebenher liefe, wäre nach jedem Bild woanders, und die Toleranz des Laufs
   * landete als falsches Einzelbild in der Datei. Also läuft es gar nicht: Es
   * steht und wird auf die Stelle gesucht, wie beim Scrubben.
   */
  bildgenau?: boolean
}

/** Die drei Handgriffe am Video-Element, die aus einer Lage folgen. */
export interface VideoNachfuehrung {
  suchen: boolean
  starten: boolean
  anhalten: boolean
}

/**
 * Was in dieser Filmsekunde am Video-Element zu tun ist.
 *
 * Die Filmzeit führt, das Video folgt — aber es folgt nicht in jedem Frame:
 * Ein Suchlauf kostet auf dem Telefon ein paar Hundert Millisekunden, in denen
 * der Film weiterläuft. Genau daran lief die alte Fassung (Bedingung direkt am
 * Element, Schwelle 0,34 s, keine Rückfrage) auf Mobilgeräten in einen
 * SUCHSTURM: Beim Öffnen eines Video-Halts steht `currentTime` noch auf 0,
 * während das Laden über Mobilfunk eine Sekunde und mehr braucht — nach 0,34 s
 * Filmzeit wurde gesucht, der begonnene Suchlauf im nächsten Frame durch den
 * nächsten ersetzt, und keiner kam je an. Sichtbar war das als Ruckeln mit
 * schwarzen Bildern dazwischen: Ein suchendes Video liefert keinen Frame, und
 * ohne Frame malte die Karte ihr schwarzes Bildfeld.
 *
 * Vier Regeln, und jede einzelne hält den Sturm auf:
 *
 * - **Ein laufender Suchlauf wird nie überholt** (`seeking`). Das Ziel wandert
 *   ja weiter, also wäre jeder neue Suchlauf der Abbruch des vorigen.
 * - **Im Lauf wird nur gesucht, wenn das Video überhaupt weiterlaufen könnte**
 *   (`VIDEO_LAEUFT_WEITER`). Puffert es gerade, führt ein Sprung nach vorn in
 *   ungepufferte Daten — das verlängert das Puffern, statt es zu beenden.
 * - **Nach einem Suchlauf ist eine Wanduhr-Ruhe** (`VIDEO_SUCH_PAUSE_S`).
 *   Sonst verlangt der nächste Frame sofort den nächsten Sprung, weil der
 *   letzte selbst Zeit gekostet hat.
 * - **Im Lauf ist die Schwelle groß, im Stand klein.** Im Lauf trägt das Video
 *   seine eigene Uhr und ein halbe Sekunde Versatz sieht niemand; im Stand
 *   (Scrubben) IST die gesuchte Stelle das, was man sehen will — dort gilt nur
 *   die erste Regel, damit der Finger führt und nicht der Suchlauf.
 */
export function videoNachfuehrung(lage: VideoLage): VideoNachfuehrung {
  // „Läuft" heißt: Das Video trägt seine eigene Uhr. Im Export tut es das nicht,
  // dort wird jedes Bild gesucht.
  const eigeneUhr = lage.laeuft && lage.bildgenau !== true
  const drift = Math.abs(lage.istS - lage.zielS)
  const schwelle = eigeneUhr ? VIDEO_DRIFT_LAUF_S : VIDEO_DRIFT_STAND_S
  const darfSuchen =
    !lage.seeking &&
    (eigeneUhr
      ? lage.readyState >= VIDEO_LAEUFT_WEITER && lage.seitSuchlaufS >= VIDEO_SUCH_PAUSE_S
      : lage.readyState >= VIDEO_HAT_MASSE)
  return {
    suchen: darfSuchen && drift > schwelle,
    starten: eigeneUhr && lage.paused,
    anhalten: !eigeneUhr && !lage.paused,
  }
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
 * Kamerablitz, Schleier und zwei Rückfalldauern. Keine dieser Abweichungen war eine
 * Entscheidung, aber jede sah nach einer aus. Genau das ist der Grund für diese
 * Tabelle: Sie macht Absicht von Versehen unterscheidbar
 * (docs/concepts/konzept_kartenleinwand.md §3.7).
 *
 * Die Regel dazu: **Was auf zwei Bühnen gleich aussehen soll, kommt aus einer
 * Zahl hier; was verschieden sein darf, steht als benannte Bühnen-Variante
 * daneben (`KARTE_BUEHNE`) — mit ihrem Grund.** Ein Wert, der auf zwei Bühnen
 * zufällig anders ist, gilt danach als Fehler und nicht als Geschmack.
 *
 * Bewacht von test/einblendung-css.test.ts. Seit Etappe 2 steht die Player-Optik
 * nicht mehr in `style.css`, sondern im Maler (src/kartenmaler.ts): Der Wächter
 * vergleicht deshalb die RECHNUNG des Malers gegen `studio.html` statt CSS gegen
 * CSS. Die Tabelle hat den Wechsel überlebt, der Lesecode für die eine Seite
 * nicht — genau wie in Etappe 1 vorgemerkt.
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
   * Rückfalldauer des Ken-Burns-Zugs, falls niemand eine Klip-Länge nennt.
   *
   * Abgeleitet, nicht gewählt: `klipDauerS(HOLD_HIDE)` = 5,2 + 0,8. Der Player
   * stand auf 7 s, der Editor auf 6 s — und weil ein Rückfallwert nur greift,
   * wenn die Angabe fehlt, sieht man den Unterschied dort nie als Bruch,
   * sondern als leicht anderen Film. Das ist die heimtückischste Sorte
   * Abweichung, die dieses Konzept kennt.
   *
   * Getragen wurde er einmal von den Custom Properties `--kb-dauer` (Player) und
   * `--fe-kb-dauer` (Editor); beide gibt es nicht mehr, seit die Karte auf einer
   * Leinwand liegt. Der Wert bleibt: Er ist die Klip-Länge, und die prüft der
   * Wächter gegen `klipDauerS(HOLD_HIDE)`.
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
   * Der Kamerablitz ist ZURÜCKGEBAUT (2026-08-17, „Eine Bühne, ein Maler"
   * Etappe 2) — hier standen acht Zeilen für Dauer, Spitze, Mitte und die zwei
   * Halte seines Radialverlaufs.
   *
   * Der Grund war nicht die Leistung, obwohl er die teuerste Operation eines
   * Kartenbildes war (2,0 statt 1,1 ms im Median). Der Grund ist eine
   * Beobachtung am Bild: Auf seiner Spitze steht die Karte bei 7 % Deckkraft und
   * das „Entwickeln" beginnt bei `brightness(1.45)` — das Foto IST dort schon
   * ein heller Schleier. Der Blitz legte eine zweite weiße Schicht auf eine, die
   * längst da war: zwei Gesten für dieselbe Sache im selben Moment.
   *
   * Drei Gründe daneben, unabhängig davon: Die METAPHER ist verkehrt (ein Blitz
   * sagt „hier wird gerade fotografiert", diese Fotos sind längst aufgenommen
   * und werden gezeigt — „Entwickeln" ist das richtige Bild, und es sitzt auf
   * dem Foto statt über der Szene); er STROBTE (er hing am Klip, nicht am Halt,
   * feuerte also bei jedem Bildwechsel innerhalb eines Halts neu); und der
   * Auftritt ist ohnehin voll — Blende, Flug mit Überschwingen, Entwickeln,
   * gestaffelte Beschriftung, er war der vierte gleichzeitige Effekt.
   *
   * Was an seine Stelle tritt, steht schon da: der SCHLEIER. Der Halt wird
   * dadurch markiert, dass die Umgebung zurücktritt, nicht dass etwas aufblitzt.
   */

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
   *
   * Seine DECKKRAFT hängt seit dem Rückbau des Blitzes an der FILMZEIT und nicht
   * mehr an einer Wanduhr-Transition: Sie ist die der Karte (`phasen.sicht`),
   * geschrieben pro Frame als `--schleier-sicht`. Damit kommt er über den Flug
   * hoch und geht mit dem Abgang wieder weg — rückwärts wie vorwärts und beim
   * Scrubben. Das ist dieselbe Regel wie überall sonst im Film; sie fehlte hier
   * als letzte. Die Klasse (`body.cinema` / `.foto-an`) schaltet nur noch den
   * FILTER: Ein bildschirmfüllender `backdrop-filter`, der dauernd stünde, wäre
   * auf schwachen Geräten der teuerste Posten der Seite.
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
 * Bekannte Abweichungen des Video-Exports von der Tabelle — **leer, und das ist
 * das Ergebnis von Etappe 2.**
 *
 * In Etappe 1 standen hier sieben Zeilen: Ken Burns in der Gegenrichtung, kein
 * „Entwickeln", ein Auftritt ohne Flug, fehlender Blitz, fehlender Balken,
 * fehlende Pillen, ein rohes Seitenverhältnis und Texte, die per `textContent`
 * aus dem DOM zurückgelesen wurden. Sie wurden nicht Zahl für Zahl nachgezogen —
 * der ganze Nachbau (`zeichneFotoKarte`) ist weg. Der Export holt die Karte
 * jetzt mit einem `drawImage` von der Leinwand des Players, genau wie Wetter und
 * Atmosphäre (docs/concepts/konzept_kartenleinwand.md §3.1).
 *
 * Die Liste bleibt als Feld stehen und nicht als Kommentar, weil ihr Zweck
 * bleibt: Sie ist der Ort für die NÄCHSTE Abweichung, und der Wächter verlangt
 * für jeden Eintrag eine Spur im Code und einen Sollzustand. Wer dem Export
 * wieder eigene Optik gibt, trägt sie hier ein oder hat einen roten Test.
 */
export const KARTE_EXPORT_ABWEICHUNGEN: readonly {
  was: string
  spur: string
  soll: string
}[] = []

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
export function reihenfolgeImHalt<T extends { order?: number }>(
  items: readonly T[],
  natuerlich: (x: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const ra = a.order ?? Number.POSITIVE_INFINITY
    const rb = b.order ?? Number.POSITIVE_INFINITY
    return ra === rb ? natuerlich(a) - natuerlich(b) : ra - rb
  })
}
