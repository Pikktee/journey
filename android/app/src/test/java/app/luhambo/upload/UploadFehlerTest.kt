// Welche Upload-Fehler der Worker wiederholen darf und welche nicht. Reine
// Entscheidungslogik, deshalb ohne Worker-Gerüst getestet.
package app.luhambo.upload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadFehlerTest {

    @Test
    fun `Netzprobleme und Serverfehler duerfen wiederholt werden`() {
        assertFalse(istEndgueltigerUploadFehler(500))
        assertFalse(istEndgueltigerUploadFehler(502))
        assertFalse(istEndgueltigerUploadFehler(409)) // Verarbeitung läuft schon
        assertFalse(istEndgueltigerUploadFehler(0)) // kein HTTP-Status (offline)
    }

    @Test
    fun `Was der Nutzer klaeren muss, wird nicht wiederholt`() {
        // 403 kommt bei unbestätigter E-Mail. Ohne diese Regel liefe der
        // automatisch angestoßene Upload endlos im Backoff-Kreis.
        assertTrue(istEndgueltigerUploadFehler(403))
        assertTrue(istEndgueltigerUploadFehler(401))
        assertTrue(istEndgueltigerUploadFehler(413)) // Kontingent voll
        assertTrue(istEndgueltigerUploadFehler(400))
    }

    @Test
    fun `Fehlertext bevorzugt die Erklaerung des Servers`() {
        assertEquals(
            "Bitte bestätige zuerst deine E-Mail-Adresse",
            uploadFehlerText(403, "Bitte bestätige zuerst deine E-Mail-Adresse"),
        )
        // Beim 401 ist unsere Handlungsanweisung besser als „Nicht angemeldet"
        assertEquals("Anmeldung abgelaufen — bitte neu anmelden", uploadFehlerText(401, "Nicht angemeldet"))
        assertEquals("Upload fehlgeschlagen (Fehler 400)", uploadFehlerText(400, null))
        assertEquals("Upload fehlgeschlagen (Fehler 400)", uploadFehlerText(400, "  "))
    }
}
