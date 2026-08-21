// Welche Upload-Fehler der Worker wiederholen darf und welche nicht. Reine
// Entscheidungslogik, deshalb ohne Worker-Gerüst getestet.
package app.maptale.upload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadErrorTest {

    @Test
    fun `Netzprobleme und Serverfehler duerfen wiederholt werden`() {
        assertFalse(isFinalUploadError(500))
        assertFalse(isFinalUploadError(502))
        assertFalse(isFinalUploadError(409)) // Verarbeitung läuft schon
        assertFalse(isFinalUploadError(0)) // kein HTTP-Status (offline)
    }

    @Test
    fun `Was der Nutzer klaeren muss, wird nicht wiederholt`() {
        // 403 kommt bei unbestätigter E-Mail. Ohne diese Regel liefe der
        // automatisch angestoßene Upload endlos im Backoff-Kreis.
        assertTrue(isFinalUploadError(403))
        assertTrue(isFinalUploadError(401))
        assertTrue(isFinalUploadError(413)) // Kontingent voll
        assertTrue(isFinalUploadError(400))
    }

    @Test
    fun `Fehlertext bevorzugt die Erklaerung des Servers`() {
        assertEquals(
            "Bitte bestätige zuerst deine E-Mail-Adresse",
            uploadErrorText(403, "Bitte bestätige zuerst deine E-Mail-Adresse"),
        )
        // Beim 401 ist unsere Handlungsanweisung besser als „Nicht angemeldet"
        assertEquals("Anmeldung abgelaufen, bitte neu anmelden", uploadErrorText(401, "Nicht angemeldet"))
        assertEquals("Upload fehlgeschlagen (Fehler 400)", uploadErrorText(400, null))
        assertEquals("Upload fehlgeschlagen (Fehler 400)", uploadErrorText(400, "  "))
    }
}
