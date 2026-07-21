// ViewModels der Screens — Schicht zwischen UI und Repository/ApiClient.
// Erzeugt über eine gemeinsame Factory, die die App-Singletons hereinreicht
// (bewusst ohne DI-Framework, wie die DI-Wurzel in LuhamboApp).
package app.luhambo.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.luhambo.LuhamboApp
import app.luhambo.daten.MediumEntity
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourRepository
import app.luhambo.upload.ApiClient
import app.luhambo.upload.Einstellungen
import app.luhambo.upload.Konto
import app.luhambo.upload.ServerTour
import app.luhambo.upload.UploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

class StartViewModel(
    repository: TourRepository,
    private val apiClient: ApiClient,
) : ViewModel() {
    /** Auf diesem Gerät aufgezeichnete/importierte Touren (Room, Live-Flow). */
    val lokaleTouren: Flow<List<TourEntity>> = repository.alleTouren()

    private val internServerTouren = MutableStateFlow<List<ServerTour>>(emptyList())
    /** Touren des angemeldeten Kontos vom Server — inkl. der im Web-Studio erstellten. */
    val serverTouren: StateFlow<List<ServerTour>> = internServerTouren

    init { aktualisiere() }

    /** Server-Liste (neu) laden. Fehler (offline/401) lassen die bisherige Liste stehen. */
    fun aktualisiere() {
        viewModelScope.launch {
            runCatching { apiClient.toureListe() }.onSuccess { internServerTouren.value = it }
        }
    }
}

class TourViewModel(
    private val repository: TourRepository,
    private val appContext: Context,
    private val tourId: String,
) : ViewModel() {
    val tour: Flow<TourEntity?> = repository.tourFluss(tourId)
    val fotoAnzahl: Flow<Int> = repository.medienAnzahl(tourId)

    /** Texte sichern und den Upload-Worker einreihen. */
    fun speichereUndLadeHoch(titel: String?, beschreibung: String?) {
        viewModelScope.launch {
            repository.aktualisiereTexte(tourId, titel?.ifBlank { null }, beschreibung?.ifBlank { null })
            UploadWorker.starte(appContext, tourId)
        }
    }

    fun loesche(danach: () -> Unit) {
        viewModelScope.launch {
            repository.loescheTour(tourId)
            danach()
        }
    }
}

/**
 * Foto-Vollansicht: ein Medium samt Nutzertext („Titel").
 *
 * Gespeichert wird im prozessweiten Scope, nicht im viewModelScope — der Text
 * wird beim Verlassen des Screens gesichert, und da ist das ViewModel schon auf
 * dem Weg nach draußen.
 */
class FotoViewModel(
    private val repository: TourRepository,
    private val appScope: CoroutineScope,
    private val tourId: String,
    private val mediumId: String,
) : ViewModel() {
    val medium: Flow<MediumEntity?> = repository.mediumFluss(tourId, mediumId)

    fun datei(medium: MediumEntity): File = repository.mediumDatei(medium)

    fun setzeTitel(titel: String) {
        appScope.launch { repository.setzeMediumCaption(tourId, mediumId, titel) }
    }

    fun loesche(danach: () -> Unit) {
        viewModelScope.launch {
            repository.loescheMedium(tourId, mediumId)
            danach()
        }
    }
}

class EinstellungenViewModel(
    private val einstellungen: Einstellungen,
    private val apiClient: ApiClient,
) : ViewModel() {

    sealed interface Zustand {
        data object Ruhe : Zustand
        data object Laedt : Zustand
        data class Fehler(val nachricht: String) : Zustand
    }

    val konto: Flow<Konto> = einstellungen.konto
    private val internZustand = MutableStateFlow<Zustand>(Zustand.Ruhe)
    val zustand: StateFlow<Zustand> = internZustand

    fun anmelden(email: String, passwort: String) {
        viewModelScope.launch {
            internZustand.value = Zustand.Laedt
            try {
                // Feste Prod-URL — überschreibt auch einen evtl. veralteten gespeicherten
                // Dev-Wert, sodass alle authentifizierten Aufrufe gegen Prod laufen.
                einstellungen.setzeServer(Einstellungen.STANDARD_SERVER)
                val token = apiClient.login(
                    Einstellungen.STANDARD_SERVER,
                    email.trim(),
                    passwort,
                    geraet = android.os.Build.MODEL ?: "Android",
                )
                einstellungen.setzeAnmeldung(email.trim(), token)
                internZustand.value = Zustand.Ruhe
            } catch (fehler: Exception) {
                internZustand.value = Zustand.Fehler(fehler.message ?: "Anmeldung fehlgeschlagen")
            }
        }
    }

    fun abmelden() {
        viewModelScope.launch { einstellungen.abmelden() }
    }
}

/** Gemeinsame Factory: kennt die App-Singletons und baut jedes ViewModel. */
class LuhamboViewModelFactory(
    private val app: LuhamboApp,
    private val tourId: String? = null,
    private val mediumId: String? = null,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(StartViewModel::class.java) ->
            StartViewModel(app.repository, app.apiClient) as T
        modelClass.isAssignableFrom(TourViewModel::class.java) ->
            TourViewModel(app.repository, app, requireNotNull(tourId) { "tourId fehlt" }) as T
        modelClass.isAssignableFrom(FotoViewModel::class.java) ->
            FotoViewModel(
                app.repository,
                app.appScope,
                requireNotNull(tourId) { "tourId fehlt" },
                requireNotNull(mediumId) { "mediumId fehlt" },
            ) as T
        modelClass.isAssignableFrom(EinstellungenViewModel::class.java) ->
            EinstellungenViewModel(app.einstellungen, app.apiClient) as T
        modelClass.isAssignableFrom(ImportViewModel::class.java) ->
            ImportViewModel(app) as T
        else -> throw IllegalArgumentException("Unbekanntes ViewModel: ${modelClass.name}")
    }
}
