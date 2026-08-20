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

**Der Upload läuft als VORDERGRUNDARBEIT, und ohne das findet er auf manchen Geräten gar
nicht statt.** Eine App im Hintergrund-Cache bekommt bei herstellereigener Energieverwaltung
kein Netz: An einem Xiaomi (HyperOS, frisch installierte App, Standby-Bucket RARE) meldete
`dumpsys netpolicy` für die UID `blocked=APP_BACKGROUND, allowed=NONE,
effective=APP_BACKGROUND` und der JobScheduler `Unsatisfied constraints: CONNECTIVITY` —
während dasselbe WLAN für jede andere App stand. Das erzeugt keinen Fehler, sondern eine
Endlosschleife: Worker startet, findet kein Netz, `vermerkeUndRetry` setzt `ENTWURF`, Backoff,
von vorn. Sichtbar war das nur als abwechselnd „Wird hochgeladen" und „Wird geladen, sobald
eine Verbindung besteht", also als Verbindungsproblem an einem funktionierenden WLAN. Sobald
die App im Vordergrund lag, war `allowed=FOREGROUND|TOP` und der Upload lief sofort durch.
Vier Dinge, die man dabei kippt:

- **`setForeground` steht VOR dem ersten Netzzugriff.** Danach wäre die Ortsbenennung schon
  der Aufruf, der ins Leere läuft.
- **Sein Fehlschlag wird verschluckt.** Ab Android 12 darf ein Vordergrunddienst nicht aus
  jeder Lage heraus starten; ein `throw` an der Stelle machte aus einer Verbesserung einen
  neuen Fehlerweg. Ohne Benachrichtigungs-Erlaubnis läuft der Dienst ebenfalls, nur unsichtbar
  — es geht um den Netzzugang, die Meldung ist die Gegenleistung dafür.
- **Der Typ `dataSync` muss ins Manifest**, und zwar an WorkManagers eigenen
  `SystemForegroundService` (`tools:node="merge"`). Ab Android 14 wirft ein Vordergrunddienst
  ohne Typ beim Start. Die Berechtigung `FOREGROUND_SERVICE_DATA_SYNC` gehört dazu.
- **`setExpedited` braucht `RUN_AS_NON_EXPEDITED_WORK_REQUEST`**: Das Kontingent für
  beschleunigte Aufträge ist begrenzt, ohne den Rückfall wirft schon das Einreihen. Der
  Netzzugang hängt ohnehin nicht daran, sondern am `setForeground` im Auftrag selbst.

Der `FotoNachzugWorker` trifft dieselbe Sperre und ist noch NICHT umgestellt: Seine Meldung
und die spätere Import-Meldung teilen sich eine ID (4711, „eine Meldung, eine Wahrheit"), und
WorkManager räumt die Vordergrund-Meldung beim Ende des Auftrags weg — die Endmeldung
verschwände mit. Das braucht eine eigene Überlegung, keinen schnellen Handgriff.

**Medien-IDs** (`m1`, `m2`, …) werden aus der HÖCHSTEN vergebenen Nummer plus eins gebildet,
nicht aus der Anzahl — sonst kollidiert nach dem Löschen eines Fotos die nächste ID im
Verbund-Primärschlüssel `(tourId, id)`.

**Nach dem Upload ist das Manifest unveränderlich.** Foto-Titel und Titelbild laufen dann über
das Edit-Overlay: lesen, EINEN Schlüssel ergänzen, zurückschreiben — als **rohes JsonObject**
(`upload/EditsFortschreibung.kt`). Würde die App es in ein eigenes Modell parsen, fielen im
Studio gesetzte Kamerafahrten, Musik und Wetterkorrekturen still unter den Tisch.

**Der WebView-Player kann kein Bearer-Token schicken.** Er lädt `erlebnis.html` vom Web-Origin
und kennt nur Cookies; das Token steckt im OkHttp-Client. Vor dem Abspielen tauscht die App es
deshalb über `POST /api/auth/session-from-token` gegen eine Sitzung — ohne das wären private
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
Manifest `travelModesAuto` — ohne dieses Feld sähe er nur `walk` und könnte eine Angabe nicht
von der Vorgabe unterscheiden. Die Berechtigung wird nur bei „Automatisch" erfragt und darf den
Start **nie** blockieren: Ohne sie zeichnet die App ohne Automatik auf, und der Server leitet
die Aufteilung wie bisher aus dem Tempo ab.

**Verbundene Dienste (Tracker) — die App bleibt dünn.** Kein Anbieter-SDK, kein OAuth in
Kotlin: Die App holt eine Autorisierungs-URL vom eigenen Server
(`POST /api/tracker/<id>/connect` mit `target=app`), öffnet sie in einem **Custom Tab** und wird
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

**Der Weg von neuen Cloud-Touren ist Push, der Rückfall ist der `TrackerAbfrageWorker`** —
und beide enden in derselben Funktion (`tracker/Importmeldung.kt`). Getrennt geschrieben
liefen die Fassungen auseinander, und der Unterschied fiele erst auf einem Gerät auf, auf
dem genau der andere Weg greift. Der periodische Lauf bleibt, weil er drei Fälle fängt, die
Push nie abdeckt: Geräte ohne Play Services, von der Herstellersoftware verschluckte
Nachrichten, und die Zeit zwischen „Konto verknüpft" und „Adresse registriert".
`ExistingPeriodicWorkPolicy.KEEP` — mit `UPDATE` setzte jeder App-Start das
15-Minuten-Intervall zurück und die Abfrage liefe nie. Gemeldet werden **nur FERTIGE**
Importe: Eine übersprungene Halleneinheit ist kein Ereignis für den Sperrbildschirm, und ein
Fehler, den niemand beheben kann, ist dort Lärm — beides steht in der Liste im Konto. **Geholt
wird ohne `?seen=1`, abgehakt wird hinterher** (`trackerImporteGesehen` mit den IDs): Wer
beim Holen quittiert, verliert die Meldung, sobald das Zeigen scheitert — und es scheitert
regelmäßig, weil die Benachrichtigungs-Berechtigung ab Android 13 fehlen kann. Abgehakt wird
deshalb genau, was erledigt IST: das nicht Meldenswerte immer, das Fertige nur bei gestellter
Meldung. Ein Import, für den die Berechtigung fehlt, bleibt offen und kommt wieder. Eigener
Benachrichtigungs-Kanal (`KANAL_IMPORTE`), damit das Stummschalten der dauerhaften
Aufzeichnungs-Meldung nicht auch „deine Tour ist da" verschluckt. Beim Abmelden wird der Lauf
beendet.

**Push hält die App dünn** (`push/`): Sie meldet sich bei FCM an und gibt ihre Adresse dem
EIGENEN Server — mehr nicht. Was gemeldet wird, holt sie über dieselben Routen wie der
periodische Abruf; die Nachricht selbst trägt nur einen Anlass. Fünf Dinge, die man dabei
kippt: **Die Adresse ist die FID, nicht der Registrierungs-Token** — FCM hat ihn mit SDK
25.1.0 (Juni 2026) abgelöst, an die Stelle von `getToken`/`deleteToken`/`onNewToken` treten
`register()`/`unregister()`/`onRegistered()`; wer eine Anleitung von früher befolgt, baut
gegen ein abgekündigtes Feld. **Auto-Init ist AUS** (`firebase_messaging_auto_init_enabled`
im Manifest), denn `firebase-installations` meldet sonst schon beim App-Start eine Kennung
an Google — vor jeder Zustimmung; eingeschaltet wird sie erst in `MaptalePush.aktiviere`.
Daneben steht `firebase_messaging_installation_id_enabled=true`, und das ist kein
Widerspruch: Ohne diese Freigabe wirft `register()` mit „API disabled“ — seit die FID die
Adresse ist, muss eine App ausdrücklich erlauben, dass sie dafür benutzt wird. Das eine
entscheidet, ob von SELBST registriert wird (nein), das andere, ob es überhaupt möglich ist.
Am Gerät gefunden; die Testsuite sieht es nicht, weil Firebase dort nie initialisiert.
**Die Berechtigungsabfrage IST der Zustimmungsmoment**, und sie steht am Rückweg des
Verknüpfens: Vorher gäbe es nichts zu melden, und ein Systemdialog beim Start ist der, den
man wegtippt. Beim App-Start wird nur NACHGEZOGEN, wenn die Erlaubnis schon steht — sonst
bekäme eine Neuinstallation nie eine Adresse. **Abgemeldet wird VOR dem Abmelden vom Konto**,
sonst gibt es kein Token mehr, mit dem sich das dem Server sagen ließe. Und **`google-services.json`
ist optional**: Das Plugin wird nur angewandt, wenn die Datei da ist (sie ist ein Schlüssel und
gitignored, in der CI ein Secret) — fest angewandt könnte niemand mehr bauen, der sie nicht
hat, auch die Release-APK nicht. Ohne sie läuft die App vollständig, nur ohne Push.
Einrichtung: [docs/ops/push-einrichten.md](../docs/ops/push-einrichten.md).

**Der Foto-Nachzug ist der eigentliche Produktwert der Tracker-Anbindung**
(`galerie/`): Der Track kommt aus der Uhr, die Fotos kann nur das Gerät beisteuern. Die
rechnenden Teile stehen DOM-frei und getestet in `Fotofenster.kt`, die MediaStore-Abfrage in
`Galerie.kt`, der Weg zum Server in `Fotonachzug.kt`. Sechs Dinge, die man dabei kippt:
**Gelesen wird NUR im Zeitfenster einer Tour** — es gibt bewusst keine Funktion, die „alle
Bilder" liefert; das ist die Zusage aus der Datenschutzerklärung, nicht Sparsamkeit im Code.
**Es gibt KEINE Toleranz um das Fenster** (`TOLERANZ_MS = 0`): Sie stand einmal bei zwei
Stunden, begründet damit, dass EXIF keine Zone trage — nur lesen wir kein EXIF, sondern
`MediaStore.DATE_TAKEN`, und das ist bereits UTC. Die Folge war, dass zwei Runden desselben
Vormittags DIESELBEN dreizehn Fotos bekamen (tatsächlich im Fenster lagen vier bzw. fünf).
Auch eine kleine Toleranz löst das nicht, nur seltener: Sie greift in die Nachbartour, sobald
zwei Aufzeichnungen dicht aufeinanderfolgen. Ein Foto in zwei Touren ist ein sichtbarer
Fehler, ein fehlendes bloß ein fehlendes — deshalb die Regel, die man ohnehin erwartet: Ein
Foto gehört zu der Tour, die lief, als es entstand.
**Positiv- UND Negativliste beim Ordner**: Nur die Sperrliste ließe jede künftige Foto-App
durch, nur die Positivliste verlöre Hersteller mit eigenem Kamera-Ordner; ohne beides landet
der Screenshot aus der Pause in der Reise. **`DATE_TAKEN`, nicht `DATE_ADDED`** — wer sein
Handy nach der Tour an den Rechner hängt, hätte sonst ein Hinzufügedatum von heute.
**Gefiltert wird auf die Endungen, die der SERVER annimmt** (`endungErlaubt`): Das Pixel legt
neben jedem Foto eine RAW-Datei ab, und weil die Nachreich-Route keine halben Stapel kennt,
ließ ein einziges `.dng` den ganzen Nachzug mit 400 scheitern. Nebenwirkung, die man sonst
extra bauen müsste: RAW und JPEG sind dasselbe Bild und lägen sonst doppelt in der Tour.
HEIC ist seit v0.55.3 dabei (der Server löst die Kacheln auf — gelöst wurde es dort, sonst
hätte es nur Android repariert).
**Videos liegen in einer ZWEITEN Sammlung** (`MediaStore.Video`) und wurden bis 2026-08-10
gar nicht erst gesucht: Wer unterwegs filmte, bekam nie einen Vorschlag, obwohl die Pipeline
Video längst annimmt (Transcode, Poster, Faststart). Drei Dinge hängen an `Galeriebild.istVideo`,
und jedes läuft still falsch, wenn es fehlt: die **Content-URI** (IDs werden PRO Sammlung
vergeben — eine Video-ID an `Images.EXTERNAL_CONTENT_URI` zeigt auf ein fremdes Bild), die
**Endungsliste** (der Server prüft die Endung gegen den `type`; `.lrv`/`.thm` neben der `.mp4`
sind derselbe Fall wie das RAW neben dem JPEG) und der **`type` im Manifest**. Der GPS-Anker
entfällt für Video bewusst: Der Ort steht im MP4-Atom `©xyz`, das `ExifInterface` nicht liest —
es verankert die Zeit, und ein Video hat ohnehin eine Dauer statt eines Punktes.
**MediaStore liefert seit Android 10 IMMER 0 als Koordinate**; der Ort steckt nur im EXIF des
Originals (`MediaStore.setRequireOriginal` + `ACCESS_MEDIA_LOCATION`) und wird erst BEIM
HOCHLADEN gelesen — ein Dateizugriff je Bild, und die meisten Vorschläge werden nie
hochgeladen. Ohne ihn platziert der Server über die Zeit, und das ist der Normalfall. Und
**nach dem Hochladen muss `reprocess` laufen**, sonst liegen die Bilder in der Ablage und
nicht im Film — sein Fehlschlag ist aber kein Drama, s. unten.

**Gegen doppelte Fotos stehen ZWEI Riegel, und sie decken verschiedene Wege.** Der eine liegt
beim Server: Jeder Eintrag trägt eine `source` (`galerie:<MediaStore-ID>`), und was darunter
schon im Manifest steht, wird kein zweites Mal angelegt. Das ist nötig, weil der Dedup über
`tourDetail` allein NICHT trägt — der liest das gerenderte `tour.json`, und das kennt
nachgereichte Bilder erst nach `reprocess`; scheitert der, schlüge der nächste Lauf dieselben
Fotos wieder vor. Der andere ist `nachzugSperre`, ein prozessweiter Mutex: `meldeOffeneImporte`
läuft aus zwei Richtungen (Push-Dienst und `TrackerAbfrageWorker`), und zwei gleichzeitige
`POST …/medien` sehen dasselbe Manifest — der Server-Riegel greift erst, wenn der erste
GESCHRIEBEN hat. Dazu die Längenprüfung vor dem `zip`: Ein stilles Abschneiden lüde Bild B
unter der ID von A hoch.

**Die Einwilligung lebt in der APP, nicht auf dem Server** (`Konto.fotosAutomatisch`): Die
Galerie liegt auf dem Gerät, und bei zwei Geräten am selben Konto soll nur das mit den Fotos
hochladen. Sie ist Vorgabe AUS und überlebt das Abmelden nicht — wer sich abmeldet, hat dem
nächsten Konto auf diesem Gerät nichts erlaubt. Der Schalter im Profil fragt beim
EINSCHALTEN nach dem Leserecht und bleibt aus, wenn es verweigert wird: ein „an", hinter dem
nichts passieren kann, wäre die schlechtere Auskunft. **Der Nachzug ist eine eigene ARBEIT** (`FotoNachzugWorker`), nicht Teil des Meldungspfads.
Er lief dort einmal, damit die Benachrichtigung gleich sagen kann, was dazukam — und das
kostete am Gerät genau die Benachrichtigung: `meldeOffeneImporte` läuft im Push-Handler,
dem Android nur Sekunden gibt; dreizehn Fotos über Mobilfunk sprengen das. Der Prozess
starb mittendrin (8 von 13 Dateien), und damit gab es WEDER Fotos noch Meldung noch
Quittung. **Die Meldung gehört seither dem Nachzug** — und sie erzählt den Vorgang, statt sein Ende
zu behaupten: nichts zu ergänzen, dann sofort melden; sonst Fortschritt zeigen („Fotos
werden ergänzt … 7 von 12", `setOngoing`) und am Ende die vollständige Meldung über
dieselbe ID. `setOnlyAlertOnce` ist dabei Pflicht, sonst vibriert das Telefon bei JEDEM
Bild. Überschrift ist der TITEL der Tour, darunter „Polar · 4,2 km · 12 Fotos"; scheitert
der Listenabruf, bleibt die allgemeine Überschrift statt einer falschen Angabe. Ein Deckel
von vier Anläufen meldet die Tour notfalls ohne Bilder — er greift NICHT bei fehlendem
Netz, denn dann läuft der Auftrag wegen `NetworkType.CONNECTED` gar nicht erst, und ohne
Netz hätte die App von der Tour ohnehin nie erfahren. WorkManager überlebt den Prozess, wartet auf Netz und
wiederholt — dieselbe Wahl wie beim `UploadWorker`. **`suchePassendeFotos` trennt „nichts gefunden" von „noch nicht zu beantworten"** (leere Liste vs. `null`): Eine Tour, die noch rendert, hat kein Zeitfenster — wer das als „nichts gefunden" liest, gibt auf, statt zu warten. Am Gerät kostete genau das eine Tour ihre Fotos: Der Nachzug startete EINE SEKUNDE bevor sie fertig war; zwei andere Touren derselben Runde hatten nur Glück mit dem Zeitpunkt. `null` führt jetzt zu `Result.retry`. Ein Wiederanlauf ist gefahrlos, weil
die `source` den Server nichts doppelt anlegen lässt. Aus demselben Grund läuft der
Knopf „Hinzufügen" im `appScope` statt im `viewModelScope`: Wer den Screen verlässt, riss
den Lauf sonst entzwei. Ohne sie wartet in der Tour selbst eine
FRAGE (`ServerTourScreen`), und die Screen-Suche läuft genau dann nicht, wenn die Automatik
an ist: Sonst böte sie an, was längst geschehen ist.

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

**Für den einen Schritt 3→4 gilt das NICHT** (Welle 1 der Englisch-Migration,
[Konzept](../docs/concepts/konzept_codebase_english_refactoring.md) §4.4): Tabellen, Spalten
und Enum-Speicherwerte gehen auf Englisch, und der Rückfall wirft die lokale Datenbank weg.
Das ist kein Ersatz für „einfach neu installieren", sondern die Bedingung dafür, dass ein
APK-Update DERSELBEN Signatur überhaupt startet — ohne den Aufruf stürzt es beim Öffnen der
v3-Datenbank ab. Tragbar ist es, weil zu diesem Zeitpunkt nur Geräte des Betreibers eine App
tragen (§4.5). Nach Welle 7 kommt die Zusage zurück: Aufruf raus, Kommentar wieder hin, ab v5
wieder echte Migrationen.

**Nicht erreichbar, aber vorhanden:** `ui/ImportScreen.kt` (GPX-Import) hat keinen Einstieg
mehr — auf dem Telefon liegen selten GPX-Dateien, das ist eine Studio-Aufgabe. Der Code bleibt
für einen späteren „Öffnen mit"-Intent-Filter stehen.
