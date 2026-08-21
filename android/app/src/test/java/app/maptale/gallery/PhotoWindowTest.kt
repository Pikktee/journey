// Die Zuordnung Galerie → Tour: Zeitfenster, Kamera-Ordner, Dedup, Sätze.
//
// Kein MediaStore, kein Netz — genau deshalb liegen diese Regeln in einer
// eigenen Datei. Was hier grün ist, ist die einzige Entscheidung des
// Foto-Nachzugs, die man ohne Gerät prüfen kann.
package app.maptale.gallery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val START = 1_754_000_000_000L // irgendein fester Zeitpunkt
private const val ENDE = START + 3 * 60 * 60 * 1000L // drei Stunden Tour

private fun bild(
    id: Long,
    versatzMs: Long,
    folder: String? = "Camera",
    lat: Double? = null,
    lng: Double? = null,
) = GalleryItem(
    id = id,
    fileName = "IMG_$id.jpg",
    takenAtMs = START + versatzMs,
    lat = lat,
    lng = lng,
    folder = folder,
)

class PhotoWindowTest {

    @Test
    fun `Bilder innerhalb der Tour werden vorgeschlagen`() {
        val treffer = matchingImages(
            listOf(bild(1, 0), bild(2, 60 * 60 * 1000), bild(3, ENDE - START)),
            START,
            ENDE,
        )
        assertEquals(listOf(1L, 2L, 3L), treffer.map { it.id })
    }

    @Test
    fun `ausserhalb der Tour aufgenommene Bilder bleiben draussen`() {
        // Keine Toleranz: `DATE_TAKEN` ist bereits UTC, eine Zeitzonen-Reserve
        // braucht es nicht — und jede Reserve griffe in die Nachbartour.
        val knappDrin = bild(1, 1000)
        val knappDraussen = bild(2, -1000)
        val danachDrin = bild(3, (ENDE - START) - 1000)
        val danachDraussen = bild(4, (ENDE - START) + 1000)
        val treffer = matchingImages(listOf(knappDrin, knappDraussen, danachDrin, danachDraussen), START, ENDE)
        assertEquals(listOf(1L, 3L), treffer.map { it.id })
    }

    @Test
    fun `zwei Touren desselben Vormittags bekommen NICHT dieselben Fotos`() {
        // Am Gerät gemeldet: Zwei Runden im Abstand von zwei Minuten erhielten
        // beide alle dreizehn Bilder des Vormittags — die Toleranz stand auf
        // zwei Stunden und deckte damit alles ab.
        // Genau der gemeldete Fall: zwei Runden, keine zwei Minuten auseinander.
        val tourA = START to START + 6 * 60 * 1000L
        val tourB = START + 7 * 60 * 1000L to START + 27 * 60 * 1000L
        val bilder = listOf(
            bild(1, -60 * 60 * 1000),        // eine Stunde vorher: gehört keiner
            bild(2, 3 * 60 * 1000),          // mitten in A
            bild(3, 15 * 60 * 1000),         // mitten in B
            bild(4, 6 * 60 * 1000 + 30_000), // in der Lücke: gehört keiner
        )
        assertEquals(listOf(2L), matchingImages(bilder, tourA.first, tourA.second).map { it.id })
        assertEquals(listOf(3L), matchingImages(bilder, tourB.first, tourB.second).map { it.id })
    }

    @Test
    fun `Screenshots und Messenger-Ordner bleiben draussen`() {
        // Der Zeitfenster-Scan erwischt sonst das fotografierte Ticket aus der
        // Pause und das Bild aus dem Familienchat.
        val treffer = matchingImages(
            listOf(
                bild(1, 1000, folder = "Camera"),
                bild(2, 2000, folder = "Screenshots"),
                bild(3, 3000, folder = "WhatsApp Images"),
                bild(4, 4000, folder = "Download"),
                bild(5, 5000, folder = "Telegram"),
            ),
            START,
            ENDE,
        )
        assertEquals(listOf(1L), treffer.map { it.id })
    }

    @Test
    fun `ein unbekannter Ordner zaehlt nicht als Kamera`() {
        // Positiv- UND Negativliste: Nur die Sperrliste ließe jede künftige
        // Foto-App durch.
        assertTrue(isCameraImage("DCIM"))
        assertTrue(isCameraImage("camera"))
        assertTrue(isCameraImage("Open Camera"))
        assertFalse(isCameraImage("Pinterest"))
        assertFalse(isCameraImage(null))
        // Auch wenn „Camera" darin vorkommt: Die Sperrliste gewinnt.
        assertFalse(isCameraImage("WhatsApp Camera"))
    }

    @Test
    fun `RAW-Dateien fallen heraus — sonst stirbt der ganze Nachzug an einer`() {
        // Am Pixel 9 gefunden: Die Kamera legt neben jedem Foto ein .dng ab.
        // Die Nachreich-Route kennt keine halben Stapel — ein Eintrag mit
        // unbekannter Endung lässt die ganze Anfrage mit 400 scheitern.
        val treffer = matchingImages(
            listOf(
                bild(1, 1000).copy(fileName = "PXL_1.jpg"),
                bild(2, 2000).copy(fileName = "PXL_1.RAW-02.ORIGINAL.dng"),
                bild(3, 3000).copy(fileName = "bild.PNG"),
                bild(4, 4000).copy(fileName = "ohne-endung"),
            ),
            START,
            ENDE,
        )
        assertEquals(listOf(1L, 3L), treffer.map { it.id })
    }

    @Test
    fun `die Endungsprüfung folgt dem, was der Server annimmt`() {
        assertTrue(isExtensionAllowed("a.jpg"))
        assertTrue(isExtensionAllowed("a.JPEG"))
        assertTrue(isExtensionAllowed("a.webp"))
        assertFalse(isExtensionAllowed("a.dng"))
        // Als FOTO gemeldet ist eine .mp4 falsch — der Server prüft die Endung
        // gegen den Typ und wiese den ganzen Stapel mit 400 ab.
        assertFalse(isExtensionAllowed("a.mp4"))
        // HEIC nimmt der Server seit v0.55.3 an (er löst die Kacheln auf).
        assertTrue(isExtensionAllowed("a.heic"))
        assertTrue(isExtensionAllowed("a.HEIF"))
    }

    @Test
    fun `schon vorhandene Aufnahmen werden nicht erneut vorgeschlagen`() {
        // Sonst käme die Frage bei jedem Öffnen wieder — auch für den, der
        // einmal „nein" gesagt hat.
        val treffer = matchingImages(
            listOf(bild(1, 1000), bild(2, 2000)),
            START,
            ENDE,
            bekannteZeitenMs = setOf(START + 1000),
        )
        assertEquals(listOf(2L), treffer.map { it.id })
    }

    @Test
    fun `der Abgleich laeuft auf Sekunden, weil ISO-Zeitstempel keine Millisekunden tragen`() {
        val treffer = matchingImages(
            listOf(bild(1, 1500)),
            START,
            ENDE,
            // Der Server gab „…:01Z" zurück, das Bild liegt bei 1500 ms.
            bekannteZeitenMs = setOf(START + 1000),
        )
        assertTrue(treffer.isEmpty())
    }

    @Test
    fun `Vorschlaege kommen in zeitlicher Reihenfolge`() {
        val treffer = matchingImages(listOf(bild(3, 9000), bild(1, 1000), bild(2, 5000)), START, ENDE)
        assertEquals(listOf(1L, 2L, 3L), treffer.map { it.id })
    }

    @Test
    fun `GPS schlaegt die Zeit — und der Anker steht als lng-lat`() {
        // Die Reihenfolge des Manifests, nicht die der Umgangssprache: Wer sie
        // dreht, setzt jedes Foto auf die andere Erdhälfte.
        val mitGps = bild(1, 1000, lat = 50.11, lng = 8.68)
        assertEquals(8.68 to 50.11, mitGps.anchor)
        assertNull(bild(2, 1000).anchor)
    }

    @Test
    fun `der Satz fragt ohne Einwilligung und meldet mit ihr`() {
        // Eine Frage über eine erledigte Sache liest sich wie ein Fehler.
        assertEquals("3 Fotos hinzugefügt", backfillMessage(3, automatisch = true))
        assertEquals("1 Foto hinzugefügt", backfillMessage(1, automatisch = true))
        assertEquals("1 Foto aus dieser Zeit gefunden — hinzufügen?", backfillMessage(1, automatisch = false))
        assertEquals("14 Fotos aus dieser Zeit gefunden — hinzufügen?", backfillMessage(14, automatisch = false))
        assertNull(backfillMessage(0, automatisch = true))
        assertNull(backfillMessage(0, automatisch = false))
    }

    @Test
    fun `Videos gehen ihren eigenen Weg durch die Endungsprüfung`() {
        assertTrue(isExtensionAllowed("VID_1.mp4", isVideo = true))
        assertTrue(isExtensionAllowed("VID_1.MOV", isVideo = true))
        assertTrue(isExtensionAllowed("clip.webm", isVideo = true))
        // Die Kamera legt neben der .mp4 gern eine Vorschau ab — sie gehört so
        // wenig in die Tour wie das RAW neben dem JPEG.
        assertFalse(isExtensionAllowed("VID_1.lrv", isVideo = true))
        assertFalse(isExtensionAllowed("VID_1.thm", isVideo = true))
        // Und ein Foto als Video gemeldet ist genauso falsch wie umgekehrt.
        assertFalse(isExtensionAllowed("IMG_1.jpg", isVideo = true))
    }

    @Test
    fun `ein Video im Zeitfenster wird vorgeschlagen wie ein Foto`() {
        val treffer = matchingImages(
            listOf(
                bild(1, 1000),
                bild(2, 2000).copy(fileName = "VID_2.mp4", isVideo = true),
                bild(3, 3000).copy(fileName = "VID_3.lrv", isVideo = true),
            ),
            START,
            ENDE,
        )
        assertEquals(listOf(1L, 2L), treffer.map { it.id })
    }

    @Test
    fun `der Satz benennt, was tatsächlich dabei ist`() {
        // „3 Fotos hinzugefügt" über zwei Bildern und einem Video ist falsch —
        // wer das Video vermisst, sucht den Fehler beim Hochladen.
        assertEquals("3 Aufnahmen hinzugefügt", backfillMessage(3, automatisch = true, videos = 1))
        assertEquals("2 Videos hinzugefügt", backfillMessage(2, automatisch = true, videos = 2))
        assertEquals("1 Video hinzugefügt", backfillMessage(1, automatisch = true, videos = 1))
        assertEquals(
            "4 Aufnahmen aus dieser Zeit gefunden — hinzufügen?",
            backfillMessage(4, automatisch = false, videos = 2),
        )
    }
}
