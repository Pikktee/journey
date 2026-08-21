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
import androidx.compose.material3.LocalContentColor
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
fun LoginScreen(viewModel: SettingsViewModel) {
    val state by viewModel.state.collectAsState()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val loading = state is SettingsViewModel.State.Loading

    Column(
        Modifier
            .fillMaxSize()
            .background(Night)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(32.dp))
        WordMark(brandSize = 32.dp)
        Spacer(Modifier.height(22.dp))
        Text(
            "Deine Reisen als filmischer Flug über echtes Gelände.",
            style = MaterialTheme.typography.headlineSmall,
            color = Ink,
        )
        Spacer(Modifier.height(34.dp))

        BrandField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-Mail") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !loading,
        )
        Spacer(Modifier.height(12.dp))
        BrandField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Passwort") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !loading,
        )
        Spacer(Modifier.height(20.dp))
        PrimaryButton(
            onClick = { viewModel.login(email.trim(), password) },
            enabled = !loading && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) {
                CircularProgressIndicator(
                    Modifier.size(16.dp).padding(end = 8.dp),
                    strokeWidth = 2.dp,
                    color = LocalContentColor.current,
                )
            }
            Text(
                "Anmelden",
                style = MaterialTheme.typography.labelLarge,
                color = LocalContentColor.current,
            )
        }

        (state as? SettingsViewModel.State.Failed)?.let {
            Spacer(Modifier.height(12.dp))
            Text(it.message, color = Danger, style = MaterialTheme.typography.bodyMedium)
        }

        Spacer(Modifier.height(28.dp))
        Text(
            "Noch kein Konto? Registriere dich auf maptale.io.",
            style = MaterialTheme.typography.bodySmall,
            color = Muted,
        )
        Spacer(Modifier.height(32.dp))
    }
}
