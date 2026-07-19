// Fotos physisch aufrecht ausrichten. CameraX legt die Aufnahmelage nur als
// EXIF-Orientation ab, die JPEG-Pixel bleiben sensor-nativ (Querformat). Nicht
// jeder Konsument ehrt EXIF — das Web-Studio zeigt Fotos per CSS background-image,
// das die Orientation ignoriert, und ältere WebViews ebenso. Darum drehen wir die
// Pixel gemäß EXIF und schreiben die Datei ohne Orientation zurück (Bitmap.compress
// schreibt kein EXIF); danach erscheint das Bild überall aufrecht.
package app.luhambo.kamera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream

/**
 * Richtet [datei] anhand ihrer EXIF-Orientation auf. Idempotent: ist die Lage
 * bereits normal/undefiniert, passiert nichts. Bei Fehlern (z. B. OutOfMemory)
 * bleibt die Originaldatei unangetastet — der Player ehrt dann noch das EXIF-Tag.
 */
fun richteFotoAuf(datei: File) {
    val orientierung = runCatching {
        ExifInterface(datei.absolutePath)
            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

    val matrix = Matrix()
    when (orientierung) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
        else -> return // NORMAL / UNDEFINED → nichts zu drehen
    }

    runCatching {
        val original = BitmapFactory.decodeFile(datei.absolutePath) ?: return
        val gedreht = Bitmap.createBitmap(original, 0, 0, original.width, original.height, matrix, true)
        FileOutputStream(datei).use { gedreht.compress(Bitmap.CompressFormat.JPEG, 92, it) }
        if (gedreht !== original) original.recycle()
        gedreht.recycle()
    }.onFailure { Log.w("LuhamboFoto", "Foto-Aufrichten fehlgeschlagen, Original bleibt", it) }
}
