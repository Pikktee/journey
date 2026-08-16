# Konzept: Video-Export

**Ziel:** Aus einer fertigen Tour wird eine MP4, die man in WhatsApp, Instagram
und Co. schickt. Relive gewinnt oft über genau diesen Weg, nicht über den
Player-Link. Maptale hat den Link. Den Clip nicht.

Stand: **2026-08-16** · Status: **Etappe 0 gebaut, nächste Etappe ist der Film** ·
Betrifft: Web-Player (`src/exportfilm.ts`, `src/tour.ts`, `src/main.ts`),
Studio-UI, später API-Auftrag wie der ZIP-Export, Android nur als Auslöser.

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
am Ende). Relive hat dafür einen bezahlten ArcGIS-Vertrag. Wir nutzen die
öffentlichen Kacheln. Dieselben Namen, anderer Rhythmus.

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
   Atmosphäre, Wetter, Spur, Reiter, Foto-Karten. `map.getCanvas().captureStream()`
   verliert alles außer dem Satellitenbild. Export komponiert auf ein Ziel-Canvas.
5. **Die Filmuhr treibt den Encoder.** Pro Frame `filmS = i / 30`, `setzeFilm`,
   Kamera weich nachziehen, auf `idle` warten, grabben. Echtzeit-Aufnahme ist der
   Notnagel, falls Idle-Wait kein scharfes Bild liefert.
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
10. **Ablauf wie der Player:** Intro-Orbit, Fahrt, Finale. Die Probe startet
    mitten in der Fahrt. Das ist Etappe 0, nicht das Produkt.

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
| 30 fps | ✓ |
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
| 60 fps, 4K, 1:1, 4:5 | Vier Formate reichen. |
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

fps fest 30. Variable Bildrate bestraft WhatsApp.

Dateiname: `maptale-<titel-slug>-<hoch|quer>-<1080|720>.mp4`.

**Hochkant ist zuerst nur der Viewport.** Dieselbe FreeCamera in 9:16 zeigt mehr
Himmel und mehr Vordergrund. Fahrer bleibt in der Mitte. Kein extra Schnitt.
Nach den ersten Hochkant-Dateien entscheiden, ob die Distanz leicht runter muss.

**pixelRatio.** 720p darf 1,5× zeichnen (1080p-Framebuffer, unter 5 MP). 1080p
nicht zusätzlich mit 2× hochziehen (Konzept-Falle 7). Etappe 0 hat bei `pixelRatio: 1`
weiches Satellitenbild geliefert. 1,5 auf 720p plus Kamera nicht näher als
Faktor 0,9 (Walk liegt im Player bei 0,5 und überzoomt Esri) war die Korrektur.

---

## 6. Technik

### Schichten

Der sichtbare Frame ist:

1. MapLibre-Canvas (WebGL, Terrain, 3D-Pins)
2. Atmosphäre (2D-Canvas)
3. Wetter (2D-Canvas)
4. Spur (2D auf der Komposition, nicht die MapLibre-Linie)
5. Reiter (Canvas-Sprite, der DOM-Marker liegt nicht auf WebGL)
6. Foto-Karte plus Bildunterschrift (aus dem DOM gelesen, auf die Leinwand)
7. Attribution, nur in den letzten 2 s

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
filmS = i / 30   // v1: Player-Zeit, nicht Share-Achse
Tour.stelleExportFrame(filmS)   // Kamera weich, nicht hart
einen rAF später, 120 ms Pause, dann map.once('idle')
Komposition: Karte → Atmosphäre → Wetter → Spur → Reiter → Foto-Karte → Attribution
VideoEncoder.encode(frame)
```

`preserveDrawingBuffer: true` am MapLibre-Kontext, nur im Export-Lauf. Sonst
ist `drawImage(mapCanvas)` leer.

Erstes Frame: Kamera **hart** auf die Startpose (sonst bleibt der Intro-Orbit
hängen). Jedes folgende Frame: Smooth wie die Fahrt, mit längeren taus. DEM-Tuck
und Geländedeckel bleiben aus.

Höhen (`sampleElevations`) vor dem Loop abwarten. Die Funktion schreibt
Wegpunkt-Höhen in-place. Kommt sie mitten im Loop an, sackt die Kamera ab.

### Foto-Karte

Kein html2canvas. Zahlen in [src/einblendung.ts](../../src/einblendung.ts).
Der Export zeichnet Bild, Ken-Burns-Stand dieser Filmsekunde, Unterschrift.
Video im Halt: `videoStandS`. Rückwärts gibt es nicht.

### Ton

Eine AAC-Spur über die Filmdauer. Quellen wie der Player: Studio-Musik
(`musikVersatzS`), Motor, Wetter-Ton, SFX. Offline aus `filmS` mischen, nicht
den `AudioContext` des Players mitaufnehmen. Etappe 0 muxed nur Musik (oder
`/audio/ambient.mp3`, Gain 0,16, wenn die Tour keine eigene Spur hat).

### Wo der Code sitzt

[src/exportfilm.ts](../../src/exportfilm.ts) (DOM-arm wo möglich, mediabunny
per dynamischem Import). Player im Export-Modus: `Tour.stelleExportFrame`,
fester Viewport (`body.export`). Studio stößt an, öffnet kein zweites Fenster.
Kein Import Studio → Player-Chunk über die Editor-Typenwelt.

Produkt-Pfad nach dem Film im Tab: `POST` wie ZIP-Export, Worker lädt
`/export/<token>?format=`. Dieselbe Seite, anderer Auslöser.

### Zeit

Etappe 0 (10 s, 300 Frames) braucht auf dem Desktop bereits Minuten Wandzeit.
Ein Film von vier Minuten ist 7 200 Frames. Der Tab muss sichtbar bleiben.
Die Oberfläche nennt Filmlänge und Frame, nicht nur „wird gerendert“.

---

## 7. Oberfläche

Studio, zwei Stellen, dieselbe Aktion: Karten-Menü der Bibliothek, Datei-Menü
im Editor.

Ein Blatt:

1. Vorschau (Standbild, gewähltes Format)
2. Format: Hochkant / Quer. Vorgabe Quer.
3. Größe: 1080p / 720p. Vorgabe 720p.
4. Ton: an, wenn etwas zu hören ist, sonst aus und die Zeile sagt warum
5. Knopf „Video erzeugen“ → Balken (Filmzeit plus Frame i von n) → Download
   bzw. später „Mail wenn fertig“

Kein Start/Dauer-Regler. Die ganze Tour ist der Film. Tempo-Wahl ist ein
späterer Schalter auf demselben Blatt, nicht v1.

Dev-Weg bleibt: `?export=1` auf `/tour/t_<id>` (eigene, fertige Tour, Tab sichtbar).

Fehler, bevor jemand rät: Tab im Hintergrund, H.264 fehlt, Abbruch = Datei weg,
Tour nicht `ready`.

---

## 8. Fallen

1. **`captureStream` der Karte ist nicht der Film.** Pins ja, Atmosphäre/Wetter/DOM-Karte/Spur/Reiter nein.
2. **WebM ist kein Teilen.** Ohne Muxer landet der Demo-Clip in einem Format, das der Messenger verweigert.
3. **Kamera hart snappen wackelt.** Der Originalplan „ohne Smooth-Rest“ war falsch. DEM-Kacheln und GPS-Ecken ziehen sonst in einem Frame an. `stelleExportFrame` glättet Kurs, Standort und Höhe. Tuck und Geländedeckel aus. Preset-Keyframes (`kamFolger`) im Export ignorieren.
4. **`idle` heißt nicht scharf.** Overview-Kacheln können matschig sein. Nach dem Kamerasprung erst ein Bild, 120 ms, dann idle. Sonst feuert idle auf den Kacheln der vorigen Pose. Zweites Snap nach idle nicht: genau dann kommt das Gelände an und die Kamera springt.
5. **Esri.** Client-Export ist die vorgesehene Nutzung. Viele Clips von einer Server-IP sind näher an einem Proxy. Server-D braucht Cache und ein Gespräch mit der Lizenz, bevor die Zahl groß wird. Attribution am Ende einbrennen.
6. **Nur eigene Touren.** Fremde exportieren hieße, Bilder und Stücke als Datei mitzugeben.
7. **`pixelRatio`.** 1080p-Canvas nicht zusätzlich mit 2× hochziehen. 720p mit 1,5 ist erlaubt.
8. **Tab-Discard.** WakeLock plus sichtbare Fläche, sonst Abbruch.
9. **Walk ist zu nah für Esri.** `MODE_SCALE.walk` 0,5 überzoomt World Imagery. Export nicht näher als Faktor 0,9.
10. **Lange UI-Sätze.** „4:12 · Frame 240 von 7200“ erklärt den Preis, „wird gerendert“ nicht.
11. **MapLibre-Spur verschwindet.** Die gestrichelte 2,4-px-Linie auf dem Terrain ist bei diesem Blickwinkel unsichtbar. Spur auf die Komposition zeichnen (Rest hell, zurückgelegt orange), native Layer im Export aus.
12. **Reiter-Größe.** Player-Puck 36 px war in der nahen Kamera ein Punkt, 64 px in der ferneren ein Ballon. 40 px.
13. **`body.export` darf Overlay-Canvases nicht verstecken.** Sonst fehlen Wetter und Atmosphäre im Grab, obwohl der Code sie komponiert.

---

## 9. Etappen

### Etappe 0 — Probe, ohne Produkt-UI (gebaut)

Dev-Weg `?export=1`: feste ~10 s der ersten Filmsekunden, 720p quer, MP4.
Beweis, dass WebCodecs, Idle-Wait und Muxer auf *dieser* MapLibre-Version ein
teilbares File liefern.

Ist: Kamera geglättet, Spur auf dem Canvas, Reiter 40 px, Foto-Karte,
Musik-Spur, Attribution die letzten 2 s. Nicht: Intro/Finale, Motor/SFX,
Hochkant, Studio-Blatt, ganze Filmlänge.

Abnahme: Datei spielt in QuickTime und kommt als WhatsApp-Dokument an.

### Etappe 1 — Der Film im Studio

Ganze Tour, Player-Tempo, Intro/Fahrt/Finale, beide Formate, beide Größen
(Vorgabe Quer 720p), Bild und Ton wie der Player, Studio-Blatt, Fortschritt.
Noch im Tab.

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

Etappe 1: der Film. Kein Cloud Run, keine Tempo-Wahl, keine Share-Achse.

1. Konzept gelesen: diese Datei, besonders §3, §4, §6, §8, §9 Etappe 1.
2. Ganze Tour in Player-Tempo. Nicht nach 10 s abschneiden. Fotos volle Standzeit.
3. Intro, Fahrt, Finale. `stelleExportFrame` darf `phase=ride` nicht mehr erzwingen.
4. Bild wie der Player. Overlay-Canvases laufen. Spur bleibt auf der Komposition.
5. Ton wie der Player, eine AAC-Spur, Mix aus `filmS`.
6. Studio-Blatt: Hoch/Quer, 720p/1080p, Vorgabe Quer 720p. Hochkant = Viewport.
   Knopf in Bibliothek und/oder Editor. Fortschritt mit Filmlänge. `?export=1` bleibt Dev-Weg.
7. Nur eigene, fertige Touren. Attribution weiter nur kurz am Ende.
8. Encode im Tab. Tab sichtbar, WakeLock, Abbruch wenn verdeckt.

Nicht selbst `npm run dev` starten (devhub). Kein zweites Fenster. Deutsch.
Kein langer Gedankenstrich in neuen Texten.
