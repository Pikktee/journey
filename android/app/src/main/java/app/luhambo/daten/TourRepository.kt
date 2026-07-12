// Repository: die eine Fachschnittstelle über Room + Dateiablage. ViewModels,
// Service und Worker reden nur hiermit — keine Geschäftslogik in Composables
// oder im Service selbst (Projektlinie: Schichten UI → VM → Repository).
package app.luhambo.daten

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.time.ZoneId
import java.util.UUID

class TourRepository(private val db: LuhamboDb, private val filesDir: File) {

    private val dao get() = db.tourDao()
    // Serialisiert die Medien-Nummernvergabe: „size + 1" lesen und einfügen ist
    // sonst nicht atomar — zwei parallele Registrierungen (Video-Finalize läuft
    // asynchron nach, währenddessen ein Foto) läsen dieselbe Zahl und kollidierten
    // im (tourId, id)-Primärschlüssel.
    private val medienMutex = Mutex()

    fun alleTouren(): Flow<List<TourEntity>> = dao.alleTouren()
    fun tourFluss(id: String): Flow<TourEntity?> = dao.tourFluss(id)
    suspend fun tour(id: String): TourEntity? = dao.tour(id)

    /** Neue Aufnahme beginnen: Tour + erster Moduswechsel. */
    suspend fun starteAufnahme(modus: Modus, jetztMs: Long = System.currentTimeMillis()): TourEntity {
        val tour = TourEntity(
            id = "lokal-${UUID.randomUUID()}",
            titel = null,
            beschreibung = null,
            startMs = jetztMs,
            endeMs = null,
            zone = ZoneId.systemDefault().id,
            status = TourStatus.AUFNAHME,
        )
        dao.legeTourAn(tour)
        dao.fuegeModuswechselEin(ModuswechselEntity(tourId = tour.id, tOffsetS = 0.0, modus = modus))
        return tour
    }

    /** Punkt-Batch aus dem Service übernehmen und die Listen-Distanz nachziehen. */
    suspend fun speicherePunkte(tourId: String, punkte: List<TrackpunktEntity>, distanzM: Double) {
        if (punkte.isNotEmpty()) dao.fuegePunkteEin(punkte)
        dao.setzeDistanz(tourId, distanzM)
    }

    suspend fun wechsleModus(tourId: String, tOffsetS: Double, modus: Modus) {
        dao.fuegeModuswechselEin(ModuswechselEntity(tourId = tourId, tOffsetS = tOffsetS, modus = modus))
    }

    /** Aufnahme abschließen → Entwurf (Titel editierbar, Upload möglich). */
    suspend fun beendeAufnahme(tourId: String, titel: String?, endeMs: Long = System.currentTimeMillis()) {
        val tour = dao.tour(tourId) ?: return
        dao.aktualisiereTour(tour.copy(endeMs = endeMs, titel = titel ?: tour.titel, status = TourStatus.ENTWURF))
    }

    /**
     * Verwaiste Aufnahmen aufräumen (App-Start): Nach einem Prozess-Tod bleibt
     * eine Tour sonst für immer im Status AUFNAHME hängen und wäre in der UI
     * unerreichbar. Der Track bis zum letzten 30-s-Flush ist ja da — die Tour
     * wird ehrlich als Entwurf abgeschlossen (Ende = letzter Punkt).
     * Spiegelbild des Backend-Musters „Verarbeitung unterbrochen (Neustart)".
     */
    suspend fun schliesseVerwaisteAufnahmen() {
        for (tour in dao.tourenMitStatus(TourStatus.AUFNAHME)) {
            val letzterOffsetS = dao.letzterPunktOffset(tour.id)
            dao.aktualisiereTour(
                tour.copy(
                    endeMs = tour.startMs + ((letzterOffsetS ?: 1.0) * 1000).toLong(),
                    status = TourStatus.ENTWURF,
                    fehler = "Aufzeichnung wurde unterbrochen",
                ),
            )
        }
    }

    suspend fun aktualisiereTexte(tourId: String, titel: String?, beschreibung: String?) {
        val tour = dao.tour(tourId) ?: return
        dao.aktualisiereTour(tour.copy(titel = titel, beschreibung = beschreibung))
    }

    suspend fun setzeStatus(tourId: String, status: TourStatus, fehler: String? = null) =
        dao.setzeStatus(tourId, status, fehler)

    suspend fun setzeServerId(tourId: String, serverId: String) = dao.setzeServerId(tourId, serverId)

    suspend fun punkte(tourId: String): List<TrackpunktEntity> = dao.punkte(tourId)
    suspend fun moduswechsel(tourId: String): List<ModuswechselEntity> = dao.moduswechsel(tourId)
    suspend fun medien(tourId: String): List<MediumEntity> = dao.medien(tourId)
    fun medienAnzahl(tourId: String): Flow<Int> = dao.medienAnzahlFluss(tourId)
    suspend fun setzeMediumHochgeladen(tourId: String, mediumId: String) =
        dao.setzeMediumStatus(tourId, mediumId, MediumUploadStatus.HOCHGELADEN)

    /** Zieldatei für ein neues Foto; Ordner je Tour unterm App-Speicher. */
    fun neueMediumDatei(tourId: String, endung: String): Pair<String, File> {
        val relativ = "touren/$tourId/${UUID.randomUUID()}.$endung"
        val datei = File(filesDir, relativ)
        datei.parentFile?.mkdirs()
        return relativ to datei
    }

    fun mediumDatei(medium: MediumEntity): File = File(filesDir, medium.datei)

    suspend fun registriereFoto(
        tourId: String,
        relativerPfad: String,
        aufgenommenMs: Long,
        anker: Pair<Double, Double>?,
    ) = registriereMedium(tourId, "photo", relativerPfad, aufgenommenMs, anker)

    /** Video registrieren (M4); Dauer/Poster ermittelt das Backend beim Anreichern. */
    suspend fun registriereVideo(
        tourId: String,
        relativerPfad: String,
        aufgenommenMs: Long,
        anker: Pair<Double, Double>?,
    ) = registriereMedium(tourId, "video", relativerPfad, aufgenommenMs, anker)

    // Foto UND Video werden fortlaufend über die ganze Tour nummeriert (m1, m2 …).
    // Der Mutex macht „Nummer lesen + einfügen" atomar (s. medienMutex oben).
    private suspend fun registriereMedium(
        tourId: String,
        typ: String,
        relativerPfad: String,
        aufgenommenMs: Long,
        anker: Pair<Double, Double>?,
    ) = medienMutex.withLock {
        val nummer = dao.medien(tourId).size + 1
        dao.fuegeMediumEin(
            MediumEntity(
                id = "m$nummer",
                tourId = tourId,
                typ = typ,
                datei = relativerPfad,
                aufgenommenMs = aufgenommenMs,
                ankerLng = anker?.first,
                ankerLat = anker?.second,
            ),
        )
    }

    /** Tour samt Punkten, Medien und Dateien restlos entfernen. */
    suspend fun loescheTour(tourId: String) {
        dao.loeschePunkte(tourId)
        dao.loescheModuswechsel(tourId)
        dao.loescheMedien(tourId)
        dao.loescheTour(tourId)
        File(filesDir, "touren/$tourId").deleteRecursively()
    }
}
