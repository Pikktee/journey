// Was jemand mit Maptale bisher zurückgelegt hat — die Zahl, die ein Profil
// erst zu einem Profil macht.
//
// Gerechnet wird aus dem, was ohnehin schon geladen ist (Tourliste + lokale
// Entwürfe); ein eigener Server-Aufruf dafür lohnt nicht. Lokale Entwürfe
// zählen mit, sonst schrumpfte die Statistik in dem Moment, in dem man von
// einer Tour zurückkommt und der Upload noch läuft.
package app.maptale.ui

import app.maptale.data.TourStatus

/** Aufsummierte Reisezahlen für die Profilansicht. */
data class TravelStats(
    val tourCount: Int,
    val km: Double,
    val gainM: Double,
)

fun computeTravelStats(eintraege: List<TourEntry>): TravelStats {
    var tourCount = 0
    var km = 0.0
    var gainM = 0.0
    for (eintrag in eintraege) {
        when (eintrag) {
            is TourEntry.Local -> {
                // Die laufende Aufnahme ist noch keine zurückgelegte Tour
                if (eintrag.tour.status == TourStatus.RECORDING) continue
                tourCount++
                km += eintrag.tour.distanceM / 1000
            }
            is TourEntry.Server -> {
                // Touren in Verarbeitung haben noch keine Zahlen, zählen aber mit
                tourCount++
                km += eintrag.tour.km ?: 0.0
                gainM += eintrag.tour.gainM ?: 0.0
            }
        }
    }
    return TravelStats(tourCount, km, gainM)
}
