package app.luhambo.aufzeichnung

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpurTest {

    @Test
    fun `haelt die Punktzahl gedeckelt und behaelt die Form`() {
        var spur = emptyList<Spurpunkt>()
        repeat(1000) { i -> spur = ergaenzeSpur(spur, Spurpunkt(8.0 + i * 1e-4, 50.0), hoechstzahl = 100) }
        assertTrue("bleibt unter der Grenze", spur.size <= 100)
        // Anfang und Ende überleben das Ausdünnen — die Linie endet dort, wo
        // man gerade steht, und beginnt, wo man losgegangen ist.
        assertEquals(8.0, spur.first().lng, 1e-9)
        assertEquals(8.0 + 999 * 1e-4, spur.last().lng, 1e-9)
    }

    @Test
    fun `verzerrt die Form nicht`() {
        // Ein Quadrat auf der Erdoberfläche: 0,001° Breite entspricht bei 50° Nord
        // etwa 0,00156° Länge. Als Bild muss daraus wieder ein Quadrat werden.
        val laengenGrad = 0.001 / kotlin.math.cos(Math.toRadians(50.0))
        val quadrat = listOf(
            Spurpunkt(8.0, 50.0),
            Spurpunkt(8.0 + laengenGrad, 50.0),
            Spurpunkt(8.0 + laengenGrad, 50.001),
            Spurpunkt(8.0, 50.001),
        )
        val bild = projiziereSpur(quadrat, 200f, 200f)
        val breite = bild.maxOf { it.x } - bild.minOf { it.x }
        val hoehe = bild.maxOf { it.y } - bild.minOf { it.y }
        assertEquals(breite.toDouble(), hoehe.toDouble(), 1.0)
    }

    @Test
    fun `legt die Spur in die Flaeche und haelt den Rand ein`() {
        val spur = listOf(Spurpunkt(8.0, 50.0), Spurpunkt(8.01, 50.01))
        val bild = projiziereSpur(spur, 100f, 100f, rand = 10f)
        assertTrue(bild.all { it.x >= 9.9f && it.x <= 90.1f })
        assertTrue(bild.all { it.y >= 9.9f && it.y <= 90.1f })
    }

    @Test
    fun `kommt mit einem einzigen Punkt und mit gar keinem zurecht`() {
        // Zu Beginn einer Aufzeichnung ist genau ein Punkt da; ohne Ausdehnung
        // gäbe es sonst eine Division durch null.
        val einer = projiziereSpur(listOf(Spurpunkt(8.0, 50.0)), 100f, 100f)
        assertEquals(1, einer.size)
        assertTrue(einer[0].x.isFinite() && einer[0].y.isFinite())
        assertTrue(projiziereSpur(emptyList(), 100f, 100f).isEmpty())
        assertTrue(projiziereSpur(listOf(Spurpunkt(8.0, 50.0)), 0f, 0f).isEmpty())
    }
}
