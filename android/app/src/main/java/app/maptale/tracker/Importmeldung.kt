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
    // Den Foto-Nachzug nur EINREIHEN, nicht hier ausführen.
    //
    // Er lief einmal an dieser Stelle, damit die Meldung gleich sagen kann, was
    // dazugekommen ist. Das kostete die Meldung: Diese Funktion läuft im
    // Push-Handler, dem Android nur Sekunden gibt — dreizehn Fotos über
    // Mobilfunk sprengen das, der Prozess stirbt mittendrin, und dann gibt es
    // WEDER Fotos noch Benachrichtigung noch Quittung (am Gerät passiert).
    // Gemeldet wird deshalb sofort, was sicher wahr ist: Die Tour ist da. Was
    // der Nachzug ergänzt, meldet er selbst, wenn er es geschafft hat.
    for (tourId in fertige.mapNotNull { it.tourId }) FotoNachzugWorker.starte(app, tourId)
    val text = meldungFuer(fertige)
    if (text == null || zeigeImportMeldung(app, text)) {
        // Nichts zu melden ODER die Meldung steht: In beiden Fällen ist mit den
        // fertigen Importen alles geschehen, was geschehen sollte.
        erledigt += fertige.map { it.id }
    }
    // Scheitert das Abhaken, kommen sie beim nächsten Mal wieder — eine
    // doppelte Meldung ist der harmlosere Ausgang als eine verlorene.
    runCatching { app.apiClient.trackerImporteGesehen(erledigt) }
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
