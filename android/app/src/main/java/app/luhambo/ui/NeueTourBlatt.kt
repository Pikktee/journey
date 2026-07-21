// Was vor dem Losfahren gefragt wird — und zwar einmal, nicht unterwegs.
//
// Früher standen sechs Modus-Chips während der ganzen Aufzeichnung auf dem
// Bildschirm und mussten bei jedem Wechsel bedient werden. Das ist genau das
// Falsche für eine App, die man in die Jackentasche steckt: die Angabe hilft
// beim Start (sie sagt dem Server, was das Hauptfortbewegungsmittel ist),
// unterwegs erkennt er Gehpausen später selbst.
//
// Beides ist optional. Wer nur auf „Aufzeichnen" tippt, kommt sofort los; der
// Titel wird beim Hochladen ohnehin aus den Ortsnamen gebildet.
package app.luhambo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.luhambo.daten.Modus

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NeueTourBlatt(
    schliessen: () -> Unit,
    starten: (titel: String?, modus: Modus) -> Unit,
) {
    val zustand = rememberModalBottomSheetState()
    var titel by remember { mutableStateOf("") }
    var modus by remember { mutableStateOf<Modus?>(null) }

    ModalBottomSheet(onDismissRequest = schliessen, sheetState = zustand) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Neue Tour", style = MaterialTheme.typography.headlineSmall)

            OutlinedTextField(
                value = titel,
                onValueChange = { titel = it },
                label = { Text("Titel (optional)") },
                placeholder = { Text("Wird sonst aus den Orten gebildet") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Womit bist du unterwegs?", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Optional — Gehpausen erkennt Luhambo selbst.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Modus.entries.forEach { eintrag ->
                        FilterChip(
                            selected = modus == eintrag,
                            // Nochmal tippen wählt wieder ab
                            onClick = { modus = if (modus == eintrag) null else eintrag },
                            label = { Text(eintrag.anzeige) },
                        )
                    }
                }
            }

            Button(
                onClick = { starten(titel.trim().ifBlank { null }, modus ?: Modus.WALK) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null)
                Text("Aufzeichnen", Modifier.padding(start = 8.dp))
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
