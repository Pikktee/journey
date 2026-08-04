// Anmeldung als Start-Gate: ohne gültiges Token zeigt die Navigation zuerst
// diesen Screen — Aufzeichnen, Touren und Abspielen erst nach dem Login. Die
// Server-Adresse ist fest verdrahtet (Prod), es gibt kein Eingabefeld mehr.
// Konto anlegen läuft über die Website (Registrierung/Verifikation im Studio).
package app.maptale.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun AnmeldungScreen(viewModel: EinstellungenViewModel) {
    val zustand by viewModel.zustand.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var passwort by rememberSaveable { mutableStateOf("") }
    val laedt = zustand is EinstellungenViewModel.Zustand.Laedt

    Column(
        Modifier
            .fillMaxSize()
            .background(Nacht)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(32.dp))
        Wortmarke(markenGroesse = 32.dp)
        Spacer(Modifier.height(22.dp))
        Text(
            "Deine Reisen als filmischer Flug über echtes Gelände.",
            style = MaterialTheme.typography.headlineSmall,
            color = Tinte,
        )
        Spacer(Modifier.height(34.dp))

        MarkenFeld(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-Mail") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !laedt,
        )
        Spacer(Modifier.height(12.dp))
        MarkenFeld(
            value = passwort,
            onValueChange = { passwort = it },
            label = { Text("Passwort") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !laedt,
        )
        Spacer(Modifier.height(20.dp))
        PrimaerKnopf(
            onClick = { viewModel.anmelden(email.trim(), passwort) },
            enabled = !laedt && email.isNotBlank() && passwort.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (laedt) {
                CircularProgressIndicator(
                    Modifier.size(16.dp).padding(end = 8.dp),
                    strokeWidth = 2.dp,
                    color = AufCta,
                )
            }
            Text(
                "Anmelden",
                style = MaterialTheme.typography.labelLarge,
                color = AufCta,
            )
        }

        (zustand as? EinstellungenViewModel.Zustand.Fehler)?.let {
            Spacer(Modifier.height(12.dp))
            Text(it.nachricht, color = Alarm, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(28.dp))
        Text(
            "Noch kein Konto? Registriere dich auf maptale.io.",
            style = MaterialTheme.typography.bodySmall,
            color = Gedaempft,
        )
        Spacer(Modifier.height(32.dp))
    }
}
