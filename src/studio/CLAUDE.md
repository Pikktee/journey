# Studio (Editor-Oberfläche)

Diese Datei lädt, sobald unter `src/studio/` gearbeitet wird. Grundlagen zu Player,
Routen-Raum und Modi-Liste stehen in der [CLAUDE.md](../../CLAUDE.md) der Wurzel.

Die Weboberfläche für aufgezeichnete Touren ([studio.html](../../studio.html), Vite-Einstieg;
Logik in [src/studio/](.)). Kein Router — Login-, App- und Editor-Ansicht liegen
gleichzeitig im DOM und werden per `hidden` umgeschaltet; der Editor wird lazy importiert,
damit MapLibre nicht ins Basis-Bundle kommt.

**Die Anmeldebühne setzt erst die Stopps, dann zieht sie den Weg.** Links neben dem
Formular (Anmelden, Registrieren, Reset, Warteliste — alle teilen sie) läuft eine reine
SVG/CSS-Szene: Zuerst **setzen** sich die drei Foto-Stopps als Pins (0,3 s versetzt), danach
zeichnet sich die Route zwischen ihnen (3,4 s), ab 4,6 s fährt ein Läufer sie alle 11 s ab —
mit HALT an jedem Stopp (`keyPoints`/`keyTimes` des `animateMotion`; die Pin-Pulse hängen im
selben 11-s-Takt an ihrer Ankunftszeit). **Auf der Linie bewegt sich sonst nichts:** Der
Lichtpunkt, der die Strecke früher VORWEG abfuhr, und das dauernde Fließen IN der Linie sind
beide gestrichen — zwei Bewegungen auf derselben Spur lesen sich als Unruhe, und die eine, auf
die es ankommt, ist der Läufer. Kein wiederholtes Neuzeichnen: eine Anmeldeseite darf nicht
blinken. Bei `prefers-reduced-motion` bleibt das fertige Standbild. Vier Regeln halten das
zusammen:

1. **Die Pin-Koordinaten kommen AUS der Kurve**, nicht umgekehrt (`getPointAtLength` bei den
   `keyPoints` 0,30 / 0,56 / 0,84). Hingestellte Pins mit geschätzten Bruchteilen ließen den
   Läufer zweistellig daneben halten. Wer die Bruchteile verschiebt, rechnet BEIDES neu: die
   Punkte im Markup und die `keyTimes` (Fahrzeit je Etappe ∝ Streckenanteil, dazu 0,09 Halt)
   samt den Puls-Verzögerungen (4,6 s + Ankunftszeit).
2. **`calcMode="spline"`, nicht `linear`** — je Fahrt-Etappe eine eigene Ease-in-out-Kurve,
   sonst schießt der Läufer bis auf den Pin und steht aus voller Fahrt.
3. **`pathLength="1"` gehört an den `<path>` in `<defs>`, nicht an das `<use>`** — dort ist es
   wirkungslos (der Schattenbaum übernimmt es nicht), und genau deshalb zeichnete sich die
   Route jahrelang gar nicht: `stroke-dasharray: 1` war auf 1517 echten Einheiten nur ein
   Punktmuster. Aufgefallen ist es erst, als der vortäuschende Lichtpunkt wegfiel. Alle
   Strichmaße rechnen seither in Anteilen der Streckenlänge.
4. Der Pfad **umrundet die Textzone** (Mindestabstand 43 Einheiten, gemessen) und bleibt vom
   unteren Rand weg — tiefster Punkt y 738 von 900. Bei y 808 stand er auf der Kante:
   `preserveAspectRatio="slice"` beschneidet an breiten Fenstern die HÖHE, dort fiel der
   Bogen ganz heraus.

Er steht einmal in `<defs>` und wird zweimal benutzt — zeichnen und abfahren. Die
Wortmarke gehört in den **zentrierten Titelblock**, nicht nach oben links: dort steht wie im
Player genau EIN Element, der Weg hinaus. Ihr Text spricht von **Maptale**, nicht vom Studio —
ein Konto braucht auch, wer nur mit der App aufzeichnet (die App verweist zum Registrieren
ausdrücklich auf die Website). Entwurf und die beiden verworfenen Varianten (Tag/Nacht-Himmel,
Feld aus Routen-Signaturen): [docs/mockups/studio-login.html](../../docs/mockups/studio-login.html).

**Jedes Feld sagt, ob es sein muss.** In den vier Auth-Formularen (Anmelden, Registrieren,
Passwort, Warteliste) trägt jedes Label ein Wort: „Pflicht" oder „optional". Sternchen mit
Legende darunter wären kürzer, aber man muss sie erst entschlüsseln; das Wort steht da, wo die
Frage aufkommt. **Beide** Sorten sind markiert, nicht nur die optionale — sonst muss man aus dem
Fehlen schließen, und genau dieses Schließen kostet den Moment Unsicherheit, der Formulare zäh
macht. Die Texte dieser Bereiche kommen ohne Gedankenstrich aus (zwei Sätze statt einem mit
Einschub) und ohne Sätze, die nur die Überschrift wiederholen; die Fehlermeldungen des Servers
gehören dazu, sie erscheinen in denselben Formularen. Beim ANMELDEN hängt am Passwortfeld nur
der Sichtbarkeits-Schalter, keine Stärkeanzeige (`haengePasswortfeld(el, { bewertung: false })`):
Ein bestehendes Passwort zu benoten ändert nichts mehr.

**Die Bibliothek ist die Bühne.** Kacheln mit Titelbild statt Zeilen; über dem Bild liegt die
**Routen-Signatur** — die Form DIESER Tour. Fotos sehen einander ähnlich, Routen nicht.
Sie entsteht beim Anreichern ([server/src/pipeline/signatur.ts](../../server/src/pipeline/signatur.ts))
und liegt als `stats.spur` neben `stats.fotos` in der Tour-Liste; ältere Touren haben beides
erst nach dem nächsten Rendern, die Kachel muss ohne auskommen. Die ganze Kachel spielt ab —
die Taste in der Mitte ist die Ansage dafür, nicht das einzige Ziel; daneben genau zwei Griffe
(Bearbeiten, Sichtbarkeit, letztere zugleich Anzeige UND Umschalter).

**„Neue Tour" steht in der KACHEL, im Kopf nur bei Bedarf.** Der Knopf `#neu-oben` ist
standardmäßig aus und erscheint erst, wenn die Kachel aus dem Sichtfeld gescrollt ist
(`beobachteNeuKachel`, IntersectionObserver mit `rootMargin: -64px` für die überlagernde
Kopfleiste). Beides gleichzeitig war eine Dopplung, und der Knopf war dabei der farbigste
Punkt der Leiste; die Kachel erklärt sich dagegen selbst und ist das Ziel fürs Hineinziehen
von Dateien. Ersatzlos streichen ging trotzdem nicht: Bei einer langen Liste ist die Kachel
oben aus dem Bild, die Leiste klebt. Ohne `IntersectionObserver` (sehr alte Browser) bleibt
der Knopf sichtbar — lieber doppelt als unerreichbar. **Achtung bei der Abnahme:** In der
Browser-Pane feuert `IntersectionObserver` NICHT (sie pausiert den Rendering-Lifecycle,
sobald sie unsichtbar ist; ein Kontroll-Observer meldet dort ebenfalls nichts) — das
Verhalten ist nur in einem echten Fenster zu sehen.

**Neue Tour: erst zeigen, dann hochladen.** Der Upload ist kein Formular mehr, sondern ein
Fenster, das den **Befund** der abgelegten Dateien zeigt ([src/studio/pruefung.ts](pruefung.ts),
DOM-frei und getestet): Streckenform, Zeitspanne, jede Aufnahme an ihrer Uhrzeit — und was
auffiel (ohne Ortsangabe, ohne Zeitstempel, außerhalb der Aufzeichnung). Nur wo es etwas zu
entscheiden gibt, steht ein Knopf („Weglassen").

**Das Fenster ist erst ein Dialog und wird dann eine Arbeitsfläche.** Im Leerzustand trägt es NUR
die Einladung: keine Fußzeile (`.neu-fenster.klein`), also weder „Aufnahmen hinzufügen" (heißt
NACHLEGEN — „Dateien wählen" mitten im Fenster sagt dasselbe größer) noch Sichtbarkeit (entscheidet
über eine Tour, die es noch nicht gibt) noch „Tour bauen" (der Weg dorthin führt ohnehin über den
Befund), und kein gestrichelter Kasten im Kasten — die ganze Fläche IST die Ablage. Mit den ersten
Dateien wächst das Fenster in einem Zug von 560×452 auf 1080×780 (`transition` auf `width`/`height`,
gesteuert von `setzeFenstergroesse`), und der Befund steigt dabei EINMAL mit auf (`.neu-rumpf.wachst`,
Klasse räumt sich beim nächsten Render selbst weg — sonst zuckte die Fläche unter jedem
„Weglassen"). Dazwischen liegt der Zustand „Liest die Aufnahmen" mit füllendem Ring: das Lesen der
EXIF-Blöcke dauert bei dreißig Fotos merkbar, und ohne ihn stand die Einladung still und sprang
dann ohne Ansage. Weil es im Leerzustand keine Fußzeile gibt, trägt `zeigeLeerHinweis` die
Statuszeile („3 Dateien ignoriert") in die Einladung — sonst wäre sie unsichtbar. Der Vorgabewert
der Sichtbarkeit bleibt „Privat", auch solange das Feld aus ist.
**Ohne GPX** werden die Foto-Orte zur Strecke:
das Manifest trägt dann `segments` statt `trackFile` (`baueFotoSegmente`) — deshalb überspringt
[tours.ts](../../server/src/routes/tours.ts) `ladeOriginalSegmente` für solche Touren die
Gehabschnitts-Automatik: zwischen zwei Fotos liegt eine Luftlinie, jedes daraus gerechnete
Tempo wäre Zufall. Die eigene Inszenierung dafür (gestrichelte Bodenlinie, fliegende statt
fahrende Kamera) steht noch aus: [docs/concepts/foto-tour.md](../../docs/concepts/foto-tour.md).

**Rohdaten + Overlay, nie destruktiv.** Der Editor verändert die hochgeladenen Daten nicht,
sondern schreibt ein **Edit-Overlay** (`maptale/edits@1`, [server/src/schema/edits.ts](../../server/src/schema/edits.ts)):
`medien` (Caption, Anker, gelöscht, Anzeigeoptionen, Video-Schnitt), `modi`, `kamera`, `audio`,
`wetter`, `titelbild` (dazu das TOUR-`trim` — im Format erhalten und serverseitig angewandt,
aber **nicht mehr bedienbar**: die Griffe an den Leistenrändern sind entfallen, eine Tour
beginnt und endet, wo sie aufgezeichnet wurde; nicht zu verwechseln mit `medien[].trim`, dem
Video-Schnitt aus Etappe 4).
Beim Speichern rendert der Server die Tour aus Rohdaten + Overlay neu. Edits referenzieren
**stabile Anker** — Medien-IDs, Koordinaten, absolute ISO-Zeitstempel, nie den Streckenanteil `f`.
**Die Schema-ID bleibt `maptale/edits@1`, auch wenn Felder dazukommen:** Erweiterungen sind
strikt additiv, alle neuen Felder optional, ihre Vorgaben bilden das bisherige Verhalten ab.
Bewacht wird das von einem **Vertragstest**
([server/test/vertrag-tourjson.test.ts](../../server/test/vertrag-tourjson.test.ts)), der das
gerenderte `tour.json` für elf echte Overlay-Formen als Schnappschuss festhält — samt einer
Probe, dass die Fälle sich überhaupt UNTERSCHEIDEN (ohne sie könnten elf identische Ergebnisse
grün sein und der Vertrag bewachte nichts).

**Die eine Ausnahme von „nie destruktiv": entfernte Aufnahmen.** `medien[].geloescht` ist seit
dem endgültigen Löschen nur noch der ZWISCHENZUSTAND bis zum Speichern — er hält Undo/Redo am
Leben, während die Datei noch liegt. Beim Speichern werden die markierten Medien wirklich
gelöscht (`DELETE /api/tours/:id/media/:mid`): Rohdatei und alle Fassungen sind weg, der
Speicher ist frei. Wer ein Bild nur „aus dem Film nehmen, aber behalten" will, findet dafür
bewusst KEINEN Schalter — wer es behalten will, hat es in seiner Galerie, und die
Unterscheidung kostete mehr Oberfläche, als sie wert ist. Vier Dinge tragen das:
**Es wird EINMAL gefragt** (`fragtNachLoeschung`, der Speichern-Knopf schärft sich mit der Zahl
darin — Studio-Sprache, kein `confirm()`-Kasten; die Beschriftung davor wird beim SCHÄRFEN
gesichert und nirgends sonst gelesen — beim zweiten Klick steht im Knopf längst die
Löschfrage, ein erneutes `innerHTML` schriebe sie als Ruhezustand fest); **gelöscht wird VOR
dem Overlay**, weil der
Server dabei seine eigene Overlay-Fassung mitstutzt (`medien`-Eintrag, `titelbild`) und ein
danach geschriebenes Overlay toten Zustand zurückschriebe; **`gespeichert` wird mitgezogen**
(`ohneMedien` in [editmodell.ts](editmodell.ts) auch auf den Schnappschuss anwenden), sonst
liefe direkt danach ein Speichern für eine Änderung, die keine mehr ist; und **nacheinander**,
weil jedes Löschen einen Render anstößt und der nächste Aufruf sonst auf „verarbeitung" träfe.
Der Tooltip in der Ablage sagt es dazu — „entfernt" heißt dort: entfernt bis zum Speichern.

**Aufnahmen nachreichen** ([nachreichen.ts](nachreichen.ts) rechnet, `#nach-dialog` zeigt):
Einstieg ist das „+" der Szenen-Spur, unter dem Trenner — als einziger Eintrag wirkt er nicht
„ab der Marke", denn wohin ein Bild fällt, sagt seine eigene Uhrzeit. Der Dialog zeigt erst den
BEFUND, dann den Knopf: ein Streifen mit beidem — was die Tour hat (grau, unter der Achse) und
was dazukommt (hell, darüber, an seiner Uhrzeit). Drei Dinge, die man dabei kippt: Der Streifen
zeigt **Aufnahmezeit, nicht Filmzeit** (die Übersetzung macht der Server beim Neubau; sie
vorher zu zeigen wäre geraten); **„Weglassen" steht nur an Zeilen, die eine Frage stellen** —
die Aufnahme ohne Zeit UND Ort, und selbst die hat mit der Ablage eine brauchbare Vorgabe; und
**die Streifen-Spanne bleibt am ursprünglichen Befund**, damit die Achse nicht springt, sobald
jemand etwas weglässt. Hochgeladen wird über die additive Medien-Route (`POST …/medien`, IDs
vom Server), danach **`reprocess` und kein Edit-Speichern**: Ein neues Foto hat noch keinen
Bildbefund im Anreicherungs-Cache und liefe sonst ohne Wetter-Verfeinerung mit.

**Der Dialog sagt VORHER, was der Server nachher tut** — `ordneEin` bildet
`bestimmePlatzierung` ([server/src/pipeline/placement.ts](../../server/src/pipeline/placement.ts))
Regel für Regel nach, sonst verspricht er Plätze, die es nicht gibt. Zwei Kanten waren genau
so falsch: Ein GPS-Anker gilt nur bis **500 m** an die Strecke (`MAX_ABSTAND_M`, deshalb
bekommt `ordneEin` die Abstandsfunktion aus dem Editor-Track herein), und die Zeitspanne hat
**keine Toleranz** — anders als beim Anlegen (pruefung.ts), wo die Achse erst aus dem Material
entsteht und ein Foto kurz vor dem Start sie DEHNT. Hier steht sie fest; außerhalb findet
`ankerZurZeit` keinen Trackpunkt, und aus „eingeordnet nach ihrer Uhrzeit" würde still die
Ablage.

**Nachreichen ist ganz oder gar nicht — auch im Fehlerfall.** Der POST meldet den Batch auf
einmal an; bricht danach ein PUT ab, nimmt `nimmNachreichenZurueck` die angemeldeten Einträge
per DELETE wieder zurück (nacheinander, jedes Löschen stößt einen Render an). Ohne das blieben
sie ohne Datei im Manifest stehen, und der zweite Klick auf „Hinzufügen" meldete dieselben
Dateien ein zweites Mal an. Scheitert auch das Aufräumen, bleibt der Knopf gesperrt und der
Satz sagt warum — ein Retry wäre dann die Doppelung. **Und der ganze Weg ist erst offen, wenn
nichts Ungespeichertes im Editor steht** (`darfNachreichen`, gefragt vor der Dateiauswahl):
Der Lauf endet mit `ladeDaten`, und das baut den Zustand aus der Server-Fassung neu auf —
samt leerer Undo-Historie. Die Fußzeile verspricht „Deine Schnitte bleiben"; für
ungespeicherte war das vorher das Gegenteil der Wahrheit. Die Ablage-
Aufnahme ist im Streifen ein **Ring, kein zweiter Farbton** — `--warn` und `--akzent` sind
beide Bernstein und nebeneinander nicht zu unterscheiden (gefüllt = sitzt auf der Strecke,
offen = hat noch keinen Ort). `STREIFEN_RAND` in [editor.ts](editor.ts) und
`--streifen-rand` im CSS sind DIESELBE Zahl; laufen sie auseinander, sitzen die Punkte neben
ihrer Achse.
`wetter` (Grenzen `[{ab, mode, staerke?}]` wie `modi`/`kamera`) ist ein Sonderfall: sobald
gesetzt, **ersetzt** es das Auto-Wetter (Open-Meteo + Foto-Verfeinerung) der ganzen Tour
vollständig — bewusste Korrektur, wenn das automatische Wetter danebenlag. `wetterAusOverlay`
([server/src/pipeline/weather.ts](../../server/src/pipeline/weather.ts)) baut daraus eine
Stufenfunktion; Marken-PAARE auf demselben `f` legen die Umschaltung (Player: Mitte zweier
Marken) exakt auf die Grenze. Rein render-seitig → der Anreicherungs-Cache bleibt gültig
(ein Wetter-Edit löst keine externen Aufrufe aus).

**Die Wetterspur zeigt das echte Wetter, nicht das Wort „automatisch".** Weil das Overlay das
Auto-Wetter vollständig ersetzt, hätte die erste eigene Grenze früher den Rest der Tour
schlagartig klar gemacht. Deshalb liefert `/api/tours/:id/editor` das **ermittelte** Wetter als
Zeitgrenzen mit (`autoWetter`): `wetterZuGrenzen` ist die Umkehrung von `wetterAusOverlay` —
Keyframes → Grenzen, die Bandkante auf die MITTE zweier Marken (dort schaltet `weatherAt` im
Player), `f` → Zeit über `zeitZurPosition`. Quelle ist das gerenderte `tour.json` (enthält die
Foto-Verfeinerung), ersatzweise `wetterRoh` aus dem Anreicherungs-Cache; rein lesend, keine
externen Aufrufe. Der Editor zeigt diese Grenzen als normale Bänder und schreibt sie beim
ERSTEN Eingriff ins Overlay (`schreibeWetterFest`) — genau das Muster von `materialisiereModi`
bei der Fortbewegung. Die Kamera-Spur bleibt dagegen ohne Vorgabe: ihr Grundband heißt
**„Standard"**, weil dort gilt, was der Zuschauer im Player einstellt (Nah/Mittel/Weit).

**Eine neue Tour bekommt Musik, aber nur einmal.** Beim ERSTEN Verarbeiten (`finalize`, erkannt
am Status VOR dem Claim → `erstmals` in `verarbeite`) wählt
[musikwahl.ts](../../server/src/pipeline/musikwahl.ts) aus Uhrzeit, Wetter, Höhen, Fortbewegung und
Breitengrad ein Stück der Bibliothek und schreibt es ins **Overlay** — nicht direkt ins
Tour-JSON, denn dort wäre es im Studio unsichtbar und unabänderlich. Reihenfolge der Regeln
(erste gewinnt): Nacht → Nachtfahrt, nasses Drittel → Regentag, Höhenmeter/Höhe → Bergpass,
Fähre → Küstenstraße, Wendekreise → Tropen, Abendankunft → Goldene Stunde, ≥ 60 km → Fernweh,
sonst Aufbruch. **Nur beim ersten Mal**: `reprocess` rendert ebenfalls `frisch`, rührt das
Overlay aber nicht an — wer die Musik entfernt, bekommt sie nicht zurück, und eine selbst
gesetzte Spur wird nie überschrieben (beides als Vertrag getestet). Der Server kann
`sfxbibliothek.ts` nicht importieren (eigener `rootDir`) und führt die Dateinamen ein zweites
Mal; ein Drift-Wächter prüft, dass jede davon im Katalog steht und Musik ist.

**Die Audio-Bibliothek „Musik & Effekte" ist benutzerweit.** Eigene Dateien landen NICHT
mehr tour-lokal, sondern in der Bibliothek des Kontos (`<userId>/audio/` im benutzerStorage,
[server/src/routes/bibliothek.ts](../../server/src/routes/bibliothek.ts)): einmal hochgeladen, in
jeder Tour einsetzbar (`quelle: 'benutzer'` im Overlay), zur Quota zählend, löschbar nur
solange KEINE Tour sie referenziert (edits.json ODER gerendertes tour.json). Ausgeliefert
wird über die Tour (`/api/tours/:id/bibliothek-audio/:datei`, Sichtbarkeit + Referenz-Check
— sonst wäre die Route ein Orakel über fremde Bibliotheken); das Studio hört über die
Owner-Route `/api/audio-bibliothek/:datei` vor. Tour-lokale `media/`-Audios bleiben als
Altbestand unterstützt (Verweis ohne `quelle`). Im Studio ist die Bibliothek ein **Katalog
zum Durchhören** in einem Dialog mit FESTEM Format (springt beim Filtern nicht): Suche über
die GANZE Bibliothek (Reiter treten zurück), Reiter nach Art (Musik · Atmosphäre · Effekte ·
Eigene, bewusst kein „Alle"), dichte Zeilen; die Kategorie bestimmt beim Einsetzen die
ROLLE (Musik/Atmosphäre → Filmmusik, Effekte → Ton der Szene) und mit ihr die Loop-Vorgabe.
Was läuft,
zeigt eine mitlaufende Linie plus Zeit aus `currentTime`/`duration`; der Fortschritt wird IN
die Zeile geschrieben, nie durch Neubau der Liste. Der Dialog kennt zwei Ziele: EINSETZEN
(neuer Eintrag ab der Marke) und ERSETZEN („Ändern …" in der Stück-Karte des Panels —
tauscht nur die Datei, Platzierung und Lautstärke bleiben; das aktuelle Stück trägt ein
„Aktuell"-Badge). Beim Aussuchen klingt immer nur EINE Quelle (Bibliotheks- und
Panel-Vorhören stoppen einander; das Panel-Vorhören folgt der Eintrags-Lautstärke live am
Regler). ÜBERLAPPENDE Klips sind erlaubt und MISCHEN sich — im Player (je Spur ein
Element, audiotracks.ts) wie im Studio-Abspielen (je Klip ein Element, abspielen.ts); die
Zeitleiste stapelt sie in Unterzeilen (`lane` aus `loeseTonKlips`), die Bahn wächst mit.

**Ein Ton-Klip hängt an der REISE, nicht an einer Filmsekunde** (Etappe 4, rechnende Teile
DOM-frei in [src/studio/tonklip.ts](tonklip.ts)). Er merkt sich `anker`
(Aufnahmezeit — wo auf der Reise), `versatzFilmS` (die Feinlage in FILMsekunden, darf mitten
in einer Standzeit liegen — was reine Aufnahmezeit nicht ausdrücken kann), `dauerFilmS`,
`einstiegS` (Einstieg in die Datei) und `loop`. Dadurch rückt Ton mit, wenn Standzeiten oder
die Fortbewegung sich ändern — vorher war er das einzige Element, das liegen blieb (gemessen:
Standzeit +24,5 s → der Klip dahinter +116,0 px, der davor exakt 0 px). Alle Felder sind
optional und `ab`/`bis` bleiben als Fallback lesbar; **aufgewertet wird nur der Klip, den man
ANFASST** — anders als bei `materialisiereModi`, wo die ganze Stufenfunktion auf einmal fest
werden MUSS, sind Ton-Klips unabhängige Objekte. **Zwei Trimm-Regeln gehen leicht verloren:**
Der Anschlag ist an BEIDEN Kanten das MATERIAL (Trimmen legt frei, was da ist, und erfindet
nichts; Stille gehört ZWISCHEN die Klips, nie in einen), und **Loop hebt nur den RECHTEN
Anschlag auf** — `el.loop` springt am Dateiende auf den DATEIANFANG, eine Wiederholung davor
gibt es nicht. Die linke Kante bewegt Anfang UND Einstieg gemeinsam (FCPX): der Inhalt bleibt
an seinem Platz im Film, vorne fällt etwas weg. Am Anschlag sagt das Etikett „kein Material
mehr" — eine Kante, die kommentarlos stehen bleibt, liest sich als hakender Griff.
Loop ist eine **Einstellung im Inspector**, auf dem Klip nur das ⟲-Zeichen: als Schalter dort
wäre sie eine Ausnahme, die Lautstärke und Dateiwechsel nicht auch bekommen könnten. **Loop
AUSschalten holt den Klip ans Material zurück** (`setzeLoop`) — sonst hinge hinter der
Wellenform ein stummer Rest, und man müsste ihn von Hand zurechtziehen, um überhaupt zu sehen,
wo sein Material endet.

**Ein EINGESETZTES Stück klingt einmal, so lang wie es ist** (`setzeTonEin`): kein Loop, Länge
= Dateilänge. Beides gehört zusammen — „nicht wiederholen" allein ließe einen Musik-Klip
entstehen, der bis zum Tour-Ende reicht und nur seine Dateilänge klingt, also genau den stummen
Rest, den `setzeLoop` behebt. Ein EFFEKT braucht dafür kein einziges Feld (er wiederholt von
Haus aus nicht und ist ohnehin so lang wie seine Datei); geschrieben wird nur, was von der
Vorgabe der Rolle abweicht. Gemessen wird VOR dem Einfügen — so entsteht genau EIN
Overlay-Stand (ein Undo-Schritt) und der Klip steht sofort in seiner endgültigen Form da,
statt nach dem Erscheinen zu zucken. Ohne messbare Länge bleibt es bei der Vorgabe: `loop:
false` ohne bekanntes Ende erzeugte wieder den stummen Rest. **Die Auto-Musikwahl des Servers
([musikwahl.ts](../../server/src/pipeline/musikwahl.ts)) ist davon nicht betroffen** — sie schlägt
ein Stück vor, das die GANZE Tour tragen soll, und schreibt weiter nur `datei`/`typ`/`ab`.

**`musik` vs. `sfx` beschreibt seit Etappe 4 die ROLLE, nicht die Form.** Beide sind Klips mit
Länge, beide können wiederholen, beide mischen sich — die Beschriftung „Musik (über eine
Strecke) / Effekt (ein Zeitpunkt)" war eine Aussage über eine Form, die es nicht mehr gibt.
Was der Unterschied noch bewirkt, sind genau zwei Dinge im Player, und beide fragen dasselbe
(„Score oder Ort?"): Der Zuschauer-Schalter **„Musik"** nimmt `type: 'music'` weg und lässt
den Ton der Szene stehen (`main.ts`, `setMusikEnabled`/`setSfxEnabled`), und unter dem eigenen
Ton eines Videos **duckt** nur die Musik. Deshalb heißt das Feld in der Oberfläche „Rolle"
(Filmmusik · Ton der Szene). Beim Umschalten kippen zwei Dinge leicht still: `bis` fiel früher
ersatzlos weg (die Länge geht jetzt vorher nach `dauerFilmS`), und die Loop-VORGABE hängt an
der Rolle — `loopNachRollenwechsel` schreibt den bisherigen Wert fest, wo die neue Vorgabe ihn
umdrehen würde.

**Die Zeitfelder des Ton-Inspectors gehen über die FILM-Achse**, nicht über `ab`/`bis`. Nach
der Aufwertung haben die keinen Vorrang mehr: Ein Feld, das dorthin schriebe, wäre ab dem
ersten Kantenzug still wirkungslos, und ein Feld, das von dort läse, zeigte eine Zeit, die im
Film nichts mehr bedeutet (an der Probetour 08:37 statt 08:32). Deshalb bekommt
`loeseFokusAuf` die Ton-Spanne als Rückruf herein (das Modul kennt die Achse nicht) und
`audioZeitSetzen` ruft dieselben `verschiebeTon`/`trimmeRechts` wie der Zug an der Kante —
samt Materialanschlag.

**Ein Effekt war nie eine Marke — die LEISTE hat ihn nur so gezeichnet.** Der Player spielt
einen One-Shot bis zum Dateiende aus; als Punkt gezeichnet verschwieg die Zeitleiste bloß, wie
lange er klingt. Er ist deshalb derselbe Klip wie Musik, nur in seiner Farbe. Die Dateilängen
stehen NIRGENDS im Datenmodell (der Katalog führt Namen und Charakter, keine Sekunden) — der
Editor misst sie clientseitig per `loadedmetadata` (`preload='metadata'`, höchstens ein
Versuch je Datei). Bis ein Wert da ist, bleibt der Klip ein Pin und die Kante ohne Anschlag:
lieber ziehen lassen als grundlos klemmen. Die **Wellenform** gehört ebenfalls zur DATEI, nicht
zum Klip: voller Datei-Streifen dahinter, um den Einstieg nach links geschoben, Wiederholung
nur bei Loop — beim Trimmen wandert dadurch der AUSSCHNITT und man sieht, was wegfällt
(gestaucht sähe jeder Trim wie ein Tempowechsel aus). Gezeichnet wird sie aus ECHTEN
Ausschlägen (`decodeAudioData`, Spitze je Balken statt Mittel), nicht aus einem Muster: eine
erfundene Wellenform sähe aus wie eine Aussage über den Inhalt und wäre keine. Ihr Fenster
braucht ein eigenes `overflow: hidden` — am Klip selbst schnitte es die überstehenden
Kanten-Griffe weg und Anfang/Ende wären nicht mehr zu greifen.

**Und ihre Maße stehen in ANTEILEN der Achse, nie in Pixeln** (`wellenLage` rechnet gegen
`gesamtFilmS`, `zeitBreite()` schreibt `calc(anteil * var(--zeit-breite))`). Das ist die
allgemeine Regel für alles, was auf der Leiste eine LÄNGE hat — `zeitX` ist ihr Gegenstück für
eine STELLE: **Zoomen baut die Bahnen nicht neu**, `setzeMassstab` schreibt nur `--zeit-breite`
fort und lässt CSS den Rest rechnen. Feste Pixel frieren ein Element auf dem Maßstab des
letzten Renders ein; die Wellenform behielt dadurch beim Hineinzoomen ihre Größe und endete
weit vor dem Klip. Der Fehler ist von außen kaum als solcher zu erkennen — er sieht aus wie
eine zu kurze Datei.


**Arbeitsteilung im Code.** [src/studio/editmodell.ts](editmodell.ts) (Overlay
immutabel fortschreiben, Track-Projektion), [src/studio/zeitleiste.ts](zeitleiste.ts)
(Skalen, Bänder, Marken, Dauerschätzung), [src/studio/stopps.ts](stopps.ts)
(Halt-Gruppierung) und [src/studio/tonklip.ts](tonklip.ts) (Ton-Klips auf der
Filmachse: auflösen, verschieben, trimmen) sind **DOM-frei und unter Vitest getestet**;
[src/studio/editor.ts](editor.ts) enthält nur DOM- und MapLibre-Verdrahtung.
Neue Editor-Logik gehört in diese Module, sonst ist sie nicht testbar.

**Im Studio gibt es kein Mono.** Zeiten, Kilometer, Zähler und Skalenmarken laufen in Outfit mit
`font-variant-numeric: tabular-nums` (DESIGN.md). Die Variable `--font-mono` ist **entfernt** —
wer sie aus Gewohnheit wieder schreibt, bekommt keinen Fehler, sondern still die geerbte
Schrift; und der IBM-Plex-Mono-Webfont wird von [studio.html](../../studio.html) nicht mehr geladen.
Versalien sind nur da richtig, wo sie die Sache selbst sind (Initialen im Profil-Chip,
Datei-Endung „MP3") — nicht als gesperrtes Etikett über einer Zeile.

**Zeitleiste: fünf Bahnen, von oben nach unten Szenen · Musik & Effekte · Fortbewegung ·
Kamera · Wetter** auf gemeinsamer Zeitachse. Oben das MATERIAL (Klips mit Anfang, Ende und
Trimm-Kanten), unten der KONTEXT als ruhiger Sockel (lückenlose, beschriftete Bänder — Anfang
und Ende eines Zustands sind dieselbe Kante, gezogen wird die Kante selbst). Bild oben, Ton
darunter ist die stärkste Konvention in Schnittprogrammen; Musik auf einen Schnitt
auszurichten ist die häufigste Feinarbeit und darf nicht über drei Bahnen springen. Der
Abspielkopf liegt als Overlay über allen Bahnen (absolut positioniert, **nicht** als
Grid-Item: ein Item mit `grid-row: 1/-1` belegt die ganze Spalte und drängt die Bahnen weg).

**Die Bahn heißt „Szenen" und trägt auch die Momente** — eine eigene Spur „Momente" gibt es
nicht mehr (Nachtrag zu Etappe 2). Ein Moment hält den Film an wie ein Foto, er hat nur kein
Bild: derselbe Klip, an der Stelle der Miniatur ein Muster in Koralle. Eine eigene Bahn dafür
unterschiede nach HERKUNFT statt nach Wirkung — und eine Bahn, die ihre Dateitypen aufzählt
(„Fotos/Videos"), kann einen Moment gar nicht aufnehmen, ohne dass die Beschriftung lügt.
Sein rechter Griff zieht die Dauer (wie die Standzeit eines Fotos, Grenzen 1–30 s). Anders
als früher schreibt sein Zug NICHT mehr live: Seit er Achsenbreite hat, läge um seine
Ruhelage sonst eine tote Zone von seiner eigenen Breite — er zieht über eine Achse ohne sich
selbst und schreibt einmal beim Loslassen. Alle Achsen-Halte (Aufnahmen-Ketten UND Momente)
baut `achsenHalte()` an einer Stelle.

**Fortbewegung · Kamera · Wetter sind drei GLEICHRANGIGE schmale Bahnen** (21 px, Etappe 3
des [Zeitleisten-Umbaus](../../docs/architecture/zeitleiste-umbau.md)). Sie beschreiben, wie das
Dazwischen aussieht — bei einer typischen Tour zwei bis drei Entscheidungen, die vorher drei
randvolle Bahnen belegten und mit den Szenen um Fläche konkurrierten: Material verdient Fläche,
Kontext verdient eine Zeile. Verworfen (mit Nutzer-Feedback): sie unter „Reise"
zusammenzuklappen, Kamera/Wetter als Unterspuren zu führen, Wechsel-Marken statt Bändern und
eine blass/kräftig-Unterscheidung Automatik vs. Entscheidung. **Ein Band ist KEIN Klip:** keine
Rundung, kein eigener Rahmen, keine Rille in der Bahn — ein durchgehender Streifen, der an den
Grenzen die Farbe wechselt (Klips haben Lücken dazwischen, ein Zustand hat kein „dazwischen").
Der Griff ist EIN Riegel auf der Fuge (3 px, dunkler Ring, hover/Zug orange) und **immer
sichtbar** — als Haarstrich fand man ihn erst beim Darüberfahren; zwei Backen oben und unten
lasen sich auf einer so schmalen Bahn als Bildfehler.

**Im Zug wird die Leiste fortwährend in den ZIELZUSTAND gesetzt.** Jeder Zieh-Frame schreibt
die Grenze und baut die Leiste neu auf: Klips, Bänder und Marken rücken mit, die Filmdauer in
der Kopf-Uhr wächst mit. Das ist nicht Kosmetik, sondern die Bedingung dafür, dass Zielen und
Landen im selben Bild stattfinden. Zeigte die Leiste während des Zugs die ALTE Anordnung, konnte
eine Rast-Vorschau nur eines von beidem sein — den Halt, auf den man zeigt, oder die Stelle, an
der die Kante landet (sie liegen bis zu 159 px auseinander). Beide Fassungen wurden gebaut und
beide waren falsch. Möglich ist der Live-Aufbau erst durch die EXAKTE Umrechnung (s. u.): Die
Kante steht nach jedem Neuaufbau wieder unter dem Zeiger (gemessen 0,1 px); mit der Achse des
Vorframes sprang sie um 116 px, und genau deshalb war der Zug zwischenzeitlich entkoppelt.
Gemessen kostet ein Zieh-Frame 5,5 ms im Median (335 Trackpunkte, 12 Klips) bzw. 4,0 ms
(541 Punkte ohne Medien) — der Editor-Track ist serverseitig auf 5 m vereinfacht
([tours.ts](../../server/src/routes/tours.ts)), aus 9 000 Rohpunkten werden 541.
Ein Undo-Schritt bleibt es: `renderNachZug` schreibt `letzterStand` nicht fort.

**Die Ziellinie ist eine Orientierung durch alle Bahnen** — den ganzen Zug über sichtbar, weil
man beim Setzen einer Grenze wissen will, was dort zeitlich übereinanderliegt. Beim Einrasten
tritt sie hervor (lila) und das Etikett nennt den Grund; sonst bleibt sie ein Haarstrich, der
den orangen Riegel nicht überdeckt. Das Etikett steht immer und trägt Filmzeit, Uhrzeit und bei
der Fortbewegung die Folge für die Filmlänge („Film 4:53 → 5:05").
**Eingerastet wird über ±0,5 s AUFNAHMEzeit**, nicht über Filmsekunden — 0,01 Filmsekunden
schmolzen auf dem Rückweg durch die Achse auf ein halbes Tausendstel und verloren gegen die
lower_bound-Konvention (bis 71 px daneben); „dahinter" braucht dabei einen Zeitstempel STRIKT
nach der Haltzeit, und weil Overlay-Anker sekundengenau sind, ist das eine ganze Sekunde. In
einem Halt ist das Rasten keine Bequemlichkeit, sondern die einzige Art, eine Position zu
benennen: Dort gibt es keine Aufnahmezeit, die Rückrechnung fiele auf die linke Flanke.
**Geklemmt wird in PIXELN** (14 px Mindestbreite), nicht in Sekunden: mit ±1 s konnten zwei
Grenzen so nah zusammenrücken, dass das Band dazwischen unsichtbar und unanfassbar wurde.

**Die Fortbewegungs-Grenze liegt auf der Achse, die sie selbst verändert** — im Tempo je Modus
steckt die Filmzeit. Gelöst wird das ANALYTISCH, nicht per Bisektion: Die Filmposition der
Kante hängt nur von dem ab, was VOR ihr liegt (bis zur vorigen Grenze ändert sich nichts,
dazwischen gilt das Tempo des linken Bands — egal wohin man zieht). Also ist die Abbildung eine
feste, stückweise lineare, monotone Funktion, die `baueGrenzKurve` EINMAL beim Zug-Start
aufbaut. Die im Konzept vorgesehene Bisektion (14 Achsenbauten je Frame) wurde vorher gemessen
und verworfen: 0,62 ms bei 335 Trackpunkten, aber **12,5 ms bei 10 000** — über dem 8-ms-Budget;
die Kurve kostet dort 0,2 ms einmal. Dieselbe Rechnung trägt die Filmdauer-Vorschau
(`filmDauerBeiGrenze`): es wechselt nur die Strecke zwischen alter und neuer Lage den Modus.

**Die Kante ist ein Griff, kein eigenes Objekt.** Sie liegt (9 px) ÜBER dem Band und ist dessen
Geschwister, kein Vorfahr — `closest('[data-fokus]')` findet von dort aus nichts, und ein Klick
auf die Kante wählte deshalb gar nichts aus (der Cursor sprang auf „Rand ziehen", und nichts
geschah). `bandUnterZeiger` sucht das Band per `elementsFromPoint`; ziehen verschiebt die
Grenze, bloßes Antippen wählt das Band darunter.

**Während eines Zugs wird NICHTS neu gebaut.** Der Foto-Zug rief pro `pointermove` einen
kompletten Neuaufbau der Leiste (~46 DOM-Änderungen, ein erzwungenes Layout in
`kuerzeBeschriftungen`, frische `img`-Elemente): das Bild zuckte unter dem Finger, die Karte
blieb stehen. Jetzt bewegt der Zug nur die Miniatur und den Kartenpunkt; das Overlay wird beim
Loslassen einmal geschrieben (= genau ein Undo-Schritt). Analog schreibt `zeichneMarker` die
Kartenpunkte **fort** statt sie abzureißen (geschlüsselt nach der Zusammensetzung des Halts) —
sonst wurden bei jedem Klick alle Fotos kurz zu leeren Kreisen.

**Die Achse zeigt FILMZEIT, die Anker bleiben Aufnahmezeit — und gerechnet wird über die
STRECKE.** `baueAchse` ([zeitleiste.ts](zeitleiste.ts)) baut seit Paket D des
[Gleichlauf-Konzepts](../../docs/concepts/konzept_gleichlauf_player_editor.md) keine eigene
Kurve mehr, sondern zwei Dinge: den **Zeit→Strecke-Adapter** (`AchsenKurve`: je Stützpunkt
seine Aufnahmezeit und sein Meterstand) und darüber die geteilte Achse
([src/filmachse.ts](../filmachse.ts), dieselbe, die der Player rechnet). `zeitBeiFilm` geht
seither in zwei Schritten — Film → Strecke → Zeit —, `filmBeiZeit` umgekehrt; die Signaturen
sind dieselben geblieben. Grund ist E12: Der Player braucht Filmsekunde → Streckenposition, und
das kann eine über der Aufnahmezeit parametrisierte Achse nicht liefern. Seit Etappe 4 legt
derselbe Kern auch die **Rampen** hinein (`RAMPE_M`, 120 m an jedem Tempowechsel — am Halt auf
beiden Seiten, an einer Modus-Grenze ganz im schnelleren Abschnitt): Die Filmdauer, die das
Pult zeigt, ist damit die, die der Player wirklich braucht — jede Bestandstour wurde dadurch
auf dem Papier 2,7–7,8 % länger, der Film ist derselbe. Das Zug-Fenster einer
Fortbewegungs-Grenze (`baueGrenzKurve`) braucht dafür zwei Angaben, die es früher nicht
brauchte: `startTempoMs` (mit welchem Tempo der Film das Fenster betritt — am Tour-Anfang aus
dem Stand, sonst mit dem Modus DAVOR, dessen Rampe ins Fenster ragt) und den Modus RECHTS der
Kante (`rampenVersatzS`, nur beim Verzögern von null verschieden). Ohne beides landete die
gezogene Kante um bis zu 0,36 Filmsekunden neben dem Zeiger. Zwei Folgen, die man
kennen muss: Das Tempo-Modell ist **keine Kopie** mehr (`tempoMs` kommt aus `filmachse.ts`, die
Moment-Dauern ebenso), und die alte Mehrdeutigkeit der realen PAUSEN sitzt jetzt bei den
HALTEN — mehrere Halte in derselben Pause haben denselben Meterstand und behalten ihre
Reihenfolge nur, weil sie nach Zeit vorsortiert eingewebt werden. Position auf der Leiste ∝
Filmzeit: gleich breit heißt gleich
lang im fertigen Film — eine Fähre schrumpft auf ihren Filmanteil, ein Foto-Halt bekommt seine
Standzeit als Achsenbreite (Sprung: Zeit steht, Film läuft; bei foto-lastigen Kurztouren IST
der Film überwiegend Standzeit), eine reale Pause fällt fast auf einen Strich zusammen
(Plateau; die GPS-Drift kollabiert zusätzlich serverseitig, s. o.). Das Maßband zählt
Filmminuten („0:30", `baueFilmMassband`, film-linear ⇒ äquidistant); das Pult zeigt
„Filmzeit / Gesamt" prominent, Uhrzeit und km als Nebengrößen. ALLE Overlay-Anker bleiben
absolute Aufnahme-Zeitstempel — nur die Abbildung Zeit ↔ Leistenposition
(`offsetZuAnteil`/`anteilZuOffset` über `Achse`) ist nichtlinear; ohne Kurve (degenerierte
Tour) fällt sie auf linear zurück. Das Abspielen läuft über `baueSpielKurve` (Identität; bei
Alt-Trim Plateaus) und zeigt Aufnahmen als Überfahr-MARKEN im Halt-Sprung (`zeigen`, kein
restS mehr). Eine Kante bleibt: Ereignisse, die ganz in einer Ex-Pause liegen, drängen auf
einen Pixel (Ausweg: Zeitfelder im Inspector).

**Der Abspielkopf steht in FILMsekunden** (`kopfFilmS`, Etappe 1 des
[Zeitleisten-Umbaus](../../docs/architecture/zeitleiste-umbau.md)) — eine Quelle für Scrubben, Klick,
Pfeiltasten und Abspielen; die Aufnahmezeit (`z.auswahl`, zugleich Einfügemarke) wird daraus
ABGELEITET, nie umgekehrt. Der Grund ist die Umkehrbarkeit: In Aufnahmezeit gibt es keinen
Wert für „mitten im Halt" (zwei Stützstellen auf derselben Sekunde), jede Rückrechnung fällt
auf die linke Haltkante. Genau daran klebte der Kopf — 28 von 39 Frames Stillstand, und mit
Pfeiltasten (5 Filmsekunden) kam man an einem 6-s-Halt NIE vorbei. Deshalb gibt `baueAchse`
die Halte als **Intervalle** zurück (`filmVon`/`filmBis`, dazu `stuecke` je Aufnahme und
`indizes` als Rückweg zum Stopp), und `haltBeiFilmS` beantwortet „steht der Kopf in einem
Halt, und wo darin?" (`beschreibeHaltStand`: „Aufnahme 2 von 3 · 2,1 s von 6,0 s") — die
Grundlage der Klip-Kette aus Etappe 2. **In der Kopfleiste steht diese Auskunft NICHT**: Eine
Pille, die beim Scrubben erscheint und verschwindet, verschiebt Uhr, Werkzeuge und
Zoom-Regler daneben — eine Anzeige, die die Bedienelemente springen lässt, kostet mehr, als
sie sagt; dass ein Halt läuft, zeigt ohnehin das eingeblendete Bild auf der Karte. Der
Kopfstrich bleibt immer orange: Farbe bezeichnet auf der Leiste Identität, nicht Zustand.

**Die Kopfleiste hat drei Gruppen, und jede ist eine.** Links die Werkzeuge (Modi), in der
Mitte das **Pult** (`.pult`), rechts der Zoom — alle drei mit demselben Rahmen und derselben
Höhe. Vorher standen links drei Gruppen nebeneinander (Transport, Werkzeuge, Ablage), in der
Mitte eine Tafel und rechts ein rahmenloser Regler: Der Zoom war das einzige Element ohne
Kasten und hing frei am Rand.

Das Pult trägt in **drei Fächern** Bedienen (Transport + „Karte folgt") · Filmzeit ·
Uhrzeit+Strecke. Der Transport steht damit an der Zahl, die er hochlaufen lässt, statt neben
Modus-Umschaltern, mit denen er nichts zu tun hat. Die zweite Fuge trennt **zwei Sorten, nicht
drei Werte**: Die Filmzeit sagt, wo der Kopf im fertigen FILM steht; Uhrzeit und Strecke sagen
beide, was an dieser Stelle der AUFNAHME war — sie teilen ein Fach.

**Weniger ist hier die Gliederung.** Es waren einmal vier Fächer: „Karte folgt" hatte ein
eigenes, weil es weder Transportschritt noch Messwert ist — hinter den Zahlen las es sich wie
einer. Das kostete für EINEN Knopf eine dritte Haarlinie und zwei Polster, und drei Linien auf
458 px lasen sich als Gitter statt als Gliederung. Vor den Zahlen, hinter einer breiteren Fuge
(`margin-left`), kann er mit keiner verwechselt werden. Aus demselben Grund hat die Strecke
**kein Symbol** mehr: „12,4 / 41,8 km" trägt seine Einheit selbst, das Straßen-Icon sagte
dasselbe ein zweites Mal. Das Sonnen-/Mond-Symbol bleibt, weil es **kein Etikett** ist — es
färbt sich nach der Tageszeit und ist damit selbst die Auskunft. Zusammen 458 → 430 px.

Drei Regeln, die man dabei leicht kippt:

- **Amber heißt an der Zeitleiste ausschließlich „läuft gerade".** Play trägt im Ruhezustand
  KEINE Farbe — seinen Vorrang holt er aus Größe und Fläche (34×28 gegen 25×26 der Nachbarn,
  die hellste Fläche der Leiste, der einzige helle Rand, als Einziger volle Textfarbe). Erst
  beim Abspielen kommt Amber dazu, und dann bedeutet es dasselbe wie am eingeschalteten „Karte
  folgt" daneben: **beide voll-amber, wie jeder aktive Umschalter im Studio** (`.wkz.an`).
  Vorher war Play schon in Ruhe amber umrandet; damit war die Farbe verbraucht, bevor sie etwas
  sagen konnte. Umgekehrt war „Karte folgt" kurzzeitig nur amber EINGEFÄRBT, damit Play das
  einzige Farbige im Pult bleibt — zu leise für einen Zustand, den man auf einen Blick erkennen
  muss: Als bloßes Icon war „an" von „aus" kaum zu unterscheiden, und was man dort sah, war
  meist bloß der Fokusring. Aus demselben Grund ist die Ablage-Plakette **rot** und nicht amber:
  Ein Fund läuft nicht, er wartet.
- **Die drei Gruppen sind gleich hoch** (`--kopf-gruppe: 32px`). Vorher standen 30 px
  Werkzeuge neben 34 px Pult und Zoom, und der Zoom las sich dadurch als klobiger rechter
  Rand. **Und die Mitte steht MITTIG**: `.zl-kopf` ist ein `1fr auto 1fr`-Raster, kein
  `space-between` — bei 93 px Werkzeugen gegen 227 px Zoom saß das Pult sonst 67 px zu weit
  links. Im engen Fenster (≤ 960 px) wird daraus wieder eine umbrechende Flex-Reihe; ein
  Raster kann nicht umbrechen, und `flex-wrap` allein täte dort nichts.
- **Reserviert wird nur, was WIRKLICH schwankt.** Die Anzeige trug dreimal denselben
  großzügigen Slot (10,5ch + 11,5ch + 11,5ch) und war dadurch ~180 px breiter als ihr Inhalt.
  Die Uhrzeit hat IMMER fünf Zeichen („15:58", „--:--") und braucht gar keinen; bei der Strecke
  schwankt allein der laufende Wert (`.ku-km-cur`). Bei der Filmzeit setzt `renderPlayhead` die
  Reserve auf die ZEICHENZAHL DES GESAMTWERTS — länger als der Film kann der Kopf nicht stehen,
  kürzer reicht nicht; pauschale 10,5ch waren für „1:15 / 2:52" rund 30 px zu viel, und
  linksbündig sammelte sich der Überschuss vollständig rechts. Aus demselben Grund ist der
  Schnelllauf-Faktor eine `position: absolute`-Plakette AM Play-Knopf: Als eigenes Feld
  reservierte er 24 px, die fast immer leer standen — sichtbar als Loch rechts der
  Transportknöpfe. Beim Zoom-Wert dagegen war zu WENIG
  reserviert: Er läuft 1,0…40,0, also vier ODER fünf Zeichen, und wuchs mit 4ch ab Faktor 10 um
  7 px — weil er am rechten Rand sitzt, schob er die ganze Gruppe. Gemessen braucht er 6,97ch
  (`ch` ist die Breite der Ziffer NULL; Komma und „×" sind schmaler bzw. breiter), gesetzt sind
  7,5ch, zentriert.
- **Anfang/Ende gibt es als Knopf UND als Taste** (Pos1/Ende). Beides fehlte: Wer bei starkem
  Zoom an den Anfang wollte, zog den Abspielkopf über die halbe Leiste. `setzeKopfFilm` klemmt
  selbst auf [0, gesamtS] — „ans Ende" ist deshalb schlicht `Infinity`.

Entwürfe und die verworfenen Varianten:
[docs/mockups/studio-zeitleiste-kopf.html](../../docs/mockups/studio-zeitleiste-kopf.html) (vier
Varianten), [`…-entscheidungen.html`](../../docs/archive/mockups/studio-zeitleiste-kopf-entscheidungen.html)
(Play-Register, Abgrenzung der Zahlenpaare, Ort der Ablage),
[`…-final.html`](../../docs/mockups/studio-zeitleiste-kopf-final.html) (der umgesetzte Stand).

**Die Ablage sitzt an der Szenen-Bahn, nicht in der Kopfleiste.** Dort steht sonst nur, WOMIT
man arbeitet — die Ablage sagt, WAS in der Tour ist, und aus ihr ZIEHT man auf genau diese
Bahn: Quelle und Ziel gehören nebeneinander. In der 168 px schmalen Namensspalte steht die
**Zahl**, der Satz im `title` und in der Kopfzeile des Fachs; ein Satz schöbe das ⊕ aus der
Zeile (es hält `margin-left: auto` und bleibt die letzte Sache darin). Der Puls beim Öffnen der
Tour wird an der kleineren Plakette WICHTIGER als am früheren Knopf mit Satz, nicht entbehrlich.

**Ein Video zählt mit seiner echten Länge, ein Moment mit seiner Dauer.** `aufnahmeHaltS`
ist die eine Formel dafür (Video → `dauerS`, sonst `haltedauerS`); `display.holdS` ist bei
Video wirkungslos, der Player läuft bis zum Dateiende. `dauerS` liefert die Editor-Route aus
drei Quellen (Manifest → Anreicherungs-Cache → tour.json), rein lesend; fehlt alles
(unverarbeiteter Altbestand), bleibt es bei der Foto-Annahme. Vorher bekam ein 34-s-Video
~34 px statt ~200 px, und Momente hatten gar keine Breite — an der Beispieltour 13,6
unsichtbare Filmsekunden. Gemeint ist dabei die Länge des MATERIALS, nicht die des
Ausschnitts (`quellDauerS` vor `dauerS`): daran schlagen die Schnitt-Kanten an.

**Der Maßstab ist px je FILMSEKUNDE** (`pxProFilmS` + `einpassen`), kein Faktor auf die
Fensterbreite. Der Unterschied zählt, weil die Fortbewegung die Filmdauer bestimmt: Im
Faktor-Modell skalierte jede Modus- oder Standzeit-Änderung die GANZE Leiste, auch alles vor
der geänderten Stelle. Jetzt wächst die Achse hinten und links bleibt jedes Pixel stehen
(gemessen: Standzeit +14,8 s ⇒ +82,9 px am Ende, Maßstab unverändert). Beim Öffnen wird
einmal eingepasst (`passeEin`), danach ändert nur Zoomen den Maßstab — waagerechter Scroll
entsteht nie beim Öffnen. Weil die Breite jetzt an den DATEN hängt, schreibt
`renderZeitleiste` sie mit (`schreibeZeitBreite`, mit Letzter-Wert-Vergleich: die Funktion
läuft in jedem Zug-Frame).

**Ein Halt ist eine KETTE von Klips, kein Stapel** (Etappe 2 des
[Zeitleisten-Umbaus](../../docs/architecture/zeitleiste-umbau.md)). Der „Cluster" war nie ein eigenes
Ding, sondern die Folge zusammenfallender Anker — als Stapel mit Zahl-Plakette gezeichnet,
weil PUNKTE an derselben Stelle übereinanderlägen. Er saß an der LINKEN Kante einer Breite,
die der Halt trotzdem belegte: eine tote Zone, in der nichts anzufassen war, obwohl dort der
halbe Film liegt (52 % der Beispieltour sind Standzeit). Jetzt hat jede Aufnahme ihren eigenen
Klip mit Anfang und Ende, und die Kette liegt lückenlos hintereinander. Drei Regeln tragen das:
**Reconcile an `medium.id`** (nicht am Titel — der ist weder eindeutig noch stabil; und nie per
Neubau: der kostete 2,34 ms je Zieh-Frame und das gezogene Element samt dekodiertem `img`),
**Container-Queries** für die drei Ausbaustufen (nur Bild < 150 px < Bild+Name < 232 px <
Bild+Name+Bild — gemessene JS-Klassen schalteten erst beim Loslassen, weil
`kuerzeBeschriftungen` im Zug bewusst nicht läuft) und die **Miniatur aus `miniaturQuelle`**
(thumb → src; ohne den Rückfall bliebe jede Tour von vor der Bildaufbereitung ohne Bild).

**Die rechte Kante eines Fotos ist seine Standzeit** (`display.holdS`, Blase am Griff). Ein
Video hat diesen Griff NICHT — der Player läuft bis zum Dateiende, `holdS` ist dort wirkungslos
(src/tour.ts), ein Griff dafür wäre eine Lüge. Es hat stattdessen **zwei SCHNITT-Kanten**
(`edits.medien[].trim` in DATEI-Sekunden, Etappe 4): Der alte Satz „ein Video trägt seine
Länge, sie steht nicht zur Wahl" stimmt für die Standzeit, nicht für den Schnitt. Anschlag
ist an beiden Kanten die Datei, Loop gibt es hier nicht. Der **Ripple kostet keine Zeile
Code** — ein Video liegt in einer Halt-Kette ohne Lücken, ein kürzerer Ausschnitt macht
seinen Halt schmaler, die Achse baut sich neu und alles Folgende rückt vor. Angewandt wird
der Schnitt in der Pipeline ([video.ts](../../server/src/pipeline/video.ts)), und zwar **immer per
Transcode**: `-c copy` schnitte nur an Keyframes und träfe den Punkt um Sekunden. Die
geschnittene Fassung (`m1.cut.mp4`) entsteht NEBEN dem Master, nie an seiner Stelle — sonst
wäre der zweite Schnitt einer in den ersten, und „Trim zurücknehmen" fände das Weggeschnittene
nirgends wieder. **Der Zug friert den Maßstab ein und lässt ihn
eingefroren:** eingepasst folgte er sonst der wachsenden Filmdauer — die Leiste schrumpfte
unter der Hand, der Griff bliebe hinter dem Zeiger zurück, und beim Loslassen sprang alles noch
einmal auf „ganzer Film im Fenster". Genau diese Skalierung soll der feste Maßstab verhindern:
sie verschiebt AUCH alles vor der geänderten Stelle. Der Fit gehört zum Öffnen und zum Zoomen,
nicht zu einer Datenänderung; zurück führen der „×"-Knopf und ⇧Z, die danach sichtbar aktiv
werden. Ein waagerechter Scrollbalken ist dann kein Fehler, sondern die Folge einer
Nutzerhandlung.

**Der Klip-Zug ist EINE Geste mit zwei Bedeutungen.** Innerhalb der eigenen Kette ordnet er um
(`reihe`, risikofrei), darüber hinaus setzt er den ORT auf der Route — was gerade gilt, sagt
das Etikett am Zeiger, nicht erst das Ergebnis. Über einem FREMDEN Halt dockt der Klip an
(über dessen volle Breite: dort gibt es keine Zwischenposition, die Pixel gehören einer
Standzeit und keiner Fahrzeit) und übernimmt dessen Anker — über die Zeit gerechnet läge er
knapp daneben und der Halt zerfiele wieder. Die Rückübersetzung px → Zeit läuft über eine
Achse OHNE die Halte DIESER Aufnahme: auf der echten Achse hat der gezogene Klip selbst
Breite, um die Ruhelage läge also eine tote Zone von Sprungbreite. Welche Bedeutung gilt,
entscheidet die Kette, in der der Zug BEGANN — sonst kippte sie mitten in der Bewegung. Ein
Zug, der auf seinem eigenen Platz endet, schreibt nichts: `reiheVergeben` erzeugte sonst ein
neues Overlay und damit einen leeren Undo-Schritt.
Den ganzen Halt bewegt seither nur noch der Punkt auf der KARTE; den Filmstreifen im Inspector
gibt es nicht mehr (er war der einzige Weg zum Umordnen und Herauslösen — beides tut jetzt der
Klip-Zug dort, wo man es sieht).

**Die Halt-Zone gilt nur dem AUSGEWÄHLTEN Halt** — die gestrichelte Führung durch alle Bahnen
beantwortet „was liegt zeitlich darüber?" genau dann, wenn die Frage gestellt wird. Über alle
Halte gelegt waren es zwölf Linien Dauerunruhe (dasselbe Muster wie der leuchtende
Streckenabschnitt auf der Karte).

**Was in der Datei steht, liest der Editor selbst.** Der Block „Aufnahme-Details" unter einer
Aufnahme zeigt Aufnahmezeit, Verortung und die Kameradaten aus dem EXIF (Kamera, Objektiv,
Belichtung, Auflösung, Höhe). Gelesen wird clientseitig aus der ausgelieferten Datei —
`liesAufnahme`/`beschreibeAufnahme` in [src/studio/exif.ts](exif.ts), beide DOM-frei
und an echten Beispiel-JPEGs getestet (`test/fixtures/`). Der EXIF-Block steht am DATEIANFANG,
deshalb holt der Editor per Range-Request nur die ersten 256 KB — und das erst beim ersten
Aufklappen (Ergebnis je Medium gecacht, der Auf-/Zu-Zustand überlebt den Render). Kein
Server-Feld, keine Pipeline-Änderung: was das Foto trägt, trägt es schon.

**Was der ganzen Tour gehört, steht nicht im Inspector-Leerzustand.** Titel,
Beschreibung und Endscreen gehören keinem Objekt der Zeitleiste; sie liegen in
„Tour-Einstellungen", erreichbar über den Titel in der Kopfleiste und über den
„…"-Knopf neben Speichern (dort auch „Neu verarbeiten") — als eigene Ansicht
im rechten Panel, nicht als Modal und nicht als Leerzustand (der las sich
früher wie eine Einstellung des Nichts).

**Erklärungen hängen an einem Griff, nicht unter dem Feld.** In den
Tour-Einstellungen stand unter drei Feldern je ein Satz Kleingedrucktes — beim
ersten Mal nützlich, danach Grundrauschen, und zu dritt zerfiel das Panel in Text
mit ein paar Feldern dazwischen. Sie sitzen jetzt an einem `?` neben dem Label
([src/studio/tipp.ts](tipp.ts), `data-tipp`). Drei Dinge, die man dabei kippt:
Die **Blase gehört an den `body`** — der Inspector scrollt, ein Kind darin wird
an seiner Kante abgeschnitten, und `z-index` hilft nicht (dieselbe Familie wie
der Auswahl-Rahmen weiter unten). Sie liegt **LINKS neben dem Griff**, weil das
Panel am rechten Rand klebt: nach unten deckte sie das Feld zu, zu dem sie
gehört, nach oben die Panel-Überschrift; links liegt die Karte, und die erklärt
in diesem Moment nichts. Und **`title` allein reicht nicht** (erst nach einer
Sekunde, nur mit Maus, Systemschrift) — es bleibt als Rückfall stehen. Die
Lage-Rechnung ist DOM-frei und getestet (`lageFuer`), samt dem Fall
„Fenster meldet 0×0": Die Browser-Pane tut das, sobald sie unsichtbar ist, und
ohne Rückfall klemmte jede Rechnung die Blase in die linke obere Ecke.

**Die globalen Knopf-Regeln schlagen jede Klasse.** `button:hover { background: … }` wiegt durch
die Pseudoklasse mehr als `.knopf-primaer` oder `.kopf-griff` — wer einem Knopf eine eigene
Fläche gibt, muss sie in der `:hover`-Regel WIEDERHOLEN, sonst wird er beim Zeigen grau (der
orange Primärknopf und der Abspielkopf wurden so ausgerechnet dunkler). Dasselbe gilt für
`:disabled:hover`. Ein Knopf, der gar keinen Hover haben soll, braucht trotzdem eine leere
`:hover`-Regel, die seine Fläche hält.

**Der Inspector-Inhalt ist eine Flex-SPALTE — hohe Blöcke brauchen `flex: none`.** Ein
Flex-Item schrumpft (Default `flex-shrink: 1`), statt den Container scrollen zu lassen: der
aufgeklappte Block „Aufnahme-Details" war dadurch **2 px hoch**, seine acht Zeilen standen im
DOM und waren unsichtbar. Gleiche Sorte Falle wie „`margin-top: auto` kollabiert im Overflow".

**Zwei CSS-Fallen derselben Sorte** (eine eigene Regel schlägt eine, die der Browser über einen
anderen Selektor stellt): `display: flex` direkt auf `dialog` schlägt
`dialog:not([open]) { display: none }` — der geschlossene Dialog hängt dann sichtbar über der
Seite; die Regel gehört an `dialog[open]`. Und die globale `button:active { transform: scale(…) }`
ERSETZT die Zentrierung `translateX(-50%)`, statt sie zu ergänzen (CSS kennt nur *eine*
`transform`-Eigenschaft) — Abspielkopf und Foto-Miniatur sprangen beim Drücken um ihre halbe
Breite; beide brauchen eine eigene `:active`-Regel, die beides kombiniert.

**Ein Auswahl-Rahmen gehört nach INNEN.** Ein `box-shadow` ohne `inset` liegt AUSSERHALB der
Box — bei einem Element am Rand seines Containers schneidet ihn dessen `overflow` weg. Auf der
Zeitleiste war das an `.spuren-fenster { overflow-x: scroll }` zu sehen: Ein Ton-Klip, der bei
0:00 beginnt, hatte oben, unten und rechts einen Rahmen und links keinen. Die Zustandsbänder
lösen es längst mit `inset` (`.band.fokus`); bei den Klips musste es ein eigenes
`::after`-Pseudo-Element werden, weil die Wellenform (`inset: 0`) einen Inset-Schatten am Klip
selbst wieder zudeckte — mit `pointer-events: none`, sonst schluckt der Ring die überstehenden
Kanten-Griffe. Der weiche SCHEIN darf außen bleiben: dass er an einer Kante fehlt, sieht man
nicht. Dieselbe Familie wie „`border` + `overflow: hidden` frisst das Randpixel"
(docs/architecture/zeitleiste-umbau.md §5).

**Abspielen ist Schnittprüfung, kein zweiter Player.** [src/studio/abspielen.ts](abspielen.ts)
(lazy beim ersten Play) lässt den Abspielkopf über die Achse laufen, spielt Musik und Klänge
und blendet an jedem Halt die Foto-Karte auf — die 3D-Kamerafahrt bleibt dem echten Player
vorbehalten („Vorschau"). Die Schrittlogik `tick()` ist rein und getestet; das Tempo ist
`1/schaetzeAnimationsdauer`, sodass der Halt an einem Foto hier so viel Zeit „kostet" wie
später. Musik läuft über EIN `Audio`-Element je Klip mit **Eintritts-Seek** (wer mitten im Bereich
startet, hört, was dort im Film liefe). Die Rechnung dahinter ist seit Paket D geteilt:
`musikVersatzS` steht in [audiotracks.ts](../audiotracks.ts) und bekommt die Filmzeit seit
Klipbeginn herein (`seitKlipbeginnS` über die Spielkurve) — der Player ruft dieselbe Funktion
über seine Filmachse, und beide Bühnen greifen an derselben Filmsekunde auf dieselbe
Datei-Position zu (Wächter in [test/filmachse.test.ts](../../test/filmachse.test.ts)); Klänge nutzen `sfxSollFeuern` aus [src/audiotracks.ts](../audiotracks.ts) — seit E10 in
FILMSEKUNDEN, der Abspieler rechnet seine Marken dafür über `filmBei(plan.kurve, …)` um; die
Schwelle, ab der ein Schritt als Sprung gilt, ist eine Frame-Zeit und hinge im Achsen-Anteil
an der Länge der Tour. Das ändert Player und Editor in einem Zug, damit im
Studio nichts klingt, was der Film nicht spielt (Drift-Wächter). Bis zur
TypeScript-Migration des Players lag daneben eine handgeschriebene
`audiotracks.d.ts`, weil `allowJs` aus ist — seit `audiotracks.ts` TypeScript ist,
prüft `tsc` die eine verbliebene Signatur selbst. Jede manuelle Geste ruft `halteAbspielen()` —
der Spielplan ist ein Schnappschuss und liefe sonst gegen veraltete Halte.

**Die Audio-Elemente überleben Pause und Neustart, der Plan tut es nicht.** Sie hängen an einer
Map (Index im Plan) und entstehen beim ersten Eintritt in ihren Bereich; der Plan wird bei
jedem Start frisch geholt. Wer nur beim ANLEGEN Lautstärke, Loop und Datei setzt, hat sie für
den Rest der Sitzung festgeschrieben: Ein am Regler geänderter Pegel war im Vorhören zu hören
und im Abspielen nicht. Deshalb zieht `spieleMusik` Lautstärke und Loop bei jedem Eintritt nach
und ersetzt das Element, wenn der Eintrag inzwischen eine andere Datei trägt (verglichen wird
`dataset.url`, nicht `el.src` — der ist absolut aufgelöst).

**Welches Bild auf der Karte liegt, ist eine FUNKTION der Kopfposition** — keine Uhr und keine
Überfahr-Marke. `synchronisiereFoto` (aufgerufen aus `renderPlayhead`, also bei jeder
Kopfbewegung) fragt `haltBeiFilmS`: steht der Kopf in einem Klip, liegt dessen Bild auf der
Karte; verlässt er ihn, verschwindet es. Der Fortschrittsbalken wird dabei gesetzt statt
animiert. Vorher stieß der Abspieler die Einblendung als Marke an und ein Timer nahm sie
zurück — daran hingen ZWEI Fehler, die derselbe Satz erklärt: Beim Scrubben erschien gar kein
Bild (der Abspieler lief ja nicht), und beim Abspielen ging es 0,8 s zu früh aus, weil der
Timer über die reine Standzeit lief, der Klip aber über Standzeit + Ausblendung. Im
Schnelllauf (J/L) bleibt die Karte aus — dort will man die Strecke überfliegen. `ZeigeMarke`
und `Schritt.zeige` sind damit ersatzlos entfallen.

**Und was IM Bild passiert, hängt an derselben Position** (`synchronisiereBild`) — die Regel
gilt nicht nur dafür, WELCHES Medium liegt, sondern auch für seinen Stand. Beides lief lange
nach eigener Uhr weiter: Der Ken-Burns-Zug war eine gewöhnliche CSS-Animation ab dem Einfügen
des `img`, das Video hing an `autoplay` + `loop`. Wer in die Mitte eines Halts scrubbte, sah
den Zoom trotzdem bei 0 anfangen und weiterlaufen, obwohl der Kopf stand, und im Video
irgendeinen Frame statt des gemeinten. Der Ausweg waren dauerhaft PAUSIERTE Animationen mit
negativem Delay (`--fe-zeit`) — der Kunstgriff, mit dem man ein Standbild aus einer Animation
zieht, und der Behelf für genau das, was ein MALER von Natur aus tut. **Seit dem 2026-08-17
gibt es den Maler auch hier** (s. den nächsten Absatz), und die `--fe-*`-Choreografie ist weg.
Das Video wird weiter auf `trim.vonS + imS` gesetzt und läuft nur
bei Tempo 1 selbst (dort mit 0,34-s-Toleranz, ein Seek je Frame ruckelte sichtbar); **beide
Trim-Kanten** stehen im `dataset` des Elements, weil die ausgelieferte Datei der ungeschnittene
Master ist und der Schnitt erst in der Pipeline entsteht.

**Und die Karte MALT seit dem 2026-08-17 derselbe Zeichner wie im Player und im Film** —
`maleKarte` in [src/kartenmaler.ts](../kartenmaler.ts), eingehängt über
`createKartenSchicht({ buehne: 'editor' })` („Eine Bühne, ein Maler" Etappe 1,
[docs/concepts/eine-buehne-ein-maler.md](../../docs/archive/eine-buehne-ein-maler.md)). Damit
ist die Begründung aus §6A des Gleichlauf-Konzepts abgelaufen: Sie richtete sich gegen ein
gemeinsames DOM-BAUTEIL, das zwei Zeitmodelle tragen müsste — ein Maler trägt keines, er
bekommt eine Filmsekunde und zeichnet. Was der Editor noch selbst tut, sind die zwei Dinge,
die der Maler nicht beschaffen kann: die ZEICHENQUELLE (ein `img`/`video` in `#foto-quellen`,
unsichtbar im Dokument, weil der Browser nur dekodiert und spielt, was er lädt) und der TEXT.
Fünf Dinge, die man dabei kippt:

- **Die Lage wird GESETZT** (`EDITOR_LAGE`), nicht aus Breite und Höhe abgeleitet: Eine
  Editor-Bühne von 700 × 500 fiele in `quer` und bekäme das Telefon-Layout „Bild links, Text
  rechts". Ebenso Maßsatz (`EDITOR_MASSE`), Maßstabsgrenzen und Flugweite — alles vier
  liefert `kartenSatz(buehne)`.
- **Eine Leinwand zeichnet sich nicht von selbst neu, und hier STEHT der Kopf meistens.** Ein
  `img` in der alten DOM-Karte erschien von selbst, sobald es geladen war; auf der Leinwand
  sah man beim Scrubben die Karte mit LEEREM Bildfeld liegen. `zeigeFoto` hängt deshalb an
  `load` (Bild) und `loadeddata`/`seeked` (Video) einen Rückruf auf `synchronisiereFoto`. Im
  Player fällt das nie auf, weil dort der Film läuft und jeder Frame ohnehin zeichnet.
- **Der Schleier bleibt DOM** (`.karten-buehne::after`, z-index 2, Leinwand darüber auf 5):
  `backdrop-filter` hat auf einer Leinwand kein Gegenstück. Er ist damit der EINE Teil der
  Karte, der weiter zweimal als CSS dasteht und Text gegen Text bewacht wird. Seine DECKKRAFT
  kommt seit dem Rückbau des Kamerablitzes aus der Filmzeit: `kartenschicht.ts` schreibt
  `--schleier-sicht` auf die BÜHNE (ein `::after` nimmt keine Inline-Stile, sein Host schon),
  die Klasse `foto-an` schaltet nur noch den Filter, und eine Transition darf dort nicht mehr
  stehen — sie liefe über die Werte, die die Filmzeit setzt.
- **Der Fortschrittsbalken ist Bildinhalt** und kommt aus dem Maler — `.fe-hold-fill` und der
  `scaleX`-Schreiber in `synchronisiereFoto` sind weg.
- **`prefers-reduced-motion` liest die SCHICHT** und gibt es dem Maler als Schalter weiter
  (`buehne.ruhig`); ein `@media`-Block im CSS hätte darauf keinen Zugriff mehr.
- **Keine versteckte Textkopie, und das ist eine Entscheidung.** Der Player trägt Titel und
  Bildunterschrift als `figcaption.sr-only` weiter, weil seine Karte in dem Moment der GANZE
  Inhalt der Seite ist. Hier steht jede Angabe dauerhaft als Text daneben — der Titel im Klip
  der Szenen-Bahn, Uhrzeit und Kilometer im Pult —, eine Kopie wäre dieselbe Auskunft ein
  zweites Mal in einer ohnehin dichten Oberfläche. Der Wächter hält die Player-Regel fest und
  nennt den Editor als benannte Ausnahme. Das gilt nur, solange die Angaben daneben stehen:
  Verlöre die Szenen-Bahn ihre Titel, wäre die Karte die einzige Quelle.

Die vier geteilten Rechnungen bleiben, wo sie waren: `kartenZeiten`, `balkenAnteil`,
`klipDauerS` und `videoStandS` in [src/einblendung.ts](../einblendung.ts) — dort auch die
geteilten ZAHLEN (`KARTE`) und die benannten Bühnen-Varianten (`KARTE_BUEHNE`).

**Das Video KLINGT — und duckt dabei die Musik.** Es lief lange mit hartem `muted = true`, und
damit prüfte das Abspielen einen Film, den es nicht gibt: Im Player hat die Aufnahme ihre eigene
Stimme und die Filmmusik taucht darunter weg, im Editor stand die Musik ungedämpft über einer
stummen Szene. Beides kommt jetzt aus denselben Funktionen wie im Player
([audiotracks.ts](../audiotracks.ts)): `videoTonHuelle` über den AUSSCHNITT (nicht die Datei —
die ausgelieferte ist der ungeschnittene Master, die Blenden gehören an die Schnittkanten),
`videoLautstaerke` fürs Video und `videoMusikDuck` für die Musik, gereicht über
`Abspieler.setzeDucking`. Drei Dinge, die man dabei kippt: Gehört wird nur bei **Tempo 1** (im
Schnelllauf steht das Video ohnehin), der **Autoplay-Rückfall** muss bleiben (unmuted-Play ohne
frische Geste wird geblockt — dann stumm erzwingen, sonst steht am Video-Halt ein Standbild),
und `verbergeFoto` muss die Dämpfung **zurücknehmen**, sonst bleibt die Musik nach dem letzten
Video für den Rest der Wiedergabe leise.

**Der Pegel eines Ton-Klips ist ABSOLUT — im Studio wie im Player.** Ohne eigenen Wert gilt
`STUDIO_PEGEL_VORGABE` (0.8, in [audiotracks.ts](../audiotracks.ts), Spiegel von `STUDIO_PEGEL`
in [server/src/schema/edits.ts](../../server/src/schema/edits.ts), Drift-Wächter in
[test/studio-baukasten.test.ts](../../test/studio-baukasten.test.ts)). Der Weg dorthin hatte zwei
Lecks, und beide machten den fertigen Film LEISER als den geprüften Schnitt: `enrich.ts` schrieb
`gain` nur bei ausdrücklich gesetzter Lautstärke, und der Player legte über alles einen Master
von 0.22 (der gehört den KURATIERTEN Touren in [src/tours.ts](../tours.ts), deren `gain` gegen
ihn ausgemessen ist — `KURATIERTER_PEGEL`). Zusammen ein Faktor 3,6. Jetzt schreibt der Server
`gain` immer, [remote.ts](../remote.ts) füllt es für bereits gerenderte Bestandstouren nach
(sonst spielten genau die mit 1.0, also zu LAUT) und setzt `cfg.audioPegel = 1`.

**Der Klip ist um die Ausblendung LÄNGER als das Material** (`aufnahmeHaltS(m) +
HALT_AUSBLEND_S`) — deshalb klemmt `videoStandS` das Ziel auf einen Frame vor dem Ende
(Schnitt-`bisS`, sonst `video.duration`). Ohne die Klemme lief `vonS + imS` darüber hinaus:
Der Browser klemmt `currentTime` still, die Abweichung bleibt dadurch dauerhaft über der
0,34-s-Schwelle, und die Wiedergabe seekte in JEDEM Frame ans Ende — das sichtbare Zittern am
Klip-Ende. Gemessen an einer 6-s-Datei: Ziel 6,80 s → `currentTime` 6,00 s, Abweichung 0,80 s.

**Auch Auftritt, Abgang und Kamerablitz hängen am Kopf** — der Auftritt war bis E15 eine
`transition` (opacity 500 ms, transform 950 ms), und eine Transition hat keine ansteuerbare
Zeitachse: Sie startet beim Klassenwechsel und läuft nach Wanduhr, beim Scrubben sprang die
Karte deshalb sofort auf ihren Zielzustand. Danach waren es drei pausierte Animationen mit
negativem Delay, seit dem 2026-08-17 rechnet der Maler sie (`kartenPhasen`). **Der Kamerablitz
ist am selben Tag ganz entfallen**: Auf seiner Spitze steht die Karte bei 7 % Deckkraft und das
„Entwickeln" bei `brightness(1.45)` — das Foto ist dort ohnehin ein heller Schleier, zwei
Gesten für dieselbe Sache im selben Moment. Er strobte außerdem (er hing am Klip, nicht am
Halt, feuerte also bei jedem Bildwechsel innerhalb eines Halts neu), und seine Metapher war
verkehrt: Ein Blitz sagt „hier wird gerade fotografiert", diese Fotos sind längst aufgenommen.
Den Halt markiert jetzt der Schleier allein — dass die Umgebung zurücktritt.

**Dieselbe Regel gilt für die Kartenmitte.** `folgeKarte()` hängt ebenfalls an
`renderPlayhead`, nicht am Abspieler. Vorher stand der Aufruf allein in `setzeMarkeAnteil` —
also nur im laufenden Film: Beim Scrubben, Klicken oder mit den Pfeiltasten blieb die Karte
stehen, obwohl der Schalter „Karte folgt der Position" heißt und die Position sich sehr wohl
bewegte. Der Abspieler ist jetzt eine Kopfbewegung unter vielen. Was dabei ERHALTEN bleiben
muss, ist `pausiereKartenFolge`: Jedes Follow-`jumpTo` bricht eine laufende Zoom-Animation ab,
deshalb setzt Rad/Pinch/Zoomstart das Folgen für 450 ms aus.

**Eine Auswahl über drei Ansichten.** `z.fokus` (ausgewähltes Objekt) ist getrennt von
`z.auswahl` (Einfügemarke für „ab hier"-Aktionen) — wie Selektion und Abspielkopf in einem
Schnittprogramm. Der Fokus speichert nur die **Identität**; die Spanne löst `loeseFokusAuf()`
bei jedem Render neu auf, sonst veraltet sie beim Verschieben einer Grenze. Das fokussierte
Objekt ist gleichzeitig im Band hervorgehoben, im Inspector beschrieben und als leuchtender
Streckenabschnitt auf der Karte sichtbar.

**Undo/Redo** nutzt aus, dass das Overlay immutabel fortgeschrieben wird: Ein Referenzvergleich
beim Render (`letzterStand`) erkennt jede Änderung, egal aus welchem Handler. Während eines
Zeitleisten-Zugs läuft nur `renderNachZug()`, das den Stand nicht fortschreibt — der ganze Zug
wird dadurch zu genau einem Undo-Schritt.

**Falle bei Zeitleisten-Interaktion:** Nach `setPointerCapture` zeigt `e.target` im `pointerup`
auf das Capture-Element, nicht mehr auf das Element unter dem Finger. Was angeklickt wurde,
muss im `pointerdown` gemerkt werden.

