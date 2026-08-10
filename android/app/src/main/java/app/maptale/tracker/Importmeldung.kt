// Was passiert, wenn neue Cloud-Touren da sind — die eine Stelle für BEIDE Wege.
//
// Push (`MaptalePushDienst`) und der periodische Abruf (`TrackerAbfrageWorker`)
// erfahren es verschieden, tun danach aber dasselbe: offene Importe holen,
// melden, quittieren. Getrennt geschrieben liefen die beiden Fassungen
// auseinander — und der Unterschied fiele erst auf einem Gerät auf, auf dem
// genau der andere Weg greift.
package app.maptale.tracker

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import app.maptale.MainActivity
import app.maptale.MaptaleApp
import app.maptale.R
import app.maptale.galerie.FotoNachzugWorker
import app.maptale.galerie.darfGalerieLesen
import app.maptale.upload.TrackerImport

private const val MELDUNG_ID = 4711

/**
 * Offene Importe holen, melden und quittieren.
 *
 * **Geholt wird OHNE `gesehen=1`, abgehakt wird hinterher.** Wer beim Holen
 * quittiert, verliert die Meldung, sobald das Zeigen scheitert — und es
 * scheitert regelmäßig, weil die Benachrichtigungs-Berechtigung ab Android 13
 * fehlen kann. Abgehakt wird deshalb genau, was erledigt IST: das nicht
 * Meldenswerte immer, das Fertige nur bei gestellter Meldung.
 *
 * **Touren, zu denen Fotos erwartet werden, meldet diese Funktion NICHT** —
 * dafür ist der `FotoNachzugWorker` zuständig, und zwar erst, wenn er fertig
 * ist. Der Grund ist keine Ästhetik: Eine Cloud-Tour ohne Bilder ist zwar oft
 * vollständig (wer nicht fotografiert hat, hat eine Tour aus Track und
 * Kamerafahrt) — aber wenn Bilder KOMMEN SOLLEN und noch fehlen, sieht sie
 * kaputt aus. Ob welche kommen, weiß der Nachzug nach einem Galerie-Scan, und
 * der ist eine Datenbankabfrage von Millisekunden; langsam ist nur das
 * Hochladen. Also entscheidet er, und diese Funktion reicht ihm die Tour
 * einfach weiter.
 *
 * Wirft nicht: Kein Netz, Server weg, Token abgelaufen — nichts davon ist ein
 * Grund für eine Meldung, und der nächste Anlauf kommt ohnehin.
 */
suspend fun meldeOffeneImporte(app: MaptaleApp) {
    if (!app.einstellungen.aktuellesKonto().angemeldet) return
    val offene = runCatching { app.apiClient.trackerOffeneImporte(quittieren = false) }.getOrElse { return }
    if (offene.isEmpty()) return

    val (fertige, uebrige) = offene.partition { it.status == "fertig" }
    // Übersprungenes und Fehler sind bewusst KEINE Benachrichtigung (s.
    // CLAUDE.md) — sie gelten damit als behandelt und werden abgehakt, sonst
    // stünden sie bis in alle Ewigkeit als „offen" auf dem Server.
    val erledigt = uebrige.map { it.id }.toMutableList()

    // Wer Fotos erwartet, gibt seine Tour an den Nachzug ab; er meldet und
    // quittiert sie dann selbst. Ohne Einwilligung oder ohne Leserecht gibt es
    // nichts zu erwarten, und die Tour wird hier sofort gemeldet.
    val nachzugLaeuft = app.einstellungen.aktuellesKonto().fotosAutomatisch && darfGalerieLesen(app)
    val (anNachzug, sofort) = fertige.partition { nachzugLaeuft && it.tourId != null }
    for (i in anNachzug) FotoNachzugWorker.starte(app, i.tourId!!, i.id)

    val meldung = beschreibeTouren(app, sofort)
    if (meldung == null || zeigeImportMeldung(app, meldung.first, meldung.second)) {
        erledigt += sofort.map { it.id }
    }
    // Scheitert das Abhaken, kommen sie beim nächsten Mal wieder — eine
    // doppelte Meldung ist der harmlosere Ausgang als eine verlorene.
    runCatching { app.apiClient.trackerImporteGesehen(erledigt) }
}

/**
 * Überschrift und Unterzeile einer Meldung über neue Touren.
 *
 * Vorher stand als Überschrift „Eine neue Tour ist da" und darunter ein Satz
 * ohne Inhalt. Jetzt steht oben, worum es geht, und darunter, woran man es
 * wiedererkennt:
 *
 *     Runde bei Frankfurt am Main
 *     Polar · 4,2 km · 12 Fotos
 *
 * Die Herkunft gehört dazu, weil man mehrere Dienste verbunden haben kann. Bei
 * MEHREREN Touren auf einmal bleibt es bei der Zählung als Überschrift — drei
 * Titel in einer Zeile liest niemand.
 *
 * Ein Netzfehler kostet nur die Kennzahlen, nicht die Meldung: Titel und
 * Kilometer stehen in der Tourliste, und die zu holen kann schiefgehen. Dann
 * bleibt die allgemeine Überschrift.
 */
suspend fun beschreibeTouren(
    app: MaptaleApp,
    importe: List<TrackerImport>,
    fotos: Int? = null,
): Pair<String, String>? {
    val allgemein = meldungFuer(importe) ?: return null
    val anbieter = importe.mapNotNull { it.anbieter.ifBlank { null } }.distinct().joinToString(", ") {
        it.replaceFirstChar(Char::uppercase)
    }
    if (importe.size > 1) return allgemein to anbieter
    val tour = runCatching { app.apiClient.toureListe().firstOrNull { it.id == importe[0].tourId } }.getOrNull()
    val teile = buildList {
        if (anbieter.isNotBlank()) add(anbieter)
        tour?.km?.let { add(String.format(java.util.Locale.GERMANY, "%.1f km", it)) }
        fotos?.takeIf { it > 0 }?.let { add(if (it == 1) "1 Foto" else "$it Fotos") }
    }
    return (tour?.titel?.ifBlank { null } ?: allgemein) to teile.joinToString(" · ")
}

/**
 * Die laufende Meldung, solange Bilder hochgehen.
 *
 * **Warum überhaupt eine.** Eine Tour, deren Fotos noch unterwegs sind, sieht
 * für einen Moment unfertig aus. Sie deshalb zu verschweigen, bis alles da ist,
 * hieße: bei schlechtem Netz erfährt man minutenlang gar nichts. Der ehrliche
 * dritte Weg ist zu ZEIGEN, was gerade passiert — dann ist die halbe Tour kein
 * Defekt mehr, sondern ein Zwischenstand mit sichtbarem Ende.
 *
 * `setOngoing` verhindert das versehentliche Wegwischen; die Meldung räumt sich
 * selbst weg, sobald die endgültige sie ersetzt (gleiche ID). `setOnlyAlertOnce`
 * ist Pflicht: Ohne das vibrierte das Telefon bei JEDEM Bild.
 */
fun zeigeFortschritt(context: Context, titel: String, fertig: Int, gesamt: Int): Boolean {
    if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
        != PackageManager.PERMISSION_GRANTED
    ) return false
    val meldung = NotificationCompat.Builder(context, MaptaleApp.KANAL_IMPORTE)
        .setSmallIcon(R.drawable.ic_launcher_vordergrund)
        .setContentTitle(titel)
        .setContentText(
            // „Aufnahmen" und nicht „Fotos": Seit dem Video-Nachzug kann in dem
            // Stapel beides liegen, und die Meldung soll nichts benennen, was
            // vielleicht gar nicht dabei ist.
            if (gesamt > 0) "Aufnahmen werden ergänzt … $fertig von $gesamt" else "Tour wird vorbereitet …",
        )
        .setProgress(gesamt, fertig, gesamt <= 0)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .build()
    context.getSystemService(NotificationManager::class.java).notify(MELDUNG_ID, meldung)
    return true
}

/**
 * `true`, wenn die Meldung wirklich steht — nur dann darf sie abgehakt werden.
 *
 * Dieselbe ID für alle Wege: Kommt eine Push-Nachricht und läuft kurz darauf
 * der periodische Abruf, ERSETZT die zweite Meldung die erste, statt sich
 * danebenzustellen.
 */
fun zeigeImportMeldung(context: Context, titel: String, unterzeile: String = ""): Boolean {
    // Ab Android 13 ist die Berechtigung Pflicht. Fehlt sie, wird nichts
    // gezeigt — und der Import bleibt OFFEN: Er wartet dann darauf, dass die
    // Berechtigung erteilt wird, statt ungesehen zu verschwinden.
    if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
        != PackageManager.PERMISSION_GRANTED
    ) return false
    val oeffnen = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        },
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val meldung = NotificationCompat.Builder(context, MaptaleApp.KANAL_IMPORTE)
        .setSmallIcon(R.drawable.ic_launcher_vordergrund)
        .setContentTitle(titel)
        .apply { if (unterzeile.isNotBlank()) setContentText(unterzeile) }
        .setAutoCancel(true)
        .setContentIntent(oeffnen)
        .build()
    context.getSystemService(NotificationManager::class.java).notify(MELDUNG_ID, meldung)
    return true
}
