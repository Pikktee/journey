// Ein Tour-Foto für den Upload fertig machen: aufrecht drehen, auf eine
// vernünftige Kante bringen, die Aufnahme-Angaben behalten.
//
// Zwei Gründe, das auf dem Telefon zu tun und nicht erst auf dem Server:
// Ein Kamerafoto ist 3–5 MB, und jedes davon geht über Mobilfunk — bei einer
// Tour mit zwanzig Aufnahmen sind das ~80 MB Upload für Bilder, die niemand in
// dieser Größe zu sehen bekommt. Und das Kontingent des Kontos zählt mit.
//
// GEDREHT WIRD IN DIE PIXEL: CameraX legt die Aufnahmelage nur als
// EXIF-Orientation ab, die JPEG-Pixel bleiben sensor-nativ (Querformat). Nicht
// jeder Konsument ehrt EXIF — das Web-Studio zeigt Fotos per CSS
// background-image, das die Orientation ignoriert, und ältere WebViews ebenso.
package app.maptale.kamera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import app.maptale.ui.aufKante
import app.maptale.ui.probenFaktor
import java.io.File
import java.io.FileOutputStream

/**
 * Längste Kante eines hochgeladenen Fotos.
 *
 * Bewusst über der Anzeigegröße, die der Server daraus ableitet (1920): Er
 * rechnet seine Fassungen aus DIESER Datei, und was hier fehlt, ist überall
 * fort. 2560 lässt Reserve für eine größere Fassung, ohne die es beim heutigen
 * Stand keinen sichtbaren Unterschied gibt.
 */
const val UPLOAD_KANTE = 2560

/** JPEG-Güte: darüber wächst nur die Datei, darunter zeigen Flächen Artefakte. */
private const val UPLOAD_GUETE = 88

/**
 * Aufnahme-Angaben, die das Studio unter „Aufnahme-Details" zeigt — sie stehen
 * im EXIF, und `Bitmap.compress` schreibt keins. Ohne diese Liste verlöre jedes
 * Foto beim Aufbereiten Kamera, Objektiv und Belichtung.
 *
 * Nicht dabei: die Orientierung (steckt danach in den Pixeln) und die
 * Pixelmaße (die sind hinterher andere) — beide werden eigens gesetzt.
 */
private val UEBERNOMMENE_ANGABEN = listOf(
    ExifInterface.TAG_MAKE,
    ExifInterface.TAG_MODEL,
    ExifInterface.TAG_LENS_MAKE,
    ExifInterface.TAG_LENS_MODEL,
    ExifInterface.TAG_DATETIME,
    ExifInterface.TAG_DATETIME_ORIGINAL,
    ExifInterface.TAG_DATETIME_DIGITIZED,
    ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
    ExifInterface.TAG_SUBSEC_TIME_ORIGINAL,
    ExifInterface.TAG_EXPOSURE_TIME,
    ExifInterface.TAG_F_NUMBER,
    ExifInterface.TAG_EXPOSURE_BIAS_VALUE,
    ExifInterface.TAG_FOCAL_LENGTH,
    ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM,
    ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
    ExifInterface.TAG_ISO_SPEED,
    ExifInterface.TAG_WHITE_BALANCE,
    ExifInterface.TAG_FLASH,
    ExifInterface.TAG_METERING_MODE,
    // Der Ort trägt im Studio die Verortung der Aufnahme
    ExifInterface.TAG_GPS_LATITUDE,
    ExifInterface.TAG_GPS_LATITUDE_REF,
    ExifInterface.TAG_GPS_LONGITUDE,
    ExifInterface.TAG_GPS_LONGITUDE_REF,
    ExifInterface.TAG_GPS_ALTITUDE,
    ExifInterface.TAG_GPS_ALTITUDE_REF,
    ExifInterface.TAG_GPS_TIMESTAMP,
    ExifInterface.TAG_GPS_DATESTAMP,
)

/**
 * Bereitet [datei] IN PLACE für den Upload auf.
 *
 * Bei Fehlern (OutOfMemory, unlesbares JPEG) bleibt die Originaldatei
 * unangetastet — lieber ein großes Foto hochladen als gar keins.
 */
fun bereiteFotoFuerUpload(datei: File) {
    val quellExif = runCatching { ExifInterface(datei.absolutePath) }.getOrNull()
    val orientierung = quellExif?.getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
    ) ?: ExifInterface.ORIENTATION_NORMAL
    val angaben = quellExif?.let { exif ->
        UEBERNOMMENE_ANGABEN.mapNotNull { tag -> exif.getAttribute(tag)?.let { tag to it } }
    }.orEmpty()

    runCatching {
        val masse = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(datei.absolutePath, masse)
        if (masse.outWidth <= 0 || masse.outHeight <= 0) return

        // Nichts zu tun? Dann die Datei nicht anfassen: Ein zweites Encodieren
        // kostet Qualität, ohne ein Byte zu sparen. „Keine Angabe" (UNDEFINED)
        // zählt dabei wie „normal" — sonst schriebe ein Foto ohne EXIF-Lage die
        // Datei jedes Mal neu, ohne je ein Pixel zu drehen.
        val schonKlein = maxOf(masse.outWidth, masse.outHeight) <= UPLOAD_KANTE
        if (schonKlein && !mussGedrehtWerden(orientierung)) return

        val optionen = BitmapFactory.Options().apply {
            inSampleSize = probenFaktor(masse.outWidth, masse.outHeight, UPLOAD_KANTE)
        }
        val grob = BitmapFactory.decodeFile(datei.absolutePath, optionen) ?: return
        val gedreht = drehe(grob, orientierung)
        val fertig = aufKante(gedreht, UPLOAD_KANTE)

        FileOutputStream(datei).use { fertig.compress(Bitmap.CompressFormat.JPEG, UPLOAD_GUETE, it) }
        val breite = fertig.width
        val hoehe = fertig.height
        if (fertig !== gedreht) fertig.recycle()
        if (gedreht !== grob) gedreht.recycle()
        grob.recycle()

        schreibeAngaben(datei, angaben, breite, hoehe)
    }.onFailure { Log.w("MaptaleFoto", "Foto-Aufbereitung fehlgeschlagen, Original bleibt", it) }
}

/** Verlangt diese EXIF-Lage überhaupt eine Drehung? NORMAL und „keine Angabe" nicht. */
private fun mussGedrehtWerden(orientierung: Int): Boolean =
    orientierung != ExifInterface.ORIENTATION_NORMAL && orientierung != ExifInterface.ORIENTATION_UNDEFINED

/** Dreht die Pixel gemäß EXIF-Lage; NORMAL/UNDEFINED gibt das Bild unverändert zurück. */
private fun drehe(bild: Bitmap, orientierung: Int): Bitmap {
    val matrix = Matrix()
    when (orientierung) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
        else -> return bild
    }
    return Bitmap.createBitmap(bild, 0, 0, bild.width, bild.height, matrix, true)
}

/**
 * Gemerkte Angaben in die neu geschriebene Datei zurückschreiben.
 *
 * Die Lage steht ausdrücklich auf „normal": Sie steckt jetzt in den Pixeln, und
 * bliebe der alte Wert stehen, drehte jeder EXIF-treue Betrachter ein zweites Mal.
 */
private fun schreibeAngaben(datei: File, angaben: List<Pair<String, String>>, breite: Int, hoehe: Int) {
    runCatching {
        val ziel = ExifInterface(datei.absolutePath)
        for ((tag, wert) in angaben) ziel.setAttribute(tag, wert)
        ziel.setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
        ziel.setAttribute(ExifInterface.TAG_PIXEL_X_DIMENSION, breite.toString())
        ziel.setAttribute(ExifInterface.TAG_PIXEL_Y_DIMENSION, hoehe.toString())
        ziel.saveAttributes()
    }.onFailure { Log.w("MaptaleFoto", "EXIF konnte nicht übernommen werden", it) }
}
