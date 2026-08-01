// Room-Datenbank; Enums als Strings abgelegt (lesbar im DB-Inspector).
package app.maptale.daten

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

class EnumKonverter {
    @TypeConverter fun vonStatus(s: TourStatus): String = s.name
    @TypeConverter fun zuStatus(s: String): TourStatus = TourStatus.valueOf(s)
    @TypeConverter fun vonModus(m: Modus): String = m.schluessel
    @TypeConverter fun zuModus(s: String): Modus = Modus.vonSchluessel(s)
    @TypeConverter fun vonUpload(s: MediumUploadStatus): String = s.name
    @TypeConverter fun zuUpload(s: String): MediumUploadStatus = MediumUploadStatus.valueOf(s)
}

/** 1→2: Nutzertext je Medium („Titel" in der Oberfläche). */
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE medien ADD COLUMN caption TEXT")
    }
}

/**
 * 2→3: Wurde die Fortbewegung erkannt statt gewählt?
 *
 * Bestandsaufnahmen bekommen 0 — sie entstanden, als jede Tour genau einen
 * angegebenen Modus hatte. Das ist die richtige Vorgabe: „nicht automatisch"
 * heißt für den Server „nicht überstimmen", und damit bleibt alles, wie es war.
 */
val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE touren ADD COLUMN modusAutomatisch INTEGER NOT NULL DEFAULT 0")
    }
}

@Database(
    entities = [TourEntity::class, TrackpunktEntity::class, ModuswechselEntity::class, MediumEntity::class],
    version = 3,
    exportSchema = true,
)
@TypeConverters(EnumKonverter::class)
abstract class MaptaleDb : RoomDatabase() {
    abstract fun tourDao(): TourDao

    companion object {
        // Bewusst OHNE fallbackToDestructiveMigration: auf dem Gerät liegen echte,
        // noch nicht hochgeladene Aufnahmen — ein Schema-Sprung darf sie nicht
        // wegwerfen. Jede neue Version braucht hier ihre Migration.
        fun baue(context: Context): MaptaleDb =
            Room.databaseBuilder(context, MaptaleDb::class.java, "maptale.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
    }
}
