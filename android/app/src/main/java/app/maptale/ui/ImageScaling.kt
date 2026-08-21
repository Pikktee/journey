// Ein Profilbild aus der Galerie ist ein Kamerafoto: gern 4000 px breit und
// mehrere Megabyte. Angezeigt wird es als Kreis von wenigen Zentimetern. Vor
// dem Hochladen wird es deshalb verkleinert — das spart Mobilfunkdaten,
// Serverplatz und Ladezeit in der Galerie.
package app.maptale.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** Längste Kante des fertigen Profilbilds. */
const val AVATAR_EDGE = 512

/** JPEG-Güte: darunter werden Hautpartien fleckig, darüber wächst nur die Datei. */
private const val AVATAR_GUETE = 85

/**
 * Zwei Durchgänge über den Datenstrom, weil ein Rohfoto nicht als Ganzes in den
 * Speicher soll: erst nur die Maße lesen, dann mit passendem Verkleinerungs-
 * faktor dekodieren.
 */
fun scaleForAvatar(oeffne: () -> InputStream): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    oeffne().use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
        inSampleSize = sampleFactor(bounds.outWidth, bounds.outHeight, AVATAR_EDGE)
    }
    val coarse = oeffne().use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    val done = scaleToEdge(coarse, AVATAR_EDGE)

    return ByteArrayOutputStream().use { puffer ->
        done.compress(Bitmap.CompressFormat.JPEG, AVATAR_GUETE, puffer)
        if (done !== coarse) done.recycle()
        coarse.recycle()
        puffer.toByteArray()
    }
}

/**
 * Zweierpotenz, mit der BitmapFactory beim Dekodieren gleich verkleinert. Sie
 * bleibt bewusst eine Stufe zu grob (>= statt >), damit für den anschließenden
 * sauberen Skalierschritt noch genug Pixel da sind.
 */
internal fun sampleFactor(width: Int, height: Int, zielKante: Int): Int {
    var factor = 1
    while (max(width, height) / (factor * 2) >= zielKante) factor *= 2
    return factor
}

/** Auf die Zielkante bringen; kleinere Bilder bleiben, wie sie sind. */
internal fun scaleToEdge(bitmap: Bitmap, zielKante: Int): Bitmap {
    val longest = max(bitmap.width, bitmap.height)
    if (longest <= zielKante) return bitmap
    val factor = zielKante.toDouble() / longest
    return Bitmap.createScaledBitmap(
        bitmap,
        (bitmap.width * factor).roundToInt().coerceAtLeast(1),
        (bitmap.height * factor).roundToInt().coerceAtLeast(1),
        true,
    )
}
