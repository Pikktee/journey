// Die RECHENREGELN der 3D-Foto-Pins — DOM-frei, GL-frei, unter Vitest getestet.
// [photopins.js](photopins.js) enthält nur noch Three.js- und MapLibre-Verdrahtung; alles,
// was man ohne Karte prüfen kann (Zustände, Detailstufen-Fenster, Blende, Maßstab), liegt
// hier. Dieselbe Arbeitsteilung wie im Studio (editmodell.ts / editor.ts).

/** Fortschritts-Zustand eines Foto-Stopps — Sprache der Timeline und der 2D-Layer. */
export type PinZustand = 'kommend' | 'naechster' | 'besucht'

/** Fenster der Detailstufe: wie viele Stopps vor/hinter dem nächsten voll dargestellt werden. */
export interface Fenster {
  vor: number
  zurueck: number
}

/**
 * „Besucht" ab ERREICHEN mit kleinem Vorlauf (Default 20 m), damit es mit dem Einblenden
 * der Foto-Karte zusammenfällt. Erwartet aufsteigend sortierte Streckenmeter.
 */
export function naechsterIndex(sWerte: readonly number[], s: number, vorlauf = 20): number {
  const i = sWerte.findIndex((wert) => wert > s + vorlauf)
  return i === -1 ? sWerte.length : i // alles besucht → hinter dem letzten Stopp
}

/** Zustand je Stopp: alles bis `s` besucht, der erste offene ist der nächste. */
export function zustaende(sWerte: readonly number[], s: number, vorlauf = 20): PinZustand[] {
  const naechster = naechsterIndex(sWerte, s, vorlauf)
  return sWerte.map((_, i) => (i < naechster ? 'besucht' : i === naechster ? 'naechster' : 'kommend'))
}

/**
 * Zielstufe je Stopp: 1 = voller Pin (Bodenpunkt · Mast · Kopf), 0 = flacher Bodenpunkt.
 * Voll steht nur, worum es gerade geht — das begrenzt die Draws auf dem Handy (dort kostete
 * das Querformat mit vier Pins doppelt so viel CPU wie das Hochformat mit einem) und hält
 * das Bild ruhig (fünf Masten auf 390 px Breite sind ein Zaun).
 */
export function stufenZiele(anzahl: number, naechsterIdx: number, fenster: Fenster): number[] {
  const ziele: number[] = []
  for (let i = 0; i < anzahl; i++) {
    ziele.push(i >= naechsterIdx - fenster.zurueck && i < naechsterIdx + fenster.vor ? 1 : 0)
  }
  return ziele
}

/**
 * Ein Schritt der Detailstufen-Blende (exponentiell, wie die Smooth-Filter der Kamera).
 * Rastet am Ziel ein, damit `stufe === ziel` als „fertig" abfragbar bleibt und die
 * Repaint-Anforderung endet.
 */
export function blendeSchritt(stufe: number, ziel: number, rate: number): number {
  if (stufe === ziel) return ziel
  const naechste = stufe + (ziel - stufe) * rate
  return Math.abs(ziel - naechste) < 0.004 ? ziel : naechste
}

/**
 * Bildschirmmaß → Weltmaß in Metern. Geometrisches Mittel aus „bildschirmstabil"
 * (px / pxProM — Verhalten der alten 2D-Kreise, kein Tiefeneindruck) und „weltfest"
 * (Größe bei Referenzdistanz — ferne Pins verschwinden), gewichtet über `perspektive`.
 * Anschließend in PIXELN geklemmt, damit weder der Intro-Anflug noch der Foto-Orbit das
 * Bild sprengt.
 *
 * @param px         Sollmaß in CSS-Pixeln bei Referenzdistanz
 * @param pxProM     Pixel je Meter am Fußpunkt (aus der Projektionsmatrix gemessen)
 * @param pxRef      Pixel je Meter bei der Referenzdistanz
 * @param perspektive 1 = bildschirmstabil, 0 = echte Weltgröße
 */
export function weltGroesse(
  px: number,
  pxProM: number,
  pxRef: number,
  perspektive: number,
  pxMin: number,
  pxMax: number,
): number {
  const g = Math.pow(px / pxProM, perspektive) * Math.pow(px / pxRef, 1 - perspektive)
  return Math.min(px * pxMax, Math.max(px * pxMin, g * pxProM)) / pxProM
}

/**
 * Liegt der Punkt (NDC + Clip-w) im Bild? Mit Rand, weil ein Pin am Bildrand noch mit
 * halbem Kopf hereinragen darf. Three cullt hier nicht selbst — die Kamera trägt nur die
 * Projektionsmatrix von MapLibre, kein Frustum.
 */
export function imBild(x: number, y: number, w: number, rand = 1.25, randY = 1.6): boolean {
  return w > 0 && Math.abs(x) < rand && y > -randY && y < randY
}
