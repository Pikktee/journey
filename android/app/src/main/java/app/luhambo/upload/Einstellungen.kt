// App-Einstellungen (DataStore): Server-URL + API-Token + Konto-Anzeige.
// Das Token kommt vom Login (POST /api/auth/login mit tokenLabel) und ist
// serverseitig widerrufbar — kein Passwort wird gespeichert.
package app.luhambo.upload

import android.content.Context
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
) {
    val angemeldet get() = apiToken != null
}

class Einstellungen(private val context: Context) {

    private val schluesselServer = stringPreferencesKey("server_url")
    private val schluesselToken = stringPreferencesKey("api_token")
    private val schluesselEmail = stringPreferencesKey("email")

    val konto: Flow<Konto> = context.dataStore.data.map { prefs ->
        Konto(
            serverUrl = (prefs[schluesselServer] ?: STANDARD_SERVER).trimEnd('/'),
            apiToken = prefs[schluesselToken],
            email = prefs[schluesselEmail],
        )
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

    suspend fun abmelden() {
        context.dataStore.edit {
            it.remove(schluesselToken)
            it.remove(schluesselEmail)
        }
    }

    companion object {
        // Produktions-Server (fest verdrahtet — Endnutzer geben keine Server-Adresse
        // mehr ein). Für Emulator-Dev kann ein Test den Wert per setzeServer() auf
        // http://10.0.2.2:8787 ziehen (netz_sicherheit.xml erlaubt dort Cleartext);
        // der ApiClientTest nutzt genau das gegen den MockWebServer.
        const val STANDARD_SERVER = "https://luhambo.henrikheil.net"
    }
}
