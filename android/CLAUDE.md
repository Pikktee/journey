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

**Die Fortbewegung wird bei „Automatisch" unterwegs erkannt** (Play Services Activity
Recognition, in `play-services-location` schon enthalten). `AufzeichnungsService.starte` bekommt
dafür `modus = null`; der Service registriert dann Übergänge (`Bewegungserkennung`, ENTER-only,
PendingIntent auf den Service statt eigenem Receiver) und schreibt jede Meldung roh als
Moduswechsel mit. **Geglättet wird erst beim Manifest-Bau** (`ManifestBau.glaetteWechsel` →
`Bewegungsdeutung.glaette`, pure und getestet): Die Erkennung meldet an Ampeln und beim
Umsteigen mehrfach in Sekunden, und ungefiltert entstünden dutzende Segmente — die der Server
als bewusste Umschaltung nimmt und deshalb nicht mehr korrigiert. Aus der Verbesserung würde
eine Verschlechterung. Das Zerschneiden in `baueSegmente` bleibt davon unberührt mechanisch.
Welches Fahrzeug es war, weiß kein Sensor: `IN_VEHICLE` wird `jeep`, und der Server hebt
Abschnitte auf einer Straßenbahntrasse anschließend auf `tram`. Damit er das darf, trägt das
Manifest `modiAutomatisch` — ohne dieses Feld sähe er nur `walk` und könnte eine Angabe nicht
von der Vorgabe unterscheiden. Die Berechtigung wird nur bei „Automatisch" erfragt und darf den
Start **nie** blockieren: Ohne sie zeichnet die App ohne Automatik auf, und der Server leitet
die Aufteilung wie bisher aus dem Tempo ab.

**Verbundene Dienste (Tracker) — die App bleibt dünn.** Kein Anbieter-SDK, kein OAuth in
Kotlin: Die App holt eine Autorisierungs-URL vom eigenen Server
(`POST /api/tracker/<id>/connect` mit `ziel=app`), öffnet sie in einem **Custom Tab** und wird
per Deep Link `maptale://tracker/<anbieter>` zurückgerufen. Kein WebView — mehrere Anbieter
sperren eingebettete Browser für OAuth, und dort wäre weder die Adresse prüfbar noch das
Passwort außerhalb unserer Reichweite. Der Custom Tab ist dieselbe Sicherheit wie der
System-Browser, nur aufgeräumter: Er läuft in unserer Aufgabe, schließt sich nach dem Rückweg
selbst und lässt keinen Tab liegen. Sein Rückfall ist eingebaut — `CustomTabsIntent` ist im
Kern ein `ACTION_VIEW` mit Zusatzangaben, ein Browser ohne Custom-Tab-Unterstützung öffnet die
Seite also ganz normal. Die Leiste trägt `NachtFlaeche`, NICHT das Sonnengelb: Chrome wählt
die Schriftfarbe der Adresse nach der Helligkeit, und auf Gelb würde sie schwarz. Drei Dinge, die man dabei kippt: **`setIntent` in
`onNewIntent`** ist Pflicht, sonst liefert `getIntent()` weiter den Start-Intent und ein
zweites Verknüpfen im selben App-Leben kommt nie an. **Dem `ok=1` im Link wird NICHT
geglaubt** — die App fragt den Server nach dem tatsächlichen Zustand; was zählt, steht dort.
Und ein **eigenes Schema statt eines https-App-Links**, weil letzterer eine `assetlinks.json`
auf der Domain bräuchte: Die Adresse ist kein Ort im Web, sondern ein Rückruf.

**`TrackerAbfrageWorker` ist der Rückfall, nicht der Hauptweg** (Push ist Etappe 6). Er fängt
drei Fälle, die Push nie abdeckt: Geräte ohne Play Services, von der Herstellersoftware
verschluckte Nachrichten, und die Zeit zwischen „Konto verknüpft" und „Push-Token
registriert". `ExistingPeriodicWorkPolicy.KEEP` — mit `UPDATE` setzte jeder App-Start das
15-Minuten-Intervall zurück und die Abfrage liefe nie. Gemeldet werden **nur FERTIGE**
Importe: Eine übersprungene Halleneinheit ist kein Ereignis für den Sperrbildschirm, und ein
Fehler, den niemand beheben kann, ist dort Lärm — beides steht in der Liste im Konto. Eigener
Benachrichtigungs-Kanal (`KANAL_IMPORTE`), damit das Stummschalten der dauerhaften
Aufzeichnungs-Meldung nicht auch „deine Tour ist da" verschluckt. Beim Abmelden wird der Lauf
beendet.

**Video wird stabilisiert, Foto nicht** (`kamera/Stabilisierung.kt`, gebunden in
`KameraScreen.kt`). CameraX schaltet von sich aus **nichts** ein: `VideoCapture.withOutput(…)`
nahm mit dem rohen Sensorbild auf, und auf dem Pixel 9 sah man jeden Schritt. Es gibt zwei Wege,
und sie sind nicht austauschbar — `setPreviewStabilizationEnabled` am Preview stabilisiert
Vorschau UND Aufnahme (Android 13+), `setVideoStabilizationEnabled` am VideoCapture nur die
Aufnahme; beim zweiten ist der Bildausschnitt des Videos enger als der der Vorschau, man rahmt
also etwas anderes, als man aufnimmt. Deshalb Vorschau-Weg zuerst, Video-Weg nur als Rückfall.
Drei Fallen: **Ungeprüft einschalten wirft** — die HAL quittiert eine nicht unterstützte
Stabilisierung mit einem Fehler, statt sie still zu übergehen, also erst
`Preview.getPreviewCapabilities(info)` / `Recorder.getVideoCapabilities(info)` fragen (in
CameraX 1.4.2 der einzige Weg; `CameraInfo.isVideoStabilizationSupported` kam erst mit 1.5).
**Im FOTO-Modus bleibt beides aus**, denn eine stabilisierte Vorschau ist beschnitten, das Foto
aus dem `ImageCapture` aber nicht — das Bild zeigte sonst mehr, als im Sucher stand; gefragt
wird dort gar nicht erst, die Video-Abfrage liest Camcorder-Profile auf dem Hauptthread. Und
weil beides nur im **Builder** setzbar ist und am Objektiv hängt, entstehen Preview und
VideoCapture **pro Bindung** neu statt einmal im `remember` — die Aufnahme-Rotation liegt
seitdem als Zustand vor und wird jeder frischen Instanz mitgegeben, sonst käme ein Video
gedreht heraus, das zwischen Bindung und nächster Sensormeldung startet. Googles eigene
Fused-/Cinematic-Stabilisierung der Pixel-Kamera-App ist proprietär und bleibt unerreichbar.

**Eine wartende Videofläche zeigt das Standbild, nicht Schwarz** (`Videoflaeche` in
`ui/Bausteine.kt`). Ein `VideoView` zeigt vor dem ersten dekodierten Frame nichts, und auf
dunklem Grund heißt „nichts" eine leere schwarze Fläche — ohne Ladehinweis, ohne Fehler. Über
Mobilfunk dauerte das mehrere Sekunden, und wer so lange auf Schwarz sieht, hält das Video für
kaputt und geht zurück (genau so gemeldet). Gezeigt wird deshalb, bis
`MEDIA_INFO_VIDEO_RENDERING_START` kommt, dasselbe Bild wie auf der Kachel: bei Server-Touren
das Poster, lokal die Videodatei selbst (Coils `VideoFrameDecoder`). Dazu ein
`setOnErrorListener` — ohne ihn verschwand ein gescheiterter Start spurlos. Die Ursache der
Wartezeit lag serverseitig (`moov` am Dateiende, s. Root-`CLAUDE.md`); das Standbild deckt den
Rest ab, den kein Server wegnehmen kann: das Netz.
**Die Quelle gehört in den `update`-Block**, nicht in die `factory`: Die läuft genau einmal, und
die Sitzung für die Kopfzeilen (private Medien) kommt erst aus dem Netz — wer dort setzt, spielt
ohne Anmeldung an und bekommt nie eine zweite Chance.

**Die Versionsnummer wird nicht hier gepflegt.** `build.gradle.kts` liest sie aus der
`package.json` des Repos und rechnet den `versionCode` daraus (`0.34.0` → `3400`); ein
Drift-Wächter in `test/versionen.test.ts` verhindert den Rückfall auf eine fest eingetragene
Zahl. Sie stand einmal an zwei Stellen — gepflegt wurde nur eine, und auf dem Testgerät lag
dadurch monatelang eine Nummer, die nichts mehr über den Stand sagte. Den APK baut der
Deploy-Workflow bei jedem Version-Tag: [docs/ops/android-release.md](../docs/ops/android-release.md).

**Room-Migrationen sind Pflicht**, kein `fallbackToDestructiveMigration`: auf dem Gerät liegen
echte, noch nicht hochgeladene Aufnahmen. Schemata werden nach `android/app/schemas/`
exportiert; der Migrationstest baut daraus die alte Datenbank und lässt Room migrieren und
validieren.

**Nicht erreichbar, aber vorhanden:** `ui/ImportScreen.kt` (GPX-Import) hat keinen Einstieg
mehr — auf dem Telefon liegen selten GPX-Dateien, das ist eine Studio-Aufgabe. Der Code bleibt
für einen späteren „Öffnen mit"-Intent-Filter stehen.
