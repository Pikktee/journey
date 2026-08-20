// Alle Datenbank-Zugriffe der App — ein DAO reicht bei diesem Schema-Umfang.
package app.maptale.daten

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

    @Query("SELECT * FROM tours WHERE id = :id")
    suspend fun tour(id: String): TourEntity?

    @Query("SELECT * FROM tours WHERE id = :id")
    fun tourFluss(id: String): Flow<TourEntity?>

    @Query("SELECT * FROM tours ORDER BY startMs DESC")
    fun alleTouren(): Flow<List<TourEntity>>

    @Query("UPDATE tours SET status = :status, error = :fehler WHERE id = :id")
    suspend fun setzeStatus(id: String, status: TourStatus, fehler: String? = null)

    @Query("SELECT * FROM tours WHERE status = :status")
    suspend fun tourenMitStatus(status: TourStatus): List<TourEntity>

    @Query("SELECT MAX(tOffsetS) FROM track_points WHERE tourId = :tourId")
    suspend fun letzterPunktOffset(tourId: String): Double?

    @Query("UPDATE tours SET serverId = :serverId WHERE id = :id")
    suspend fun setzeServerId(id: String, serverId: String)

    /**
     * Der lokale Entwurf hinter einer Server-Tour.
     *
     * Nach dem Upload bleibt er liegen (die Liste blendet ihn nur aus). Wird die
     * Tour beim Server gelöscht, muss er mit weg — sonst taucht sie als Entwurf
     * wieder in der Liste auf und der Nachzügler-Upload lädt sie erneut hoch.
     */
    @Query("SELECT * FROM tours WHERE serverId = :serverId LIMIT 1")
    suspend fun tourMitServerId(serverId: String): TourEntity?

    @Query("UPDATE tours SET distanceM = :distanceM WHERE id = :id")
    suspend fun setzeDistanz(id: String, distanceM: Double)

    @Query("DELETE FROM tours WHERE id = :id")
    suspend fun loescheTour(id: String)

    // — Trackpunkte —
    @Insert
    suspend fun fuegePunkteEin(punkte: List<TrackpunktEntity>)

    @Query("SELECT * FROM track_points WHERE tourId = :tourId ORDER BY tOffsetS")
    suspend fun punkte(tourId: String): List<TrackpunktEntity>

    @Query("SELECT COUNT(*) FROM track_points WHERE tourId = :tourId")
    suspend fun punktAnzahl(tourId: String): Int

    @Query("DELETE FROM track_points WHERE tourId = :tourId")
    suspend fun loeschePunkte(tourId: String)

    // — Moduswechsel —
    @Insert
    suspend fun fuegeModuswechselEin(wechsel: ModuswechselEntity)

    @Query("SELECT * FROM travel_mode_changes WHERE tourId = :tourId ORDER BY tOffsetS")
    suspend fun moduswechsel(tourId: String): List<ModuswechselEntity>

    @Query("DELETE FROM travel_mode_changes WHERE tourId = :tourId")
    suspend fun loescheModuswechsel(tourId: String)

    // — Medien —
    @Insert
    suspend fun fuegeMediumEin(medium: MediumEntity)

    @Query("SELECT * FROM media WHERE tourId = :tourId ORDER BY takenAtMs")
    suspend fun medien(tourId: String): List<MediumEntity>

    /** Neueste zuerst — so zeigt der Foto-Streifen das eben Aufgenommene vorn. */
    @Query("SELECT * FROM media WHERE tourId = :tourId ORDER BY takenAtMs DESC")
    fun medienFluss(tourId: String): Flow<List<MediumEntity>>

    @Query("SELECT * FROM media WHERE tourId = :tourId AND id = :id")
    fun mediumFluss(tourId: String, id: String): Flow<MediumEntity?>

    @Query("SELECT COUNT(*) FROM media WHERE tourId = :tourId")
    fun medienAnzahlFluss(tourId: String): Flow<Int>

    @Query("UPDATE media SET uploadStatus = :status WHERE tourId = :tourId AND id = :id")
    suspend fun setzeMediumStatus(tourId: String, id: String, status: MediumUploadStatus)

    @Query("UPDATE media SET caption = :caption WHERE tourId = :tourId AND id = :id")
    suspend fun setzeMediumCaption(tourId: String, id: String, caption: String?)

    @Query("DELETE FROM media WHERE tourId = :tourId AND id = :id")
    suspend fun loescheMedium(tourId: String, id: String)

    @Query("DELETE FROM media WHERE tourId = :tourId")
    suspend fun loescheMedien(tourId: String)
}
