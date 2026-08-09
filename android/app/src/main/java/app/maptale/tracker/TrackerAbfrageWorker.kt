// Der RÜCKFALL, über den die App von neuen Cloud-Touren erfährt.
//
// Der eigentliche Weg ist Push (Etappe 6 des Konzepts) — der ist hier noch
// nicht gebaut, und selbst wenn: Ein periodischer Lauf fängt drei reale Fälle,
// die Push nie abdeckt — Geräte ohne Play Services, von der Herstellersoftware
// verschluckte Nachrichten, und die Zeit zwischen „Konto verknüpft" und
// „Push-Token registriert".
//
// Das Mindestintervall von WorkManager sind 15 Minuten; wir bleiben dabei. Ein
// Cloud-Import ist nichts, worauf jemand in Sekunden wartet — die Uhr am
// Handgelenk synchronisiert oft selbst erst nach Minuten.
package app.maptale.tracker

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.maptale.MainActivity
import app.maptale.MaptaleApp
import app.maptale.R
import java.util.concurrent.TimeUnit

class TrackerAbfrageWorker(
    context: Context,
    parameter: WorkerParameters,
) : CoroutineWorker(context, parameter) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? MaptaleApp ?: return Result.success()
        if (!app.einstellungen.aktuellesKonto().angemeldet) return Result.success()

        val offene = runCatching { app.apiClient.trackerOffeneImporte(quittieren = true) }
            .getOrElse {
                // Kein Netz, Server weg, Token abgelaufen: Das ist kein Grund
                // für eine Meldung. `retry` würde den periodischen Lauf nur
                // vorziehen — der nächste kommt ohnehin.
                return Result.success()
            }
        meldungFuer(offene)?.let { zeigeMeldung(applicationContext, it) }
        return Result.success()
    }

    private fun zeigeMeldung(context: Context, text: String) {
        // Ab Android 13 ist die Berechtigung Pflicht. Fehlt sie, wird still
        // nichts gezeigt — die Importe sind bereits quittiert, und die Liste im
        // Konto zeigt sie ohnehin.
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) return
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
        context.getSystemService(NotificationManager::class.java).notify(MELDUNG_ID, meldung)
    }

    companion object {
        private const val NAME = "tracker-abfrage"
        private const val MELDUNG_ID = 4711

        /**
         * Den periodischen Lauf sicherstellen.
         *
         * `KEEP` und nicht `UPDATE`: Sonst setzte jeder App-Start das Intervall
         * zurück, und bei häufigem Starten liefe die Abfrage nie.
         */
        fun sicherstellen(context: Context) {
            val anfrage = PeriodicWorkRequestBuilder<TrackerAbfrageWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, anfrage)
        }

        /** Beim Abmelden: Es gibt nichts mehr abzufragen. */
        fun beenden(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
