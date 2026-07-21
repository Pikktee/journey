// Der Startbildschirm: EINE Liste aller Touren, neueste zuerst.
//
// Vorher standen „Auf diesem Gerät" und „Deine Touren" getrennt untereinander.
// Das machte den Upload-Zustand zur Ordnungsstruktur — der Nutzer musste
// verstehen, wo eine Tour gerade liegt, um sie zu finden. Seit die App
// automatisch hochlädt, ist das eine Durchgangsstation; die Verschmelzungsregeln
// stehen in Listenverschmelzung.kt.
//
// Jede Tour ist eine große Bildkarte, keine Zeile mit Briefmarke. Der Grund ist
// nicht Geschmack: Das Foto ist das Einzige, woran man eine eigene Reise
// wiedererkennt — „N°02, 1,4 km" sagt einem nichts, das Bild vom Hauseingang
// alles. Vorher stand in jeder Zeile zusätzlich „Abspielen" in Signalfarbe.
// Das ist der Normalfall und damit keine Nachricht; die ganze Karte führt
// ohnehin dorthin. Sichtbar bleiben nur die AUSNAHMEN — lädt hoch, wird
// verarbeitet, fehlgeschlagen —, denn nur die verlangen etwas vom Nutzer.
package app.luhambo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.outlined.Landscape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
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

/** Was auf einer Karte über dem Bild liegt, wenn etwas zu melden ist. */
private data class Meldung(val symbol: ImageVector, val farbe: Color, val text: String)

@Composable
fun TourenScreen(
    viewModel: StartViewModel,
    zurAufzeichnung: () -> Unit,
    zurTour: (tourId: String) -> Unit,
    zurServerTour: (serverId: String) -> Unit,
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

    Box(Modifier.fillMaxSize()) {
        if (eintraege.isEmpty()) {
            Column(Modifier.fillMaxSize()) {
                Kopfabstand()
                // weight, nicht fillMaxSize: Letzteres nähme die volle Höhe der
                // Spalte statt des Rests unter dem Kopfabstand und liefe unten
                // aus dem Bild.
                LeereListe(Modifier.weight(1f))
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                // Der Auslöser ragt 20 dp über die Leiste hinaus — ohne diesen
                // Zuschlag verschwindet die letzte Karte teilweise darunter.
                contentPadding = PaddingValues(bottom = 44.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                item(key = "kopf") { Kopfabstand() }

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
                            // Tippen öffnet die Reise, nicht den Player: Fotos,
                            // Umbenennen und Löschen gäbe es sonst nirgends, und
                            // der Abspielen-Knopf steht dort groß im Titelbild.
                            beiKlick = { zurServerTour(eintrag.tour.id) },
                            beiLangemDruck = { teilen = eintrag.tour },
                        )
                    }
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

/**
 * Luft zwischen Statusleiste und erster Karte.
 *
 * Hier stand der Markenschriftzug „LUHAMBO". Das ist eine Gewohnheit aus dem
 * Web und von iOS-Apps; unter Android gehört der App-Name in den Launcher und
 * die Übersicht der laufenden Anwendungen, nicht in die Anwendung selbst — dort
 * sieht Material einen Titel für den BILDSCHIRM vor. Der hieße hier „Touren"
 * wie der Reiter darunter, auf dem man ohnehin gerade steht. Also keiner von
 * beiden: Die Reisen fangen oben an.
 */
@Composable
private fun Kopfabstand() {
    Spacer(Modifier.statusBarsPadding().height(14.dp))
}

@Composable
private fun LeereListe(modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Outlined.Landscape,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
            modifier = Modifier.size(44.dp),
        )
        Spacer(Modifier.height(20.dp))
        Text("Noch keine Reise", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(10.dp))
        Text(
            // Der Knopf ist gelb, nicht rot — er wird es erst, während
            // aufgezeichnet wird.
            "Tippe unten auf den gelben Knopf, und Luhambo zeichnet deinen Weg auf.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun LokaleKarte(tour: TourEntity, titelbild: java.io.File?, beiKlick: () -> Unit) {
    // Eine lokale Tour ist per Definition noch nicht durch — sie hat immer
    // etwas zu melden.
    val meldung = when (tour.status) {
        TourStatus.AUFNAHME -> Meldung(Icons.Default.FiberManualRecord, Alarm, "Aufnahme läuft")
        TourStatus.LAEDT_HOCH -> Meldung(Icons.Default.CloudUpload, Sonne, "Wird geladen")
        TourStatus.FEHLER -> Meldung(Icons.Default.ErrorOutline, Alarm, tour.fehler ?: "Fehler")
        else -> Meldung(Icons.Default.CloudUpload, Tinte, "Wartet auf Upload")
    }
    Bildkarte(
        titel = tour.titel ?: "Unbenannte Tour",
        marke = null,
        meta = listOfNotNull(km(tour.distanzM / 1000), datum(tour.startMs, tour.zone)),
        meldung = meldung,
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
    val meldung = when (tour.status) {
        // „bereit" ist der Normalfall und deshalb stumm
        "bereit" -> null
        "fehler" -> Meldung(Icons.Default.ErrorOutline, Alarm, "Fehlgeschlagen")
        else -> Meldung(Icons.Default.HourglassEmpty, Sonne, "Wird verarbeitet")
    }
    Bildkarte(
        titel = tour.titel ?: tour.no,
        marke = tour.no,
        meta = listOfNotNull(tour.km?.let { km(it) }, isoDatum(tour.erstelltAm)),
        meldung = meldung,
        bild = bildUrl,
        beiKlick = beiKlick,
        beiLangemDruck = beiLangemDruck,
    )
}

/**
 * Eine Reise als Bild mit Beschriftung darauf.
 *
 * Der Verlauf ist kein Dekor: Über einem hellen Himmel wäre weiße Schrift sonst
 * unlesbar, und wie hell das Titelbild unten ist, weiß man vorher nie.
 */
@Composable
private fun Bildkarte(
    titel: String,
    marke: String?,
    meta: List<String>,
    meldung: Meldung?,
    bild: Any?,
    beiKlick: () -> Unit,
    beiLangemDruck: (() -> Unit)? = null,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(MaterialTheme.shapes.large)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .combinedClickable(onClick = beiKlick, onLongClick = beiLangemDruck)
            // Etwas flacher als das 3:2 der Fotos: beschnitten wird ohnehin, und
            // so sind zwei Reisen ganz und die dritte angeschnitten zu sehen —
            // die Liste lädt zum Weiterblättern ein, statt bei einer aufzuhören.
            .aspectRatio(16f / 10f),
    ) {
        if (bild != null) {
            AsyncImage(
                model = bild,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            // Noch kein Foto: keine leere Grube, sondern eine ruhige Fläche
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Outlined.Landscape,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
                    modifier = Modifier.size(38.dp),
                )
            }
        }

        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        0.42f to Color(0x1A000000),
                        1f to Color(0xE00A0D12),
                    ),
                ),
        )

        if (marke != null) {
            Plakette(marke, Modifier.align(Alignment.TopStart).padding(14.dp))
        }
        if (meldung != null) {
            Zustandsplakette(meldung, Modifier.align(Alignment.TopEnd).padding(14.dp))
        }

        Column(
            Modifier
                .align(Alignment.BottomStart)
                .padding(start = 18.dp, end = 22.dp, bottom = 16.dp, top = 18.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                titel,
                style = MaterialTheme.typography.headlineSmall,
                color = Tinte,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (meta.isNotEmpty()) {
                Text(
                    // Der Punkt trennt in einer Schrift mit gleich breiten
                    // Zeichen weit genug; doppelte Leerzeichen rissen die Zeile
                    // sichtbar auseinander.
                    meta.joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = Tinte.copy(alpha = 0.78f),
                )
            }
        }
    }
}

/** Die Tour-Nummer, wie sie auch auf der Website über den Bildern steht. */
@Composable
private fun Plakette(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = Tinte,
        modifier = modifier
            .background(Color(0x8A06090E), CircleShape)
            .border(1.dp, Color(0x33FFFFFF), CircleShape)
            .padding(horizontal = 11.dp, vertical = 5.dp),
    )
}

@Composable
private fun Zustandsplakette(meldung: Meldung, modifier: Modifier = Modifier) {
    Row(
        modifier
            .background(Color(0xB306090E), CircleShape)
            .border(1.dp, Color(0x33FFFFFF), CircleShape)
            .padding(start = 9.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(meldung.symbol, contentDescription = null, tint = meldung.farbe, modifier = Modifier.size(13.dp))
        Text(
            meldung.text,
            style = MaterialTheme.typography.labelSmall,
            color = meldung.farbe,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun km(wert: Double): String = String.format(Locale.GERMAN, "%.1f km", wert)

private val DATUM = DateTimeFormatter.ofPattern("d. MMM yyyy", Locale.GERMAN)

private fun datum(ms: Long, zone: String): String? = runCatching {
    DATUM.withZone(ZoneId.of(zone)).format(Instant.ofEpochMilli(ms))
}.getOrNull()

private fun isoDatum(iso: String): String? = runCatching {
    DATUM.withZone(ZoneId.systemDefault()).format(Instant.parse(iso))
}.getOrNull()
