// Die RECHENREGELN der 3D-Foto-Pins — DOM-frei, GL-frei, unter Vitest getestet.
// [photopins.ts](photopins.ts) enthält nur noch Three.js- und MapLibre-Verdrahtung; alles,
// was man ohne Karte prüfen kann (Zustände, Detailstufen-Fenster, Blende, Maßstab), liegt
// hier. Dieselbe Arbeitsteilung wie im Studio (edit-model.ts / editor.ts).

/** Fortschritts-Zustand eines Foto-Stopps — Sprache der Timeline und der 2D-Layer. */
export type PinState = 'kommend' | 'naechster' | 'besucht'

/** Fenster der Detailstufe: wie viele Stopps vor/hinter dem nächsten voll dargestellt werden. */
export interface PinWindow {
  ahead: number
  behind: number
}

/**
 * „Besucht" ab ERREICHEN mit kleinem Vorlauf (Default 20 m), damit es mit dem Einblenden
 * der Foto-Karte zusammenfällt. Erwartet aufsteigend sortierte Streckenmeter.
 */
export function nextIndex(sValues: readonly number[], s: number, lead = 20): number {
  const i = sValues.findIndex((value) => value > s + lead)
  return i === -1 ? sValues.length : i // alles besucht → hinter dem letzten Stopp
}

/** Zustand je Stopp: alles bis `s` besucht, der erste offene ist der nächste. */
export function pinStates(sValues: readonly number[], s: number, lead = 20): PinState[] {
  const next = nextIndex(sValues, s, lead)
  return sValues.map((_, i) => (i < next ? 'besucht' : i === next ? 'naechster' : 'kommend'))
}

/**
 * Zielstufe je Stopp: 1 = voller Pin (Bodenpunkt · Mast · Kopf), 0 = flacher Bodenpunkt.
 * Voll steht nur, worum es gerade geht — das begrenzt die Draws auf dem Handy (dort kostete
 * das Querformat mit vier Pins doppelt so viel CPU wie das Hochformat mit einem) und hält
 * das Bild ruhig (fünf Masten auf 390 px Breite sind ein Zaun).
 */
export function detailTargets(count: number, nextIdx: number, pinWindow: PinWindow): number[] {
  const targets: number[] = []
  for (let i = 0; i < count; i++) {
    targets.push(i >= nextIdx - pinWindow.behind && i < nextIdx + pinWindow.ahead ? 1 : 0)
  }
  return targets
}

/**
 * Ein Schritt der Detailstufen-Blende (exponentiell, wie die Smooth-Filter der Kamera).
 * Rastet am Ziel ein, damit `stufe === ziel` als „fertig" abfragbar bleibt und die
 * Repaint-Anforderung endet.
 */
export function fadeStep(level: number, target: number, rate: number): number {
  if (level === target) return target
  const stepped = level + (target - level) * rate
  return Math.abs(target - stepped) < 0.004 ? target : stepped
}

/**
 * Bildschirmmaß → Weltmaß in Metern. Geometrisches Mittel aus „bildschirmstabil"
 * (px / pxProM — Verhalten der alten 2D-Kreise, kein Tiefeneindruck) und „weltfest"
 * (Größe bei Referenzdistanz — ferne Pins verschwinden), gewichtet über `perspektive`.
 * Anschließend in PIXELN geklemmt, damit weder der Intro-Anflug noch der Foto-Orbit das
 * Bild sprengt.
 *
 * @param px         Sollmaß in CSS-Pixeln bei Referenzdistanz
 * @param pxPerM     Pixel je Meter am Fußpunkt (aus der Projektionsmatrix gemessen)
 * @param pxRef      Pixel je Meter bei der Referenzdistanz
 * @param perspective 1 = bildschirmstabil, 0 = echte Weltgröße
 */
export function worldSize(
  px: number,
  pxPerM: number,
  pxRef: number,
  perspective: number,
  pxMin: number,
  pxMax: number,
): number {
  const g = Math.pow(px / pxPerM, perspective) * Math.pow(px / pxRef, 1 - perspective)
  return Math.min(px * pxMax, Math.max(px * pxMin, g * pxPerM)) / pxPerM
}

/**
 * Liegt der Punkt (NDC + Clip-w) im Bild? Mit Rand, weil ein Pin am Bildrand noch mit
 * halbem Kopf hereinragen darf. Three cullt hier nicht selbst — die Kamera trägt nur die
 * Projektionsmatrix von MapLibre, kein Frustum.
 */
export function inView(x: number, y: number, w: number, margin = 1.25, marginY = 1.6): boolean {
  return w > 0 && Math.abs(x) < margin && y > -marginY && y < marginY
}
