// Aufzeichnung: Dauer und Distanz als Bühne, darunter Foto, Pause und Ende.
// Der Screen steuert nur den Service — aufgezeichnet wird dort, der Zustand
// kommt per StateFlow zurück.
//
// Die Uhr steht groß und allein in der Mitte, weil sie das Einzige ist, was man
// hier im Vorbeigehen ablesen will; alles andere ist Bedienung und sitzt unten
// am Daumen. Ihre Ziffern sind gleich breit — in einer Proportionalschrift
// zappelt die Anzeige bei jedem Sekundenschlag.
package app.luhambo.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.luhambo.LuhamboApp
import app.luhambo.aufzeichnung.AufzeichnungsService
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import java.util.Locale

@Composable
fun AufzeichnungScreen(
    zurKamera: () -> Unit,
    zumFoto: (tourId: String, mediumId: String) -> Unit,
    fertig: (tourId: String) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as LuhamboApp
    val aufnahme by AufzeichnungsZustand.aktuell.collectAsState()

    // Uhr für die Dauer-Anzeige (1-Hz-Tick, unabhängig von GPS-Updates)
    var jetztMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(aufnahme?.tourId) {
        while (true) {
            jetztMs = System.currentTimeMillis()
            delay(1000)
        }
    }

    // Kamera-Berechtigung erst am Foto-Knopf — ohne sie bliebe die CameraX-
    // Vorschau einfach schwarz, das wäre für den Nutzer unerklärlich
    val kameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { erlaubt -> if (erlaubt) zurKamera() }

    val laufend = aufnahme
    if (laufend == null) {
        // Zwischenzustand: die Aufnahme ist gerade beendet worden und der
        // Bildschirm wird abgeräumt. Gestartet wird ausschließlich über den
        // Knopf in der Hauptleiste.
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                "Keine laufende Aufzeichnung",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(20.dp))
        Zustandsmarke(pausiert = laufend.pausiert)

        Spacer(Modifier.weight(1f))

        // — Die Uhr —
        val dauerS = ((jetztMs - laufend.startMs) / 1000).coerceAtLeast(0)
        Text(
            String.format(Locale.GERMAN, "%d:%02d:%02d", dauerS / 3600, dauerS / 60 % 60, dauerS % 60),
            style = MaterialTheme.typography.displayLarge,
        )
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            Wert(String.format(Locale.GERMAN, "%.2f", laufend.distanzM / 1000), "Kilometer")
            Wert(laufend.punktAnzahl.toString(), "Punkte")
        }

        Spacer(Modifier.weight(1f))

        // — Was bisher aufgenommen wurde —
        // Ohne den Streifen verschwindet jedes Foto nach dem Auslösen spurlos;
        // man weiß bis zum Hochladen nicht, ob es etwas geworden ist. Neueste
        // zuerst, weil das eben Ausgelöste zuerst zählt.
        val medien by remember(laufend.tourId) {
            app.repository.medienFluss(laufend.tourId)
        }.collectAsState(initial = emptyList())

        if (medien.isNotEmpty()) {
            LazyRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(medien, key = { it.id }) { medium ->
                    AsyncImage(
                        model = app.repository.mediumDatei(medium),
                        contentDescription = medium.caption ?: "Aufnahme ${medium.id}",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(64.dp)
                            .clip(MaterialTheme.shapes.small)
                            .clickable { zumFoto(laufend.tourId, medium.id) },
                    )
                }
            }
            Spacer(Modifier.height(20.dp))
        }

        // — Bedienung —
        Button(
            onClick = { kameraLauncher.launch(Manifest.permission.CAMERA) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Icon(Icons.Default.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("Foto aufnehmen", Modifier.padding(start = 10.dp))
        }
        Spacer(Modifier.height(10.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedButton(
                onClick = {
                    if (laufend.pausiert) AufzeichnungsService.setzeFort(context)
                    else AufzeichnungsService.pausiere(context)
                },
                modifier = Modifier.weight(1f).height(52.dp),
            ) {
                Icon(
                    if (laufend.pausiert) Icons.Default.PlayArrow else Icons.Default.Pause,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Text(if (laufend.pausiert) "Weiter" else "Pause", Modifier.padding(start = 8.dp))
            }
            OutlinedButton(
                onClick = {
                    val tourId = laufend.tourId
                    AufzeichnungsService.stoppe(context)
                    fertig(tourId)
                },
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Alarm),
                modifier = Modifier.weight(1f).height(52.dp),
            ) {
                Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Beenden", Modifier.padding(start = 8.dp))
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

/** Kopfzeile mit Punkt: rot, solange aufgezeichnet wird — grau in der Pause. */
@Composable
private fun Zustandsmarke(pausiert: Boolean) {
    Row(
        Modifier
            .background(MaterialTheme.colorScheme.surfaceContainer, CircleShape)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .padding(start = 12.dp, end = 15.dp, top = 7.dp, bottom = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (pausiert) MaterialTheme.colorScheme.onSurfaceVariant else Alarm),
        )
        Text(
            if (pausiert) "PAUSIERT" else "AUFZEICHNUNG",
            style = MaterialTheme.typography.labelSmall,
            color = if (pausiert) MaterialTheme.colorScheme.onSurfaceVariant else Tinte,
        )
    }
}

/** Eine Kennzahl mit Beschriftung darunter. */
@Composable
private fun Wert(wert: String, beschriftung: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(wert, style = MaterialTheme.typography.headlineMedium, fontFamily = Mono)
        Spacer(Modifier.height(3.dp))
        Text(
            beschriftung.uppercase(Locale.GERMAN),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
