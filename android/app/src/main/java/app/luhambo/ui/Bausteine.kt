// Kleinteile, die mehrere Screens teilen — damit sie nicht dreimal leicht
// verschieden aussehen.
package app.luhambo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import java.util.Locale

/**
 * Runder Knopf, der über einem Bild schwebt.
 *
 * Eigener halbdunkler Grund statt einer Leiste: Wo das Bild bis unter die
 * Statusleiste läuft, wäre ein Symbol ohne Untergrund auf hellem Himmel
 * unsichtbar.
 */
@Composable
fun Rundknopf(
    symbol: ImageVector,
    beschreibung: String,
    beiKlick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Color(0x8A06090E))
            .clickable(onClickLabel = beschreibung, onClick = beiKlick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(symbol, contentDescription = beschreibung, tint = Tinte, modifier = Modifier.size(20.dp))
    }
}

/** Kleine gesperrte Versal-Überschrift — die Gliederung der Website. */
@Composable
fun Abschnittstitel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(Locale.GERMAN),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}
