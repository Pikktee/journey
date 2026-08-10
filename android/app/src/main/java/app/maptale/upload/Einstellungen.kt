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

data class Konto(
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
    val fotosAutomatisch: Boolean = false,
) {
    val angemeldet get() = apiToken != null
}

class Einstellungen(private val context: Context) {

    private val schluesselServer = stringPreferencesKey("server_url")
    private val schluesselToken = stringPreferencesKey("api_token")
    private val schluesselEmail = stringPreferencesKey("email")
    private val schluesselFotosAuto = booleanPreferencesKey("fotos_automatisch")

    /**
     * Letzter bekannter Kontostand, synchron lesbar.
     *
     * DataStore liest asynchron — das passt überall, außer in einem OkHttp-
     * Interceptor: der läuft synchron und darf nicht blockieren. Der Bild-Lader
     * für Titelbilder braucht dort aber den Authorization-Header, sonst bleiben
     * die Vorschaubilder privater Touren leer. Gefüllt wird der Wert aus dem
     * `konto`-Flow (MaptaleApp sammelt ihn beim Start ein).
     */
    @Volatile
    var letzterStand: Konto = Konto(STANDARD_SERVER, null, null)
        private set

    val konto: Flow<Konto> = context.dataStore.data.map { prefs ->
        Konto(
            serverUrl = (prefs[schluesselServer] ?: STANDARD_SERVER).trimEnd('/'),
            apiToken = prefs[schluesselToken],
            email = prefs[schluesselEmail],
            fotosAutomatisch = prefs[schluesselFotosAuto] ?: false,
        ).also { letzterStand = it }
    }

    suspend fun aktuellesKonto(): Konto = konto.first()

    suspend fun setzeServer(url: String) {
        context.dataStore.edit { it[schluesselServer] = url.trim().trimEnd('/') }
    }

    suspend fun setzeAnmeldung(email: String, token: String) {
        context.dataStore.edit {
            it[schluesselEmail] = email
            it[schluesselToken] = token
        }
    }

    /**
     * Die stehende Einwilligung für den Foto-Nachzug setzen.
     *
     * Sie überlebt das Abmelden NICHT (s. `abmelden`): Wer sich abmeldet, hat
     * dem nächsten Konto auf diesem Gerät nichts erlaubt.
     */
    suspend fun setzeFotosAutomatisch(an: Boolean) {
        context.dataStore.edit { it[schluesselFotosAuto] = an }
    }

    suspend fun abmelden() {
        context.dataStore.edit {
            it.remove(schluesselToken)
            it.remove(schluesselEmail)
            it.remove(schluesselFotosAuto)
        }
    }

    companion object {
        // Produktions-Server (fest verdrahtet — Endnutzer geben keine Server-Adresse
        // mehr ein). Für Emulator-Dev kann ein Test den Wert per setzeServer() auf
        // http://10.0.2.2:8787 ziehen (netz_sicherheit.xml erlaubt dort Cleartext);
        // der ApiClientTest nutzt genau das gegen den MockWebServer.
        const val STANDARD_SERVER = "https://maptale.io"
    }
}
