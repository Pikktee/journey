// Die Galerie des Geräts befragen — der einzige Teil des Nachzugs, der Android
// braucht. Was danach mit den Bildern geschieht, steht in `Fotonachzug.kt`,
// welche in Frage kommen in `Fotofenster.kt`.
//
// **Gelesen wird NUR im Zeitfenster einer Tour.** Die Abfrage trägt das Fenster
// in ihrer WHERE-Klausel; es gibt bewusst keine Funktion, die „alle Bilder"
// liefert. Das ist keine Sparsamkeit im Code, sondern die Zusage aus der
// Datenschutzerklärung: gelesen wird, was zur Reise gehört, und sonst nichts.
package app.maptale.gallery

import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import androidx.exifinterface.media.ExifInterface

/**
 * Bilder im Zeitfenster einer Tour.
 *
 * Zwei Dinge, die man beim Umbauen zerstört:
 *
 * **`DATE_TAKEN` und nicht `DATE_ADDED`.** Das eine ist der Auslösezeitpunkt
 * (aus dem EXIF, in Millisekunden UTC), das andere der Moment, in dem die Datei
 * im Speicher landete. Wer sein Handy nach der Tour an den Rechner hängt oder
 * Bilder aus der Cloud zurückholt, hat ein `DATE_ADDED` von heute — und bekäme
 * dann alles oder nichts vorgeschlagen.
 *
 * **`BUCKET_DISPLAY_NAME` wird mitgelesen, nicht nachgeschlagen.** Der Ordner
 * entscheidet, ob es eine Kameraaufnahme ist (s. `isCameraImage`); ihn später
 * je Bild einzeln zu erfragen wären hunderte Abfragen für eine Frage, die schon
 * beantwortet in der Zeile steht.
 *
 * Fehlt die Leseberechtigung, wirft der ContentResolver — gefangen, weil ein
 * Vorschlag, der nicht zustande kommt, kein Grund ist, irgendetwas abzubrechen.
 */
fun imagesInWindow(context: Context, startMs: Long, endMs: Long): List<GalleryItem> {
    val fenster = searchWindow(startMs, endMs)
    // ZWEI Abfragen, weil MediaStore zwei Sammlungen führt. Videos fehlten hier
    // bis 2026-08-10 vollständig: Wer unterwegs filmte, bekam sie nie
    // vorgeschlagen — obwohl die Pipeline sie längst annimmt (Transcode,
    // Poster, Faststart). Zusammengeführt wird nach Zeit, damit die Vorschläge
    // in der Reihenfolge der Aufnahme stehen und nicht in zwei Blöcken.
    return (
        frage(context, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, fenster, isVideo = false) +
            frage(context, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, fenster, isVideo = true)
        ).sortedBy { it.takenAtMs }
}

/**
 * Eine der beiden Sammlungen befragen.
 *
 * Die Spaltennamen sind in `MediaStore.Images` und `MediaStore.Video`
 * dieselben Zeichenketten (beide erben von `MediaColumns`) — deshalb eine
 * Funktion und keine zwei. `DATE_TAKEN` gibt es in beiden; bei Video füllt
 * Android es aus den Container-Metadaten.
 */
private fun frage(
    context: Context,
    sammlung: Uri,
    fenster: LongRange,
    isVideo: Boolean,
): List<GalleryItem> {
    // OHNE LATITUDE/LONGITUDE: Seit Android 10 gibt MediaStore dort immer 0
    // zurück — der Ort steckt nur noch im EXIF des Originals und ist erst mit
    // `ACCESS_MEDIA_LOCATION` lesbar (s. `gpsAnchor`). Die Spalten mitzuführen
    // sähe aus, als käme etwas heraus, und läge in Wahrheit im Golf von Guinea.
    val spalten = arrayOf(
        MediaStore.MediaColumns._ID,
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.DATE_TAKEN,
        MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
    )
    val bedingung = "${MediaStore.MediaColumns.DATE_TAKEN} BETWEEN ? AND ?"
    val werte = arrayOf(fenster.first.toString(), fenster.last.toString())
    return try {
        context.contentResolver.query(
            sammlung,
            spalten,
            bedingung,
            werte,
            "${MediaStore.MediaColumns.DATE_TAKEN} ASC",
        )?.use { zeiger -> leseBilder(zeiger, isVideo) } ?: emptyList()
    } catch (fehler: SecurityException) {
        Log.w("Maptale", "Galerie nicht lesbar — kein Vorschlag", fehler)
        emptyList()
    }
}

private fun leseBilder(zeiger: Cursor, isVideo: Boolean): List<GalleryItem> {
    val spalteId = zeiger.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
    val spalteName = zeiger.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
    val spalteZeit = zeiger.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_TAKEN)
    val spalteOrdner = zeiger.getColumnIndexOrThrow(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
    val bilder = mutableListOf<GalleryItem>()
    while (zeiger.moveToNext()) {
        bilder += GalleryItem(
            id = zeiger.getLong(spalteId),
            fileName = zeiger.getString(spalteName) ?: if (isVideo) "video.mp4" else "foto.jpg",
            takenAtMs = zeiger.getLong(spalteZeit),
            folder = if (zeiger.isNull(spalteOrdner)) null else zeiger.getString(spalteOrdner),
            isVideo = isVideo,
        )
    }
    return bilder
}

/**
 * Die Adresse einer Galerie-Aufnahme im MediaStore.
 *
 * Die Sammlung muss zur Art passen: Eine Video-ID an
 * `Images.EXTERNAL_CONTENT_URI` gehängt zeigt entweder auf nichts oder — weil
 * die IDs pro Sammlung vergeben werden — auf ein FREMDES Bild.
 */
fun imageUri(bild: GalleryItem): Uri =
    ContentUris.withAppendedId(
        if (bild.isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
        bild.id,
    )

/**
 * Den GPS-Ort eines Bildes aus seinem EXIF lesen — als [breite, länge].
 *
 * **Android REDIGIERT den Ort standardmäßig.** Ab Android 10 liefert der
 * ContentResolver eine Kopie ohne GPS-Tags; nur `setRequireOriginal` gibt das
 * Original heraus, und das setzt `ACCESS_MEDIA_LOCATION` voraus. Ohne die
 * Erlaubnis kommt hier schlicht nichts zurück — dann verankert die Zeit, und
 * das ist der normale, brauchbare Fall (die Tour hat ja einen Track).
 *
 * Erst beim Hochladen aufgerufen und nicht beim Suchen: Es ist ein Dateizugriff
 * je Bild, und die meisten Bilder eines Vorschlags werden nie hochgeladen.
 *
 * **Videos werden gar nicht erst geöffnet.** Ihr Ort steckt nicht im EXIF,
 * sondern als `©xyz`-Atom im MP4-Container, den `ExifInterface` nicht liest —
 * herauskommen würde `null`, nur nach einem Dateizugriff für nichts. Sie
 * verankert die Zeit, und das ist bei einer laufenden Aufzeichnung ohnehin der
 * genauere Weg: Ein Video hat eine Dauer, sein GPS-Punkt nur einen Anfang.
 */
fun gpsAnchor(context: Context, bild: GalleryItem): Pair<Double, Double>? = if (bild.isVideo) null else try {
    val uri = MediaStore.setRequireOriginal(imageUri(bild))
    context.contentResolver.openInputStream(uri)?.use { strom ->
        ExifInterface(strom).latLong?.let { (lat, lng) -> lat to lng }
    }
} catch (fehler: Exception) {
    // Keine Erlaubnis, kein EXIF, Datei inzwischen weg: Alles kein Grund, den
    // Nachzug abzubrechen — ohne Anker platziert der Server über die Zeit.
    Log.d("Maptale", "Kein GPS im Bild ${bild.fileName}: ${fehler.message}")
    null
}
