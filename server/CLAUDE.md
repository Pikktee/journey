# Backend (Anreicherungs-Pipeline, Konten, System-Mails)

Diese Datei lädt, sobald unter `server/` gearbeitet wird. Überblick, Deployment und die
Vier-Stellen-Regel der Fortbewegungs-Modi stehen in der [CLAUDE.md](../CLAUDE.md) der Wurzel;
die Bedien-Seite der Overlays in [src/studio/CLAUDE.md](../src/studio/CLAUDE.md).

## Medien und Pipeline

**HEIC wird beim Aufbereiten aufgelöst, in ZWEI Läufen** (`istKachelbild` in bild.ts): Ein
HEIC vom Telefon besteht aus Kacheln (vier Streams à 512×512 für ein Bild von 1024×1024).
ffmpeg setzt sie selbst zusammen, aber nur über einen komplexen Filtergraphen — und der
verträgt sich nicht mit unserem `-vf`. Der naheliegende Ausweg ist eine FALLE:
`-filter_complex "[0:v]scale=…"` läuft anstandslos durch und liefert Kachel null, also das
linke obere Viertel (gemessen gegen das richtige Bild: SSIM 0,45). Ohne Filter macht ffmpeg
es von selbst richtig; PNG als Zwischenformat, damit nicht zweimal JPEG-Verluste
übereinanderliegen. Der zweistufige Weg ergibt bitgenau dasselbe Bild (SSIM 1,0).

**Ausgeliefert werden ABGELEITETE Fassungen, nicht das Hochgeladene**
([bild.ts](src/pipeline/bild.ts)). Aus jedem Foto entstehen beim Rendern zwei Dateien —
`m1.w1920.jpg` (Anzeige, längste Kante 1920) und `m1.t480.jpg` (Kachel für Listen, Zeitleiste,
Pin-Köpfe) —, danach wird das **Original verworfen**; bei Video ebenso, sobald `m1.web.mp4`
steht. An einer echten Tour: 26,5 MB Originale → 3,1 MB Fassungen, ohne sichtbaren Unterschied
in der Wiedergabe. Vier Dinge, die man dabei leicht zerstört:
*Die Reihenfolge* — erst schreiben, dann löschen; wer die Quelle vorher wegnimmt, verliert bei
einem Abbruch beides. *Der Wiedereintritt* — jeder Re-Render läuft ohne Original, `bereiteFotosAuf`
und `bereiteVideosAuf` müssen die vorhandene Fassung als Quelle nehmen statt zu scheitern. *Der
Vollständigkeits-Check* im finalize ([tours.ts](src/routes/tours.ts)) zählt Original ODER
Fassung, sonst meldet jeder App-Retry „Medien fehlen". Und *das EXIF*: ffmpeg wirft es beim
Skalieren weg, der Studio-Editor liest die Aufnahme-Details aber aus der ausgelieferten Datei —
deshalb wird der Exif-APP1-Block von Hand übertragen und seine Drehung dabei auf 1 gesetzt (die
steckt jetzt in den Pixeln; bliebe die Angabe stehen, drehte der Browser ein zweites Mal). Die
Kachel bekommt bewusst kein EXIF: der Block eines Testfotos war 42 KB, mehr als das Bild selbst.
Bestandstouren stellt ein Start-Durchlauf um ([bildnachtrag.ts](src/pipeline/bildnachtrag.ts),
ohne Re-Render, also ohne neue Wetter-/Vision-Aufrufe). **`thumb` kann fehlen** — jede Anzeige
braucht den Rückfall auf `src`. Die App verkleinert schon vor dem Upload auf 2560 px
([Fotoaufbereitung.kt](../android/app/src/main/java/app/maptale/kamera/Fotoaufbereitung.kt)) — bewusst
größer als die Anzeige-Fassung, denn der Server rechnet aus DIESER Datei.

**Das Manifest wächst, es ändert sich nicht.** Medien kommen auch NACH dem Anlegen dazu
(`POST /api/tours/:id/media` — Studio-Nachreichen und der Foto-Nachzug zu Cloud-Touren):
Die Route hängt Einträge an, fasst vorhandene nie an und lässt **den Server die IDs vergeben**
(`n_…`), damit keine kollidiert und keine je wiederverwendet wird. **Ein Eintrag mit `source`
kommt genau einmal ins Manifest** (`galerie:<MediaStore-ID>`): Die App kann nicht wissen, was
eine Tour schon hat — sie sieht das gerenderte `tour.json`, und das kennt Nachgereichtes erst
NACH dem Rendern. Scheitert das (409 während einer Verarbeitung, Netz weg), wiederholt sie
den Lauf, und ohne diesen Riegel stünde danach jedes Bild doppelt in der Tour. Die Antwort
behält Länge und Reihenfolge der Anfrage, auch für Übersprungene — der Client paart sie über
den Index. Tombstones zählen mit: Ein endgültig gelöschtes Foto soll nicht beim nächsten Lauf
wiederkommen. Ohne `source` (Studio) bleibt jeder Eintrag neu, dort wählt ein Mensch aus. Gelöscht wird endgültig
(`DELETE …/media/:mid`): Rohdatei und alle Ableitungen sind weg, der Speicher ist frei — der
Manifest-Eintrag bleibt aber als **Tombstone** (`removed: true`) stehen, denn das Manifest ist
das Protokoll dessen, was hochgeladen wurde. Vier Regeln hängen daran: **`verfuegbareMedien`
([tours.ts](src/routes/tours.ts)) ist die EINE Filterstelle** — sie nimmt Tombstones und
angekündigte Einträge ohne Datei aus `processTour()`, weshalb Platzierung, Fassungen,
Bildanalyse, Render und Cover-Wahl sie gar nicht erst sehen (der Cover-Fallback beim gelöschten
Titelbild fällt dadurch von selbst an). **finalize überspringt Tombstones**, sonst blockierte
ein vor dem Finalisieren gelöschtes Medium die Tour für immer mit „Medien fehlen". **Die
Editor-Route filtert Einträge ohne Datei nur bei „bereit"** — dort ist ein solcher Eintrag
ein Überbleibsel (abgebrochenes Nachreichen) und als Klip gezeigt eine Aufnahme, die es nicht
gibt; bei „angelegt" läuft ihr Upload dagegen gerade erst und sie gehören in die Ansicht. Das
Manifest behält sie in beiden Fällen, es ist das Protokoll des Hochgeladenen. **Der
409-Riegel bei „bereit" gilt nur dem ÜBERSCHREIBEN** — ein nachgereichter Eintrag hat noch
keine Datei und darf ankommen; ein Tombstone nie wieder (die Auslieferung hat für diesen Namen
`immutable` versprochen). Und **gelöscht wird auch bei „bereit"**, nur nicht während
`processing`: Eine verschwundene Datei wird 404, nicht stale — der Riegel schützt vor einer
neuen Version unter altem Namen, nicht vor dem Verschwinden.
**Am Manifest schreibt immer nur EINER je Tour** ([manifestsperre.ts](src/manifestsperre.ts)):
Nachreichen und Löschen arbeiten beide „lesen → ändern → schreiben", und zwischen Lesen und
Schreiben liegt echte Wartezeit. Zwei gleichzeitige Läufe lesen denselben Stand, der zweite
schreibt den ersten weg — und verloren ist nicht bloß ein Eintrag: Der Client hat für ihn eine
Medien-ID bekommen und lädt die Bytes hoch, die dann gegen die Quota zählen und zu keiner Tour
gehören; der `source`-Riegel greift für sie nicht mehr, weil ihr Eintrag fehlt. Bei `DELETE`
gegen `POST` erweckt die Zustellung sogar einen Eintrag, dessen Dateien gerade gelöscht wurden.
Solange nur das Studio nachreichte, war das theoretisch (ein Mensch klickt nicht zweimal
gleichzeitig); mit dem Foto-Nachzug gibt es automatische Aufrufer. Der Mutex in der App deckt
nur ihren Prozess ab — serialisiert wird dort, wo die Datei liegt. Die Tests dazu verzögern das
Lesen und holen den Inhalt SOFORT: Wer erst wartet und dann liest, sieht bereits das Ergebnis
des anderen, und der Test wäre grün, ohne etwas zu prüfen.

Konzept: [docs/concepts/konzept_medien_nachreichen_und_loeschen.md](../docs/concepts/konzept_medien_nachreichen_und_loeschen.md).

**Vier Feinheiten der Pipeline, die man leicht „repariert":**

1. **Der Nutzertext eines Fotos wird die ÜBERSCHRIFT**, nicht die Unterzeile: `edits.caption`
   (Oberfläche: „Titel") landet im Tour-JSON als `title`, die Uhrzeit rutscht als „Foto ·
   14:32" darunter ([enrich.ts](src/pipeline/enrich.ts)). Ohne Beschriftung bleibt es
   umgekehrt. Der Feldname `caption` ist historisch — wer den Text „zurück an seinen Platz"
   schiebt, macht die Überschrift wieder zur Maschinenangabe.
2. **Gehabschnitte trennt der Server selbst** ([tempo.ts](src/pipeline/tempo.ts)):
   Rolling-Median über ±30 s, Hysterese 5,5/8 km/h, Mindestdauern gegen Ampel-Fehlalarme. Sie
   läuft in `ladeOriginalSegmente` — der einen Stelle, die sich Editor und Render teilen;
   nur beim Rendern angewandt, zeigte der Editor eine andere Aufteilung als das Video.
   `edits.travelModes` wird darübergelegt und behält Vorrang; mehrere Segmente im Manifest bleiben
   unangetastet (jemand hat dann selbst umgeschaltet). **Sie gilt für echte Aufzeichnungen,
   nicht für gesetzte Wegpunkte** — zwischen zwei Foto-Orten liegt eine Luftlinie, jedes
   daraus gerechnete Tempo wäre Zufall. Die Unterscheidung trifft `istAufzeichnung` an der
   FORM der Daten (dichtes Zeitraster; die App legt spätestens alle 30 s einen Punkt ab), denn
   ein Manifest-Feld dafür gibt es nicht und Bestandstouren hätten es ohnehin nicht. Sie hing
   lange stattdessen an `trackFile` — das aber nur der GPX-Import setzt, während die App ihren
   Track als eingebettete `segments` schickt: Bei JEDER App-Aufnahme lief dadurch gar keine
   Erkennung, und weil „Automatisch" in der App als `walk` übertragen wird, blieb eine
   Straßenbahnfahrt mit Fußwegen ein einziges „zu Fuß" über die ganze Tour.

   **Welches Fahrzeug es war, entscheidet die Trasse, nicht das Tempo**
   ([schienen.ts](src/pipeline/schienen.ts)): Moped, Jeep und Tram sind am Tempo nicht
   auseinanderzuhalten, die Automatik hebt eine Aufnahme ohne Angabe deshalb höchstens auf
   „Rad". Wer über ≥ 500 m zu ≥ 85 % im 30-m-Korridor um `railway=tram/light_rail` bleibt,
   saß in der Straßenbahn — abgefragt per Overpass (OSM). Die drei Schwellen stehen als
   `MIN_STRECKE_M`, `ANTEIL` und `KORRIDOR_M` in der Datei und wurden an einer echten
   Stadtfahrt kalibriert (`5f15531`); wer sie im Kopf hat, prüft sie dort nach. Drei Schutzregeln: Das läuft nur bei
   `frisch` (finalize/„Neu verarbeiten", also nie bei einem Edit-Speichern), nur wenn die
   Fortbewegung überhaupt GERATEN wurde (`trackMode` leer und alles `walk`), und nur solange
   `edits.travelModes` leer ist — eine im Studio gezogene Kante wird nie überstimmt. Das Ergebnis geht
   als Modus-Grenzen ins **Overlay**, nicht ins Tour-JSON: dort ist es sichtbar und
   korrigierbar (dasselbe Muster wie die Auto-Musikwahl). Fällt OSM aus, bleibt es bei „Rad" —
   eine Anreicherung, kein Muss.

   Erkennt die **App** die Fortbewegung selbst (Activity Recognition, s.
   [android/CLAUDE.md](../android/CLAUDE.md)), schickt sie fertige Abschnitte und setzt
   `travelModesAuto` im Manifest. Nur dieses Feld unterscheidet „erkannt" von „angegeben" —
   `walk` heißt in der App beides. Ein Fahrzeug schickt sie als `jeep`; welches es war, klärt
   auch dort erst der Schienenabgleich.
3. **Eine Pause wird GERAFFT, nicht herausgekürzt** ([zeit.ts](src/pipeline/zeit.ts),
   `raffePausen`): Überall gilt die echte Aufnahmezeit, nur um die Pause herum liegt ein
   schmales Streckenfenster, in dem die Zeit im Schnelldurchlauf vergeht — der Himmel dreht
   dort sichtbar von Dämmerung auf Nacht. Bis Juli 2026 wurde die Pause stattdessen auf zwei
   Minuten gestaucht; das nahm den Ruck, ließ aber ALLES Folgende um die Restdauer
   zurückhängen. An einer echten Tour endete die Telemetrie deshalb um 20:51, während die
   Fotos derselben Minuten schon „22:48" untertitelt waren. Das Fenster wird in FILMsekunden
   bemessen ([filmtempo.ts](src/pipeline/filmtempo.ts) — der Server kennt seit dem
   die Tempo-Tabelle der Engine, mit Drift-Wächter), nicht in Metern: 200 m sind zu Fuß vier
   Sekunden und auf der Fähre eine halbe. Und es wächst mit der Pausendauer, sonst zuckte
   das Licht bei zwei Stunden genauso schnell wie bei zwanzig Minuten. Der Player braucht
   dafür nichts: `createTimeAt` interpoliert linear in `f`, eine steile Stützstellen-Flanke
   IST der Zeitraffer — und weil der Sonnenstand pro Frame aus der Pseudo-Zeit gerechnet
   wird, ist er auch beim Scrubben deterministisch.
4. **Ein Video wird neu geschrieben, sobald sein Index hinten liegt**
   ([video.ts](src/pipeline/video.ts)): Android schreibt jede Aufnahme über den
   MediaMuxer, und der setzt das `moov`-Atom ans Dateiende — bei 26 MB also 26 MB hinter den
   Anfang. Wer so etwas streamt, sieht erst einmal gar nichts: Der Player liest den Kopf,
   findet keinen Index, springt ans Dateiende, holt ihn dort und beginnt erst dann zu laden.
   Auf dem Pixel waren das ~5 s pro Video, in denen die Fläche schwarz blieb. `+faststart`
   setzte lange nur der Transcode — und eine H.264/AAC-`.mp4` vom Telefon ist web-tauglich,
   wurde also unangetastet durchgereicht. Jetzt prüft `hatFaststart` die Atom-Reihenfolge und
   lässt sonst `remuxeFaststart` laufen: `-c copy`, nur der Container neu, 0,2 s für 26 MB,
   kein Qualitätsverlust. Heraus kommt dieselbe `m1.web.mp4` wie beim Transcode — aus einem
   anderen Grund. **Bestandstouren brauchen einmal „Neu verarbeiten"**, sonst bleibt es beim
   alten Auslieferungspfad.


## Tracker-Integrationen (Cloud-Importe)

Der anbieterblinde Kern in [server/src/tracker/](src/tracker/): Ein GPS-Track aus einer
Sport-Uhr landet ohne Handgriff als spielbare Tour im Konto. Gebaut sind Vertrag, Registry,
Krypto, Normalisierer, TourAnleger, Importlauf und die Routen; die echten Adapter (Polar
zuerst) fehlen noch. Konzept: [docs/concepts/konzept_tracker_integrationen.md](../docs/concepts/konzept_tracker_integrationen.md).

**Eine Cloud-Tour ist keine eigene Sorte Tour.** `touranleger.ts` ruft `legeTourAn` und
`finalisiereTour` aus [routes/tours.ts](src/routes/tours.ts) — dieselben Funktionen wie
die Upload-Route. Beide wurden genau dafür aus den Routen herausgezogen: Ein zweiter
Anlege-Pfad hätte Verifikation, Idempotenz, Medien-IDs, Zeit-Semantik und die
`private`-Vorgabe ein zweites Mal geführt, und der Player hätte einen Sonderfall bekommen.

**Der Dedup-Riegel liegt in der DATENBANK, nicht im Code.** Eine Cloud-Tour belegt
`client_tour_id = 'polar:1234567'` und erbt damit die vorhandene `UNIQUE(owner_id,
client_tour_id)`-Sperre der App. Daneben hat `tracker_importe` einen eigenen UNIQUE-Index —
keiner davon ist der einzige, weil sie verschiedene Wege abdecken: der eine die wiederholte
Zustellung (Wahoo staffelt bis 72 h), der andere den parallelen Anlege-Versuch.

**Der Webhook antwortet SOFORT und arbeitet danach** (`app.trackerLaeufe`, Muster wie
`app.verarbeitungen`): Strava verlangt eine Antwort in unter zwei Sekunden, ein Download plus
Pipeline schafft das nie. Er läuft **vor jeder Anmeldeprüfung** — seine Autorität ist die
Signatur, sein einziger Schreibzugriff geht über `externer_nutzer`. Verifikation kommt VOR
jedem Datenbankzugriff (sonst wäre schon das Protokoll ein Ziel für Müll von außen), und eine
Zustellung für ein unbekanntes Konto wird STILL verworfen — eine Fehlermeldung wäre eine
Auskunft darüber, welche Anbieter-Konten bei uns liegen.

**`uebersprungen` ist kein Fehler.** Aktivität ohne GPS, zu kurz (< 100 m UND < 2 min — die
Schwelle steht gegen das VERSEHEN, nicht gegen die kurze Runde, s. `touranleger.ts`) oder
Speicher voll: Das sind normale Ereignisse, keine Störungen. Als Fehler geführt stünde die
Liste eines Vielsportlers dauerhaft rot, und die eine echte Störung ginge darin unter.
Umgekehrt gilt: Eine tote Verknüpfung wird SICHTBAR tot (`abgelaufen` samt Grund) — der Nutzer
wartet sonst auf Touren, die nie kommen.

**Ein Fehlschlag ist kein Grabstein.** Der Dedup-Index beantwortete anfangs zwei Fragen mit
derselben Zeile — „schon erledigt?" und „schon versucht?" —, und damit war jeder vorübergehende
Fehler das endgültige Ende einer Aktivität: Die wiederholte Zustellung, auf die das ganze
Verfahren baut (Wahoo staffelt bis 72 h), lief wirkungslos in den Index. `wiederholbar` trennt
das und wird vom GRUND gesetzt, nicht vom Status: „ohne Route" und „zu kurz" sind Aussagen über
die Aktivität und bleiben endgültig; „Speicher voll", ein stummer Anbieter und jeder Netzfehler
sind Aussagen über den Moment. `beanspruche` nimmt eine solche Zeile wieder an (`ON CONFLICT …
DO UPDATE … WHERE wiederholbar = 1 AND versuche < MAX_VERSUCHE`), `gemeldet_am` bleibt dabei der
Zeitpunkt der ERSTEN Meldung. Am Deckel steht der Grund samt „nach 3 Versuchen" in der Zeile —
ein stiller Deckel läse sich wie ein Lauf, der noch kommt.

**Der Sync-Zeitpunkt ist ein CURSOR, kein Zeitstempel.** `listeNeue(tokens, zuletztSyncAm)`
fragt den Anbieter „was gibt es seitdem?" — vorgerückt, obwohl eine Aktivität offen blieb,
listet er sie nie wieder auf, und beim Polling-Anbieter gibt es keinen zweiten Weg zu ihr.
Deshalb setzt ihn `fuehreImporteAus` am ENDE und nur, wenn nichts Wiederholbares übrig ist,
und zwar je Verknüpfung (ein Stapel kann aus mehreren stammen). Die Route setzt ihn nur noch
im Fall „nichts gefunden".

**Wogegen der Cursor NICHT gehalten werden darf, ist die Startzeit einer Aktivität.** Er läuft
in Wanduhrzeit; eine Aktivität erscheint beim Anbieter aber lange nach ihrem Start — bei Polar
erst, wenn die Uhr synchronisiert, und dazu muss am Handgelenk die Ergebnisansicht weggeklickt
sein. Wer in dieser Lücke „Jetzt abrufen" drückt, schob den Cursor hinter die Startzeit seiner
eigenen Tour, und der Vergleich filterte sie danach für immer weg: Der Rückfallweg konnte das
eine nicht, wofür es ihn gibt. `PolarProvider.listeNeue` filtert deshalb GAR NICHT mehr nach
Zeit — die Grenze ist `beanspruche` (Import-Zeile in der Datenbank, VOR jedem Netzaufruf), und
Polars Liste ist ohnehin kurz. Ein künftiger Adapter, der `seit` an die Anbieter-API
weiterreicht, muss prüfen, worauf sie filtert (Erscheinungszeit ja, Startzeit nein) und im
Zweifel großzügig überlappen.

**„Jetzt abrufen" ist eine teure Route** — ein Anbieter-Aufruf plus je Aktivität ein voller
Pipeline-Lauf, dieselbe Sorte Last wie ein Datenexport und mit derselben Begründung gebremst
(6 pro 10 min je Konto). Sie wartet auf die ersten drei Aktivitäten und schiebt den Rest in
`app.trackerLaeufe`: Nach einer Woche Funkstille stünde die Anfrage sonst minutenlang offen,
bis der Reverse-Proxy sie abschneidet — der Lauf liefe weiter, der Nutzer sähe 504. Und
abgelaufener Zugang (409) wie stummer Anbieter (502) werden GEFANGEN; ungefangen liefen beide
in den allgemeinen Handler, und dort steht „Interner Fehler" statt dessen, was zu tun ist.

**Token-Erneuerung ausschließlich im Kern** (`gueltigeTokens`): Wahoo gibt Refresh-Tokens
einmalig aus, wer den neuen nicht speichert, hat die Verknüpfung verloren. Eine falsche
Stelle, ein zerstörter Zustand. Beim Erneuern wird die Anbieter-Nutzerkennung
weitergetragen — sie kommt oft nicht mit, und auf `null` gesetzt kappte sie den
Zuordnungsweg des Webhooks. `verbunden_am` bleibt beim Erneuern dagegen STEHEN: `verknuepfe`
schreibt beide Fälle, und mitgeschrieben stünde auf der Kontoseite dauerhaft „verbunden seit
vor ein paar Minuten" (Tokens laufen stündlich ab). Nach dem Trennen gibt es keine Zeile mehr,
dort setzt der INSERT-Zweig das Datum ohnehin frisch. Die Tokens liegen AES-256-GCM-verschlüsselt
([krypto.ts](src/tracker/krypto.ts), Schlüssel aus `MAPTALE_TRACKER_SECRET`);
fehlt der Schlüssel, sind alle Anbieter aus — Klartext als Rückfall gibt es nicht.

**Der Webhook ist der einzige Eingang OHNE Anmeldung** — und der einzige mit eigenem
`bodyLimit` (64 KB statt der globalen 64 MB für Manifeste): Bis die Signatur geprüft ist, hat
der Server den Body schon gepuffert und geparst; mit dem großen Limit wäre das der billigste
Weg, ihn zu beschäftigen. Echte Zustellungen sind ein paar hundert Byte. Den 413 lässt der
allgemeine Fehler-Handler seit demselben Zug durch: Fastifys Client-Fehler tragen ihren Code
selbst (413, 400 bei kaputtem JSON, 415), und alle auf 500 zu werfen hieß, dem Aufrufer einen
Serverfehler zu melden, den es nicht gibt — und ihn ins Log zu schreiben.

**Quittiert wird, was ANKAM.** `?seen=1` an `…/imports/pending` hakt alles ab, was gerade
offen ist — brauchbar für eine Ansicht, die sofort alles zeigt. Wer erst meldet und dann
abhakt (die App), holt OHNE und quittiert danach namentlich über
`POST …/imports/seen` mit den IDs. Sonst verschwindet eine Meldung dadurch, dass ein
Hintergrundlauf sie gelesen hat: Genau das passierte, als der Android-Worker mit
`?seen=1` holte und die Benachrichtigung anschließend an einer fehlenden Berechtigung
scheiterte.

**Der `state` ist Pflicht, einmalig und liegt im Speicher.** Ohne ihn ließe sich einem
Angemeldeten ein FREMDES Anbieter-Konto unterschieben (OAuth-CSRF), und ab da liefen fremde
Touren in sein Konto. Keine Tabelle: Er lebt Minuten, und einen Neustart soll er nicht
überleben.

**Polar ist der erste echte Adapter** ([provider/polar.ts](src/tracker/provider/polar.ts)).
Drei Fallen, die man ihm nicht ansieht: Seine Tokens laufen **nicht ab** (kein
`erneuereTokens`, `laeuftAb: null` — ein Ablaufdatum schickte den Kern in eine Erneuerung, die
es nicht gibt); ein zweiter `POST /v3/users` antwortet **409** und das ist beim Neuverbinden
der Normalfall, kein Fehler; und die Startzeit ist **lokale Zeit ohne Zone plus Versatz in
Minuten** — wer `Z` anhängt, verschiebt jede Tour um ihren Zonen-Versatz, und das fällt als
„falsches Licht" auf, nicht als Zeitfehler. Dazu liest der Adapter Feldnamen in BEIDEN
Schreibweisen (`start-time` und `start_time`), weil Polars Doku beide zeigt. Einrichtung
(Client, Token-Schlüssel, Webhook-Registrierung — das Signatur-Geheimnis gibt es nur EINMAL):
[docs/ops/polar-einrichten.md](../docs/ops/polar-einrichten.md).

**Push ist die Zugabe, nicht der Weg** ([push.ts](src/push.ts) für Geräte und
Meldung, [fcm.ts](src/fcm.ts) für den Versand, Migration 18). Gemeldet wird
ausschließlich ein FERTIGER Import, und zwar AUSSERHALB des try im Importlauf: Ein Fehler
beim Benachrichtigen darf einen gelungenen Import nicht nachträglich zum Fehlschlag machen —
die Tour liegt spielbar im Konto, ob Google sie ausliefert oder nicht. Fünf Dinge, die man
dabei kippt: **Die Nachricht trägt keine Inhalte, nur einen Anlass** (`{typ, tourId,
importId}`) — sie läuft über Googles Server und läge sonst auf dem Sperrbildschirm, und FCM
ist nicht Ende-zu-Ende-verschlüsselt. **Kein `notification`-Block**, nur `data`: Android
zeigte den sonst selbst an, am Quittieren (`…/imports/seen`) vorbei und doppelt zum
periodischen Abruf der App. **Die Adresse ist die FID, nicht der Registrierungs-Token** —
FCM hat ihn mit SDK 25.1.0 (Juni 2026) abgelöst, die v1-API führt `token` als deprecated und
will `fid`; die Spalte heißt trotzdem neutral `token`, weil dort später der
APNs-Gerätetoken steht. **Das Gerät hängt am App-Token** (`ON DELETE CASCADE`): Wer in
„Angemeldete Geräte" ein Telefon abmeldet, erwartet, dass dorthin nichts mehr geht — die App
kann das nicht mehr selbst aufräumen, sie ist gerade ausgesperrt worden. Und **gelöscht wird NUR bei `UNREGISTERED`** — gelesen aus
`error.details[].errorCode`, nicht aus dem HTTP-Status: Googles Tabelle führt
`INVALID_ARGUMENT` (400), `SENDER_ID_MISMATCH` (403) und `THIRD_PARTY_AUTH_ERROR` (401) als
Fehler bei UNS. Wer darauf löscht, räumt bei EINER kaputten Nutzlast die Geräte aller Konten
ab, und es heilt nicht: Die Apps registrieren sich neu, der nächste Versand löscht wieder,
und sichtbar ist nur, dass Push „nicht mehr geht". Die Asymmetrie entscheidet — ein
behaltener toter Eintrag kostet einen vergeblichen Aufruf, ein gelöschter lebender das
Feature. Ohne `MAPTALE_FCM_SERVICE_ACCOUNT` ist das Feature aus
(Route antwortet `push: false`), nicht kaputt — Einrichtung:
[docs/ops/push-einrichten.md](../docs/ops/push-einrichten.md).

**Getestet wird gegen einen erfundenen Anbieter**
([testprovider.ts](src/tracker/testprovider.ts)) — dasselbe Muster wie `FesterGeocoder`
und `FesteWetterQuelle`. Er liegt in `src/` und nicht in `test/`, weil er beweist, dass der
Vertrag ohne Netz erfüllbar ist, und weil sich der erste echte Adapter an ihm misst.

## Konten, Registrierung, Warteliste

**Es gibt zwei Rollen** (`users.role`), keine Rechtematrix: wer verwalten darf und wer seine
eigenen Touren hat. `Benutzer.rolle` hängt an jeder aufgelösten Sitzung und kommt über
`/auth/me` bis in die Oberfläche.

**Wer Admin ist, entscheidet zuerst die Konfiguration.** `MAPTALE_ADMINS` (Default:
Henriks beide Adressen) wird bei JEDEM Start auf die Admin-Rolle gehoben — `hebeAdmins` in
[auth.ts](src/auth/auth.ts). Das ist bewusst eine Boot-Garantie und keine einmalige
Migration: So kann sich niemand aussperren, und ein Konto, das es beim Umstellen noch gar nicht
gab, wird Admin, sobald es angelegt ist. Die Kehrseite: Diese Konten lassen sich in der
Oberfläche NICHT herabstufen oder löschen — die Route lehnt es mit 409 ab, statt es beim
nächsten Neustart still rückgängig zu machen. Dieselbe Sorge deckt zwei weitere Riegel: die
eigene Admin-Rolle ist nicht ablegbar, und der letzte Admin bleibt Admin. Alle drei Regeln
stehen doppelt (Server + `rolleGesperrt`/`loeschenGesperrt` im Modell): Der Server MUSS sie
durchsetzen, die Oberfläche SOLL den Knopf gar nicht erst anbieten.

**Registrierung: ein Schalter, zwei Ebenen.** Die DB-Einstellung `invitation_required`
(Vorgabe AN, [einladungen.ts](src/auth/einladungen.ts)) entscheidet, ob ein Code nötig
ist — sie liegt in der Datenbank und nicht in der Umgebung, weil sie zur Laufzeit umgelegt wird.
Darüber steht weiterhin der harte Env-Riegel `MAPTALE_REGISTRIERUNG_OFFEN`: Ist der zu, hilft
auch ein gültiger Code nicht. `/auth/me` meldet beides AUCH ohne Anmeldung — genau dort, wo das
Registrierungsformular danach fragt, ist niemand angemeldet.

**Eine Einladung ist einmal einlösbar** und bleibt nach dem Einlösen stehen (sie ist die
einzige Stelle, an der später noch steht, wer wen hereingeholt hat). Der Code steht im
Klartext: Er ist ein Türöffner zur Registrierung, kein Kontogeheimnis, und der Admin muss ihn
weitergeben können. Geprüft wird ZWEIMAL — vorab für eine brauchbare Fehlermeldung, und beim
Einlösen nach dem Anlegen über ein bedingtes UPDATE, denn nur dort ist es atomar. Scheitert das
zweite (zwei Anmeldungen mit demselben Code in derselben Sekunde), wird das eben angelegte
Konto wieder zurückgenommen.

**Die Registrierung ist zweistufig: erst die Einladung, dann die Person.** Schritt 1 fragt nur
den Code und prüft ihn über `POST /api/auth/check-invitation` — rein lesend, eigene Bremse
(12 Versuche je 10 min), verbraucht nichts. Erst danach kommt das Formular — und das fragt
**nur E-Mail und Passwort**: Jedes weitere Pflichtfeld kostet Anmeldungen, und für ein Konto
gebraucht wurde der Name nie. `users.name` ist trotzdem NOT NULL und trägt zwei sichtbare
Dinge (Mail-Anrede „Hallo Mira," und den Konto-Chip, solange im Profil kein Anzeigename
steht) — deshalb leitet `nameAusEmail` ([server/src/auth/auth.ts](src/auth/auth.ts))
ihn aus dem lokalen Teil der Adresse ab: Plus-Zusatz weg, Trennzeichen zu Leerraum, jedes
Wort groß (`mira.wolf@…` → „Mira Wolf"). Eine VORGABE, keine Behauptung — im Profil ist der
Anzeigename jederzeit überschreibbar. Das Feld `name` bleibt in der Route optional: Wer ihn
mitschickt, behält ihn. Der bestätigte Code steht im Formular als grüner Chip mit „Ändern",
sonst wüsste niemand, ob die Einladung angekommen ist. Ohne Einladungspflicht entfällt
Schritt 1 ersatzlos.
`formatiereEinladungscode` ([src/einladungscode.ts](../src/einladungscode.ts)) räumt beim TIPPEN
auf (Versalien, Bindestrich von selbst), statt hinterher zu meckern. Zwei Kanten: Der Einstieg
`#registrieren` von der Landing fällt VOR der `/auth/me`-Antwort an und kennt die Pflicht noch
nicht — `zeigeRegistrierungsmodus` stellt ihn nachträglich gerade. Und ein zwischen Schritt 1
und 2 verbrauchter Code wirft zurück auf Schritt 1, weil nur dort das Feld steht, in dem sich
das beheben lässt. Der Link aus der Verwaltung (`/studio.html#einladung=CODE`) prüft den Code
sofort und überspringt Schritt 1; wie `#verify=`/`#reset=` wirkt er nur beim Laden der Seite,
nicht bei einem Hash-Wechsel in einem offenen Tab.

**Wer keinen Code hat, kommt auf die Warteliste** ([server/src/auth/warteliste.ts](src/auth/warteliste.ts),
[routes/warteliste.ts](src/routes/warteliste.ts)) — die Kehrseite der Einladungspflicht:
Adresse hinterlassen, der Betreiber lädt gezielt nach. Vier Dinge tragen das, und jedes davon
lässt sich „vereinfachen", bis es rechtlich kippt:
**Double-Opt-in** — ein Eintrag zählt erst nach dem Klick in der Bestätigungsmail; ohne ihn
trüge jeder fremde Adressen ein, und der Einwilligungs-Nachweis (Art. 7 Abs. 1 DSGVO, deshalb
Zeitpunkt UND IP beider Schritte in der Zeile) fehlte. Eingeladen wird **nur, wer bestätigt
hat** (409 sonst, doppelt geprüft via `einladenGesperrt`).
**Ein Token für beide Wege** — bestätigen und austragen. Gespeichert ist nur sein Hash, deshalb
bekommt die Einladungsmail einen FRISCHEN (`erneuereToken`): Es gilt immer der Link aus der
jüngsten Mail. Das Austragen läuft nie auf den bloßen Link-Aufruf, sondern über einen Knopf —
Mail-Scanner öffnen Links vorab, und eine Löschung durch einen Scanner wollte niemand.
**Die öffentlichen Routen antworten immer gleich** (`{ok:true}`), egal ob die Adresse neu ist,
schon wartet oder längst ein Konto hat — sonst wären sie eine Auskunft darüber, wer bei Maptale
angemeldet ist. Die Oberfläche zeigt darum denselben Satz.
**Fristen statt Sammlung**: `raeumeAuf` (beim Start und täglich) löscht Unbestätigtes nach 14
Tagen, Wartende nach einem Jahr, Eingeladene 90 Tage nach dem Code.
Ob das Formular überhaupt vor der Tür steht, entscheidet `wartelisteAngeboten` aus DREI Werten
(eigener Schalter, Einladungspflicht, Env-Riegel) — bei offener Registrierung wäre „trag dich
ein, wir melden uns" eine Schikane. `/auth/me` meldet das Ergebnis mit, die Seite rechnet es
nicht nach. Die Fristen stehen auch in [datenschutz.html](../datenschutz.html); wer sie im Code
ändert, ändert dort eine Zusage.


## Newsletter-Einwilligung

Teil A des [Newsletter-Konzepts](../docs/concepts/konzept_newsletter.md) —
[newsletter.ts](src/newsletter.ts) + [routes/newsletter.ts](src/routes/newsletter.ts),
Migration 16. Der Versand selbst (Teil B) ist noch nicht gebaut; was er braucht, liegt
bereit: `empfaenger()` und `newsletterKopfzeilen()`.

**Ein Boolean allein wäre kein Nachweis.** `users.newsletter` trägt den aktuellen Zustand
(der Versand fragt ihn je Empfänger), daneben steht die Historie
`newsletter_consents` mit Zeitpunkt, Zustand, Quelle (`registrierung` · `konto` ·
`abmeldelink`) und Textfassung — Art. 7 Abs. 1 DSGVO. Gespeichert wird ein LABEL
(`konto-2026-08-06`), nicht der Satz; **wer den Wortlaut ändert, hebt das Datum im
Label**, sonst behauptet die Zeile eine Zustimmung zu einem Text, den niemand gelesen hat.
Ein Drift-Wächter ([test/newsletter-einwilligung.test.ts](../test/newsletter-einwilligung.test.ts))
hält die Sätze in `studio.html` und `konto.html` gegen `EINWILLIGUNGSTEXTE` und prüft
zugleich, dass das Kästchen der Registrierung kein `checked` trägt (EuGH C-673/17).

**Der Riegel steht im VERSAND, nicht am Schalter** (`empfaenger()`: `newsletter = 1 AND
email_verified = 1`). Zwischen Registrierung und Klick auf den Bestätigungslink ist die
Adresse nur eine Behauptung — damit ist genau dieser Klick das Double-Opt-in für den
Newsletter gleich mit, und ein Adresswechsel kann keine unbestätigte Adresse beliefern
(die neue landet erst nach dem Klick in `users`, dann schon mit `email_verified = 1`).
**Die Verifikationsmail bleibt werbefrei** — kein Newsletter-Satz, keine
`List-Unsubscribe`-Kopfzeile; ein „Übrigens, unser Newsletter …" machte die
transaktionale Mail selbst zur Werbemail (im Test festgehalten).

**Der Weg hinaus geht ohne Anmeldung** — ein Widerruf muss so einfach sein wie die
Einwilligung (Art. 7 Abs. 3). Der Token ist SIGNIERT (HMAC über die Benutzer-ID mit dem
Cookie-Geheimnis), steht in keiner Tabelle und läuft nicht ab: Eine Frist wäre in der Mail,
die jemand ein Jahr später aus dem Archiv holt, genau dort tot, wo sie gebraucht wird.
Zwei Eingänge — die Seite (`/konto#newsletter-aus=…`, POST auf `/api/newsletter/unsubscribe`)
und der Ein-Klick-Widerruf der Mail-Programme (`/api/newsletter/ein-klick/:token`,
RFC 8058). `newsletterKopfzeilen` liefert beide Kopfzeilen zusammen: Ohne
`List-Unsubscribe-Post` ist die URL nur ein Link, den der Client öffnet. Seit 2024
verlangen Gmail und Yahoo das von Massenversendern — fehlt es, leidet die Zustellbarkeit
ALLER Mails der Domain. `MailNachricht.kopfzeilen` reicht sie bis zu Resend durch, und sie
gehören nur an Werbemails.

**Aufbewahrung: drei Jahre, aber nie die jüngste Zeile.** `raeumeAuf()` (täglich neben der
Warteliste, s. index.ts) löscht überholte Protokollzeilen nach drei Jahren — so lange kann
jemand vorhalten, ohne Einwilligung angeschrieben worden zu sein (§§ 195, 199 BGB). Die
jüngste bleibt immer: Sonst stünde in `users` ein Zustand ohne Herkunft. Mit dem Konto geht
alles (Art. 17). Die Fristen und der Umfang stehen in
[datenschutz.html](../datenschutz.html) (Abschnitte 2, 3, 9, 10) — wer sie im Code ändert,
ändert dort eine Zusage.

## System-Mails

**System-Mails: HTML im Maptale-Look, Texte in der Verwaltung.** Die vier Mails (Bestätigung,
Passwort-Reset, Warteliste bestätigen, Warteliste einladen) gehen als **multipart** raus —
HTML UND Text, immer beide aus DERSELBEN Quelle
([maillayout.ts](src/maillayout.ts) `rendereMail`). Der Text-Teil ist keine Beigabe:
Ohne ihn steigt die Spam-Wahrscheinlichkeit, und die halbe Testsuite zieht ihren Link daraus
(`letzterLink()`). Deshalb steht der Haupt-Link im Text auf einer EIGENEN Zeile — Programme,
die selbst verlinken, schneiden sonst am nächsten Satzzeichen ab, und ein Token mit
angehängtem Punkt löst nichts ein.
Das HTML ist tabellenbasiert mit Inline-Styles, weil Outlook mit Word rendert und Gmail
`<style>`-Blöcke teils verwirft. Drei Dinge, die man dabei „aufräumt" und damit zerstört: Die
Flächenfarbe muss **doppelt** stehen (`bgcolor`-Attribut UND Inline-Style), der Knopf ist eine
Tabelle mit `bgcolor` (der Verlauf ist nur Zugabe — Outlook sieht ihn nie), und das Logo ist
ein **PNG** mit `alt="Maptale"` (`public/branding/mail-logo.png`, Rendering von `logo.svg`,
s. [scripts/gen-logo.mjs](../scripts/gen-logo.mjs)): SVG zeigt kein Mail-Programm, und weil
Bilder oft erst auf Klick geladen werden, ist der Alt-Text so gesetzt, dass an seiner Stelle
die Wortmarke steht.
**Die Texte stehen im Katalog** [mailvorlagen.ts](src/mailvorlagen.ts) — die Tabelle
`mail_templates` hält nur ABWEICHUNGEN. Eine bessere Formulierung im Code erreicht damit alle,
die nichts angepasst haben; „Zurücksetzen" ist folgerichtig ein DELETE, und wer den Standard
von Hand zurücktippt, bekommt ebenfalls die Zeile gelöscht (sonst hinge die Vorlage still vom
Code ab). Bearbeitbar sind die WORTE (Betreff, Überschrift, Absätze, Knopf, Kleingedrucktes),
nicht das HTML: Freies Markup wäre erst im Postfach als kaputt zu sehen, ginge an jeder
Layout-Verbesserung vorbei und wäre ein Eingabefeld, aus dem HTML in fremde Mails fließt.
Platzhalter (`{{name}}`, `{{link}}`, `{{code}}`, `{{leaveLink}}`) sind pro Vorlage
deklariert; `pruefeBausteine` lehnt eine Fassung ab, in der eine Angabe fehlt — eine Mail
ohne ihren Link ist keine Geschmacksfrage, sondern eine Sackgasse. Ein Absatz, der NUR aus
`{{code}}` besteht, wird zur hervorgehobenen Code-Box (ein Feld „Code hervorheben" wäre ein
Formularfeld für etwas, das man am Text schon sieht).
In der Verwaltung (Karte „System-Mails") liegen Felder und **Live-Vorschau** nebeneinander;
gerendert wird die Vorschau vom SERVER (`POST …/vorschau`) — ein zweiter Renderer im Browser
wäre genau die Kopie, die auseinanderläuft. „Testmail" geht **nur an die eigene Adresse** und
trägt `[Test]` im Betreff; ein Empfängerfeld machte aus der Verwaltung ein Versandwerkzeug.

