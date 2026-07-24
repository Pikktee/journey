// Wiedergabe in der Zeitleiste: der Abspielkopf läuft, Musik und Klänge
// erklingen, an jedem Halt blendet die Aufnahme auf.
//
// Das ist bewusst KEIN zweiter Player — die 3D-Kamerafahrt bleibt dem echten
// Player vorbehalten (Knopf „Vorschau"). Hier geht es darum, den SCHNITT zu
// prüfen: Kommt die Musik zum Strandabschnitt? Reißt der Halt am Gipfel die
// Fahrt auseinander? Dafür genügen Kopf, Ton und Bild.
//
// Gerechnet wird in ANTEILEN 0..1 der Aufnahme-Zeitachse — derselben Größe, in
// der die ganze Leiste denkt. Wie schnell die Marke darüberläuft, sagt `rate`:
// der Kehrwert der geschätzten Animationsdauer (zeitleiste.ts). Damit dauert das
// Abspielen hier ungefähr so lang wie der fertige Film, und der Halt an einem
// Foto „kostet" sichtbar Zeit — genau wie später.
//
// Reine Logik (tick, musikVersatzS) ist DOM-frei und unter Vitest getestet; das
// Modul wird erst beim ersten Play geladen (editor.ts), damit die Audio-Elemente
// niemanden belasten, der nur schneidet.

import { sfxSollFeuern } from '../audiotracks.js'

/** Eine Aufnahme, an der die Wiedergabe ruht. */
export interface HaltFoto {
  id: string
  /** Standzeit der Einblendung in Sekunden (display.holdS oder Default) */
  dauerS: number
}

/**
 * Ein Halt auf der Zeitachse — alle Aufnahmen desselben Ortes. Gehalten wird am
 * STOPP, nicht am einzelnen Bild: mehrere Aufnahmen am selben Ort liegen auf
 * (fast) derselben Zeit, nacheinander gezeigt käme sonst nur die erste je vor.
 */
export interface Halt {
  anteil: number
  fotos: HaltFoto[]
}

/** Musik-Bereich auf der Zeitachse. */
export interface MusikKlip {
  von: number
  bis: number
  url: string
  lautstaerke: number
}

/** Klang, der beim Überfahren einmal auslöst. */
export interface KlangMarke {
  /** Index im Overlay-Array — der Editor lässt seine Marke damit pulsen */
  index: number
  anteil: number
  url: string
  lautstaerke: number
}

/** Alles, was eine Wiedergabe braucht — beim Start einmal eingesammelt. */
export interface Spielplan {
  /** Startposition (Anteil 0..1) */
  marke: number
  /** Anteil je Sekunde bei 1× — Kehrwert der geschätzten Animationsdauer */
  rate: number
  halte: Halt[]
  musik: MusikKlip[]
  klaenge: KlangMarke[]
}

/** Laufender Zustand der Wiedergabe. */
export interface SpielStand {
  marke: number
  /** 0 = angehalten, 1 = normal, ±2/±4 = Schnelllauf (J/L wie in Final Cut) */
  tempo: number
  /** Restzeit des laufenden Halts in Sekunden; 0 = es wird gefahren */
  restS: number
  /** noch nicht gezeigte Aufnahmen des laufenden Halts */
  folge: HaltFoto[]
}

/** Ergebnis eines Schritts. */
export interface Schritt {
  stand: SpielStand
  /** Marke VOR dem Schritt — die Kante, an der Klänge auslösen */
  vorher: number
  /** Aufnahme, die jetzt einzublenden ist */
  zeige: HaltFoto | null
  /** Streckenende in Laufrichtung erreicht */
  ende: boolean
}

/** Liegt `t` zwischen `a` und `b` (in beide Richtungen)? */
export const ueberquert = (t: number, a: number, b: number): boolean => (a < t && t <= b) || (b <= t && t < a)

export const LEERER_STAND: SpielStand = { marke: 0, tempo: 0, restS: 0, folge: [] }

/**
 * Ein Zeitschritt der Wiedergabe — rein, ohne Uhr und ohne DOM.
 *
 * Zwei Feinheiten, die sich im Mockup erst nach Fehlern ergaben:
 *
 * 1. Das Ende gilt RICHTUNGSABHÄNGIG. Prüfte man beide Ränder, hielte ein Start
 *    bei Marke 0 sofort wieder an: der erste Frame hat dt = 0, die Marke bleibt
 *    0 und träfe die Bedingung „≤ 0".
 * 2. Am Halt springt die Marke exakt AUF den Halt. Sonst stünde sie ein Stück
 *    dahinter, und beim Weiterfahren gälte der Halt als noch nicht passiert.
 */
export function tick(stand: SpielStand, dtS: number, plan: Spielplan): Schritt {
  let uebrigS = dtS

  // — An einer Aufnahme ruhen: die Zeit läuft, die Position nicht —
  if (stand.restS > 0) {
    const rest = stand.restS - dtS
    if (rest > 0) return { stand: { ...stand, restS: rest }, vorher: stand.marke, zeige: null, ende: false }
    const naechste = stand.folge[0]
    if (naechste) {
      // Noch eine Aufnahme an diesem Ort: der Halt bleibt stehen und zeigt sie.
      // Die überzählige Zeit (rest ist negativ) zählt bereits für sie.
      return {
        stand: { ...stand, restS: naechste.dauerS + rest, folge: stand.folge.slice(1) },
        vorher: stand.marke,
        zeige: naechste,
        ende: false,
      }
    }
    uebrigS = -rest // Halt zu Ende — mit dem Rest des Schritts weiterfahren
  }

  const alt = stand.marke
  let m = alt + stand.tempo * plan.rate * uebrigS
  let ende = false
  if (stand.tempo > 0 && m >= 1) {
    m = 1
    ende = true
  } else if (stand.tempo < 0 && m <= 0) {
    m = 0
    ende = true
  }

  // — Am nächsten erreichten Halt anhalten —
  //
  // Nur bei normaler Vorwärtsfahrt: im Schnelllauf und rückwärts will man die
  // Strecke überfliegen, nicht an jedem Bild warten.
  let zeige: HaltFoto | null = null
  let restS = 0
  let folge: HaltFoto[] = []
  if (stand.tempo === 1) {
    const halt = plan.halte
      .filter((h) => ueberquert(h.anteil, alt, m) && h.fotos.length > 0)
      .sort((a, b) => a.anteil - b.anteil)[0]
    const erste = halt?.fotos[0]
    if (halt && erste) {
      m = halt.anteil
      ende = false
      zeige = erste
      restS = erste.dauerS
      folge = halt.fotos.slice(1)
    }
  }

  return { stand: { marke: m, tempo: stand.tempo, restS, folge }, vorher: alt, zeige, ende }
}

/**
 * Wo in der Datei setzt ein Musik-Bereich ein, wenn man mitten in ihm startet?
 *
 * Nicht bei 0: Wer bei der Hälfte des Bereichs einsteigt, soll hören, was dort
 * im fertigen Film liefe. Die Animationszeit seit Bereichsbeginn ist der
 * Versatz; kürzere Dateien laufen im Loop, deshalb der Umbruch. `dauerS` ist
 * erst nach `loadedmetadata` bekannt — ohne sie kommt der rohe Versatz zurück.
 */
export function musikVersatzS(anteil: number, klipVon: number, rate: number, dauerS = 0): number {
  const seit = Math.max(0, (anteil - klipVon) / rate)
  return dauerS > 0 ? seit % dauerS : seit
}

/** Musik-Bereich an einer Position (halboffen [von, bis) wie im Player). */
export function klipBei(musik: readonly MusikKlip[], anteil: number): MusikKlip | null {
  return musik.find((k) => anteil >= k.von && anteil < k.bis) ?? null
}

// — Der Abspieler: rAF-Schleife, Ton und Rückrufe in den Editor —

export interface AbspielerOptionen {
  /** Plan einsammeln — bei jedem Start neu, das Overlay kann sich geändert haben */
  hole: () => Spielplan | null
  /** Marke setzen (Anteil 0..1): bewegt Kopfstrich, Kopf-Uhr und Läufer */
  setzeMarke: (anteil: number) => void
  /** Aufnahme einblenden */
  zeigeFoto: (id: string, dauerS: number) => void
  /** Transportanzeige (Knopf-Symbol, Tempo-Chip) */
  zeigeTempo: (tempo: number) => void
  /** Klang-Marke in der Leiste pulsen lassen */
  pulsKlang?: (index: number) => void
}

export interface Abspieler {
  /** Play ↔ Pause; am Ende angekommen, fängt Play wieder von vorn an */
  umschalten: () => void
  setzeTempo: (tempo: number) => void
  halteAn: () => void
  laeuft: () => boolean
  tempo: () => number
  /** Debug/E2E: welche Musik gerade läuft (das Element hängt nicht im DOM). */
  tonStand: () => { url: string | null; laeuft: boolean }
  /** Alles verstummen und Elemente freigeben (Editor verlassen) */
  schliesse: () => void
}

export function erzeugeAbspieler(optionen: AbspielerOptionen): Abspieler {
  let plan: Spielplan | null = null
  let stand: SpielStand = { ...LEERER_STAND }
  let af: number | null = null
  let letzteTs = 0

  // Das Audio-Element entsteht erst, wenn wirklich Musik gebraucht wird — eine
  // Tour ohne Musikspur soll keins anlegen (und die reine Logik bleibt damit
  // auch ohne Browser prüfbar).
  let musik: HTMLAudioElement | null = null
  let musikUrl: string | null = null

  function holeMusik(): HTMLAudioElement {
    if (!musik) {
      musik = new Audio()
      musik.loop = true
      musik.preload = 'none'
    }
    return musik
  }
  // Laufende Klänge merken, damit Pause sie WIRKLICH verstummen lässt — ein
  // angestoßener Donner klänge sonst nach dem Anhalten sekundenlang weiter.
  let aktiveKlaenge: HTMLAudioElement[] = []

  function stoppeKlaenge(): void {
    musik?.pause()
    musikUrl = null
    for (const a of aktiveKlaenge) {
      a.pause()
      try {
        a.currentTime = 0
      } catch {
        /* manche Formate lassen sich nicht zurückspulen — Pause genügt */
      }
    }
    aktiveKlaenge = []
  }

  function spieleMusik(anteil: number): void {
    // Nur bei normaler Vorwärtsfahrt: im Schnelllauf oder rückwärts klänge sie
    // wie ein durchgedrehter Kassettenrekorder. Der Foto-Halt behält Tempo 1,
    // die Musik trägt also durch ihn hindurch.
    const klip = plan && stand.tempo === 1 ? klipBei(plan.musik, anteil) : null
    if ((klip?.url ?? null) === musikUrl) return
    musikUrl = klip?.url ?? null
    if (!klip || !plan) {
      musik?.pause()
      return
    }
    const el = holeMusik()
    el.src = klip.url
    el.volume = Math.max(0, Math.min(1, klip.lautstaerke))
    const rate = plan.rate
    el.addEventListener(
      'loadedmetadata',
      () => {
        if (!el.duration) return
        try {
          el.currentTime = musikVersatzS(anteil, klip.von, rate, el.duration)
        } catch {
          /* Seek vor dem Puffern kann fehlschlagen — dann läuft sie ab 0 */
        }
      },
      { once: true },
    )
    void el.play().catch(() => {
      /* Autoplay-Sperre: der Play-Knopf ist eine Geste, danach greift es */
    })
  }

  function pruefeKlaenge(vorher: number, nachher: number): void {
    for (const k of plan?.klaenge ?? []) {
      // Dieselbe Regel wie im Player (audiotracks.js): nur beim Vorwärts-
      // Überfahren, und ein Sprung „verbraucht" die Marke lautlos.
      if (!sfxSollFeuern(vorher, nachher, k.anteil, true)) continue
      const a = new Audio(k.url)
      a.volume = Math.max(0, Math.min(1, k.lautstaerke))
      aktiveKlaenge.push(a)
      a.addEventListener('ended', () => {
        aktiveKlaenge = aktiveKlaenge.filter((x) => x !== a)
      })
      void a.play().catch(() => {})
      optionen.pulsKlang?.(k.index)
    }
  }

  function schritt(ts: number): void {
    af = null
    if (!plan) return
    const dtS = letzteTs ? Math.min((ts - letzteTs) / 1000, 0.1) : 0
    letzteTs = ts
    const erg = tick(stand, dtS, plan)
    stand = erg.stand
    if (stand.marke !== erg.vorher) optionen.setzeMarke(stand.marke)
    spieleMusik(stand.marke)
    pruefeKlaenge(erg.vorher, stand.marke)
    if (erg.zeige) optionen.zeigeFoto(erg.zeige.id, erg.zeige.dauerS)
    if (erg.ende) {
      halteAn()
      return
    }
    af = requestAnimationFrame(schritt)
  }

  /**
   * Anhalten heißt: die Schleife WIRKLICH beenden. Nur das Tempo auf 0 zu setzen
   * genügte nicht — der nächste Frame liefe noch, stieße die Musik erneut an,
   * und der Ton spielte nach dem Anhalten weiter.
   */
  function halteAn(): void {
    if (af !== null) cancelAnimationFrame(af)
    af = null
    stand = { ...stand, tempo: 0, restS: 0, folge: [] }
    stoppeKlaenge()
    optionen.zeigeTempo(0)
  }

  function setzeTempo(t: number): void {
    if (t === 0) {
      halteAn()
      return
    }
    const frisch = optionen.hole()
    if (!frisch) return
    plan = frisch
    // Ein Tempowechsel bricht den laufenden Halt ab — wer auf 4× schaltet, will
    // nicht erst das Bild zu Ende betrachten.
    stand = { marke: frisch.marke, tempo: t, restS: 0, folge: [] }
    optionen.zeigeTempo(t)
    if (af === null) {
      letzteTs = 0
      af = requestAnimationFrame(schritt)
    }
  }

  return {
    umschalten: () => {
      if (stand.tempo !== 0) {
        halteAn()
        return
      }
      // Steht der Kopf am Ende, beginnt Play wieder von vorn. Das deckt „zurück
      // an den Anfang" mit ab — ein eigener Stopp-Knopf wäre in einer
      // scrub-basierten Leiste nicht selbsterklärend („Stopp" ≠ „Pause"?).
      if ((optionen.hole()?.marke ?? 0) >= 0.999) optionen.setzeMarke(0)
      setzeTempo(1)
    },
    setzeTempo,
    halteAn,
    laeuft: () => stand.tempo !== 0,
    tempo: () => stand.tempo,
    tonStand: () => ({ url: musikUrl, laeuft: !!musik && !musik.paused }),
    schliesse: () => {
      halteAn()
      musik?.removeAttribute('src')
      musik = null
      plan = null
    },
  }
}
