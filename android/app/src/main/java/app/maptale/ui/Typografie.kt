// Die Schriften der Marke — dieselben wie auf dem Web (siehe /DESIGN.md).
//
// Outfit trägt UI, Titel, Schaltflächen und Kennzahlen. Gleichbreite Ziffern
// kommen über OpenType `tnum` (`fontFeatureSettings`), nicht über Mono —
// sonst zucken live tickende Werte, und die App driftet vom Web-Look.
package app.maptale.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
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

/** Titel, Überschriften, UI und Kennzahlen. */
val Sans = FontFamily(
    outfit(400), outfit(500), outfit(600), outfit(700),
)

/**
 * Optional: technische Attribution/Debug — nicht für UI-Kennzahlen.
 * Zahlen: Outfit + `fontFeatureSettings = "tnum"` (DESIGN.md).
 */
val Mono = FontFamily(
    Font(R.font.plexmono_regular, FontWeight.Normal),
    Font(R.font.plexmono_medium, FontWeight.Medium),
    Font(R.font.plexmono_semibold, FontWeight.SemiBold),
)

/** Outfit mit Tabular Figures — Anti-Zucken ohne Mono. */
private fun zahlenStil(
    gewicht: FontWeight,
    groesse: TextUnit,
    zeilenhoehe: TextUnit,
    tracking: TextUnit = 0.em,
) = TextStyle(
    fontFamily = Sans,
    fontWeight = gewicht,
    fontSize = groesse,
    lineHeight = zeilenhoehe,
    letterSpacing = tracking,
    fontFeatureSettings = "tnum",
)

val MaptaleTypografie = Typography(
    // Bühnengrößen: Aufnahme-Uhr & große Kennzahlen — Outfit + tnum
    displayLarge = zahlenStil(FontWeight.Medium, 50.sp, 56.sp, (-0.03).em),
    displayMedium = zahlenStil(FontWeight.Medium, 40.sp, 46.sp, (-0.03).em),
    displaySmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 32.sp, lineHeight = 38.sp, letterSpacing = (-0.02).em,
    ),

    headlineLarge = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.SemiBold,
        fontSize = 29.sp, lineHeight = 34.sp, letterSpacing = (-0.02).em,
    ),
    headlineMedium = zahlenStil(FontWeight.SemiBold, 24.sp, 29.sp, (-0.015).em),
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
