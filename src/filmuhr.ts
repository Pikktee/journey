// Die Filmuhr der Engine: echte, UNGEDECKELTE Frame-Zeit.
//
// Vorher rechnete `tick()` mit `Math.min((now - lastT) / 1000, 0.05)`. Der
// Deckel machte aus einem langsamen Gerät keine ausgelassenen Bilder, sondern
// eine langsamere Tour: Bei 6× Drosselung lief die Bilduhr auf 81,3 % der
// Echtzeit, bei 12× auf 46,1 % — der Ton lief dabei in Echtzeit weiter, und
// Bild und Musik standen am Ende Sekunden auseinander
// (docs/concepts/konzept_gleichlauf_player_editor.md §4.1, §8A).
//
// Ein Film mit Ton trifft an dieser Stelle die Wahl jedes Videoplayers: Die
// Zeit wird gehalten, das Bild springt. Diese Datei ist diese Wahl.
//
// **Die Kamera bekommt keinen eigenen Deckel und keine Teilschritte** (Falle 3
// im Konzept). `Smooth.to` rechnet `1 − exp(−dt/τ)` — die exakte Lösung bei
// konstantem Ziel; über ein langes Frame sammelt sich dort kein Fehler an, und
// N Teilschritte ergeben exakt dasselbe (`exp(−dt/τ) = exp(−dt/Nτ)^N`). Ein
// gedeckeltes `dtKamera` ließe die Kamera stattdessen DAUERHAFT
// hinterherhängen, weil sie nur einen Bruchteil der vergangenen Zeit
// integrierte. Es gibt deshalb genau ein `dt` für alles.
//
// DOM-frei und ohne Importe: Der Test spielt 200-ms-Frames durch, ohne Browser.
// Die Anbindung an die Sichtbarkeit steht als eigene Funktion daneben.

/**
 * Notdeckel in Sekunden — kein Frame-Deckel, sondern ein Netz.
 *
 * Er ist NICHT das Werkzeug für den Hintergrund-Fall (das ist
 * `verbindeSichtbarkeit`), sondern fängt Umgebungen, in denen die rAF-Kette
 * aussetzt, ohne dass ein Ereignis davon erzählt. Deshalb liegt er weit über
 * jedem realen Frame: gemessen 205 ms bei 12× Drosselung, am Telefon mehr —
 * aber nie eine Sekunde. Ein Wert in der Größenordnung echter Stocker (die
 * verworfenen 0,25 s aus einer früheren Fassung) verlöre wieder still Zeit,
 * also genau den Fehler, den diese Datei behebt.
 *
 * Was er doch kappt, ist gezählt (`verworfenS`) und nicht unsichtbar.
 */
export const NOT_DECKEL_S = 1.0

/**
 * Zählt Filmsekunden aus einer monotonen Echtzeituhr.
 *
 * Alles, was Zeit misst, hängt daran: die `s`-Integration, `holdT`, `momentT`,
 * die Tweens und jeder Glättungsfilter der Kamera.
 */
export class Filmuhr {
  /** Zeitstempel des letzten Frames; `null` = das nächste Frame setzt neu an. */
  private vorige: number | null = null
  /**
   * Wanduhr-Zeitpunkt des Anhaltens, `null` = Uhr läuft.
   *
   * Getrennt von `vorige`, und das ist der Unterschied zwischen „hält an" und
   * „setzt neu an": Ein Frame, das WÄHREND der Pause kommt, darf die Uhr nicht
   * wieder in Gang setzen. Im Hintergrund-Tab feuert `rAF` zwar nicht, aber die
   * Pause kommt auch aus der Android-WebView, und dort hängt der Zeitpunkt am
   * Lebenszyklus der Activity, nicht am Zeichentakt der Seite. Ohne die
   * Trennung lief die Uhr ein Frame nach `pausiere()` einfach weiter (gemessen).
   */
  private pausiertBei: number | null = null
  private jetztMs: () => number

  /** Sekunden, die der Notdeckel gekappt hat. */
  verworfenS = 0
  /** Frames, in denen der Notdeckel gegriffen hat. */
  verworfenFrames = 0
  /** Sekunden, die als Abwesenheit übersprungen wurden (Hintergrund). */
  pausiertS = 0
  /** Wie oft die Uhr angehalten wurde. */
  pausen = 0
  /** Wie oft sie ohne Gegenstück von selbst weiterlief (s. `frame`). */
  selbstweiter = 0
  /** Frames seit dem Anhalten (nur intern, aber lesbar nützlich). */
  private frameInPause = 0
  /**
   * Längstes gemessenes Frame in Sekunden — VOR dem Notdeckel.
   *
   * Nach dem Kappen stünde dort für jeden Ausreißer exakt `NOT_DECKEL_S`, also
   * genau bei den Fällen nichts, für die der Zähler da ist.
   */
  laengstesFrameS = 0

  /**
   * Wird bei jedem Wechsel von `laeuft` gerufen (Anhalten, Weiterlaufen).
   *
   * Nötig, weil nicht alles an der Filmuhr hängt, was mitgehen muss: Ein
   * `<audio>`/`<video>`-Element läuft an der Wanduhr des Browsers weiter, auch
   * wenn kein Frame mehr kommt. Ohne diesen Griff wäre die Musik nach einer
   * Minute im Hintergrund eine Minute weiter als das Bild — der Befund aus §4.1
   * des Konzepts, den die Drosselungs-Messung nicht sieht.
   */
  beiWechsel: ((laeuft: boolean) => void) | null = null

  /** Läuft die Uhr? (false = Seite im Hintergrund) */
  get laeuft(): boolean {
    return this.pausiertBei === null
  }

  constructor(jetztMs: () => number = () => performance.now()) {
    this.jetztMs = jetztMs
    this.vorige = jetztMs()
  }

  /** Filmsekunden seit dem letzten Frame. `now` ist der rAF-Zeitstempel. */
  frame(now: number): number {
    if (this.pausiertBei !== null) {
      // Angehalten — aber es kommen Bilder. Im Hintergrund feuert `rAF` nicht;
      // kommen ZWEI Frames in Folge, ist die Seite offensichtlich wieder da und
      // das Gegenstück zur Pause ist ausgeblieben (eine `evaluateJavascript`-
      // Nachricht der App, die es nicht durch den Renderer schaffte). Lieber
      // von selbst weiterlaufen als für immer stehen: Ein Film, der nach der
      // Rückkehr einfriert, ist der teurere Fehler. Erst ab dem zweiten Frame,
      // damit ein einzelnes noch laufendes Bild die Pause nicht aufhebt.
      this.frameInPause++
      if (this.frameInPause < 2) return 0
      this.weiter()
      this.selbstweiter++
      return 0
    }
    this.frameInPause = 0
    if (this.vorige === null) {
      // Erstes Frame nach einer Pause: Es setzt neu an, holt aber nichts nach.
      this.vorige = now
      return 0
    }
    let dt = (now - this.vorige) / 1000
    // Rückwärts laufende oder gleiche Zeitstempel (zwei rAF-Aufrufe im selben
    // Frame kommen vor) sind keine Filmzeit — und sie dürfen den Bezugspunkt
    // NICHT übernehmen: Sonst zählte das nächste Frame die Differenz doppelt.
    if (!(dt > 0)) return 0
    this.vorige = now
    if (dt > this.laengstesFrameS) this.laengstesFrameS = dt // vor dem Deckel
    if (dt > NOT_DECKEL_S) {
      this.verworfenS += dt - NOT_DECKEL_S
      this.verworfenFrames++
      dt = NOT_DECKEL_S
    }
    return dt
  }

  /**
   * Uhr anhalten (Seite in den Hintergrund).
   *
   * Ohne diesen Griff schöbe die Rückkehr die Filmzeit um die volle
   * Abwesenheit vor — der Player käme aus einer Minute Tab-Wechsel einen
   * Kilometer weiter zurück.
   */
  pausiere(): void {
    if (this.pausiertBei !== null) return
    this.vorige = null
    this.pausiertBei = this.jetztMs()
    this.pausen++
    this.beiWechsel?.(false)
  }

  /**
   * Uhr wieder laufen lassen. Das nächste Frame liefert 0 und setzt neu an —
   * es gibt bewusst keine „nachgeholte" Zeit.
   */
  weiter(): void {
    if (this.pausiertBei === null) return
    this.pausiertS += Math.max(0, (this.jetztMs() - this.pausiertBei) / 1000)
    this.pausiertBei = null
    // `vorige` bleibt null: Erst das nächste Frame kennt seinen Zeitstempel.
    this.beiWechsel?.(true)
  }
}

/**
 * Hängt die Uhr an die Sichtbarkeit der Seite.
 *
 * Zwei Quellen, und die zweite ist kein Beiwerk: Die Android-WebView wird beim
 * Wechsel in den Hintergrund mit `onPause()`/`pauseTimers()` eingefroren
 * (android/…/PlayerScreen.kt), und ob dabei ein `visibilitychange` durchkommt,
 * hängt daran, ob die View ihre Fenster-Sichtbarkeit verliert — nicht
 * zugesichert und auf dem Gerät nicht nachprüfbar gewesen. Ausgerechnet die
 * Plattform mit den gemessenen ~26 fps stünde damit ohne den Griff da. Deshalb
 * sagt die App es zusätzlich ausdrücklich, über zwei eigene Ereignisse; der
 * Notdeckel oben ist die dritte Lage.
 *
 * Gibt eine Abmelde-Funktion zurück (heute ungenutzt: Der Player lebt so lange
 * wie die Seite).
 */
export function verbindeSichtbarkeit(uhr: Filmuhr): () => void {
  if (typeof document === 'undefined') return () => {}
  const beiSichtbarkeit = (): void => {
    if (document.visibilityState === 'hidden') uhr.pausiere()
    else uhr.weiter()
  }
  const beiHintergrund = (): void => uhr.pausiere()
  const beiVordergrund = (): void => uhr.weiter()
  document.addEventListener('visibilitychange', beiSichtbarkeit)
  window.addEventListener('maptale:hintergrund', beiHintergrund)
  window.addEventListener('maptale:vordergrund', beiVordergrund)
  return () => {
    document.removeEventListener('visibilitychange', beiSichtbarkeit)
    window.removeEventListener('maptale:hintergrund', beiHintergrund)
    window.removeEventListener('maptale:vordergrund', beiVordergrund)
  }
}
