// Aufzeichnung: Telemetrie (Dauer/Distanz), Modus-Chips (Wechsel unterwegs ⇒
// Segmente), Foto-Knopf, Pause/Stopp. Der Screen steuert nur den Service —
// aufgezeichnet wird dort, der Zustand kommt per StateFlow zurück.
package app.luhambo.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.luhambo.aufzeichnung.AufzeichnungsService
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import app.luhambo.daten.Modus
import kotlinx.coroutines.delay
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AufzeichnungScreen(zurKamera: () -> Unit, fertig: (tourId: String) -> Unit) {
    val context = LocalContext.current
    val aufnahme by AufzeichnungsZustand.aktuell.collectAsState()

    // Uhr für die Dauer-Anzeige (1-Hz-Tick, unabhängig von GPS-Updates)
    var jetztMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(aufnahme?.tourId) {
        while (true) {
            jetztMs = System.currentTimeMillis()
            delay(1000)
        }
    }

    // Berechtigungen: Standort (Pflicht) + Notification (ab 33) vor dem Start
    val rechteLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { ergebnis ->
        if (ergebnis[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            AufzeichnungsService.starte(context, Modus.WALK)
        }
    }
    // Kamera-Berechtigung erst am Foto-Knopf — ohne sie bliebe die CameraX-
    // Vorschau einfach schwarz, das wäre für den Nutzer unerklärlich
    val kameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { erlaubt -> if (erlaubt) zurKamera() }

    Scaffold(
        topBar = { TopAppBar(title = { Text(if (aufnahme == null) "Neue Tour" else "Aufzeichnung") }) },
    ) { innen ->
        Column(
            Modifier.fillMaxSize().padding(innen).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val laufend = aufnahme
            if (laufend == null) {
                Spacer(Modifier.height(48.dp))
                Text("Bereit für die nächste Reise?", style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(24.dp))
                Button(onClick = {
                    val rechte = buildList {
                        add(Manifest.permission.ACCESS_FINE_LOCATION)
                        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                    }
                    rechteLauncher.launch(rechte.toTypedArray())
                }) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Text("Aufzeichnung starten", Modifier.padding(start = 8.dp))
                }
            } else {
                // — Telemetrie —
                val dauerS = ((jetztMs - laufend.startMs) / 1000).coerceAtLeast(0)
                Text(
                    String.format(Locale.GERMAN, "%d:%02d:%02d", dauerS / 3600, dauerS / 60 % 60, dauerS % 60),
                    style = MaterialTheme.typography.displayMedium,
                )
                Text(
                    String.format(Locale.GERMAN, "%.2f km · %d Punkte", laufend.distanzM / 1000, laufend.punktAnzahl),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (laufend.pausiert) {
                    Text("Pausiert", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
                }

                Spacer(Modifier.height(24.dp))

                // — Fortbewegungsmittel (Wechsel erzeugt neues Segment) —
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Modus.entries.forEach { modus ->
                        FilterChip(
                            selected = laufend.modus == modus,
                            onClick = { AufzeichnungsService.wechsleModus(context, modus) },
                            label = { Text(modus.anzeige) },
                        )
                    }
                }

                Spacer(Modifier.height(32.dp))

                // — Foto —
                Button(
                    onClick = { kameraLauncher.launch(Manifest.permission.CAMERA) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.PhotoCamera, contentDescription = null)
                    Text("Foto aufnehmen", Modifier.padding(start = 8.dp))
                }

                Spacer(Modifier.height(12.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = {
                        if (laufend.pausiert) AufzeichnungsService.setzeFort(context)
                        else AufzeichnungsService.pausiere(context)
                    }) {
                        Icon(
                            if (laufend.pausiert) Icons.Default.PlayArrow else Icons.Default.Pause,
                            contentDescription = null,
                        )
                        Text(if (laufend.pausiert) "Weiter" else "Pause", Modifier.padding(start = 8.dp))
                    }
                    Button(onClick = {
                        val tourId = laufend.tourId
                        AufzeichnungsService.stoppe(context)
                        fertig(tourId)
                    }) {
                        Icon(Icons.Default.Stop, contentDescription = null)
                        Text("Beenden", Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
    }
}
