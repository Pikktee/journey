// Ein Profilbild aus der Galerie ist ein Kamerafoto: gern 4000 px breit und
// mehrere Megabyte. Angezeigt wird es als Kreis von wenigen Zentimetern. Vor
// dem Hochladen wird es deshalb verkleinert — das spart Mobilfunkdaten,
// Serverplatz und Ladezeit in der Galerie.
package app.luhambo.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** Längste Kante des fertigen Profilbilds. */
const val AVATAR_KANTE = 512

/** JPEG-Güte: darunter werden Hautpartien fleckig, darüber wächst nur die Datei. */
private const val AVATAR_GUETE = 85

/**
 * Zwei Durchgänge über den Datenstrom, weil ein Rohfoto nicht als Ganzes in den
 * Speicher soll: erst nur die Maße lesen, dann mit passendem Verkleinerungs-
 * faktor dekodieren.
 */
fun skaliereFuerAvatar(oeffne: () -> InputStream): ByteArray? {
    val masse = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    oeffne().use { BitmapFactory.decodeStream(it, null, masse) }
    if (masse.outWidth <= 0 || masse.outHeight <= 0) return null

    val optionen = BitmapFactory.Options().apply {
        inSampleSize = probenFaktor(masse.outWidth, masse.outHeight, AVATAR_KANTE)
    }
    val grob = oeffne().use { BitmapFactory.decodeStream(it, null, optionen) } ?: return null
    val fertig = aufKante(grob, AVATAR_KANTE)

    return ByteArrayOutputStream().use { puffer ->
        fertig.compress(Bitmap.CompressFormat.JPEG, AVATAR_GUETE, puffer)
        if (fertig !== grob) fertig.recycle()
        grob.recycle()
        puffer.toByteArray()
    }
}

/**
 * Zweierpotenz, mit der BitmapFactory beim Dekodieren gleich verkleinert. Sie
 * bleibt bewusst eine Stufe zu grob (>= statt >), damit für den anschließenden
 * sauberen Skalierschritt noch genug Pixel da sind.
 */
internal fun probenFaktor(breite: Int, hoehe: Int, zielKante: Int): Int {
    var faktor = 1
    while (max(breite, hoehe) / (faktor * 2) >= zielKante) faktor *= 2
    return faktor
}

/** Auf die Zielkante bringen; kleinere Bilder bleiben, wie sie sind. */
private fun aufKante(bild: Bitmap, zielKante: Int): Bitmap {
    val laengste = max(bild.width, bild.height)
    if (laengste <= zielKante) return bild
    val faktor = zielKante.toDouble() / laengste
    return Bitmap.createScaledBitmap(
        bild,
        (bild.width * faktor).roundToInt().coerceAtLeast(1),
        (bild.height * faktor).roundToInt().coerceAtLeast(1),
        true,
    )
}
