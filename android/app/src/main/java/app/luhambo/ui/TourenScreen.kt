// Der Startbildschirm: EINE Liste aller Touren, neueste zuerst.
//
// Vorher standen „Auf diesem Gerät" und „Deine Touren" getrennt untereinander.
// Das machte den Upload-Zustand zur Ordnungsstruktur — der Nutzer musste
// verstehen, wo eine Tour gerade liegt, um sie zu finden. Seit die App
// automatisch hochlädt, ist das eine Durchgangsstation; die Verschmelzungsregeln
// stehen in Listenverschmelzung.kt.
package app.luhambo.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PlayCircleOutline
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.luhambo.LuhamboApp
import app.luhambo.aufzeichnung.AufzeichnungsZustand
import app.luhambo.daten.TourEntity
import app.luhambo.daten.TourStatus
import app.luhambo.upload.ServerTour
import coil.compose.AsyncImage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TourenScreen(
    viewModel: StartViewModel,
    zurAufzeichnung: () -> Unit,
    zurTour: (tourId: String) -> Unit,
    zumPlayer: (serverId: String) -> Unit,
) {
    val lokale by viewModel.lokaleTouren.collectAsState(initial = emptyList())
    val vomServer by viewModel.serverTouren.collectAsState()
    val laufend by AufzeichnungsZustand.aktuell.collectAsState()
    val app = LocalContext.current.applicationContext as LuhamboApp

    LaunchedEffect(Unit) { viewModel.aktualisiere() }
    // Nach dem Ende einer Aufnahme läuft der Upload automatisch — die
    // Server-Liste holt die Tour dann von selbst nach.
    LaunchedEffect(laufend?.tourId) { if (laufend == null) viewModel.aktualisiere() }

    val eintraege = remember(lokale, vomServer) { verschmelzeTouren(lokale, vomServer) }
    // Teilen direkt aus der Liste: Touren aus dem Studio haben keinen lokalen
    // Entwurf und wären ohne diesen Weg in der App gar nicht teilbar.
    var teilen by remember { mutableStateOf<ServerTour?>(null) }

    Scaffold(topBar = { TopAppBar(title = { Text("Touren") }) }) { innen ->
        if (eintraege.isEmpty()) {
            Column(
                Modifier.fillMaxSize().padding(innen).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Noch keine Reise", style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Tippe auf den roten Knopf, um deine erste Tour aufzuzeichnen.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Scaffold
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(innen),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(eintraege, key = { it.schluessel }) { eintrag ->
                when (eintrag) {
                    is Toureintrag.Lokal -> LokaleKarte(
                        tour = eintrag.tour,
                        // Das ÄLTESTE Foto (der Fluss läuft neueste zuerst) —
                        // dieselbe Wahl, die der Server beim Rendern trifft, damit
                        // die Karte nach dem Upload nicht das Bild wechselt.
                        titelbild = remember(eintrag.tour.id) { app.repository.medienFluss(eintrag.tour.id) }
                            .collectAsState(initial = emptyList()).value
                            .lastOrNull()
                            ?.let { app.repository.mediumDatei(it) },
                        beiKlick = {
                            if (eintrag.tour.status == TourStatus.AUFNAHME) zurAufzeichnung()
                            else zurTour(eintrag.tour.id)
                        },
                    )
                    is Toureintrag.Server -> ServerKarte(
                        tour = eintrag.tour,
                        bildUrl = eintrag.tour.cover?.let { app.serverUrl() + it },
                        beiKlick = { if (eintrag.tour.spielbar) zumPlayer(eintrag.tour.id) else zurTour(eintrag.tour.id) },
                        beiLangemDruck = { teilen = eintrag.tour },
                    )
                }
            }
        }
    }

    teilen?.let { tour ->
        TeilenBlatt(
            serverTourId = tour.id,
            titel = tour.titel,
            aktuelleSichtbarkeit = Sichtbarkeit.vonSchluessel(tour.visibility),
            schliessen = { teilen = null },
            setzeSichtbarkeit = { viewModel.setzeSichtbarkeit(tour.id, it) },
        )
    }
}

@Composable
private fun LokaleKarte(tour: TourEntity, titelbild: java.io.File?, beiKlick: () -> Unit) {
    val (symbol, farbe, zustand) = when (tour.status) {
        TourStatus.AUFNAHME -> Triple(Icons.Default.FiberManualRecord, Color(0xFFE5484D), "Aufnahme läuft")
        TourStatus.LAEDT_HOCH -> Triple(Icons.Default.CloudUpload, MaterialTheme.colorScheme.primary, "Wird hochgeladen")
        TourStatus.FEHLER -> Triple(Icons.Default.ErrorOutline, MaterialTheme.colorScheme.error, tour.fehler ?: "Fehler")
        else -> Triple(Icons.Default.CloudUpload, MaterialTheme.colorScheme.onSurfaceVariant, "Wartet auf Upload")
    }
    Karte(
        titel = tour.titel ?: "Unbenannte Tour",
        zeile = "${datum(tour.startMs, tour.zone)} · ${km(tour.distanzM / 1000)}",
        zustand = zustand,
        zustandsFarbe = farbe,
        symbol = symbol,
        bild = titelbild,
        beiKlick = beiKlick,
    )
}

@Composable
private fun ServerKarte(
    tour: ServerTour,
    bildUrl: String?,
    beiKlick: () -> Unit,
    beiLangemDruck: () -> Unit,
) {
    val (symbol, farbe, zustand) = when (tour.status) {
        "bereit" -> Triple(Icons.Default.PlayCircleOutline, MaterialTheme.colorScheme.primary, "Abspielen")
        "fehler" -> Triple(Icons.Default.ErrorOutline, MaterialTheme.colorScheme.error, "Verarbeitung fehlgeschlagen")
        else -> Triple(Icons.Default.HourglassEmpty, MaterialTheme.colorScheme.onSurfaceVariant, "Wird verarbeitet")
    }
    Karte(
        titel = tour.titel ?: tour.no,
        zeile = listOfNotNull(tour.no, tour.km?.let { km(it) }).joinToString(" · "),
        zustand = zustand,
        zustandsFarbe = farbe,
        symbol = symbol,
        bild = bildUrl,
        beiKlick = beiKlick,
        beiLangemDruck = beiLangemDruck,
    )
}

@Composable
private fun Karte(
    titel: String,
    zeile: String,
    zustand: String,
    zustandsFarbe: Color,
    symbol: ImageVector,
    bild: Any?,
    beiKlick: () -> Unit,
    beiLangemDruck: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = beiKlick, onLongClick = beiLangemDruck),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(72.dp).clip(RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (bild != null) {
                AsyncImage(
                    model = bild,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                // Noch kein Bild: eine ruhige Fläche statt eines leeren Lochs
                Box(
                    Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.Image,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                }
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                titel,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                zeile,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(symbol, contentDescription = null, tint = zustandsFarbe, modifier = Modifier.size(14.dp))
                Text(
                    zustand,
                    style = MaterialTheme.typography.labelMedium,
                    color = zustandsFarbe,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private fun km(wert: Double): String = String.format(Locale.GERMAN, "%.1f km", wert)

private fun datum(ms: Long, zone: String): String = runCatching {
    DateTimeFormatter.ofPattern("d. MMM yyyy", Locale.GERMAN)
        .withZone(ZoneId.of(zone))
        .format(Instant.ofEpochMilli(ms))
}.getOrDefault("")
