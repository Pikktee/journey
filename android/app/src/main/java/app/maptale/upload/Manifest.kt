// Manifest-Bau: Room-Daten → Austauschformat `maptale/upload@2` (JSON).
// Pure Funktionen über den Entities — die Naht zum Backend, deshalb
// vollständig unit-getestet (Segmentierung, Zeit-Offsets, Anker).
package app.maptale.upload

import app.maptale.aufzeichnung.Bewegungsdeutung
import app.maptale.aufzeichnung.Modusabschnitt
import app.maptale.daten.MediumEntity
import app.maptale.daten.ModuswechselEntity
import app.maptale.daten.TourEntity
import app.maptale.daten.TrackpunktEntity
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
    /** Nutzertext; in der App „Titel", im fertigen Tour-JSON die Überschrift. */
    val caption: String? = null,
)

@Serializable
data class UploadManifest(
    val schema: String = "maptale/upload@2",
    @SerialName("clientTourId") val clientTourId: String,
    val title: String? = null,
    val description: String? = null,
    val time: ManifestZeit,
    // segments ODER trackFile — bei Aufnahme entstehen Segmente aus Room,
    // beim Import (M8) referenziert trackFile das per PUT hochzuladende GPX;
    // die Segmentierung/Platzierung macht dann der Server.
    val segments: List<ManifestSegment>? = null,
    val trackFile: String? = null,
    /**
     * Wurde die Aufteilung erkannt statt angegeben? („Automatisch" im Startblatt)
     *
     * Nur dann darf der Server sie verfeinern — etwa ein Fahrzeug an seiner
     * Trasse als Straßenbahn erkennen. Ohne dieses Feld sähe er nur Modi und
     * könnte eine Angabe des Nutzers nicht von einer Vorgabe unterscheiden.
     */
    val travelModesAuto: Boolean? = null,
    val media: List<ManifestMedium>,
)

/** Zeitspanne einer Aufzeichnung/eines Imports (Millisekunden seit Epoch). */
data class Zeitspanne(val startMs: Long, val endMs: Long)

/** Ein zu importierendes Medium mit den für die Platzierung nötigen Metadaten. */
data class ImportMedium(
    val id: String,
    val typ: String, // "photo" | "video"
    val datei: String,
    val takenAtMs: Long,
    val anchorLng: Double? = null,
    val anchorLat: Double? = null,
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
            if (teil.size >= 2) segmente.add(segment(aktueller.travelMode.schluessel, teil))
        }
        // Alle Wechsel ohne brauchbare Punkte (z. B. Wechsel nach dem letzten
        // Punkt) → wenigstens ein Gesamtsegment im Modus des ersten Wechsels
        return segmente.ifEmpty { listOf(segment(sortiert.first().travelMode.schluessel, punkte)) }
    }

    /**
     * Die zu kurzen Abschnitte herauswerfen, bevor zerschnitten wird.
     *
     * Die Aktivitätserkennung meldet an Ampeln und beim Umsteigen mehrfach in
     * Sekunden; ungefiltert entstünden dutzende Segmente. Der Server nimmt
     * mehrere Segmente als bewusste Umschaltung und korrigiert sie nicht mehr —
     * aus der Verbesserung würde eine Verschlechterung.
     *
     * Bewusst NICHT in `baueSegmente`: Das Zerschneiden ist mechanisch und soll
     * es bleiben; was ein belastbarer Abschnitt ist, entscheidet
     * `Bewegungsdeutung` (pure, getestet).
     */
    fun glaetteWechsel(wechsel: List<ModuswechselEntity>, endeS: Double): List<ModuswechselEntity> {
        if (wechsel.size < 2) return wechsel.sortedBy { it.tOffsetS }
        val behalten = Bewegungsdeutung.glaette(wechsel.map { Modusabschnitt(it.tOffsetS, it.travelMode) }, endeS)
        val vorlage = wechsel.minByOrNull { it.tOffsetS } ?: return wechsel
        return behalten.map { a ->
            wechsel.firstOrNull { it.tOffsetS == a.tOffsetS && it.travelMode == a.modus }
                ?: vorlage.copy(tOffsetS = a.tOffsetS, travelMode = a.modus)
        }
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

    /**
     * Import-Manifest (M8): statt Segmenten eine trackFile-Referenz — der Server
     * parst das GPX und platziert die Medien. Die App liefert nur die Zeitspanne
     * (aus dem GPX gelesen) und die Medien-Metadaten (aus EXIF, soweit vorhanden).
     */
    fun baueImport(
        clientTourId: String,
        titel: String?,
        zone: String,
        zeitspanne: Zeitspanne,
        medien: List<ImportMedium>,
        trackDatei: String = "track.gpx",
    ): UploadManifest = UploadManifest(
        clientTourId = clientTourId,
        title = titel?.ifBlank { null },
        time = ManifestZeit(start = iso(zeitspanne.startMs), end = iso(zeitspanne.endMs), zone = zone),
        segments = null,
        trackFile = trackDatei,
        media = medien.map { m ->
            ManifestMedium(
                id = m.id,
                type = m.typ,
                file = m.datei.substringAfterLast('/'),
                takenAt = iso(m.takenAtMs),
                anchor = if (m.anchorLng != null && m.anchorLat != null) listOf(m.anchorLng, m.anchorLat) else null,
            )
        },
    )

    /** Komplettes Manifest aus dem Room-Bestand einer Tour. */
    fun baue(
        tour: TourEntity,
        punkte: List<TrackpunktEntity>,
        wechsel: List<ModuswechselEntity>,
        medien: List<MediumEntity>,
    ): UploadManifest = UploadManifest(
        clientTourId = tour.id,
        title = tour.title,
        description = tour.description,
        time = ManifestZeit(
            start = iso(tour.startMs),
            end = iso(tour.endMs ?: (tour.startMs + ((punkte.lastOrNull()?.tOffsetS ?: 1.0) * 1000).toLong())),
            zone = tour.zone,
        ),
        segments = baueSegmente(punkte, glaetteWechsel(wechsel, punkte.lastOrNull()?.tOffsetS ?: 0.0)),
        // Nur wenn die App das Mittel selbst erkannt hat, darf der Server die
        // Aufteilung verfeinern (Fahrzeug auf Schienen → Straßenbahn).
        travelModesAuto = if (tour.travelModeAuto) true else null,
        media = medien.map { m ->
            ManifestMedium(
                id = m.id,
                type = m.type,
                file = m.file.substringAfterLast('/'),
                takenAt = iso(m.takenAtMs),
                anchor = if (m.anchorLng != null && m.anchorLat != null) listOf(m.anchorLng, m.anchorLat) else null,
                caption = m.caption?.ifBlank { null },
            )
        },
    )
}
