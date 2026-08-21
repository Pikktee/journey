// Repository gegen eine In-Memory-Room-DB (Robolectric liefert den Context):
// Lebenszyklus Aufnahme → Punkte → Entwurf, Medien-Nummerierung, Löschen.
package app.maptale.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class TourRepositoryTest {

    private lateinit var db: MaptaleDb
    private lateinit var repo: TourRepository
    private lateinit var filesDir: File

    @Before
    fun aufbau() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, MaptaleDb::class.java)
            .allowMainThreadQueries()
            .build()
        filesDir = File(context.cacheDir, "test-files").apply { mkdirs() }
        repo = TourRepository(db, filesDir)
    }

    @After
    fun abbau() {
        db.close()
        filesDir.deleteRecursively()
    }

    @Test
    fun `Aufnahme starten, Punkte speichern, beenden`() = runTest {
        val tour = repo.startRecording(TravelMode.BIKE, jetztMs = 1_000_000)
        assertEquals(TourStatus.RECORDING, tour.status)
        assertEquals(TravelMode.BIKE, repo.travelModeChanges(tour.id).single().travelMode)

        repo.savePoints(
            tour.id,
            listOf(
                TrackPointEntity(tourId = tour.id, lng = 8.0, lat = 46.59, ele = 500.0, tOffsetS = 0.0, accuracyM = 5f),
                TrackPointEntity(tourId = tour.id, lng = 8.001, lat = 46.59, ele = 501.0, tOffsetS = 10.0, accuracyM = 5f),
            ),
            distanceM = 76.4,
        )
        repo.finishRecording(tour.id, title = null, endMs = 1_600_000)

        val geladen = repo.tour(tour.id)!!
        assertEquals(TourStatus.DRAFT, geladen.status)
        assertEquals(1_600_000L, geladen.endMs)
        assertEquals(76.4, geladen.distanceM, 1e-9)
        assertEquals(2, repo.points(tour.id).size)
    }

    @Test
    fun `Fotos werden fortlaufend nummeriert`() = runTest {
        val tour = repo.startRecording(TravelMode.WALK)
        repo.registerPhoto(tour.id, "tours/${tour.id}/a.jpg", 123, 8.0 to 46.59)
        repo.registerPhoto(tour.id, "tours/${tour.id}/b.jpg", 456, null)
        val media = repo.media(tour.id)
        assertEquals(listOf("m1", "m2"), media.map { it.id })
        assertEquals(2, repo.mediaCount(tour.id).first())
        assertNull(media[1].anchorLng)
    }

    @Test
    fun `Fotos und Videos werden gemeinsam fortlaufend nummeriert (M4)`() = runTest {
        val tour = repo.startRecording(TravelMode.WALK)
        repo.registerPhoto(tour.id, "tours/${tour.id}/a.jpg", 100, 8.0 to 46.59)
        repo.registerVideo(tour.id, "tours/${tour.id}/b.mp4", 200, 8.01 to 46.6)
        repo.registerPhoto(tour.id, "tours/${tour.id}/c.jpg", 300, null)
        val media = repo.media(tour.id)
        assertEquals(listOf("m1", "m2", "m3"), media.map { it.id })
        assertEquals(listOf("photo", "video", "photo"), media.map { it.type })
    }

    @Test
    fun `Medien-IDs kollidieren nicht ueber Touren hinweg (Review-Fund)`() = runTest {
        // Vorher: PK nur auf id → das erste Foto der ZWEITEN Tour ("m1")
        // krachte in das der ersten. Schlüssel ist jetzt (tourId, id).
        val erste = repo.startRecording(TravelMode.WALK)
        val zweite = repo.startRecording(TravelMode.BIKE)
        repo.registerPhoto(erste.id, "tours/${erste.id}/a.jpg", 123, null)
        repo.registerPhoto(zweite.id, "tours/${zweite.id}/a.jpg", 456, null)
        assertEquals(listOf("m1"), repo.media(erste.id).map { it.id })
        assertEquals(listOf("m1"), repo.media(zweite.id).map { it.id })

        // Upload-Status trifft nur das Medium der richtigen Tour
        repo.setMediumUploaded(zweite.id, "m1")
        assertEquals(MediumUploadStatus.LOCAL, repo.media(erste.id).single().uploadStatus)
        assertEquals(MediumUploadStatus.UPLOADED, repo.media(zweite.id).single().uploadStatus)
    }

    @Test
    fun `Nach dem Loeschen wird keine Nummer erneut vergeben (Kollisions-Fund)`() = runTest {
        // „Anzahl + 1" zeigte nach dem Löschen auf eine schon vergebene ID und
        // krachte in den (tourId, id)-Schlüssel. Jetzt zählt die höchste Nummer.
        val tour = repo.startRecording(TravelMode.WALK)
        repo.registerPhoto(tour.id, "tours/${tour.id}/a.jpg", 100, null)
        repo.registerPhoto(tour.id, "tours/${tour.id}/b.jpg", 200, null)
        repo.deleteMedium(tour.id, "m1")
        repo.registerPhoto(tour.id, "tours/${tour.id}/c.jpg", 300, null)

        assertEquals(listOf("m2", "m3"), repo.media(tour.id).map { it.id })
    }

    @Test
    fun `Naechste Medium-Nummer aus vorhandenen IDs`() {
        assertEquals(1, nextMediumNumber(emptyList()))
        assertEquals(4, nextMediumNumber(listOf("m1", "m3")))
        assertEquals(11, nextMediumNumber(listOf("m2", "m10")))
    }

    @Test
    fun `Einzelnes Medium loeschen entfernt Eintrag und Datei`() = runTest {
        val tour = repo.startRecording(TravelMode.WALK)
        val (relativ, datei) = repo.newMediumFile(tour.id, "jpg")
        datei.writeBytes(byteArrayOf(1, 2, 3))
        repo.registerPhoto(tour.id, relativ, 123, null)

        repo.deleteMedium(tour.id, "m1")
        assertTrue(repo.media(tour.id).isEmpty())
        assertTrue(!datei.exists())
    }

    @Test
    fun `Titel eines Fotos wird gespeichert, Leerraum zaehlt als leer`() = runTest {
        val tour = repo.startRecording(TravelMode.WALK)
        repo.registerPhoto(tour.id, "tours/${tour.id}/a.jpg", 123, null)

        repo.setMediumCaption(tour.id, "m1", "  Blick über die Bucht  ")
        assertEquals("Blick über die Bucht", repo.mediumFlow(tour.id, "m1").first()?.caption)

        repo.setMediumCaption(tour.id, "m1", "   ")
        assertNull(repo.media(tour.id).single().caption)
    }

    @Test
    fun `Medien-Fluss liefert die neuesten zuerst`() = runTest {
        val tour = repo.startRecording(TravelMode.WALK)
        repo.registerPhoto(tour.id, "tours/${tour.id}/a.jpg", 100, null)
        repo.registerPhoto(tour.id, "tours/${tour.id}/b.jpg", 200, null)

        assertEquals(listOf("m2", "m1"), repo.mediaFlow(tour.id).first().map { it.id })
    }

    @Test
    fun `Loeschen entfernt Tour, Punkte, Medien und Dateien`() = runTest {
        val tour = repo.startRecording(TravelMode.WALK)
        val (relativ, datei) = repo.newMediumFile(tour.id, "jpg")
        datei.writeBytes(byteArrayOf(1, 2, 3))
        repo.registerPhoto(tour.id, relativ, 123, null)

        repo.deleteTour(tour.id)
        assertNull(repo.tour(tour.id))
        assertTrue(repo.points(tour.id).isEmpty())
        assertTrue(!datei.exists())
    }
}
