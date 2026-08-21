// Sichtbarkeits-Stufen und der Link, der geteilt wird.
package app.maptale.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareLinkTest {

    @Test
    fun `Link zeigt auf den Web-Player der Tour`() {
        assertEquals(
            "https://maptale.example/tour/t_abc",
            shareLink("t_abc", basis = "https://maptale.example"),
        )
    }

    @Test
    fun `abschliessender Schraegstrich der Basis verdoppelt sich nicht`() {
        assertTrue(shareLink("t_abc", basis = "https://maptale.example/").startsWith("https://maptale.example/tour/"))
    }

    @Test
    fun `unbekannte Sichtbarkeit gilt als privat`() {
        // Im Zweifel weniger zeigen, nicht mehr
        assertEquals(Visibility.PRIVATE, Visibility.fromKey(null))
        assertEquals(Visibility.PRIVATE, Visibility.fromKey("irgendwas"))
        assertEquals(Visibility.UNLISTED, Visibility.fromKey("unlisted"))
        assertEquals(Visibility.PUBLIC, Visibility.fromKey("public"))
    }

    @Test
    fun `Oeffentlich steht nur zur Wahl, wenn es die Galerie gibt`() {
        // Sonst wäre es ein Versprechen auf eine Seite, die niemand aufrufen kann
        val ohne = Visibility.selectable(galerieVerfuegbar = false)
        assertFalse(ohne.contains(Visibility.PUBLIC))
        assertEquals(listOf(Visibility.PRIVATE, Visibility.UNLISTED), ohne)

        assertTrue(Visibility.selectable(galerieVerfuegbar = true).contains(Visibility.PUBLIC))
    }

    @Test
    fun `die Galerie ist inzwischen da, also steht die Stufe zur Wahl`() {
        assertTrue(Visibility.selectable(GALLERY_AVAILABLE).contains(Visibility.PUBLIC))
    }

    @Test
    fun `Schluessel decken sich mit dem Server-Schema`() {
        assertEquals(listOf("private", "unlisted", "public"), Visibility.entries.map { it.key })
    }
}
