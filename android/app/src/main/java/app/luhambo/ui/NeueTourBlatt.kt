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
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
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
import app.luhambo.daten.Modus

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NeueTourBlatt(
    schliessen: () -> Unit,
    starten: (modus: Modus?) -> Unit,
) {
    val zustand = rememberModalBottomSheetState()
    // null = automatisch; der Server leitet das Fortbewegungsmittel aus dem
    // Tempo ab, statt eine Angabe zu bekommen, die niemand gemacht hat.
    var modus by remember { mutableStateOf<Modus?>(null) }

    ModalBottomSheet(onDismissRequest = schliessen, sheetState = zustand) {
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
                        selected = modus == null,
                        onClick = { modus = null },
                        label = { Text("Automatisch") },
                    )
                    Modus.entries.forEach { eintrag ->
                        FilterChip(
                            selected = modus == eintrag,
                            // Nochmal tippen führt zurück auf „Automatisch"
                            onClick = { modus = if (modus == eintrag) null else eintrag },
                            label = { Text(eintrag.anzeige) },
                        )
                    }
                }
            }

            Button(
                onClick = { starten(modus) },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("Aufzeichnen", Modifier.padding(start = 10.dp))
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
