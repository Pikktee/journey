// Manifest-Bau: Room-Daten → Austauschformat `luhambo/upload@1` (JSON).
// Pure Funktionen über den Entities — die Naht zum Backend, deshalb
// vollständig unit-getestet (Segmentierung, Zeit-Offsets, Anker).
package app.luhambo.upload

import app.luhambo.daten.MediumEntity
import app.luhambo.daten.ModuswechselEntity
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TrackpunktEntity
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.format.DateTimeFormatter

@Serializable
data class ManifestZeit(val start: String, val end: String, val zone: String)

@Serializable
data class ManifestSegment(
    val mode: String,
    val pts: List<List<Double>>,
)

@Serializable
data class ManifestMedium(
    val id: String,
    val type: String,
    val file: String,
    val takenAt: String,
    val anchor: List<Double>? = null,
)

@Serializable
data class UploadManifest(
    val schema: String = "luhambo/upload@1",
    @SerialName("clientTourId") val clientTourId: String,
    val title: String? = null,
    val description: String? = null,
    val time: ManifestZeit,
    val segments: List<ManifestSegment>,
    val media: List<ManifestMedium>,
)

object ManifestBau {

    private val json = Json { encodeDefaults = true; explicitNulls = false }

    fun alsJson(manifest: UploadManifest): String = json.encodeToString(manifest)

    private fun iso(ms: Long): String = DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(ms))

    /**
     * Segmentierung: die Moduswechsel zerschneiden die Punktliste an ihren
     * Zeit-Offsets. Grenzpunkte gehören BEIDEN Segmenten (das Backend erwartet
     * lückenlos anschließende Segmente); leere Schnipsel entfallen.
     */
    fun baueSegmente(
        punkte: List<TrackpunktEntity>,
        wechsel: List<ModuswechselEntity>,
    ): List<ManifestSegment> {
        if (punkte.size < 2) return emptyList()
        val sortiert = wechsel.sortedBy { it.tOffsetS }
            .ifEmpty { return listOf(segment("walk", punkte)) }

        val segmente = mutableListOf<ManifestSegment>()
        for ((index, aktueller) in sortiert.withIndex()) {
            val bis = sortiert.getOrNull(index + 1)?.tOffsetS ?: Double.MAX_VALUE
            val teil = punkte.filter { it.tOffsetS >= aktueller.tOffsetS && it.tOffsetS <= bis }
                .toMutableList()
            // Grenzpunkt des Vorgängers voranstellen, damit kein Loch entsteht
            if (index > 0) {
                val letzterVorher = punkte.lastOrNull { it.tOffsetS < aktueller.tOffsetS }
                if (letzterVorher != null && (teil.isEmpty() || teil.first().id != letzterVorher.id)) {
                    teil.add(0, letzterVorher)
                }
            }
            if (teil.size >= 2) segmente.add(segment(aktueller.modus.schluessel, teil))
        }
        // Alle Wechsel ohne brauchbare Punkte (z. B. Wechsel nach dem letzten
        // Punkt) → wenigstens ein Gesamtsegment im Modus des ersten Wechsels
        return segmente.ifEmpty { listOf(segment(sortiert.first().modus.schluessel, punkte)) }
    }

    private fun segment(mode: String, punkte: List<TrackpunktEntity>) = ManifestSegment(
        mode = mode,
        pts = punkte.map { listOf(rund(it.lng, 6), rund(it.lat, 6), rund(it.ele, 1), rund(it.tOffsetS, 1)) },
    )

    private fun rund(x: Double, stellen: Int): Double {
        var p = 1.0
        repeat(stellen) { p *= 10 }
        return Math.round(x * p) / p
    }

    /** Komplettes Manifest aus dem Room-Bestand einer Tour. */
    fun baue(
        tour: TourEntity,
        punkte: List<TrackpunktEntity>,
        wechsel: List<ModuswechselEntity>,
        medien: List<MediumEntity>,
    ): UploadManifest = UploadManifest(
        clientTourId = tour.id,
        title = tour.titel,
        description = tour.beschreibung,
        time = ManifestZeit(
            start = iso(tour.startMs),
            end = iso(tour.endeMs ?: (tour.startMs + ((punkte.lastOrNull()?.tOffsetS ?: 1.0) * 1000).toLong())),
            zone = tour.zone,
        ),
        segments = baueSegmente(punkte, wechsel),
        media = medien.map { m ->
            ManifestMedium(
                id = m.id,
                type = m.typ,
                file = m.datei.substringAfterLast('/'),
                takenAt = iso(m.aufgenommenMs),
                anchor = if (m.ankerLng != null && m.ankerLat != null) listOf(m.ankerLng, m.ankerLat) else null,
            )
        },
    )
}
