// Zoom-Stufen der Kamera-Pille. Welche Stufen es gibt, hängt am Gerät: ein
// Ultraweitwinkel liefert ein Verhältnis unter 1, ein Telemodul eines über 2.
// CameraX meldet nur die Grenzen (zoomState), die Stufen dazwischen sind unsere
// Entscheidung — deshalb reine Logik, ohne CameraX-Typen, damit sie testbar ist.
package app.maptale.camera

import java.util.Locale
import kotlin.math.abs

/** Eine anspringbare Stufe der Zoom-Pille. */
data class ZoomLevel(val ratio: Float, val beschriftung: String)

/** Unterhalb dieses Verhältnisses gilt ein Objektiv als echtes Ultraweitwinkel. */
private const val ULTRAWIDE_LIMIT = 0.95f

/** So nah muss der laufende Zoom an einer Stufe liegen, damit sie als aktiv gilt. */
private const val STUFEN_TOLERANZ = 0.05f

/**
 * Stufen für die Pille: Ultraweitwinkel (nur wenn das Gerät eines hat), Normal,
 * Tele. Mehr Stufen würden die Leiste füllen, ohne etwas zu können — dazwischen
 * liegt ohnehin das stufenlose Kneifen.
 */
fun zoomLevels(minRatio: Float, maxRatio: Float): List<ZoomLevel> {
    val levels = mutableListOf<ZoomLevel>()
    if (minRatio < ULTRAWIDE_LIMIT) levels += ZoomLevel(minRatio, formatZoom(minRatio))
    if (maxRatio >= 1f) levels += ZoomLevel(1f, formatZoom(1f))
    if (maxRatio >= 2f) levels += ZoomLevel(2f, formatZoom(2f))
    return levels
}

/**
 * Index der Stufe, auf der der Zoom gerade steht — oder null beim freien Kneifen
 * dazwischen. Dann zeigt die Pille den echten Wert statt einer Stufe.
 */
fun activeLevel(levels: List<ZoomLevel>, ratio: Float): Int? {
    val naechste = levels.indices.minByOrNull { abs(levels[it].ratio - ratio) } ?: return null
    return naechste.takeIf { abs(levels[it].ratio - ratio) <= STUFEN_TOLERANZ }
}

/** „1×", „0,6×", „1,7×" — glatte Werte ohne Nachkommastelle. */
fun formatZoom(ratio: Float): String {
    val gerundet = Math.round(ratio * 10f) / 10f
    return if (gerundet == gerundet.toInt().toFloat()) "${gerundet.toInt()}×"
    else String.format(Locale.GERMANY, "%.1f×", gerundet)
}
