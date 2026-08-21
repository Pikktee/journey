// Glättung der erkannten Bewegung. Die Play-Services-Erkennung meldet an
// Ampeln und beim Umsteigen gern mehrfach in Sekunden — ungefiltert entstünden
// dutzende Segmente im Manifest, die der Server für bewusste Umschaltungen
// hielte und deshalb nicht mehr korrigierte.
package app.maptale.recording

import app.maptale.data.TravelMode
import org.junit.Assert.assertEquals
import org.junit.Test

class ActivityInterpretationTest {

    private fun a(t: Double, travelMode: TravelMode) = TravelModeSegment(t, travelMode)

    @Test
    fun `ActivityKind wird zum Fortbewegungsmittel`() {
        assertEquals(TravelMode.WALK, ActivityInterpretation.travelModeFor(ActivityKind.ON_FOOT))
        assertEquals(TravelMode.BIKE, ActivityInterpretation.travelModeFor(ActivityKind.CYCLING))
        // Welches Fahrzeug, weiß kein Sensor — der Server verfeinert per Schienen
        assertEquals(TravelMode.JEEP, ActivityInterpretation.travelModeFor(ActivityKind.VEHICLE))
    }

    @Test
    fun `haelt eine saubere Folge unveraendert`() {
        val roh = listOf(a(0.0, TravelMode.WALK), a(300.0, TravelMode.JEEP), a(1200.0, TravelMode.WALK))
        assertEquals(roh, ActivityInterpretation.smooth(roh, endS = 1800.0))
    }

    @Test
    fun `wirft das Flackern beim Umsteigen weg`() {
        // Aussteigen: kurz „zu Fuß", dann wieder Fahrzeug — das ist ein Halt,
        // kein Fußweg
        val roh = listOf(
            a(0.0, TravelMode.JEEP),
            a(600.0, TravelMode.WALK),
            a(620.0, TravelMode.JEEP),
            a(640.0, TravelMode.WALK),
            a(660.0, TravelMode.JEEP),
        )
        assertEquals(listOf(a(0.0, TravelMode.JEEP)), ActivityInterpretation.smooth(roh, endS = 1800.0))
    }

    @Test
    fun `behaelt einen echten Fussweg zwischen zwei Fahrten`() {
        val roh = listOf(a(0.0, TravelMode.JEEP), a(420.0, TravelMode.WALK), a(1320.0, TravelMode.JEEP))
        assertEquals(roh, ActivityInterpretation.smooth(roh, endS = 2700.0))
    }

    @Test
    fun `verschmilzt gleiche Nachbarn`() {
        val roh = listOf(a(0.0, TravelMode.WALK), a(200.0, TravelMode.WALK), a(500.0, TravelMode.BIKE))
        assertEquals(
            listOf(a(0.0, TravelMode.WALK), a(500.0, TravelMode.BIKE)),
            ActivityInterpretation.smooth(roh, endS = 1800.0),
        )
    }

    @Test
    fun `laesst den ersten Abschnitt bei null beginnen`() {
        // Die erste Meldung kommt erst, wenn die Erkennung anschlägt — davor
        // gälte sonst gar nichts
        val roh = listOf(a(45.0, TravelMode.BIKE), a(900.0, TravelMode.WALK))
        assertEquals(
            listOf(a(0.0, TravelMode.BIKE), a(900.0, TravelMode.WALK)),
            ActivityInterpretation.smooth(roh, endS = 1800.0),
        )
    }

    @Test
    fun `kippt einen zu kurzen ERSTEN Abschnitt auf seinen Nachfolger`() {
        val roh = listOf(a(0.0, TravelMode.WALK), a(30.0, TravelMode.JEEP))
        assertEquals(listOf(a(0.0, TravelMode.JEEP)), ActivityInterpretation.smooth(roh, endS = 1800.0))
    }

    @Test
    fun `misst auch den letzten Abschnitt gegen das Tour-Ende`() {
        // Ein Sprint kurz vor Schluss ist kein eigener Abschnitt
        val roh = listOf(a(0.0, TravelMode.JEEP), a(1750.0, TravelMode.WALK))
        assertEquals(listOf(a(0.0, TravelMode.JEEP)), ActivityInterpretation.smooth(roh, endS = 1800.0))
    }

    @Test
    fun `laesst eine einzelne Angabe in Ruhe`() {
        // Der Normalfall: Der Nutzer hat sein Mittel gewählt, es gibt genau
        // einen Wechsel bei 0 — daran darf die Glättung nichts ändern.
        val roh = listOf(a(0.0, TravelMode.TRAM))
        assertEquals(roh, ActivityInterpretation.smooth(roh, endS = 1800.0))
    }

    @Test
    fun `kommt mit leerer Eingabe klar`() {
        assertEquals(emptyList<TravelModeSegment>(), ActivityInterpretation.smooth(emptyList(), endS = 100.0))
    }
}
