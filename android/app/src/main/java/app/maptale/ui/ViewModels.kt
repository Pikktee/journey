// ViewModels der Screens — Schicht zwischen UI und Repository/ApiClient.
// Erzeugt über eine gemeinsame Factory, die die App-Singletons hereinreicht
// (bewusst ohne DI-Framework, wie die DI-Wurzel in MaptaleApp).
package app.maptale.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import app.maptale.MaptaleApp
import app.maptale.data.MediumEntity
import app.maptale.gallery.GalleryItem
import app.maptale.gallery.uploadPhotos
import app.maptale.gallery.findMatchingPhotos
import app.maptale.data.TourEntity
import app.maptale.data.TourRepository
import app.maptale.upload.ApiClient
import app.maptale.upload.ApiError
import app.maptale.upload.Settings
import app.maptale.upload.Account
import app.maptale.upload.AccountState
import app.maptale.upload.TrackerProvider
import app.maptale.recording.TrackPoint
import app.maptale.recording.thinOut
import app.maptale.upload.ServerTour
import app.maptale.upload.ServerTourDetail
import app.maptale.upload.UploadWorker
import app.maptale.upload.withMediumCaption
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class StartViewModel(
    repository: TourRepository,
    private val apiClient: ApiClient,
) : ViewModel() {
    /** Auf diesem Gerät aufgezeichnete/importierte Touren (Room, Live-Flow). */
    val localTours: Flow<List<TourEntity>> = repository.allTours()

    private val internServerTouren = MutableStateFlow<List<ServerTour>>(emptyList())
    /** Touren des angemeldeten Kontos vom Server — inkl. der im Web-Studio erstellten. */
    val serverTours: StateFlow<List<ServerTour>> = internServerTouren

    init { refresh() }

    /** Server-Liste (neu) laden. Fehler (offline/401) lassen die bisherige Liste stehen. */
    fun refresh() {
        viewModelScope.launch {
            runCatching { apiClient.tourList() }.onSuccess { internServerTouren.value = it }
        }
    }

    /**
     * Sichtbarkeit direkt aus der Liste ändern. Nötig für Touren, die im Studio
     * entstanden sind: sie haben keinen lokalen Entwurf, über den man ins
     * Detail käme, wären ohne diesen Weg also in der App gar nicht teilbar.
     */
    fun setVisibility(serverTourId: String, sichtbarkeit: Visibility) {
        internServerTouren.value = internServerTouren.value.map {
            if (it.id == serverTourId) it.copy(visibility = sichtbarkeit.key) else it
        }
        viewModelScope.launch {
            runCatching { apiClient.setVisibility(serverTourId, sichtbarkeit.key) }
                .onFailure { refresh() } // Anzeige zurück auf den echten Stand
        }
    }
}

class TourViewModel(
    private val repository: TourRepository,
    private val apiClient: ApiClient,
    private val appScope: CoroutineScope,
    private val appContext: Context,
    private val tourId: String,
) : ViewModel() {
    val tour: Flow<TourEntity?> = repository.tourFlow(tourId)
    val media: Flow<List<MediumEntity>> = repository.mediaFlow(tourId)

    // Der aufgezeichnete Weg als Linie für die Skizze — einmalig geladen und
    // ausgedünnt. Reicht: Ein Entwurf bekommt nach dem Aufnahmeende keine
    // neuen Punkte mehr.
    private val internRoute = MutableStateFlow<List<TrackPoint>>(emptyList())
    val route: StateFlow<List<TrackPoint>> = internRoute
    init {
        viewModelScope.launch {
            internRoute.value = thinOut(repository.points(tourId).map { TrackPoint(it.lng, it.lat) })
        }
    }

    // Wer die Tour sehen darf, weiß nur der Server — auf dem Gerät wird das
    // nicht mitgeführt, sonst gäbe es zwei Wahrheiten, die auseinanderlaufen
    // können (das Studio ändert die Sichtbarkeit ebenfalls).
    private val internSichtbarkeit = MutableStateFlow<Visibility?>(null)
    val sichtbarkeit: StateFlow<Visibility?> = internSichtbarkeit

    fun datei(medium: MediumEntity): File = repository.mediumFile(medium)

    /** Sichtbarkeit vom Server nachladen (nur sinnvoll nach dem Upload). */
    fun loadVisibility() {
        viewModelScope.launch {
            val serverId = repository.tour(tourId)?.serverId ?: return@launch
            runCatching { apiClient.tourList().firstOrNull { it.id == serverId } }
                .getOrNull()
                ?.let { internSichtbarkeit.value = Visibility.fromKey(it.visibility) }
        }
    }

    /**
     * Titel und Beschreibung sichern. Ist die Tour schon beim Server, wandert
     * die Änderung gleich dorthin — sonst bliebe eine nachträgliche Umbenennung
     * für immer auf dem Gerät: der Upload-Worker patcht nur innerhalb seines
     * eigenen Laufs, und der ist längst vorbei.
     *
     * Läuft im prozessweiten Scope, weil beim Verlassen des Screens gesichert
     * wird und das ViewModel da schon auf dem Weg nach draußen ist.
     */
    fun saveTexts(title: String?, description: String?) {
        val neuerTitel = title?.trim()?.ifBlank { null }
        val neueBeschreibung = description?.trim()?.ifBlank { null }
        appScope.launch {
            val vorher = repository.tour(tourId) ?: return@launch
            if (vorher.title == neuerTitel && vorher.description == neueBeschreibung) return@launch
            repository.updateTexts(tourId, neuerTitel, neueBeschreibung)
            val serverId = vorher.serverId ?: return@launch
            runCatching { apiClient.patchTour(serverId, neuerTitel, neueBeschreibung) }
        }
    }

    /** Sichtbarkeit der Tour beim Server setzen (nur nach dem Upload möglich). */
    fun setVisibility(sichtbarkeit: Visibility) {
        internSichtbarkeit.value = sichtbarkeit
        appScope.launch {
            val serverId = repository.tour(tourId)?.serverId ?: return@launch
            runCatching { apiClient.setVisibility(serverId, sichtbarkeit.key) }
                // Ging es schief, ist die Anzeige gelogen — zurück auf den
                // Stand, den der Server wirklich kennt.
                .onFailure { loadVisibility() }
        }
    }

    /** Upload erneut anstoßen (nach einem Fehlschlag). */
    fun upload(title: String?, description: String?) {
        viewModelScope.launch {
            repository.updateTexts(tourId, title?.ifBlank { null }, description?.ifBlank { null })
            UploadWorker.start(appContext, tourId)
        }
    }

    fun delete(danach: () -> Unit) {
        viewModelScope.launch {
            repository.deleteTour(tourId)
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
/**
 * Der Server weist Overlay-Änderungen mit 409 ab, während er eine Tour rendert.
 * Das dauert Sekunden, nicht Minuten — kurz warten und erneut versuchen ist dem
 * Nutzer gegenüber ehrlicher als eine Fehlermeldung.
 *
 * Beide Wege zum Foto-Titel brauchen das: Jedes Schreiben stößt ein neues
 * Rendern an, und wer zwei Bilder hintereinander beschriftet, läuft dem eigenen
 * vorigen Auftrag in die Arme.
 */
private suspend fun wiederholeBeiVerarbeitung(versuch: suspend () -> Unit): Boolean {
    repeat(3) { runde ->
        val ergebnis = runCatching { versuch() }
        if (ergebnis.isSuccess) return true
        val fehler = ergebnis.exceptionOrNull()
        if (fehler !is ApiError || fehler.status != 409) return false
        if (runde < 2) delay(2_000)
    }
    return false
}

class PhotoViewModel(
    private val repository: TourRepository,
    private val apiClient: ApiClient,
    private val appScope: CoroutineScope,
    private val tourId: String,
    private val mediumId: String,
) : ViewModel() {
    val medium: Flow<MediumEntity?> = repository.mediumFlow(tourId, mediumId)
    val tour: Flow<TourEntity?> = repository.tourFlow(tourId)

    fun datei(medium: MediumEntity): File = repository.mediumFile(medium)

    /**
     * Titel setzen — lokal immer, und beim Server, sobald die Tour dort liegt.
     *
     * Nach dem Upload ist das Manifest unveränderlich; Medien-Änderungen laufen
     * über das Edit-Overlay. Das wird gelesen, um genau einen Schlüssel ergänzt
     * und zurückgeschrieben, damit im Studio gesetzte Kamerafahrten, Musik oder
     * Wetterkorrekturen dabei nicht verloren gehen.
     */
    fun setTitle(title: String) {
        appScope.launch {
            repository.setMediumCaption(tourId, mediumId, title)
            val serverId = repository.tour(tourId)?.serverId ?: return@launch
            wiederholeBeiVerarbeitung {
                val overlay = apiClient.loadEdits(serverId)
                apiClient.saveEdits(serverId, withMediumCaption(overlay, mediumId, title))
            }
        }
    }

    fun delete(danach: () -> Unit) {
        viewModelScope.launch {
            repository.deleteMedium(tourId, mediumId)
            danach()
        }
    }

}

/** Profil-Reiter: Kontostand vom Server plus die Zahlen der eigenen Touren. */
class ProfileViewModel(
    repository: TourRepository,
    private val settings: Settings,
    private val apiClient: ApiClient,
    private val appScope: CoroutineScope,
) : ViewModel() {
    val localTours: Flow<List<TourEntity>> = repository.allTours()

    private val internServerTouren = MutableStateFlow<List<ServerTour>>(emptyList())
    val serverTours: StateFlow<List<ServerTour>> = internServerTouren

    private val internKonto = MutableStateFlow<AccountState?>(null)
    val account: StateFlow<AccountState?> = internKonto

    /** Stehende Einwilligung für den Foto-Nachzug — sie lebt in der App. */
    val autoPhotos: StateFlow<Boolean> = settings.account
        .map { it.autoPhotos }
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private val internTracker = MutableStateFlow<List<TrackerProvider>>(emptyList())

    /**
     * Die verbindbaren Sport-Tracker.
     *
     * Leer heißt „gibt es hier nicht" — der Abschnitt bleibt dann ganz aus.
     * Ein Fehler beim Laden führt zum selben Ergebnis: Ein Dienst, der
     * vielleicht gar nicht existiert, soll das Profil nicht mit einer
     * Fehlermeldung beginnen lassen.
     */
    val tracker: StateFlow<List<TrackerProvider>> = internTracker

    /** Kontostand und Tourliste neu holen; Fehler lassen den letzten Stand stehen. */
    fun refresh() {
        viewModelScope.launch {
            runCatching { apiClient.accountState() }.onSuccess { internKonto.value = it }
            runCatching { apiClient.tourList() }.onSuccess { internServerTouren.value = it }
            runCatching { apiClient.trackerProviders() }.onSuccess { internTracker.value = it }
        }
    }

    /**
     * Die Autorisierungs-URL holen; der Aufrufer öffnet sie im BROWSER.
     *
     * Kein WebView: Mehrere Anbieter sperren eingebettete Browser für OAuth,
     * und ein Anmeldeformular in einer fremden App ist auch die schlechtere
     * Gewohnheit. Zurück kommt die App über den Deep Link.
     */
    fun connectTracker(anbieterId: String, oeffne: (String) -> Unit, beiFehler: (String) -> Unit) {
        viewModelScope.launch {
            runCatching { apiClient.trackerConnectUrl(anbieterId) }
                .onSuccess(oeffne)
                .onFailure { beiFehler("Das Verbinden ließ sich nicht starten.") }
        }
    }

    /**
     * Die stehende Einwilligung „Fotos automatisch ergänzen" setzen.
     *
     * Der Zustand steht sofort in der Oberfläche (der Schalter soll nicht
     * hängen), geschrieben wird danach — bei einem DataStore ist das kein
     * Risiko, er schreibt lokal und schlägt praktisch nie fehl.
     */
    fun setAutoPhotos(an: Boolean) {
        viewModelScope.launch { settings.setAutoPhotos(an) }
    }

    fun disconnectTracker(anbieterId: String, beiFehler: (String) -> Unit) {
        viewModelScope.launch {
            runCatching { apiClient.disconnectTracker(anbieterId) }
                .onSuccess { refresh() }
                .onFailure { beiFehler("Das Trennen hat nicht geklappt.") }
        }
    }

    /** Anzeigename und Bio sichern (beim Verlassen des Screens). */
    fun saveProfile(displayName: String, bio: String) {
        val stand = internKonto.value?.profile ?: return
        if (displayName == stand.displayName.orEmpty() && bio == stand.bio.orEmpty()) return
        appScope.launch {
            runCatching { apiClient.setProfile(displayName = displayName, bio = bio) }
                .onSuccess { refreshQuietly() }
        }
    }

    fun setPublic(public: Boolean) {
        internKonto.value = internKonto.value?.let { it.copy(profile = it.profile.copy(public = public)) }
        viewModelScope.launch {
            runCatching { apiClient.setProfile(public = public) }.onFailure { refresh() }
        }
    }

    /**
     * Profilbild setzen. Das Verkleinern läuft im Hintergrund-Thread und im
     * prozessweiten Scope: Ein Rohfoto zu dekodieren dauert, und der Nutzer
     * soll den Screen inzwischen verlassen dürfen.
     */
    fun setAvatar(oeffne: () -> java.io.InputStream) {
        appScope.launch {
            // Auch das Lesen wird abgesichert: die gewählte Datei kann inzwischen
            // weg sein oder gar kein Bild enthalten — das darf die App nicht
            // umwerfen, das Profil bleibt dann einfach unverändert.
            val jpeg = withContext(Dispatchers.IO) { runCatching { scaleForAvatar(oeffne) }.getOrNull() }
                ?: return@launch
            runCatching { apiClient.setAvatar(jpeg) }.onSuccess { refreshQuietly() }
        }
    }

    fun deleteAvatar() {
        appScope.launch { runCatching { apiClient.deleteAvatar() }.onSuccess { refreshQuietly() } }
    }

    private suspend fun refreshQuietly() {
        runCatching { apiClient.accountState() }.onSuccess { internKonto.value = it }
    }

    fun logout() {
        viewModelScope.launch { settings.logout() }
    }

    /**
     * Konto löschen und abmelden.
     *
     * Die Abmeldung folgt auch dann, wenn der Aufruf scheitert: Ist das Konto
     * weg, wäre jede weitere Anfrage mit diesem Token ohnehin ein 401 — und die
     * App bliebe in einem Zustand hängen, aus dem sie sich nicht befreien kann.
     */
    fun deleteAccount(danach: () -> Unit) {
        viewModelScope.launch {
            runCatching { apiClient.deleteAccount() }
            settings.logout()
            danach()
        }
    }
}

class SettingsViewModel(
    private val settings: Settings,
    private val apiClient: ApiClient,
) : ViewModel() {

    sealed interface State {
        data object Idle : State
        data object Loading : State
        data class Failed(val message: String) : State
    }

    val account: Flow<Account> = settings.account
    private val internalState = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = internalState

    fun login(email: String, passwort: String) {
        viewModelScope.launch {
            internalState.value = State.Loading
            try {
                // Feste Prod-URL — überschreibt auch einen evtl. veralteten gespeicherten
                // Dev-Wert, sodass alle authentifizierten Aufrufe gegen Prod laufen.
                settings.setServer(Settings.STANDARD_SERVER)
                val token = apiClient.login(
                    Settings.STANDARD_SERVER,
                    email.trim(),
                    passwort,
                    geraet = android.os.Build.MODEL ?: "Android",
                )
                settings.setLogin(email.trim(), token)
                internalState.value = State.Idle
            } catch (fehler: Exception) {
                internalState.value = State.Failed(fehler.message ?: "Anmeldung fehlgeschlagen")
            }
        }
    }

    fun logout() {
        viewModelScope.launch { settings.logout() }
    }
}

/** Gemeinsame Factory: kennt die App-Singletons und baut jedes ViewModel. */
/**
 * Eine Tour, die beim Server liegt.
 *
 * Bewusst getrennt von [TourViewModel]: Der kennt nur die Zeile in Room und
 * lebt für den Entwurf VOR dem Upload — mit Aufnahmestatus, Fortschritt und
 * Dateien auf dem Gerät. Danach ist der Server die Wahrheit, und die sieht
 * völlig anders aus. Beides in ein ViewModel zu zwingen hieße, in jeder
 * Methode zu fragen, welcher Fall gerade gilt.
 */
class ServerTourViewModel(
    private val repository: TourRepository,
    private val apiClient: ApiClient,
    private val appScope: CoroutineScope,
    private val serverId: String,
) : ViewModel() {
    private val internTour = MutableStateFlow<ServerTour?>(null)
    val tour: StateFlow<ServerTour?> = internTour

    private val internDetail = MutableStateFlow<ServerTourDetail?>(null)
    val detail: StateFlow<ServerTourDetail?> = internDetail

    private val internLaedt = MutableStateFlow(true)
    val laedt: StateFlow<Boolean> = internLaedt

    private val internFehler = MutableStateFlow<String?>(null)
    val fehler: StateFlow<String?> = internFehler

    /**
     * Fotos aus der Galerie, die zeitlich zu dieser Tour passen.
     *
     * Der Weg OHNE stehende Einwilligung: Gefunden wird nur auf ausdrückliche
     * Nachfrage (`findPhotos`), hochgeladen erst nach einem zweiten Ja. Leer
     * heißt „nichts vorzuschlagen" — und das ist auch der Zustand, solange
     * niemand gesucht hat.
     */
    private val internFotoVorschlag = MutableStateFlow<List<GalleryItem>>(emptyList())
    val photoSuggestion: StateFlow<List<GalleryItem>> = internFotoVorschlag

    /** Läuft gerade ein Nachzug? Der Knopf soll währenddessen nicht zweimal gehen. */
    private val internNachzugLaeuft = MutableStateFlow(false)
    val backfillRunning: StateFlow<Boolean> = internNachzugLaeuft

    init { load() }

    /**
     * In der Galerie nach passenden Fotos sehen.
     *
     * Wird vom Screen gerufen, sobald die Tour geladen UND das Leserecht
     * erteilt ist. Ohne Erlaubnis passiert nichts — die Suche fragt nicht von
     * sich aus danach, das tut der Knopf.
     */
    fun findPhotos(app: MaptaleApp) {
        viewModelScope.launch {
            // `null` (Tour rendert noch) wie „nichts" behandeln: Der Screen
            // fragt beim nächsten Statuswechsel ohnehin erneut.
            internFotoVorschlag.value =
                runCatching { findMatchingPhotos(app, serverId) }.getOrNull().orEmpty()
        }
    }

    /**
     * Die vorgeschlagenen Fotos übernehmen.
     *
     * Danach wird neu geladen: Der Server rendert nach dem Nachreichen neu, und
     * bis das durch ist, zeigt die Tour ihren alten Stand. Der Vorschlag wird
     * in jedem Fall geleert — auch wenn nichts hochging: Sonst stünde die Frage
     * weiter da, und ein zweiter Klick liefe in dieselbe Wand.
     */
    fun acceptPhotos(app: MaptaleApp, danach: (Int) -> Unit) {
        val bilder = internFotoVorschlag.value
        if (bilder.isEmpty() || internNachzugLaeuft.value) return
        // `appScope` und NICHT `viewModelScope`: Wer den Screen verlässt,
        // während die Bilder hochgehen, riss den Lauf sonst mitten entzwei —
        // dieselbe Sorte Abbruch, die den Nachzug im Push-Handler gekostet hat.
        // Halb hochgeladene Fotos sind zwar nicht verloren (die `quelle` holt
        // sie beim nächsten Anlauf nach), aber sichtbar werden sie erst mit dem
        // Rendern am Ende.
        appScope.launch {
            internNachzugLaeuft.value = true
            val geschafft = runCatching { uploadPhotos(app, serverId, bilder) }.getOrDefault(0)
            internFotoVorschlag.value = emptyList()
            internNachzugLaeuft.value = false
            danach(geschafft)
            if (geschafft > 0) load()
        }
    }

    /** „Nein danke" — der Vorschlag verschwindet für diese Sitzung. */
    fun discardSuggestion() {
        internFotoVorschlag.value = emptyList()
    }

    fun load() {
        viewModelScope.launch {
            internLaedt.value = true
            internFehler.value = null
            // Titel, Kilometer, Titelbild und Sichtbarkeit stehen in der Liste,
            // Beschreibung und Fotos im gerenderten Tour-JSON.
            runCatching { apiClient.tourList().firstOrNull { it.id == serverId } }
                .onSuccess { if (it != null) internTour.value = it }
            runCatching { apiClient.tourDetail(serverId) }
                .onSuccess { internDetail.value = it }
                .onFailure { internFehler.value = "Die Reise ließ sich nicht laden." }
            internLaedt.value = false
        }
    }

    /**
     * Titel und Beschreibung sichern (beim Verlassen des Screens, deshalb im
     * prozessweiten Scope). Unveränderte Texte lösen keinen Aufruf aus.
     */
    fun saveTexts(title: String?, description: String?) {
        val neuerTitel = title?.trim()?.ifBlank { null }
        val neueBeschreibung = description?.trim()?.ifBlank { null }
        val vorher = internTour.value
        val alteBeschreibung = internDetail.value?.description?.ifBlank { null }
        if (vorher != null && vorher.title == neuerTitel && alteBeschreibung == neueBeschreibung) return
        appScope.launch {
            runCatching { apiClient.patchTour(serverId, neuerTitel, neueBeschreibung) }
            // Der lokale Entwurf lebt nach dem Upload weiter; bliebe sein Titel
            // stehen, hieße die Tour nach einem erneuten Upload wieder alt.
            repository.tourByServerId(serverId)?.let {
                repository.updateTexts(it.id, neuerTitel, neueBeschreibung)
            }
        }
    }

    fun setVisibility(sichtbarkeit: Visibility) {
        internTour.value = internTour.value?.copy(visibility = sichtbarkeit.key)
        appScope.launch {
            runCatching { apiClient.setVisibility(serverId, sichtbarkeit.key) }
        }
    }

    /**
     * Beschriftung eines Fotos ändern.
     *
     * Nach dem Upload ist das Manifest unveränderlich; der Text landet im
     * Edit-Overlay. Das wird gelesen, um EINEN Schlüssel ergänzt und
     * zurückgeschrieben — als rohes JsonObject, damit im Studio gesetzte
     * Kamerafahrten, Musik und Wetterkorrekturen nicht still verlorengehen.
     *
     * Die Anzeige wird sofort mitgezogen, statt auf den Server zu warten: Der
     * rendert die Tour nach dem Schreiben neu, und bis das durch ist, stünde
     * hier noch der alte Text.
     */
    fun setPhotoTitle(mediumId: String, title: String) {
        val vorher = internDetail.value ?: return
        val gekuerzt = title.trim()
        if (vorher.media.firstOrNull { it.id == mediumId }?.caption == gekuerzt) return

        internDetail.value = vorher.copy(
            media = vorher.media.map {
                if (it.id != mediumId) it
                else it.copy(caption = gekuerzt, title = gekuerzt.ifBlank { it.timeLabel })
            },
        )
        appScope.launch {
            val geschafft = wiederholeBeiVerarbeitung {
                val overlay = apiClient.loadEdits(serverId)
                apiClient.saveEdits(serverId, withMediumCaption(overlay, mediumId, gekuerzt))
            }
            if (!geschafft) {
                internFehler.value = "Der Titel ließ sich nicht speichern."
                return@launch
            }
            // Auch die lokale Zeile nachziehen, falls der Entwurf noch da ist.
            // Sonst kennen Gerät und Server verschiedene Texte, und der
            // Titel-Abgleich eines erneuten Uploads schriebe den alten zurück.
            repository.tourByServerId(serverId)?.let {
                repository.setMediumCaption(it.id, mediumId, gekuerzt)
            }
        }
    }

    /**
     * Tour endgültig löschen — beim Server UND als lokaler Entwurf. Ohne den
     * zweiten Teil taucht sie als „wartet auf Upload" wieder in der Liste auf
     * und der Nachzügler-Upload lädt sie beim nächsten App-Start erneut hoch.
     */
    fun delete(danach: () -> Unit) {
        viewModelScope.launch {
            val erfolg = runCatching { apiClient.deleteTour(serverId) }.isSuccess
            if (!erfolg) {
                internFehler.value = "Löschen fehlgeschlagen."
                return@launch
            }
            repository.tourByServerId(serverId)?.let { repository.deleteTour(it.id) }
            danach()
        }
    }
}

class MaptaleViewModelFactory(
    private val app: MaptaleApp,
    private val tourId: String? = null,
    private val mediumId: String? = null,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(StartViewModel::class.java) ->
            StartViewModel(app.repository, app.apiClient) as T
        modelClass.isAssignableFrom(TourViewModel::class.java) ->
            TourViewModel(
                app.repository,
                app.apiClient,
                app.appScope,
                app,
                requireNotNull(tourId) { "tourId fehlt" },
            ) as T
        modelClass.isAssignableFrom(ServerTourViewModel::class.java) ->
            ServerTourViewModel(
                app.repository,
                app.apiClient,
                app.appScope,
                requireNotNull(tourId) { "serverId fehlt" },
            ) as T
        modelClass.isAssignableFrom(PhotoViewModel::class.java) ->
            PhotoViewModel(
                app.repository,
                app.apiClient,
                app.appScope,
                requireNotNull(tourId) { "tourId fehlt" },
                requireNotNull(mediumId) { "mediumId fehlt" },
            ) as T
        modelClass.isAssignableFrom(ProfileViewModel::class.java) ->
            ProfileViewModel(app.repository, app.settings, app.apiClient, app.appScope) as T
        modelClass.isAssignableFrom(SettingsViewModel::class.java) ->
            SettingsViewModel(app.settings, app.apiClient) as T
        modelClass.isAssignableFrom(ImportViewModel::class.java) ->
            ImportViewModel(app) as T
        else -> throw IllegalArgumentException("Unbekanntes ViewModel: ${modelClass.name}")
    }
}
