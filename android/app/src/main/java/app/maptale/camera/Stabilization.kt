// Welcher Weg der Bildstabilisierung gebunden wird. CameraX kennt zwei, und sie
// sind NICHT austauschbar:
//
//   VORSCHAU  — setPreviewStabilizationEnabled am Preview. Stabilisiert Vorschau
//               UND Video zugleich (Android 13+), das Sucherbild zeigt also, was
//               aufgenommen wird. Der bevorzugte Weg.
//   NUR_VIDEO — setVideoStabilizationEnabled am VideoCapture. Fällt nur an, wo
//               der erste Weg fehlt: dann ist der Bildausschnitt der Aufnahme
//               enger als der der Vorschau — man rahmt etwas anderes, als man
//               aufnimmt. Besser als ein verwackeltes Video, aber nicht gut.
//
// Zwei Regeln, die man leicht übersieht: Beide DÜRFEN nur eingeschaltet werden,
// wenn das Objektiv sie meldet (die HAL quittiert es sonst mit einem Fehler,
// nicht mit stillem Ignorieren) — und im FOTO-Modus bleibt beides aus, weil eine
// stabilisierte Vorschau beschnitten ist, das Foto aus dem ImageCapture aber
// nicht: das Bild zeigte dann mehr, als im Sucher stand.
//
// Reine Entscheidung, ohne CameraX-Typen, damit sie testbar ist.
package app.maptale.camera

/** Der zu bindende Stabilisierungsweg. */
enum class Stabilization { NONE, PREVIEW, VIDEO_ONLY }

/**
 * Was gebunden wird — aus der Betriebsart und dem, was das gewählte Objektiv
 * kann. Beide Fähigkeiten hängen am Objektiv und gelten nach einem Kamerawechsel
 * neu, deshalb wird das pro Bindung entschieden und nicht einmal beim Start.
 */
fun chooseStabilization(
    fuerVideo: Boolean,
    vorschauMoeglich: Boolean,
    videoMoeglich: Boolean,
): Stabilization = when {
    !fuerVideo -> Stabilization.NONE
    vorschauMoeglich -> Stabilization.PREVIEW
    videoMoeglich -> Stabilization.VIDEO_ONLY
    else -> Stabilization.NONE
}
