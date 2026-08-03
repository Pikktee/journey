// Welcher Stabilisierungsweg gebunden wird: reine Entscheidung, deshalb ohne Robolectric.
package app.maptale.kamera

import org.junit.Assert.assertEquals
import org.junit.Test

class StabilisierungTest {

    @Test
    fun `Video nimmt den Vorschau-Weg, wenn das Objektiv ihn kann`() {
        // Er stabilisiert Vorschau UND Aufnahme, das Sucherbild bleibt ehrlich.
        assertEquals(
            Stabilisierung.VORSCHAU,
            waehleStabilisierung(fuerVideo = true, vorschauMoeglich = true, videoMoeglich = true),
        )
    }

    @Test
    fun `Ohne Vorschau-Stabilisierung bleibt der Video-Weg`() {
        assertEquals(
            Stabilisierung.NUR_VIDEO,
            waehleStabilisierung(fuerVideo = true, vorschauMoeglich = false, videoMoeglich = true),
        )
    }

    @Test
    fun `Kann das Objektiv nichts, wird nichts eingeschaltet`() {
        // Ungeprüft gesetzt quittiert die HAL es mit einem Fehler.
        assertEquals(
            Stabilisierung.KEINE,
            waehleStabilisierung(fuerVideo = true, vorschauMoeglich = false, videoMoeglich = false),
        )
    }

    @Test
    fun `Im Foto-Modus bleibt beides aus, auch wenn das Objektiv es koennte`() {
        // Eine stabilisierte Vorschau ist beschnitten, das Foto aus dem
        // ImageCapture nicht — das Bild zeigte sonst mehr, als im Sucher stand.
        assertEquals(
            Stabilisierung.KEINE,
            waehleStabilisierung(fuerVideo = false, vorschauMoeglich = true, videoMoeglich = true),
        )
    }
}
