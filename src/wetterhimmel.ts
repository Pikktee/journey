// Wie Wetter die SZENE einfärbt — die Regel, die Player und Editor teilen.
//
// Der Player zeigt Wetter auf drei Wegen: fallende Partikel (weather.ts), einen
// bedeckten Himmel samt Dunst (atmosphere.ts) und eine Schneedecke auf dem
// Satellitenbild (daynight.ts `setSnow`). Der ERSTE Weg ist der einzige, der
// sich nicht teilen lässt: Ein Partikelsystem ist Zustand — jeder Tropfen wird
// aus dem vorigen Bild fortgeschrieben —, und der Editor braucht das Gegenteil,
// eine Funktion von der Kopfposition aufs Bild, die auch rückwärts und nach
// einem Sprung stimmt.
//
// Die beiden anderen sind Funktionen und liegen deshalb hier. Der Editor baut
// daraus einen flachen Schleier über der Karte (Konzept §10: „ein Paint je
// Änderung statt einer dauerhaften rAF-Schleife"), der Player gibt dieselben
// Zahlen an Atmosphäre und Grading. Was der Editor nicht zeigt, sind die
// Tropfen — dass es regnet und wie stark, sagt der Schleier.

/** Die Wetterlagen der Szene. Spiegel von `WETTER_MODI` (studio/editmodell.ts). */
export type SzenenWetter = 'off' | 'clouds' | 'fog' | 'rain' | 'snow' | 'storm'

/**
 * Himmel je Wetterlage: `c0`/`c1` spannen die Wolkendeckung über die Stärke,
 * `dark` ist die Schwere der Wolken, `fog` der Nebelanteil.
 *
 * Bewusst starten die NIEDERSCHLAGS-Lagen schon bedeckt (`c0` ≥ 0,62): Auch
 * leichter Regen fällt nicht aus heiterem Himmel. `clouds` beginnt dagegen bei
 * 0,28 — eine leichte Bewölkung lässt die Sonne stehen.
 */
export const WETTER_HIMMEL: Record<
  SzenenWetter,
  { c0: number; c1: number; dark: number; fog: number }
> = {
  off: { c0: 0, c1: 0, dark: 0, fog: 0 },
  clouds: { c0: 0.28, c1: 0.98, dark: 0.34, fog: 0 },
  fog: { c0: 0.22, c1: 0.45, dark: 0.2, fog: 1 },
  rain: { c0: 0.72, c1: 1, dark: 0.55, fog: 0.16 },
  snow: { c0: 0.62, c1: 0.96, dark: 0.3, fog: 0.4 },
  storm: { c0: 0.88, c1: 1, dark: 0.8, fog: 0.12 },
}

/**
 * Deckung, Schwere und Nebel an einer Stärke `k` (0..1).
 *
 * Im Player läuft `k` über die drei Stufen 0,4/0,7/1 (Leicht/Mittel/Stark);
 * darunter — beim stufenlosen Echtwetter — bleibt die Deckung am unteren Ende
 * der Spanne, statt unter sie zu fallen.
 */
export function himmelBei(
  modus: SzenenWetter,
  k: number,
): { cover: number; dark: number; fog: number } {
  const b = WETTER_HIMMEL[modus] ?? WETTER_HIMMEL.off
  const t = Math.max(0, Math.min(1, (k - 0.4) / 0.6))
  return {
    cover: b.c0 + (b.c1 - b.c0) * t,
    dark: b.dark * (0.4 + 0.6 * k),
    fog: b.fog * (0.35 + 0.65 * k),
  }
}

/**
 * Der CHARAKTER einer Lage: welche Farbe sie über die Szene legt, wie dicht,
 * und wie tief sie sie absäuft.
 *
 * Die Farbtöne stammen aus den `wash`/`dark`-Werten der Partikel-Profile
 * (weather.ts), damit ein Regen im Editor denselben kühlen Blaugrau-Stich hat
 * wie im Player; `clouds` und `fog` haben dort kein Profil (ihren Himmel
 * zeichnet die Atmosphäre) und bekommen ihre Farbe hier.
 *
 * **Die Dichten sind je Lage verschieden, und das ist der Punkt.** Sie einmal
 * aus `cover`/`dark` zu skalieren war ein Fehler: Deckung und Schwere laufen
 * bei fast allen Lagen gegen dasselbe Maximum, und dann sehen sie bei voller
 * Stärke gleich aus — gemessen lagen alle fünf zwischen rgb(94) und rgb(126),
 * Wolken und Nebel trennten 9 von 765 möglichen Stufen. Zwei Lagen, die man
 * nicht unterscheiden kann, sind keine zwei Lagen.
 *
 * Was sie unterscheidet, ist ihr Wesen: **Nebel VERSCHLUCKT** (dicht und hell,
 * die Landschaft verschwindet), **Wolken DÄMPFEN** (dünn und neutral, es bleibt
 * alles zu sehen), **Regen KÜHLT AB** (blaugrau, spürbar dunkler), **Schnee
 * HELLT AUF** (dazu die weiße Decke am Boden), **Gewitter VERDUNKELT** (der
 * Himmel steht tief).
 */
const CHARAKTER: Record<
  SzenenWetter,
  {
    wasch: [number, number, number]
    waschMax: number
    schatten: [number, number, number]
    schattenMax: number
  }
> = {
  off: { wasch: [0, 0, 0], waschMax: 0, schatten: [0, 0, 0], schattenMax: 0 },
  // Dünn: die Dämpfung macht das Grading, hier nur ein Hauch Grau.
  clouds: { wasch: [152, 160, 172], waschMax: 0.1, schatten: [18, 22, 32], schattenMax: 0.04 },
  // Die einzige Lage, die auch als Fläche dicht sein muss — Nebel ist das,
  // was die Sicht wirklich nimmt, und das kann kein Sättigungswert allein.
  fog: { wasch: [232, 237, 244], waschMax: 0.42, schatten: [30, 34, 42], schattenMax: 0.03 },
  // Der kühle Blaustich des Regens; dunkel wird es über die Helligkeit.
  rain: { wasch: [108, 128, 158], waschMax: 0.16, schatten: [12, 16, 24], schattenMax: 0.08 },
  // Hell — den Rest macht die Schneedecke im Grading, nicht der Schleier.
  snow: { wasch: [226, 232, 242], waschMax: 0.22, schatten: [26, 30, 40], schattenMax: 0.02 },
  // Beim Gewitter trägt die Helligkeit die Last; der Schleier gibt den Ton.
  storm: { wasch: [72, 92, 126], waschMax: 0.26, schatten: [8, 11, 18], schattenMax: 0.16 },
}

/**
 * Wie eine Lage das BILD selbst verändert — Helligkeit als Faktor, Sättigung
 * als Abzug.
 *
 * Der Schleier allein reicht nicht, und das ließ sich messen: Über der echten
 * (dunklen) Satellitenkarte hob ein wolkengrauer Schleier die mittlere
 * Helligkeit von 94 auf 102 — er HELLTE auf, wo er dämpfen sollte, und Regen
 * lag mit 97 praktisch auf dem Wert ohne Wetter. Eine Fläche darüber kann eben
 * nur zur Farbe hinzufügen; „bedeckt" heißt aber: weniger Licht und weniger
 * Farbe.
 *
 * Das kann das Raster-Grading, und der Player macht es genauso — dort dunkelt
 * die Wolkendecke das Szenenlicht ab. Hier läuft es über dieselben
 * Paint-Werte, auf denen schon die Tageszeit und die Schneedecke liegen.
 */
export interface Wettergrading {
  /** Faktor auf `raster-brightness-max` (1 = unverändert) */
  helligkeit: number
  /** Abzug auf `raster-saturation` (0 = unverändert, negativ entsättigt) */
  saettigung: number
}

const BILD: Record<SzenenWetter, Wettergrading> = {
  off: { helligkeit: 1, saettigung: 0 },
  // Bedeckt: spürbar weniger Licht, die Farben werden flau.
  clouds: { helligkeit: 0.84, saettigung: -0.28 },
  // Nebel nimmt die Farbe fast ganz und hellt dabei auf (Streulicht).
  fog: { helligkeit: 1.04, saettigung: -0.62 },
  // Regen: nass und dunkel, deutlich entsättigt. Der Abstand zu `clouds` ist
  // dabei Absicht und getestet — „bewölkt" und „es regnet" müssen sich auf
  // einen Blick unterscheiden, sonst sagt die Wetter-Bahn mehr als die Karte.
  rain: { helligkeit: 0.7, saettigung: -0.48 },
  // Schnee hellt auf; die weiße Decke selbst kommt aus `schnee` (Grading).
  snow: { helligkeit: 1.06, saettigung: -0.32 },
  // Gewitter: der Himmel steht auf dem Boden. Nicht tiefer — darunter ist die
  // Karte nicht mehr zu bearbeiten, und ein Gewitter ist kein Stromausfall.
  storm: { helligkeit: 0.56, saettigung: -0.62 },
}

/**
 * Grading-Anteil einer Lage bei Stärke `k`. Beide Werte laufen von „keine
 * Wirkung" (Stärke 0) linear auf ihr Maximum bei voller Stärke.
 */
export function bildwirkung(modus: SzenenWetter, k = 0.7): Wettergrading {
  const b = BILD[modus]
  const t = Math.max(0, Math.min(1, k))
  return {
    helligkeit: 1 + (b.helligkeit - 1) * t,
    saettigung: b.saettigung * t,
  }
}

export interface Schleier {
  /** Farbschleier als CSS-Farbe, Deckkraft eingerechnet — '' heißt: keiner */
  wasch: string
  /** Abdunklung darüber, ebenfalls fertig — '' heißt: keine */
  schatten: string
  /** Nebelanteil 0..1 — der Aufrufer legt ihn als weichen Verlauf darüber */
  nebel: number
  /** Schneedecke 0..1 für das Raster-Grading (daynight.ts `rastergrading`) */
  schnee: number
}

/**
 * Eine Wetterlage als flacher Schleier — alles, was ohne Partikel und ohne
 * Horizont darstellbar ist.
 *
 * Die Deckkraft folgt der Wolkendeckung und der Schwere aus `himmelBei`, damit
 * dieselbe Lage in beiden Bühnen gleich schwer wirkt: leichter Regen dünn,
 * Gewitter satt. Die Obergrenzen sind bewusst niedrig — der Schleier soll die
 * Karte färben, nicht sie zudecken; man arbeitet darunter.
 */
export function schleierFuer(modus: SzenenWetter, k = 0.7): Schleier {
  if (modus === 'off') return { wasch: '', schatten: '', nebel: 0, schnee: 0 }
  const c = CHARAKTER[modus]
  const h = himmelBei(modus, k)
  const voll = himmelBei(modus, 1)
  // Die STÄRKE skaliert relativ: Bei voller Stärke gilt genau `waschMax`, bei
  // geringerer entsprechend weniger — so bleibt die Lage erkennbar sie selbst
  // (ein leichter Nebel ist immer noch dichter als ein starker Wolkenhimmel),
  // und die Stärke aus der Wetter-Bahn wirkt trotzdem. Ein absoluter Faktor auf
  // `cover` täte beides nicht: Er nivelliert die Lagen gegeneinander.
  const anteil = (jetzt: number, max: number): number => (max > 0 ? Math.min(1, jetzt / max) : 0)
  const waschA = c.waschMax * anteil(h.cover, voll.cover)
  const schattenA = c.schattenMax * anteil(h.dark, voll.dark)
  const [wr, wg, wb] = c.wasch
  const [sr, sg, sb] = c.schatten
  return {
    wasch: `rgba(${wr}, ${wg}, ${wb}, ${waschA.toFixed(3)})`,
    schatten: `rgba(${sr}, ${sg}, ${sb}, ${schattenA.toFixed(3)})`,
    nebel: h.fog,
    // Nur Schnee legt sich auf den BODEN. Dieselbe Kopplung wie im Player
    // (`dayNight.setSnow`), damit eine Winterfahrt im Editor eine weiße
    // Landschaft zeigt und nicht bloß einen grauen Schleier darüber.
    schnee: modus === 'snow' ? Math.min(1, 0.35 + 0.65 * k) : 0,
  }
}
