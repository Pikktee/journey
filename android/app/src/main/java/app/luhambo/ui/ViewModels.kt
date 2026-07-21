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
import app.luhambo.upload.ApiFehler
import app.luhambo.upload.Einstellungen
import app.luhambo.upload.Konto
import app.luhambo.upload.KontoStand
import app.luhambo.aufzeichnung.Spurpunkt
import app.luhambo.aufzeichnung.duenneAus
import app.luhambo.upload.ServerTour
import app.luhambo.upload.ServerTourDetail
import app.luhambo.upload.UploadWorker
import app.luhambo.upload.mitMediumTitel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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

    /**
     * Sichtbarkeit direkt aus der Liste ändern. Nötig für Touren, die im Studio
     * entstanden sind: sie haben keinen lokalen Entwurf, über den man ins
     * Detail käme, wären ohne diesen Weg also in der App gar nicht teilbar.
     */
    fun setzeSichtbarkeit(serverTourId: String, sichtbarkeit: Sichtbarkeit) {
        internServerTouren.value = internServerTouren.value.map {
            if (it.id == serverTourId) it.copy(visibility = sichtbarkeit.schluessel) else it
        }
        viewModelScope.launch {
            runCatching { apiClient.setzeSichtbarkeit(serverTourId, sichtbarkeit.schluessel) }
                .onFailure { aktualisiere() } // Anzeige zurück auf den echten Stand
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
    val tour: Flow<TourEntity?> = repository.tourFluss(tourId)
    val medien: Flow<List<MediumEntity>> = repository.medienFluss(tourId)

    // Der aufgezeichnete Weg als Linie für die Skizze — einmalig geladen und
    // ausgedünnt. Reicht: Ein Entwurf bekommt nach dem Aufnahmeende keine
    // neuen Punkte mehr.
    private val internRoute = MutableStateFlow<List<Spurpunkt>>(emptyList())
    val route: StateFlow<List<Spurpunkt>> = internRoute
    init {
        viewModelScope.launch {
            internRoute.value = duenneAus(repository.punkte(tourId).map { Spurpunkt(it.lng, it.lat) })
        }
    }

    // Wer die Tour sehen darf, weiß nur der Server — auf dem Gerät wird das
    // nicht mitgeführt, sonst gäbe es zwei Wahrheiten, die auseinanderlaufen
    // können (das Studio ändert die Sichtbarkeit ebenfalls).
    private val internSichtbarkeit = MutableStateFlow<Sichtbarkeit?>(null)
    val sichtbarkeit: StateFlow<Sichtbarkeit?> = internSichtbarkeit

    fun datei(medium: MediumEntity): File = repository.mediumDatei(medium)

    /** Sichtbarkeit vom Server nachladen (nur sinnvoll nach dem Upload). */
    fun ladeSichtbarkeit() {
        viewModelScope.launch {
            val serverId = repository.tour(tourId)?.serverId ?: return@launch
            runCatching { apiClient.toureListe().firstOrNull { it.id == serverId } }
                .getOrNull()
                ?.let { internSichtbarkeit.value = Sichtbarkeit.vonSchluessel(it.visibility) }
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
    fun sichereTexte(titel: String?, beschreibung: String?) {
        val neuerTitel = titel?.trim()?.ifBlank { null }
        val neueBeschreibung = beschreibung?.trim()?.ifBlank { null }
        appScope.launch {
            val vorher = repository.tour(tourId) ?: return@launch
            if (vorher.titel == neuerTitel && vorher.beschreibung == neueBeschreibung) return@launch
            repository.aktualisiereTexte(tourId, neuerTitel, neueBeschreibung)
            val serverId = vorher.serverId ?: return@launch
            runCatching { apiClient.patchTour(serverId, neuerTitel, neueBeschreibung) }
        }
    }

    /** Sichtbarkeit der Tour beim Server setzen (nur nach dem Upload möglich). */
    fun setzeSichtbarkeit(sichtbarkeit: Sichtbarkeit) {
        internSichtbarkeit.value = sichtbarkeit
        appScope.launch {
            val serverId = repository.tour(tourId)?.serverId ?: return@launch
            runCatching { apiClient.setzeSichtbarkeit(serverId, sichtbarkeit.schluessel) }
                // Ging es schief, ist die Anzeige gelogen — zurück auf den
                // Stand, den der Server wirklich kennt.
                .onFailure { ladeSichtbarkeit() }
        }
    }

    /** Upload erneut anstoßen (nach einem Fehlschlag). */
    fun ladeHoch(titel: String?, beschreibung: String?) {
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
        if (fehler !is ApiFehler || fehler.status != 409) return false
        if (runde < 2) delay(2_000)
    }
    return false
}

class FotoViewModel(
    private val repository: TourRepository,
    private val apiClient: ApiClient,
    private val appScope: CoroutineScope,
    private val tourId: String,
    private val mediumId: String,
) : ViewModel() {
    val medium: Flow<MediumEntity?> = repository.mediumFluss(tourId, mediumId)
    val tour: Flow<TourEntity?> = repository.tourFluss(tourId)

    fun datei(medium: MediumEntity): File = repository.mediumDatei(medium)

    /**
     * Titel setzen — lokal immer, und beim Server, sobald die Tour dort liegt.
     *
     * Nach dem Upload ist das Manifest unveränderlich; Medien-Änderungen laufen
     * über das Edit-Overlay. Das wird gelesen, um genau einen Schlüssel ergänzt
     * und zurückgeschrieben, damit im Studio gesetzte Kamerafahrten, Musik oder
     * Wetterkorrekturen dabei nicht verloren gehen.
     */
    fun setzeTitel(titel: String) {
        appScope.launch {
            repository.setzeMediumCaption(tourId, mediumId, titel)
            val serverId = repository.tour(tourId)?.serverId ?: return@launch
            wiederholeBeiVerarbeitung {
                val overlay = apiClient.editsLesen(serverId)
                apiClient.editsSchreiben(serverId, mitMediumTitel(overlay, mediumId, titel))
            }
        }
    }

    fun loesche(danach: () -> Unit) {
        viewModelScope.launch {
            repository.loescheMedium(tourId, mediumId)
            danach()
        }
    }

}

/** Profil-Reiter: Kontostand vom Server plus die Zahlen der eigenen Touren. */
class ProfilViewModel(
    repository: TourRepository,
    private val einstellungen: Einstellungen,
    private val apiClient: ApiClient,
    private val appScope: CoroutineScope,
) : ViewModel() {
    val lokaleTouren: Flow<List<TourEntity>> = repository.alleTouren()

    private val internServerTouren = MutableStateFlow<List<ServerTour>>(emptyList())
    val serverTouren: StateFlow<List<ServerTour>> = internServerTouren

    private val internKonto = MutableStateFlow<KontoStand?>(null)
    val konto: StateFlow<KontoStand?> = internKonto

    /** Kontostand und Tourliste neu holen; Fehler lassen den letzten Stand stehen. */
    fun aktualisiere() {
        viewModelScope.launch {
            runCatching { apiClient.kontoStand() }.onSuccess { internKonto.value = it }
            runCatching { apiClient.toureListe() }.onSuccess { internServerTouren.value = it }
        }
    }

    /** Anzeigename und Bio sichern (beim Verlassen des Screens). */
    fun sichereProfil(anzeigename: String, bio: String) {
        val stand = internKonto.value?.profil ?: return
        if (anzeigename == stand.anzeigename.orEmpty() && bio == stand.bio.orEmpty()) return
        appScope.launch {
            runCatching { apiClient.setzeProfil(anzeigename = anzeigename, bio = bio) }
                .onSuccess { aktualisiereStill() }
        }
    }

    fun setzeOeffentlich(oeffentlich: Boolean) {
        internKonto.value = internKonto.value?.let { it.copy(profil = it.profil.copy(oeffentlich = oeffentlich)) }
        viewModelScope.launch {
            runCatching { apiClient.setzeProfil(oeffentlich = oeffentlich) }.onFailure { aktualisiere() }
        }
    }

    /**
     * Profilbild setzen. Das Verkleinern läuft im Hintergrund-Thread und im
     * prozessweiten Scope: Ein Rohfoto zu dekodieren dauert, und der Nutzer
     * soll den Screen inzwischen verlassen dürfen.
     */
    fun setzeAvatar(oeffne: () -> java.io.InputStream) {
        appScope.launch {
            // Auch das Lesen wird abgesichert: die gewählte Datei kann inzwischen
            // weg sein oder gar kein Bild enthalten — das darf die App nicht
            // umwerfen, das Profil bleibt dann einfach unverändert.
            val jpeg = withContext(Dispatchers.IO) { runCatching { skaliereFuerAvatar(oeffne) }.getOrNull() }
                ?: return@launch
            runCatching { apiClient.setzeAvatar(jpeg) }.onSuccess { aktualisiereStill() }
        }
    }

    fun loescheAvatar() {
        appScope.launch { runCatching { apiClient.loescheAvatar() }.onSuccess { aktualisiereStill() } }
    }

    private suspend fun aktualisiereStill() {
        runCatching { apiClient.kontoStand() }.onSuccess { internKonto.value = it }
    }

    fun abmelden() {
        viewModelScope.launch { einstellungen.abmelden() }
    }

    /**
     * Konto löschen und abmelden.
     *
     * Die Abmeldung folgt auch dann, wenn der Aufruf scheitert: Ist das Konto
     * weg, wäre jede weitere Anfrage mit diesem Token ohnehin ein 401 — und die
     * App bliebe in einem Zustand hängen, aus dem sie sich nicht befreien kann.
     */
    fun loescheKonto(danach: () -> Unit) {
        viewModelScope.launch {
            runCatching { apiClient.loescheKonto() }
            einstellungen.abmelden()
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

    init { lade() }

    fun lade() {
        viewModelScope.launch {
            internLaedt.value = true
            internFehler.value = null
            // Titel, Kilometer, Titelbild und Sichtbarkeit stehen in der Liste,
            // Beschreibung und Fotos im gerenderten Tour-JSON.
            runCatching { apiClient.toureListe().firstOrNull { it.id == serverId } }
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
    fun sichereTexte(titel: String?, beschreibung: String?) {
        val neuerTitel = titel?.trim()?.ifBlank { null }
        val neueBeschreibung = beschreibung?.trim()?.ifBlank { null }
        val vorher = internTour.value
        val alteBeschreibung = internDetail.value?.beschreibung?.ifBlank { null }
        if (vorher != null && vorher.titel == neuerTitel && alteBeschreibung == neueBeschreibung) return
        appScope.launch {
            runCatching { apiClient.patchTour(serverId, neuerTitel, neueBeschreibung) }
            // Der lokale Entwurf lebt nach dem Upload weiter; bliebe sein Titel
            // stehen, hieße die Tour nach einem erneuten Upload wieder alt.
            repository.tourMitServerId(serverId)?.let {
                repository.aktualisiereTexte(it.id, neuerTitel, neueBeschreibung)
            }
        }
    }

    fun setzeSichtbarkeit(sichtbarkeit: Sichtbarkeit) {
        internTour.value = internTour.value?.copy(visibility = sichtbarkeit.schluessel)
        appScope.launch {
            runCatching { apiClient.setzeSichtbarkeit(serverId, sichtbarkeit.schluessel) }
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
    fun setzeFotoTitel(mediumId: String, titel: String) {
        val vorher = internDetail.value ?: return
        val gekuerzt = titel.trim()
        if (vorher.fotos.firstOrNull { it.id == mediumId }?.nutzertext == gekuerzt) return

        internDetail.value = vorher.copy(
            fotos = vorher.fotos.map {
                if (it.id != mediumId) it
                else it.copy(nutzertext = gekuerzt, titel = gekuerzt.ifBlank { it.zeitzeile })
            },
        )
        appScope.launch {
            val geschafft = wiederholeBeiVerarbeitung {
                val overlay = apiClient.editsLesen(serverId)
                apiClient.editsSchreiben(serverId, mitMediumTitel(overlay, mediumId, gekuerzt))
            }
            if (!geschafft) {
                internFehler.value = "Der Titel ließ sich nicht speichern."
                return@launch
            }
            // Auch die lokale Zeile nachziehen, falls der Entwurf noch da ist.
            // Sonst kennen Gerät und Server verschiedene Texte, und der
            // Titel-Abgleich eines erneuten Uploads schriebe den alten zurück.
            repository.tourMitServerId(serverId)?.let {
                repository.setzeMediumCaption(it.id, mediumId, gekuerzt)
            }
        }
    }

    /**
     * Tour endgültig löschen — beim Server UND als lokaler Entwurf. Ohne den
     * zweiten Teil taucht sie als „wartet auf Upload" wieder in der Liste auf
     * und der Nachzügler-Upload lädt sie beim nächsten App-Start erneut hoch.
     */
    fun loesche(danach: () -> Unit) {
        viewModelScope.launch {
            val erfolg = runCatching { apiClient.loescheTour(serverId) }.isSuccess
            if (!erfolg) {
                internFehler.value = "Löschen fehlgeschlagen."
                return@launch
            }
            repository.tourMitServerId(serverId)?.let { repository.loescheTour(it.id) }
            danach()
        }
    }
}

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
        modelClass.isAssignableFrom(FotoViewModel::class.java) ->
            FotoViewModel(
                app.repository,
                app.apiClient,
                app.appScope,
                requireNotNull(tourId) { "tourId fehlt" },
                requireNotNull(mediumId) { "mediumId fehlt" },
            ) as T
        modelClass.isAssignableFrom(ProfilViewModel::class.java) ->
            ProfilViewModel(app.repository, app.einstellungen, app.apiClient, app.appScope) as T
        modelClass.isAssignableFrom(EinstellungenViewModel::class.java) ->
            EinstellungenViewModel(app.einstellungen, app.apiClient) as T
        modelClass.isAssignableFrom(ImportViewModel::class.java) ->
            ImportViewModel(app) as T
        else -> throw IllegalArgumentException("Unbekanntes ViewModel: ${modelClass.name}")
    }
}
