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
//
// Oben steht die Reisebilanz, nicht das Formular: Wer sein Profil öffnet, will
// in aller Regel sehen, was er zusammengereist hat, und nicht seine Bio pflegen.
package app.luhambo.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.luhambo.LuhamboApp
import coil.compose.AsyncImage
import java.util.Locale

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
    val nameFokus = remember { FocusRequester() }

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

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.statusBarsPadding().height(24.dp))

        // — Wer man ist —
        Box(
            Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
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
                    modifier = Modifier.size(26.dp),
                )
            }
        }

        Spacer(Modifier.height(14.dp))
        val name = anzeigename?.takeIf { it.isNotBlank() }
        if (name != null) {
            Text(name, style = MaterialTheme.typography.headlineMedium)
        } else {
            // Kein Name gesetzt: nicht „Ohne Anzeigenamen" in Überschriftgröße
            // hinschreiben — das macht aus einer Leerstelle einen Vorwurf.
            // Stattdessen der Weg, sie zu füllen; der Fokus springt ins Feld
            // weiter unten, und Compose scrollt es von selbst ins Bild.
            TextButton(
                onClick = { nameFokus.requestFocus() },
                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
            ) { Text("Anzeigenamen festlegen") }
        }
        if (konto?.profil?.avatarUrl != null) {
            TextButton(
                onClick = viewModel::loescheAvatar,
                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
                colors = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            ) { Text("Bild entfernen") }
        }

        // — Was man gereist ist —
        Spacer(Modifier.height(24.dp))
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Kennzahl(statistik.touren.toString(), "Reisen", Modifier.weight(1f))
            Trenner()
            Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.kilometer), "Kilometer", Modifier.weight(1f))
            Trenner()
            Kennzahl(String.format(Locale.GERMAN, "%.0f", statistik.hoehenmeter), "Höhenmeter", Modifier.weight(1f))
        }

        Spacer(Modifier.height(34.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // — Was andere sehen —
        Spacer(Modifier.height(26.dp))
        Abschnittstitel("Öffentliches Profil")
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = anzeigename.orEmpty(),
            onValueChange = { anzeigename = it },
            label = { Text("Anzeigename") },
            placeholder = { Text("Wie du in der Galerie erscheinst") },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.fillMaxWidth().focusRequester(nameFokus),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = bio.orEmpty(),
            onValueChange = { bio = it },
            label = { Text("Über dich") },
            placeholder = { Text("Ein, zwei Sätze") },
            textStyle = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.fillMaxWidth().height(104.dp),
        )

        Spacer(Modifier.height(18.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Profilseite freigeben", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(2.dp))
                Text(
                    "Deine öffentlichen Reisen erscheinen dann unter einer eigenen Seite.",
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

        Spacer(Modifier.height(30.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        // — Was einen selbst betrifft —
        Spacer(Modifier.height(26.dp))
        Abschnittstitel("Konto")
        Spacer(Modifier.height(14.dp))

        if (konto != null && !konto!!.verifiziert) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(MaterialTheme.shapes.medium)
                    .background(MaterialTheme.colorScheme.errorContainer)
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Default.WarningAmber,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    "Bestätige deine E-Mail-Adresse — bis dahin lassen sich keine Reisen hochladen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            Spacer(Modifier.height(14.dp))
        }

        Text(
            konto?.email ?: "…",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )

        konto?.let { stand ->
            if (stand.limitBytes > 0) {
                Spacer(Modifier.height(16.dp))
                LinearProgressIndicator(
                    progress = { stand.quotaAnteil.coerceIn(0f, 1f) },
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    color = Sonne,
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "${megabyte(stand.benutztBytes)} von ${megabyte(stand.limitBytes)} belegt",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(Modifier.height(26.dp))
        TextButton(onClick = viewModel::abmelden) {
            Icon(
                Icons.AutoMirrored.Filled.Logout,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Text("Abmelden", Modifier.padding(start = 8.dp))
        }
        Spacer(Modifier.height(56.dp))
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

/** Eine Zahl mit ihrer Bedeutung darunter — Ziffern in gleicher Breite. */
@Composable
private fun Kennzahl(wert: String, beschriftung: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(wert, style = MaterialTheme.typography.displayMedium.copy(fontSize = 30.sp))
        Spacer(Modifier.height(4.dp))
        Text(
            beschriftung.uppercase(Locale.GERMAN),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Senkrechter Strich zwischen den Kennzahlen. */
@Composable
private fun Trenner() {
    Box(
        Modifier
            .width(1.dp)
            .height(30.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

private fun megabyte(bytes: Long): String =
    String.format(Locale.GERMAN, "%.0f MB", bytes / 1024.0 / 1024.0)
