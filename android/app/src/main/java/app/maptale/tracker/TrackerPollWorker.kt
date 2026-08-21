// Der RÜCKFALL, über den die App von neuen Cloud-Touren erfährt.
//
// Der eigentliche Weg ist Push (`MaptalePushService`). Der periodische Lauf
// bleibt trotzdem, weil er drei reale Fälle fängt, die Push nie abdeckt:
// Geräte ohne Play Services, von der Herstellersoftware verschluckte
// Nachrichten, und die Zeit zwischen „Konto verknüpft" und „Push-Token
// registriert".
//
// Das Mindestintervall von WorkManager sind 15 Minuten; wir bleiben dabei. Ein
// Cloud-Import ist nichts, worauf jemand in Sekunden wartet — die Uhr am
// Handgelenk synchronisiert oft selbst erst nach Minuten.
package app.maptale.tracker

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.maptale.MaptaleApp
import java.util.concurrent.TimeUnit

class TrackerPollWorker(
    context: Context,
    parameter: WorkerParameters,
) : CoroutineWorker(context, parameter) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? MaptaleApp ?: return Result.success()
        // Holen, melden, quittieren steht in `Importmeldung.kt` — dieselbe
        // Stelle, die auch der Push benutzt. `retry` gibt es hier nicht: Es
        // zöge den periodischen Lauf nur vor, und der nächste kommt ohnehin.
        notifyPendingImports(app)
        return Result.success()
    }

    companion object {
        private const val NAME = "tracker-poll"

        /**
         * Den periodischen Lauf sicherstellen.
         *
         * `KEEP` und nicht `UPDATE`: Sonst setzte jeder App-Start das Intervall
         * zurück, und bei häufigem Starten liefe die Abfrage nie.
         */
        fun ensure(context: Context) {
            val anfrage = PeriodicWorkRequestBuilder<TrackerPollWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, anfrage)
        }

        /** Beim Abmelden: Es gibt nichts mehr abzufragen. */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
