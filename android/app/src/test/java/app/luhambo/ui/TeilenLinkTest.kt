// Sichtbarkeits-Stufen und der Link, der geteilt wird.
package app.luhambo.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TeilenLinkTest {

    @Test
    fun `Link zeigt auf den Web-Player der Tour`() {
        assertEquals(
            "https://luhambo.example/erlebnis.html?tour=srv:t_abc",
            teilenLink("t_abc", basis = "https://luhambo.example"),
        )
    }

    @Test
    fun `abschliessender Schraegstrich der Basis verdoppelt sich nicht`() {
        assertTrue(teilenLink("t_abc", basis = "https://luhambo.example/").startsWith("https://luhambo.example/erlebnis"))
    }

    @Test
    fun `unbekannte Sichtbarkeit gilt als privat`() {
        // Im Zweifel weniger zeigen, nicht mehr
        assertEquals(Sichtbarkeit.PRIVAT, Sichtbarkeit.vonSchluessel(null))
        assertEquals(Sichtbarkeit.PRIVAT, Sichtbarkeit.vonSchluessel("irgendwas"))
        assertEquals(Sichtbarkeit.UNGELISTET, Sichtbarkeit.vonSchluessel("unlisted"))
        assertEquals(Sichtbarkeit.OEFFENTLICH, Sichtbarkeit.vonSchluessel("public"))
    }

    @Test
    fun `Oeffentlich steht nur zur Wahl, wenn es die Galerie gibt`() {
        // Sonst wäre es ein Versprechen auf eine Seite, die niemand aufrufen kann
        val ohne = Sichtbarkeit.waehlbare(galerieVerfuegbar = false)
        assertFalse(ohne.contains(Sichtbarkeit.OEFFENTLICH))
        assertEquals(listOf(Sichtbarkeit.PRIVAT, Sichtbarkeit.UNGELISTET), ohne)

        assertTrue(Sichtbarkeit.waehlbare(galerieVerfuegbar = true).contains(Sichtbarkeit.OEFFENTLICH))
    }

    @Test
    fun `die Galerie ist inzwischen da, also steht die Stufe zur Wahl`() {
        assertTrue(Sichtbarkeit.waehlbare(GALERIE_VERFUEGBAR).contains(Sichtbarkeit.OEFFENTLICH))
    }

    @Test
    fun `Schluessel decken sich mit dem Server-Schema`() {
        assertEquals(listOf("private", "unlisted", "public"), Sichtbarkeit.entries.map { it.schluessel })
    }
}
