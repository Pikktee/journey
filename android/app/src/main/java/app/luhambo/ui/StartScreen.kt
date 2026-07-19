// Start: zwei Quellen. „Auf diesem Gerät" = lokale Entwürfe/Aufnahmen (Room),
// die noch hochgeladen/nachbearbeitet werden. „Deine Touren" = die Touren des
// Kontos vom Server (inkl. der im Web-Studio erstellten, GET /api/tours) — die
// spielt der WebView-Player ab. Hochgeladene lokale Touren erscheinen nur in der
// Server-Liste (Dedup über den Status), nicht doppelt.
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
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import app.luhambo.upload.ServerTour
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
    zumPlayer: (String) -> Unit,
    zuEinstellungen: () -> Unit,
    zuImport: () -> Unit,
) {
    val lokale by viewModel.lokaleTouren.collectAsState(initial = emptyList())
    val serverTouren by viewModel.serverTouren.collectAsState()
    val laufend by AufzeichnungsZustand.aktuell.collectAsState()

    // Bei jedem Betreten die Server-Liste auffrischen (z. B. nach einem Upload).
    LaunchedEffect(Unit) { viewModel.aktualisiere() }

    // Hochgeladene lokale Touren stehen bereits in der Server-Liste → hier nur die
    // noch nicht (fertig) hochgeladenen Entwürfe zeigen, sonst erscheinen sie doppelt.
    val entwuerfe = lokale.filter { it.status != TourStatus.HOCHGELADEN }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Luhambo") },
                actions = {
                    IconButton(onClick = zuImport) {
                        Icon(Icons.Default.FileUpload, contentDescription = "Tour importieren")
                    }
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
        if (entwuerfe.isEmpty() && serverTouren.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(innen).padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Default.Route, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(
                    "Noch keine Touren — starte deine erste Aufzeichnung oder lade eine im Studio hoch!",
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
                if (entwuerfe.isNotEmpty()) {
                    item { Abschnitt("Auf diesem Gerät") }
                    items(entwuerfe, key = { it.id }) { tour ->
                        TourZeile(tour) {
                            if (tour.status == TourStatus.AUFNAHME) zurAufzeichnung() else zurTour(tour.id)
                        }
                    }
                }
                if (serverTouren.isNotEmpty()) {
                    item { Abschnitt("Deine Touren") }
                    items(serverTouren, key = { it.id }) { tour ->
                        ServerTourZeile(tour) { if (tour.spielbar) zumPlayer(tour.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Abschnitt(titel: String) {
    Text(
        titel,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 4.dp, top = 8.dp, bottom = 2.dp),
    )
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

@Composable
private fun ServerTourZeile(tour: ServerTour, klick: () -> Unit) {
    Card(
        Modifier.fillMaxWidth().let { if (tour.spielbar) it.clickable(onClick = klick) else it },
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            val (symbol, farbe) = when (tour.status) {
                "bereit" -> Icons.Default.PlayArrow to MaterialTheme.colorScheme.primary
                "fehler" -> Icons.Default.Error to MaterialTheme.colorScheme.error
                else -> Icons.Default.CloudUpload to MaterialTheme.colorScheme.secondary
            }
            Icon(symbol, contentDescription = tour.status, tint = farbe)
            Spacer(Modifier.width(16.dp))
            Column {
                Text(
                    tour.titel ?: "Unbenannte Tour",
                    style = MaterialTheme.typography.titleMedium,
                )
                val zeile = when (tour.status) {
                    "bereit" -> buildString {
                        append(tour.no)
                        tour.km?.let { append(" · ${"%.1f".format(Locale.GERMAN, it)} km") }
                    }
                    "fehler" -> "Verarbeitung fehlgeschlagen"
                    else -> "${tour.no} · wird verarbeitet …"
                }
                Text(
                    zeile,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
