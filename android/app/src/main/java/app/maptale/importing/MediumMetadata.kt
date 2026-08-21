// Metadaten importierter Medien: Aufnahmezeit + GPS aus EXIF (Fotos). Der Server
// platziert Medien über GPS (nah am Track) oder ersatzweise über die Zeit —
// beides liefern wir hier, soweit die Datei es hergibt. Videos tragen selten
// verwertbares EXIF; für sie bleibt die Zeit (letzte Änderung) und der Server
// platziert über die Zeitachse.
package app.maptale.importing

import androidx.exifinterface.media.ExifInterface
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

data class MediumMetadata(val takenAtMs: Long?, val lat: Double?, val lng: Double?)

object MediumMetadataReader {

    // EXIF-Datum ist „yyyy:MM:dd HH:mm:ss" in lokaler Kamerazeit (ohne Zone).
    private val exifFormat = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC") // ohne Zoneninfo: als UTC lesen (bester Aufwand)
    }

    /**
     * Liest Aufnahmezeit und GPS aus einem Bild-Stream. Wirft nie — fehlende
     * oder kaputte EXIF-Felder werden zu null (der Aufrufer fällt dann auf die
     * Datei-Änderungszeit bzw. Zeit-Platzierung zurück).
     */
    fun read(input: InputStream): MediumMetadata = runCatching {
        val exif = ExifInterface(input)
        val zeit = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
            ?: exif.getAttribute(ExifInterface.TAG_DATETIME)
        val ms = zeit?.let { runCatching { exifFormat.parse(it)?.time }.getOrNull() }
        val latLng = exif.latLong // FloatArray? [lat, lng] oder null
        MediumMetadata(
            takenAtMs = ms,
            lat = latLng?.get(0)?.toDouble(),
            lng = latLng?.get(1)?.toDouble(),
        )
    }.getOrElse { MediumMetadata(null, null, null) }
}
