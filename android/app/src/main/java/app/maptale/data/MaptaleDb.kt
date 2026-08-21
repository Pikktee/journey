// Room-Datenbank; Enums als Strings abgelegt (lesbar im DB-Inspector).
package app.maptale.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

class EnumConverter {
    @TypeConverter fun fromStatus(s: TourStatus): String = s.name
    @TypeConverter fun toStatus(s: String): TourStatus = TourStatus.valueOf(s)
    @TypeConverter fun fromTravelMode(m: TravelMode): String = m.key
    @TypeConverter fun toTravelMode(s: String): TravelMode = TravelMode.fromKey(s)
    @TypeConverter fun fromUpload(s: MediumUploadStatus): String = s.name
    @TypeConverter fun toUpload(s: String): MediumUploadStatus = MediumUploadStatus.valueOf(s)
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
        db.execSQL("ALTER TABLE touren ADD COLUMN travelModeAuto INTEGER NOT NULL DEFAULT 0")
    }
}

/**
 * 3→4: Welle 1 der Englisch-Migration — Tabellen, Spalten und Enum-Speicherwerte
 * gingen auf Englisch
 * ([konzept_codebase_english_refactoring.md](../../../../../../../docs/concepts/konzept_codebase_english_refactoring.md)
 * §4.4).
 *
 * Der Schritt WAR destruktiv, als einmalige Ausnahme: Auf den Geräten lagen zu
 * diesem Zeitpunkt nur Aufnahmen des Betreibers (§4.5), und sie waren
 * hochgeladen. Eine Migration gibt es dafür deshalb nicht — eine Datenbank der
 * Version 1 bis 3 erreicht die 4 nicht mehr, sie ist mit dem Update von
 * v0.67.0 verworfen worden. `MIGRATION_1_2` und `MIGRATION_2_3` stehen nur noch
 * als Historie hier; sie führen nirgends mehr hin.
 *
 * Mit Welle 7 ist die Zusage zurück (s. unten). Welle 7 selbst hat das Schema
 * NICHT angefasst: Sie benennt Kotlin-Klassen und -Eigenschaften um, die
 * Spaltennamen sind seit Welle 1 englisch, und das exportierte `4.json` ist vor
 * und nach ihr byte-gleich. Deshalb bleibt die Version bei 4.
 */
@Database(
    entities = [TourEntity::class, TrackPointEntity::class, TravelModeChangeEntity::class, MediumEntity::class],
    version = 4,
    exportSchema = true,
)
@TypeConverters(EnumConverter::class)
abstract class MaptaleDb : RoomDatabase() {
    abstract fun tourDao(): TourDao

    companion object {
        /**
         * Migrationen sind Pflicht, kein `fallbackToDestructiveMigration`: auf
         * dem Gerät liegen echte, noch nicht hochgeladene Aufnahmen. Jede neue
         * Version bringt ihre Migration mit, und der Migrationstest baut die
         * alte Datenbank aus dem exportierten Schema und lässt Room sie
         * migrieren und validieren.
         *
         * `name` ist nur für den Test da — er soll denselben Builder benutzen,
         * den die App benutzt, statt ihn nachzubauen. Ein nachgebauter Builder
         * bewacht sich selbst.
         */
        fun build(context: Context, name: String = "maptale.db"): MaptaleDb =
            Room.databaseBuilder(context, MaptaleDb::class.java, name)
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
    }
}
