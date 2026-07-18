// ViewModels der Screens — Schicht zwischen UI und Repository/ApiClient.
// Erzeugt über eine gemeinsame Factory, die die App-Singletons hereinreicht
// (bewusst ohne DI-Framework, wie die DI-Wurzel in LuhamboApp).
package app.luhambo.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.luhambo.LuhamboApp
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourRepository
import app.luhambo.upload.ApiClient
import app.luhambo.upload.Einstellungen
import app.luhambo.upload.Konto
import app.luhambo.upload.UploadWorker
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class StartViewModel(repository: TourRepository) : ViewModel() {
    val touren: Flow<List<TourEntity>> = repository.alleTouren()
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

    fun anmelden(server: String, email: String, passwort: String) {
        viewModelScope.launch {
            internZustand.value = Zustand.Laedt
            try {
                einstellungen.setzeServer(server)
                val token = apiClient.login(
                    server.trim().trimEnd('/'),
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

    fun abmelden(server: String?) {
        viewModelScope.launch {
            server?.let { einstellungen.setzeServer(it) }
            einstellungen.abmelden()
        }
    }
}

/** Gemeinsame Factory: kennt die App-Singletons und baut jedes ViewModel. */
class LuhamboViewModelFactory(
    private val app: LuhamboApp,
    private val tourId: String? = null,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(StartViewModel::class.java) ->
            StartViewModel(app.repository) as T
        modelClass.isAssignableFrom(TourViewModel::class.java) ->
            TourViewModel(app.repository, app, requireNotNull(tourId) { "tourId fehlt" }) as T
        modelClass.isAssignableFrom(EinstellungenViewModel::class.java) ->
            EinstellungenViewModel(app.einstellungen, app.apiClient) as T
        modelClass.isAssignableFrom(ImportViewModel::class.java) ->
            ImportViewModel(app) as T
        else -> throw IllegalArgumentException("Unbekanntes ViewModel: ${modelClass.name}")
    }
}
