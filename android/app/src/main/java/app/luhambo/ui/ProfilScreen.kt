// Profil — vorerst das Konto und die Summe der eigenen Reisen.
//
// Der Verifikations-Hinweis erscheint NUR, wenn die Adresse noch nicht bestätigt
// ist: ein grünes „Bestätigt" wäre eine Auszeichnung fürs Nichtstun und stünde
// dauerhaft im Weg. Fehlt die Bestätigung, blockiert sie dagegen jeden Upload —
// dann muss es auffallen.
package app.luhambo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfilScreen(viewModel: ProfilViewModel) {
    val konto by viewModel.konto.collectAsState()
    val lokale by viewModel.lokaleTouren.collectAsState(initial = emptyList())
    val vomServer by viewModel.serverTouren.collectAsState()

    LaunchedEffect(Unit) { viewModel.aktualisiere() }

    val statistik = remember(lokale, vomServer) {
        berechneReisestatistik(verschmelzeTouren(lokale, vomServer))
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Profil") }) }) { innen ->
        Column(
            Modifier.fillMaxSize().padding(innen).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Spacer(Modifier.height(4.dp))

            // — Reisen —
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                Kennzahl(statistik.touren.toString(), "Touren")
                Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.kilometer), "Kilometer")
                Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.hoehenmeter), "Höhenmeter")
            }

            if (konto != null && !konto!!.verifiziert) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        Modifier.padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.WarningAmber, contentDescription = null)
                        Text(
                            "Bestätige deine E-Mail-Adresse — bis dahin lassen sich keine Touren hochladen.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }

            // — Konto —
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Konto", style = MaterialTheme.typography.titleMedium)
                Text(
                    konto?.email ?: "…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                konto?.let { stand ->
                    if (stand.limitBytes > 0) {
                        LinearProgressIndicator(
                            progress = { stand.quotaAnteil.coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text(
                            "${megabyte(stand.benutztBytes)} von ${megabyte(stand.limitBytes)} belegt",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            OutlinedButton(onClick = viewModel::abmelden, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Abmelden", Modifier.padding(start = 8.dp))
            }
        }
    }
}

@Composable
private fun Kennzahl(wert: String, beschriftung: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(wert, style = MaterialTheme.typography.headlineMedium)
        Text(
            beschriftung,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

private fun megabyte(bytes: Long): String =
    String.format(Locale.GERMAN, "%.0f MB", bytes / 1024.0 / 1024.0)
