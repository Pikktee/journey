// Die mitwachsende Linie der laufenden Aufzeichnung — reine Mathematik, ohne
// Android-Bezug und damit direkt testbar.
//
// Bewusst KEINE Karte: Ein Kartenrenderer samt Kachel-Downloads liefe hier
// stundenlang neben der Aufzeichnung her und wäre genau das, was den Akku
// leert. Gezeichnet wird nur der Weg selbst — die Form genügt, um zu sehen,
// dass aufgezeichnet wird und dass es plausibel aussieht.
package app.maptale.recording

import kotlin.math.cos
import kotlin.math.hypot

/** Ein Stützpunkt der Skizze (nur Ort, keine Zeit — mehr braucht die Linie nicht). */
data class TrackPoint(val lng: Double, val lat: Double)

/** Ein Punkt in Bildkoordinaten; getrennt von Compose, damit Tests ohne UI laufen. */
data class ScreenPoint(val x: Float, val y: Float)

/** Ein Foto-Anker auf der Skizze — Ort plus Kennung, damit ein Tipp zum Bild führt. */
data class PhotoMark(val id: String, val lng: Double, val lat: Double)

/**
 * Ein gezeichneter Foto-Punkt in Bildkoordinaten. `anzahl` > 1, wenn mehrere
 * Fotos zu nah beieinander lagen und zu einem Ball zusammengefasst wurden.
 */
data class PhotoPoint(val id: String, val punkt: ScreenPoint, val anzahl: Int)

/** Mehr Stützpunkte kann eine Skizze in Daumengröße ohnehin nicht zeigen. */
const val TRACK_MAX_POINTS = 600

/**
 * Punkt anhängen und die Liste dabei gedeckelt halten.
 *
 * Ist die Höchstzahl erreicht, wird jeder zweite Punkt verworfen — die Linie
 * behält ihre Form, braucht aber wieder nur halb so viel Platz und kann erneut
 * wachsen. Auf einer Tagestour bleibt der Speicherbedarf so konstant, statt mit
 * jeder Stunde zu steigen.
 */
fun appendPoint(
    bisher: List<TrackPoint>,
    neu: TrackPoint,
    hoechstzahl: Int = TRACK_MAX_POINTS,
): List<TrackPoint> {
    val liste = if (bisher.size >= hoechstzahl) bisher.filterIndexed { i, _ -> i % 2 == 0 } else bisher
    return liste + neu
}

/**
 * Eine fertige Punktliste gleichmäßig auf höchstens [hoechstzahl] eindampfen.
 *
 * Für die Skizze einer abgeschlossenen Tour, deren Track leicht tausende Punkte
 * hat: So viele einzelne Linien zu zeichnen wäre Verschwendung, in Daumengröße
 * ohnehin nicht zu sehen. Anfang und Ende bleiben immer erhalten — die Linie
 * soll dort beginnen und enden, wo die Reise es tat.
 */
fun thinOut(points: List<TrackPoint>, hoechstzahl: Int = TRACK_MAX_POINTS): List<TrackPoint> {
    if (points.size <= hoechstzahl) return points
    val schritt = (points.size - 1).toDouble() / (hoechstzahl - 1)
    return (0 until hoechstzahl).map { i -> points[(i * schritt).toInt()] }
}

/**
 * Die Abbildung von Geo- auf Bildkoordinaten: mittig, formtreu, mit Rand.
 *
 * Längengrade werden mit dem Kosinus der Breite gestaucht — ohne das wäre eine
 * Nord-Süd-Runde in Frankfurt um ein Drittel zu breit, weil ein Grad Länge dort
 * nur etwa zwei Drittel eines Grades Breite misst. Die Skizze soll die Form des
 * Weges zeigen, nicht die eines verzerrten Gitternetzes.
 *
 * Als eigenes Objekt herausgezogen (statt nur als Funktion), damit Foto-Anker in
 * DENSELBEN Rahmen fallen wie die Linie: Würde man sie für sich projizieren,
 * richtete sich ihr Maßstab nach ihren eigenen Grenzen, und sie säßen neben dem
 * Weg statt darauf. Der Rahmen kommt allein von der Route — die Fotos liegen
 * ohnehin auf ihr.
 */
class Projection private constructor(
    private val kosinus: Double,
    private val xMin: Double,
    private val yMax: Double,
    private val massstab: Double,
    private val versatzX: Float,
    private val versatzY: Float,
) {
    fun project(punkt: TrackPoint): ScreenPoint = ScreenPoint(
        x = versatzX + ((punkt.lng * kosinus - xMin) * massstab).toFloat(),
        // Bildschirmkoordinaten laufen nach unten, Breitengrade nach oben
        y = versatzY + ((yMax - punkt.lat) * massstab).toFloat(),
    )

    companion object {
        /**
         * Den Rahmen aus den übergebenen Punkten bestimmen; null bei leerer
         * Liste oder Fläche — zu Beginn einer Aufzeichnung und vor dem ersten
         * Layout gibt es noch nichts zu rechnen.
         */
        fun aus(rahmen: List<TrackPoint>, breite: Float, hoehe: Float, rand: Float = 0f): Projection? {
            if (rahmen.isEmpty() || breite <= 0f || hoehe <= 0f) return null

            val mittlereBreite = rahmen.sumOf { it.lat } / rahmen.size
            val kosinus = cos(Math.toRadians(mittlereBreite)).coerceAtLeast(0.01)
            val xs = rahmen.map { it.lng * kosinus }
            val ys = rahmen.map { it.lat }

            val xMin = xs.min(); val xMax = xs.max()
            val yMin = ys.min(); val yMax = ys.max()
            val spanneX = (xMax - xMin).coerceAtLeast(1e-9)
            val spanneY = (yMax - yMin).coerceAtLeast(1e-9)

            val nutzbarX = (breite - 2 * rand).coerceAtLeast(1f)
            val nutzbarY = (hoehe - 2 * rand).coerceAtLeast(1f)
            // Ein gemeinsamer Maßstab für beide Achsen erhält die Form; der
            // kleinere von beiden sorgt dafür, dass die Spur ganz hineinpasst.
            val massstab = minOf(nutzbarX / spanneX, nutzbarY / spanneY)

            // Rest gleichmäßig auf beide Seiten — die Zeichnung sitzt mittig
            val versatzX = rand + (nutzbarX - spanneX * massstab).toFloat() / 2f
            val versatzY = rand + (nutzbarY - spanneY * massstab).toFloat() / 2f

            return Projection(kosinus, xMin, yMax, massstab, versatzX, versatzY)
        }
    }
}

/**
 * Eine ganze Spur auf eine Zeichenfläche legen — dünne Hülle um [Projektion],
 * bei der Rahmen und projizierte Punkte dieselben sind.
 */
fun projectTrack(
    points: List<TrackPoint>,
    breite: Float,
    hoehe: Float,
    rand: Float = 0f,
): List<ScreenPoint> {
    val projektion = Projection.aus(points, breite, hoehe, rand) ?: return emptyList()
    return points.map { projektion.project(it) }
}

/**
 * Eine Foto-Marke auf die gezeichnete Linie ziehen.
 *
 * Der Server verankert Medien am Track in VOLLER Auflösung; gezeichnet wird die
 * vereinfachte und ausgedünnte Linie. Wo die Vereinfachung eine Ecke abgekürzt
 * hat, schwebte der Punkt sonst neben dem Weg — was wie ein Fehler aussieht,
 * obwohl beide Angaben stimmen. Der nächstliegende gezeichnete Stützpunkt ist
 * die ehrlichste Antwort auf „wo an DIESER Linie war das".
 */
fun snapToLine(punkt: ScreenPoint, linie: List<ScreenPoint>): ScreenPoint =
    linie.minByOrNull { hypot(it.x - punkt.x, it.y - punkt.y) } ?: punkt

/**
 * Nah beieinander liegende Foto-Punkte zu einem zusammenfassen.
 *
 * Auf einer Skizze in Daumengröße liegen die Fotos eines Stopps nur wenige Pixel
 * auseinander — ohne das verschmelzen die Marken zu einem Klecks. Der erste
 * eines Balls behält Ort und Kennung; ein Tipp öffnet ihn, die übrigen findet
 * man im Fotogitter darunter.
 */
fun clusterPhotos(points: List<Pair<String, ScreenPoint>>, mindestabstand: Float): List<PhotoPoint> {
    val baelle = mutableListOf<PhotoPoint>()
    for ((id, punkt) in points) {
        val treffer = baelle.indexOfFirst { hypot(it.punkt.x - punkt.x, it.punkt.y - punkt.y) < mindestabstand }
        if (treffer < 0) baelle += PhotoPoint(id, punkt, 1)
        else baelle[treffer] = baelle[treffer].copy(anzahl = baelle[treffer].anzahl + 1)
    }
    return baelle
}
