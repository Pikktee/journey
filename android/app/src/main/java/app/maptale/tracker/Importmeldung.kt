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
import app.maptale.galerie.darfGalerieLesen
import app.maptale.galerie.ladeFotosHoch
import app.maptale.galerie.nachzugSatz
import app.maptale.galerie.suchePassendeFotos
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
    // Fotos ergänzen, BEVOR gemeldet wird: Dann steht in der Meldung, was
    // wirklich geschehen ist („2 neue Touren · 5 Fotos hinzugefügt") statt
    // einer zweiten, die kurz darauf nachklappert. Nur mit stehender
    // Einwilligung UND erteiltem Leserecht — ohne beides passiert hier nichts,
    // und der Vorschlag wartet in der Tour.
    val fotos = ergaenzeFotos(app, fertige)
    val text = meldungFuer(fertige)?.let { if (fotos > 0) "$it · ${nachzugSatz(fotos, automatisch = true)}" else it }
    if (text == null || zeigeImportMeldung(app, text)) {
        // Nichts zu melden ODER die Meldung steht: In beiden Fällen ist mit den
        // fertigen Importen alles geschehen, was geschehen sollte.
        erledigt += fertige.map { it.id }
    }
    // Scheitert das Abhaken, kommen sie beim nächsten Mal wieder — eine
    // doppelte Meldung ist der harmlosere Ausgang als eine verlorene.
    runCatching { app.apiClient.trackerImporteGesehen(erledigt) }
}

/**
 * Fotos zu den neuen Touren ergänzen — wenn die Einwilligung steht.
 *
 * Gibt zurück, wie viele hochgeladen wurden. Drei Bedingungen, und jede
 * einzelne beendet den Lauf still: keine stehende Einwilligung („Fotos
 * automatisch ergänzen" ist aus), kein Leserecht auf die Galerie, keine Tour
 * mit Kennung. Ohne Einwilligung ist das kein Versäumnis — der Vorschlag
 * wartet dann in der Tour selbst, mit einer Frage statt einer Mitteilung.
 */
private suspend fun ergaenzeFotos(app: MaptaleApp, importe: List<TrackerImport>): Int {
    if (!app.einstellungen.aktuellesKonto().fotosAutomatisch) return 0
    if (!darfGalerieLesen(app)) return 0
    var gesamt = 0
    for (tourId in importe.mapNotNull { it.tourId }) {
        val bilder = runCatching { suchePassendeFotos(app, tourId) }.getOrDefault(emptyList())
        if (bilder.isEmpty()) continue
        gesamt += runCatching { ladeFotosHoch(app, tourId, bilder) }.getOrDefault(0)
    }
    return gesamt
}

/** `true`, wenn die Meldung wirklich steht — nur dann darf sie abgehakt werden. */
fun zeigeImportMeldung(context: Context, text: String): Boolean {
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
        .setContentTitle(text)
        .setContentText("Aus deiner verbundenen Uhr — in deiner Bibliothek.")
        .setAutoCancel(true)
        .setContentIntent(oeffnen)
        .build()
    // Dieselbe ID für beide Wege: Kommt eine Push-Nachricht und läuft kurz
    // darauf der periodische Abruf, ERSETZT die zweite Meldung die erste,
    // statt sich danebenzustellen. Der Server sorgt mit `gesehen_am` dafür,
    // dass es meist gar nicht so weit kommt — dies ist die zweite Mauer.
    context.getSystemService(NotificationManager::class.java).notify(MELDUNG_ID, meldung)
    return true
}
