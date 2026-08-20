// Migrationen laufen auf ECHTEN Geräten mit echten Aufnahmen darauf — ein
// Schema-Sprung, der Daten verliert, ist keine Schönheitsfrage, sondern
// verlorene Reisen.
//
// **Für den einen Schritt 3→4 gilt das nicht**, und das ist eine bewusste
// Ausnahme (Welle 1 der Englisch-Migration, §4.4): Tabellen, Spalten und
// Enum-Speicherwerte gehen auf Englisch, und weil zu diesem Zeitpunkt nur
// Geräte des Betreibers eine App tragen (§4.5), wirft Room die lokale
// Datenbank weg, statt umzuschreiben. Was dieser Test deshalb beweist, ist
// nicht mehr „die Daten überleben", sondern die zwei Dinge, an denen es sonst
// scheitert:
//
//   1. Ein APK-Update DERSELBEN Signatur öffnet die v3-Datenbank, ohne beim
//      Start abzustürzen (das täte es ohne `fallbackToDestructiveMigration`).
//   2. Danach steht das AKTUELLE Schema — schreiben und lesen geht.
//
// Nach Welle 7 kommt die Zusage zurück (Aufruf raus, ab v5 wieder echte
// Migrationen), und dann gehört an diese Stelle wieder ein Test, der Daten
// über den Sprung hinweg nachweist.
package app.maptale.daten

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
        val schema = JSONObject(File("schemas/app.maptale.daten.MaptaleDb/$version.json").readText())
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

    /** Öffnet die Datenbank so, wie die App es tut — hier greift der Rückfall. */
    private fun oeffneAktuell(): MaptaleDb =
        Room.databaseBuilder(context, MaptaleDb::class.java, datenbankName)
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
            .fallbackToDestructiveMigration(dropAllTables = true)
            .allowMainThreadQueries()
            .build()
            .also { db = it }

    @Test
    fun `3 nach 4 stuerzt nicht ab, sondern raeumt die lokale Datenbank`() = runTest {
        legeAltesSchemaAn(3).use { alt ->
            alt.execSQL(
                "INSERT INTO touren (id, titel, beschreibung, startMs, endeMs, zone, status, " +
                    "serverId, fehler, distanzM, modusAutomatisch) " +
                    "VALUES ('lokal-1', 'Bucht', NULL, 1000, 2000, 'Europe/Berlin', 'ENTWURF', " +
                    "NULL, NULL, 4200.0, 0)",
            )
        }

        val dao = oeffneAktuell().tourDao()

        // Die alte Zeile ist weg — genau das sagt §4.4 zu, und es ist der Preis
        // dafür, dass die App nach dem Update überhaupt startet.
        assertTrue(dao.tourenMitStatus(TourStatus.DRAFT).isEmpty())
    }

    @Test
    fun `nach dem Sprung steht das aktuelle Schema — schreiben und lesen geht`() = runTest {
        legeAltesSchemaAn(3).close()
        val repo = TourRepository(oeffneAktuell(), File(context.cacheDir, "migrationstest-files"))

        val tour = repo.starteAufnahme(Modus.BIKE, travelModeAuto = true)
        repo.registriereFoto(tour.id, "tours/${tour.id}/a.jpg", 1100, null)
        repo.setzeMediumCaption(tour.id, "m1", "Sonnenaufgang")

        assertEquals(true, repo.tour(tour.id)!!.travelModeAuto)
        assertEquals("Sonnenaufgang", repo.medien(tour.id).single().caption)
    }
}
