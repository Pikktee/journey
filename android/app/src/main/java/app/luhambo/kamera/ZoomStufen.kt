// Zoom-Stufen der Kamera-Pille. Welche Stufen es gibt, hängt am Gerät: ein
// Ultraweitwinkel liefert ein Verhältnis unter 1, ein Telemodul eines über 2.
// CameraX meldet nur die Grenzen (zoomState), die Stufen dazwischen sind unsere
// Entscheidung — deshalb reine Logik, ohne CameraX-Typen, damit sie testbar ist.
package app.luhambo.kamera

import java.util.Locale
import kotlin.math.abs

/** Eine anspringbare Stufe der Zoom-Pille. */
data class ZoomStufe(val ratio: Float, val beschriftung: String)

/** Unterhalb dieses Verhältnisses gilt ein Objektiv als echtes Ultraweitwinkel. */
private const val ULTRAWEIT_GRENZE = 0.95f

/** So nah muss der laufende Zoom an einer Stufe liegen, damit sie als aktiv gilt. */
private const val STUFEN_TOLERANZ = 0.05f

/**
 * Stufen für die Pille: Ultraweitwinkel (nur wenn das Gerät eines hat), Normal,
 * Tele. Mehr Stufen würden die Leiste füllen, ohne etwas zu können — dazwischen
 * liegt ohnehin das stufenlose Kneifen.
 */
fun zoomStufen(minRatio: Float, maxRatio: Float): List<ZoomStufe> {
    val stufen = mutableListOf<ZoomStufe>()
    if (minRatio < ULTRAWEIT_GRENZE) stufen += ZoomStufe(minRatio, formatiereZoom(minRatio))
    if (maxRatio >= 1f) stufen += ZoomStufe(1f, formatiereZoom(1f))
    if (maxRatio >= 2f) stufen += ZoomStufe(2f, formatiereZoom(2f))
    return stufen
}

/**
 * Index der Stufe, auf der der Zoom gerade steht — oder null beim freien Kneifen
 * dazwischen. Dann zeigt die Pille den echten Wert statt einer Stufe.
 */
fun aktiveStufe(stufen: List<ZoomStufe>, ratio: Float): Int? {
    val naechste = stufen.indices.minByOrNull { abs(stufen[it].ratio - ratio) } ?: return null
    return naechste.takeIf { abs(stufen[it].ratio - ratio) <= STUFEN_TOLERANZ }
}

/** „1×", „0,6×", „1,7×" — glatte Werte ohne Nachkommastelle. */
fun formatiereZoom(ratio: Float): String {
    val gerundet = Math.round(ratio * 10f) / 10f
    return if (gerundet == gerundet.toInt().toFloat()) "${gerundet.toInt()}×"
    else String.format(Locale.GERMANY, "%.1f×", gerundet)
}
