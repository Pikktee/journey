// Teilen: erst entscheiden, wer die Tour sehen darf, dann den Link verschicken.
//
// Beides in einem Blatt, weil es dieselbe Frage ist. Ein Link auf eine private
// Tour wäre eine Enttäuschung für den Empfänger — deshalb ist „Link senden"
// gesperrt, solange „Privat" gewählt ist, statt hinterher zu erklären, warum
// niemand etwas sieht.
package app.luhambo.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeilenBlatt(
    serverTourId: String,
    titel: String?,
    aktuelleSichtbarkeit: Sichtbarkeit,
    schliessen: () -> Unit,
    setzeSichtbarkeit: (Sichtbarkeit) -> Unit,
) {
    val zustand = rememberModalBottomSheetState()
    val context = LocalContext.current
    var gewaehlt by remember { mutableStateOf(aktuelleSichtbarkeit) }

    ModalBottomSheet(onDismissRequest = schliessen, sheetState = zustand) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("Teilen", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))

            Sichtbarkeit.waehlbare(GALERIE_VERFUEGBAR).forEach { stufe ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = gewaehlt == stufe,
                            onClick = {
                                gewaehlt = stufe
                                setzeSichtbarkeit(stufe)
                            },
                        )
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    RadioButton(selected = gewaehlt == stufe, onClick = null)
                    Column {
                        Text(stufe.anzeige, style = MaterialTheme.typography.titleSmall)
                        Text(
                            stufe.erklaerung,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { sendeLink(context, serverTourId, titel) },
                enabled = gewaehlt != Sichtbarkeit.PRIVAT,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Link senden", Modifier.padding(start = 8.dp))
            }
            if (gewaehlt == Sichtbarkeit.PRIVAT) {
                Text(
                    "Wähle „Über Link“, um die Tour verschicken zu können.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/** Systemweites Teilen-Menü mit Link und Titel. */
private fun sendeLink(context: Context, serverTourId: String, titel: String?) {
    val link = teilenLink(serverTourId)
    val absicht = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, if (titel.isNullOrBlank()) link else "$titel\n$link")
        putExtra(Intent.EXTRA_SUBJECT, titel ?: "Eine Tour auf Luhambo")
    }
    context.startActivity(Intent.createChooser(absicht, "Tour teilen"))
}
