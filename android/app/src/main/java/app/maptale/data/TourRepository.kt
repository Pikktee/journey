// Repository: die eine Fachschnittstelle über Room + Dateiablage. ViewModels,
// Service und Worker reden nur hiermit — keine Geschäftslogik in Composables
// oder im Service selbst (Projektlinie: Schichten UI → VM → Repository).
package app.maptale.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.time.ZoneId
import java.util.UUID

/** Nächste freie Medien-Nummer aus den vorhandenen IDs („m3" → 4). */
fun nextMediumNumber(vorhandeneIds: List<String>): Int =
    (vorhandeneIds.mapNotNull { it.removePrefix("m").toIntOrNull() }.maxOrNull() ?: 0) + 1

class TourRepository(private val db: MaptaleDb, private val filesDir: File) {

    private val dao get() = db.tourDao()
    // Serialisiert die Medien-Nummernvergabe: „size + 1" lesen und einfügen ist
    // sonst nicht atomar — zwei parallele Registrierungen (Video-Finalize läuft
    // asynchron nach, währenddessen ein Foto) läsen dieselbe Zahl und kollidierten
    // im (tourId, id)-Primärschlüssel.
    private val medienMutex = Mutex()

    fun allTours(): Flow<List<TourEntity>> = dao.allTours()
    fun tourFlow(id: String): Flow<TourEntity?> = dao.tourFlow(id)
    suspend fun tour(id: String): TourEntity? = dao.tour(id)

    /** Neue Aufnahme beginnen: Tour + erster Moduswechsel. */
    suspend fun startRecording(
        travelMode: TravelMode,
        jetztMs: Long = System.currentTimeMillis(),
        title: String? = null,
        /** true = „Automatisch": das Fortbewegungsmittel wird unterwegs erkannt */
        travelModeAuto: Boolean = false,
    ): TourEntity {
        val tour = TourEntity(
            id = "local-${UUID.randomUUID()}",
            title = title?.trim()?.ifBlank { null },
            description = null,
            startMs = jetztMs,
            endMs = null,
            zone = ZoneId.systemDefault().id,
            status = TourStatus.RECORDING,
            travelModeAuto = travelModeAuto,
        )
        dao.createTour(tour)
        dao.insertTravelModeChange(TravelModeChangeEntity(tourId = tour.id, tOffsetS = 0.0, travelMode = travelMode))
        return tour
    }

    /** Punkt-Batch aus dem Service übernehmen und die Listen-Distanz nachziehen. */
    suspend fun savePoints(tourId: String, points: List<TrackPointEntity>, distanceM: Double) {
        if (points.isNotEmpty()) dao.insertPoints(points)
        dao.setDistance(tourId, distanceM)
    }

    suspend fun changeTravelMode(tourId: String, tOffsetS: Double, travelMode: TravelMode) {
        dao.insertTravelModeChange(TravelModeChangeEntity(tourId = tourId, tOffsetS = tOffsetS, travelMode = travelMode))
    }

    /** Aufnahme abschließen → Entwurf (Titel editierbar, Upload möglich). */
    suspend fun finishRecording(tourId: String, title: String?, endMs: Long = System.currentTimeMillis()) {
        val tour = dao.tour(tourId) ?: return
        dao.updateTour(tour.copy(endMs = endMs, title = title ?: tour.title, status = TourStatus.DRAFT))
    }

    /**
     * Verwaiste Aufnahmen aufräumen (App-Start): Nach einem Prozess-Tod bleibt
     * eine Tour sonst für immer im Status AUFNAHME hängen und wäre in der UI
     * unerreichbar. Der Track bis zum letzten 30-s-Flush ist ja da — die Tour
     * wird ehrlich als Entwurf abgeschlossen (Ende = letzter Punkt).
     * Spiegelbild des Backend-Musters „Verarbeitung unterbrochen (Neustart)".
     */
    suspend fun closeOrphanedRecordings() {
        for (tour in dao.toursByStatus(TourStatus.RECORDING)) {
            val letzterOffsetS = dao.lastPointOffset(tour.id)
            dao.updateTour(
                tour.copy(
                    endMs = tour.startMs + ((letzterOffsetS ?: 1.0) * 1000).toLong(),
                    status = TourStatus.DRAFT,
                    error = "Aufzeichnung wurde unterbrochen",
                ),
            )
        }
    }

    suspend fun updateTexts(tourId: String, title: String?, description: String?) {
        val tour = dao.tour(tourId) ?: return
        dao.updateTour(tour.copy(title = title, description = description))
    }

    suspend fun setStatus(tourId: String, status: TourStatus, fehler: String? = null) =
        dao.setStatus(tourId, status, fehler)

    suspend fun toursByStatus(status: TourStatus): List<TourEntity> = dao.toursByStatus(status)

    suspend fun setServerId(tourId: String, serverId: String) = dao.setServerId(tourId, serverId)

    suspend fun tourByServerId(serverId: String): TourEntity? = dao.tourByServerId(serverId)

    suspend fun points(tourId: String): List<TrackPointEntity> = dao.points(tourId)
    suspend fun travelModeChanges(tourId: String): List<TravelModeChangeEntity> = dao.travelModeChanges(tourId)
    suspend fun media(tourId: String): List<MediumEntity> = dao.media(tourId)
    fun mediaFlow(tourId: String): Flow<List<MediumEntity>> = dao.mediaFlow(tourId)
    fun mediumFlow(tourId: String, mediumId: String): Flow<MediumEntity?> =
        dao.mediumFlow(tourId, mediumId)
    fun mediaCount(tourId: String): Flow<Int> = dao.mediaCountFlow(tourId)
    suspend fun setMediumUploaded(tourId: String, mediumId: String) =
        dao.setMediumStatus(tourId, mediumId, MediumUploadStatus.UPLOADED)

    /** Nutzertext setzen; Leerstring zählt als „nicht beschriftet". */
    suspend fun setMediumCaption(tourId: String, mediumId: String, caption: String?) =
        dao.setMediumCaption(tourId, mediumId, caption?.trim()?.ifBlank { null })

    /** Einzelnes Medium samt Datei entfernen. */
    suspend fun deleteMedium(tourId: String, mediumId: String) {
        val medium = dao.media(tourId).firstOrNull { it.id == mediumId } ?: return
        dao.deleteMedium(tourId, mediumId)
        mediumFile(medium).delete()
    }

    /** Zieldatei für ein neues Foto; Ordner je Tour unterm App-Speicher. */
    fun newMediumFile(tourId: String, extension: String): Pair<String, File> {
        val relativ = "tours/$tourId/${UUID.randomUUID()}.$extension"
        val datei = File(filesDir, relativ)
        datei.parentFile?.mkdirs()
        return relativ to datei
    }

    fun mediumFile(medium: MediumEntity): File = File(filesDir, medium.file)

    suspend fun registerPhoto(
        tourId: String,
        relativerPfad: String,
        takenAtMs: Long,
        anchor: Pair<Double, Double>?,
    ) = registriereMedium(tourId, "photo", relativerPfad, takenAtMs, anchor)

    /** Video registrieren (M4); Dauer/Poster ermittelt das Backend beim Anreichern. */
    suspend fun registerVideo(
        tourId: String,
        relativerPfad: String,
        takenAtMs: Long,
        anchor: Pair<Double, Double>?,
    ) = registriereMedium(tourId, "video", relativerPfad, takenAtMs, anchor)

    // Foto UND Video werden fortlaufend über die ganze Tour nummeriert (m1, m2 …).
    // Die Nummer ist die HÖCHSTE vergebene plus eins, nicht die Anzahl: nach dem
    // Löschen eines Fotos zeigte „Anzahl + 1" wieder auf eine schon vergebene ID
    // und kollidierte im (tourId, id)-Primärschlüssel. Vergebene Nummern werden
    // also nie erneut benutzt — Lücken sind harmlos.
    // Der Mutex macht „Nummer lesen + einfügen" atomar (s. medienMutex oben).
    private suspend fun registriereMedium(
        tourId: String,
        typ: String,
        relativerPfad: String,
        takenAtMs: Long,
        anchor: Pair<Double, Double>?,
    ) = medienMutex.withLock {
        val nummer = nextMediumNumber(dao.media(tourId).map { it.id })
        dao.insertMedium(
            MediumEntity(
                id = "m$nummer",
                tourId = tourId,
                type = typ,
                file = relativerPfad,
                takenAtMs = takenAtMs,
                anchorLng = anchor?.first,
                anchorLat = anchor?.second,
            ),
        )
    }

    /** Tour samt Punkten, Medien und Dateien restlos entfernen. */
    suspend fun deleteTour(tourId: String) {
        dao.deletePoints(tourId)
        dao.deleteTravelModeChanges(tourId)
        dao.deleteMedia(tourId)
        dao.deleteTour(tourId)
        File(filesDir, "tours/$tourId").deleteRecursively()
    }
}
