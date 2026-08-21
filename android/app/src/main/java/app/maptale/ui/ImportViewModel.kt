// Import-Fluss (M8): ausgewähltes GPX + Medien (SAF) → Upload-Manifest mit
// trackFile → bestehende Upload-API. Anders als die Aufzeichnung läuft der
// Import mit anwesendem Nutzer und online ab (kein WorkManager) — die
// Orchestrierung liegt daher direkt hier, die pure Logik in ImportLogic/GpxImport.
package app.maptale.ui

import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.maptale.MaptaleApp
import app.maptale.importing.GpxImport
import app.maptale.importing.ImportLogic
import app.maptale.importing.MediumMetadataReader
import app.maptale.camera.preparePhotoForUpload
import app.maptale.upload.ImportMedium
import app.maptale.upload.ManifestBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.time.ZoneId

class ImportViewModel(private val app: MaptaleApp) : ViewModel() {

    sealed interface State {
        data object Idle : State
        data class Loading(val text: String, val progress: Float) : State
        data class Complete(val serverTourId: String) : State
        data class Failed(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state

    fun reset() { _state.value = State.Idle }

    /**
     * Führt den Import aus: GPX lesen → Zeitspanne + Medien-Metadaten → Manifest
     * (trackFile) → POST/PUT/Finalize → auf „bereit" warten. Bricht bei jedem
     * Schritt sauber mit einer Nutzer-Meldung ab.
     */
    fun importGpx(gpxUri: Uri, medienUris: List<Uri>, title: String?) {
        viewModelScope.launch {
            val tempFiles = mutableListOf<File>()
            try {
                if (app.settings.currentAccount().apiToken == null) {
                    _state.value = State.Failed("Bitte zuerst in den Einstellungen anmelden.")
                    return@launch
                }
                report("GPX wird gelesen …", 0.02f)
                val cr = app.contentResolver
                val gpx = withContext(Dispatchers.IO) {
                    cr.openInputStream(gpxUri)?.use { String(it.readBytes(), Charsets.UTF_8) }
                } ?: throw ImportError("Die GPX-Datei konnte nicht gelesen werden.")
                if (!GpxImport.hasTrackPoints(gpx)) throw ImportError("Die GPX-Datei enthält keine Trackpunkte.")
                val span = GpxImport.timeSpan(gpx)
                    ?: throw ImportError("Die GPX-Datei enthält keine Zeitstempel. Ein Import ist damit nicht möglich.")

                // Medien in den Cache kopieren (kein OOM bei großen Videos) und
                // dabei Metadaten (EXIF) für die serverseitige Platzierung lesen.
                report("Medien werden vorbereitet …", 0.08f)
                data class Vorbereitet(val medium: ImportMedium, val file: File)
                val prepared = withContext(Dispatchers.IO) {
                    medienUris.mapIndexedNotNull { i, uri ->
                        val mime = cr.getType(uri)
                        val type = ImportLogic.mediaType(mime) ?: return@mapIndexedNotNull null
                        val extension = ImportLogic.extension(mime) ?: return@mapIndexedNotNull null
                        val id = ImportLogic.mediumId(i)
                        val temp = File(app.cacheDir, "import-$id.$extension")
                        cr.openInputStream(uri)?.use { ein -> temp.outputStream().use { ein.copyTo(it) } }
                            ?: return@mapIndexedNotNull null
                        tempFiles.add(temp)
                        // Ein Foto aus der Galerie ist so groß wie das der Kamera —
                        // vor dem Upload auf dasselbe Maß bringen. Danach lesen: Die
                        // Aufbereitung übernimmt Zeit und Ort, aber gelesen wird, was
                        // TATSÄCHLICH hochgeht.
                        if (type == "photo") preparePhotoForUpload(temp)
                        val meta = if (type == "photo") temp.inputStream().use { MediumMetadataReader.read(it) } else null
                        Vorbereitet(
                            ImportMedium(
                                id = id,
                                type = type,
                                file = "$id.$extension",
                                takenAtMs = meta?.takenAtMs ?: temp.lastModified().takeIf { it > 0 } ?: span.startMs,
                                anchorLng = meta?.lng,
                                anchorLat = meta?.lat,
                            ),
                            temp,
                        )
                    }
                }

                val manifest = ManifestBuilder.buildImport(
                    clientTourId = ImportLogic.clientTourId(fileName(gpxUri), span.startMs),
                    title = title,
                    zone = ZoneId.systemDefault().id,
                    timeSpan = span,
                    media = prepared.map { it.medium },
                )

                report("Tour wird angelegt …", 0.15f)
                val serverId = app.apiClient.createTour(ManifestBuilder.toJson(manifest))
                app.apiClient.uploadTrack(serverId, gpx)

                prepared.forEachIndexed { i, v ->
                    report("Medium ${i + 1}/${prepared.size} wird geladen …", 0.2f + 0.6f * i / maxOf(1, prepared.size))
                    app.apiClient.uploadMedium(serverId, v.medium.id, v.file)
                }

                report("Verarbeitung läuft …", 0.85f)
                app.apiClient.finalize(serverId)

                var status = ""
                var attempts = 0
                while (attempts < 30 && status != "ready" && status != "failed") {
                    status = app.apiClient.tourStatus(serverId)
                    if (status == "ready" || status == "failed") break
                    delay(2_000)
                    attempts++
                }
                if (status == "failed") throw ImportError("Die Server-Verarbeitung ist fehlgeschlagen.")
                _state.value = State.Complete(serverId)
            } catch (error: ImportError) {
                _state.value = State.Failed(error.message ?: "Import fehlgeschlagen")
            } catch (error: Exception) {
                _state.value = State.Failed(error.message ?: "Import fehlgeschlagen")
            } finally {
                tempFiles.forEach { runCatching { it.delete() } }
            }
        }
    }

    private fun report(text: String, progress: Float) {
        _state.value = State.Loading(text, progress)
    }

    /** Anzeigename der SAF-Uri (für die clientTourId); Fallback „track.gpx". */
    private fun fileName(uri: Uri): String {
        val cursor = app.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val name = it.getString(0)
                if (!name.isNullOrBlank()) return name
            }
        }
        return uri.lastPathSegment ?: "track.gpx"
    }

    private class ImportError(message: String) : Exception(message)
}
