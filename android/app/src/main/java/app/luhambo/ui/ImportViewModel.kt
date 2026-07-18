// Import-Fluss (M8): ausgewähltes GPX + Medien (SAF) → Upload-Manifest mit
// trackFile → bestehende Upload-API. Anders als die Aufzeichnung läuft der
// Import mit anwesendem Nutzer und online ab (kein WorkManager) — die
// Orchestrierung liegt daher direkt hier, die pure Logik in ImportLogik/GpxImport.
package app.luhambo.ui

import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.luhambo.LuhamboApp
import app.luhambo.importieren.GpxImport
import app.luhambo.importieren.ImportLogik
import app.luhambo.importieren.MedienMetadatenLeser
import app.luhambo.upload.ImportMedium
import app.luhambo.upload.ManifestBau
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.ZoneId

class ImportViewModel(private val app: LuhamboApp) : ViewModel() {

    sealed interface Zustand {
        data object Ruhe : Zustand
        data class Laedt(val text: String, val fortschritt: Float) : Zustand
        data class Fertig(val serverTourId: String) : Zustand
        data class Fehler(val nachricht: String) : Zustand
    }

    private val _zustand = MutableStateFlow<Zustand>(Zustand.Ruhe)
    val zustand: StateFlow<Zustand> = _zustand

    fun zuruecksetzen() { _zustand.value = Zustand.Ruhe }

    /**
     * Führt den Import aus: GPX lesen → Zeitspanne + Medien-Metadaten → Manifest
     * (trackFile) → POST/PUT/Finalize → auf „bereit" warten. Bricht bei jedem
     * Schritt sauber mit einer Nutzer-Meldung ab.
     */
    fun importiere(gpxUri: Uri, medienUris: List<Uri>, titel: String?) {
        viewModelScope.launch {
            val tempDateien = mutableListOf<File>()
            try {
                if (app.einstellungen.aktuellesKonto().apiToken == null) {
                    _zustand.value = Zustand.Fehler("Bitte zuerst in den Einstellungen anmelden.")
                    return@launch
                }
                melde("GPX wird gelesen …", 0.02f)
                val cr = app.contentResolver
                val gpx = withContext(Dispatchers.IO) {
                    cr.openInputStream(gpxUri)?.use { String(it.readBytes(), Charsets.UTF_8) }
                } ?: throw ImportFehler("Die GPX-Datei konnte nicht gelesen werden.")
                if (!GpxImport.hatTrackpunkte(gpx)) throw ImportFehler("Die GPX-Datei enthält keine Trackpunkte.")
                val spanne = GpxImport.zeitspanne(gpx)
                    ?: throw ImportFehler("Die GPX-Datei enthält keine Zeitstempel — ein Import ist damit nicht möglich.")

                // Medien in den Cache kopieren (kein OOM bei großen Videos) und
                // dabei Metadaten (EXIF) für die serverseitige Platzierung lesen.
                melde("Medien werden vorbereitet …", 0.08f)
                data class Vorbereitet(val medium: ImportMedium, val datei: File)
                val vorbereitet = withContext(Dispatchers.IO) {
                    medienUris.mapIndexedNotNull { i, uri ->
                        val mime = cr.getType(uri)
                        val typ = ImportLogik.medientyp(mime) ?: return@mapIndexedNotNull null
                        val endung = ImportLogik.endung(mime) ?: return@mapIndexedNotNull null
                        val id = ImportLogik.mediumId(i)
                        val temp = File(app.cacheDir, "import-$id.$endung")
                        cr.openInputStream(uri)?.use { ein -> temp.outputStream().use { ein.copyTo(it) } }
                            ?: return@mapIndexedNotNull null
                        tempDateien.add(temp)
                        val meta = if (typ == "photo") temp.inputStream().use { MedienMetadatenLeser.lies(it) } else null
                        Vorbereitet(
                            ImportMedium(
                                id = id,
                                typ = typ,
                                datei = "$id.$endung",
                                aufgenommenMs = meta?.aufgenommenMs ?: temp.lastModified().takeIf { it > 0 } ?: spanne.startMs,
                                ankerLng = meta?.lng,
                                ankerLat = meta?.lat,
                            ),
                            temp,
                        )
                    }
                }

                val manifest = ManifestBau.baueImport(
                    clientTourId = ImportLogik.clientTourId(dateiName(gpxUri), spanne.startMs),
                    titel = titel,
                    zone = ZoneId.systemDefault().id,
                    zeitspanne = spanne,
                    medien = vorbereitet.map { it.medium },
                )

                melde("Tour wird angelegt …", 0.15f)
                val serverId = app.apiClient.tourAnlegen(ManifestBau.alsJson(manifest))
                app.apiClient.trackHochladen(serverId, gpx)

                vorbereitet.forEachIndexed { i, v ->
                    melde("Medium ${i + 1}/${vorbereitet.size} wird geladen …", 0.2f + 0.6f * i / maxOf(1, vorbereitet.size))
                    app.apiClient.mediumHochladen(serverId, v.medium.id, v.datei)
                }

                melde("Verarbeitung läuft …", 0.85f)
                app.apiClient.finalisiere(serverId)

                var status = ""
                var versuche = 0
                while (versuche < 30 && status != "bereit" && status != "fehler") {
                    status = app.apiClient.tourStatus(serverId)
                    if (status == "bereit" || status == "fehler") break
                    delay(2_000)
                    versuche++
                }
                if (status == "fehler") throw ImportFehler("Die Server-Verarbeitung ist fehlgeschlagen.")
                _zustand.value = Zustand.Fertig(serverId)
            } catch (fehler: ImportFehler) {
                _zustand.value = Zustand.Fehler(fehler.message ?: "Import fehlgeschlagen")
            } catch (fehler: Exception) {
                _zustand.value = Zustand.Fehler(fehler.message ?: "Import fehlgeschlagen")
            } finally {
                tempDateien.forEach { runCatching { it.delete() } }
            }
        }
    }

    private fun melde(text: String, fortschritt: Float) {
        _zustand.value = Zustand.Laedt(text, fortschritt)
    }

    /** Anzeigename der SAF-Uri (für die clientTourId); Fallback „track.gpx". */
    private fun dateiName(uri: Uri): String {
        val cursor = app.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val name = it.getString(0)
                if (!name.isNullOrBlank()) return name
            }
        }
        return uri.lastPathSegment ?: "track.gpx"
    }

    private class ImportFehler(nachricht: String) : Exception(nachricht)
}
