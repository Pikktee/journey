# Backend (Anreicherungs-Pipeline, Konten, System-Mails)

Diese Datei lädt, sobald unter `server/` gearbeitet wird. Überblick, Deployment und die
Vier-Stellen-Regel der Fortbewegungs-Modi stehen in der [CLAUDE.md](../CLAUDE.md) der Wurzel;
die Bedien-Seite der Overlays in [src/studio/CLAUDE.md](../src/studio/CLAUDE.md).

## Medien und Pipeline

**Ausgeliefert werden ABGELEITETE Fassungen, nicht das Hochgeladene**
([bild.ts](server/src/pipeline/bild.ts)). Aus jedem Foto entstehen beim Rendern zwei Dateien —
`m1.w1920.jpg` (Anzeige, längste Kante 1920) und `m1.t480.jpg` (Kachel für Listen, Zeitleiste,
Pin-Köpfe) —, danach wird das **Original verworfen**; bei Video ebenso, sobald `m1.web.mp4`
steht. An einer echten Tour: 26,5 MB Originale → 3,1 MB Fassungen, ohne sichtbaren Unterschied
in der Wiedergabe. Vier Dinge, die man dabei leicht zerstört:
*Die Reihenfolge* — erst schreiben, dann löschen; wer die Quelle vorher wegnimmt, verliert bei
einem Abbruch beides. *Der Wiedereintritt* — jeder Re-Render läuft ohne Original, `bereiteFotosAuf`
und `bereiteVideosAuf` müssen die vorhandene Fassung als Quelle nehmen statt zu scheitern. *Der
Vollständigkeits-Check* im finalize ([tours.ts](server/src/routes/tours.ts)) zählt Original ODER
Fassung, sonst meldet jeder App-Retry „Medien fehlen". Und *das EXIF*: ffmpeg wirft es beim
Skalieren weg, der Studio-Editor liest die Aufnahme-Details aber aus der ausgelieferten Datei —
deshalb wird der Exif-APP1-Block von Hand übertragen und seine Drehung dabei auf 1 gesetzt (die
steckt jetzt in den Pixeln; bliebe die Angabe stehen, drehte der Browser ein zweites Mal). Die
Kachel bekommt bewusst kein EXIF: der Block eines Testfotos war 42 KB, mehr als das Bild selbst.
Bestandstouren stellt ein Start-Durchlauf um ([bildnachtrag.ts](server/src/pipeline/bildnachtrag.ts),
ohne Re-Render, also ohne neue Wetter-/Vision-Aufrufe). **`thumb` kann fehlen** — jede Anzeige
braucht den Rückfall auf `src`. Die App verkleinert schon vor dem Upload auf 2560 px
([Fotoaufbereitung.kt](android/app/src/main/java/app/maptale/kamera/Fotoaufbereitung.kt)) — bewusst
größer als die Anzeige-Fassung, denn der Server rechnet aus DIESER Datei.

**Vier Feinheiten der Pipeline, die man leicht „repariert":**

1. **Der Nutzertext eines Fotos wird die ÜBERSCHRIFT**, nicht die Unterzeile: `edits.caption`
   (Oberfläche: „Titel") landet im Tour-JSON als `title`, die Uhrzeit rutscht als „Foto ·
   14:32" darunter ([enrich.ts](server/src/pipeline/enrich.ts)). Ohne Beschriftung bleibt es
   umgekehrt. Der Feldname `caption` ist historisch — wer den Text „zurück an seinen Platz"
   schiebt, macht die Überschrift wieder zur Maschinenangabe.
2. **Gehabschnitte trennt der Server selbst** ([tempo.ts](server/src/pipeline/tempo.ts)):
   Rolling-Median über ±30 s, Hysterese 5,5/8 km/h, Mindestdauern gegen Ampel-Fehlalarme. Sie
   läuft in `ladeOriginalSegmente` — der einen Stelle, die sich Editor und Render teilen;
   nur beim Rendern angewandt, zeigte der Editor eine andere Aufteilung als das Video.
   `edits.modi` wird darübergelegt und behält Vorrang; mehrere Segmente im Manifest bleiben
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
   ([schienen.ts](server/src/pipeline/schienen.ts)): Moped, Jeep und Tram sind am Tempo nicht
   auseinanderzuhalten, die Automatik hebt eine Aufnahme ohne Angabe deshalb höchstens auf
   „Rad". Wer über ≥ 500 m zu ≥ 85 % im 30-m-Korridor um `railway=tram/light_rail` bleibt,
   saß in der Straßenbahn — abgefragt per Overpass (OSM). Die drei Schwellen stehen als
   `MIN_STRECKE_M`, `ANTEIL` und `KORRIDOR_M` in der Datei und wurden an einer echten
   Stadtfahrt kalibriert (`5f15531`); wer sie im Kopf hat, prüft sie dort nach. Drei Schutzregeln: Das läuft nur bei
   `frisch` (finalize/„Neu verarbeiten", also nie bei einem Edit-Speichern), nur wenn die
   Fortbewegung überhaupt GERATEN wurde (`trackMode` leer und alles `walk`), und nur solange
   `edits.modi` leer ist — eine im Studio gezogene Kante wird nie überstimmt. Das Ergebnis geht
   als Modus-Grenzen ins **Overlay**, nicht ins Tour-JSON: dort ist es sichtbar und
   korrigierbar (dasselbe Muster wie die Auto-Musikwahl). Fällt OSM aus, bleibt es bei „Rad" —
   eine Anreicherung, kein Muss.

   Erkennt die **App** die Fortbewegung selbst (Activity Recognition, s.
   [android/CLAUDE.md](android/CLAUDE.md)), schickt sie fertige Abschnitte und setzt
   `modiAutomatisch` im Manifest. Nur dieses Feld unterscheidet „erkannt" von „angegeben" —
   `walk` heißt in der App beides. Ein Fahrzeug schickt sie als `jeep`; welches es war, klärt
   auch dort erst der Schienenabgleich.
3. **Eine Pause wird GERAFFT, nicht herausgekürzt** ([zeit.ts](server/src/pipeline/zeit.ts),
   `raffePausen`): Überall gilt die echte Aufnahmezeit, nur um die Pause herum liegt ein
   schmales Streckenfenster, in dem die Zeit im Schnelldurchlauf vergeht — der Himmel dreht
   dort sichtbar von Dämmerung auf Nacht. Bis Juli 2026 wurde die Pause stattdessen auf zwei
   Minuten gestaucht; das nahm den Ruck, ließ aber ALLES Folgende um die Restdauer
   zurückhängen. An einer echten Tour endete die Telemetrie deshalb um 20:51, während die
   Fotos derselben Minuten schon „22:48" untertitelt waren. Das Fenster wird in FILMsekunden
   bemessen ([filmtempo.ts](server/src/pipeline/filmtempo.ts) — der Server kennt seit dem
   die Tempo-Tabelle der Engine, mit Drift-Wächter), nicht in Metern: 200 m sind zu Fuß vier
   Sekunden und auf der Fähre eine halbe. Und es wächst mit der Pausendauer, sonst zuckte
   das Licht bei zwei Stunden genauso schnell wie bei zwanzig Minuten. Der Player braucht
   dafür nichts: `createTimeAt` interpoliert linear in `f`, eine steile Stützstellen-Flanke
   IST der Zeitraffer — und weil der Sonnenstand pro Frame aus der Pseudo-Zeit gerechnet
   wird, ist er auch beim Scrubben deterministisch.
4. **Ein Video wird neu geschrieben, sobald sein Index hinten liegt**
   ([video.ts](server/src/pipeline/video.ts)): Android schreibt jede Aufnahme über den
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


## Konten, Registrierung, Warteliste

**Es gibt zwei Rollen** (`users.rolle`), keine Rechtematrix: wer verwalten darf und wer seine
eigenen Touren hat. `Benutzer.rolle` hängt an jeder aufgelösten Sitzung und kommt über
`/auth/me` bis in die Oberfläche.

**Wer Admin ist, entscheidet zuerst die Konfiguration.** `MAPTALE_ADMINS` (Default:
Henriks beide Adressen) wird bei JEDEM Start auf die Admin-Rolle gehoben — `hebeAdmins` in
[auth.ts](server/src/auth/auth.ts). Das ist bewusst eine Boot-Garantie und keine einmalige
Migration: So kann sich niemand aussperren, und ein Konto, das es beim Umstellen noch gar nicht
gab, wird Admin, sobald es angelegt ist. Die Kehrseite: Diese Konten lassen sich in der
Oberfläche NICHT herabstufen oder löschen — die Route lehnt es mit 409 ab, statt es beim
nächsten Neustart still rückgängig zu machen. Dieselbe Sorge deckt zwei weitere Riegel: die
eigene Admin-Rolle ist nicht ablegbar, und der letzte Admin bleibt Admin. Alle drei Regeln
stehen doppelt (Server + `rolleGesperrt`/`loeschenGesperrt` im Modell): Der Server MUSS sie
durchsetzen, die Oberfläche SOLL den Knopf gar nicht erst anbieten.

**Registrierung: ein Schalter, zwei Ebenen.** Die DB-Einstellung `einladung_pflicht`
(Vorgabe AN, [einladungen.ts](server/src/auth/einladungen.ts)) entscheidet, ob ein Code nötig
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
den Code und prüft ihn über `POST /api/auth/einladung-pruefen` — rein lesend, eigene Bremse
(12 Versuche je 10 min), verbraucht nichts. Erst danach kommt das Formular — und das fragt
**nur E-Mail und Passwort**: Jedes weitere Pflichtfeld kostet Anmeldungen, und für ein Konto
gebraucht wurde der Name nie. `users.name` ist trotzdem NOT NULL und trägt zwei sichtbare
Dinge (Mail-Anrede „Hallo Mira," und den Konto-Chip, solange im Profil kein Anzeigename
steht) — deshalb leitet `nameAusEmail` ([server/src/auth/auth.ts](server/src/auth/auth.ts))
ihn aus dem lokalen Teil der Adresse ab: Plus-Zusatz weg, Trennzeichen zu Leerraum, jedes
Wort groß (`mira.wolf@…` → „Mira Wolf"). Eine VORGABE, keine Behauptung — im Profil ist der
Anzeigename jederzeit überschreibbar. Das Feld `name` bleibt in der Route optional: Wer ihn
mitschickt, behält ihn. Der bestätigte Code steht im Formular als grüner Chip mit „Ändern",
sonst wüsste niemand, ob die Einladung angekommen ist. Ohne Einladungspflicht entfällt
Schritt 1 ersatzlos.
`formatiereEinladungscode` ([src/einladungscode.ts](src/einladungscode.ts)) räumt beim TIPPEN
auf (Versalien, Bindestrich von selbst), statt hinterher zu meckern. Zwei Kanten: Der Einstieg
`#registrieren` von der Landing fällt VOR der `/auth/me`-Antwort an und kennt die Pflicht noch
nicht — `zeigeRegistrierungsmodus` stellt ihn nachträglich gerade. Und ein zwischen Schritt 1
und 2 verbrauchter Code wirft zurück auf Schritt 1, weil nur dort das Feld steht, in dem sich
das beheben lässt. Der Link aus der Verwaltung (`/studio.html#einladung=CODE`) prüft den Code
sofort und überspringt Schritt 1; wie `#verify=`/`#reset=` wirkt er nur beim Laden der Seite,
nicht bei einem Hash-Wechsel in einem offenen Tab.

**Wer keinen Code hat, kommt auf die Warteliste** ([server/src/auth/warteliste.ts](server/src/auth/warteliste.ts),
[routes/warteliste.ts](server/src/routes/warteliste.ts)) — die Kehrseite der Einladungspflicht:
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
nicht nach. Die Fristen stehen auch in [datenschutz.html](datenschutz.html); wer sie im Code
ändert, ändert dort eine Zusage.


## System-Mails

**System-Mails: HTML im Maptale-Look, Texte in der Verwaltung.** Die vier Mails (Bestätigung,
Passwort-Reset, Warteliste bestätigen, Warteliste einladen) gehen als **multipart** raus —
HTML UND Text, immer beide aus DERSELBEN Quelle
([maillayout.ts](server/src/maillayout.ts) `rendereMail`). Der Text-Teil ist keine Beigabe:
Ohne ihn steigt die Spam-Wahrscheinlichkeit, und die halbe Testsuite zieht ihren Link daraus
(`letzterLink()`). Deshalb steht der Haupt-Link im Text auf einer EIGENEN Zeile — Programme,
die selbst verlinken, schneiden sonst am nächsten Satzzeichen ab, und ein Token mit
angehängtem Punkt löst nichts ein.
Das HTML ist tabellenbasiert mit Inline-Styles, weil Outlook mit Word rendert und Gmail
`<style>`-Blöcke teils verwirft. Drei Dinge, die man dabei „aufräumt" und damit zerstört: Die
Flächenfarbe muss **doppelt** stehen (`bgcolor`-Attribut UND Inline-Style), der Knopf ist eine
Tabelle mit `bgcolor` (der Verlauf ist nur Zugabe — Outlook sieht ihn nie), und das Logo ist
ein **PNG** mit `alt="Maptale"` (`public/branding/mail-logo.png`, Rendering von `logo.svg`,
s. [scripts/gen-logo.mjs](scripts/gen-logo.mjs)): SVG zeigt kein Mail-Programm, und weil
Bilder oft erst auf Klick geladen werden, ist der Alt-Text so gesetzt, dass an seiner Stelle
die Wortmarke steht.
**Die Texte stehen im Katalog** [mailvorlagen.ts](server/src/mailvorlagen.ts) — die Tabelle
`mailvorlagen` hält nur ABWEICHUNGEN. Eine bessere Formulierung im Code erreicht damit alle,
die nichts angepasst haben; „Zurücksetzen" ist folgerichtig ein DELETE, und wer den Standard
von Hand zurücktippt, bekommt ebenfalls die Zeile gelöscht (sonst hinge die Vorlage still vom
Code ab). Bearbeitbar sind die WORTE (Betreff, Überschrift, Absätze, Knopf, Kleingedrucktes),
nicht das HTML: Freies Markup wäre erst im Postfach als kaputt zu sehen, ginge an jeder
Layout-Verbesserung vorbei und wäre ein Eingabefeld, aus dem HTML in fremde Mails fließt.
Platzhalter (`{{name}}`, `{{link}}`, `{{code}}`, `{{austragenLink}}`) sind pro Vorlage
deklariert; `pruefeBausteine` lehnt eine Fassung ab, in der eine Angabe fehlt — eine Mail
ohne ihren Link ist keine Geschmacksfrage, sondern eine Sackgasse. Ein Absatz, der NUR aus
`{{code}}` besteht, wird zur hervorgehobenen Code-Box (ein Feld „Code hervorheben" wäre ein
Formularfeld für etwas, das man am Text schon sieht).
In der Verwaltung (Karte „System-Mails") liegen Felder und **Live-Vorschau** nebeneinander;
gerendert wird die Vorschau vom SERVER (`POST …/vorschau`) — ein zweiter Renderer im Browser
wäre genau die Kopie, die auseinanderläuft. „Testmail" geht **nur an die eigene Adresse** und
trägt `[Test]` im Betreff; ein Empfängerfeld machte aus der Verwaltung ein Versandwerkzeug.

