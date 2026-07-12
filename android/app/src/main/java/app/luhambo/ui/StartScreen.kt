// Start: Tourliste aus Room (Live-Flow) + Aufzeichnen-Knopf. Jede Zeile führt
// je nach Status weiter — laufende Aufnahme, Entwurf (Nachbearbeitung) oder
// hochgeladene Tour (Player).
package app.luhambo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StartScreen(
    viewModel: StartViewModel,
    zurAufzeichnung: () -> Unit,
    zurTour: (String) -> Unit,
    zuEinstellungen: () -> Unit,
) {
    val touren by viewModel.touren.collectAsState(initial = emptyList())
    val laufend by AufzeichnungsZustand.aktuell.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Luhambo") },
                actions = {
                    IconButton(onClick = zuEinstellungen) {
                        Icon(Icons.Default.Settings, contentDescription = "Einstellungen")
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = zurAufzeichnung,
                icon = { Icon(Icons.Default.FiberManualRecord, contentDescription = null) },
                text = { Text(if (laufend != null) "Aufnahme läuft" else "Aufzeichnen") },
            )
        },
    ) { innen ->
        if (touren.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(innen).padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Default.Route, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(
                    "Noch keine Touren — starte deine erste Aufzeichnung!",
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(innen),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(touren, key = { it.id }) { tour ->
                    TourZeile(tour) {
                        if (tour.status == TourStatus.AUFNAHME) zurAufzeichnung() else zurTour(tour.id)
                    }
                }
            }
        }
    }
}

@Composable
private fun TourZeile(tour: TourEntity, klick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = klick)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            val (symbol, farbe) = when (tour.status) {
                TourStatus.AUFNAHME -> Icons.Default.FiberManualRecord to MaterialTheme.colorScheme.error
                TourStatus.ENTWURF -> Icons.Default.CloudUpload to MaterialTheme.colorScheme.secondary
                TourStatus.LAEDT_HOCH -> Icons.Default.CloudUpload to MaterialTheme.colorScheme.primary
                TourStatus.HOCHGELADEN -> Icons.Default.CloudDone to MaterialTheme.colorScheme.primary
                TourStatus.FEHLER -> Icons.Default.Error to MaterialTheme.colorScheme.error
            }
            Icon(symbol, contentDescription = tour.status.name, tint = farbe)
            Spacer(Modifier.width(16.dp))
            Column {
                Text(
                    tour.titel ?: "Unbenannte Tour",
                    style = MaterialTheme.typography.titleMedium,
                )
                val datum = DateTimeFormatter.ofPattern("d. MMM yyyy, HH:mm", Locale.GERMAN)
                    .withZone(ZoneId.of(tour.zone))
                    .format(Instant.ofEpochMilli(tour.startMs))
                Text(
                    "$datum · ${"%.1f".format(Locale.GERMAN, tour.distanzM / 1000)} km",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
