// Die Zuordnung Galerie → Tour: Zeitfenster, Kamera-Ordner, Dedup, Sätze.
//
// Kein MediaStore, kein Netz — genau deshalb liegen diese Regeln in einer
// eigenen Datei. Was hier grün ist, ist die einzige Entscheidung des
// Foto-Nachzugs, die man ohne Gerät prüfen kann.
package app.maptale.galerie

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
    ordner: String? = "Camera",
    breite: Double? = null,
    laenge: Double? = null,
) = Galeriebild(
    id = id,
    dateiname = "IMG_$id.jpg",
    aufgenommenMs = START + versatzMs,
    breite = breite,
    laenge = laenge,
    ordner = ordner,
)

class FotofensterTest {

    @Test
    fun `Bilder innerhalb der Tour werden vorgeschlagen`() {
        val treffer = passendeBilder(
            listOf(bild(1, 0), bild(2, 60 * 60 * 1000), bild(3, ENDE - START)),
            START,
            ENDE,
        )
        assertEquals(listOf(1L, 2L, 3L), treffer.map { it.id })
    }

    @Test
    fun `die Toleranz reicht zwei Stunden nach beiden Seiten`() {
        // Sie fängt die Zeitzone, nicht das Abendessen: EXIF trägt oft keine
        // Zone, der Track dagegen UTC.
        val knappDrin = bild(1, -TOLERANZ_MS + 1000)
        val knappDraussen = bild(2, -TOLERANZ_MS - 1000)
        val danachDrin = bild(3, (ENDE - START) + TOLERANZ_MS - 1000)
        val danachDraussen = bild(4, (ENDE - START) + TOLERANZ_MS + 1000)
        val treffer = passendeBilder(listOf(knappDrin, knappDraussen, danachDrin, danachDraussen), START, ENDE)
        assertEquals(listOf(1L, 3L), treffer.map { it.id })
    }

    @Test
    fun `Screenshots und Messenger-Ordner bleiben draussen`() {
        // Der Zeitfenster-Scan erwischt sonst das fotografierte Ticket aus der
        // Pause und das Bild aus dem Familienchat.
        val treffer = passendeBilder(
            listOf(
                bild(1, 1000, ordner = "Camera"),
                bild(2, 2000, ordner = "Screenshots"),
                bild(3, 3000, ordner = "WhatsApp Images"),
                bild(4, 4000, ordner = "Download"),
                bild(5, 5000, ordner = "Telegram"),
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
        assertTrue(istKamerabild("DCIM"))
        assertTrue(istKamerabild("camera"))
        assertTrue(istKamerabild("Open Camera"))
        assertFalse(istKamerabild("Pinterest"))
        assertFalse(istKamerabild(null))
        // Auch wenn „Camera" darin vorkommt: Die Sperrliste gewinnt.
        assertFalse(istKamerabild("WhatsApp Camera"))
    }

    @Test
    fun `RAW-Dateien fallen heraus — sonst stirbt der ganze Nachzug an einer`() {
        // Am Pixel 9 gefunden: Die Kamera legt neben jedem Foto ein .dng ab.
        // Die Nachreich-Route kennt keine halben Stapel — ein Eintrag mit
        // unbekannter Endung lässt die ganze Anfrage mit 400 scheitern.
        val treffer = passendeBilder(
            listOf(
                bild(1, 1000).copy(dateiname = "PXL_1.jpg"),
                bild(2, 2000).copy(dateiname = "PXL_1.RAW-02.ORIGINAL.dng"),
                bild(3, 3000).copy(dateiname = "bild.PNG"),
                bild(4, 4000).copy(dateiname = "ohne-endung"),
            ),
            START,
            ENDE,
        )
        assertEquals(listOf(1L, 3L), treffer.map { it.id })
    }

    @Test
    fun `die Endungsprüfung folgt dem, was der Server annimmt`() {
        assertTrue(endungErlaubt("a.jpg"))
        assertTrue(endungErlaubt("a.JPEG"))
        assertTrue(endungErlaubt("a.webp"))
        assertFalse(endungErlaubt("a.dng"))
        assertFalse(endungErlaubt("a.mp4"))
        // HEIC nimmt der Server seit v0.55.3 an (er löst die Kacheln auf).
        assertTrue(endungErlaubt("a.heic"))
        assertTrue(endungErlaubt("a.HEIF"))
    }

    @Test
    fun `schon vorhandene Aufnahmen werden nicht erneut vorgeschlagen`() {
        // Sonst käme die Frage bei jedem Öffnen wieder — auch für den, der
        // einmal „nein" gesagt hat.
        val treffer = passendeBilder(
            listOf(bild(1, 1000), bild(2, 2000)),
            START,
            ENDE,
            bekannteZeitenMs = setOf(START + 1000),
        )
        assertEquals(listOf(2L), treffer.map { it.id })
    }

    @Test
    fun `der Abgleich laeuft auf Sekunden, weil ISO-Zeitstempel keine Millisekunden tragen`() {
        val treffer = passendeBilder(
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
        val treffer = passendeBilder(listOf(bild(3, 9000), bild(1, 1000), bild(2, 5000)), START, ENDE)
        assertEquals(listOf(1L, 2L, 3L), treffer.map { it.id })
    }

    @Test
    fun `GPS schlaegt die Zeit — und der Anker steht als lng-lat`() {
        // Die Reihenfolge des Manifests, nicht die der Umgangssprache: Wer sie
        // dreht, setzt jedes Foto auf die andere Erdhälfte.
        val mitGps = bild(1, 1000, breite = 50.11, laenge = 8.68)
        assertEquals(8.68 to 50.11, mitGps.anker)
        assertNull(bild(2, 1000).anker)
    }

    @Test
    fun `der Satz fragt ohne Einwilligung und meldet mit ihr`() {
        // Eine Frage über eine erledigte Sache liest sich wie ein Fehler.
        assertEquals("3 Fotos hinzugefügt", nachzugSatz(3, automatisch = true))
        assertEquals("1 Foto hinzugefügt", nachzugSatz(1, automatisch = true))
        assertEquals("1 Foto aus dieser Zeit gefunden — hinzufügen?", nachzugSatz(1, automatisch = false))
        assertEquals("14 Fotos aus dieser Zeit gefunden — hinzufügen?", nachzugSatz(14, automatisch = false))
        assertNull(nachzugSatz(0, automatisch = true))
        assertNull(nachzugSatz(0, automatisch = false))
    }
}
