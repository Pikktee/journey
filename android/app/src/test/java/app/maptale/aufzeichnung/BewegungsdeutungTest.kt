// Glättung der erkannten Bewegung. Die Play-Services-Erkennung meldet an
// Ampeln und beim Umsteigen gern mehrfach in Sekunden — ungefiltert entstünden
// dutzende Segmente im Manifest, die der Server für bewusste Umschaltungen
// hielte und deshalb nicht mehr korrigierte.
package app.maptale.aufzeichnung

import app.maptale.daten.Modus
import org.junit.Assert.assertEquals
import org.junit.Test

class BewegungsdeutungTest {

    private fun a(t: Double, modus: Modus) = Modusabschnitt(t, modus)

    @Test
    fun `Bewegungsart wird zum Fortbewegungsmittel`() {
        assertEquals(Modus.WALK, Bewegungsdeutung.modus(Bewegungsart.ZU_FUSS))
        assertEquals(Modus.BIKE, Bewegungsdeutung.modus(Bewegungsart.RAD))
        // Welches Fahrzeug, weiß kein Sensor — der Server verfeinert per Schienen
        assertEquals(Modus.JEEP, Bewegungsdeutung.modus(Bewegungsart.FAHRZEUG))
    }

    @Test
    fun `haelt eine saubere Folge unveraendert`() {
        val roh = listOf(a(0.0, Modus.WALK), a(300.0, Modus.JEEP), a(1200.0, Modus.WALK))
        assertEquals(roh, Bewegungsdeutung.glaette(roh, endeS = 1800.0))
    }

    @Test
    fun `wirft das Flackern beim Umsteigen weg`() {
        // Aussteigen: kurz „zu Fuß", dann wieder Fahrzeug — das ist ein Halt,
        // kein Fußweg
        val roh = listOf(
            a(0.0, Modus.JEEP),
            a(600.0, Modus.WALK),
            a(620.0, Modus.JEEP),
            a(640.0, Modus.WALK),
            a(660.0, Modus.JEEP),
        )
        assertEquals(listOf(a(0.0, Modus.JEEP)), Bewegungsdeutung.glaette(roh, endeS = 1800.0))
    }

    @Test
    fun `behaelt einen echten Fussweg zwischen zwei Fahrten`() {
        val roh = listOf(a(0.0, Modus.JEEP), a(420.0, Modus.WALK), a(1320.0, Modus.JEEP))
        assertEquals(roh, Bewegungsdeutung.glaette(roh, endeS = 2700.0))
    }

    @Test
    fun `verschmilzt gleiche Nachbarn`() {
        val roh = listOf(a(0.0, Modus.WALK), a(200.0, Modus.WALK), a(500.0, Modus.BIKE))
        assertEquals(
            listOf(a(0.0, Modus.WALK), a(500.0, Modus.BIKE)),
            Bewegungsdeutung.glaette(roh, endeS = 1800.0),
        )
    }

    @Test
    fun `laesst den ersten Abschnitt bei null beginnen`() {
        // Die erste Meldung kommt erst, wenn die Erkennung anschlägt — davor
        // gälte sonst gar nichts
        val roh = listOf(a(45.0, Modus.BIKE), a(900.0, Modus.WALK))
        assertEquals(
            listOf(a(0.0, Modus.BIKE), a(900.0, Modus.WALK)),
            Bewegungsdeutung.glaette(roh, endeS = 1800.0),
        )
    }

    @Test
    fun `kippt einen zu kurzen ERSTEN Abschnitt auf seinen Nachfolger`() {
        val roh = listOf(a(0.0, Modus.WALK), a(30.0, Modus.JEEP))
        assertEquals(listOf(a(0.0, Modus.JEEP)), Bewegungsdeutung.glaette(roh, endeS = 1800.0))
    }

    @Test
    fun `misst auch den letzten Abschnitt gegen das Tour-Ende`() {
        // Ein Sprint kurz vor Schluss ist kein eigener Abschnitt
        val roh = listOf(a(0.0, Modus.JEEP), a(1750.0, Modus.WALK))
        assertEquals(listOf(a(0.0, Modus.JEEP)), Bewegungsdeutung.glaette(roh, endeS = 1800.0))
    }

    @Test
    fun `laesst eine einzelne Angabe in Ruhe`() {
        // Der Normalfall: Der Nutzer hat sein Mittel gewählt, es gibt genau
        // einen Wechsel bei 0 — daran darf die Glättung nichts ändern.
        val roh = listOf(a(0.0, Modus.TRAM))
        assertEquals(roh, Bewegungsdeutung.glaette(roh, endeS = 1800.0))
    }

    @Test
    fun `kommt mit leerer Eingabe klar`() {
        assertEquals(emptyList<Modusabschnitt>(), Bewegungsdeutung.glaette(emptyList(), endeS = 100.0))
    }
}
