// Migrationen laufen auf ECHTEN Geräten mit echten Aufnahmen darauf — ein
// Schema-Sprung, der Daten verliert, ist keine Schönheitsfrage, sondern
// verlorene Reisen.
//
// Für den einen Schritt 3→4 galt das nicht: Welle 1 der Englisch-Migration hat
// die lokale Datenbank verworfen, weil zu diesem Zeitpunkt nur Geräte des
// Betreibers eine App trugen (§4.5). Dieser Schritt ist mit v0.67.0 gelaufen
// und vorbei; eine Datenbank der Version 1 bis 3 gibt es nicht mehr.
//
// **Mit Welle 7 ist die Zusage zurück**, und dieser Test ist ihr Wächter. Was
// er beweist, ist die eine Sache, die still kippt, wenn jemand den Rückfall
// wieder einbaut oder die Version anhebt, ohne eine Migration zu schreiben:
// Eine Datenbank im AKTUELLEN Schema behält ihre Zeilen, wenn die App sie mit
// ihrem EIGENEN Builder öffnet. Gebaut wird dafür nicht ein zweiter Builder
// neben `MaptaleDb.build` — ein nachgebauter Builder bewacht sich selbst —,
// sondern derselbe, nur unter anderem Dateinamen.
package app.maptale.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class MigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val datenbankName = "migrationstest.db"
    private lateinit var db: MaptaleDb

    @Before
    fun aufbau() {
        context.getDatabasePath(datenbankName).also { it.parentFile?.mkdirs(); it.delete() }
    }

    @After
    fun abbau() {
        if (::db.isInitialized) db.close()
        context.getDatabasePath(datenbankName).delete()
    }

    /** Leere Datenbank im exportierten Schema der angegebenen Version anlegen. */
    private fun legeAltesSchemaAn(version: Int): SQLiteDatabase {
        val schema = JSONObject(File("schemas/app.maptale.data.MaptaleDb/$version.json").readText())
            .getJSONObject("database")
        val alt = SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(datenbankName), null)
        val entitaeten = schema.getJSONArray("entities")
        for (i in 0 until entitaeten.length()) {
            val entitaet = entitaeten.getJSONObject(i)
            val tabelle = entitaet.getString("tableName")
            alt.execSQL(entitaet.getString("createSql").replace("\${TABLE_NAME}", tabelle))
            val indizes = entitaet.optJSONArray("indices") ?: continue
            for (j in 0 until indizes.length()) {
                alt.execSQL(indizes.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}", tabelle))
            }
        }
        // room_master_table mit dem Identitäts-Hash — ohne sie verweigert Room
        // das Öffnen mit „cannot verify the data integrity".
        val aufbau = schema.getJSONArray("setupQueries")
        for (i in 0 until aufbau.length()) alt.execSQL(aufbau.getString(i))
        alt.version = version
        return alt
    }

    /** Öffnet die Datenbank so, wie die App es tut — derselbe Builder. */
    private fun oeffneAktuell(): MaptaleDb =
        MaptaleDb.build(context, datenbankName).also { db = it }

    @Test
    fun `eine Datenbank im aktuellen Schema behaelt ihre Zeilen`() = runTest {
        legeAltesSchemaAn(4).use { alt ->
            alt.execSQL(
                "INSERT INTO tours (id, title, description, startMs, endMs, zone, status, " +
                    "serverId, error, distanceM, travelModeAuto) " +
                    "VALUES ('local-1', 'Bucht', NULL, 1000, 2000, 'Europe/Berlin', 'DRAFT', " +
                    "NULL, NULL, 4200.0, 0)",
            )
        }

        val dao = oeffneAktuell().tourDao()
        val entwuerfe = dao.toursByStatus(TourStatus.DRAFT)

        // Ohne diese Zusicherung ist der Rückfall zurück: Sie ist rot, sobald
        // jemand `fallbackToDestructiveMigration` wieder einbaut oder die
        // Version anhebt, ohne die Migration dazuzulegen.
        assertEquals(1, entwuerfe.size)
        assertEquals("Bucht", entwuerfe.single().title)
        assertEquals(4200.0, entwuerfe.single().distanceM, 0.001)
    }

    @Test
    fun `schreiben und lesen geht`() = runTest {
        val repo = TourRepository(oeffneAktuell(), File(context.cacheDir, "migrationstest-files"))

        val tour = repo.startRecording(TravelMode.BIKE, travelModeAuto = true)
        repo.registerPhoto(tour.id, "tours/${tour.id}/a.jpg", 1100, null)
        repo.setMediumCaption(tour.id, "m1", "Sonnenaufgang")

        assertEquals(true, repo.tour(tour.id)!!.travelModeAuto)
        assertEquals("Sonnenaufgang", repo.media(tour.id).single().caption)
    }
}
