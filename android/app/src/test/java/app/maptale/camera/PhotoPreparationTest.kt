// Aufbereitung eines Tour-Fotos vor dem Upload: Maß, Sparsamkeit, EXIF-Erhalt.
package app.maptale.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.exifinterface.media.ExifInterface
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max

@RunWith(RobolectricTestRunner::class)
class PhotoPreparationTest {

    @get:Rule
    val folder = TemporaryFolder()

    private fun foto(breite: Int, hoehe: Int, name: String = "f.jpg"): File {
        val datei = folder.newFile(name)
        val bild = Bitmap.createBitmap(breite, hoehe, Bitmap.Config.ARGB_8888)
        FileOutputStream(datei).use { bild.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        return datei
    }

    private fun masse(datei: File): Pair<Int, Int> {
        val optionen = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(datei.absolutePath, optionen)
        return optionen.outWidth to optionen.outHeight
    }

    @Test
    fun `ein Kamerafoto schrumpft auf die Uploadkante`() {
        val datei = foto(4032, 3024)
        preparePhotoForUpload(datei)
        val (b, h) = masse(datei)
        assertEquals(UPLOAD_EDGE, max(b, h))
        assertTrue("Seitenverhältnis verschoben: ${b}x$h", b > h)
    }

    @Test
    fun `Hochformat wird an der langen Kante gemessen`() {
        val datei = foto(3024, 4032)
        preparePhotoForUpload(datei)
        val (b, h) = masse(datei)
        assertEquals(UPLOAD_EDGE, h)
        assertTrue("Querformat entstanden: ${b}x$h", h > b)
    }

    @Test
    fun `ein bereits kleines Foto wird nicht angefasst`() {
        // Ein zweites Encodieren kostete Qualität, ohne ein Byte zu sparen.
        val datei = foto(1600, 1200)
        val vorher = datei.readBytes()
        preparePhotoForUpload(datei)
        assertArrayEquals(vorher, datei.readBytes())
    }

    @Test
    fun `die Aufnahme-Angaben ueberleben das Verkleinern`() {
        // Nach dem Verwerfen des Originals auf dem Server ist diese Datei die
        // einzige Quelle für die Aufnahme-Details im Studio.
        val datei = foto(4032, 3024)
        ExifInterface(datei.absolutePath).apply {
            setAttribute(ExifInterface.TAG_MAKE, "Google")
            setAttribute(ExifInterface.TAG_MODEL, "Pixel 9")
            setAttribute(ExifInterface.TAG_F_NUMBER, "1.7")
            setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, "2026:08:02 14:32:10")
            saveAttributes()
        }

        preparePhotoForUpload(datei)

        val exif = ExifInterface(datei.absolutePath)
        assertEquals("Google", exif.getAttribute(ExifInterface.TAG_MAKE))
        assertEquals("Pixel 9", exif.getAttribute(ExifInterface.TAG_MODEL))
        assertEquals("1.7", exif.getAttribute(ExifInterface.TAG_F_NUMBER))
        assertEquals("2026:08:02 14:32:10", exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL))
        // Die Pixelmaße beschreiben das NEUE Bild, nicht das eingelieferte
        assertEquals(UPLOAD_EDGE.toString(), exif.getAttribute(ExifInterface.TAG_PIXEL_X_DIMENSION))
    }

    @Test
    fun `die gedrehte Lage steckt danach in den Pixeln, nicht mehr im Tag`() {
        // Bliebe die Angabe stehen, drehte jeder EXIF-treue Betrachter ein
        // zweites Mal — das Hochformat läge quer.
        val datei = foto(4032, 3024)
        ExifInterface(datei.absolutePath).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
            saveAttributes()
        }

        preparePhotoForUpload(datei)

        val (b, h) = masse(datei)
        assertTrue("nicht gedreht: ${b}x$h", h > b)
        assertEquals(
            ExifInterface.ORIENTATION_NORMAL,
            ExifInterface(datei.absolutePath)
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_UNDEFINED),
        )
    }
}
