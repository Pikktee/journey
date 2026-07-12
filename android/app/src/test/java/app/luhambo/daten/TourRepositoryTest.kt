// Repository gegen eine In-Memory-Room-DB (Robolectric liefert den Context):
// Lebenszyklus Aufnahme → Punkte → Entwurf, Medien-Nummerierung, Löschen.
package app.luhambo.daten

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

    private lateinit var db: LuhamboDb
    private lateinit var repo: TourRepository
    private lateinit var filesDir: File

    @Before
    fun aufbau() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, LuhamboDb::class.java)
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
        val tour = repo.starteAufnahme(Modus.BIKE, jetztMs = 1_000_000)
        assertEquals(TourStatus.AUFNAHME, tour.status)
        assertEquals(Modus.BIKE, repo.moduswechsel(tour.id).single().modus)

        repo.speicherePunkte(
            tour.id,
            listOf(
                TrackpunktEntity(tourId = tour.id, lng = 8.0, lat = 46.59, ele = 500.0, tOffsetS = 0.0, genauigkeitM = 5f),
                TrackpunktEntity(tourId = tour.id, lng = 8.001, lat = 46.59, ele = 501.0, tOffsetS = 10.0, genauigkeitM = 5f),
            ),
            distanzM = 76.4,
        )
        repo.beendeAufnahme(tour.id, titel = null, endeMs = 1_600_000)

        val geladen = repo.tour(tour.id)!!
        assertEquals(TourStatus.ENTWURF, geladen.status)
        assertEquals(1_600_000L, geladen.endeMs)
        assertEquals(76.4, geladen.distanzM, 1e-9)
        assertEquals(2, repo.punkte(tour.id).size)
    }

    @Test
    fun `Fotos werden fortlaufend nummeriert`() = runTest {
        val tour = repo.starteAufnahme(Modus.WALK)
        repo.registriereFoto(tour.id, "touren/${tour.id}/a.jpg", 123, 8.0 to 46.59)
        repo.registriereFoto(tour.id, "touren/${tour.id}/b.jpg", 456, null)
        val medien = repo.medien(tour.id)
        assertEquals(listOf("m1", "m2"), medien.map { it.id })
        assertEquals(2, repo.medienAnzahl(tour.id).first())
        assertNull(medien[1].ankerLng)
    }

    @Test
    fun `Fotos und Videos werden gemeinsam fortlaufend nummeriert (M4)`() = runTest {
        val tour = repo.starteAufnahme(Modus.WALK)
        repo.registriereFoto(tour.id, "touren/${tour.id}/a.jpg", 100, 8.0 to 46.59)
        repo.registriereVideo(tour.id, "touren/${tour.id}/b.mp4", 200, 8.01 to 46.6)
        repo.registriereFoto(tour.id, "touren/${tour.id}/c.jpg", 300, null)
        val medien = repo.medien(tour.id)
        assertEquals(listOf("m1", "m2", "m3"), medien.map { it.id })
        assertEquals(listOf("photo", "video", "photo"), medien.map { it.typ })
    }

    @Test
    fun `Medien-IDs kollidieren nicht ueber Touren hinweg (Review-Fund)`() = runTest {
        // Vorher: PK nur auf id → das erste Foto der ZWEITEN Tour ("m1")
        // krachte in das der ersten. Schlüssel ist jetzt (tourId, id).
        val erste = repo.starteAufnahme(Modus.WALK)
        val zweite = repo.starteAufnahme(Modus.BIKE)
        repo.registriereFoto(erste.id, "touren/${erste.id}/a.jpg", 123, null)
        repo.registriereFoto(zweite.id, "touren/${zweite.id}/a.jpg", 456, null)
        assertEquals(listOf("m1"), repo.medien(erste.id).map { it.id })
        assertEquals(listOf("m1"), repo.medien(zweite.id).map { it.id })

        // Upload-Status trifft nur das Medium der richtigen Tour
        repo.setzeMediumHochgeladen(zweite.id, "m1")
        assertEquals(MediumUploadStatus.LOKAL, repo.medien(erste.id).single().uploadStatus)
        assertEquals(MediumUploadStatus.HOCHGELADEN, repo.medien(zweite.id).single().uploadStatus)
    }

    @Test
    fun `Loeschen entfernt Tour, Punkte, Medien und Dateien`() = runTest {
        val tour = repo.starteAufnahme(Modus.WALK)
        val (relativ, datei) = repo.neueMediumDatei(tour.id, "jpg")
        datei.writeBytes(byteArrayOf(1, 2, 3))
        repo.registriereFoto(tour.id, relativ, 123, null)

        repo.loescheTour(tour.id)
        assertNull(repo.tour(tour.id))
        assertTrue(repo.punkte(tour.id).isEmpty())
        assertTrue(!datei.exists())
    }
}
