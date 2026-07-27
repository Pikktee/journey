# Android-App

Aufnahme-App (Kotlin, Compose, minSdk 29). Aufgezeichnet wird in einem
**Foreground-Service**; der Live-Zustand liegt als Prozess-Singleton
(`AufzeichnungsZustand`, StateFlow), damit die Aufnahme das Verlassen des Screens überlebt.
Alles landet zuerst in Room, der Upload ist entkoppelt (WorkManager, pro Datei
wiederaufnehmbar).

**Hülle.** Zwei Reiter (Touren · Profil) mit dem Aufnahme-Knopf dazwischen — er ist KEIN
dritter Reiter: er wechselt nicht die Ansicht, sondern startet etwas, und während einer
laufenden Aufnahme führt er zu ihr zurück. Vollbild ohne Leiste laufen Aufzeichnung, Kamera,
Foto-Vollansicht, Tour-Detail und Player.

**Eine Tourenliste.** Lokale Entwürfe und Server-Touren werden verschmolzen
(`ui/Listenverschmelzung.kt`, DOM-frei getestet): Solange hochgeladen wird, gewinnt die lokale
Karte (nur sie kennt Fortschritt und Fehler), danach die vom Server (nur sie kennt Titelbild
und Kilometer). Der Upload startet automatisch beim Beenden der Aufnahme; der Nachzügler beim
App-Start reiht mit **`ExistingWorkPolicy.KEEP`** ein, sonst setzt er einen wartenden Backoff
zurück und startet doppelt.

**Medien-IDs** (`m1`, `m2`, …) werden aus der HÖCHSTEN vergebenen Nummer plus eins gebildet,
nicht aus der Anzahl — sonst kollidiert nach dem Löschen eines Fotos die nächste ID im
Verbund-Primärschlüssel `(tourId, id)`.

**Nach dem Upload ist das Manifest unveränderlich.** Foto-Titel und Titelbild laufen dann über
das Edit-Overlay: lesen, EINEN Schlüssel ergänzen, zurückschreiben — als **rohes JsonObject**
(`upload/EditsFortschreibung.kt`). Würde die App es in ein eigenes Modell parsen, fielen im
Studio gesetzte Kamerafahrten, Musik und Wetterkorrekturen still unter den Tisch.

**Der WebView-Player kann kein Bearer-Token schicken.** Er lädt `erlebnis.html` vom Web-Origin
und kennt nur Cookies; das Token steckt im OkHttp-Client. Vor dem Abspielen tauscht die App es
deshalb über `POST /api/auth/session-aus-token` gegen eine Sitzung — ohne das wären private
Touren (der Default für neue Touren) in der eigenen App unabspielbar.

**Room-Migrationen sind Pflicht**, kein `fallbackToDestructiveMigration`: auf dem Gerät liegen
echte, noch nicht hochgeladene Aufnahmen. Schemata werden nach `android/app/schemas/`
exportiert; der Migrationstest baut daraus die alte Datenbank und lässt Room migrieren und
validieren.

**Nicht erreichbar, aber vorhanden:** `ui/ImportScreen.kt` (GPX-Import) hat keinen Einstieg
mehr — auf dem Telefon liegen selten GPX-Dateien, das ist eine Studio-Aufgabe. Der Code bleibt
für einen späteren „Öffnen mit"-Intent-Filter stehen.
