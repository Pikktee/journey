// Die Schriften der Marke — dieselben wie auf maptale.henrikheil.net.
//
// Outfit trägt UI, Titel und Schaltflächen; IBM Plex Mono bleibt den Kennzahlen
// vorbehalten (Uhr, Kilometer, Höhenmeter). So bleibt die App visuell dieselbe
// Stimme wie Landing, Player und Studio — früher war das Fraunces + flächiges Mono.
//
// Outfit liegt als variable Datei vor; das Gewicht ist Achse. Laufende Ziffern
// stehen in Mono, weil Proportionalschrift sie bei jedem Tick zappeln lässt.
package app.maptale.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.maptale.R

/** Ein Schnitt der variablen Outfit-Datei, auf Gewicht eingestellt. */
@OptIn(ExperimentalTextApi::class)
private fun outfit(gewicht: Int) = Font(
    R.font.outfit,
    weight = FontWeight(gewicht),
    variationSettings = FontVariation.Settings(
        FontVariation.weight(gewicht),
    ),
)

/** Titel, Überschriften und UI-Text. */
val Sans = FontFamily(
    outfit(400), outfit(500), outfit(600), outfit(700),
)

/** Kennzahlen mit gleich breiten Ziffern — die „Instrumenten“-Stimme. */
val Mono = FontFamily(
    Font(R.font.plexmono_regular, FontWeight.Normal),
    Font(R.font.plexmono_medium, FontWeight.Medium),
    Font(R.font.plexmono_semibold, FontWeight.SemiBold),
)

val MaptaleTypografie = Typography(
    // Bühnengrößen: die Uhr der laufenden Aufzeichnung — Mono, damit sie nicht zuckt
    displayLarge = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 50.sp, lineHeight = 56.sp, letterSpacing = (-0.03).em,
    ),
    displayMedium = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 40.sp, lineHeight = 46.sp, letterSpacing = (-0.03).em,
    ),
    displaySmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 32.sp, lineHeight = 38.sp, letterSpacing = (-0.02).em,
    ),

    headlineLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 29.sp, lineHeight = 34.sp, letterSpacing = (-0.02).em,
    ),
    headlineMedium = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp, lineHeight = 29.sp, letterSpacing = (-0.015).em,
    ),
    headlineSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 21.sp, lineHeight = 27.sp, letterSpacing = (-0.01).em,
    ),

    titleLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 19.sp, lineHeight = 25.sp, letterSpacing = (-0.01).em,
    ),
    titleMedium = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp, lineHeight = 23.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium,
        fontSize = 14.sp, lineHeight = 20.sp,
    ),

    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontSize = 13.sp, lineHeight = 19.sp),

    // Knopftexte in Outfit — wie Landing und Studio, nicht Mono
    labelLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium,
        fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = 0.01.em,
    ),
    labelMedium = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium,
        fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.01.em,
    ),
    labelSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium,
        fontSize = 11.sp, lineHeight = 15.sp, letterSpacing = 0.06.em,
    ),
)
