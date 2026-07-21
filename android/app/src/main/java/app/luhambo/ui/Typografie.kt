// Die Schriften der Marke — dieselben drei wie auf luhambo.henrikheil.net.
//
// Fraunces (Serif) trägt die Titel, IBM Plex Mono die Kennzahlen und
// Beschriftungen, die Systemschrift den Fließtext. Das ist exakt die Aufteilung
// der Website (dort `--display`, `--mono`, `--sans`): Wer die Seite kennt und
// dann die App öffnet, soll dasselbe Produkt wiedererkennen — mit Roboto in
// allen Rollen sah die App aus wie eine beliebige Android-Anwendung.
//
// Fraunces liegt als EINE variable Datei vor; Gewicht und optische Größe sind
// Achsen, keine getrennten Schnitte. `opticalSizing` ist deshalb Pflicht, nicht
// Feinschliff: Ohne die Angabe zeichnet Fraunces bei 34 sp dieselben groben
// Serifen wie bei 17 sp. Gesetzt ist 28 — die Mitte der Spanne, in der die App
// ihre Überschriften setzt.
//
// Laufende Ziffern (Uhr, Kilometer, Höhenmeter) stehen in Mono, weil
// Proportionalschrift sie bei jedem Tick zappeln lässt: In einer Schrift mit
// gleich breiten Ziffern bleibt die Stelle, wo sie steht.
package app.luhambo.ui

import androidx.compose.material3.Typography
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.luhambo.R

/** Ein Schnitt der variablen Datei, auf Gewicht und optische Größe eingestellt. */
@OptIn(ExperimentalTextApi::class)
private fun fraunces(gewicht: Int) = Font(
    R.font.fraunces,
    weight = FontWeight(gewicht),
    variationSettings = FontVariation.Settings(
        FontVariation.weight(gewicht),
        FontVariation.opticalSizing(28.sp),
    ),
)

/** Titel und Überschriften. */
val Serifen = FontFamily(fraunces(400), fraunces(500), fraunces(600), fraunces(700))

/** Kennzahlen, Beschriftungen, Knopftexte — die „Stimme“ der Marke. */
val Mono = FontFamily(
    Font(R.font.plexmono_regular, FontWeight.Normal),
    Font(R.font.plexmono_medium, FontWeight.Medium),
    Font(R.font.plexmono_semibold, FontWeight.SemiBold),
)

private val Sans = FontFamily.SansSerif

val LuhamboTypografie = Typography(
    // Bühnengrößen: die Uhr der laufenden Aufzeichnung, große Kennzahlen
    displayLarge = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 50.sp, lineHeight = 56.sp, letterSpacing = (-0.03).em,
    ),
    displayMedium = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 40.sp, lineHeight = 46.sp, letterSpacing = (-0.03).em,
    ),
    displaySmall = TextStyle(
        fontFamily = Serifen, fontWeight = FontWeight.SemiBold,
        fontSize = 32.sp, lineHeight = 38.sp, letterSpacing = (-0.015).em,
    ),

    headlineLarge = TextStyle(
        fontFamily = Serifen, fontWeight = FontWeight.SemiBold,
        fontSize = 29.sp, lineHeight = 34.sp, letterSpacing = (-0.015).em,
    ),
    headlineMedium = TextStyle(
        fontFamily = Serifen, fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp, lineHeight = 29.sp, letterSpacing = (-0.01).em,
    ),
    headlineSmall = TextStyle(
        fontFamily = Serifen, fontWeight = FontWeight.SemiBold,
        fontSize = 21.sp, lineHeight = 27.sp,
    ),

    titleLarge = TextStyle(
        fontFamily = Serifen, fontWeight = FontWeight.SemiBold,
        fontSize = 19.sp, lineHeight = 25.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = Serifen, fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp, lineHeight = 23.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = Sans, fontWeight = FontWeight.Medium,
        fontSize = 14.sp, lineHeight = 20.sp,
    ),

    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontSize = 13.sp, lineHeight = 19.sp),

    // Knopftexte in Mono mit leichter Sperrung — wie die Schaltflächen der Website
    labelLarge = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = 0.04.em,
    ),
    labelMedium = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.04.em,
    ),
    // Versalien-Beschriftungen brauchen mehr Luft zwischen den Zeichen
    labelSmall = TextStyle(
        fontFamily = Mono, fontWeight = FontWeight.Medium,
        fontSize = 11.sp, lineHeight = 15.sp, letterSpacing = 0.12.em,
    ),
)
