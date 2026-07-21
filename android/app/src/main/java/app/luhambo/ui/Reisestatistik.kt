// Was jemand mit Luhambo bisher zurückgelegt hat — die Zahl, die ein Profil
// erst zu einem Profil macht.
//
// Gerechnet wird aus dem, was ohnehin schon geladen ist (Tourliste + lokale
// Entwürfe); ein eigener Server-Aufruf dafür lohnt nicht. Lokale Entwürfe
// zählen mit, sonst schrumpfte die Statistik in dem Moment, in dem man von
// einer Tour zurückkommt und der Upload noch läuft.
package app.luhambo.ui

import app.luhambo.daten.TourStatus

/** Aufsummierte Reisezahlen für die Profilansicht. */
data class Reisestatistik(
    val touren: Int,
    val kilometer: Double,
    val hoehenmeter: Double,
)

fun berechneReisestatistik(eintraege: List<Toureintrag>): Reisestatistik {
    var touren = 0
    var kilometer = 0.0
    var hoehenmeter = 0.0
    for (eintrag in eintraege) {
        when (eintrag) {
            is Toureintrag.Lokal -> {
                // Die laufende Aufnahme ist noch keine zurückgelegte Tour
                if (eintrag.tour.status == TourStatus.AUFNAHME) continue
                touren++
                kilometer += eintrag.tour.distanzM / 1000
            }
            is Toureintrag.Server -> {
                // Touren in Verarbeitung haben noch keine Zahlen, zählen aber mit
                touren++
                kilometer += eintrag.tour.km ?: 0.0
                hoehenmeter += eintrag.tour.hoehenmeter ?: 0.0
            }
        }
    }
    return Reisestatistik(touren, kilometer, hoehenmeter)
}
