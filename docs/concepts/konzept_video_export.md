# Konzept: Video-Export

**Ziel:** Aus einer fertigen Tour wird eine MP4, die man in WhatsApp, Instagram
und Co. schickt. Relive gewinnt oft über genau diesen Weg, nicht über den
Player-Link. Maptale hat den Link. Den Clip nicht.

Stand: **2026-08-16** · Status: **Konzept, nichts gebaut** · Betrifft: Web-Player
(`src/tour.ts`, `src/main.ts`, Overlay-Canvases), Studio-UI, später API-Auftrag
wie der ZIP-Export, Android nur als Auslöser.

Verwandt, aber anders:
- ZIP-Datenexport (Kontoeinstellungen, Art. 20 DSGVO). Bytes der Rohdaten, kein Film.
- ffmpeg in der Pipeline. Skaliert *Aufnahmen*, rendert nicht die Kamerafahrt.
- [ideen-inspiration.md](ideen-inspiration.md) §1 „Teilen als Clip“. Die Rohidee.
- [konzept_gleichlauf_player_editor.md](konzept_gleichlauf_player_editor.md). Die
  Filmuhr und `setzeFilm` sind die Vorbedingung. Ohne sie gäbe es nichts zu steppen.

---

## 1. Das Erlebnis in einem Satz

> Du tippst auf „Als Video“, wählst Hochkant oder Quer, und bekommst eine MP4
> der **ganzen Tour**, gerafft auf etwa eine Minute. Die Fahrt fliegt, an den
> Fotos bleibt sie kurz stehen. Am Handy wartest du. Gerendert wird nicht im
> WebView.

Der Player bleibt Tempo 1. Der Share-Clip ist eine **zweite Achse** über
derselben Strecke: schneller unterwegs, an den Bildern lesbar.

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

Wir haben es umgekehrt: der interaktive Film ist das Produkt, der Clip die
Ableitung. Relive hat die Ableitung als Produkt gebaut.

---

## 3. Leitentscheidungen

1. **Ganze Tour, gerafft auf ~45–60 s.** Fahrt im Zeitraffer, Foto-Halt kurz
   (rund 1 s, nicht die 5,2 s des Players). Nicht ein 30-s-Fenster bei
   Player-Tempo. Zieldauer fest: ~1 500–1 800 Frames, unabhängig von der
   Tourlänge. Eine lange Tour kostet denselben Encode wie eine kurze.
2. **Das Handy rendert nicht.** MapLibre-Terrain liegt am Pixel 9 bei 22–26 fps.
   Ein WebView, der 1 800 Frames stepped, wird heiß, langsam und gekillt.
   Relive rendert auf T4-Servern, das Telefon wartet. Wir auch, sobald Etappe 0
   bewiesen hat, dass der Grab ein teilbares MP4 liefert. Bis dahin ist der
   Desktop-Tab der Probelauf, nicht das Produkt auf dem Telefon.
3. **Ausgabe ist MP4 (H.264 + AAC).** Chrome-MediaRecorder liefert WebM.
   WhatsApp und Instagram nehmen das nicht zuverlässig. WebCodecs plus ein
   MP4-Muxer (z. B. mediabunny). Fehlt H.264: WebM als Notausgang, oder
   „in Chrome / Safari“.
4. **Eine Leinwand, nicht `captureStream` der Karte.** MapLibre (WebGL),
   Atmosphäre, Wetter, Foto-Karten (DOM), Attribution. `map.getCanvas().captureStream()`
   verliert alles außer dem Satellitenbild. Export komponiert auf ein Ziel-Canvas.
5. **Die Filmuhr treibt den Encoder.** Pro Frame die Share-Achse nach `filmS`,
   `setzeFilm`, warten auf `idle`, grabben. Echtzeit-Aufnahme ist der Notnagel,
   falls Etappe 0 scheitert: ehrlich „läuft in Echtzeit, Qualität je nach Gerät“.
6. **Pflicht-Attribution ist eingebrannt**, immer, klein, unten. Wortlaut aus
   denselben `attribution`-Feldern der Stil-Quellen
   ([src/karteninfo.ts](../../src/karteninfo.ts)).
7. **Autor, nicht Besucher.** Knopf im Studio (Karte und Editor). Der öffentliche
   Player bleibt ein Player. Fremde bekommen den Link.
8. **Am Handy: Auftrag, Mail, Download.** Wie der ZIP-Export
   ([server/src/export.ts](../../server/src/export.ts)). Datei mit Frist, nicht
   ewig im Quota. Worker öffnet dieselbe Export-Seite. Scale-to-zero GPU:
   Cloud Run L4 in der EU (Datenschutz), nicht RunPod/Vast, nicht Hetzner-GEX
   auf Vorrat.

---

## 4. Was v1 ist — und was bewusst nicht

### v1

| Fähigkeit | Ja |
|---|---|
| Ganze Tour, Share-Achse ~45–60 s | ✓ |
| 16:9 und 9:16, Vorgabe 9:16 | ✓ |
| 720p und 1080p, Vorgabe 1080p | ✓ |
| 30 fps | ✓ |
| MP4 H.264, Studio-Musik wenn vorhanden | ✓ |
| Foto-Karte kurz im Bild (~1 s) | ✓ |
| Steuerleiste, Weg-zurück, Telemetrie, Startscreen: aus | ✓ |
| Attribution eingebrannt | ✓ |
| Etappe 0: Desktop-Tab. Produkt: Auftrag wie ZIP | ✓ |
| Nur eigene Tour, nur `ready` | ✓ |

### Nicht in v1

| Idee | Warum später / nie so |
|---|---|
| 30-s-Fenster bei Tempo 1 | Relive macht das nicht. Ausschnitt statt Geschichte. |
| Player-Länge 1:1 als Datei (8 min Film) | Zu lang für Stories, zu teuer im Encode. |
| Highlight-Montage mit Sprüngen (Intro / ein Orbit / Finale) | Zweiter Schnitt. Die Share-Achse fährt durch. |
| Encoding im Android-WebView | Thermik, Kill, 22–26 fps. App löst den Auftrag aus. |
| 60 fps, 4K, 1:1, 4:5 | Stories sind 9:16 1080p. |
| Motor, Wetter-SFX, Video-Ton gemischt | Erster Ton: Studio-Musik. |
| Wasserzeichen „Maptale“ | Attribution der Karten ist Pflicht, die Marke nicht. |
| Besucher exportiert fremde Tour | Rechte an Musik und Bildern. |
| RunPod/Vast als Worker | GPS und Fotos, keine Community-Rechner. |

---

## 5. Formate

| Name | Quer | Hoch | Wann |
|---|---|---|---|
| 720p | 1280×720 | 720×1280 | langsames Gerät, kleiner Versand |
| 1080p | 1920×1080 | 1080×1920 | Vorgabe |

fps fest 30. Variable Bildrate bestraft WhatsApp.

Export-Viewport = genau diese CSS-Größe, `devicePixelRatio = 1` auf dem
Ziel-Canvas. `targetPixelRatio()` und `MAX_RENDER_MP` gelten der Wiedergabe.
1080×1920 liegt unter 2,1 MP, unter dem Füllraten-Deckel von 5 MP.

**Hochkant ist eine andere Komposition.** Dieselbe FreeCamera in 9:16 zeigt mehr
Himmel und mehr Vordergrund. In v1 kein zweites Kamera-Preset. Nach dem ersten
Probeexport entscheiden, ob die Distanz in 9:16 leicht runter muss.

---

## 6. Technik

### Schichten

Der sichtbare Frame ist mindestens vier Oberflächen:

1. MapLibre-Canvas (WebGL, Terrain, Route, 3D-Pins im selben Kontext)
2. Atmosphäre (2D-Canvas)
3. Wetter (2D-Canvas)
4. Foto-Karte plus Bildunterschrift (DOM, Fortschritt über `--karte-zeit`)

Ein Encoder sieht eine Fläche und eine Spur. Alles andere muss vorher darauf.

### Share-Achse

Nicht `filmS` des Players 1:1. Eine zweite Abbildung Strecke → Clip-Zeit:

- Fahrt: so gerafft, dass Fahrt + kurze Foto-Halte + Intro/Ende ≈ 45–60 s
- Foto-Halt im Clip: rund 1 s sichtbar (Inhalt), nicht `HOLD_HIDE` 5,2 s
- Intro/Finale: kurz, nicht die Player-Orbits in voller Länge
- Zahlen in einer Funktion, DOM-frei, getestet. Player und Encoder lesen sie.

### Ablauf eines Frames (deterministisch)

```
clipS = i / 30
filmS = shareAchse.filmBeiClip(clipS)
Tour.setzeFilm(filmS)
Kamera ohne Smooth-Rest
map.triggerRepaint()
warten auf map.once('idle')
einen rAF später
Komposition: Karte → Atmosphäre → Wetter → Foto-Karte → Attribution
VideoEncoder.encode(frame)
```

Der Smooth-Filter in `tour.ts` ist Wiedergabe. Im Export steht die Kamera auf
dem Ziel der Filmsekunde.

`preserveDrawingBuffer: true` am MapLibre-Kontext, nur im Export-Lauf. Sonst
ist `drawImage(mapCanvas)` leer.

### Foto-Karte

Kein html2canvas. Zahlen in [src/einblendung.ts](../../src/einblendung.ts).
Der Export zeichnet Bild, Ken-Burns-Stand dieser Filmsekunde, Unterschrift.
Pixelgenau zum Player ist v1 nicht schuldig. Ohne die Karte ist der Clip eine
Kamerafahrt ohne Anlass. Video im Halt: `videoStandS`. Rückwärts gibt es nicht.

### Ton

Studio-Musik über die Clip-Dauer, zugeschnitten. `musikVersatzS` in
[src/audiotracks.ts](../../src/audiotracks.ts). Keine Musik: stumm, nicht eine
Lücke. Offline-Decode, nicht den `AudioContext` des Players mitaufnehmen.

### Wo der Code sitzt

`src/exportfilm.ts` (DOM-arm wo möglich). Player im Export-Modus: derselbe
`Tour`-Stand, fester Viewport (`body.export`). Studio stößt an, öffnet kein
zweites Fenster. Kein Import Studio → Player-Chunk über die Editor-Typenwelt.

Produkt-Pfad nach Etappe 0: `POST` wie ZIP-Export, Worker lädt
`/export/<token>?format=`. Dieselbe Seite, anderer Auslöser.

### Zeit

~60 s × 30 fps ≈ 1 800 Frames. Pro Frame Kachel-Idle: warm 30–80 ms, kalt mehr.
Grobe Erwartung Desktop: **zwei bis sechs Minuten** für den Minuten-Clip.
Messwert erst nach Etappe 0.

---

## 7. Oberfläche

Studio, zwei Stellen, dieselbe Aktion: Karten-Menü der Bibliothek, Datei-Menü
im Editor.

Ein Blatt:

1. Vorschau (Standbild, gewähltes Format, Attribution)
2. Format: Hochkant / Quer
3. Größe: 1080p / 720p
4. Ton: an, wenn Musik da ist, sonst aus und die Zeile sagt warum
5. Knopf „Video erzeugen“ → Balken (Frame i von n) → Download bzw. „Mail wenn fertig“

Kein Start/Dauer-Regler. Die ganze Tour ist der Clip.

Dateiname: `maptale-<titel-slug>-<hoch|quer>-<1080|720>.mp4`.

Fehler, bevor jemand rät: Tab im Hintergrund (nur Etappe-0-Tab), H.264 fehlt,
Abbruch = Datei weg, Tour nicht `ready`.

---

## 8. Fallen

1. **`captureStream` der Karte ist nicht der Film.** Pins ja, Atmosphäre/Wetter/DOM-Karte nein.
2. **WebM ist kein Teilen.** Ohne Muxer landet der Demo-Clip in einem Format, das der Messenger verweigert.
3. **Smooth-Kamera und Seek.** Filter umgehen oder vor dem ersten Frame einschwingen.
4. **`idle` heißt nicht scharf.** Overview-Kacheln können matschig sein. v1 wartet auf idle. Wenn Probeexporte weich sind: kurze Mindestwarte plus `repaint`, kein Qualitätsregler in der UI.
5. **Esri.** Client-Export ist die vorgesehene Nutzung. Viele Clips von einer Server-IP sind näher an einem Proxy. Server-D braucht Cache und ein Gespräch mit der Lizenz, bevor die Zahl groß wird. Attribution immer einbrennen.
6. **Nur eigene Touren.** Fremde exportieren hieße, Bilder und Stücke als Datei mitzugeben.
7. **`pixelRatio`.** 1080p-Canvas nicht zusätzlich mit 2× hochziehen.
8. **Tab-Discard** (nur Desktop-Probe). WakeLock plus sichtbare Fläche, sonst Abbruch.
9. **Share-Achse ≠ Player-Tempo.** E16 „Karte aus ab 2×“ gilt nicht. Der Clip *ist* gerafft und soll die Karte zeigen.
10. **Lange UI-Sätze.** „Frame 240 von 1800“ erklärt den Preis, „wird gerendert“ nicht.

---

## 9. Etappen

### Etappe 0 — Probe, ohne Produkt-UI

Dev-Knopf: feste ~10 s der Share-Achse (oder der ersten Filmsekunden, wenn die
Achse noch fehlt), 720p quer, stumm, nur Karte + Attribution, MP4.
Beweis, dass WebCodecs, Idle-Wait und Muxer auf *dieser* MapLibre-Version ein
teilbares File liefern. Scheitert das: Notnagel Echtzeit-Aufnahme, oder Halt.

Abnahme: Datei spielt in QuickTime und kommt als WhatsApp-Dokument an (nicht
„kann nicht wiedergegeben werden“).

### Etappe 1 — Share-Clip am Desktop

Share-Achse ~45–60 s, beide Formate, beide Größen, Foto-Karte, Musik,
Studio-Blatt, Fortschritt. Noch im Tab, nur um den Encoder an echten Touren
zu härten.

Abnahme: eigene Tour mit Foto, 9:16 1080p, Datei teilt sich in WhatsApp (iOS)
und liegt in Instagram Stories ohne schwarze Balken.

### Etappe 2 — Auftrag, damit das Handy geht

Derselbe Encoder, Worker (Cloud Run GPU L4, EU) öffnet `/export/<token>`.
UX wie ZIP: anfordern, Mail, Link mit Frist. App und Studio stoßen denselben
Auftrag an. Kein WebView-Encode.

### Etappe 3 — Ton-Mix, Tempo-Wahl, Marken-Ende

Motor/Wetter/SFX. Optional langsam/normal/schnell wie Relive Plus. Diskreter
Abspann.

---

## 10. Was wir nicht tun

- Keinen zweiten Player in Canvas oder MapLibre Native nachbauen. Die Engine bleibt `Tour`.
- Kein ffmpeg.wasm fürs Bild. ffmpeg packt höchstens, oder legt in einem Fallback Fotos über eine Map-Aufnahme.
- Keine Immmer-an-GEX-Box für v1. Scale-to-zero, wenn der Auftrag kommt.
- Keine Echtzeit-Aufnahme als Produktlinie. Nur Flag, falls Etappe 0 an Idle-Wait scheitert.

---

## 11. GPU und Skala

GPU-Stunden sind billig (T4/L4 grob 0,50–0,70 $/h). Ein Minuten-Clip auf dem
Papier: Cent. Ein SaaS „hier MapLibre-Tour, bitte MP4“ gibt es nicht.
Browserless ist Scraping mit Software-WebGL. Shotstack klebt Fotos und Text.

Der Worker ist unser Export in Chrome auf einer NVIDIA-Karte (Vulkan, Dawn-Blocklist,
kein SwiftShader). Die skalierbare Schicht ist Cloud Run GPU in der EU.

5 000 Konten, jedes zweite exportiert zweimal im Monat, drei Minuten GPU:
unter 100 $ im Monat. Relives Tausender-Rechnung ist 22 Millionen Menschen.
Was kippt: Handy (Auftrag Pflicht), Esri von unserer IP, Daten in der EU.

Kaltstart 10–30 s ist egal, wenn die UX „Mail wenn fertig“ ist.

---

## 12. Kürzere Wege (nur Fallback)

Falls Etappe 0 scheitert, nicht das Produkt umdefinieren, sondern den Grabber:

| Weg | Wann |
|---|---|
| **C. Echtzeit + ffmpeg** | Idle-Wait liefert kein scharfes Bild. Qualität folgt dem Gerät. |
| **B. Karten-Stills** | Auch C zittert. 8–12 Standbilder, ffmpeg blendet. |
| **A. Stories-Montage** | 3D-Grab unmöglich. Titel, Fotos, 2D-Spur. Nicht der Flug. |

A ist kein v1, nur der ehrliche Plan B für WhatsApp ohne Fahrt.

---

## 13. Auftrag für den nächsten Kontext

Nur Etappe 0. Keine Studio-UI, kein Cloud Run, keine Share-Achse-Feinarbeit.

1. Konzept gelesen: diese Datei, besonders §3, §6, §8, §9 Etappe 0.
2. Dev-Weg: `body.export` oder Query `?export=1` auf einer eigenen Tour.
   Viewport 1280×720, Chrome aus, `preserveDrawingBuffer`.
3. ~10 s steppen: `setzeFilm`, `idle`, Komposition Karte (+ Attribution-Text).
4. WebCodecs H.264 + MP4-Muxer. Download.
5. Abnahme: QuickTime + WhatsApp (iOS). Scheitert H.264: dokumentieren, nicht
   die Oberfläche bauen.

Nicht selbst `npm run dev` starten (devhub). Kein zweites Fenster. Deutsch.
Kein langer Gedankenstrich in neuen Texten.
