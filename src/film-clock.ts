// Die Filmuhr der Engine: echte, UNGEDECKELTE Frame-Zeit.
//
// Vorher rechnete `tick()` mit `Math.min((now - lastT) / 1000, 0.05)`. Der
// Deckel machte aus einem langsamen Gerät keine ausgelassenen Bilder, sondern
// eine langsamere Tour: Bei 6× Drosselung lief die Bilduhr auf 81,3 % der
// Echtzeit, bei 12× auf 46,1 % — der Ton lief dabei in Echtzeit weiter, und
// Bild und Musik standen am Ende Sekunden auseinander
// (docs/archive/konzept_gleichlauf_player_editor.md §4.1, §8A).
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
 * `connectVisibility`), sondern fängt Umgebungen, in denen die rAF-Kette
 * aussetzt, ohne dass ein Ereignis davon erzählt. Deshalb liegt er weit über
 * jedem realen Frame: gemessen 205 ms bei 12× Drosselung, am Telefon mehr —
 * aber nie eine Sekunde. Ein Wert in der Größenordnung echter Stocker (die
 * verworfenen 0,25 s aus einer früheren Fassung) verlöre wieder still Zeit,
 * also genau den Fehler, den diese Datei behebt.
 *
 * Was er doch kappt, ist gezählt (`verworfenS`) und nicht unsichtbar.
 */
export const FRAME_CAP_S = 1.0

/**
 * Zählt Filmsekunden aus einer monotonen Echtzeituhr.
 *
 * Alles, was Zeit misst, hängt daran — seit Etappe 4 ist das genau EINE Größe:
 * die Filmsekunde `tour.filmS`, aus der Position, Halt und Foto-Karte folgen.
 * Daneben nur noch Ästhetisches: die Tweens und die Glättungsfilter der Kamera.
 */
export class FilmClock {
  /** Zeitstempel des letzten Frames; `null` = das nächste Frame setzt neu an. */
  private previous: number | null = null
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
  private pausedAt: number | null = null
  private nowMs: () => number

  /** Sekunden, die der Notdeckel gekappt hat. */
  droppedS = 0
  /** Frames, in denen der Notdeckel gegriffen hat. */
  droppedFrames = 0
  /** Sekunden, die als Abwesenheit übersprungen wurden (Hintergrund). */
  pausedS = 0
  /** Wie oft die Uhr angehalten wurde. */
  pauses = 0
  /** Wie oft sie ohne Gegenstück von selbst weiterlief (s. `frame`). */
  selfResumes = 0
  /** Frames seit dem Anhalten (nur intern, aber lesbar nützlich). */
  private frameInPause = 0
  /**
   * Längstes gemessenes Frame in Sekunden — VOR dem Notdeckel.
   *
   * Nach dem Kappen stünde dort für jeden Ausreißer exakt `FRAME_CAP_S`, also
   * genau bei den Fällen nichts, für die der Zähler da ist.
   */
  longestFrameS = 0

  /**
   * Wird bei jedem Wechsel von `laeuft` gerufen (Anhalten, Weiterlaufen).
   *
   * Nötig, weil nicht alles an der Filmuhr hängt, was mitgehen muss: Ein
   * `<audio>`/`<video>`-Element läuft an der Wanduhr des Browsers weiter, auch
   * wenn kein Frame mehr kommt. Ohne diesen Griff wäre die Musik nach einer
   * Minute im Hintergrund eine Minute weiter als das Bild — der Befund aus §4.1
   * des Konzepts, den die Drosselungs-Messung nicht sieht.
   */
  onChange: ((running: boolean) => void) | null = null

  /** Läuft die Uhr? (false = Seite im Hintergrund) */
  get running(): boolean {
    return this.pausedAt === null
  }

  constructor(nowMs: () => number = () => performance.now()) {
    this.nowMs = nowMs
    this.previous = nowMs()
  }

  /** Filmsekunden seit dem letzten Frame. `now` ist der rAF-Zeitstempel. */
  frame(now: number): number {
    if (this.pausedAt !== null) {
      // Angehalten — aber es kommen Bilder. Im Hintergrund feuert `rAF` nicht;
      // kommen ZWEI Frames in Folge, ist die Seite offensichtlich wieder da und
      // das Gegenstück zur Pause ist ausgeblieben (eine `evaluateJavascript`-
      // Nachricht der App, die es nicht durch den Renderer schaffte). Lieber
      // von selbst weiterlaufen als für immer stehen: Ein Film, der nach der
      // Rückkehr einfriert, ist der teurere Fehler. Erst ab dem zweiten Frame,
      // damit ein einzelnes noch laufendes Bild die Pause nicht aufhebt.
      this.frameInPause++
      if (this.frameInPause < 2) return 0
      this.resume()
      this.selfResumes++
      return 0
    }
    this.frameInPause = 0
    if (this.previous === null) {
      // Erstes Frame nach einer Pause: Es setzt neu an, holt aber nichts nach.
      this.previous = now
      return 0
    }
    let dt = (now - this.previous) / 1000
    // Rückwärts laufende oder gleiche Zeitstempel (zwei rAF-Aufrufe im selben
    // Frame kommen vor) sind keine Filmzeit — und sie dürfen den Bezugspunkt
    // NICHT übernehmen: Sonst zählte das nächste Frame die Differenz doppelt.
    if (!(dt > 0)) return 0
    this.previous = now
    if (dt > this.longestFrameS) this.longestFrameS = dt // vor dem Deckel
    if (dt > FRAME_CAP_S) {
      this.droppedS += dt - FRAME_CAP_S
      this.droppedFrames++
      dt = FRAME_CAP_S
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
  pause(): void {
    if (this.pausedAt !== null) return
    this.previous = null
    this.pausedAt = this.nowMs()
    this.pauses++
    this.onChange?.(false)
  }

  /**
   * Uhr wieder laufen lassen. Das nächste Frame liefert 0 und setzt neu an —
   * es gibt bewusst keine „nachgeholte" Zeit.
   */
  resume(): void {
    if (this.pausedAt === null) return
    this.pausedS += Math.max(0, (this.nowMs() - this.pausedAt) / 1000)
    this.pausedAt = null
    // `vorige` bleibt null: Erst das nächste Frame kennt seinen Zeitstempel.
    this.onChange?.(true)
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
export function connectVisibility(clock: FilmClock): () => void {
  if (typeof document === 'undefined') return () => {}
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') clock.pause()
    else clock.resume()
  }
  const onBackground = (): void => clock.pause()
  const onForeground = (): void => clock.resume()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('maptale:background', onBackground)
  window.addEventListener('maptale:foreground', onForeground)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('maptale:background', onBackground)
    window.removeEventListener('maptale:foreground', onForeground)
  }
}
