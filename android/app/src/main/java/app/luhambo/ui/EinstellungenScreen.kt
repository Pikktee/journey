// Einstellungen: Server-URL + Anmeldung (E-Mail/Passwort → API-Token).
// Das Passwort verlässt den Screen nur Richtung Login-Endpunkt und wird
// nirgends gespeichert.
package app.luhambo.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EinstellungenScreen(viewModel: EinstellungenViewModel, zurueck: () -> Unit) {
    val konto by viewModel.konto.collectAsState(initial = null)
    val zustand by viewModel.zustand.collectAsState()

    var server by rememberSaveable { mutableStateOf<String?>(null) }
    var email by rememberSaveable { mutableStateOf("") }
    var passwort by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(konto?.serverUrl) { server = server ?: konto?.serverUrl }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Einstellungen") },
                navigationIcon = {
                    IconButton(onClick = zurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück")
                    }
                },
            )
        },
    ) { innen ->
        Column(Modifier.fillMaxSize().padding(innen).padding(20.dp)) {
            OutlinedTextField(
                value = server ?: "",
                onValueChange = { server = it },
                label = { Text("Server-URL") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(20.dp))

            if (konto?.angemeldet == true) {
                Text("Angemeldet als ${konto?.email}", style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick = { viewModel.abmelden(server) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Abmelden")
                }
            } else {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("E-Mail") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = passwort,
                    onValueChange = { passwort = it },
                    label = { Text("Passwort") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = { viewModel.anmelden(server ?: "", email, passwort) },
                    enabled = zustand !is EinstellungenViewModel.Zustand.Laedt &&
                        email.isNotBlank() && passwort.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (zustand is EinstellungenViewModel.Zustand.Laedt) {
                        CircularProgressIndicator(Modifier.height(20.dp).padding(end = 8.dp))
                    }
                    Text("Anmelden")
                }
            }

            (zustand as? EinstellungenViewModel.Zustand.Fehler)?.let {
                Spacer(Modifier.height(12.dp))
                Text(it.nachricht, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
