// Profil: das öffentliche Gesicht oben, das Konto darunter.
//
// Die Trennung ist keine Optik, sondern der Unterschied zwischen „was andere
// sehen" und „was mich betrifft". Deshalb wird der Anzeigename auch NIE mit dem
// Klarnamen aus der Registrierung vorbelegt — wer sich mit echtem Namen
// anmeldet, soll ihn nicht durch bloßes Nichtstun veröffentlichen.
//
// Der Verifikations-Hinweis erscheint nur, wenn die Adresse noch nicht bestätigt
// ist: ein grünes „Bestätigt" wäre eine Auszeichnung fürs Nichtstun. Fehlt die
// Bestätigung, blockiert sie dagegen jeden Upload — dann muss es auffallen.
package app.luhambo.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.luhambo.LuhamboApp
import coil.compose.AsyncImage
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfilScreen(viewModel: ProfilViewModel) {
    val konto by viewModel.konto.collectAsState()
    val lokale by viewModel.lokaleTouren.collectAsState(initial = emptyList())
    val vomServer by viewModel.serverTouren.collectAsState()
    val context = LocalContext.current
    val app = context.applicationContext as LuhamboApp

    var anzeigename by remember { mutableStateOf<String?>(null) }
    var bio by remember { mutableStateOf<String?>(null) }
    var hinweisOhneNamen by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.aktualisiere() }

    // Einmalig befüllen, sobald das Profil geladen ist; danach gehört der Text
    // dem Nutzer. Bewusst NICHT aus konto.name (dem Klarnamen) vorbelegt.
    LaunchedEffect(konto?.profil) {
        konto?.profil?.let {
            if (anzeigename == null) anzeigename = it.anzeigename.orEmpty()
            if (bio == null) bio = it.bio.orEmpty()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            if (anzeigename != null || bio != null) {
                viewModel.sichereProfil(anzeigename.orEmpty(), bio.orEmpty())
            }
        }
    }

    val bildWaehler = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) {
            viewModel.setzeAvatar { requireNotNull(context.contentResolver.openInputStream(uri)) }
        }
    }

    val statistik = remember(lokale, vomServer) {
        berechneReisestatistik(verschmelzeTouren(lokale, vomServer))
    }

    Scaffold(topBar = { TopAppBar(title = { Text("Profil") }) }) { innen ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(innen)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(4.dp))

            // — Bild —
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(104.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable {
                            bildWaehler.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                            )
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    val bild = konto?.profil?.avatarUrl?.let { app.serverUrl() + it }
                    if (bild != null) {
                        AsyncImage(
                            model = bild,
                            contentDescription = "Profilbild ändern",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Icon(
                            Icons.Default.AddAPhoto,
                            contentDescription = "Profilbild wählen",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (konto?.profil?.avatarUrl != null) {
                TextButton(
                    onClick = viewModel::loescheAvatar,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) { Text("Bild entfernen") }
            }

            // — Reisen —
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                Kennzahl(statistik.touren.toString(), "Touren")
                Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.kilometer), "Kilometer")
                Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.hoehenmeter), "Höhenmeter")
            }

            OutlinedTextField(
                value = anzeigename.orEmpty(),
                onValueChange = { anzeigename = it },
                label = { Text("Anzeigename") },
                placeholder = { Text("Wie du in der Galerie erscheinst") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = bio.orEmpty(),
                onValueChange = { bio = it },
                label = { Text("Über dich") },
                placeholder = { Text("Ein, zwei Sätze") },
                modifier = Modifier.fillMaxWidth().height(110.dp),
            )

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Profilseite öffentlich", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Deine öffentlichen Touren erscheinen unter einer eigenen Seite.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = konto?.profil?.oeffentlich == true,
                    onCheckedChange = { an ->
                        // Ohne Anzeigenamen wäre die Seite namenlos — einmal nachfragen
                        if (an && anzeigename.isNullOrBlank()) hinweisOhneNamen = true
                        else viewModel.setzeOeffentlich(an)
                    },
                )
            }

            HorizontalDivider()

            // — Konto —
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
            Spacer(Modifier.height(24.dp))
        }
    }

    if (hinweisOhneNamen) {
        AlertDialog(
            onDismissRequest = { hinweisOhneNamen = false },
            title = { Text("Noch ohne Anzeigenamen") },
            text = { Text("Ohne Anzeigenamen erscheint deine Profilseite namenlos. Trotzdem freischalten?") },
            confirmButton = {
                TextButton(onClick = {
                    hinweisOhneNamen = false
                    viewModel.setzeOeffentlich(true)
                }) { Text("Freischalten") }
            },
            dismissButton = { TextButton(onClick = { hinweisOhneNamen = false }) { Text("Abbrechen") } },
        )
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
