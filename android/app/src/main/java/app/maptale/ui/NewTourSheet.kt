// Was vor dem Losfahren gefragt wird — und zwar einmal, nicht unterwegs.
//
// Früher standen sechs Modus-Chips während der ganzen Aufzeichnung auf dem
// Bildschirm und mussten bei jedem Wechsel bedient werden. Das ist genau das
// Falsche für eine App, die man in die Jackentasche steckt: die Angabe hilft
// beim Start (sie sagt dem Server, was das Hauptfortbewegungsmittel ist),
// unterwegs erkennt er Gehpausen später selbst.
//
// Auch das Titelfeld ist weg. Am Anfang einer Reise weiß man selten, wie sie
// heißen soll, und der Server benennt sie beim Hochladen ohnehin nach den
// Orten, durch die sie führt. Wer einen eigenen Namen will, schreibt ihn
// hinterher in der Tour selbst — dort steht er groß im Titelbild. Ein Feld, das
// man beim Losgehen fast immer überspringt, kostet nur einen Blick.
//
// „Automatisch" ist die Vorauswahl und war es faktisch schon immer: Ohne Angabe
// ging bisher `walk` zum Server, und `walk` ist genau der Wert, bei dem er das
// Tempo selbst auswertet. Bisher sah das nur aus wie die Behauptung, man sei zu
// Fuß unterwegs.
package app.maptale.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.maptale.data.TravelMode

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NewTourSheet(
    schliessen: () -> Unit,
    starten: (travelMode: TravelMode?) -> Unit,
) {
    val state = rememberModalBottomSheetState()
    // null = automatisch; der Server leitet das Fortbewegungsmittel aus dem
    // Tempo ab, statt eine Angabe zu bekommen, die niemand gemacht hat.
    var travelMode by remember { mutableStateOf<TravelMode?>(null) }

    ModalBottomSheet(onDismissRequest = schliessen, sheetState = state) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text("Neue Tour", style = MaterialTheme.typography.headlineSmall)

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Womit bist du unterwegs?", style = MaterialTheme.typography.titleSmall)
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = travelMode == null,
                        onClick = { travelMode = null },
                        label = { Text("Automatisch") },
                    )
                    TravelMode.entries.forEach { entry ->
                        FilterChip(
                            selected = travelMode == entry,
                            // Nochmal tippen führt zurück auf „Automatisch"
                            onClick = { travelMode = if (travelMode == entry) null else entry },
                            label = { Text(entry.label) },
                        )
                    }
                }
            }

            PrimaryButton(
                onClick = { starten(travelMode) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = LocalContentColor.current,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    "Aufzeichnen",
                    Modifier.padding(start = 10.dp),
                    color = LocalContentColor.current,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
