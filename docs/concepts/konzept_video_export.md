# Konzept: Video-Export

**Ziel:** Aus einer fertigen Tour wird eine MP4, die man in WhatsApp, Instagram
und Co. schickt. Relive gewinnt oft über genau diesen Weg, nicht über den
Player-Link. Maptale hat den Link. Den Clip nicht.

Stand: **2026-08-17** · Status: **Etappe 1 gebaut und auf Player-Technik zurückgeführt,
nächste Etappe ist der Auftrag** ·
Betrifft: Web-Player (`src/exportfilm.ts`, `src/exportformat.ts`, `src/tour.ts`,
`src/main.ts`), Studio-UI (`src/studio/exportblatt.ts`), später API-Auftrag wie
der ZIP-Export, Android nur als Auslöser.

> **Lizenz-Vorbehalt (2026-08-17).** Dieses Konzept beschreibt die Technik. Mit
> **Esri-Kacheln im Bild ist die MP4 nach Aktenlage nicht zulässig**, weder ihre
> Herstellung im Cloud-Render noch ihre Verbreitung: Der Vertrag zählt erlaubte
> Endformen abschließend auf (ohne Video), verbietet Weitergabe an Dritte und
> untersagt programmatische Nutzung von Session-Tokens ausdrücklich am Beispiel
> des Kachel-Exports. Fundstellen und der Ausweg über eine zweite Bildquelle:
> [konzept_monetarisierung.md](konzept_monetarisierung.md) Abschnitte 3.5 und 8.
> Die Etappe 1 im Browser ist davon nicht berührt, der Auftrag in der Cloud
> schon. **Vor Etappe 2 die Bildquelle klären.**

Verwandt, aber anders:
- ZIP-Datenexport (Kontoeinstellungen, Art. 20 DSGVO). Bytes der Rohdaten, kein Film.
- ffmpeg in der Pipeline. Skaliert *Aufnahmen*, rendert nicht die Kamerafahrt.
- [ideen-inspiration.md](ideen-inspiration.md) §1 „Teilen als Clip“. Die Rohidee.
- [konzept_gleichlauf_player_editor.md](konzept_gleichlauf_player_editor.md). Die
  Filmuhr und `setzeFilm` sind die Vorbedingung. Ohne sie gäbe es nichts zu steppen.

---

## 1. Das Erlebnis in einem Satz

Zwei Dateien, nacheinander:

> **Der Film (jetzt):** Du tippst auf „Als Video“, wählst Hochkant oder Quer,
> und bekommst die Tour **in Player-Tempo**. Intro, Fahrt, Foto-Halte in voller
> Standzeit, Finale. Dasselbe Erlebnis wie im Player, als Datei.
>
> **Der Clip (danach):** dieselbe Tour, gerafft. Fahrt schneller, Fotos bleiben
> lesbar. Für Stories und Status.

Relive hat nur den Clip. Wir haben den Player, deshalb kommt der Film zuerst.
Eine Sekunde Foto-Halt (Relive-Takt) ist zu wenig, um ein Bild zu lesen.
`HOLD_HIDE` 5,2 s bzw. `display.holdS` bleibt.

Der Tab rendert vorerst selbst. Am Handy wartet man später auf Mail, wie beim
ZIP. Gerendert wird nicht im WebView.

---

## 2. Was Relive wirklich ist

Relive hat **kein** Gegenstück zu unserem Player. Das 3D-Erlebnis, das man
teilt, ist die gerenderte MP4. Darunter in der App:

- eine normale **2D-Karte** (zoomen, schieben), kostenlos
- eine **Memory-Map** (alle Touren auf einer Übersicht)
- Plus: **„Interactive route“**, die Spur in 3D erkunden. Ein Explorer, kein
  Film mit Filmuhr, Halten und Steuerleiste

Relive rafft die **ganze** Aktivität auf etwa **eine Minute** (eigene Zeile:
„1-minute videos“). Plus darf Tempo langsam/normal/schnell wählen. Eingebettete
Handy-Videos: max. 10 s das Stück, 60 s Summe. Kostenlos oft ohne Fotos im
3D-Film. Nach „erstellen“ wartet man. Rendern läuft auf AWS mit NVIDIA T4
(früher Windows, später Linux). Stand 2025: über 260 Millionen solcher Videos.

Wir haben es umgekehrt: der interaktive Film ist das Produkt, die Datei die
Ableitung. Relive hat die Ableitung als Produkt gebaut. Deshalb liefern wir
zuerst den Film 1:1, und den gerafften Clip als zweite Option.

Relive blendet die Karten-Quellen **kurz am Ende** ein, nicht dauerhaft über
der Fahrt. Das übernehmen wir (Esri erlaubt für Ausstellungen eine Credit-Tafel
am Ende). Relive hat dafür einen bezahlten ArcGIS-Vertrag. Wir nutzen heute die
anonyme World-Imagery-URL. Kommerziell und für öffentliche Aufrufe: Location
Platform, siehe [konzept_monetarisierung.md](konzept_monetarisierung.md).
Dieselben Namen, anderer Rhythmus. Der Player-Link kostet Esri pro Zuschauer,
die MP4 nach dem Rendern nicht.

---

## 3. Leitentscheidungen

1. **Erste Datei ist der Film in Player-Tempo.** Ganze Tour, `filmS` 1:1,
   Fotos mit voller Standzeit. Kein 10-s-Fenster, kein Relive-Minutenclip als
   v1. Tempo-Wahl (schneller, kürzere Datei) kommt danach. Stories und Status
   (15–60 s) warten auf diese Option. WhatsApp als Dokument nimmt die lange Datei.
2. **Das Handy rendert nicht.** MapLibre-Terrain liegt am Pixel 9 bei 22–26 fps.
   Ein WebView, der Tausende Frames stepped, wird heiß, langsam und gekillt.
   Relive rendert auf T4-Servern, das Telefon wartet. Wir auch, sobald der Grab
   im Tab sitzt. Bis dahin ist der Desktop-Tab der Probelauf.
3. **Ausgabe ist MP4 (H.264 + AAC).** Chrome-MediaRecorder liefert WebM.
   WhatsApp und Instagram nehmen das nicht zuverlässig. WebCodecs plus
   mediabunny (`fastStart: 'in-memory'`). Fehlt H.264: die Oberfläche sagt es,
   kein WebM-Download.
4. **Eine Leinwand, nicht `captureStream` der Karte.** MapLibre (WebGL),
   Atmosphäre, Wetter, Reiter, Foto-Karten. `map.getCanvas().captureStream()`
   verliert alles außer dem Satellitenbild. Export komponiert auf ein Ziel-Canvas.
5. **Der Export ist ein TAKTGEBER, kein zweiter Renderer.** Er sagt der Engine,
   welche Filmsekunde gerade ist — er rechnet sie nicht selbst aus. Nachgebaut
   wird nur, was im DOM liegt und deshalb nicht grabbar ist: Foto-Karte,
   Startscreen, Finale-Tafel. Alles andere ist Player-Code (§6 „Ein Takt").
6. **Pflicht-Attribution kurz am Ende**, nicht dauerhaft im Bild. Wortlaut aus
   denselben `attribution`-Feldern der Stil-Quellen
   ([src/karteninfo.ts](../../src/karteninfo.ts)), ohne Rollen-Präfix.
   Letzte 2 s, kurzer Fade, unten links. Relive-Muster.
7. **Autor, nicht Besucher.** Knopf im Studio (Bibliothek und Editor). Der
   öffentliche Player bleibt ein Player. Fremde bekommen den Link.
8. **Am Handy: Auftrag, Mail, Download.** Wie der ZIP-Export
   ([server/src/export.ts](../../server/src/export.ts)). Datei mit Frist, nicht
   ewig im Quota. Worker öffnet dieselbe Export-Seite. Scale-to-zero GPU:
   Cloud Run L4 in der EU (Datenschutz), nicht RunPod/Vast, nicht Hetzner-GEX
   auf Vorrat.
9. **Bild und Ton wie der Player.** Wetter und Atmosphäre sichtbar. Eine
   AAC-Spur: Studio-Musik, Motor, Wetter-Ton, SFX. Der Encode stepped (nicht
   Echtzeit), der Mix kommt aus `filmS`, nicht aus dem Live-Graphen.
10. **Ablauf wie der Player:** Intro-Orbit, Fahrt, Finale. Etappe 0 startete
    mitten in der Fahrt. Seit Etappe 1 ist der Ablauf vollständig.

---

## 4. Was v1 ist — und was bewusst nicht

### v1 (der Film)

| Fähigkeit | Ja |
|---|---|
| Ganze Tour in Player-Tempo 1× | ✓ |
| Intro, Fahrt, Finale | ✓ |
| Foto-Karte in voller Standzeit | ✓ |
| 16:9 und 9:16, Vorgabe 16:9 | ✓ |
| 720p und 1080p, Vorgabe 720p | ✓ |
| 24/30/50/60 fps, Vorgabe 30 | ✓ |
| MP4 H.264 + AAC | ✓ |
| Ton wie der Player (Musik, Motor, Wetter, SFX) | ✓ |
| Wetter und Atmosphäre im Bild | ✓ |
| Spur und Reiter | ✓ |
| Steuerleiste, Weg-zurück, Telemetrie, Startscreen: aus | ✓ |
| Attribution die letzten 2 s | ✓ |
| Studio-Blatt, Fortschritt, Download im Tab | ✓ |
| Nur eigene Tour, nur `ready` | ✓ |

### Nicht in v1

| Idee | Warum später / nie so |
|---|---|
| Geraffter Minutenclip / Tempo-Wahl | Zweite Option, sobald der Film steht. |
| 30-s-Fenster bei Tempo 1 | Ausschnitt statt Geschichte. |
| Encoding im Android-WebView | Thermik, Kill, 22–26 fps. App löst den Auftrag aus. |
| 4K, 1:1, 4:5 | Vier Formate reichen. |
| Wasserzeichen „Maptale“ | Attribution der Karten ist Pflicht, die Marke nicht. |
| Besucher exportiert fremde Tour | Rechte an Musik und Bildern. |
| RunPod/Vast als Worker | GPS und Fotos, keine Community-Rechner. |
| Zweites Kamera-Preset für Hochkant | Dieselbe Kamera, Fahrer in der Mitte, anderer Viewport. |

---

## 5. Formate

| Name | Quer | Hoch | Wann |
|---|---|---|---|
| 720p | 1280×720 | 720×1280 | **Vorgabe.** Kleiner Versand, schneller Encode. |
| 1080p | 1920×1080 | 1080×1920 | Schärfer, länger, größer. |

**Bildrate wählbar: 24 · 30 · 50 · 60, Vorgabe 30.** Fest bleibt, dass sie fest
IST — variable Bildrate bestraft WhatsApp.

Die Bildrate ist eine reine **Abtastung** und kein zweites Tempo: Alle
Glättungen der Kamera rechnen `1 − exp(−dt/τ)`, die exakte Lösung bei
konstantem Ziel. Bei 60 fps kommt dieselbe Bewegung heraus, nur doppelt so oft
gemessen — Filmlänge, Halte und Rampen ändern sich nicht. Genau das ist die
Zusage der Filmuhr, und deshalb kostet die Wahl auch keine zweite Zeitrechnung:
`format.fps` hängt an EINER Stelle und treibt Bildzahl, Engine-Schritt,
Overlay-Takt, Zeitstempel und die Bildrate der Spur.

Was sie sehr wohl kostet, ist WARTEZEIT. 98 % der Wandzeit ist das Warten auf
Kacheln, und das fällt je Bild an — 60 fps braucht also grob das Doppelte von
30 (Vier-Minuten-Film: ~16 statt ~8 Minuten). Die Oberfläche sagt das im ⓘ.

24 ist der Kino-Takt und macht den Film getragener; 50 ist die europäische
Entsprechung zu 60. Mehr als vier Werte wären eine Liste statt einer Wahl.

Dateiname: `maptale-<titel-slug>-<hoch|quer>-<1080|720>.mp4`, bei abweichender
Bildrate zusätzlich `-<fps>fps`. Der Regelfall behält damit seinen gewohnten
Namen, und zwei Fassungen derselben Tour überschreiben einander trotzdem nicht.

**Hochkant ist zuerst nur der Viewport.** Dieselbe FreeCamera in 9:16 zeigt mehr
Himmel und mehr Vordergrund. Fahrer bleibt in der Mitte. Kein extra Schnitt.
Nach den ersten Hochkant-Dateien entscheiden, ob die Distanz leicht runter muss.

**pixelRatio.** 720p darf 1,5× zeichnen (1080p-Framebuffer, unter 5 MP). 1080p
nicht zusätzlich mit 2× hochziehen (Konzept-Falle 7). Etappe 0 hat bei `pixelRatio: 1`
weiches Satellitenbild geliefert. 1,5 auf 720p plus Kamera nicht näher als
Faktor 0,9 (Walk liegt im Player bei 0,5 und überzoomt Esri) war die Korrektur.

---

## 6. Technik

### Ein Takt, nicht zwei Uhren

Der teuerste Fehler der ersten Fassung war nicht ein falscher Pixel, sondern
eine zweite Zeitrechnung. Der Export setzte `filmS` — und alles, was seine
eigene Uhr hat, lief daneben auf der WANDUHR weiter: die rAF-Schleife von
[weather.ts](../../src/weather.ts), das `setInterval` von
[atmosphere.ts](../../src/atmosphere.ts), deren Blenden. Ein Filmbild kostet
hier aber 0,3–2 s echte Zeit (Kachel-Idle). Also bekamen Partikel, Böen,
Wolkendrift und die Wetter-Blende pro 1/30 Filmsekunde bis zu einer halben
echten Sekunde Vorschub, in jedem Bild anders: Der Regen sprang, statt zu
fallen, und ein Wechsel von Gewitter auf klar, der am Bildschirm über Sekunden
blendet, war nach drei Bildern durch.

Es gilt dieselbe Regel wie im Player (CLAUDE.md, §8A des Gleichlauf-Konzepts):
**Was nicht an der Filmuhr hängt, muss ausdrücklich mitgehen.** Der Export ist
die dritte Bühne, auf der sie gilt:

- `Tour.exportTakt` hängt `tick` von der Wanduhr ab; der Encoder ruft
  `Tour.exportSchritt(1/30)` — und das ist DIESELBE `schritt`-Funktion, die
  `tick` ruft. Intro-Orbit, Anfahrt, Halte, Foto-Karte, Modus-Kanten, Finale:
  alles Player-Code. Der Übergang vom Orbit in die Fahrt ist `tour.begin()`,
  also der Griff, den auch „Tour starten" bedient.
- `weather.externerTakt(true)` + `weather.schritt(dt)`, `atmo.setzeTakt(1/30)`:
  dieselben `step`/`render`-Funktionen, andere Zeitquelle.
- Gemessen (Völklingen, `?export=1`): 5 Wetter-Zustände auf 4 encodete Frames.
  Vorher waren es ~100 Zustände auf 4 Frames.

Die EINZIGE Größe, die der Film anders rechnet als der Player, ist
`Tour.exportSkalaMin` — und die hat ihren Grund außerhalb der Engine (Falle 10,
Esri-Überzoom zu Fuß).

### Schichten

Der sichtbare Frame ist:

1. MapLibre-Canvas (WebGL, Terrain, 3D-Pins, **Routen-Layer**)
2. Atmosphäre (2D-Canvas)
3. Wetter (2D-Canvas)
4. Reiter (Canvas-Sprite je Modus, der DOM-Marker liegt nicht auf WebGL)
5. Foto-Karte plus Bildunterschrift (aus dem DOM gelesen, auf die Leinwand)
6. Startscreen- bzw. Finale-Tafel (dito, Inhalt aus denselben DOM-Elementen)
7. Attribution, nur in den letzten 2 s

Zur Abnahme liegt die Ziel-Leinwand als `window.__j.exportZiel`. Ein
Seiten-Screenshot zeigt genau die Schichten 4–7 nicht.

`body.export` blendet Chrome aus. `#atmosphere` und `#weather` dürfen **nicht**
auf `display: none` stehen, sonst ist der Grab leer. Die Overlay-Leinwände
müssen für den Encoder laufen.

### Filmachse, nicht Share-Achse (v1)

v1 liest `tour.filmS` 1:1. Eine zweite Abbildung Strecke → Clip-Zeit ist der
Clip (nach v1). Dann:

- Fahrt gerafft, Zieldauer grob eine Minute
- Foto-Halt bleibt lesbar (volle Standzeit oder klar länger als 1 s)
- Zahlen in einer Funktion, DOM-frei, getestet

E16 „Karte aus ab 2×“ gilt für den Player. Der Clip *ist* gerafft und soll die
Karte zeigen.

### Ablauf eines Frames (deterministisch)

```
t = i / 30                                  // Clip-Zeit
if (t >= 6 && phase === 'intro') tour.begin()   // derselbe Griff wie „Tour starten"
tour.exportSchritt(1/30)                    // = tour.schritt(dt), der Player-Weg
nachKamera()                                // Wetter der neuen Stelle
weather.schritt(1/30)                       // Partikel in FILMzeit
einen rAF später, 120 ms Pause, dann map.once('idle')
Komposition: Karte → Atmosphäre → Wetter → Reiter → Foto-Karte → Tafel → Attribution
VideoEncoder.encode(frame)
```

`preserveDrawingBuffer: true` am MapLibre-Kontext, nur im Export-Lauf. Sonst
ist `drawImage(mapCanvas)` leer.

Kein hartes erstes Frame mehr und keine längeren taus: Die Kamera läuft mit
`dt = 1/30` durch dieselbe Glättung wie im Player. Der frühere Bedarf danach
(„ein Hang im Rücken zog in einem Frame an") war ein Artefakt der springenden
Ansteuerung, nicht der Kamera.

Höhen (`sampleElevations`) vor dem Loop abwarten. Die Funktion schreibt
Wegpunkt-Höhen in-place. Kommt sie mitten im Loop an, sackt die Kamera ab.

### Tafeln und Foto-Karte

Startscreen, „Ziel erreicht" und die Foto-Karte liegen im DOM und lassen sich
nicht grabben — die einzigen Stellen, an denen der Export wirklich nachbaut.
Der INHALT kommt deshalb aus denselben Elementen, die der Player füllt
(`#intro-title`, `#chip-distance`, `#final-km`, …): Wer dort eine Zeile ändert,
ändert sie im Film mit. Die Blenden stehen DOM-frei in
[exportformat.ts](../../src/exportformat.ts) (`introTafelSicht`,
`finaleTafelSicht`) und tragen die Player-Zeiten (1,2 s bzw. 0,9 s).

Kein html2canvas. Zahlen in [src/einblendung.ts](../../src/einblendung.ts).
Der Export zeichnet Bild, Ken-Burns-Stand dieser Filmsekunde, Unterschrift.
Video im Halt: `videoStandS`. Rückwärts gibt es nicht.

### Ton

Eine AAC-Spur über die Filmdauer. Quellen wie der Player: Studio-Musik
(`musikVersatzS`), Motor, Wetter-Ton, SFX. Offline aus `filmS` mischen, nicht
den `AudioContext` des Players mitaufnehmen. Etappe 0 muxed nur Musik. Seit
Etappe 1 kommt der Mix aus denselben Quellen wie der Player.

### Wo der Code sitzt

[src/exportfilm.ts](../../src/exportfilm.ts) (Encoder, Komposition, mediabunny
per dynamischem Import). Zahlen und Formate in
[src/exportformat.ts](../../src/exportformat.ts), vom Studio ohne Encoder
gelesen. Player im Export-Modus: `Tour.stelleExportFrame` mit Intro/Fahrt/Finale,
Viewport aus dem Format (`body.export`). Studio-Blatt öffnet denselben Tab.
Kein Import Studio → Player-Chunk über die Editor-Typenwelt.

Produkt-Pfad nach dem Film im Tab: `POST` wie ZIP-Export, Worker lädt
`/export/<token>?format=`. Dieselbe Seite, anderer Auslöser.

### Wo die Wandzeit hingeht

Gemessen am Völklingen-Film (1 798 Bilder, 720p quer, M4, `window.__j.exportMess`),
Millisekunden je Bild:

| Posten | ms | Anteil |
|---|---|---|
| Kachel-Warten | 63,5 | 98,2 % |
| Engine-Schritt | 0,8 | 1,2 % |
| Komposition | 0,3 | 0,5 % |
| Encode | 0,1 | 0,2 % |

**Alles außer dem Warten ist bereits umsonst.** Der Engine-Schritt kostet
weniger als eine Millisekunde, das Komponieren dreier Leinwände 0,3 ms, und
mediabunny encodet schneller, als das Bild entsteht. Wer hier optimiert,
optimiert 1,9 % — an der Auflösung zu drehen bringt fast nichts.

Die 63,5 ms sind nach der Selbstjustierung (s. `Kachelwarten`) nur noch
STRUKTUR: 30 ms Mindestpause plus zwei `requestAnimationFrame` (2 × 16,7 ms bei
60 Hz). Der Zähler `nachgeladen` stand am Ende auf **0** — die Karte war nach
der Pause in jedem Bild vollständig, die Pause war in keinem Bild zu kurz.
Die feste 120-ms-Pause der ersten Fassung kostete dagegen 154 ms je Bild.

Weiter herunter ginge die Mindestpause, aber der Preis wäre nicht messbar: Ein
zu früh gegriffenes Bild ist ein UNSCHARFES Bild, und `areTilesLoaded()` sagt
dann trotzdem „fertig". Deshalb bleibt sie bei 30 ms, bis jemand eine Probe
hat, die Schärfe prüft und nicht Vollständigkeit.

In Zahlen: **~15 Bilder je Sekunde**, ein Vier-Minuten-Film also rund acht
Minuten Wandzeit. Zum Vergleich derselbe Lauf in einem zweiten, verdeckten
Tab: 0,15 Bilder je Sekunde (Falle 8) — der Grund, warum das Rendern in den
Studio-Tab gezogen ist.

Verdecken pausiert, der Lauf macht weiter sobald der Tab wieder sichtbar ist.
Die Oberfläche nennt Filmlänge, Frame und Restzeit, nicht nur „wird gerendert".

---

## 7. Oberfläche

Studio, zwei Stellen, dieselbe Aktion: Karten-Menü der Bibliothek, Datei-Menü
im Editor.

Ein Blatt, und es bleibt offen. Titel „Als Video exportieren", daneben ein ⓘ
mit dem, was das bedeutet (Player-Tempo, Dauer, Tab offen lassen) — als
Tooltip, der auf **Hover UND Fokus** aufgeht: Auf Touch gibt es kein Hover,
dort ist der Tipp die Geste, und ein `title`-Attribut kann beides nicht.

1. Vorschau: die **Routen-Signatur** vorn, das Titelbild gedämpft dahinter. Die
   Bühne behält dabei ihre Höhe, nur der Rahmen darin wechselt die Form — sonst
   wächst mit der Vorschau das ganze Blatt, und ein Modal, das beim Umschalten
   seine Höhe ändert, liest sich als Fehler (gemessen: 496 px in beiden
   Formaten, auch während der Umschaltung).
   Ein Foto beantwortet die falsche Frage — Fotos sehen einander ähnlich,
   Routen nicht, und exportiert wird die Route. Dieselbe Signatur wie auf der
   Bibliotheks-Kachel (`stats.spur`). Unten rechts im Bild die **Länge der
   Datei** als Plakette, dort wo man sie an jedem Video sucht; als graue Zeile
   unter dem Titel wurde sie übersehen.
2. Format: Hochkant / Quer. Vorgabe Quer.
3. Größe: 1080p / 720p. Vorgabe 720p.
   Bildrate: 24 / 30 / 50 / 60. Vorgabe 30.
4. Knopf „Video erzeugen" → **läuft sofort los**. Vor dem Start gibt es nichts
   zu verlieren; ein Blatt, das erst einen Hinweis wegklicken lässt, verlangt
   eine Zusage für eine Handlung ohne Folgen.
5. Danach **wird aus der Vorschau der laufende Renderer**, darunter Balken,
   „0:55 · Frame 336 von 1650" und „noch etwa 2 Minuten" → „Speichern"

**Gewarnt wird, wo etwas verloren geht — nicht davor.** Ein laufender Film ist
Minuten Rechnerei und mit einem Klick weg. Deshalb schärft sich der ABBRUCH — und zwar
als echte FRAGE mit zwei Antworten: „Ja, abbrechen" leise links, **„Weiter
rendern" als Hauptknopf mit dem Fokus**. Ein einzelner „Ja, abbrechen" war
keine Frage, sondern eine Sackgasse: Escape und der Klick daneben sind während
des Laufs gesperrt, wer es sich anders überlegte, hatte keinen Weg zurück.
Escape beantwortet die Rückfrage mit „weiter", nie mit „abbrechen". Sie liegt
dabei ÜBER dem Blatt und nicht darin: Im Fluss schob sie die Knöpfe nach unten
und ließ das Modal wachsen — ein Fenster, das sich beim Fragen verschiebt,
liest sich als Panne (gemessen: 457 px vorher wie nachher). Ein eigener Dialog
wäre die dritte Möglichkeit gewesen; dagegen spricht eine zweite Fokusfalle
über der ersten. Und
das Neuladen oder Schließen des Tabs fängt `beforeunload` ab — die einzige
Stelle, an der eine Seite das überhaupt kann, und der Kasten ist dem Nutzer
vertraut. Der Griff hängt exakt am Lauf: vor dem Start nicht gesetzt, im Lauf
aktiv, nach dem Abbruch und nach „fertig" wieder abgemeldet (nachgemessen über
`dispatchEvent(new Event('beforeunload', {cancelable: true})).defaultPrevented`).

**Die Aktionen stehen unten als Paar, es gibt kein × oben rechts.** Solange
nichts läuft, meinten beide exakt dasselbe — und zwei Wege für eine Sache sind
einer zu viel; ein beschriftetes Wort sagt einem Screenreader zudem mehr als
ein Zeichen. Der linke Knopf trägt vier Zustände: „Abbrechen" beim Entscheiden
und im Lauf, „Schließen", sobald es nichts mehr abzubrechen gibt. **Während des
Laufs schließen weder Escape noch der Klick daneben** — ein Fehlgriff kostete
sonst Minuten Rechnerei, beenden kann ihn nur der Knopf, der es auch sagt.

Der TOUR-NAME steht in Lesegröße unter dem Titel, nicht als Kleingedrucktes: Er
ist der Gegenstand des Blattes, „Als Video exportieren" nur die Handlung.

Der Fuß trägt **nicht** die tiefe Fläche von `.neu-fuss`: Die gehört zur
großen Upload-Arbeitsfläche, wo sie eine Leiste vom Inhalt trennt; auf einem
452-px-Blatt las sie sich als schwarzer Balken unter einer hellen Karte.

**Genannt wird die Länge der DATEI, nicht die der Fahrt** — Intro und Finale
gehören zum Film, und der Balken zählt später gegen dieselbe Zahl. Sie kommt
aus `stats.filmS` und `stats.finale`, die der Server beim Rendern schreibt
(dort steht die Achse ohnehin); das Studio-Blatt hätte weder die Wegpunkte noch
die Halte, um sie selbst zu bauen. Wie `spur` und `fotos` haben ältere Touren
sie erst nach ihrem nächsten Rendern — dann bleibt die Zeile beim Titel, statt
eine geratene Zahl zu nennen. Der EDITOR nimmt stattdessen seine eigene Achse:
Er kennt die AKTUELLE Länge samt ungespeicherter Schnitte, `stats.filmS` ist
die des letzten Renders.

Was nicht mehr im Blatt steht: die Ton-Zeile („Ton an. Musik, Motor …") und der
Absatz über Player-Tempo und Tab-Wechsel. Der erste beschrieb eine Wahl, die es
nicht gibt; der zweite steht als Tooltip am Titel und, wo er zählt, im
Hinweis vor dem Start.

**Gerendert wird IM Studio-Tab**, in einem gleich-origin `iframe` mit der
Export-Seite ([exportblatt.ts](../../src/studio/exportblatt.ts)). Drei Gründe,
und der erste wiegt am schwersten:

- **Ein zweiter Tab ist ein verdeckter Tab**, und der bekommt kaum noch Bilder
  (Falle 8): gemessen 0,15 statt 15 Bilder je Sekunde, Faktor 100. Der Tab, den
  jemand ansieht, ist der Studio-Tab.
- **Der Rahmen muss GEZEICHNET werden.** `display: none` und `visibility:
  hidden` liefern kein WebGL-Bild. Also ist er sichtbar — und damit aus der Not
  die Vorschau: Man sieht beim Warten zu, was entsteht.
- **Der Encoder bleibt drüben.** Der Rahmen ist genau die Grenze, die MapLibre
  und mediabunny aus dem Studio-Bundle hält.

Die fertige Datei geht als übergebener `ArrayBuffer` nach oben, nicht als
Download aus dem Rahmen: „Speichern" soll auch dann noch gehen, wenn die
Download-Leiste des Browsers längst weg ist. Abbrechen nimmt den Rahmen weg —
sein JavaScript stirbt mit ihm, ein „bitte aufhören" bräuchte einen
Abbruchpunkt in jeder Warteschleife und wäre trotzdem nie sofort.

Kein Start/Dauer-Regler. Die ganze Tour ist der Film. Tempo-Wahl ist ein
späterer Schalter auf demselben Blatt, nicht v1.

Dev-Weg bleibt: `?export=1` auf `/tour/t_<id>` (eigene, fertige Tour, Tab
sichtbar; `&rahmen=1` schaltet auf Meldungen statt Stand-Schild).

Fehler, bevor jemand rät: H.264 fehlt, Tab geschlossen oder vom Browser
verworfen, Tour nicht `ready`. Verdecken pausiert, bricht nicht ab.

---

## 8. Fallen

1. **`captureStream` der Karte ist nicht der Film.** Pins ja, Atmosphäre/Wetter/DOM-Karte/Spur/Reiter nein.
2. **WebM ist kein Teilen.** Ohne Muxer landet der Demo-Clip in einem Format, das der Messenger verweigert.
3. **Eine zweite Kamera-Pipeline driftet.** Die erste Fassung baute in `stelleExportFrame` Intro-Orbit, Finale-Orbit, Glide und die Phasenentscheidung nach — ~110 Zeilen neben `tick`, und genau dort liefen Verkehrsmittel-Wechsel, Halte-Verhalten und Foto-Karte auseinander. Es gibt jetzt eine Pipeline (`Tour.schritt`) und einen Takt. Der frühere Bedarf nach hartem erstem Frame und längeren taus („DEM-Kacheln und GPS-Ecken ziehen sonst in einem Frame an") war ein Artefakt der springenden Ansteuerung: Mit `dt = 1/30` glättet dieselbe Pipeline wie im Player. Preset-Keyframes (`kamFolger`) im Export weiterhin ignorieren.
4. **`idle` heißt nicht scharf.** Overview-Kacheln können matschig sein. Nach dem Kamerasprung erst ein Bild, 120 ms, dann idle. Sonst feuert idle auf den Kacheln der vorigen Pose. Zweites Snap nach idle nicht: genau dann kommt das Gelände an und die Kamera springt.
5. **Esri.** Client-Export ist die vorgesehene Nutzung. Viele Clips von einer Server-IP sind näher an einem Proxy. Server-D braucht Cache und ein Gespräch mit der Lizenz, bevor die Zahl groß wird. Attribution am Ende einbrennen.
6. **Nur eigene Touren.** Fremde exportieren hieße, Bilder und Stücke als Datei mitzugeben.
7. **`pixelRatio`.** 1080p-Canvas nicht zusätzlich mit 2× hochziehen. 720p mit 1,5 ist erlaubt.
8. **Verdeckt ist nicht versteckt — und ein DRITTER Zustand.** `visibilitychange` fängt nur den Tabwechsel. Ein sichtbarer Tab in einem VERDECKTEN oder unfokussierten Fenster meldet `document.hidden === false`, bekommt aber kaum noch Compositor-Frames: gemessen fiel derselbe Lauf von ~7 auf ~0,15 Bilder je Sekunde, weil `warteKartenFrame` zweimal auf `requestAnimationFrame` wartet. Der Lauf hängt also nicht, er kriecht — und die Oberfläche sagt nichts dazu. Für die Abnahme hilft Chrome headless mit `--use-angle=metal --enable-gpu`; fürs Produkt ist das ein Argument mehr für Etappe 2, und der Worker dort braucht denselben Schalter.
9. **Tab-Discard.** Verdecken pausiert den Loop (`visibilitychange`). WakeLock
   hält den Bildschirm wach, nicht den Tab. Wirft Chrome den Tab weg, ist der
   Lauf trotzdem tot. Schließen des Tabs ebenso.
10. **Walk ist zu nah für Esri.** `MODE_SCALE.walk` 0,5 überzoomt World Imagery. Export nicht näher als Faktor 0,9.
11. **Lange UI-Sätze.** „4:12 · Frame 240 von 7200“ erklärt den Preis, „wird gerendert“ nicht.
12. **Die Spur bleibt die der KARTE.** Eine eigene 2D-Linie über `map.project()` kennt das Gelände nicht und verbindet die Stützpunkte roh — sie wirkte kantiger und gröber als im Player und lag über dem Wetter statt darunter. Richtig ist `verstaerkeKartenSpur`: dieselben Layer, im Film etwas mehr Gewicht (die gestrichelte 2,4-px-Vorschau verschwindet aus der Filmkamera).
13. **Reiter-Größe UND Reiter-Modus.** Player-Puck 36 px war in der nahen Kamera ein Punkt, 64 px in der ferneren ein Ballon. 40 px. Und das Sprite wird JE MODUS gebacken: einmal vor der Schleife gebacken, blieb bis zum Ende das Symbol des ersten Fortbewegungsmittels stehen, obwohl `emitStats` den DOM-Marker brav umschaltete.
14. **`body.export` darf Overlay-Canvases nicht verstecken.** Sonst fehlen Wetter und Atmosphäre im Grab, obwohl der Code sie komponiert.
15. **Alles mit eigener Uhr muss auf Filmzeit umgestellt werden.** Nicht nur `filmS` setzen (s. „Ein Takt"). Wer eine neue Schleife anlegt — ein Partikel-Effekt, eine Blende, ein Zähler —, gibt ihr einen Schritt von außen, sonst rechnet sie im Film mit der Kachel-Wartezeit.
16. **Die Skalierung des Rahmens gehört an einen `ResizeObserver`.** Das Blatt ändert seine Breite mit einer Transition; einmal beim Start gemessen, stand neben der Vorschau ein schwarzer Streifen. Der Vergleich mit dem letzten Wert ist dabei Pflicht — der Observer feuert auch für Änderungen, die keine sind, und jedes Schreiben löst die nächste aus.
17. **Im Export darf nichts HÖRBAR sein.** Der Ton der Datei entsteht offline aus `filmS`; was der Live-Graph nebenher spielt, liefe auf der Wanduhr, während das Bild in Filmzeit entsteht — es gehörte zu keiner Stelle des Films. Ein einzelnes `setSoundEnabled(false)` reicht dafür NICHT: Der 800-ms-Tick in main.ts setzt den Wetter-Ton aus dem Audio-Master immer wieder neu, und die Ausblendrampe in `weather.step` läuft seit dem Takt in FILMzeit — sie bräuchte Dutzende Bilder, in denen es hörbar regnet. Also der Master global aus (`audioOn = false` im Export-Modus, deckt Motor, Musik und Tour-Spuren) UND `externerTakt(true)` setzt den Wetter-Ton hart auf null.
18. **Der Blickkasten der Signatur ist nicht der Kasten der Route.** Der 0..100-Kasten ist quadratisch, die Route füllt ihn selten aus — eine hohe Route saß dadurch sichtbar zu tief. `viewBox` aus `getBBox()` setzen, und zwar erst, wenn das Blatt SICHTBAR ist: In einem `display: none`-Teilbaum misst `getBBox()` nichts. Dazu braucht das `<svg>` volle Fläche und `xMidYMid meet` — ein `<svg>` ohne width/height-Attribut bemisst sich nicht an seinen `inset`-Werten, sondern an 100 % des Containers, und hing sonst unten heraus.
19. **Motor- und Wetterton sind ABSCHNITTE.** Sie entstehen aus der Filmachse und stoßen an jeder Modus-Kante und an jedem Halt aneinander. Hart geschnitten knackt jede Naht; im Player ist derselbe Wechsel ein Crossfade. `ExportTonKlip.blendeS`.

---

## 9. Etappen

### Etappe 0 — Probe, ohne Produkt-UI (gebaut)

Dev-Weg `?export=1`: feste ~10 s der ersten Filmsekunden, 720p quer, MP4.
Beweis, dass WebCodecs, Idle-Wait und Muxer auf *dieser* MapLibre-Version ein
teilbares File liefern.

### Etappe 1 — Der Film im Studio (gebaut)

Ganze Tour, Player-Tempo, Intro/Fahrt/Finale, beide Formate, beide Größen
(Vorgabe Quer 720p), Bild und Ton wie der Player, Studio-Blatt, Fortschritt.
Noch im Tab. `?export=1` bleibt der Dev-Weg, mit Lage und Größe in der Query.

**Nachgezogen 2026-08-17** — der Film war ein Nachbau, kein Auszug: Wetter
sprang, Gewitter→klar schnitt hart, das Fortbewegungsmittel wechselte nie, die
Spur war kantiger als im Player, der Startscreen fehlte. Ursache war beides
Mal dasselbe: eine zweite Uhr und ein zweiter Renderer. Siehe „Ein Takt" und
Fallen 3, 12, 13, 15, 16.

Abnahme: eigene Tour mit Foto und Musik. Quer 720p in QuickTime und als
WhatsApp-Dokument. Hochkant 720p ohne schwarze Balken. Intro und Finale in
der Datei. Wetter und Motor hör- bzw. sichtbar, wenn die Tour sie hat.

### Etappe 2 — Auftrag, damit das Handy geht

Derselbe Encoder, Worker (Cloud Run GPU L4, EU) öffnet `/export/<token>`.
UX wie ZIP: anfordern, Mail, Link mit Frist. App und Studio stoßen denselben
Auftrag an. Kein WebView-Encode. Bei Player-Tempo ist das Pflicht, sobald
Filme länger als ein kurzer Tab-Lauf sind.

### Etappe 3 — Tempo-Wahl, der Clip

Optional langsam/normal/schnell. Fahrt gerafft, Fotos bleiben lesbar. Das ist
der Relive-Minutenclip, nicht v1. Diskreter Abspann bleibt der 2-s-Einbrand.

---

## 10. Was wir nicht tun

- Keinen zweiten Player in Canvas oder MapLibre Native nachbauen. Die Engine bleibt `Tour`.
- Kein ffmpeg.wasm fürs Bild. ffmpeg packt höchstens, oder legt in einem Fallback Fotos über eine Map-Aufnahme.
- Keine Immer-an-GEX-Box für v1. Scale-to-zero, wenn der Auftrag kommt.
- Keine Echtzeit-Aufnahme als Produktlinie. Nur Flag, falls Idle-Wait scheitert.

---

## 11. GPU und Skala

GPU-Stunden sind billig (T4/L4 grob 0,50–0,70 $/h). Ein Minuten-Clip auf dem
Papier: Cent. Ein Film in Player-Tempo kostet ein Vielfaches, bleibt aber im
Cent-bis-Euro-Rahmen. Ein SaaS „hier MapLibre-Tour, bitte MP4“ gibt es nicht.
Browserless ist Scraping mit Software-WebGL. Shotstack klebt Fotos und Text.

Der Worker ist unser Export in Chrome auf einer NVIDIA-Karte (Vulkan, Dawn-Blocklist,
kein SwiftShader). Die skalierbare Schicht ist Cloud Run GPU in der EU.

Was kippt: Handy (Auftrag Pflicht), Esri von unserer IP, Daten in der EU.

Kaltstart 10–30 s ist egal, wenn die UX „Mail wenn fertig“ ist.

---

## 12. Kürzere Wege (nur Fallback)

Falls der Grab scheitert, nicht das Produkt umdefinieren, sondern den Grabber:

| Weg | Wann |
|---|---|
| **C. Echtzeit + ffmpeg** | Idle-Wait liefert kein scharfes Bild. Qualität folgt dem Gerät. |
| **B. Karten-Stills** | Auch C zittert. 8–12 Standbilder, ffmpeg blendet. |
| **A. Stories-Montage** | 3D-Grab unmöglich. Titel, Fotos, 2D-Spur. Nicht der Flug. |

A ist kein v1, nur der ehrliche Plan B für WhatsApp ohne Fahrt.

---

## 13. Auftrag für den nächsten Kontext

Etappe 2: Auftrag, damit das Handy geht. Kein WebView-Encode, keine Tempo-Wahl.

1. Konzept gelesen: diese Datei, besonders §3, §7, §9 Etappe 2, §11.
2. Derselbe Encoder. Worker öffnet die Export-Seite.
3. UX wie ZIP: anfordern, Mail, Link mit Frist.
4. App und Studio stoßen denselben Auftrag an.
