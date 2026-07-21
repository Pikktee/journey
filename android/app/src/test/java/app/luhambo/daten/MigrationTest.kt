// Migrationen laufen auf ECHTEN Geräten mit echten Aufnahmen darauf — ein
// Schema-Sprung, der Daten verliert, ist keine Schönheitsfrage, sondern
// verlorene Reisen.
//
// Der Test baut eine Datenbank im alten Schema (aus der exportierten
// schemas/1.json, also aus der Wahrheit und nicht aus abgeschriebenem SQL),
// füllt sie und öffnet sie dann ganz normal über LuhamboDb.baue-Weg. Room
// führt dabei die Migration aus UND vergleicht das Ergebnis mit dem aktuellen
// Schema — genau die Prüfung, die sonst MigrationTestHelper macht. Der Helfer
// selbst scheidet aus: er lädt die Schemata über den AssetManager, und im
// Unit-Test landen sie dort nicht.
package app.luhambo.daten

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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
    private lateinit var db: LuhamboDb

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
        val schema = JSONObject(File("schemas/app.luhambo.daten.LuhamboDb/$version.json").readText())
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

    /** Öffnet die Datenbank auf aktuellem Stand — hier läuft die Migration. */
    private fun oeffneAktuell(): LuhamboDb =
        Room.databaseBuilder(context, LuhamboDb::class.java, datenbankName)
            .addMigrations(MIGRATION_1_2)
            .allowMainThreadQueries()
            .build()
            .also { db = it }

    @Test
    fun `1 nach 2 behaelt Tour und Aufnahme, Titel ist zunaechst leer`() = runTest {
        legeAltesSchemaAn(1).use { alt ->
            alt.execSQL(
                "INSERT INTO touren (id, titel, beschreibung, startMs, endeMs, zone, status, serverId, fehler, distanzM) " +
                    "VALUES ('lokal-1', 'Bucht', NULL, 1000, 2000, 'Europe/Berlin', 'ENTWURF', NULL, NULL, 4200.0)",
            )
            alt.execSQL(
                "INSERT INTO medien (id, tourId, typ, datei, aufgenommenMs, ankerLng, ankerLat, uploadStatus) " +
                    "VALUES ('m1', 'lokal-1', 'photo', 'touren/lokal-1/a.jpg', 1500, 8.0, 46.59, 'LOKAL')",
            )
        }

        val dao = oeffneAktuell().tourDao()

        val tour = dao.tour("lokal-1")!!
        assertEquals("Bucht", tour.titel)
        assertEquals(4200.0, tour.distanzM, 1e-9)

        val medium = dao.medien("lokal-1").single()
        assertEquals("touren/lokal-1/a.jpg", medium.datei)
        assertEquals(8.0, medium.ankerLng!!, 1e-9)
        // Bestandsfotos sind schlicht noch nicht beschriftet
        assertNull(medium.caption)
    }

    @Test
    fun `Eine Migration, die die Spalte nicht anlegt, faellt auf`() = runTest {
        // Beweist, dass der Test oben etwas prüft: Room vergleicht nach jeder
        // Migration das Ergebnis mit dem erwarteten Schema. Ohne diesen Nachweis
        // wüsste niemand, ob die Prüfung überhaupt greift.
        legeAltesSchemaAn(1).close()
        val untaetig = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) = Unit
        }
        val kaputt = Room.databaseBuilder(context, LuhamboDb::class.java, datenbankName)
            .addMigrations(untaetig)
            .allowMainThreadQueries()
            .build()
            .also { db = it }

        // Das Öffnen selbst löst Migration und Schema-Vergleich aus
        val fehler = assertThrows(IllegalStateException::class.java) { kaputt.openHelper.writableDatabase }
        assertTrue(
            "Unerwartete Meldung: ${fehler.message}",
            fehler.message.orEmpty().contains("Migration didn't properly handle"),
        )
    }

    @Test
    fun `Nach der Migration laesst sich ein Titel schreiben und lesen`() = runTest {
        legeAltesSchemaAn(1).close()
        val repo = TourRepository(oeffneAktuell(), File(context.cacheDir, "migrationstest-files"))

        val tour = repo.starteAufnahme(Modus.BIKE)
        repo.registriereFoto(tour.id, "touren/${tour.id}/a.jpg", 1100, null)
        repo.setzeMediumCaption(tour.id, "m1", "Sonnenaufgang")

        assertEquals("Sonnenaufgang", repo.medien(tour.id).single().caption)
    }
}
