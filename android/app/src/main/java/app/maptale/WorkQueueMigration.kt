// Einmaliger Umzug der WorkManager-Warteschlange, weil Welle 7 der
// Englisch-Migration Worker-Klassen und Pakete umbenannt hat.
//
// **WorkManager ist ein zweites Room**
// ([konzept_codebase_english_refactoring.md](../../../../../../docs/concepts/konzept_codebase_english_refactoring.md)
// §4.4): Er legt den vollqualifizierten KLASSENNAMEN eines Auftrags in einer
// eigenen Datenbank ab, und die überlebt jedes Update. Ein eingereihter
// `app.maptale.galerie.FotoNachzugWorker` sucht nach dem Update eine Klasse,
// die es nicht mehr gibt — der Lauf scheitert mit ClassNotFound, und zwar
// still: Er taucht nur in `logcat` auf, die App merkt nichts davon. Dieselbe
// Fehlerklasse, für die Welle 1 ein Stockwerk höher Room v4 gebraucht hat.
//
// Drei Dinge, die man dabei kippt:
//
//   - **Abgeräumt wird über den TAG, nicht über den Unique-Namen.** WorkManager
//     vergibt jedem Auftrag von sich aus einen Tag mit dem Klassennamen. Der
//     Foto-Nachzug läuft unter `photo-backfill-<tourId>`, und welche tourIds in
//     der Warteschlange stehen, weiß die App nach dem Update nicht mehr — über
//     den Tag erwischt sie alle, auch die, von denen sie nichts ahnt.
//   - **`UploadWorker` bleibt in Ruhe.** Klasse UND Paket sind unverändert
//     (`app.maptale.upload.UploadWorker`), seine Aufträge lösen also weiter
//     auf. Wer hier vorsichtshalber `cancelAllWork` schriebe, würfe genau die
//     Uploads weg, die noch laufen können — und das sind die einzigen
//     Aufträge, hinter denen Daten stehen, die es sonst nirgends gibt.
//   - **Neu eingereiht wird nicht hier.** `MaptaleApp.onCreate` reiht den
//     periodischen Tracker-Abruf und die liegengebliebenen Uploads ohnehin bei
//     jedem Start ein; der Umzug läuft davor, damit `KEEP` nicht auf einen
//     Auftrag trifft, der gleich abgeräumt wird. Der Foto-Nachzug wird nicht
//     nachgeholt: Er hängt an einer Import-Meldung, und was er nicht ergänzt
//     hat, bietet die Tour selbst wieder an.
package app.maptale

import android.content.Context
import android.util.Log
import androidx.work.WorkManager
import app.maptale.upload.Settings

object WorkQueueMigration {

    /** Vollqualifiziert, wie WorkManager sie in seiner Datenbank stehen hat. */
    private val ALTE_WORKER = listOf(
        "app.maptale.galerie.FotoNachzugWorker",
        "app.maptale.tracker.TrackerAbfrageWorker",
    )

    /** Der periodische Lauf trug seinen Namen zusätzlich als Unique-Work. */
    private const val ALTER_PERIODISCHER_LAUF = "tracker-abfrage"

    suspend fun run(context: Context, settings: Settings) {
        if (settings.workQueueMigrated()) return
        val manager = WorkManager.getInstance(context)
        for (klasse in ALTE_WORKER) manager.cancelAllWorkByTag(klasse)
        manager.cancelUniqueWork(ALTER_PERIODISCHER_LAUF)
        settings.markWorkQueueMigrated()
        Log.i("Maptale", "WorkManager-Warteschlange auf die englischen Worker umgezogen")
    }
}
