// Marken-Wortmarke — dieselbe Globe wie public/logo-mark.svg + Text „Maptale".
// DESIGN.md: Höhe ≈ 28 dp, gap 0.45 em, Marke leicht nach unten (translate 0 1px).
package app.maptale.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.maptale.R

/**
 * Globe-Marke allein (ohne Wort). Farben stecken im Vector — kein Tint,
 * sonst würden Amber und Koralle zu einer Farbe.
 */
@Composable
fun Markenzeichen(
    modifier: Modifier = Modifier,
    groesse: Dp = 28.dp,
) {
    Image(
        painter = painterResource(R.drawable.ic_marke),
        contentDescription = null,
        modifier = modifier.size(groesse),
    )
}

/**
 * Wortmarke: Globe + „Maptale". Erste Ansicht der App und Kopf der Anmeldung.
 */
@Composable
fun Wortmarke(
    modifier: Modifier = Modifier,
    markenGroesse: Dp = 28.dp,
    textFarbe: Color = Tinte,
) {
    Row(
        modifier.semantics { contentDescription = "Maptale" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(markenGroesse * 0.45f),
    ) {
        // 1 px nach unten — wie CSS `translate: 0 1px` auf dem Web.
        Markenzeichen(
            groesse = markenGroesse,
            modifier = Modifier.offset(y = 1.dp),
        )
        Text(
            "Maptale",
            style = MaterialTheme.typography.titleLarge.copy(
                fontFamily = Sans,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                lineHeight = 17.sp,
                letterSpacing = (-0.02).em,
            ),
            color = textFarbe,
        )
    }
}
