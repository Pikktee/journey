// Der Foto-Nachzug als eigene Arbeit — nicht im Meldungspfad.
//
// **Warum getrennt.** Er lief zuerst mitten in `meldeOffeneImporte`, also in
// einem Push-Handler. Android gibt dem nur Sekunden, bevor der Prozess sterben
// darf; dreizehn Fotos über Mobilfunk brauchen länger. Am Pixel 9 endete das
// so: acht von dreizehn Dateien hochgeladen, dann Prozess weg — kein
// `reprocess`, keine Benachrichtigung, keine Quittung. Die Tour war da, die
// Fotos unsichtbar, und der Nutzer sah gar nichts.
//
// WorkManager ist für genau das gebaut: Er überlebt den Prozess, wartet auf
// Netz und wiederholt mit Backoff. Dieselbe Wahl wie beim `UploadWorker`, und
// aus demselben Grund.
//
// **Die Reihenfolge ist damit umgekehrt und das ist Absicht:** Erst wird die
// Tour gemeldet, dann kommen die Fotos. Die Nachricht „deine Tour ist da" ist
// wahr, sobald die Tour da ist — sie auf einen Upload warten zu lassen, hieß
// eine sichere Nachricht gegen eine unsichere einzutauschen. Was der Nachzug
// hinzufügt, meldet er selbst, wenn er fertig ist.
package app.maptale.galerie

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.maptale.MaptaleApp
import app.maptale.tracker.zeigeImportMeldung
import java.time.Duration

class FotoNachzugWorker(
    context: Context,
    parameter: WorkerParameters,
) : CoroutineWorker(context, parameter) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? MaptaleApp ?: return Result.success()
        val tourId = inputData.getString(EINGABE_TOUR_ID) ?: return Result.success()
        if (!app.einstellungen.aktuellesKonto().angemeldet) return Result.success()
        // Die Einwilligung wird HIER noch einmal gelesen und nicht beim
        // Einreihen mitgegeben: Zwischen dem Einreihen und dem Lauf können
        // Stunden liegen (kein Netz), und wer den Schalter inzwischen
        // ausgemacht hat, meinte auch diese Tour.
        if (!app.einstellungen.aktuellesKonto().fotosAutomatisch) return Result.success()
        if (!darfGalerieLesen(app)) return Result.success()

        val bilder = runCatching { suchePassendeFotos(app, tourId) }.getOrElse { return Result.retry() }
        if (bilder.isEmpty()) return Result.success()

        val geschafft = runCatching { ladeFotosHoch(app, tourId, bilder) }.getOrElse { return Result.retry() }
        // Nichts geschafft, obwohl es etwas zu tun gab: Das war kein Erfolg.
        // Der erneute Anlauf ist gefahrlos — die Einträge tragen ihre `quelle`,
        // der Server legt sie kein zweites Mal an und die fehlenden Dateien
        // werden nachgereicht.
        if (geschafft == 0) return Result.retry()

        nachzugSatz(geschafft, automatisch = true)?.let { zeigeImportMeldung(app, it) }
        return Result.success()
    }

    companion object {
        const val EINGABE_TOUR_ID = "tourId"

        /**
         * Den Nachzug für eine Tour einreihen.
         *
         * `KEEP` je Tour: Push und periodischer Abruf melden dieselbe Tour
         * womöglich beide. Ein zweiter Auftrag würde denselben Lauf noch einmal
         * starten — die Uploads liefen doppelt, auch wenn der Server am Ende
         * nichts doppelt anlegt.
         */
        fun starte(context: Context, tourId: String) {
            val anfrage = OneTimeWorkRequestBuilder<FotoNachzugWorker>()
                .setInputData(workDataOf(EINGABE_TOUR_ID to tourId))
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("fotonachzug-$tourId", ExistingWorkPolicy.KEEP, anfrage)
        }
    }
}
