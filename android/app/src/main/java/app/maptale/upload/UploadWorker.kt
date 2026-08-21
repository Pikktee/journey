// Upload einer Tour als EIN WorkManager-Worker mit Status je Medium:
// POST Manifest (idempotent über clientTourId) → PUT je Medium (bereits
// hochgeladene werden übersprungen — Wiederaufnahme pro Datei) → Finalize →
// kurzes Status-Polling. WorkManager retried den ganzen Worker mit Backoff;
// da jede Stufe idempotent ist, ist das unbedenklich.
//
// **Der Upload läuft als VORDERGRUNDARBEIT, und das ist die Voraussetzung
// dafür, dass er überhaupt stattfindet.** Eine App im Hintergrund-Cache
// bekommt auf Geräten mit eigener Energieverwaltung kein Netz: An einem Xiaomi
// (HyperOS) meldete `dumpsys netpolicy` für die App `effective=APP_BACKGROUND`
// und der JobScheduler `Unsatisfied constraints: CONNECTIVITY`, während
// dasselbe WLAN für jede andere App stand. Die Folge war kein Fehler, sondern
// eine Endlosschleife: Worker startet, findet kein Netz, `vermerkeUndRetry`,
// Backoff, von vorn. Als Vordergrunddienst hat der Prozess `procState=FGS` und
// fällt unter die Ausnahme FOREGROUND — dieselbe, die griff, sobald die App
// nur offen auf dem Schirm lag. Deshalb `setForeground` VOR dem ersten
// Netzzugriff und nicht irgendwann später.
package app.maptale.upload

import android.app.Notification
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.maptale.MaptaleApp
import app.maptale.R
import app.maptale.naming.TourNaming
import app.maptale.data.MediumUploadStatus
import app.maptale.data.TourStatus
import kotlinx.coroutines.delay
import java.time.Duration

/**
 * Fehler, die kein Wiederholen heilt — sie brauchen den Nutzer:
 * 400 ungültiges Manifest, 401 abgelaufene Anmeldung, 403 unbestätigte
 * E-Mail-Adresse, 413 volles Kontingent. Ohne diese Unterscheidung liefe der
 * automatisch angestoßene Upload endlos im Backoff-Kreis.
 */
fun isFinalUploadError(status: Int): Boolean = status in setOf(400, 401, 403, 413)

/** Erklärung für die Tourliste; der Servertext ist meist der bessere. */
fun uploadErrorText(status: Int, serverText: String?): String = when (status) {
    401 -> "Anmeldung abgelaufen, bitte neu anmelden"
    else -> serverText?.ifBlank { null } ?: "Upload fehlgeschlagen (Fehler $status)"
}

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val app = context.applicationContext as MaptaleApp

    override suspend fun doWork(): Result {
        val tourId = inputData.getString(INPUT_TOUR_ID) ?: return Result.failure()
        val repo = app.repository
        val tour = repo.tour(tourId) ?: return Result.failure()

        return try {
            repo.setStatus(tourId, TourStatus.UPLOADING)
            // Vor dem ERSTEN Netzzugriff, sonst ist die Benennung des Ortes
            // schon der Aufruf, der ins Leere läuft.
            zeigeUebertragung(tour.title, 0, 0)

            val points = repo.points(tourId)
            if (points.size < 2) {
                repo.setStatus(tourId, TourStatus.FAILED, "Zu wenige Trackpunkte für einen Upload")
                return Result.failure()
            }

            // Auto-Titel nachziehen, falls der Nutzer keinen gesetzt hat (der
            // Geocoder braucht Netz — genau jetzt ist es da)
            var aktuelleTour = tour
            if (aktuelleTour.title.isNullOrBlank()) {
                val start = points.first()
                val ziel = points.last()
                val title = runCatching {
                    app.naming.buildTitle(start.lng to start.lat, ziel.lng to ziel.lat)
                }.getOrNull()
                if (title != null) {
                    repo.updateTexts(tourId, title, aktuelleTour.description)
                    aktuelleTour = repo.tour(tourId) ?: aktuelleTour
                } else if (aktuelleTour.title == null) {
                    // gar kein Ortsname: Datums-Fallback lokal setzen, damit die
                    // Liste nie namenlos ist (Backend würde identisch benennen)
                    repo.updateTexts(
                        tourId,
                        TourNaming.fallbackTitle(aktuelleTour.startMs, aktuelleTour.zone),
                        aktuelleTour.description,
                    )
                    aktuelleTour = repo.tour(tourId) ?: aktuelleTour
                }
            }

            val manifest = ManifestBuilder.build(
                aktuelleTour,
                points,
                repo.travelModeChanges(tourId),
                repo.media(tourId),
            )
            val serverId = app.apiClient.createTour(ManifestBuilder.toJson(manifest))
            repo.setServerId(tourId, serverId)
            // Wiederholter Upload (clientTourId): der Server behält sein erstes
            // Manifest — lokal geänderte Texte per PATCH nachziehen, sonst
            // erreichen sie den Server nie. Frisch aus der Datenbank gelesen:
            // zwischen Manifest-Bau und hier können Sekunden liegen, in denen
            // der Nutzer den Titel im Entwurf getippt hat.
            val vorPatch = repo.tour(tourId) ?: aktuelleTour
            runCatching { app.apiClient.patchTour(serverId, vorPatch.title, vorPatch.description) }

            // Die Zählung nennt ALLE Medien der Tour, nicht nur die offenen:
            // Nach einem Abbruch bei Datei 9 von 12 stünde sonst „1 von 3" da,
            // und das sieht aus, als finge der Upload wieder von vorn an.
            val media = repo.media(tourId)
            for ((nummer, medium) in media.withIndex()) {
                zeigeUebertragung(aktuelleTour.title, nummer, media.size)
                if (medium.uploadStatus == MediumUploadStatus.UPLOADED) continue
                app.apiClient.uploadMedium(serverId, medium.id, repo.mediumFile(medium))
                repo.setMediumUploaded(tourId, medium.id)
            }
            zeigeUebertragung(aktuelleTour.title, media.size, media.size)

            try {
                app.apiClient.finalize(serverId)
            } catch (fehler: ApiError) {
                // 409 ist doppeldeutig („läuft bereits" vs. „Medien fehlen") —
                // semantisch auflösen: nur wenn der Server wirklich arbeitet
                // oder fertig ist, geht es weiter
                val status = if (fehler.status == 409) app.apiClient.tourStatus(serverId) else null
                if (status != "processing" && status != "ready") throw fehler
            }

            // Kurz auf „bereit" warten — nur fürs unmittelbare Abspielen; bei
            // Timeout in „verarbeitung" bleibt die Tour hochgeladen (Server
            // rechnet weiter). „angelegt" nach dem Poll wäre dagegen ein Fehler.
            var letzterStatus = ""
            repeat(30) {
                letzterStatus = app.apiClient.tourStatus(serverId)
                when (letzterStatus) {
                    "ready" -> {
                        repo.setStatus(tourId, TourStatus.UPLOADED)
                        gleicheTitelAb(tourId, serverId, manifest)
                        return Result.success(workDataOf(OUTPUT_SERVER_ID to serverId))
                    }
                    "failed" -> {
                        repo.setStatus(tourId, TourStatus.FAILED, "Server-Verarbeitung fehlgeschlagen")
                        return Result.failure()
                    }
                }
                delay(2_000)
            }
            if (letzterStatus != "processing") {
                return vermerkeUndRetry(tourId, ApiError(0, "Tour blieb im Status „$letzterStatus“"))
            }
            repo.setStatus(tourId, TourStatus.UPLOADED)
            gleicheTitelAb(tourId, serverId, manifest)
            Result.success(workDataOf(OUTPUT_SERVER_ID to serverId))
        } catch (fehler: ApiError) {
            if (isFinalUploadError(fehler.status)) {
                // Retry hilft nicht, der Nutzer muss ran
                app.repository.setStatus(
                    tourId,
                    TourStatus.FAILED,
                    uploadErrorText(fehler.status, fehler.message),
                )
                Result.failure()
            } else {
                vermerkeUndRetry(tourId, fehler)
            }
        } catch (fehler: Exception) {
            vermerkeUndRetry(tourId, fehler)
        }
    }

    /**
     * WorkManager fragt das ab, wenn es den Auftrag von sich aus in den
     * Vordergrund hebt (auf Android 11 und darunter jeder beschleunigte
     * Auftrag). Es muss dieselbe Meldung sein wie in `zeigeUebertragung`,
     * sonst blitzte beim Start kurz eine zweite auf.
     */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val title = inputData.getString(INPUT_TOUR_ID)?.let { app.repository.tour(it)?.title }
        return vordergrund(meldung(title, 0, 0))
    }

    /**
     * Den Auftrag in den Vordergrund heben und dabei den Stand zeigen.
     *
     * **Der Fehlschlag wird verschluckt, und zwar bewusst.** Ab Android 12
     * lehnt das System den Start eines Vordergrunddienstes aus dem Hintergrund
     * in bestimmten Lagen ab (`ForegroundServiceStartNotAllowedException`).
     * Das ist kein Grund, den Upload aufzugeben: Er läuft dann als gewöhnliche
     * Arbeit weiter und hat dieselben Aussichten wie vor diesem Umbau. Ein
     * `throw` an dieser Stelle hätte aus einer Verbesserung einen neuen
     * Fehlerweg gemacht.
     *
     * Ohne die Benachrichtigungs-Erlaubnis (ab Android 13) läuft der Dienst
     * ebenfalls, nur sieht man ihn nicht. Auch das ist kein Abbruchgrund: Es
     * geht hier um den Netzzugang, die Meldung ist die Gegenleistung dafür.
     */
    private suspend fun zeigeUebertragung(title: String?, fertig: Int, gesamt: Int) {
        runCatching { setForeground(vordergrund(meldung(title, fertig, gesamt))) }
    }

    private fun vordergrund(meldung: Notification) =
        ForegroundInfo(MELDUNG_ID, meldung, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)

    private fun meldung(title: String?, fertig: Int, gesamt: Int): Notification =
        NotificationCompat.Builder(applicationContext, MaptaleApp.CHANNEL_UPLOAD)
            .setSmallIcon(R.drawable.ic_launcher_vordergrund)
            .setContentTitle(title?.ifBlank { null } ?: "Tour wird übertragen")
            .setContentText(
                // „Aufnahmen" wie im Foto-Nachzug: In dem Stapel liegen Fotos
                // und Videos nebeneinander.
                if (gesamt > 0) "Aufnahmen … $fertig von $gesamt" else "Wird übertragen …",
            )
            .setProgress(gesamt, fertig, gesamt <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    /**
     * Foto-Titel nachreichen, die WÄHREND des Uploads getippt wurden.
     *
     * Das Manifest ist zu diesem Zeitpunkt längst beim Server; ein danach
     * gesetzter Titel erreichte ihn sonst nie. Nach dem Upload läuft die
     * Beschriftung ohnehin über das Edit-Overlay — genau dieser Weg wird hier
     * einmalig für die Abweichungen gegangen.
     */
    private suspend fun gleicheTitelAb(tourId: String, serverId: String, gesendet: UploadManifest) {
        val imManifest = gesendet.media.associate { it.id to it.caption.orEmpty() }
        val abweichungen = app.repository.media(tourId)
            .filter { it.caption.orEmpty().trim() != imManifest[it.id].orEmpty() }
        if (abweichungen.isEmpty()) return

        runCatching {
            var overlay = app.apiClient.loadEdits(serverId)
            for (medium in abweichungen) overlay = withMediumCaption(overlay, medium.id, medium.caption)
            app.apiClient.saveEdits(serverId, overlay)
        }.onFailure { fehler ->
            // Kein Grund, den Upload scheitern zu lassen: die Tour ist da, nur
            // ein nachträglich getippter Titel fehlt. Er lässt sich jederzeit
            // im Detail erneut setzen.
            android.util.Log.w("Maptale", "Foto-Titel konnten nicht nachgereicht werden", fehler)
        }
    }

    private suspend fun vermerkeUndRetry(tourId: String, fehler: Exception): Result {
        // ENTWURF statt FEHLER: WorkManager versucht es mit Backoff erneut,
        // die Tour bleibt in der Liste als „wartet auf Upload" sichtbar
        app.repository.setStatus(tourId, TourStatus.DRAFT, fehler.message)
        return Result.retry()
    }

    companion object {
        const val INPUT_TOUR_ID = "tourId"
        const val OUTPUT_SERVER_ID = "serverId"

        /** Eigene ID: 1 gehört der Aufzeichnung, 4711 den Cloud-Importen. */
        private const val MELDUNG_ID = 4712

        /** Name der eindeutigen Arbeit je Tour — auch für die Fortschritts-Anzeige. */
        fun workName(tourId: String): String = "upload-$tourId"

        /**
         * Upload einreihen (einmalig je Tour).
         *
         * `ersetzen = false` für den Nachzügler beim App-Start: ein bereits
         * wartender Versuch (Backoff nach Fehlschlag, oder Warten auf Netz) darf
         * nicht zurückgesetzt und doppelt gestartet werden.
         */
        fun start(context: Context, tourId: String, ersetzen: Boolean = true) {
            val anfrage = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(INPUT_TOUR_ID to tourId))
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(15))
                // Beschleunigt, weil der Upload direkt am Beenden der Aufnahme
                // hängt: Wer die Tour abschließt, erwartet, dass sie GEHT, und
                // nicht, dass sie in einem Wartefenster liegt. Auf einem Gerät
                // im Standby-Bucket RARE (an einem frisch installierten Xiaomi
                // gemessen) ist dieses Fenster viertelstundenlang.
                //
                // `RUN_AS_NON_EXPEDITED_WORK_REQUEST` ist Pflicht und nicht
                // Geschmack: Das Kontingent für beschleunigte Aufträge ist
                // begrenzt, und ohne den Rückfall würde das Einreihen werfen,
                // sobald es aufgebraucht ist. Der Netzzugang hängt ohnehin
                // nicht hieran, sondern am `setForeground` im Auftrag selbst.
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                workName(tourId),
                if (ersetzen) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
                anfrage,
            )
        }
    }
}
