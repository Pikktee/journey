// Reine Import-Hilfen (M8): MIME-Typ → Medientyp/Endung, Medien-IDs und die
// stabile clientTourId. DOM-/Android-frei, damit unit-getestet — die
// SAF-/Upload-Orchestrierung liegt im ImportViewModel.
package app.luhambo.importieren

object ImportLogik {

    // MIME → (Medientyp, Ablage-Endung). Nur was das Backend zulässt
    // (ENDUNGEN in schema/upload.ts) kommt durch.
    private val fotoTypen = mapOf(
        "image/jpeg" to "jpg",
        "image/jpg" to "jpg",
        "image/png" to "png",
        "image/webp" to "webp",
    )
    private val videoTypen = mapOf(
        "video/mp4" to "mp4",
        "video/quicktime" to "mov",
        "video/webm" to "webm",
    )

    /** "photo" | "video" | null (unbekannter/nicht unterstützter Typ). */
    fun medientyp(mime: String?): String? {
        val m = mime?.lowercase() ?: return null
        return when {
            m in fotoTypen -> "photo"
            m in videoTypen -> "video"
            else -> null
        }
    }

    /** Ablage-Endung zum MIME-Typ (jpg/png/webp/mp4/mov/webm) oder null. */
    fun endung(mime: String?): String? {
        val m = mime?.lowercase() ?: return null
        return fotoTypen[m] ?: videoTypen[m]
    }

    /** Tour-eindeutige Medien-ID (m1, m2 …). */
    fun mediumId(index: Int): String = "m${index + 1}"

    /**
     * Stabile clientTourId für die Idempotenz: derselbe GPX-Import (gleicher
     * Name + Startzeit) legt serverseitig keine zweite Tour an. Auf 100 Zeichen
     * begrenzt (Server-Schema).
     */
    fun clientTourId(gpxName: String, startMs: Long): String =
        "import:${gpxName.take(60)}:$startMs".take(100)
}
