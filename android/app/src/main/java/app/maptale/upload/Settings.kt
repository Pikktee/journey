// App-Einstellungen (DataStore): Server-URL + API-Token + Konto-Anzeige.
// Das Token kommt vom Login (POST /api/auth/login mit tokenLabel) und ist
// serverseitig widerrufbar — kein Passwort wird gespeichert.
package app.maptale.upload

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "einstellungen")

data class Account(
    val serverUrl: String,
    val apiToken: String?,
    val email: String?,
    /**
     * Stehende Einwilligung: Fotos zu Cloud-Touren ohne Nachfrage ergänzen.
     *
     * **Diese Einstellung lebt in der APP, nicht auf dem Server** — die Galerie
     * liegt auf dem Gerät, und bei zwei Geräten am selben Konto soll nur das
     * mit den Fotos hochladen. Als Server-Feld gälte sie für beide.
     *
     * Vorgabe AUS: Ein Zugriff auf die Galerie beginnt nicht durch Nichtstun.
     */
    val autoPhotos: Boolean = false,
) {
    val loggedIn get() = apiToken != null
}

class Settings(private val context: Context) {

    private val keyServer = stringPreferencesKey("server_url")
    private val keyToken = stringPreferencesKey("api_token")
    private val keyEmail = stringPreferencesKey("email")
    private val keyAutoPhotos = booleanPreferencesKey("auto_photos")
    private val keyWorkQueueMigrated = booleanPreferencesKey("work_queue_migrated_v7")

    /**
     * Letzter bekannter Kontostand, synchron lesbar.
     *
     * DataStore liest asynchron — das passt überall, außer in einem OkHttp-
     * Interceptor: der läuft synchron und darf nicht blockieren. Der Bild-Lader
     * für Titelbilder braucht dort aber den Authorization-Header, sonst bleiben
     * die Vorschaubilder privater Touren leer. Gefüllt wird der Wert aus dem
     * `account`-Flow (MaptaleApp sammelt ihn beim Start ein).
     */
    @Volatile
    var lastAccount: Account = Account(STANDARD_SERVER, null, null)
        private set

    val account: Flow<Account> = context.dataStore.data.map { prefs ->
        Account(
            serverUrl = (prefs[keyServer] ?: STANDARD_SERVER).trimEnd('/'),
            apiToken = prefs[keyToken],
            email = prefs[keyEmail],
            autoPhotos = prefs[keyAutoPhotos] ?: false,
        ).also { lastAccount = it }
    }

    suspend fun currentAccount(): Account = account.first()

    suspend fun setServer(url: String) {
        context.dataStore.edit { it[keyServer] = url.trim().trimEnd('/') }
    }

    suspend fun setLogin(email: String, token: String) {
        context.dataStore.edit {
            it[keyEmail] = email
            it[keyToken] = token
        }
    }

    /**
     * Die stehende Einwilligung für den Foto-Nachzug setzen.
     *
     * Sie überlebt das Abmelden NICHT (s. `logout`): Wer sich abmeldet, hat
     * dem nächsten Konto auf diesem Gerät nichts erlaubt.
     */
    suspend fun setAutoPhotos(an: Boolean) {
        context.dataStore.edit { it[keyAutoPhotos] = an }
    }

    /**
     * Ist der einmalige Umzug der WorkManager-Warteschlange (Welle 7) gelaufen?
     *
     * Der Schlüssel gehört nicht zum Konto und wird beim Abmelden deshalb NICHT
     * geräumt: Er beschreibt den Stand dieser INSTALLATION, nicht den einer
     * Anmeldung. Ein Abmelden würde den Umzug sonst beim nächsten Start noch
     * einmal auslösen und dabei einen frisch eingereihten Lauf wegwerfen.
     */
    suspend fun workQueueMigrated(): Boolean =
        context.dataStore.data.first()[keyWorkQueueMigrated] ?: false

    suspend fun markWorkQueueMigrated() {
        context.dataStore.edit { it[keyWorkQueueMigrated] = true }
    }

    suspend fun logout() {
        context.dataStore.edit {
            it.remove(keyToken)
            it.remove(keyEmail)
            it.remove(keyAutoPhotos)
        }
    }

    companion object {
        // Produktions-Server (fest verdrahtet — Endnutzer geben keine Server-Adresse
        // mehr ein). Für Emulator-Dev kann ein Test den Wert per setServer() auf
        // http://10.0.2.2:8787 ziehen (netz_sicherheit.xml erlaubt dort Cleartext);
        // der ApiClientTest nutzt genau das gegen den MockWebServer.
        const val STANDARD_SERVER = "https://maptale.io"
    }
}
