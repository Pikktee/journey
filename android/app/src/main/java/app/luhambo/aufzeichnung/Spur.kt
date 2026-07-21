// Die mitwachsende Linie der laufenden Aufzeichnung — reine Mathematik, ohne
// Android-Bezug und damit direkt testbar.
//
// Bewusst KEINE Karte: Ein Kartenrenderer samt Kachel-Downloads liefe hier
// stundenlang neben der Aufzeichnung her und wäre genau das, was den Akku
// leert. Gezeichnet wird nur der Weg selbst — die Form genügt, um zu sehen,
// dass aufgezeichnet wird und dass es plausibel aussieht.
package app.luhambo.aufzeichnung

import kotlin.math.cos

/** Ein Stützpunkt der Skizze (nur Ort, keine Zeit — mehr braucht die Linie nicht). */
data class Spurpunkt(val lng: Double, val lat: Double)

/** Ein Punkt in Bildkoordinaten; getrennt von Compose, damit Tests ohne UI laufen. */
data class Bildpunkt(val x: Float, val y: Float)

/** Mehr Stützpunkte kann eine Skizze in Daumengröße ohnehin nicht zeigen. */
const val SPUR_HOECHSTZAHL = 600

/**
 * Punkt anhängen und die Liste dabei gedeckelt halten.
 *
 * Ist die Höchstzahl erreicht, wird jeder zweite Punkt verworfen — die Linie
 * behält ihre Form, braucht aber wieder nur halb so viel Platz und kann erneut
 * wachsen. Auf einer Tagestour bleibt der Speicherbedarf so konstant, statt mit
 * jeder Stunde zu steigen.
 */
fun ergaenzeSpur(
    bisher: List<Spurpunkt>,
    neu: Spurpunkt,
    hoechstzahl: Int = SPUR_HOECHSTZAHL,
): List<Spurpunkt> {
    val liste = if (bisher.size >= hoechstzahl) bisher.filterIndexed { i, _ -> i % 2 == 0 } else bisher
    return liste + neu
}

/**
 * Die Spur auf eine Zeichenfläche legen: mittig, formtreu, mit Rand.
 *
 * Längengrade werden mit dem Kosinus der Breite gestaucht — ohne das wäre eine
 * Nord-Süd-Runde in Frankfurt um ein Drittel zu breit, weil ein Grad Länge dort
 * nur etwa zwei Drittel eines Grades Breite misst. Die Skizze soll die Form des
 * Weges zeigen, nicht die eines verzerrten Gitternetzes.
 */
fun projiziereSpur(
    punkte: List<Spurpunkt>,
    breite: Float,
    hoehe: Float,
    rand: Float = 0f,
): List<Bildpunkt> {
    if (punkte.isEmpty() || breite <= 0f || hoehe <= 0f) return emptyList()

    val mittlereBreite = punkte.sumOf { it.lat } / punkte.size
    val kosinus = cos(Math.toRadians(mittlereBreite)).coerceAtLeast(0.01)
    val xs = punkte.map { it.lng * kosinus }
    val ys = punkte.map { it.lat }

    val xMin = xs.min(); val xMax = xs.max()
    val yMin = ys.min(); val yMax = ys.max()
    val spanneX = (xMax - xMin).coerceAtLeast(1e-9)
    val spanneY = (yMax - yMin).coerceAtLeast(1e-9)

    val nutzbarX = (breite - 2 * rand).coerceAtLeast(1f)
    val nutzbarY = (hoehe - 2 * rand).coerceAtLeast(1f)
    // Ein gemeinsamer Maßstab für beide Achsen erhält die Form; der kleinere
    // von beiden sorgt dafür, dass die Spur ganz hineinpasst.
    val massstab = minOf(nutzbarX / spanneX, nutzbarY / spanneY)

    // Rest gleichmäßig auf beide Seiten — die Zeichnung sitzt mittig
    val versatzX = rand + (nutzbarX - spanneX * massstab).toFloat() / 2f
    val versatzY = rand + (nutzbarY - spanneY * massstab).toFloat() / 2f

    return punkte.indices.map { i ->
        Bildpunkt(
            x = versatzX + ((xs[i] - xMin) * massstab).toFloat(),
            // Bildschirmkoordinaten laufen nach unten, Breitengrade nach oben
            y = versatzY + ((yMax - ys[i]) * massstab).toFloat(),
        )
    }
}
