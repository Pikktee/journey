// Verkleinern des Profilbilds vor dem Hochladen.
package app.maptale.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.max

@RunWith(RobolectricTestRunner::class)
class ImageScalingTest {

    private fun jpeg(breite: Int, hoehe: Int): ByteArray {
        val bild = Bitmap.createBitmap(breite, hoehe, Bitmap.Config.ARGB_8888)
        return ByteArrayOutputStream().use {
            bild.compress(Bitmap.CompressFormat.JPEG, 90, it)
            it.toByteArray()
        }
    }

    private fun masse(data: ByteArray): Pair<Int, Int> {
        val optionen = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, optionen)
        return optionen.outWidth to optionen.outHeight
    }

    @Test
    fun `ein Kamerafoto schrumpft auf die Zielkante`() {
        val source = jpeg(4000, 3000)
        val fertig = scaleForAvatar { ByteArrayInputStream(source) }
        assertNotNull(fertig)
        val (b, h) = masse(fertig!!)
        assertEquals(AVATAR_EDGE, max(b, h))
        // Seitenverhältnis bleibt erhalten (4:3)
        assertEquals(384, minOf(b, h))
    }

    @Test
    fun `Hochformat wird an der langen Kante gemessen`() {
        val fertig = scaleForAvatar { ByteArrayInputStream(jpeg(1000, 2000)) }!!
        val (b, h) = masse(fertig)
        assertEquals(AVATAR_EDGE, h)
        assertEquals(256, b)
    }

    @Test
    fun `ein kleines Bild wird nicht kuenstlich vergroessert`() {
        val fertig = scaleForAvatar { ByteArrayInputStream(jpeg(200, 200)) }!!
        assertEquals(200 to 200, masse(fertig))
    }

    @Test
    fun `Probenfaktor bleibt eine Stufe zu grob`() {
        // Sonst fehlten dem anschließenden sauberen Skalierschritt die Pixel
        assertEquals(1, sampleFactor(600, 400, 512))
        assertEquals(2, sampleFactor(1024, 768, 512))
        assertEquals(4, sampleFactor(4000, 3000, 512))
        assertEquals(1, sampleFactor(100, 100, 512))
    }

    @Test
    fun `das Ergebnis bleibt deutlich unter dem Serverlimit`() {
        val fertig = scaleForAvatar { ByteArrayInputStream(jpeg(4000, 3000)) }!!
        assertTrue("Unerwartet groß: ${fertig.size} Bytes", fertig.size < 2 * 1024 * 1024)
    }
}
