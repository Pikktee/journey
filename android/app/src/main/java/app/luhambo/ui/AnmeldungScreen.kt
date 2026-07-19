// Anmeldung als Start-Gate: ohne gültiges Token zeigt die Navigation zuerst
// diesen Screen — Aufzeichnen, Touren und Abspielen erst nach dem Login. Die
// Server-Adresse ist fest verdrahtet (Prod), es gibt kein Eingabefeld mehr.
// Konto anlegen läuft über die Website (Registrierung/Verifikation im Studio).
package app.luhambo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp

@Composable
fun AnmeldungScreen(viewModel: EinstellungenViewModel) {
    val zustand by viewModel.zustand.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var passwort by rememberSaveable { mutableStateOf("") }
    val laedt = zustand is EinstellungenViewModel.Zustand.Laedt

    Column(
        Modifier.fillMaxSize().padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "Luhambo",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            "Melde dich an, um deine Touren aufzuzeichnen, hochzuladen und abzuspielen.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-Mail") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !laedt,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
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
        Button(
            onClick = { viewModel.anmelden(email.trim(), passwort) },
            enabled = !laedt && email.isNotBlank() && passwort.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (laedt) {
                CircularProgressIndicator(Modifier.size(18.dp).padding(end = 8.dp))
            }
            Text("Anmelden")
        }

        (zustand as? EinstellungenViewModel.Zustand.Fehler)?.let {
            Spacer(Modifier.height(12.dp))
            Text(it.nachricht, color = MaterialTheme.colorScheme.error)
        }

        Spacer(Modifier.height(24.dp))
        Text(
            "Noch kein Konto? Registriere dich auf luhambo.henrikheil.net.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
