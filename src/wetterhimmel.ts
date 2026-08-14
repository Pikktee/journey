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
export const WETTER_HIMMEL: Record<SzenenWetter, { c0: number; c1: number; dark: number; fog: number }> = {
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
export function himmelBei(modus: SzenenWetter, k: number): { cover: number; dark: number; fog: number } {
  const b = WETTER_HIMMEL[modus] ?? WETTER_HIMMEL.off
  const t = Math.max(0, Math.min(1, (k - 0.4) / 0.6))
  return {
    cover: b.c0 + (b.c1 - b.c0) * t,
    dark: b.dark * (0.4 + 0.6 * k),
    fog: b.fog * (0.35 + 0.65 * k),
  }
}

/**
 * Der Farbton, den eine Lage über die Szene legt — aus den `wash`-Farben der
 * Partikel-Profile (weather.ts), damit ein Regen im Editor denselben kühlen
 * Blaugrau-Stich hat wie im Player.
 *
 * `clouds` und `fog` haben dort KEIN Profil (ihren Himmel zeichnet die
 * Atmosphäre) — genau deshalb blieb die Editor-Karte bei ihnen erst leer. Ihre
 * Farbe steht hier, und zwar in derselben Sprache: Wolken grau, Nebel fast
 * weiß mit einem Hauch Blau.
 */
const SCHLEIER_FARBE: Record<SzenenWetter, [number, number, number]> = {
  off: [0, 0, 0],
  clouds: [148, 158, 172],
  fog: [206, 214, 224],
  rain: [120, 138, 164],
  snow: [214, 222, 233],
  storm: [104, 122, 146],
}

/** Wie tief die Lage die Szene absäuft — die `dark`-Farben aus weather.ts. */
const SCHATTEN_FARBE: Record<SzenenWetter, [number, number, number]> = {
  off: [0, 0, 0],
  clouds: [18, 22, 32],
  fog: [30, 34, 42],
  rain: [12, 16, 24],
  snow: [26, 30, 40],
  storm: [8, 11, 18],
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
  const h = himmelBei(modus, k)
  const [wr, wg, wb] = SCHLEIER_FARBE[modus]
  const [sr, sg, sb] = SCHATTEN_FARBE[modus]
  // SKALIERT, nicht gedeckelt. Ein `Math.min` stand hier zuerst und war ein
  // Fehler: Deckung und Schwere erreichen ihr Maximum schon bei mittlerer
  // Stärke, der Deckel griff also im ganzen oberen Bereich — leichter und
  // starker Regen sahen gleich aus, und die Stärke aus der Wetter-Bahn war
  // wirkungslos. Die Faktoren SIND die Obergrenze: `cover` und `dark` laufen
  // von 0 bis 1 bzw. 0,8, zusammen bleibt der dichteste Fall (Gewitter, volle
  // Stärke) bei 0,36. Darüber liest sich die Karte nicht mehr als
  // Satellitenbild mit Wetter, sondern als milchige Scheibe — im Player rettet
  // das die Bewegung der Tropfen, hier arbeitet man unter dem Schleier weiter.
  const waschA = 0.22 * h.cover
  const schattenA = 0.18 * h.dark
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
