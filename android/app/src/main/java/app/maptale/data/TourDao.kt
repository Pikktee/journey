// Alle Datenbank-Zugriffe der App — ein DAO reicht bei diesem Schema-Umfang.
package app.maptale.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface TourDao {
    // — Touren —
    @Insert
    suspend fun createTour(tour: TourEntity)

    @Update
    suspend fun updateTour(tour: TourEntity)

    @Query("SELECT * FROM tours WHERE id = :id")
    suspend fun tour(id: String): TourEntity?

    @Query("SELECT * FROM tours WHERE id = :id")
    fun tourFlow(id: String): Flow<TourEntity?>

    @Query("SELECT * FROM tours ORDER BY startMs DESC")
    fun allTours(): Flow<List<TourEntity>>

    @Query("UPDATE tours SET status = :status, error = :fehler WHERE id = :id")
    suspend fun setStatus(id: String, status: TourStatus, fehler: String? = null)

    @Query("SELECT * FROM tours WHERE status = :status")
    suspend fun toursByStatus(status: TourStatus): List<TourEntity>

    @Query("SELECT MAX(tOffsetS) FROM track_points WHERE tourId = :tourId")
    suspend fun lastPointOffset(tourId: String): Double?

    @Query("UPDATE tours SET serverId = :serverId WHERE id = :id")
    suspend fun setServerId(id: String, serverId: String)

    /**
     * Der lokale Entwurf hinter einer Server-Tour.
     *
     * Nach dem Upload bleibt er liegen (die Liste blendet ihn nur aus). Wird die
     * Tour beim Server gelöscht, muss er mit weg — sonst taucht sie als Entwurf
     * wieder in der Liste auf und der Nachzügler-Upload lädt sie erneut hoch.
     */
    @Query("SELECT * FROM tours WHERE serverId = :serverId LIMIT 1")
    suspend fun tourByServerId(serverId: String): TourEntity?

    @Query("UPDATE tours SET distanceM = :distanceM WHERE id = :id")
    suspend fun setDistance(id: String, distanceM: Double)

    @Query("DELETE FROM tours WHERE id = :id")
    suspend fun deleteTour(id: String)

    // — Trackpunkte —
    @Insert
    suspend fun insertPoints(points: List<TrackPointEntity>)

    @Query("SELECT * FROM track_points WHERE tourId = :tourId ORDER BY tOffsetS")
    suspend fun points(tourId: String): List<TrackPointEntity>

    @Query("SELECT COUNT(*) FROM track_points WHERE tourId = :tourId")
    suspend fun pointCount(tourId: String): Int

    @Query("DELETE FROM track_points WHERE tourId = :tourId")
    suspend fun deletePoints(tourId: String)

    // — Moduswechsel —
    @Insert
    suspend fun insertTravelModeChange(wechsel: TravelModeChangeEntity)

    @Query("SELECT * FROM travel_mode_changes WHERE tourId = :tourId ORDER BY tOffsetS")
    suspend fun travelModeChanges(tourId: String): List<TravelModeChangeEntity>

    @Query("DELETE FROM travel_mode_changes WHERE tourId = :tourId")
    suspend fun deleteTravelModeChanges(tourId: String)

    // — Medien —
    @Insert
    suspend fun insertMedium(medium: MediumEntity)

    @Query("SELECT * FROM media WHERE tourId = :tourId ORDER BY takenAtMs")
    suspend fun media(tourId: String): List<MediumEntity>

    /** Neueste zuerst — so zeigt der Foto-Streifen das eben Aufgenommene vorn. */
    @Query("SELECT * FROM media WHERE tourId = :tourId ORDER BY takenAtMs DESC")
    fun mediaFlow(tourId: String): Flow<List<MediumEntity>>

    @Query("SELECT * FROM media WHERE tourId = :tourId AND id = :id")
    fun mediumFlow(tourId: String, id: String): Flow<MediumEntity?>

    @Query("SELECT COUNT(*) FROM media WHERE tourId = :tourId")
    fun mediaCountFlow(tourId: String): Flow<Int>

    @Query("UPDATE media SET uploadStatus = :status WHERE tourId = :tourId AND id = :id")
    suspend fun setMediumStatus(tourId: String, id: String, status: MediumUploadStatus)

    @Query("UPDATE media SET caption = :caption WHERE tourId = :tourId AND id = :id")
    suspend fun setMediumCaption(tourId: String, id: String, caption: String?)

    @Query("DELETE FROM media WHERE tourId = :tourId AND id = :id")
    suspend fun deleteMedium(tourId: String, id: String)

    @Query("DELETE FROM media WHERE tourId = :tourId")
    suspend fun deleteMedia(tourId: String)
}
