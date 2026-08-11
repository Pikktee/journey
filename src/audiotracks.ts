// Tour-eigene Audio-Spuren (Kreativbaukasten): vom Autor im Studio hinterlegte
// Musik-Bereiche und SFX-One-Shots, verankert am Streckenanteil f (cfg.audio aus
// remote.ts). Musik läuft geloopt, solange der Playhead im Bereich [f0,f1) steht —
// mit träger Blende an den Grenzen (wie music.js); SFX feuern einmalig beim
// Vorwärts-Überfahren ihres f0 (nur echte Wiedergabe, keine Scrub-/Seek-Sprünge).
// Läuft nur, wenn das Gate wahr ist (z.B. „Tour läuft/Foto/Scrub"). Pause INNERHALB
// des Bereichs stoppt den Ton SOFORT und hält die Position — Weiterlaufen setzt
// genau dort fort (wie im Studio-Abspieler). Bereich verlassen / Musik aus: weiche
// Blende. setDucking: Video-Ton senkt laufende Musik (nicht SFX) auf VIDEO_DUCK ab.

import type { TourAudio } from './tours.js'

// — Reine Helfer (DOM-frei) — direkt testbar (test/audiotracks.test.ts, Node ohne Audio) —
//
// Die Helfer nehmen bewusst STRUKTURELLE Ausschnitte („was hat f0 und f1?") und
// nicht die ganze `TourAudio`: Das Studio ruft sie mit seinen eigenen Klip-Objekten
// auf (src/studio/abspielen.ts) — genau darin liegt der Wert, dass es eine Regel
// für Player und Editor ist und nicht zwei.

// Steht der Playhead im Bereich einer Musik-Spur? Halboffenes Intervall [f0,f1):
// an der Endgrenze ist die Spur schon aus (die Blende übernimmt das Weiche).
export function istAktiv(spur: { f0: number; f1: number }, frac: number): boolean {
  return spur.f0 <= frac && frac < spur.f1
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
// entscheidet damit die Spur selbst und nicht mehr ihr Typ.
export function hatBereich(spur: { f0: number; f1: number }): boolean {
  return spur.f1 > spur.f0
}

// Soll ein SFX-One-Shot feuern? Nur beim VORWÄRTS-Überfahren von f0, nur bei
// echter Wiedergabe (istPlayback) und nur bei Frame-kleiner Sprungweite — ein
// Scrub/Seek quer über die Marke soll nicht knallen. Nach jedem Aufruf zieht
// der Aufrufer die Vorher-Position hart nach, Sprünge „verbrauchen" die Marke also.
// Sonderfall f0=0: „vorher < 0" gibt es nie — die Marke am Tour-Start feuert
// stattdessen beim ersten echten Vorwärts-Tick aus der Nullposition heraus.
export function sfxSollFeuern(vorher: number, nachher: number, f0: number, istPlayback: boolean): boolean {
  if (!istPlayback || nachher - vorher >= 0.02) return false
  if (f0 === 0) return vorher === 0 && nachher > 0
  return vorher < f0 && nachher >= f0
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
interface Bereichsspur extends TourAudio {
  el: HTMLAudioElement | null
  level: number
  drin: boolean
  blocked: boolean
}

export interface AudioSpuren {
  setFrac(f: number, istPlayback: boolean): void
  setGate(fn: () => boolean): void
  setMusikEnabled(on: boolean): void
  setSfxEnabled(on: boolean): void
  setDucking(pegel: DuckPegel): void
  /** Höchster Blend-Pegel aller Bereichs-Spuren (Debug/E2E) */
  readonly level: number
  /** Quelle der Spur unter dem Playhead (Debug/E2E) */
  readonly aktiveSpur: string | null
  destroy(): void
}

export function createAudioTracks(tracks: TourAudio[], { volume = 0.22 }: { volume?: number } = {}): AudioSpuren {
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
  let frac = 0
  let vorher = 0 // interne Vorher-Position für die SFX-Kantenerkennung
  let duckTgt = 1
  let duck = 1

  const vol = (t: TourAudio) => Math.max(0, Math.min(1, volume * (t.gain ?? 1)))

  // Träge Blende + Play/Pause nach Ziel (aktiviert && Gate && im Bereich). Eigener
  // Timer wie music.js, damit der Ton unabhängig von der Render-Schleife läuft.
  const timer = setInterval(() => {
    const offen = gate()
    duck += (duckTgt - duck) * 0.45 // folgt der Video-Hülle eng (~0,15 s), ohne zu rattern
    for (const spur of musik) {
      const drin = istAktiv(spur, frac)
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
        }
        // Einstieg in die DATEI (linker Trim): der Klip beginnt dort, wo der
        // Autor die Kante gezogen hat, nicht am Dateianfang.
        spur.el.currentTime = spur.startS ?? 0
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
      spur.level += (tgt - spur.level) * 0.06 // ~2,5 s Blende bei 60 ms Tick (wie music.js)
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
    // Streckenanteil pro Frame zuführen (updateTrace-Wrapper in main.js). Musik
    // liest ihn im Timer; SFX prüfen hier sofort die Vorwärts-Kante über f0.
    setFrac: (f: number, istPlayback: boolean) => {
      frac = f
      for (const s of sfx) {
        if (sfxEnabled && sfxSollFeuern(vorher, f, s.f0, istPlayback)) {
          const el = new Audio(s.src) // One-Shot: eigenes Element, spielt aus und verfällt
          el.volume = vol(s)
          if (s.startS) el.currentTime = s.startS // linker Trim gilt auch hier
          el.play().catch(() => {}) // Autoplay-Block: One-Shot verfällt (kein Nachholen)
        }
      }
      vorher = f // Vorher-Position hart nachziehen — auch nach Sprüngen/Scrubs
    },
    setGate: (fn: () => boolean) => { gate = fn },
    setMusikEnabled: (on: boolean) => { musikEnabled = on },
    setSfxEnabled: (on: boolean) => { sfxEnabled = on },
    // Video-Ton-Hülle 0..1 → Musik ducken (Equal-Power); true/false bleibt kompatibel.
    setDucking: (pegel: DuckPegel) => { duckTgt = videoMusikDuck(alsHuelle(pegel)) },
    get level() { return musik.reduce((m, s) => Math.max(m, s.level), 0) }, // Debug/E2E
    get aktiveSpur() { return musik.find((s) => istAktiv(s, frac))?.src ?? null }, // Debug/E2E
    destroy: () => { clearInterval(timer); for (const s of musik) s.el?.pause() },
  }
}
