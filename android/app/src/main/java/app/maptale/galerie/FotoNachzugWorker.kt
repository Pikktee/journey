// Der Foto-Nachzug als eigene Arbeit — und der, der die Tour meldet.
//
// **Warum getrennt vom Meldungspfad.** Er lief zuerst mitten in
// `meldeOffeneImporte`, also in einem Push-Handler. Android gibt dem nur
// Sekunden, bevor der Prozess sterben darf; dreizehn Fotos über Mobilfunk
// brauchen länger. Am Pixel 9 endete das so: acht von dreizehn Dateien
// hochgeladen, dann Prozess weg — kein `reprocess`, keine Benachrichtigung,
// keine Quittung. WorkManager überlebt den Prozess, wartet auf Netz und
// wiederholt mit Backoff; dieselbe Wahl wie beim `UploadWorker`.
//
// **Warum er auch die MELDUNG macht.** Eine Cloud-Tour ohne Bilder ist oft
// vollständig — wer nicht fotografiert hat, hat eine Tour aus Track und
// Kamerafahrt. Sie wirkt aber kaputt, wenn Bilder kommen SOLLEN und noch
// fehlen. Ob welche kommen, weiß erst der Galerie-Scan, und der kostet
// Millisekunden. Also meldet dieser Auftrag: sofort, wenn nichts dazukommt,
// und sonst erst, wenn die Bilder da sind. Eine Meldung, eine Wahrheit.
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
import app.maptale.tracker.beschreibeTouren
import app.maptale.tracker.zeigeFortschritt
import app.maptale.tracker.zeigeImportMeldung
import app.maptale.upload.TrackerImport
import java.time.Duration

/**
 * Nach so vielen vergeblichen Anläufen wird die Tour OHNE Fotos gemeldet.
 *
 * Der Deckel ist die Antwort auf den Einwand gegen „erst melden, wenn alles
 * fertig ist": Ohne ihn bliebe eine Tour, deren Fotos partout nicht hochgehen,
 * für immer unerwähnt. Vier Versuche mit exponentiellem Backoff sind gut eine
 * Viertelstunde — danach ist die Nachricht wichtiger als ihre Vollständigkeit.
 *
 * **Er greift NICHT bei fehlendem Netz.** Der Auftrag trägt
 * `NetworkType.CONNECTED`, läuft also erst gar nicht los, und `runAttemptCount`
 * steigt dabei nicht. Das ist Absicht: Ohne Netz hätte die App von der Tour
 * nie erfahren (Push, Importliste und Tourliste kommen alle über die
 * Verbindung), und eine Meldung ohne Titel und Kilometer wäre die schlechtere
 * Auskunft über eine Tour, die man gerade ohnehin nicht ansehen kann. Gemeldet
 * wird, sobald wieder Netz da ist.
 *
 * Was der Deckel fängt, ist der Fall MIT Netz: Server antwortet nicht, Tour
 * rendert noch, Upload bricht ab.
 */
private const val MAX_VERSUCHE_BIS_MELDUNG = 4

class FotoNachzugWorker(
    context: Context,
    parameter: WorkerParameters,
) : CoroutineWorker(context, parameter) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? MaptaleApp ?: return Result.success()
        val tourId = inputData.getString(EINGABE_TOUR_ID) ?: return Result.success()
        val importId = inputData.getString(EINGABE_IMPORT_ID)
        if (!app.einstellungen.aktuellesKonto().angemeldet) return Result.success()
        // Die Einwilligung wird HIER noch einmal gelesen und nicht beim
        // Einreihen mitgegeben: Zwischen dem Einreihen und dem Lauf können
        // Stunden liegen (kein Netz), und wer den Schalter inzwischen
        // ausgemacht hat, meinte auch diese Tour. Gemeldet wird sie trotzdem —
        // sie ist ja da.
        if (!app.einstellungen.aktuellesKonto().fotosAutomatisch || !darfGalerieLesen(app)) {
            return melde(app, tourId, importId, 0)
        }

        // `null` heißt „noch nicht zu beantworten" — die Tour rendert gerade, es
        // gibt also noch kein Zeitfenster. Das ist ein Grund zu WARTEN, nicht
        // aufzugeben: Genau hier ging eine Tour leer aus, weil der Nachzug eine
        // Sekunde vor dem Ende des Renderns lief.
        val bilder = runCatching { suchePassendeFotos(app, tourId) }.getOrNull() ?: return spaeter(app, tourId, importId)
        // Nichts zu ergänzen: Die Tour ist vollständig, wie sie ist.
        if (bilder.isEmpty()) return melde(app, tourId, importId, 0)

        // Ab jetzt ist sichtbar, dass etwas läuft: Titel der Tour plus „Fotos
        // werden ergänzt … 3 von 12". Die endgültige Meldung ersetzt sie später
        // über dieselbe ID.
        val titelJetzt = beschreibeTouren(app, listOf(alsImport(tourId, importId)))?.first ?: ""
        zeigeFortschritt(app, titelJetzt, 0, bilder.size)
        val geschafft = runCatching {
            ladeFotosHoch(app, tourId, bilder) { fertig, gesamt -> zeigeFortschritt(app, titelJetzt, fertig, gesamt) }
        }.getOrDefault(0)
        // Nichts geschafft, obwohl es etwas zu tun gab: Das war kein Erfolg.
        // Der erneute Anlauf ist gefahrlos — die Einträge tragen ihre `quelle`,
        // der Server legt sie kein zweites Mal an und die fehlenden Dateien
        // werden nachgereicht.
        if (geschafft == 0) return spaeter(app, tourId, importId)
        return melde(app, tourId, importId, geschafft)
    }

    /**
     * Später noch einmal — aber nicht endlos schweigen.
     *
     * Am Deckel wird die Tour ohne ihre Bilder gemeldet und quittiert: Eine
     * verspätete unvollständige Nachricht ist besser als gar keine.
     */
    private suspend fun spaeter(app: MaptaleApp, tourId: String, importId: String?): Result {
        if (runAttemptCount + 1 < MAX_VERSUCHE_BIS_MELDUNG) return Result.retry()
        melde(app, tourId, importId, 0)
        return Result.retry()
    }

    /**
     * Die Tour melden und den Import quittieren.
     *
     * Quittiert wird NUR bei gestellter Meldung — dieselbe Regel wie im
     * Meldungspfad: Wer abhakt, ohne gezeigt zu haben, verliert die Nachricht,
     * sobald die Benachrichtigungs-Berechtigung fehlt.
     */
    private fun alsImport(tourId: String, importId: String?) =
        TrackerImport(id = importId ?: "", anbieter = "", status = "fertig", tourId = tourId, fehler = null)

    private suspend fun melde(app: MaptaleApp, tourId: String, importId: String?, fotos: Int): Result {
        val (titel, unterzeile) = beschreibeTouren(app, listOf(alsImport(tourId, importId)), fotos)
            ?: return Result.success()
        if (zeigeImportMeldung(app, titel, unterzeile) && importId != null) {
            runCatching { app.apiClient.trackerImporteGesehen(listOf(importId)) }
        }
        return Result.success()
    }

    companion object {
        const val EINGABE_TOUR_ID = "tourId"
        const val EINGABE_IMPORT_ID = "importId"

        /**
         * Den Nachzug für eine Tour einreihen.
         *
         * `KEEP` je Tour: Push und periodischer Abruf melden dieselbe Tour
         * womöglich beide. Ein zweiter Auftrag würde denselben Lauf noch einmal
         * starten — die Uploads liefen doppelt, auch wenn der Server am Ende
         * nichts doppelt anlegt.
         */
        fun starte(context: Context, tourId: String, importId: String? = null) {
            val anfrage = OneTimeWorkRequestBuilder<FotoNachzugWorker>()
                .setInputData(workDataOf(EINGABE_TOUR_ID to tourId, EINGABE_IMPORT_ID to importId))
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("fotonachzug-$tourId", ExistingWorkPolicy.KEEP, anfrage)
        }
    }
}
