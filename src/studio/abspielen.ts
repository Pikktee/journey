// Wiedergabe in der Zeitleiste: der Abspielkopf läuft, Musik und Klänge
// erklingen, an jedem Halt blendet die Aufnahme auf.
//
// Das ist bewusst KEIN zweiter Player — die 3D-Kamerafahrt bleibt dem echten
// Player vorbehalten (Knopf „Vorschau"). Hier geht es darum, den SCHNITT zu
// prüfen: Kommt die Musik zum Strandabschnitt? Reißt der Halt am Gipfel die
// Fahrt auseinander? Dafür genügen Kopf, Ton und Bild.
//
// Gerechnet wird in ANTEILEN 0..1 der Zeitleisten-Achse — derselben Größe, in
// der die ganze Leiste denkt. Wie schnell die Marke darüberläuft, sagt die
// FILMKURVE (zeitleiste.ts): je Achsenstück so viel Zeit, wie der fertige
// Film dort braucht. Eine konstante Rate hing hier minutenlang in realen
// Pausen — die haben viel Aufnahmezeit, aber keine Strecke, und der Film
// fährt nach Strecke.
//
// Foto-Halte sind seit der Filmzeit-Achse ACHSENBREITE (die Standzeit steckt
// als Sprung in der Achse): die Marke läuft gleichmäßig durch den Halt
// hindurch. WELCHE Aufnahme dabei zu sehen ist, entscheidet dieses Modul NICHT
// mehr — das ist eine Funktion der Kopfposition (`haltBeiFilmS`), und der
// Editor wertet sie bei jeder Kopfbewegung aus. Als Überfahr-MARKE gedacht
// (der Abspieler stieß die Einblendung an, ein Timer nahm sie zurück) hatte sie
// zwei Fehler, die derselbe Satz erklärt: Sie hing nicht am Kopf, sondern an
// einer Uhr — beim Scrubben erschien gar kein Bild, und beim Abspielen ging es
// 0,8 s zu früh (der Timer lief über die Standzeit, der Klip aber über
// Standzeit + Ausblendung).
//
// Reine Logik (tick, musikVersatzS) ist DOM-frei und unter Vitest getestet; das
// Modul wird erst beim ersten Play geladen (editor.ts), damit die Audio-Elemente
// niemanden belasten, der nur schneidet.

import { alsHuelle, sfxSollFeuern, videoMusikDuck, type DuckPegel } from '../audiotracks.js'
import { anteilBei, filmBei, type Filmkurve } from './zeitleiste.js'

/** Musik-Bereich auf der Zeitachse. */
export interface MusikKlip {
  von: number
  bis: number
  url: string
  lautstaerke: number
  /** Einstieg in die DATEI (s, linker Trim); fehlt = Dateianfang */
  einstiegS?: number
  /** Wiederholung über das Dateiende hinaus; fehlt = ja (das alte Verhalten) */
  loop?: boolean
}

/** Klang, der beim Überfahren einmal auslöst. */
export interface KlangMarke {
  /** Index im Overlay-Array — der Editor lässt seine Marke damit pulsen */
  index: number
  anteil: number
  url: string
  lautstaerke: number
  /** Einstieg in die DATEI (s, linker Trim); fehlt = Dateianfang */
  einstiegS?: number
}

/** Alles, was eine Wiedergabe braucht — beim Start einmal eingesammelt. */
export interface Spielplan {
  /** Startposition (Anteil 0..1) */
  marke: number
  /** Achsen-Anteil ↔ Filmsekunden der Wiedergabe (zeitleiste.ts, baueSpielKurve) */
  kurve: Filmkurve
  musik: MusikKlip[]
  klaenge: KlangMarke[]
}

/** Laufender Zustand der Wiedergabe. */
export interface SpielStand {
  marke: number
  /** 0 = angehalten, 1 = normal, ±2/±4 = Schnelllauf (J/L wie in Final Cut) */
  tempo: number
}

/** Ergebnis eines Schritts. */
export interface Schritt {
  stand: SpielStand
  /** Marke VOR dem Schritt — die Kante, an der Klänge auslösen */
  vorher: number
  /** Streckenende in Laufrichtung erreicht */
  ende: boolean
}

export const LEERER_STAND: SpielStand = { marke: 0, tempo: 0 }

/**
 * Ein Zeitschritt der Wiedergabe — rein, ohne Uhr und ohne DOM.
 *
 * Eine Feinheit, die sich im Mockup erst nach Fehlern ergab: Das Ende gilt
 * RICHTUNGSABHÄNGIG. Prüfte man beide Ränder, hielte ein Start bei Marke 0
 * sofort wieder an — der erste Frame hat dt = 0, die Marke bleibt 0 und träfe
 * die Bedingung „≤ 0".
 */
export function tick(stand: SpielStand, dtS: number, plan: Spielplan): Schritt {
  const alt = stand.marke
  let m = anteilBei(plan.kurve, filmBei(plan.kurve, alt) + stand.tempo * dtS)
  // Richtungsklemme: Steht die Marke MITTEN in einem Plateau (dorthin
  // gescrubbt), liefert der Roundtrip den Plateau-Anfang — vorwärts darf sie
  // dadurch nie zurückspringen (erster Frame hat dt = 0), rückwärts nie vor.
  if (stand.tempo > 0) m = Math.max(alt, m)
  else if (stand.tempo < 0) m = Math.min(alt, m)
  let ende = false
  if (stand.tempo > 0 && m >= 1) {
    m = 1
    ende = true
  } else if (stand.tempo < 0 && m <= 0) {
    m = 0
    ende = true
  }

  return { stand: { marke: m, tempo: stand.tempo }, vorher: alt, ende }
}

/**
 * Wo in der Datei setzt ein Musik-Bereich ein, wenn man mitten in ihm startet?
 *
 * Nicht bei 0: Wer bei der Hälfte des Bereichs einsteigt, soll hören, was dort
 * im fertigen Film liefe. Die FILMzeit seit Bereichsbeginn ist der Versatz
 * (über die Kurve — eine reale Pause im Bereich zählt nicht als Spielzeit);
 * kürzere Dateien laufen im Loop, deshalb der Umbruch. `dauerS` ist erst nach
 * `loadedmetadata` bekannt — ohne sie kommt der rohe Versatz zurück.
 *
 * `einstiegS` (linker Trim) verschiebt den Nullpunkt IN der Datei. Der Modulo
 * läuft danach über die GANZE Datei, nicht über den Rest hinter dem Einstieg —
 * denn genau das tut `el.loop`: Es springt am Dateiende auf Position 0 zurück.
 * Loop hebt nur den RECHTEN Anschlag auf; eine Wiederholung VOR dem Dateianfang
 * gibt es nicht (docs §2E — der erste Wurf ließ den Versatz modulo in die Datei
 * wandern, das Stück setzte dann mitten drin ein).
 */
export function musikVersatzS(
  anteil: number,
  klipVon: number,
  kurve: Filmkurve,
  dauerS = 0,
  einstiegS = 0,
  loop = true,
): number {
  const seit = Math.max(0, filmBei(kurve, anteil) - filmBei(kurve, klipVon))
  const roh = Math.max(0, einstiegS) + seit
  if (!(dauerS > 0)) return roh
  // Ohne Loop endet der Klip am Material: die Position bleibt am Dateiende
  // stehen (das Element ist dann `ended` und schweigt), statt vorn neu zu beginnen.
  return loop ? roh % dauerS : Math.min(roh, dauerS)
}

/**
 * ALLE Musik-Bereiche an einer Position (halboffen [von, bis) wie im Player),
 * als Indizes in den Plan. Überlappende Bereiche mischen sich im fertigen Film
 * (audiotracks.js spielt je Spur ein eigenes Element) — die Schnittprüfung
 * muss dasselbe hören, sonst prüft sie einen anderen Film. Indizes statt
 * Klips, weil zwei Bereiche dieselbe Datei tragen können: die Identität ist
 * der Platz im Plan, nicht die URL.
 */
export function klipsBei(musik: readonly MusikKlip[], anteil: number): number[] {
  const indizes: number[] = []
  musik.forEach((k, i) => {
    if (anteil >= k.von && anteil < k.bis) indizes.push(i)
  })
  return indizes
}

// — Der Abspieler: rAF-Schleife, Ton und Rückrufe in den Editor —

export interface AbspielerOptionen {
  /** Plan einsammeln — bei jedem Start neu, das Overlay kann sich geändert haben */
  hole: () => Spielplan | null
  /** Marke setzen (Anteil 0..1): bewegt Kopfstrich, Kopf-Uhr und Läufer — und
   *  damit auch die Foto-Einblendung, die an der Kopfposition hängt. */
  setzeMarke: (anteil: number) => void
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
  /** Debug/E2E: welche Musik gerade läuft (die Elemente hängen nicht im DOM).
   *  `urls` listet ALLE laufenden Spuren — bei Überlappung mehr als eine. */
  tonStand: () => { url: string | null; laeuft: boolean; urls: string[] }
  /**
   * Video-Ton-Hülle 0..1 → Musik ducken, wie `AudioSpuren.setDucking` im Player.
   * Ohne sie liefe die Filmmusik im Editor unter dem Ton der Aufnahme ungedämpft
   * weiter — der Schnitt klänge anders als der Film, und genau das soll das
   * Abspielen prüfen. SFX werden wie im Player NICHT gedämpft: Ein Effekt, der
   * zur Szene gehört, soll nicht unter deren eigenem Ton wegtauchen.
   */
  setzeDucking: (pegel: DuckPegel) => void
  /** Alles verstummen und Elemente freigeben (Editor verlassen) */
  schliesse: () => void
}

export function erzeugeAbspieler(optionen: AbspielerOptionen): Abspieler {
  let plan: Spielplan | null = null
  let stand: SpielStand = { ...LEERER_STAND }
  let af: number | null = null
  let letzteTs = 0

  // Je Musik-Klip (Index im Plan) ein EIGENES Element — überlappende Bereiche
  // mischen sich damit wie im fertigen Film, statt einander zu verdrängen.
  // Elemente entstehen erst beim ersten Eintritt in ihren Bereich; eine Tour
  // ohne Musikspur legt keins an (die reine Logik bleibt ohne Browser prüfbar).
  let musikElemente = new Map<number, HTMLAudioElement>()

  // Laufende Klänge merken, damit Pause sie WIRKLICH verstummen lässt — ein
  // angestoßener Donner klänge sonst nach dem Anhalten sekundenlang weiter.
  let aktiveKlaenge: HTMLAudioElement[] = []

  // Musik-Dämpfung unter laufendem Video-Ton (1 = ungedämpft). Anders als im
  // Player ohne Glättung: Dort läuft ein eigener 60-ms-Timer, hier kommt der
  // Wert aus `synchronisiereBild` — also aus jedem Kopfschritt, und die Hülle
  // selbst ist schon die weiche Blende (videoTonHuelle über VIDEO_FADE_S).
  let duck = 1

  /** Pegel eines Klips inklusive Dämpfung — die EINE Stelle, die el.volume rechnet. */
  const pegel = (klip: MusikKlip): number => Math.max(0, Math.min(1, klip.lautstaerke * duck))

  function stoppeKlaenge(): void {
    for (const el of musikElemente.values()) el.pause()
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
    const aktiv = plan && stand.tempo === 1 ? klipsBei(plan.musik, anteil) : []
    const aktivSet = new Set(aktiv)
    // Verlassene Bereiche verstummen; die Position bleibt stehen (Weiterlaufen
    // im Bereich seekt unten ohnehin auf die Film-Position).
    for (const [i, el] of musikElemente) {
      if (!aktivSet.has(i) && !el.paused) el.pause()
    }
    if (!plan) return
    for (const i of aktiv) {
      const klip = plan.musik[i]
      if (!klip) continue
      let el = musikElemente.get(i)
      // Der Eintrag kann sich geändert haben, seit das Element entstand — die
      // Elemente überleben Pause und Neustart, der Plan wird bei jedem Start
      // frisch geholt. Ein getauschtes Stück braucht ein neues Element,
      // Lautstärke und Loop werden schlicht nachgezogen: Sonst klang der Klip
      // für den Rest der Sitzung mit dem Wert, den er beim ersten Play hatte
      // (am Regler hörte man die Änderung, im Abspielen nicht).
      if (el && el.dataset['url'] !== klip.url) {
        el.pause()
        el.removeAttribute('src')
        musikElemente.delete(i)
        el = undefined
      }
      if (el) {
        el.volume = pegel(klip)
        el.loop = klip.loop ?? true
      }
      if (!el) {
        el = new Audio()
        el.loop = klip.loop ?? true
        el.preload = 'none'
        el.src = klip.url
        el.dataset['url'] = klip.url // `el.src` ist absolut aufgelöst, der Plan trägt den rohen Verweis
        el.volume = pegel(klip)
        const kurve = plan.kurve
        const beiEintritt = anteil
        el.addEventListener(
          'loadedmetadata',
          () => {
            if (!el || !el.duration) return
            try {
              el.currentTime = musikVersatzS(beiEintritt, klip.von, kurve, el.duration, klip.einstiegS, el.loop)
            } catch {
              /* Seek vor dem Puffern kann fehlschlagen — dann läuft sie ab 0 */
            }
          },
          { once: true },
        )
        musikElemente.set(i, el)
        void el.play().catch(() => {
          /* Autoplay-Sperre: der Play-Knopf ist eine Geste, danach greift es */
        })
      } else if (el.paused) {
        // Wiedereintritt oder Weiterlaufen nach Pause: auf die Stelle seeken,
        // die im Film JETZT liefe — ohne die Datei neu zu laden.
        if (el.duration) {
          try {
            el.currentTime = musikVersatzS(anteil, klip.von, plan.kurve, el.duration, klip.einstiegS, el.loop)
          } catch {
            /* s. o. */
          }
        }
        // Ohne Loop ist eine durchgelaufene Datei fertig — play() finge sonst
        // wieder bei 0 an und der Klip klänge endlos.
        if (!el.ended) void el.play().catch(() => {})
      }
    }
  }

  function pruefeKlaenge(vorher: number, nachher: number): void {
    for (const k of plan?.klaenge ?? []) {
      // Dieselbe Regel wie im Player (audiotracks.js): nur beim Vorwärts-
      // Überfahren, und ein Sprung „verbraucht" die Marke lautlos.
      if (!sfxSollFeuern(vorher, nachher, k.anteil, true)) continue
      const a = new Audio(k.url)
      a.volume = Math.max(0, Math.min(1, k.lautstaerke))
      if (k.einstiegS) a.currentTime = k.einstiegS // linker Trim gilt auch beim One-Shot
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
    stand = { ...stand, tempo: 0 }
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
    stand = { marke: frisch.marke, tempo: t }
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
    tonStand: () => {
      const laufende = [...musikElemente.values()].filter((el) => !el.paused)
      return { url: laufende[0]?.src ?? null, laeuft: laufende.length > 0, urls: laufende.map((el) => el.src) }
    },
    setzeDucking: (p: DuckPegel) => {
      const neu = videoMusikDuck(alsHuelle(p))
      if (neu === duck) return
      duck = neu
      // Laufende Elemente sofort nachziehen: Der nächste `spieleMusik`-Durchlauf
      // käme erst beim nächsten Frame, und ohne laufende Wiedergabe (Scrubben
      // durch ein Video) gar nicht — die Dämpfung bliebe dann stehen.
      if (!plan) return
      for (const [i, el] of musikElemente) {
        const klip = plan.musik[i]
        if (klip) el.volume = pegel(klip)
      }
    },
    schliesse: () => {
      halteAn()
      for (const el of musikElemente.values()) el.removeAttribute('src')
      musikElemente = new Map()
      plan = null
    },
  }
}
