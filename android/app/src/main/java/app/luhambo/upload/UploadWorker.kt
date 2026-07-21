// Upload einer Tour als EIN WorkManager-Worker mit Status je Medium:
// POST Manifest (idempotent über clientTourId) → PUT je Medium (bereits
// hochgeladene werden übersprungen — Wiederaufnahme pro Datei) → Finalize →
// kurzes Status-Polling. WorkManager retried den ganzen Worker mit Backoff;
// da jede Stufe idempotent ist, ist das unbedenklich.
package app.luhambo.upload

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
import app.luhambo.LuhamboApp
import app.luhambo.benennung.TourBenennung
import app.luhambo.daten.MediumUploadStatus
import app.luhambo.daten.TourStatus
import kotlinx.coroutines.delay
import java.time.Duration

/**
 * Fehler, die kein Wiederholen heilt — sie brauchen den Nutzer:
 * 400 ungültiges Manifest, 401 abgelaufene Anmeldung, 403 unbestätigte
 * E-Mail-Adresse, 413 volles Kontingent. Ohne diese Unterscheidung liefe der
 * automatisch angestoßene Upload endlos im Backoff-Kreis.
 */
fun istEndgueltigerUploadFehler(status: Int): Boolean = status in setOf(400, 401, 403, 413)

/** Erklärung für die Tourliste; der Servertext ist meist der bessere. */
fun uploadFehlerText(status: Int, serverText: String?): String = when (status) {
    401 -> "Anmeldung abgelaufen — bitte neu anmelden"
    else -> serverText?.ifBlank { null } ?: "Upload fehlgeschlagen (Fehler $status)"
}

class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val app = context.applicationContext as LuhamboApp

    override suspend fun doWork(): Result {
        val tourId = inputData.getString(EINGABE_TOUR_ID) ?: return Result.failure()
        val repo = app.repository
        val tour = repo.tour(tourId) ?: return Result.failure()

        return try {
            repo.setzeStatus(tourId, TourStatus.LAEDT_HOCH)

            val punkte = repo.punkte(tourId)
            if (punkte.size < 2) {
                repo.setzeStatus(tourId, TourStatus.FEHLER, "Zu wenige Trackpunkte für einen Upload")
                return Result.failure()
            }

            // Auto-Titel nachziehen, falls der Nutzer keinen gesetzt hat (der
            // Geocoder braucht Netz — genau jetzt ist es da)
            var aktuelleTour = tour
            if (aktuelleTour.titel.isNullOrBlank()) {
                val start = punkte.first()
                val ziel = punkte.last()
                val titel = runCatching {
                    app.benennung.benenne(start.lng to start.lat, ziel.lng to ziel.lat)
                }.getOrNull()
                if (titel != null) {
                    repo.aktualisiereTexte(tourId, titel, aktuelleTour.beschreibung)
                    aktuelleTour = repo.tour(tourId) ?: aktuelleTour
                } else if (aktuelleTour.titel == null) {
                    // gar kein Ortsname: Datums-Fallback lokal setzen, damit die
                    // Liste nie namenlos ist (Backend würde identisch benennen)
                    repo.aktualisiereTexte(
                        tourId,
                        TourBenennung.fallbackTitel(aktuelleTour.startMs, aktuelleTour.zone),
                        aktuelleTour.beschreibung,
                    )
                    aktuelleTour = repo.tour(tourId) ?: aktuelleTour
                }
            }

            val manifest = ManifestBau.baue(
                aktuelleTour,
                punkte,
                repo.moduswechsel(tourId),
                repo.medien(tourId),
            )
            val serverId = app.apiClient.tourAnlegen(ManifestBau.alsJson(manifest))
            repo.setzeServerId(tourId, serverId)
            // Wiederholter Upload (clientTourId): der Server behält sein erstes
            // Manifest — lokal geänderte Texte per PATCH nachziehen, sonst
            // erreichen sie den Server nie. Frisch aus der Datenbank gelesen:
            // zwischen Manifest-Bau und hier können Sekunden liegen, in denen
            // der Nutzer den Titel im Entwurf getippt hat.
            val vorPatch = repo.tour(tourId) ?: aktuelleTour
            runCatching { app.apiClient.patchTour(serverId, vorPatch.titel, vorPatch.beschreibung) }

            for (medium in repo.medien(tourId)) {
                if (medium.uploadStatus == MediumUploadStatus.HOCHGELADEN) continue
                app.apiClient.mediumHochladen(serverId, medium.id, repo.mediumDatei(medium))
                repo.setzeMediumHochgeladen(tourId, medium.id)
            }

            try {
                app.apiClient.finalisiere(serverId)
            } catch (fehler: ApiFehler) {
                // 409 ist doppeldeutig („läuft bereits" vs. „Medien fehlen") —
                // semantisch auflösen: nur wenn der Server wirklich arbeitet
                // oder fertig ist, geht es weiter
                val status = if (fehler.status == 409) app.apiClient.tourStatus(serverId) else null
                if (status != "verarbeitung" && status != "bereit") throw fehler
            }

            // Kurz auf „bereit" warten — nur fürs unmittelbare Abspielen; bei
            // Timeout in „verarbeitung" bleibt die Tour hochgeladen (Server
            // rechnet weiter). „angelegt" nach dem Poll wäre dagegen ein Fehler.
            var letzterStatus = ""
            repeat(30) {
                letzterStatus = app.apiClient.tourStatus(serverId)
                when (letzterStatus) {
                    "bereit" -> {
                        repo.setzeStatus(tourId, TourStatus.HOCHGELADEN)
                        gleicheTitelAb(tourId, serverId, manifest)
                        return Result.success(workDataOf(AUSGABE_SERVER_ID to serverId))
                    }
                    "fehler" -> {
                        repo.setzeStatus(tourId, TourStatus.FEHLER, "Server-Verarbeitung fehlgeschlagen")
                        return Result.failure()
                    }
                }
                delay(2_000)
            }
            if (letzterStatus != "verarbeitung") {
                return vermerkeUndRetry(tourId, ApiFehler(0, "Tour blieb im Status „$letzterStatus“"))
            }
            repo.setzeStatus(tourId, TourStatus.HOCHGELADEN)
            gleicheTitelAb(tourId, serverId, manifest)
            Result.success(workDataOf(AUSGABE_SERVER_ID to serverId))
        } catch (fehler: ApiFehler) {
            if (istEndgueltigerUploadFehler(fehler.status)) {
                // Retry hilft nicht, der Nutzer muss ran
                app.repository.setzeStatus(
                    tourId,
                    TourStatus.FEHLER,
                    uploadFehlerText(fehler.status, fehler.message),
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
     * Foto-Titel nachreichen, die WÄHREND des Uploads getippt wurden.
     *
     * Das Manifest ist zu diesem Zeitpunkt längst beim Server; ein danach
     * gesetzter Titel erreichte ihn sonst nie. Nach dem Upload läuft die
     * Beschriftung ohnehin über das Edit-Overlay — genau dieser Weg wird hier
     * einmalig für die Abweichungen gegangen.
     */
    private suspend fun gleicheTitelAb(tourId: String, serverId: String, gesendet: UploadManifest) {
        val imManifest = gesendet.media.associate { it.id to it.caption.orEmpty() }
        val abweichungen = app.repository.medien(tourId)
            .filter { it.caption.orEmpty().trim() != imManifest[it.id].orEmpty() }
        if (abweichungen.isEmpty()) return

        runCatching {
            var overlay = app.apiClient.editsLesen(serverId)
            for (medium in abweichungen) overlay = mitMediumTitel(overlay, medium.id, medium.caption)
            app.apiClient.editsSchreiben(serverId, overlay)
        }.onFailure { fehler ->
            // Kein Grund, den Upload scheitern zu lassen: die Tour ist da, nur
            // ein nachträglich getippter Titel fehlt. Er lässt sich jederzeit
            // im Detail erneut setzen.
            android.util.Log.w("Luhambo", "Foto-Titel konnten nicht nachgereicht werden", fehler)
        }
    }

    private suspend fun vermerkeUndRetry(tourId: String, fehler: Exception): Result {
        // ENTWURF statt FEHLER: WorkManager versucht es mit Backoff erneut,
        // die Tour bleibt in der Liste als „wartet auf Upload" sichtbar
        app.repository.setzeStatus(tourId, TourStatus.ENTWURF, fehler.message)
        return Result.retry()
    }

    companion object {
        const val EINGABE_TOUR_ID = "tourId"
        const val AUSGABE_SERVER_ID = "serverId"

        /** Name der eindeutigen Arbeit je Tour — auch für die Fortschritts-Anzeige. */
        fun arbeitsname(tourId: String): String = "upload-$tourId"

        /**
         * Upload einreihen (einmalig je Tour).
         *
         * `ersetzen = false` für den Nachzügler beim App-Start: ein bereits
         * wartender Versuch (Backoff nach Fehlschlag, oder Warten auf Netz) darf
         * nicht zurückgesetzt und doppelt gestartet werden.
         */
        fun starte(context: Context, tourId: String, ersetzen: Boolean = true) {
            val anfrage = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(EINGABE_TOUR_ID to tourId))
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(15))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                arbeitsname(tourId),
                if (ersetzen) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
                anfrage,
            )
        }
    }
}
