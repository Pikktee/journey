// Room-Datenbank; Enums als Strings abgelegt (lesbar im DB-Inspector).
package app.luhambo.daten

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters

class EnumKonverter {
    @TypeConverter fun vonStatus(s: TourStatus): String = s.name
    @TypeConverter fun zuStatus(s: String): TourStatus = TourStatus.valueOf(s)
    @TypeConverter fun vonModus(m: Modus): String = m.schluessel
    @TypeConverter fun zuModus(s: String): Modus = Modus.vonSchluessel(s)
    @TypeConverter fun vonUpload(s: MediumUploadStatus): String = s.name
    @TypeConverter fun zuUpload(s: String): MediumUploadStatus = MediumUploadStatus.valueOf(s)
}

@Database(
    entities = [TourEntity::class, TrackpunktEntity::class, ModuswechselEntity::class, MediumEntity::class],
    version = 1,
    exportSchema = false,
)
@TypeConverters(EnumKonverter::class)
abstract class LuhamboDb : RoomDatabase() {
    abstract fun tourDao(): TourDao

    companion object {
        fun baue(context: Context): LuhamboDb =
            Room.databaseBuilder(context, LuhamboDb::class.java, "luhambo.db").build()
    }
}
