// Alle Datenbank-Zugriffe der App — ein DAO reicht bei diesem Schema-Umfang.
package app.luhambo.daten

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface TourDao {
    // — Touren —
    @Insert
    suspend fun legeTourAn(tour: TourEntity)

    @Update
    suspend fun aktualisiereTour(tour: TourEntity)

    @Query("SELECT * FROM touren WHERE id = :id")
    suspend fun tour(id: String): TourEntity?

    @Query("SELECT * FROM touren WHERE id = :id")
    fun tourFluss(id: String): Flow<TourEntity?>

    @Query("SELECT * FROM touren ORDER BY startMs DESC")
    fun alleTouren(): Flow<List<TourEntity>>

    @Query("UPDATE touren SET status = :status, fehler = :fehler WHERE id = :id")
    suspend fun setzeStatus(id: String, status: TourStatus, fehler: String? = null)

    @Query("SELECT * FROM touren WHERE status = :status")
    suspend fun tourenMitStatus(status: TourStatus): List<TourEntity>

    @Query("SELECT MAX(tOffsetS) FROM trackpunkte WHERE tourId = :tourId")
    suspend fun letzterPunktOffset(tourId: String): Double?

    @Query("UPDATE touren SET serverId = :serverId WHERE id = :id")
    suspend fun setzeServerId(id: String, serverId: String)

    @Query("UPDATE touren SET distanzM = :distanzM WHERE id = :id")
    suspend fun setzeDistanz(id: String, distanzM: Double)

    @Query("DELETE FROM touren WHERE id = :id")
    suspend fun loescheTour(id: String)

    // — Trackpunkte —
    @Insert
    suspend fun fuegePunkteEin(punkte: List<TrackpunktEntity>)

    @Query("SELECT * FROM trackpunkte WHERE tourId = :tourId ORDER BY tOffsetS")
    suspend fun punkte(tourId: String): List<TrackpunktEntity>

    @Query("SELECT COUNT(*) FROM trackpunkte WHERE tourId = :tourId")
    suspend fun punktAnzahl(tourId: String): Int

    @Query("DELETE FROM trackpunkte WHERE tourId = :tourId")
    suspend fun loeschePunkte(tourId: String)

    // — Moduswechsel —
    @Insert
    suspend fun fuegeModuswechselEin(wechsel: ModuswechselEntity)

    @Query("SELECT * FROM moduswechsel WHERE tourId = :tourId ORDER BY tOffsetS")
    suspend fun moduswechsel(tourId: String): List<ModuswechselEntity>

    @Query("DELETE FROM moduswechsel WHERE tourId = :tourId")
    suspend fun loescheModuswechsel(tourId: String)

    // — Medien —
    @Insert
    suspend fun fuegeMediumEin(medium: MediumEntity)

    @Query("SELECT * FROM medien WHERE tourId = :tourId ORDER BY aufgenommenMs")
    suspend fun medien(tourId: String): List<MediumEntity>

    @Query("SELECT COUNT(*) FROM medien WHERE tourId = :tourId")
    fun medienAnzahlFluss(tourId: String): Flow<Int>

    @Query("UPDATE medien SET uploadStatus = :status WHERE tourId = :tourId AND id = :id")
    suspend fun setzeMediumStatus(tourId: String, id: String, status: MediumUploadStatus)

    @Query("DELETE FROM medien WHERE tourId = :tourId")
    suspend fun loescheMedien(tourId: String)
}
