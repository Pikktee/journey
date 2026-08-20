---
icon: stift
---

# Editor-Ausbau: erzählerische Werkzeuge

Ideensammlung aus der Konzept-Diskussion vom **2026-07-27**. **Nichts davon ist
beschlossen oder umgesetzt** — die Datei hält den Stand des Gesprächs fest, damit die
Begründungen nicht verloren gehen. Wo eine Idee an vorhandenem Code hängt, steht die
Fundstelle dabei; das ist meist der Unterschied zwischen „zwei Tage" und „zwei Wochen".

## Die Leitregel

Die Frage „wie viel Freiheit geben wir?" hat sich in der Diskussion aufgelöst — die
Trennlinie liegt nicht bei *viel oder wenig*, sondern bei **worüber** entschieden wird:

- **Freiheit über die Erzählung** — was betont wird, wie lange, in welcher Reihenfolge,
  welcher Ton, welcher Text, wo die Kamera hinschaut. Davon kann es nicht genug geben.
  Das *ist* der Kreativbaukasten.
- **Freiheit über die Ausführung** — Schriftart, Hex-Farbe, Position in Pixeln,
  Randabstand. Davon wird nichts persönlicher, nur uneinheitlicher. Das ist es, was
  am Ende nach PowerPoint aussieht.

Daraus die Regel für jede Einstellung in diesem Dokument:

> **Alles, was man falsch machen kann, wird eine Wahl aus benannten Zuständen.**
> Kein Farbwähler, aber gerne acht benannte Looks. Keine freie Positionierung, aber
> gerne drei Platzierungen, die einen Namen haben.

Der Baukasten wird nicht reicher durch mehr Regler pro Baustein, sondern durch **mehr
Bausteine, die alle zusammenpassen**. Eine saubere Ausnahme, wo volle Freiheit richtig
ist: beim **Eigenen** — eigene Fotos, eigene Musik, eigene Texte, eigene Sprachaufnahme.
Da ist der Nutzer die Quelle, nicht der Gestalter.

---

## 1. Ordnung der Spuren

**Kamera und Momente werden NICHT verschmolzen.** Der Wunsch ist nachvollziehbar (beide
klingen nach Kamera), aber die beiden tragen verschiedene Grammatik:

- **Kamera** ([edits.ts:52](../../server/src/schema/edits.ts#L52)) ist eine Stufenfunktion
  `{ab, preset, skala}` — lückenlose Bänder, Grundband „Standard". Sie beantwortet:
  *wie nah bin ich dran, während gefahren wird.*
- **Momente** ([edits.ts:107](../../server/src/schema/edits.ts#L107)) sind Punkt-Ereignisse
  `{ab, art, dauerS}`. In der Engine ist das eine **eigene Phase**: die Fahrt bremst
  ~160 m vorher ab, hält an, die Kamera agiert ([tour.ts:793](../../src/tour.ts#L793)).

Ein Moment ist damit kein Kamera-Attribut, sondern ein **Halt** — grammatikalisch näher
am Foto-Stopp als am Kamera-Abstand. Eine Bahn, die gleichzeitig durchgehend gefüllt ist
*und* Pins trägt, hätte auf ~28 px Höhe drei Trefferarten (Band, Kante, Pin) — genau die
Ecke, in der wir schon einmal gestolpert sind (`bandUnterZeiger`/`elementsFromPoint`).
Und das Löschen wäre nicht mehr vorhersehbar: beim Band füllt der Nachbar auf, beim Pin
ist er weg.

**Stattdessen:**

1. **Leere Bahnen kollabieren** — eine Bahn ohne Inhalt wird zur schmalen Zeile mit Namen
   und „+". Löst das Platzproblem generisch und ist die Voraussetzung dafür, überhaupt
   neue Spuren hinzufügen zu können, ohne die Karte zu erdrücken.
2. **Umbenennen** — „Kamera" → **Kameranähe**, „Momente" → **Halte**. Dann sagt der Name
   die Grammatik: das eine *gilt*, das andere *passiert*.

**Ordnung der Bahnen nach Wirkung** (statt nach Thema):

| Familie | Bahnen |
|---|---|
| **gilt** (lückenlose Bänder) | Fortbewegung · Kameranähe · Wetter · *Tempo* |
| **hält an** (Punkte mit Standzeit) | Foto-Halte · Momente |
| **läuft nebenher** (Klips über die Fahrt) | *beiläufige Fotos* · *Titel* |
| **klingt** | Musik & Effekte · *Sprecher-Text* |

*Kursiv* = neu. In dieser Ordnung beantwortet sich die Verschmelzungsfrage von selbst.

### Es gibt keinen „Abschnitt"

Wichtig für alles Folgende: Das Modell kennt **kein** Objekt „Abschnitt". Es gibt Bänder
(aber jede Spur hat eigene Grenzen — Modus-, Kamera- und Wetterbänder decken sich
nirgends), es gibt Halte, und es gibt die Tour. Eine gemeinsame Segmentierung existiert
nicht. Jedes neue Werkzeug muss deshalb sagen, **woran es hängt**.

Sobald Titel kommen, entsteht implizit doch ein Kapitelbegriff („ab hier ist Tag 2").
Möglich, dass **Kapitel** das fehlende Objekt ist, an dem später Titel, Sprechertext und
Tempo hängen. Nicht vorbauen — erst Titel machen, dann sehen, ob es sich aufdrängt.

---

## 2. Titel-Spur

Als **Klip-Sorte** (echtes Ende, Stille dazwischen), nicht als Band. Drei Sorten, kein
freies Textwerkzeug:

- **Kapitel** — groß, mittig, kurz stehend („Tag 2 · Nordkap"), optionale Unterzeile.
- **Bauchbinde** — klein, unten links, läuft nebenher („Passhöhe 2.100 m").
- **Zahl/Fakt** — eine Kennzahl groß, `tabular-nums` (s. `DESIGN.md`), z. B. „1.240 hm".

Nicht wählbar: Schrift, Farbe, freie Position, Animationskurve. Das ist Marke.

**Die Zeitachsen-Falle:** Die Achse zeigt **Aufnahmezeit**, die Einblenddauer ist
**Wiedergabezeit**. 4 Sekunden Titel sind auf einer 6-Stunden-Achse ein Pixel — als
maßstäblicher Klip unziehbar. Also: **Anker = Zeitpunkt auf der Achse, Dauer =
Wiedergabesekunden im Inspector**, dargestellt als Pin mit fixer Breite. (Musik hat das
Problem nicht, weil ein Musikbereich in Aufnahmezeit gemeint ist.)

Automatik: vom Nutzer **ausdrücklich nicht gewünscht** — Titel sind manuell. (Denkbar
wäre später ein Vorschlag aus Nominatim-Ortsnamen und Tageswechseln, analog zur
Auto-Musik; steht derzeit nicht zur Debatte.)

---

## 3. Fotos: Betonungsgrad statt Darstellungsart

Nicht als Stil-Menü bauen, sondern als **Skala**. Der Gewinn ist nicht „mehr Optionen",
sondern **Rhythmus**: zwölf gleichwertige Vollhalte hintereinander sind zäh, egal wie
schön jeder einzelne ist.

| Stufe | Wirkung | Wofür |
|---|---|---|
| **beiläufig** | Fahrt läuft weiter, 1–5 Bilder klein seitlich ein/aus | die 40 Handyfotos vom selben Strand |
| **Karte** (heute) | Halt, Polaroid, Karte bleibt sichtbar | der Normalfall |
| **groß** | Halt, randfüllend, Ken Burns | das eine Bild, auf das die Etappe zulief |

„Beiläufig" ist wertvoller als „Fullscreen": Fullscreen macht den Halt *härter*,
beiläufig schafft überhaupt erst Abstufung.

**Wo gewählt wird:** Grundstil in den Tour-Einstellungen, pro Foto überschreibbar
(`edits.medien[id].display`, dort liegen schon `holdS`/`kenBurns`). Gleiches Muster wie
beim Wetter: eine Vorgabe, punktuelle Korrektur.

**Was daran hängt** — beiläufige Fotos halten nicht an:

- `estimateAnimationDuration` muss sie anders zählen (sonst lügt die Zahl unter den Bahnen),
- der Studio-Abspieler ([abspielen.ts](../../src/studio/abspielen.ts)) braucht einen zweiten
  Halt-Typ ohne Standzeit,
- die Engine braucht eine Overlay-Ebene, die **während** `phase === 'ride'` läuft — heute
  ist jedes Foto an `phase === 'photo'` gekoppelt,
- Bilder vorladen; die Einblendung darf nur Compositor-Eigenschaften anfassen.

Automatik-Vorschlag möglich: Fotos im Cluster (< 120 m, heute schon zu einem Stopp
gruppiert) → beiläufig; einzelnes Foto nach langer Fahrt → groß.

---

## 4. Tempo-Spur

Erzählerisch der stärkste fehlende Hebel. Heute hängt das Tempo allein am
Fortbewegungsmodus ([tour.ts:62](../../src/tour.ts#L62)) — aber die Fortbewegung ist ein
**Fakt** („ich bin geradelt"), das Tempo eine **Erzählentscheidung** („die 40 km
Landstraße im Flug, die Serpentinen in Ruhe").

Bahn wie „Fortbewegung", gleiche Grammatik: lückenlose Bänder, Grundband **„Normal"**.
Fünf benannte Stufen: **Ruhig 0,5× · Normal 1× · Zügig 2× · Zeitraffer 4× · Im Flug 8×**.
Im Player ein Multiplikator auf die Fahrgeschwindigkeit, mehr nicht.

**Die Anzeige-Pointe:** Auf der Aufnahmezeit-Achse wird ein Zeitraffer-Band *nicht
schmaler* — 40 km bleiben 40 km. Der Effekt zeigt sich nur in der Dauerschätzung. Damit
das nicht wirkungslos wirkt, beschriftet das Band seinen eigenen Beitrag:
**„Zeitraffer · 14 s statt 56 s"**. Damit wird `estimateAnimationDuration` zum ersten Mal
ein Werkzeug statt nur einer Anzeige.

Zwei Kopplungen gleich mitentscheiden:

- **Fotos im Zeitraffer** werden automatisch „beiläufig" (greift in Abschnitt 3) — dann
  heißt Zeitraffer wirklich „hier fliegen wir durch". Alternative: Halte bleiben Halte.
- **Kamera im Zeitraffer** automatisch weiter und höher, sonst rauscht der Boden
  unangenehm. Fester Nebeneffekt der Stufe, kein eigener Regler.

Verwandt: **Abschnitt überspringen** (Sprung mit Blende, für Zug-/Flugetappen) ist
vielleicht nur der Extremwert derselben Spur.

---

## 5. Looks (Farbstimmung)

Technisch **fast gratis** — aber nur auf dem richtigen Weg:

- **Falsch:** CSS `filter` auf dem Karten-Canvas. Zusätzlicher Vollbild-Pass pro Frame
  (`blur` besonders teuer), färbt Fotokarte und Bedienleiste mit.
- **Richtig:** die Raster-Paint-Properties des Satellitenlayers, die
  [daynight.js:84](../../src/daynight.ts#L84) bereits pro Frame fährt. Läuft im vorhandenen
  Shader-Durchgang: kein zweiter Pass, keine messbaren Kosten.

| Regler | Wirkung |
|---|---|
| `raster-saturation` | −1 = Schwarzweiß, +1 = knallig |
| `raster-contrast` | Härte |
| `raster-brightness-max` | Weißpunkt |
| `raster-brightness-min` | **Schwarzpunkt** — angehoben = milchige Schatten, „faded film" |
| `raster-hue-rotate` | dreht den Farbkreis (neu, bisher ungenutzt) |

Vorschlag für die Look-Palette (als **Offsets** auf die Tageszeit-Keyframes in
[daynight.js:16](../../src/daynight.ts#L16)):

| Look | Werte |
|---|---|
| **Klar** (Standard) | alles 0 |
| **Postkarte** | `sat +0.25, con +0.08` |
| **Dokumentarisch** | `sat −0.40, con +0.05` — silbrig, nüchtern |
| **Analog** | `bright-min +0.10, sat −0.10, con −0.08, hue +6°` — Super-8 |
| **Nordisch** | `hue −8°, sat −0.20` |
| **Herbst** | `hue +12°, sat +0.15` |
| **Monochrom** | `sat −1` |

**Zwei harte Regeln:**

1. Der Look ist ein **Offset**, kein gesetzter Wert. daynight schreibt dieselben
   Properties jeden Frame — ein absoluter Look verschwände beim nächsten Sonnenstand.
2. Der Look muss **die Himmelsfarben mitziehen** (`p.fog`/`p.hor`/`p.sky` gehen an die
   Atmosphäre). Kühler Boden bei warmem Horizont reißt die Naht am Horizont auf — an der
   haben wir schon fünf Runden verbracht. *Das ist der eigentliche Aufwand, nicht die
   Raster-Zahlen.*

**Grenzen:** `hue-rotate` dreht alle Farben mit, auch das Wasser — über ~15° wird es
psychedelisch. Vignette, Korn, Split-Toning, Kurven und LUTs gehen damit **nicht**
(bräuchte eigenen Shader-Pass) — **aber Vignette und Korn gehen als statisches Overlay**
(Radial-Gradient bzw. gekacheltes Noise-PNG, ein Compositor-Layer, kein Blur, kein
Repaint pro Frame). Die tragen den Filmlook gefühlt stärker als die Farbe.

**Geltungsbereich:** tour-weit, nicht pro Abschnitt (ein wechselnder Look liest sich als
Fehler). Wirkt **nur auf die Welt, nicht auf die Fotos** — das Foto bleibt das Dokument,
die Karte ist die Inszenierung.

---

## 6. Streckenthemen

Ursprünglich abgelehnt, nach Einwand **revidiert: Farbe ja, Linienstil nein.**

Die Route ist das einzige durchgehende Lesbarkeitselement über wechselndem Untergrund
(Wald, Fels, Schnee, Meer, Stadt bei Nacht) — man wählt bei km 0 und sieht km 30 nicht.
**Aber** die Route ist bereits vierschichtig
([map.js:336–370](../../src/map.ts#L336)): weiße Vorschaulinie (2,4 px), Farbverlauf
Bernstein→Koralle (4,6 px), weicher Schein (11 px, blur 7), farbige Spitze. Genau diese
Struktur — Kern plus Schein — erzeugt die Lesbarkeit. Solange ein Thema **alle vier
Schichten stimmig** setzt und die Helligkeitsdifferenz erhält, ist Magenta so lesbar wie
Bernstein.

Also kein Farbwähler (der setzt eine Schicht und zerlegt die Struktur), sondern **fünf,
sechs fertige Themen als Vierer-Sätze mit Namen**: *Bernstein (Standard) · Koralle ·
Magenta · Limette · Eis · Tinte*.

**Linienstil bleibt gesperrt:** Gestrichelt ist schon für Bedeutung reserviert — die
Foto-Tour ohne GPX soll laut [foto-tour.md](foto-tour.md) eine gestrichelte Bodenlinie
bekommen (Luftlinie zwischen Fotos, kein echter Track). Wird gestrichelt zur Dekoration,
kann der Zuschauer „geschätzt" nicht mehr von „gemessen" unterscheiden.

**Offen:** Streckenthema und Look gehören vermutlich in *eine* Wahl („Stil der Tour") —
kühler nordischer Look mit warmer Bernstein-Route sieht falsch aus. Als Vorauswahl mit
erlaubter Abweichung wäre das der Kompromiss.

---

## 7. Blickrichtung

Die Kamera schaut immer in Fahrtrichtung — bewusst so, der automatische Sonnen-Schwenk
wurde einmal verworfen. Als **manuelle Geste pro Band** ist das etwas anderes: „hier
schau nach links" (Meer), „hier von oben". Als zweites Feld an den vorhandenen
Kamera-Bändern (`preset` + `seite`). **Nie automatisch.**

---

## 8. Sprecher-Text

Ein gesprochener Satz — über ElevenLabs (ohnehin im Einsatz) oder als eigene
Sprachaufnahme aus der App. Erzählerisch stärker als jede Titeleinblendung: *erzählen*
statt *beschriften*. Läuft über die vorhandene Audio-Spur im Overlay.

Woran er hängt (s. „Es gibt keinen Abschnitt"):

- **(a) Am Halt** — „erzähl etwas zu diesem Bild". Der Halt hat ohnehin Standzeit, das
  Bild steht still. Hängt an einem existierenden Objekt, die Länge der Aufnahme kann die
  Standzeit gleich setzen. **Zuerst bauen.**
- **(b) Als freier Klip** mit `ab`/`bis` wie Musik — allgemeiner, aber der Nutzer muss
  Anfang und Länge selbst treffen.

Offen: API-Kosten pro Erzeugung (Quota-Frage) und Musik-Ducking darunter.

---

## 9. Fortbewegung

Heute: `walk 0.4 · bike 1 · moped 1.15 · tram 1.25 · jeep 1.45 · ferry 2.5`
([tour.ts:62](../../src/tour.ts#L62)), Ton nur für `moped/jeep/ferry`
([vehicle.js:11](../../src/vehicle.ts#L11)).

**Beobachtung:** Ein Modus tut vier Dinge — Tempo, Kameradistanz, Icon, Motorsound. Die
Tempo-Spur löst die erste Wirkung heraus; danach erzeugt `Modus × Tempo × Kamera` mehr
Varianten als sechs neue Modi. Also nicht mit der Liste anfangen, sondern mit dem, *was
ein Modus kann*.

### Der billigste Hebel: Ton für alle Modi

`walk`, `bike`, `tram` sind stumm. Dabei gibt es eine Atmosphären-Bibliothek: Schritte
auf Kies, Fahrtwind, Tram-Rumpeln, Wasser am Rumpf. Kein neuer Code — `MODE_SOUND` um
leise Ambient-Loops erweitern, statt nur Motoren zu kennen. Vermutlich das größte
Erlebnis-pro-Aufwand-Verhältnis der ganzen Liste.

### Was an Modi wirklich fehlt

- **Auto** — die häufigste Fortbewegung überhaupt; `jeep` ist Gelände. Der Motorloop ist
  in [gen-vehicle-audio.mjs](../../scripts/gen-vehicle-audio.mjs) bereits auskommentiert
  vorhanden.
- **Laufen** — `walk 0.4` ist Spaziergang; Läufer sind eine eigene große Gruppe (~0.6,
  andere Kamerahöhe).
- **Zug** — `tram` ist Straßenbahn. Fernzug: schnell, weit, ruhige hohe Kamera.
- **Ski/Snowboard** — nur bergab, dramatisches Höhenprofil, dichte tiefe Kamera; das
  Schnee-Grading existiert schon.

Weiteres (Motorrad, Bus, Reiten, Kajak, SUP) nach Nachfrage, nicht vorbauen.

### Neue Fähigkeit: über Grund schweben

Fährabschnitte werden auf Meereshöhe geklemmt. Dieselbe Mechanik andersherum — **feste
Höhe über Grund** — schaltet zwei Modi frei: **Seilbahn** (steil bergauf, in der Luft,
langsam; Partner zu Ski) und **Flugzeug** (hängt an der Sprung-Idee). Die einzige
Erweiterung hier, die echte Engine-Fähigkeit braucht statt einer Tabellenzeile.

### Voraussetzung

Ein neuer Modus berührt heute sieben bis neun Stellen. Vor dem Ausbau der Liste steht
die Konsolidierung (eigene Diskussion, s. `MEMORY`/Folgenotiz): die fünf Web-Stellen
(`MODE_SPEED`/`MODE_SCALE`, `MODE_ICONS`, `MODE_SOUND`, `MODI` im Studio,
Anzeigenamen) zu einer Tabelle zusammenziehen.

---

## 10. Wetter

Heute: `off · clouds · fog · rain · snow · storm` plus stufenlose Stärke
([weather.ts:19](../../server/src/pipeline/weather.ts#L19)). Hier liegt **mehr auf der
Straße als bei den Modi** — vier Effekte setzen auf vorhandener Infrastruktur auf:

1. **Talnebel** — Nebel liegt in den Tälern, Gipfel ragen heraus. DEM-Höhen sind da,
   `probeHorizon` sampelt das Gelände bereits. Ein Höhen-Cutoff auf der vorhandenen
   Nebel-Ebene → der Herbstmorgen im Gebirge. Vermutlich das eindrucksvollste Einzelbild,
   das die App produzieren kann.
2. **Hitzedunst** — über `drawHaze` fast geschenkt: A-Deckel hoch, leicht ins Gelbliche,
   Sättigung runter. Südeuropa und Tropen sehen sofort danach aus statt nach „klar".
3. **Gottesstrahlen** bei aufgerissener Decke — `sunOcc` (echtes Wolken-Alpha am
   Sonnenpunkt) ist genau der Auslöser; die Strahlen sind 2D im Atmosphären-Canvas.
4. **Regenbogen** — Position physikalisch exakt bestimmt (gegenüber der Sonne, 42°
   Radius), Sonnenstand und Wetterverlauf sind bekannt. Erscheint automatisch beim
   Übergang Regen→klar bei tiefer Sonne. Niemand stellt ihn ein — er passiert.

**Kombinationen** (Nebel *mit* Niesel, Wind *mit* Schnee) nicht als zwei gleichzeitige
Modi bauen (Bänder mit zwei Werten = Bedienungsproblem), sondern als **eigene benannte
Modi**: „Schneetreiben", „Nieselnebel", „Schwül". Wieder die Leitregel: ein Zustand,
nicht zwei Achsen.

---

## 11. Die Pause als erzähltes Ereignis

**Neu am 2026-08-01**, aus dem Befund einer Testtour: drei Stunden Aufnahme, davon zwei
im Kino. Seit dem Zeitraffer-Umbau ([time.ts](../../server/src/pipeline/time.ts),
`raffePausen`) läuft die Uhr über die Pause ehrlich weiter, und der Himmel dreht auf
dem Rampenfenster sichtbar von Dämmerung auf Nacht. Das ist die halbe Miete: Der
Zuschauer *sieht*, dass Zeit vergangen ist. Er erfährt aber nicht, **wie viel** und
**warum** — nur, dass es plötzlich dunkel wurde.

Die Pause ist heute ein Nebenprodukt der Zeitrechnung, kein Objekt. Sie könnte eines
werden: ein **Moment** an der Rampenmitte, mit einer Beschriftung wie „2 Stunden
später" oder „Kino". Momente gibt es bereits als Punkt-Ereignis
([edits.ts:107](../../server/src/schema/edits.ts#L107), eigene Engine-Phase in
[tour.ts:793](../../src/tour.ts#L793)), und `findePausen` liefert Ort und Dauer frei Haus
— beides steckt schon in der Pipeline, nichts davon müsste erfunden werden.

Drei Fragen, die vor dem Bauen zu klären sind:

1. **Automatisch anlegen oder nur anbieten?** Die Auto-Musikwahl schreibt beim ersten
   Verarbeiten ins Overlay und rührt es danach nie wieder an — dasselbe Muster würde
   hier passen (eine Pause ab, sagen wir, 45 Minuten bekommt einen Moment; wer ihn
   löscht, bekommt ihn nicht zurück). Die Gegenposition: Nicht jede Pause ist eine
   Geschichte. Eine Stunde Stau will niemand betont sehen.
2. **Hält der Film an?** Ein Moment ist in der Engine ein **Halt** — die Fahrt bremst,
   die Kamera agiert. Für eine Mittagspause ist das vielleicht richtig, für den Zeitraffer
   eher nicht: Dort ist die Bewegung durchs Rampenfenster ja gerade die Aussage. Denkbar
   wäre eine eigene Ausprägung „Zeitsprung", die den Text einblendet, ohne zu bremsen.
3. **Woher kommt der Text?** „2 Stunden später" kann die Pipeline rechnen. „Kino" nicht —
   das wäre ein Feld im Studio, und damit die erste Stelle, an der jemand einen Ort
   benennt, den die Tour selbst nicht kennt. Ein Foto aus der Pause (die es oft gibt,
   siehe die Testtour) wäre die schönere Antwort: Es steht ohnehin an dieser Zeit.

Passt zur Leitregel: „Pause zeigen" ist eine Entscheidung über die **Erzählung**, und die
Ausprägungen wären benannte Zustände (kein Text-Editor mit freier Positionierung).

---

## Was bewusst NICHT kommt

- **Linienstil frei wählbar** — gestrichelt trägt Bedeutung (s. Abschnitt 6).
- **Schriftwahl, Farbwähler, freie Positionierung** — Ausführung, nicht Erzählung.
- **Sticker/Emoji-Overlays** — macht aus der Reise ein Urlaubsvideo.
- **Zeitlupe/Wiederholung an einem Moment** — zu videohaft für eine Kamerafahrt.
- **Automatische Titel** — vom Nutzer abgelehnt; Titel sind manuell.

---

## Offene Fragen

1. **Beiläufige Fotos:** ein Foto kurz nebenbei, oder ein Schwung als kleine Collage?
   Das Zweite ist deutlich mehr Player-Arbeit (Platzierung, Überlappung, Timing).
2. **Look + Streckenthema:** eine gemeinsame „Stil"-Wahl oder zwei getrennte?
3. **Kapitel:** entsteht mit den Titeln ein echtes Objekt, oder bleibt es beim Klip?

## Empfohlene Reihenfolge

| Schritt | Warum zuerst |
|---|---|
| **Modus-Tabellen konsolidieren** | Voraussetzung für alles bei Fortbewegung |
| **Ambient-Ton je Modus** | kleinster Aufwand, größter Erlebnisgewinn |
| **Looks** | klein, in jedem Screenshot sichtbar, beantwortet die Freiheitsfrage praktisch |
| **Leere Bahnen kollabieren** | Voraussetzung für jede neue Spur |
| **Tempo-Spur** | größter erzählerischer Hebel, aber Engine + Dauerschätzung + Abspieler |
| **Foto-Betonung** | greift in die Tempo-Spur |
| **Titel-Spur** | danach ist aus den Looks klar, wie sich „benannte Zustände" anfühlen |
| **Talnebel** | spektakulärstes Bild aus vorhandener Höhen-Infrastruktur |
