// Automatische Tour-Benennung in der App: Ortsnamen für Start/Ziel per
// Geocoder, Titel-Bau als pure Funktion (Spiegel von naming.ts im Backend —
// gleiche Titelform „Start → Ziel" / „Runde bei X" / „Tour vom {Datum}").
// Schlägt der Geocoder fehl (offline), benennt das Backend beim Finalize nach.
package app.luhambo.benennung

import android.content.Context
import android.location.Geocoder
import android.os.Build
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.math.abs

/** Geocoder hinter Interface — Tests reichen einen festen herein. */
fun interface OrtsGeocoder {
    /** Ortsname (Stadt/Dorf) zu einer Koordinate, null wenn unbekannt/offline. */
    suspend fun ortsname(lat: Double, lng: Double): String?
}

class AndroidGeocoder(private val context: Context) : OrtsGeocoder {
    override suspend fun ortsname(lat: Double, lng: Double): String? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(context, Locale.GERMAN)
        return try {
            val adresse = if (Build.VERSION.SDK_INT >= 33) {
                suspendCoroutine { fortsetzung ->
                    geocoder.getFromLocation(lat, lng, 1) { fortsetzung.resume(it.firstOrNull()) }
                }
            } else {
                @Suppress("DEPRECATION")
                geocoder.getFromLocation(lat, lng, 1)?.firstOrNull()
            }
            adresse?.locality ?: adresse?.subAdminArea
        } catch (_: Exception) {
            null
        }
    }
}

class TourBenennung(private val geocoder: OrtsGeocoder) {

    /**
     * Auto-Titel aus Start-/Zielkoordinate. null, wenn gar kein Ortsname
     * auflösbar war — dann bleibt der Titel leer und das Backend benennt nach.
     */
    suspend fun benenne(
        start: Pair<Double, Double>,
        ziel: Pair<Double, Double>,
    ): String? {
        val startName = geocoder.ortsname(start.second, start.first)
        val zielName = geocoder.ortsname(ziel.second, ziel.first)
        return baueTitel(startName, zielName, istRunde(start, ziel))
    }

    companion object {
        /** Start und Ziel näher als ~300 m → Rundtour. */
        fun istRunde(start: Pair<Double, Double>, ziel: Pair<Double, Double>): Boolean {
            val latM = abs(start.second - ziel.second) * 111_320.0
            val lngM = abs(start.first - ziel.first) * 111_320.0 *
                Math.cos(Math.toRadians((start.second + ziel.second) / 2))
            return latM * latM + lngM * lngM < 300.0 * 300.0
        }

        /** Titelform wie das Backend: „Start → Ziel", „Runde bei X" oder null. */
        fun baueTitel(startName: String?, zielName: String?, runde: Boolean): String? = when {
            runde && (startName ?: zielName) != null -> "Runde bei ${startName ?: zielName}"
            startName != null && zielName != null && startName != zielName -> "$startName → $zielName"
            startName != null && zielName != null -> "Runde bei $startName"
            else -> startName ?: zielName
        }

        /** Fallback-Titel ohne jeden Ortsnamen — identisch zur Backend-Form. */
        fun fallbackTitel(startMs: Long, zone: String): String {
            val datum = DateTimeFormatter.ofPattern("d. MMMM yyyy", Locale.GERMAN)
                .withZone(ZoneId.of(zone))
                .format(Instant.ofEpochMilli(startMs))
            return "Tour vom $datum"
        }
    }
}
