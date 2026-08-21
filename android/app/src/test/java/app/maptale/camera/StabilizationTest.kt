// Welcher Stabilisierungsweg gebunden wird: reine Entscheidung, deshalb ohne Robolectric.
package app.maptale.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class StabilizationTest {

    @Test
    fun `Video nimmt den Vorschau-Weg, wenn das Objektiv ihn kann`() {
        // Er stabilisiert Vorschau UND Aufnahme, das Sucherbild bleibt ehrlich.
        assertEquals(
            Stabilization.PREVIEW,
            chooseStabilization(fuerVideo = true, vorschauMoeglich = true, videoMoeglich = true),
        )
    }

    @Test
    fun `Ohne Vorschau-Stabilisierung bleibt der Video-Weg`() {
        assertEquals(
            Stabilization.VIDEO_ONLY,
            chooseStabilization(fuerVideo = true, vorschauMoeglich = false, videoMoeglich = true),
        )
    }

    @Test
    fun `Kann das Objektiv nichts, wird nichts eingeschaltet`() {
        // Ungeprüft gesetzt quittiert die HAL es mit einem Fehler.
        assertEquals(
            Stabilization.NONE,
            chooseStabilization(fuerVideo = true, vorschauMoeglich = false, videoMoeglich = false),
        )
    }

    @Test
    fun `Im Foto-Modus bleibt beides aus, auch wenn das Objektiv es koennte`() {
        // Eine stabilisierte Vorschau ist beschnitten, das Foto aus dem
        // ImageCapture nicht — das Bild zeigte sonst mehr, als im Sucher stand.
        assertEquals(
            Stabilization.NONE,
            chooseStabilization(fuerVideo = false, vorschauMoeglich = true, videoMoeglich = true),
        )
    }
}
