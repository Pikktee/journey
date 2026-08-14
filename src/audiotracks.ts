// Tour-eigene Audio-Spuren (Kreativbaukasten): vom Autor im Studio hinterlegte
// Musik-Bereiche und SFX-One-Shots, verankert in FILMSEKUNDEN (cfg.audio aus
// remote.ts, übersetzt in main.ts). Musik läuft geloopt, solange der Playhead im
// Bereich [filmVonS, filmBisS) steht — mit träger Blende an den Grenzen (wie
// music.ts); SFX feuern einmalig beim Vorwärts-Überfahren ihrer Filmsekunde (nur
// echte Wiedergabe, keine Scrub-/Seek-Sprünge).
// Läuft nur, wenn das Gate wahr ist (z.B. „Tour läuft/Foto/Scrub"). Pause INNERHALB
// des Bereichs stoppt den Ton SOFORT und hält die Position — Weiterlaufen setzt
// genau dort fort (wie im Studio-Abspieler). Bereich verlassen / Musik aus: weiche
// Blende. setDucking: Video-Ton senkt laufende Musik (nicht SFX) auf VIDEO_DUCK ab.
//
// **Gerechnet wird in Filmsekunden und nicht mehr im Streckenanteil `frac`**
// (Gleichlauf-Konzept E10, Etappe 4b). Der Grund ist der HALT: Dort läuft der
// Film, aber die Strecke steht — ein Klip, der ganz in einer Standzeit liegt,
// hat `f0 === f1` und wäre unter jeder `frac`-Prüfung stumm, welche Filmsekunde
// auch immer im Tour-JSON steht. Die JSON-Felder sind der Transport, DIESE
// Rechnung ist die Substanz.

import { NOT_DECKEL_S } from './filmuhr.js'
import type { TourAudio } from './tours.js'

// — Reine Helfer (DOM-frei) — direkt testbar (test/audiotracks.test.ts, Node ohne Audio) —
//
// Die Helfer nehmen bewusst STRUKTURELLE Ausschnitte („was hat filmVonS und
// filmBisS?") und nicht die ganze `TourAudio`: Das Studio ruft sie mit seinen
// eigenen Klip-Objekten auf (src/studio/abspielen.ts) — genau darin liegt der
// Wert, dass es eine Regel für Player und Editor ist und nicht zwei.

/** Eine Spur, wie sie hier gespielt wird: Tour-Angaben plus Film-Verankerung. */
export interface SpielSpur extends TourAudio {
  /** Filmsekunde, in der die Spur einsetzt (bei einem One-Shot: seine Marke) */
  filmVonS: number
  /** Filmsekunde, in der sie endet; ≤ filmVonS heißt „Marke ohne Länge" */
  filmBisS: number
}

// Steht der Playhead im Bereich einer Musik-Spur? Halboffenes Intervall
// [filmVonS, filmBisS): an der Endgrenze ist die Spur schon aus (die Blende
// übernimmt das Weiche).
export function istAktiv(spur: { filmVonS: number; filmBisS: number }, filmS: number): boolean {
  return spur.filmVonS <= filmS && filmS < spur.filmBisS
}

// Wiederholt diese Spur? Ohne Angabe gilt, was der Player immer getan hat:
// Musik lief geloopt (`el.loop = true`), ein Effekt war ein One-Shot. Deshalb
// verhält sich ein Tour-JSON von vor Etappe 4 exakt wie vorher.
// Spiegel von `loopAktiv` in server/src/schema/edits.ts.
export function loopAktiv(spur: { type: string; loop?: boolean }): boolean {
  return spur.loop ?? spur.type === 'music'
}

// Hat diese Spur eine Ausdehnung — oder ist sie eine Marke ohne Länge?
// Musik hatte immer einen Bereich, ein Effekt war immer ein Punkt. Seit Etappe 4
// darf auch ein Effekt eine Länge haben (die seiner Datei); WAS er ist,
// entscheidet damit die Spur selbst und nicht mehr ihr Typ. Gemessen wird die
// Ausdehnung in FILMzeit: Ein Bereich, der ganz in einer Standzeit liegt, hätte
// im Streckenanteil keine — genau der Fall, um den es in E10 geht.
export function hatBereich(spur: { filmVonS: number; filmBisS: number }): boolean {
  return spur.filmBisS > spur.filmVonS
}

/**
 * Größte Sprungweite (Filmsekunden), die noch als Frame durchgeht — darüber
 * ist es ein Seek und die Marke wird lautlos „verbraucht".
 *
 * **Keine Übersetzung der alten 0,02, sondern eine neue Herleitung.** In `frac`
 * waren das 2 % der ganzen Tour, auf Koh Pha-ngan rund 4,4 Filmsekunden; eine
 * naiv übernommene „0,02 s" verschluckte JEDEN One-Shot, weil jedes Frame
 * länger dauert. Die Schranke muss über der schlechtesten Frame-Zeit liegen —
 * gemessen 205 ms bei 12× Drosselung, am Telefon mehr. Genau diese Frage hat
 * die Filmuhr schon beantwortet: Ihr Notdeckel (src/filmuhr.ts) kappt jedes
 * Frame bei 1,0 s, ein Frame kann die Filmzeit bei Tempo 1 also gar nicht
 * weiter tragen. Zwei Zahlen, eine Herleitung.
 */
export const SFX_KANTE_S = NOT_DECKEL_S

// Soll ein SFX-One-Shot feuern? Nur beim VORWÄRTS-Überfahren seiner Filmsekunde,
// nur bei echter Wiedergabe (istPlayback) und nur bei Frame-kleiner Sprungweite —
// ein Scrub/Seek quer über die Marke soll nicht knallen. Nach jedem Aufruf zieht
// der Aufrufer die Vorher-Position hart nach, Sprünge „verbrauchen" die Marke also.
// Sonderfall Filmsekunde 0: „vorher < 0" gibt es nie — die Marke am Tour-Start
// feuert stattdessen beim ersten echten Vorwärts-Tick aus der Nullposition heraus.
export function sfxSollFeuern(vorherS: number, nachherS: number, filmVonS: number, istPlayback: boolean): boolean {
  if (!istPlayback || nachherS - vorherS >= SFX_KANTE_S) return false
  if (filmVonS === 0) return vorherS === 0 && nachherS > 0
  return vorherS < filmVonS && nachherS >= filmVonS
}

/**
 * Wo in der Datei setzt ein Musik-Bereich ein, wenn man mitten in ihm einsteigt?
 *
 * Nicht bei 0: Wer bei der Hälfte des Bereichs einsteigt, soll hören, was dort
 * im fertigen Film liefe. `seitFilmS` ist die FILMzeit seit Bereichsbeginn — die
 * eine Größe, die der Aufrufer beisteuert (Player: über die Filmachse; Editor:
 * über seine Spielkurve). Kürzere Dateien laufen im Loop, deshalb der Umbruch;
 * `dauerS` ist erst nach `loadedmetadata` bekannt — ohne sie kommt der rohe
 * Versatz zurück.
 *
 * `einstiegS` (linker Trim) verschiebt den Nullpunkt IN der Datei. Der Modulo
 * läuft danach über die GANZE Datei, nicht über den Rest hinter dem Einstieg —
 * denn genau das tut `el.loop`: Es springt am Dateiende auf Position 0 zurück.
 * Loop hebt nur den RECHTEN Anschlag auf; eine Wiederholung VOR dem Dateianfang
 * gibt es nicht.
 *
 * Sie stand bis Paket D in src/studio/abspielen.ts und rechnete dort über die
 * Filmkurve des Editors — für den Player unerreichbar. Er setzte deshalb hart
 * `currentTime = startS`: Wer mitten hineinsprang, hörte das Stück von vorn, wer
 * innerhalb eines Bereichs scrubbte, hörte es weiterlaufen. Ein Umzug, kein
 * Nachbau (Konzept §6C, Etappe 3).
 */
export function musikVersatzS(seitFilmS: number, dauerS = 0, einstiegS = 0, loop = true): number {
  const roh = Math.max(0, einstiegS) + Math.max(0, seitFilmS)
  if (!(dauerS > 0)) return roh
  // Ohne Loop endet der Klip am Material: die Position bleibt am Dateiende
  // stehen (das Element ist dann `ended` und schweigt), statt vorn neu zu beginnen.
  return loop ? roh % dauerS : Math.min(roh, dauerS)
}

// Ducking bei Video-Ton: volle Video-Lautstärke senkt die Musik auf diesen Anteil
// (~−13 dB). Der tatsächliche Duck-Pegel folgt der Video-Ton-Hülle (Equal-Power-
// Crossfade) — s. videoTonHuelle / videoMusikDuck. Später im Editor pro Medium
// individualisierbar; bis dahin fester Default.
export const VIDEO_DUCK = 0.22

/** Dauer der Video-Ton-Ein-/Ausblendung (Sekunden); bei kurzen Clips max. Hälfte. */
export const VIDEO_FADE_S = 1.4

/**
 * Lineare Ton-Hülle 0..1 über die Videodauer: Fade-in am Anfang, Fade-out am
 * Ende. DOM-frei — steuert sowohl video.volume als auch den Musik-Duck.
 */
export function videoTonHuelle(t: number, dauer: number, fadeS = VIDEO_FADE_S): number {
  if (!(dauer > 0) || !(t >= 0) || t >= dauer) return 0
  const fade = Math.min(Math.max(0, fadeS), dauer / 2)
  if (fade <= 0) return 1
  let x = 1
  if (t < fade) x = t / fade
  const rest = dauer - t
  if (rest < fade) x = Math.min(x, rest / fade)
  return x
}

/** Equal-Power-Kurve fürs Video (sin): konstante empfundene Lautheit im Crossfade. */
export function videoLautstaerke(huelle: number): number {
  const g = Math.max(0, Math.min(1, huelle))
  return Math.sin((g * Math.PI) / 2)
}

/**
 * Musik-Multiplikator zum Video-Pegel: bei Hülle 0 → 1 (voll), bei 1 → VIDEO_DUCK.
 * cos-Zweig zu videoLautstaerke — zusammen Equal-Power.
 */
export function videoMusikDuck(huelle: number): number {
  const g = Math.max(0, Math.min(1, Number(huelle) || 0))
  return VIDEO_DUCK + (1 - VIDEO_DUCK) * Math.cos((g * Math.PI) / 2)
}

/** Duck-Pegel, wie ihn Player und Studio hereinreichen: Hülle 0..1 oder an/aus. */
export type DuckPegel = number | boolean

/**
 * Hülle 0..1 aus dem, was der Aufrufer schickt — true/false bleibt kompatibel.
 * Exportiert, weil music.ts denselben Ausdruck braucht: die beiden Kopien waren
 * schon vor der Migration zeichengleich, hier bleiben sie es auch nachweislich.
 */
export const alsHuelle = (pegel: DuckPegel): number =>
  pegel === true ? 1 : pegel === false ? 0 : Math.max(0, Math.min(1, Number(pegel) || 0))

/** Eine laufende Bereichs-Spur: die Tour-Angaben plus ihr Wiedergabe-Zustand. */
interface Bereichsspur extends SpielSpur {
  el: HTMLAudioElement | null
  level: number
  drin: boolean
  blocked: boolean
}

export interface AudioSpuren {
  /** Filmsekunde pro Frame zuführen (`tour.filmS`, nicht aus `s` zurückgerechnet). */
  setFilmS(filmS: number, istPlayback: boolean): void
  setGate(fn: () => boolean): void
  /**
   * Laufende Bereiche auf die Filmsekunde nachziehen, an der der Film JETZT
   * steht — nach einem Scrub oder Sprung INNERHALB eines Bereichs.
   *
   * Der Eintritt allein genügt dafür nicht: Wer im Bereich bleibt, löst ihn nie
   * aus, und die Datei stünde bis zum Bereichsende an einer anderen Stelle als
   * der Film. Warum nicht in jedem Frame: Während des Scrubs läuft die Musik
   * (das Gate zählt Scrubben als Wiedergabe) — ein Seek je Frame wäre ein
   * Stottern statt einer Position.
   *
   * `beiFilmS` ist die Filmsekunde, an der der Sprung ENDET. Sie muss mitkommen:
   * `setFilmS` läuft erst im nächsten Frame, der eingebaute Wert wäre also noch
   * der von VOR dem Sprung — und der Ton stünde eine Geste zu spät.
   */
  richteAus(beiFilmS?: number): void
  setMusikEnabled(on: boolean): void
  setSfxEnabled(on: boolean): void
  setDucking(pegel: DuckPegel): void
  /** Höchster Blend-Pegel aller Bereichs-Spuren (Debug/E2E) */
  readonly level: number
  /** Quelle der Spur unter dem Playhead (Debug/E2E) */
  readonly aktiveSpur: string | null
  /**
   * Was die Bereichs-Spuren gerade spielen und WO in der Datei sie stehen
   * (Debug/E2E) — Spiegel von `Abspieler.tonStand` im Studio. Ohne ihn ist die
   * Datei-Position im Player nicht nachprüfbar: Die Elemente entstehen per
   * `new Audio()` und hängen nirgends im DOM.
   */
  readonly tonStand: Array<{
    src: string
    laeuft: boolean
    positionS: number
    dauerS: number
    filmVonS: number
    /** Zustand des Elements — ein Seek vor dem Puffern greift nicht (readyState 0) */
    bereit: number
    sucht: boolean
    pegel: number
  }>
  destroy(): void
}

/**
 * Master-Faktor der KURATIERTEN Touren (src/tours.ts): deren `gain` ist gegen
 * ihn ausgemessen. Aufgezeichnete Touren geben stattdessen `cfg.audioPegel = 1`
 * herein — ihr `gain` kommt aus dem Studio-Regler und ist bereits der Pegel,
 * den der Autor beim Schneiden gehört hat.
 */
export const KURATIERTER_PEGEL = 0.22

/**
 * Reglerstellung eines Ton-Klips ohne eigenen Wert — die Vorgabe des Studios
 * (Spiegel von STUDIO_PEGEL in server/src/schema/edits.ts, Drift-Wächter in
 * test/studio-baukasten.test.ts). Sie steht hier und nicht im Studio, weil auch
 * der PLAYER sie braucht: `enrich.ts` schreibt `gain` erst seit dieser Änderung
 * immer, und ein bereits gerendertes Tour-JSON kommt ohne. Ohne den Rückfall
 * spielte genau der Bestand mit 1.0 — lauter als der Schnitt, nicht leiser.
 */
export const STUDIO_PEGEL_VORGABE = 0.8

export function createAudioTracks(
  tracks: SpielSpur[],
  { volume = KURATIERTER_PEGEL }: { volume?: number } = {},
): AudioSpuren {
  // Bereichs-Spuren: je Spur ein lazy HTMLAudioElement (erst beim ersten Eintritt
  // geladen, preload='none'), eigener Blend-Level für die weiche Bereichsgrenze.
  // Getrennt wird nach AUSDEHNUNG, nicht nach Typ — ein Effekt mit Länge klingt
  // wie ein Bereich, einer ohne wie eh und je einmal (docs §2E).
  const musik: Bereichsspur[] = tracks
    .filter(hatBereich)
    .map((t) => ({ ...t, el: null, level: 0, drin: false, blocked: false }))
  const sfx = tracks.filter((t) => !hatBereich(t))
  let musikEnabled = true
  let sfxEnabled = true
  let gate = (): boolean => false
  let jetztS = 0 // Filmsekunde des letzten Frames
  let vorherS = 0 // interne Vorher-Position für die SFX-Kantenerkennung
  let duckTgt = 1
  let duck = 1

  const vol = (t: TourAudio) => Math.max(0, Math.min(1, volume * (t.gain ?? 1)))

  /**
   * Die Datei auf die Stelle setzen, die in Filmsekunde `filmS` liefe.
   *
   * Ohne bekannte Dauer (das Element lädt erst) bleibt es beim rohen Versatz —
   * `loadedmetadata` zieht ihn danach exakt nach.
   */
  const setzeVersatz = (spur: Bereichsspur, filmS: number): void => {
    const el = spur.el
    if (!el) return
    const dauer = Number.isFinite(el.duration) ? el.duration : 0
    try {
      el.currentTime = musikVersatzS(filmS - spur.filmVonS, dauer, spur.startS ?? 0, loopAktiv(spur))
    } catch {
      /* Seek vor dem Puffern kann fehlschlagen — dann läuft sie ab 0 */
    }
  }

  // Träge Blende + Play/Pause nach Ziel (aktiviert && Gate && im Bereich). Eigener
  // Timer wie music.ts, damit der Ton unabhängig von der Render-Schleife läuft.
  const timer = setInterval(() => {
    const offen = gate()
    duck += (duckTgt - duck) * 0.45 // folgt der Video-Hülle eng (~0,15 s), ohne zu rattern
    for (const spur of musik) {
      const drin = istAktiv(spur, jetztS)
      // Welcher Schalter zuständig ist, sagt der TYP — auch ein Effekt mit
      // Bereich bleibt ein Effekt und geht mit „Klänge aus" mit.
      const anBleibt = spur.type === 'music' ? musikEnabled : sfxEnabled
      const want = anBleibt && offen && drin
      // Eintritt in den Bereich (auch nach Scrub/Jump): von vorn starten —
      // Pause/Weiter INNERHALB des Bereichs setzt dagegen nicht zurück (Einfrieren)
      if (drin && !spur.drin) {
        if (!spur.el) {
          // lazy: Element erst beim ersten Eintritt anlegen; preload='none' VOR
          // src, sonst lädt der Browser schon beim Anlegen (erst play() lädt)
          spur.el = new Audio()
          spur.el.preload = 'none'
          // Loop bis zur Bereichsgrenze — ohne ihn verstummt die Spur, sobald
          // die Datei einmal durchgelaufen ist. Genau das ist bei einem Effekt
          // erwünscht (Zikaden nein, Brandung ja), deshalb kommt die Entscheidung
          // seit Etappe 4 aus dem Overlay statt pauschal aus dem Typ.
          spur.el.loop = loopAktiv(spur)
          spur.el.src = spur.src
          // Die Dauer kennt erst der geladene Kopf der Datei — bis dahin ist der
          // Versatz ungekürzt. Einmalig nachziehen, mit der Filmsekunde VON
          // DAMALS: Beim Laden steht der Film schon weiter, gemeint ist der Eintritt.
          const beiEintritt = jetztS
          spur.el.addEventListener('loadedmetadata', () => setzeVersatz(spur, beiEintritt), { once: true })
        }
        // Einstieg in die DATEI: linker Trim plus die Filmzeit, die seit dem
        // Bereichsbeginn vergangen ist — wer mitten hineinspringt, hört, was
        // dort im Film liefe (§6C, `musikVersatzS`).
        setzeVersatz(spur, jetztS)
        if (want) spur.el.play().catch(() => { spur.blocked = true })
      }
      spur.drin = drin
      const el = spur.el
      if (!el) continue

      // Pause innerhalb des Bereichs (Gate zu, Playhead noch drin): Ton SOFORT
      // stoppen, Position und Level halten — Weiterlaufen setzt genau dort fort.
      // Bereich verlassen / Musik aus: unten die weiche Blende.
      // Ducking gilt der MUSIK: Ein Effekt, der zum Video gehört (Brandung unter
      // einer Strandaufnahme), soll nicht unter dessen eigenem Ton wegtauchen.
      const pegelDuck = spur.type === 'music' ? duck : 1
      if (drin && !offen) {
        if (!el.paused) el.pause()
        el.volume = Math.max(0, Math.min(1, spur.level * pegelDuck))
        continue
      }

      const tgt = want ? vol(spur) : 0
      spur.level += (tgt - spur.level) * 0.06 // ~2,5 s Blende bei 60 ms Tick (wie music.ts)
      el.volume = Math.max(0, Math.min(1, spur.level * pegelDuck))
      // Retry nach Autoplay-Block bzw. nach Pause-Einfrieren. `ended` schließt
      // den Fall aus, den es ohne Loop jetzt gibt: eine durchgelaufene Datei
      // würde von play() wieder bei 0 anfangen — der Klip klänge endlos, obwohl
      // gerade das abgeschaltet wurde.
      if (want && el.paused && !el.ended && !spur.blocked) el.play().catch(() => { spur.blocked = true })
      if (!want && !el.paused && spur.level < 0.004) el.pause()
    }
  }, 60)

  // Autoplay-Block nach der ersten User-Geste aufheben (Retry im Timer)
  window.addEventListener('pointerdown', () => { for (const s of musik) s.blocked = false }, { passive: true })

  return {
    // Filmsekunde pro Frame zuführen (updateTrace-Wrapper in main.ts). Musik
    // liest sie im Timer; SFX prüfen hier sofort die Vorwärts-Kante.
    setFilmS: (filmS: number, istPlayback: boolean) => {
      jetztS = filmS
      for (const s of sfx) {
        if (sfxEnabled && sfxSollFeuern(vorherS, filmS, s.filmVonS, istPlayback)) {
          const el = new Audio(s.src) // One-Shot: eigenes Element, spielt aus und verfällt
          el.volume = vol(s)
          if (s.startS) el.currentTime = s.startS // linker Trim gilt auch hier
          el.play().catch(() => {}) // Autoplay-Block: One-Shot verfällt (kein Nachholen)
        }
      }
      vorherS = filmS // Vorher-Position hart nachziehen — auch nach Sprüngen/Scrubs
    },
    setGate: (fn: () => boolean) => { gate = fn },
    richteAus: (beiFilmS?: number) => {
      const filmS = beiFilmS ?? jetztS
      for (const spur of musik) if (istAktiv(spur, filmS)) setzeVersatz(spur, filmS)
    },
    setMusikEnabled: (on: boolean) => { musikEnabled = on },
    setSfxEnabled: (on: boolean) => { sfxEnabled = on },
    // Video-Ton-Hülle 0..1 → Musik ducken (Equal-Power); true/false bleibt kompatibel.
    setDucking: (pegel: DuckPegel) => { duckTgt = videoMusikDuck(alsHuelle(pegel)) },
    get level() { return musik.reduce((m, s) => Math.max(m, s.level), 0) }, // Debug/E2E
    get aktiveSpur() { return musik.find((s) => istAktiv(s, jetztS))?.src ?? null }, // Debug/E2E
    get tonStand() {
      return musik
        .filter((s) => s.el)
        .map((s) => ({
          src: s.src,
          laeuft: !s.el?.paused,
          positionS: s.el?.currentTime ?? 0,
          dauerS: s.el?.duration ?? 0,
          filmVonS: s.filmVonS,
          bereit: s.el?.readyState ?? 0,
          sucht: s.el?.seeking ?? false,
          pegel: Math.round((s.el?.volume ?? 0) * 1000) / 1000,
        }))
    },
    destroy: () => { clearInterval(timer); for (const s of musik) s.el?.pause() },
  }
}
