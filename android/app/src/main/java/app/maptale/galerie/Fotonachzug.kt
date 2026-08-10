// Fotos einer Cloud-Tour nachreichen: suchen, hochladen, neu verarbeiten.
//
// Der Track kommt aus der Uhr, die Fotos kann nur das Gerät beisteuern — daran
// hängt der wahrgenommene Wert („meine Tour, meine Bilder"). Der Server-Teil
// ist seit der additiven Medien-Route erprobt; hier steht nur der Weg dorthin.
//
// **Gelesen wird nur mit Zustimmung und nur im Zeitfenster der Tour.** Beide
// Bedingungen sind keine Höflichkeit, sondern die Zusage aus der
// Datenschutzerklärung. Die Einwilligung lebt in der APP und nicht auf dem
// Server: Die Galerie liegt auf dem Gerät, und bei zwei Geräten am selben Konto
// soll nur das mit den Fotos hochladen.
package app.maptale.galerie

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import app.maptale.MaptaleApp
import app.maptale.upload.NachreichMedium
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

/**
 * Das Leserecht auf Bilder — je nach Android-Fassung ein anderes.
 *
 * Ab Android 13 gibt es das feinere `READ_MEDIA_IMAGES`, darunter nur das
 * grobe `READ_EXTERNAL_STORAGE`. Die App fragt es NIE von sich aus ab: Es wird
 * genau dann erfragt, wenn jemand den Foto-Nachzug einschaltet oder einem
 * Vorschlag zustimmt.
 */
val LESERECHT: String =
    if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
    else Manifest.permission.READ_EXTERNAL_STORAGE

fun darfGalerieLesen(context: Context): Boolean =
    ActivityCompat.checkSelfPermission(context, LESERECHT) == PackageManager.PERMISSION_GRANTED

/**
 * Vorschlag für eine Tour: Was läge im Zeitfenster?
 *
 * Lädt NICHTS hoch. **`null` heißt „noch nicht zu beantworten"** — die Tour
 * rendert noch (dann hat sie kein Zeitfenster) oder der Server war nicht
 * erreichbar. Eine LEERE Liste heißt dagegen „beantwortet: nichts dabei".
 *
 * Die Unterscheidung ist der ganze Zweck des Rückgabetyps, und ihr Fehlen hat
 * am Gerät eine Tour ohne Fotos hinterlassen: Der Nachzug startete eine Sekunde
 * bevor die Tour fertig gerendert war, bekam kein Fenster, las das als „nichts
 * gefunden" und gab auf. Zwei andere Touren derselben Runde hatten nur Glück
 * mit dem Zeitpunkt.
 */
suspend fun suchePassendeFotos(app: MaptaleApp, serverTourId: String): List<Galeriebild>? {
    // Ohne Leserecht ist die Frage beantwortet, nicht offen: Ein neuer Anlauf
    // ändert daran nichts, solange niemand die Erlaubnis erteilt.
    if (!darfGalerieLesen(app)) return emptyList()
    val fenster = runCatching { app.apiClient.tourZeitfenster(serverTourId) }.getOrNull() ?: return null
    val startMs = zeitpunkt(fenster.first) ?: return null
    val endeMs = zeitpunkt(fenster.second) ?: return null
    // Was die Tour schon hat, fällt heraus — sonst käme derselbe Vorschlag bei
    // jedem Öffnen wieder, auch für den, der ihn abgelehnt hat. Verglichen wird
    // über den Aufnahmezeitpunkt und nicht über den Dateinamen: Der Server
    // kennt nur den, den wir ihm gegeben haben, und zwei Kameras vergeben
    // fröhlich beide „IMG_0001.jpg".
    val bekannt = runCatching { app.apiClient.tourDetail(serverTourId).fotos }
        .getOrDefault(emptyList())
        .mapNotNull { foto -> foto.aufgenommenIso?.let(::zeitpunkt) }
        .toSet()
    return passendeBilder(bilderImZeitfenster(app, startMs, endeMs), startMs, endeMs, bekannt)
}

/**
 * Die gewählten Fotos zur Tour hochladen.
 *
 * Drei Schritte, und die Reihenfolge ist Pflicht: anmelden (das Manifest
 * wächst, der Server vergibt die IDs) → je Datei hochladen → neu verarbeiten.
 * Wer den letzten Schritt vergisst, hat die Fotos in der Ablage und nicht im
 * Film.
 *
 * Ein einzelnes Bild, das sich nicht öffnen lässt (inzwischen gelöscht, Rechte
 * entzogen), beendet den Lauf NICHT: Der Manifest-Eintrag bleibt dann ohne
 * Datei stehen, und genau dafür filtert der Server Einträge ohne Datei aus der
 * Verarbeitung.
 */
suspend fun ladeFotosHoch(
    app: MaptaleApp,
    serverTourId: String,
    bilder: List<Galeriebild>,
    /** Nach jedem Bild aufgerufen — die Grundlage der Fortschrittsanzeige. */
    beiFortschritt: (fertig: Int, gesamt: Int) -> Unit = { _, _ -> },
): Int = nachzugSperre.withLock {
    if (bilder.isEmpty()) return@withLock 0
    val eintraege = bilder.map { bild ->
        NachreichMedium(
            dateiname = bild.dateiname,
            aufgenommenIso = alsIso(bild.aufgenommenMs),
            // Erst hier gelesen und nicht beim Suchen: Es ist ein Dateizugriff
            // je Bild, und die meisten Vorschläge werden nie hochgeladen.
            anker = gpsAnker(app, bild)?.let { (breite, laenge) -> laenge to breite },
            // Der Idempotenz-Schlüssel: Derselbe Lauf ein zweites Mal legt
            // beim Server nichts Neues an (s. `NachreichMedium.quelle`).
            quelle = "galerie:${bild.id}",
        )
    }
    val ids = runCatching { app.apiClient.medienNachreichen(serverTourId, eintraege) }.getOrElse { fehler ->
        Log.w("Maptale", "Fotos konnten nicht angemeldet werden", fehler)
        return@withLock 0
    }
    // Die Antwort ist Zuordnung über den INDEX. Passt die Länge nicht, ist die
    // Paarung geraten — und ein stilles `zip` lüde Bild B unter der ID von A
    // hoch. Lieber gar nichts tun: Die Einträge stehen im Manifest, der
    // nächste Lauf findet sie über ihre `quelle` wieder.
    if (ids.size != bilder.size) {
        Log.w("Maptale", "Nachreichen antwortete mit ${ids.size} IDs für ${bilder.size} Bilder — abgebrochen")
        return@withLock 0
    }
    var geschafft = 0
    for ((bild, mediumId) in bilder.zip(ids)) {
        val ok = runCatching {
            app.apiClient.mediumHochladen(serverTourId, mediumId) {
                requireNotNull(app.contentResolver.openInputStream(bildUri(bild))) {
                    "Bild ${bild.dateiname} nicht lesbar"
                }
            }
        }.isSuccess
        if (ok) geschafft++ else Log.w("Maptale", "Foto ${bild.dateiname} ließ sich nicht hochladen")
        beiFortschritt(geschafft, bilder.size)
    }
    if (geschafft > 0) {
        // Ohne diesen Schritt lägen die Bilder in der Ablage, aber nicht im
        // Film. Scheitert er (409 während einer laufenden Verarbeitung, Netz
        // weg), ist nichts verloren: Die Einträge stehen im Manifest, und der
        // nächste Lauf reicht sie über ihre `quelle` nicht doppelt ein — er
        // stößt nur das Rendern erneut an.
        runCatching { app.apiClient.neuVerarbeiten(serverTourId) }
            .onFailure { Log.w("Maptale", "Neuverarbeitung nach dem Foto-Nachzug fehlgeschlagen", it) }
    }
    return@withLock geschafft
}

/**
 * Ein Nachzug nach dem anderen.
 *
 * `meldeOffeneImporte` läuft aus ZWEI Richtungen — der Push-Dienst weckt die
 * App, und der periodische `TrackerAbfrageWorker` läuft ohnehin. Trifft eine
 * Push-Nachricht ein, während der Worker arbeitet, liefen beide gleichzeitig
 * durch dieselbe Tour: Zwei parallele `POST …/medien` sehen dasselbe Manifest,
 * und der Idempotenz-Schlüssel greift erst, wenn der erste geschrieben HAT.
 * Der Riegel serialisiert das, was der Server nicht serialisieren kann.
 *
 * Prozessweit und nicht je Tour: Ein Nachzug dauert Sekunden und läuft
 * höchstens ein paar Mal am Tag — eine Karte von Mutexen wäre Buchhaltung für
 * einen Fall, den es nicht gibt.
 */
private val nachzugSperre = Mutex()

/** ISO-8601 mit Zone, wie das Manifest ihn erwartet. */
internal fun alsIso(ms: Long): String = DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(ms))

/**
 * Einen ISO-Zeitstempel des Servers in Millisekunden lesen; null bei Unsinn.
 *
 * `OffsetDateTime` und nicht `Instant.parse`: Der Server schreibt die
 * Tour-Zeiten mit ihrem ÖRTLICHEN Versatz („…T08:12:31+02:00"), und daran
 * scheitert `Instant.parse` — es will ein `Z`. Der Rückfall fängt genau den
 * Fall, in dem doch eines dasteht (die Medien-Zeitstempel).
 */
internal fun zeitpunkt(iso: String): Long? =
    runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()
        ?: runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
