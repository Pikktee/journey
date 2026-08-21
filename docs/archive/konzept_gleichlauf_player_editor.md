---
stand: 2026-08-21
status: abgearbeitet — Pakete A bis G gebaut, §9 am 14.08. erledigt. §10 und §11 waren nie gebaut und stehen seit dem 2026-08-21 als eigene Konzepte (konzept_editor_stimmung_wetter.md, konzept_feinplatzierung.md)
betrifft:
  - src/ (Player)
  - src/studio/
  - server/src/pipeline/
archiviert_aus: concepts
---

# Gleichlauf: ein Film, zwei Bühnen

**Ziel:** Der Studio-Editor zeigt denselben Film wie der Player — so genau, dass man **auf
den Takt der Musik schneiden** kann. Heute weicht er an drei Achsen ab: hörbar (bis v0.60.4),
sichtbar (bis heute) und zeitlich (9–13 %).

> Dieses Blatt ersetzt `konzept_filmzeit_player.md` und `konzept_geteilte_schichten.md`, die
> am 12.08. kurzzeitig nebeneinander standen. Sie mussten zusammen gelesen werden und liefen
> **innerhalb einer Stunde auseinander** — eine Entscheidung im einen Papier erreichte das
> andere nicht. Genau der Fehler, den dieses Konzept im Code behebt.

---

## 1. Entscheidungen

Was hier steht, ist **nicht mehr ergebnisoffen**. Wer das Papier prüft, prüft die Herleitung
und die Umsetzbarkeit — nicht die Richtung.

| # | Entschieden | Am | Folge |
|---|---|---|---|
| E1 | **Bild und Ton hängen an EINER Uhr.** Die Filmzeit kommt aus der Echtzeit, nicht aus aufsummierten, gedeckelten Frames | 12.08. | Etappe 1; auf langsamen Geräten springt das Bild künftig, statt zu schleichen |
| E2 | **Die Position folgt der Filmzeit**, nicht umgekehrt | 12.08. | Etappe 4; Anfahren/Ausrollen werden eine Form IN der Kurve statt einer emergenten Rampe |
| E3 | **Eine geteilte Filmachse** als Modul, von Player UND Studio importiert | 12.08. | Etappe 3; drei Kopien werden zwei |
| E4 | **`f` wird über die Wegpunkte abgebildet**, nicht über `f × route.total` | 12.08. | Etappe 2 |
| E5 | **Musik startet und endet in Player und Editor gleich, framegenau** — Schneiden auf den Takt muss möglich sein | 12.08. | macht E2 zur **Pflicht**; schließt die billige Rampen-Nachbildung aus (§4) |
| E6 | **Kein sichtbares Taktraster.** Stattdessen framegenaue Platzierung über Zahlenfelder und Tastatur | 12.08. | §11 statt BPM-Erkennung — deutlich kleiner |
| E7 | **Tag/Nacht kommt in den Editor**, als Raster-Grading. Wetter danach, mit Schalter | 12.08. | §10 |
| E8 | **Die Szene-Regeln werden geteilt, die Darstellung nicht** | 12.08. | §9; ein gemeinsames DOM-Bauteil ist ausdrücklich NICHT gewollt |
| E9 | **Die Filmachse wird NICHT ins Tour-JSON exportiert** — Film-ANKER je Ereignis dagegen schon (E10) | 12.08., präzisiert 13.08. | §12 |
| E10 | **Das Tour-JSON bekommt additive Film-Felder je Ereignis** (Filmsekunde neben `f0`/`f1`) | 13.08. | §5.1; ohne sie ist E5 im Format nicht ausdrückbar. Gehört **hinter** Etappe 4 (§12) |
| E11 | **Der Server schickt `f` je ausgeliefertem Wegpunkt mit** — statt `f` künftig auf der vereinfachten Geometrie zu messen | 13.08. | §8D; additiv, ändert keinen Bestands-Render — greift dafür erst nach dem nächsten Render |
| E12 | **Die geteilte Achse wird über der STRECKE parametrisiert**, nicht über der Aufnahmezeit | 13.08. | **Vorbedingung von E2**, keine Wahl (§8C). Macht Etappe 3 zum teuersten Schritt und legt sie auf den kritischen Pfad |
| E13 | **Rückwärts fährt über dieselbe Kurve — Halte inklusive.** Kein zweiter Zeitbegriff, keine `dir`-Sonderfälle | 14.08. | Etappe 4 wird KLEINER: `nextIdx`, `syncNextIdx`, Bremsweg-Vorgriff und die `dir > 0`-Schranken entfallen (§12) |
| E14 | **Die Rampe wird eine feste Form über eine feste STRECKE** (ease-in-out), nicht die nachgebaute Exponentialkurve | 14.08. | Etappe 4; Halt-Breite wird exakt, die Rampe im Studio zeichenbar. Länge wird an den heutigen Werten kalibriert (§14) |
| E15 | **Die Foto-Karte hängt auch im Player an der POSITION**, nicht an der Wanduhr — sie erscheint und animiert deshalb auch rückwärts | 14.08. | Etappe 4, DOM-Seite; erledigt zugleich den offenen Ken-Burns-Eintrag (§6C) und die leere Karte beim Scrubben |
| E16 | **Schnelllauf 8× in beiden Bühnen** — dazu die Editor-Regeln: Ton nur bei Tempo 1, Karte aus ab 2× | 14.08. | Etappe 4; macht den fehlenden Ton-Ausgleich beim `shuttle` gegenstandslos |
| E17 | **Die Bedienung liegt über dem Bild**, nicht darunter — Steuerleiste und Fortschrittsleiste über der Foto-Karte | 14.08. | Folge von E15 (§12, Etappe 4); heute umgekehrt (`.photo-layer` 25 gegen `.dock` 20), was nur trug, weil die Karte beim Scrubben verschwand |
| E18 | **Die Halt-Fläche ist Anzeige, nicht Griff.** Der Griff bleibt der Punkt, und er sitzt an der ANKUNFT des Halts | 14.08. | Etappe 5; die Fläche ist `pointer-events: none` — sonst spränge ein Tipp in ihrer Mitte auf die Ankunft, und die Breite wäre zwar zu sehen, aber nicht anzufahren (s. u.) |
| E19 | **Das Höhenprofil wird filmäquidistant abgetastet**, nicht in gleichen Metern | 14.08. | Etappe 5; Halte werden dadurch zu Plateaus, `yAt` nimmt seither einen FILManteil. Ein metrisches Profil unter einem filmlinearen Playhead zeigte an jeder Stelle eine Höhe, die der Kopf zu einer anderen Zeit erreicht |

## 2. Offene Punkte

- **Bleibt der Zuschauer-`mult` (2×/4×)?** Als Faktor auf die Filmzeit bleibt der Schnitt in
  sich stimmig — aber ein Schalter, der die Filmdauer halbiert, ist eine bewusste Ausnahme
  vom Taktversprechen (E5). Unter E13 ist er ein Faktor auf `dtFilm` und sonst nichts; die
  Frage ist nur noch, ob er BLEIBT.
- ~~**Ken Burns: welche Zahl stimmt?**~~ **Erledigt mit E15 (14.08.)**, und zwar von
  selbst, wie vermutet: Beide Seiten ziehen ihren Fortschritt aus derselben Filmzeit, und
  die Dauer IST die Klip-Länge (`klipDauerS` = Standzeit + Ausblendung, also `holdS + 0.8`).
  Die 1,8 des Players hatten keine Absicht hinter sich — es gibt jetzt keine zwei Dauern
  mehr, die man vergleichen könnte.
- **Steht der Wetter-Schalter im Editor anfangs an oder aus?** Aus wäre ruhiger beim
  Schneiden, an wäre ehrlicher zum Film.
- **Bekommen die Halte in der Player-Leiste MINIATUREN** (wie die Klip-Kette im Editor)?
  Ihre Breite ist keine Frage mehr — sie folgt aus Etappe 5 (s. dort). Ein Bild darin ist
  eine eigene Sache: Es macht die Leiste zur Übersicht über den Film statt zu einer Skala,
  kostet aber Kacheln, Platz und eine Entscheidung, was auf einem Telefon davon übrig
  bleibt. Später, nicht in G.
- **Wird die Beschriftungskarte angeglichen?** Player zeigt Titel/Caption/km/Zähler, Editor
  Caption/Typ/Uhrzeit ohne Zähler. Bewusste Informationsarchitektur je Seite — oder
  ungeprüfte Abweichung. Nicht entschieden.
- **Zieht das Tageszeit-Symbol nach?** Mit echtem Grading daneben ist die Begründung für die
  Stunden-Heuristik schwächer.
- **`resumeAt` in [tour.ts](../../src/tour.ts) hat keinen Aufrufer.** Beim Umbau löschen,
  nicht mitmigrieren.

---

## 3. Die Leitregel

> **Geteilt wird, was der FILM ist. Getrennt bleibt, was die BÜHNE ist.**

Und die Grenze zwischen den Bühnen ist nicht „2D gegen 3D", sondern:

> **Die Editor-Karte ist ein Instrument, das man anfasst. Die Player-Karte ist ein Bild, das
> man ansieht.**

Daraus folgt die wichtigste Absage dieses Papiers: **keine gemeinsame Engine mit einem
2D/3D-Schalter.** Von fünf Schichten hinge der Schalter an genau einer (der Atmosphäre) — und
was an einer Stelle gelesen wird, braucht keinen Engine-Begriff. Die tragfähige Form ist ein
Stapel einzeln benutzbarer Module, den zwei Bühnen verschieden zusammensetzen: genau das
Muster, das [audiotracks.ts](../../src/audiotracks.ts) heute schon hat.

Dass die Trennung tragbar ist, hat einen praktischen Beleg: Den echten Film gibt es im Editor
bereits auf einen Klick — „Vorschau" verlinkt den Player im selben Tab
([editor.ts](../../src/studio/editor.ts), `tourPfad`). Der Editor muss den Film nicht
**werden**; er muss ihn nur nicht falsch darstellen.

---

## 4. Der Befund

Alle Zahlen an den vier lokalen Touren, 12./13. August 2026. Werkzeuge und Messfallen: §16.

### 4.1 Zwei Uhren, nicht eine fehlende Kurve

Bild und Ton hängen an **verschiedenen Uhren**:

- **Das Bild** zählt aufsummierte Frame-Zeit, bei 50 ms gedeckelt —
  [tour.ts](../../src/tour.ts): `const dt = Math.min((now - this.lastT) / 1000, 0.05)`. Jedes
  Frame, das länger dauert, verliert die Differenz **still**.
- **Der Ton** zählt die Echtzeit-Uhr seines `<audio>`-Elements. Die verliert nie.

Gemessen an der **stetigen Fahrt** (Halte und Rampen ausgeschlossen), Berner Oberland, je 25 s:

| Drosselung | Bildrate | Bilduhr läuft mit | Versatz nach 5 min Film |
|---|---|---|---|
| 1× | 72,6 fps | **99,7 %** der Echtzeit | 1 s |
| 6× | 34,3 fps | **81,3 %** | 56 s |
| 12× | 19,2 fps | **46,1 %** | 162 s |

Der Mechanismus, an den Frame-Abständen derselben rAF-Kette nachgewiesen (20 s):

| Drosselung | Bildrate | Frame-Zeit p50 / p95 / max | über 50 ms | verworfen |
|---|---|---|---|---|
| 1× | 70,3 fps | 12,7 / 27,7 / 48 ms | 0,0 % | **0 s (0 %)** |
| 6× | 37,9 fps | 23,9 / 61,3 / 96 ms | 11,3 % | **1,0 s (5,0 %)** |
| 12× | 25,4 fps | 17,6 / 130,5 / 205 ms | 28,9 % | **7,1 s (35,3 %)** |

Zwei Dinge, die man daran ablesen muss:

1. **Der Median täuscht.** Bei 12× liegt die halbe Verteilung bei harmlosen 17,6 ms — der
   Verlust steckt vollständig im Schwanz (p95: 130 ms). Eine Anzeige „25 fps" verrät nichts.
2. **Die Schwelle liegt niedriger als gedacht.** Schon bei knapp 38 fps im Mittel gehen 5 %
   verloren. Kein Randfall: Der Engpass ist gemessen die MapLibre-Pipeline (~72–90 % der
   Frame-Zeit, [Renderer-Labor](../archive/renderer-labor.md)), am Pixel 9 sind unter Last
   ~26 fps gemessen.

**Nicht gemessen, aber aus dem Code sicher:** Der Player hat **keinerlei
`visibilitychange`-Behandlung** (nur `studio/editor.ts` und `admin/admin.ts` haben eine).
Tab versteckt ⇒ `requestAnimationFrame` hält an, das Bild friert ein — die `<audio>`-Elemente
laufen weiter. Nach 30 s im Hintergrund ist die Musik 30 s weiter als das Bild.

### 4.2 Der Player braucht länger als der Film, den das Studio zeigt

Die Geschwindigkeitslogik der Engine in Node nachgebildet, festes `dt = 1/60`. Der Browser
taugt dafür nicht (§16).

| Tour | Stopps | Studio-Film | Player | Differenz | davon Route | davon Rampen | je Stopp |
|---|---|---|---|---|---|---|---|
| Koh Pha-ngan | 12 | 293,0 s | 330,2 s | **+37,2 s (12,7 %)** | +4,8 s | +32,4 s | 2,70 s |
| Stockholm | 8 | 201,8 s | 220,1 s | **+18,3 s (9,1 %)** | +3,7 s | +14,7 s | 1,83 s |
| Berner Oberland | 6 | 171,5 s | 191,1 s | **+19,5 s (11,4 %)** | +3,7 s | +15,9 s | 2,64 s |
| Runde bei Völklingen | 3 | 51,0 s | 52,4 s | +1,4 s (2,8 %) | +0,1 s | +1,3 s | 0,44 s |

**Die Rampen (85 %).** Anfahren kostet exakt `τ = 1,1 s` je Halt, unabhängig vom Tempo: aus
`v(t) = V(1 − e^{−t/τ})` folgt `T = s/V + τ`. Ausrollen kostet
`0,55·ln(V/4) − 0,55·(1 − 4/V)`, bei Vollgeschwindigkeit 1,34 s. Zusammen ~2,4 s analytisch,
2,6–2,7 s simuliert (die Differenz ist der Bremsweg-Vorgriff `speed · 0,62`).

**Nicht durch eine Konstante ersetzbar:** 2,70 s je Stopp auf der 41-km-Tour, aber 0,44 s auf
der 356-m-Tour — dort erreicht die Engine zwischen den Stopps nie Vollgeschwindigkeit. Wer
die Rampen nachbilden will, braucht eine **Simulation der Engine-Schleife**, keine Zahl.

> **Zur Messbasis:** „roh" heißt hier die Geometrie aus `tour.json` — die ist bereits mit
> 5 m Toleranz vereinfacht (§8D). Gegen die echten Rohpunkte im Manifest gemessen beträgt der
> Längenunterschied auf diesen vier Touren **0,00–0,09 %** (Koh Pha-ngan 0,02 %, Stockholm
> 0,09 %). Die Zahlen unten bleiben damit gültig; bei einer dicht abgetasteten Aufzeichnung
> (1 Hz statt 30 s) wäre der Anteil größer — ungemessen.

**Die Route (15 %).** `buildRoute` glättet (Catmull-Rom, 18 Stützpunkte je Span) und tastet
auf 14 m ab. Ergebnis gegenüber der Rohgeometrie, in der der Server `f` misst: **+2,18 %**
(Koh Pha-ngan), +2,58 % (Stockholm), +2,71 % (Oberland), +3,04 % (Völklingen).

### 4.3 Der Rest, den keine Uhr behebt

Server und Player parametrisieren dieselbe Strecke verschieden — der Server misst `f` auf der
Rohgeometrie, der Player rechnet `f × route.total` auf der geglätteten Route. Je Rohpunkt am
selben physischen Ort gemessen, **monotone** Zuordnung (sonst schnappt eine sich kreuzende
Route auf den falschen Vorbeigang), in Filmsekunden:

*Auch hier ist „Rohgeometrie" die Fassung aus `tour.json`, also die mit 5 m vereinfachte —
dieselbe Einschränkung wie in §4.2, gleiche Größenordnung (≤ 0,09 %).*

| Tour | Filmdauer | Median | p90 | max |
|---|---|---|---|---|
| Koh Pha-ngan | 221,0 s | 0,70 s | 0,88 s | **9,02 s** |
| Stockholm | 141,8 s | 0,40 s | 0,68 s | 0,82 s |
| Berner Oberland | 135,5 s | 0,22 s | 0,64 s | 0,98 s |

Die 9 s auf Koh Pha-ngan liegen dort, wo Wegpunkte weit auseinanderstehen (Fähre) und
Catmull-Rom frei interpoliert. Betroffen ist **alles, was mit `f` ankommt**: Audio-`f0`/`f1`,
Kamera-Keyframes, `moments[].f`, `weather[].km`. Fotos nicht — die werden über `nearestS` neu
verankert.

---

## 5. Warum das Taktversprechen die Architektur entscheidet

Es gibt zwei Wege, Player und Editor zur Deckung zu bringen:

| | Weg A: Rampen im Studio nachbilden | Weg B: Antrieb umdrehen (E2) |
|---|---|---|
| Prinzip | Das Studio simuliert, was die Engine tut | `s = f(Filmsekunde)`; die Weichheit ist eine Form IN der Kurve |
| Genauigkeit | Näherung: 2,44 s gerechnet gegen 2,64–2,70 s simuliert ⇒ **0,2–0,3 s Modellfehler je Stopp**, kumulativ | exakt per Konstruktion — es gibt nur eine Quelle |
| Wartung | Engine-Simulation in zwei weiteren Kopien | keine Rampe, die man nachbilden könnte |

Ein Takt bei 120 bpm ist **0,5 s**. Weg A liegt also je Stopp fast einen halben Takt daneben
und summiert sich über zwölf Stopps auf 2–3 s. Für „gleicher Anfang, gleiches Ende" täte er
es zur Not; für ein **Taktversprechen** ist eine Näherung kein Kompromiss, sondern ein
gebrochenes Versprechen.

⇒ **Etappen 1–4 sind alle vier Pflicht** — und sie genügen nicht ohne E10 (§5.1).

### 5.1 Der Blocker: das Tour-JSON kann Ton IN Halten nicht ausdrücken

Etappen 1–4 richten die **Uhr**. Sie ändern nichts an der **Ausdruckskraft des Formats** —
und dort liegt der größere Fall.

`enrich.ts` rechnet Film → `f` → Tour-JSON. In einer Standzeit (Foto-Halt, Moment, Ex-Pause)
läuft der Film, aber die Strecke steht. Der Code sagt es wörtlich:

> „Das passiert, wenn er ganz in einer Standzeit oder einer Ex-Pause liegt: Dort läuft der
> Film, aber die STRECKE steht — und das Tour-JSON kennt nur Streckenanteile."

Ein Musik-Klip, der ganz in einem Halt liegt, wird deshalb **verworfen** (mit
Protokolleintrag). Schlimmer ist der Klip, der nur teilweise darin liegt: `f` ist am Halt kein
Anker mehr, sondern ein Punkt, auf den ein ganzes Film-Intervall kollabiert. Ein Klip, der 2 s
in einen 5,2-s-Halt hinein beginnt, setzt im Player an der Halt-Kante ein — bis zu ~5 s
Fehler, bei 120 bpm zehn Schläge (zweieinhalb Takte).

**Damit ist E5 im heutigen Format nicht ausdrückbar**, unabhängig von jeder Uhr.

Die Abhilfe ist klein und **kein Schema-Bruch**: ein additives Feld je Ereignis — die
Filmsekunde neben `f0`/`f1` (**E10**). Das steht nicht im Widerspruch zu E9: Abgelehnt wurde
die ACHSE (redundant und groß), nicht ein Anker je Klip. Betroffen sind alle Ereignisse, die
in einem Halt liegen können: Ton-Klips, Kamera-Keyframes, Momente.

### 5.2 Zwei Dinge, die sonst still dagegen arbeiten

1. **Video-Halte enden heute am DATEIENDE**, nicht an der Achse (`onMediaEnded` →
   `advancePhoto`). Weicht die echte Dateilänge um Zehntel von `dauerS` ab, verschiebt sich
   **alles Folgende** — kumulativ. Wenn Filmzeit führt, muss der Halt an der Achse enden und
   `ended` nur noch Notausgang sein.
2. **Der Zuschauer-`mult`** macht jede Aussage über Filmdauer relativ (§2).

---

## 6. Drei Sorten „doppelt"

Die erste Frage ist nicht *was* doppelt ist, sondern **warum**. Drei Antworten, nur eine davon
ist ein Fehler.

### A. Bewusst getrennt — und soll es bleiben

| Was | Player | Editor | Warum getrennt |
|---|---|---|---|
| **Zeitmodell der Anzeige** | Ereignis + Wanduhr (`transition`, Zustandsmaschine `holdT`/`photoShown`) | Funktion der Kopfposition (dauerhaft pausierte Animationen mit negativem Delay, Balken *gesetzt* statt animiert, Video per Seek) | Der Player läuft linear in Echtzeit, im Editor wird **gescrubbt**. Ein gemeinsames DOM-Bauteil müsste beide Modelle tragen — [zeitleiste-umbau.md](zeitleiste-umbau.md) führt das als Merkregel: *„Eine Anzeige, die an einer UHR hängt statt an der Position, driftet."* |
| **Ressourcen-Lebenszyklus** | `_stopVideo` mit `load()`, gestaffeltes Vorladen, Standbild + Generationszähler | Neuaufbau per `replaceChildren`, Seek statt Play, beide Schnittkanten im `dataset` (die Datei ist der ungeschnittene Master) | Der Player streamt einen Film **voraus**; der Editor springt in einer Datei umher, die er hat |
| **Ton-Bedienung** | Ton-Knopf, `sessionStorage`-Gedächtnis | keiner | Gehört dem **Zuschauer**, nicht dem Schneidenden |
| **Layout** | Vollbild-Bühne, `--photo-ar`/`--vh-app` (samt Android-WebView-Falle: `100dvh` ist dort NULL) | Container-Queries in einer Panel-Fläche | Zwei Bühnen, zwei Maßsysteme |
| **Karte** | Satellit + Gelände + FreeCamera-Flug | schlanker Raster-Stil, Pitch 0, klickbar | Instrument gegen Bild (§3) |
| **Atmosphäre** | Horizont-Dunst, Sonne, Sterne, Wolkenband | — | Bei Pitch 0 gibt es keinen Horizont. [atmosphere.ts](../../src/atmosphere.ts) steigt an drei Stellen selbst aus: `// Kamera schaut nach unten — kein Himmel im Bild` |

### B. Erzwungen redundant — Werkzeug, nicht Entwurf

| Was | Warum unvermeidbar | Absicherung |
|---|---|---|
| Server-Kopie des Tempo-Modells ([film-tempo.ts](../../server/src/pipeline/film-tempo.ts)) | `server/tsconfig.json` hat `rootDir: "."` — ein Import aus `../../src/` fällt heraus | Heute Regex auf den Quelltext von `tour.ts`. Künftig ein **gemeinsames Verhaltens-Fixture**, das beide Seiten durchrechnen |

Das ist die einzige Kopie, die bleiben **muss**. Alle anderen sind Gewohnheit.

### C. Heute redundant — und soll es nicht sein

| Was | Stand | Schaden |
|---|---|---|
| **Filmachse / Tempo** | 3 Kopien, per Quelltext-Regex gekoppelt (einer prüft, ob ein *Kommentar* dasteht) | die 9–13 % aus §4.2 |
| **Standzeit `5.2`** | 4 Stellen, bewacht sind 2. Die vierte steht roh in [ui.ts](../../src/ui.ts), weil `HOLD_HIDE` in [tour.ts](../../src/tour.ts) **nicht exportiert** ist | stille Abweichung, von keinem Test gesehen |
| ~~**Ken-Burns-Dauer**~~ | **erledigt (E15)**: beide `klipDauerS` = `holdS + 0.8` | — |
| **Seitenverhältnis** | gemessen und geklemmt (0,62–1,85) gegen fest `aspect-ratio: 3/2` + `object-fit: cover` | Ein Hochformat-Foto steht im Player hochkant und wird im Editor auf den **Mittelstreifen** beschnitten — genau den, den der Player-Kommentar ausdrücklich vermeiden will |
| **CSS-Zwillinge** | Fortschrittsbalken wörtlich gleich; Ken-Burns-Endskala 1.01/1.02; „Ken Burns aus" = 1.0/1.04; Entwickeln-Filter verschieden | Der Farb-Wächter greift nicht: Er verbietet rohe Werte, die als **Token** existieren — `#d8d2c4`, `#8a7a63`, `#f5a524` sind keine |
| **Halt-Gruppierung** | zwei Implementierungen (`gruppiereStopps` / `baueStopps`) | nur per Textvergleich gekoppelt |
| ~~**Ken-Burns-Zeitmodell**~~ | **erledigt (E15)**: der Player fährt dasselbe Modell wie der Editor — dauerhaft pausierte Animationen, Fortschritt aus negativem Delay (`--karte-zeit` gegen `--fe-zeit`) | — |
| **Musikposition beim Bereichseintritt** | Player: hart `currentTime = startS` · Editor: Seek auf die FILM-Position (`musikVersatzS`) | Nach jedem Scrub oder Sprung steht dieselbe Filmsekunde an einer anderen Stelle der Datei — genau das Taktversprechen. Der Player braucht denselben Versatz |

**Wann welche Zeile fällt** — die Tabelle ist ein Befund, kein Plan, und zwei ihrer Einträge
kamen erst nach der Paketierung dazu:

- Seitenverhältnis und Standzeit sind **erledigt** (Paket A). Die Halt-Gruppierung und die
  CSS-Zwillinge nimmt die **Szene-Schicht** (§9, jederzeit dazwischen), die Filmachse die
  Etappen 2–4.
- Die **Musikposition gehört zu Paket D** (§12) — nicht früher, und das hat einen Grund:
  `musikVersatzS` ([playback.ts](../../src/studio/playback.ts)) ist längst eine reine,
  getestete Funktion, aber sie rechnet über die **Filmkurve**, und die liegt in
  `src/studio/`. Ein Import Player→Studio ist die eine Richtung, die §8C ausschließt. Mit der
  geteilten Achse zieht sie nach `src/` um, und der Player ruft dieselbe Funktion — ein
  Umzug, kein Nachbau. Eine Näherung im `f`-Raum ginge zwar sofort, wäre aber ausgerechnet in
  den Halten falsch (dort steht `f` still), also an der Stelle, an die man am häufigsten
  scrubbt.
- Das **Ken-Burns-Zeitmodell** ist mit E15 angeglichen und in Etappe 4 gelandet statt in der
  Szene-Schicht — dort fiel es ohnehin an, weil die Karte auch rückwärts erscheinen soll.
  `balkenAnteil`, `klipDauerS`, `kartenZeiten` und `videoStandS` sind dabei gleich
  mitgezogen und stehen in [einblendung.ts](../../src/card-timing.ts).

Was ausdrücklich **nicht** folgt: ein gemeinsamer Abspieler. Der Player kennt Spuren mit
`f0`/`f1` aus dem Tour-JSON, der Editor Klips aus dem Overlay; die beiden Datenmodelle
treffen sich frühestens mit E10 (§5.1). Geteilt werden die RECHNUNGEN — Hüllkurven, Pegel,
Kanten, Versatz —, nicht die Mechanik (§6A).

---

## 7. Der Stapel

Fünf Schichten, von unten. Nur die oberste ist an 3D gebunden.

| Schicht | Modul | Heute | Künftig |
|---|---|---|---|
| **Ton** | [audiotracks.ts](../../src/audiotracks.ts) | ✅ geteilt | unverändert — die Vorlage für alles andere |
| **Zeit** | `src/film-axis.ts` *(neu)* | 3 Kopien | 1 Web-Modul + 1 Server-Spiegel (erzwungen), Fixture statt Regex |
| **Szene** | `src/card-timing.ts` *(neu)* | Kern teils geteilt, Zahlen doppelt | 6 reine Funktionen (§9) |
| **Stimmung** | `sunPosition` + `paramsAt` | `sunPosition` ist rein; `paramsAt` **nicht exportiert** | geteilte *Rechnung*, getrennte *Anwendung* |
| **Wetter** | [weather.ts](../../src/weather.ts) | nur Player | dasselbe Modul auf beiden Bühnen |

**Was das einbringt:** aus 3 Tempo-Kopien werden 2, aus 4 Standzeit-Stellen 1, die
Szene-Zahlen von 2 auf 1 — und vier Wächter, die Quelltext nach Zeichenketten absuchen,
verschwinden ersatzlos.

---

## 8. Die Zeit-Schicht im Einzelnen

**A. Eine Uhr (E1).** Die Engine zählt Filmsekunden aus einer monotonen Echtzeituhr statt aus
aufsummierten, geklemmten Frames. Ein langsames Gerät lässt das Bild dann **springen**, nicht
**nachlaufen** — die richtige Wahl für einen Film mit Ton.

**Und der Deckel entfällt ganz — auch bei der Kamera.** Eine frühere Fassung ließ ihn „dort,
wo er hingehört: bei der Kamera-Glättung". Das war falsch herum (Falle 3): `Smooth.to` rechnet
`1 − exp(−dt/τ)`, die exakte Lösung bei konstantem Ziel — ein langes Frame sammelt dort keinen
Fehler an. Ein gedeckeltes `dtKamera` ließe die Kamera stattdessen **dauerhaft
hinterherhängen**, weil sie bei 12× nur ~65 % der vergangenen Zeit integrierte. Die Tweens
über feste Dauer (`reposeTween`, `t += dt/dur`) springen bei einem langen Frame ein Stück
weiter — genau das, was E1 will. Die Trennung `dtFilm`/`dtKamera` schrumpft damit auf den
Namen: Inhaltliches hängt an der Position, Ästhetisches an `dt`, und `dt` ist beidesmal
dasselbe. Ob der zweite Bezeichner bleibt, entscheidet sich beim Bauen.

`visibilitychange` gehört dazu, nicht als Zusatz — und es ist der richtige Griff für den
Hintergrund-Tab: Ohne ihn schöbe die Rückkehr die Filmzeit um die volle Abwesenheit vor. Ein
Deckel auf `dtFilm` wäre dafür das falsche Werkzeug (§12, Etappe 1): Er greift entweder zu
spät oder verliert wieder still Zeit.

**Kein Audio-Masterclock.** Naheliegend wäre, die Filmzeit aus `audio.currentTime` zu nehmen.
Geht nicht: Musik liegt in **Bereichen** `[f0,f1)`, mehrere dürfen sich überlappen, dazwischen
ist Stille. Es gibt keine durchgehende Tonspur. Läuft die Filmuhr in Echtzeit, ist es auch
nicht nötig — beide Uhren sind dann dieselbe.

**B. Die Position folgt der Filmzeit (E2).** Der Integrator in
[tour.ts](../../src/tour.ts) liest die Position aus der Achse statt sie zu integrieren:
`s = streckeBeiFilm(achse, filmS)`.

> **Nicht `fractionAt(kurve, filmS) · total`**, wie eine frühere Fassung schrieb. `fractionAt`
> arbeitet auf der **Spielkurve** und liefert einen *Film*-Anteil — `buildPlaybackCurve` gibt ohne
> Trim `{anteile: [0,1], filmS: [0, gesamtS]}` zurück, die Leisten-Achse ist bereits
> filmlinear. Mit `· total` käme ein `s` heraus, das linear in der Filmzeit läuft: Modi und
> Halte fielen heraus. Gebraucht wird die Achse über der Strecke (E12).

Das ist **eine Zeile im Kern und mehr drumherum**: Am Integrator hängen der Bremsweg-Vorgriff, `nextIdx`/
`nextMomentIdx`, die Ausroll-Schwelle `speed < 4`, die Finale-Schwelle und `dir`. Der Plan
(§12, Etappe 4) zählt sie auf — die Formulierung „eine Zeile" setzte die Erwartung falsch; der Studio-Abspieler
betreibt dieses Modell schon ([playback.ts](../../src/studio/playback.ts), `tick()`).
Anfahren und Ausrollen sind danach keine emergente Eigenschaft einer Differentialgleichung
mehr, sondern eine **Form in der Kurve** — es gibt kein zweites Modell zum Nachbilden.
Nebeneffekte, alle in die richtige Richtung: `mult` wird ein Faktor auf die Filmzeit, `nudge`
wird 1/24 Filmsekunde, Scrubben wird filmlinear und damit positionstreu.

**C. Eine geteilte Filmachse (E3).** `src/film-axis.ts`, importiert von Player und Studio. Der
gemeinsame Kern ist ~60 Zeilen und domänenfrei: *(Abschnittslängen, Modus je Abschnitt, Halte
als Position + Breite) → Stützstellenkurve + Halt-Intervalle + Interpolation in beide
Richtungen*. `interpoliere` ist zwischen Studio und Server heute schon **byte-identisch**,
`webeHalte` unterscheidet sich in zwei Zeilen.

**Die x-Achse MUSS die Strecke werden (E12) — das ist keine Wahl, sondern die Vorbedingung
von E2.** Zwei frühere Fassungen dieses Absatzes lagen daneben: erst „eindeutig umkehrbar"
(trägt nur halb — die Mehrdeutigkeit wandert von den Pausen zu den Halten), dann „ein zweites
Risiko, lieber nur teilen" (übersieht, dass E2 ohne sie gar nicht geht).

Der Grund ist die Rechnung selbst. E2 braucht **Filmsekunde → Streckenposition**. Über der
Aufnahmezeit liefert die Achse Filmsekunde → Aufnahmezeit, und den zweiten Schritt kann der
Player nicht gehen: `cfg.timeline` ist **Pseudo**-Zeit mit Pausen-Zeitraffer, nicht die
Aufnahmeuhr. Es gibt im Player keine Abbildung Aufnahmezeit → `f`.

Der Kern ist ohnehin distanzparametrisiert beschrieben (*Abschnittslängen, Modus je Abschnitt,
Halte als Position + Breite*) — was fehlt, sind die Adapter: `timeline.ts` rechnet
durchgehend in Aufnahmezeit, `projiziereAufReihe` im Server ebenso, und die Anker von Medien
und Ton-Klips bleiben Aufnahme-Zeitstempel (trim-stabil, so begründet es die Spec). Sie
brauchen einen Zeit→Strecke-Schritt; das Studio hat mit `cumMeters`/`metersToOffset` schon
Werkzeug dafür.

⇒ **Etappe 3 ist der teuerste Schritt des Plans, nicht Etappe 4**, und sie liegt hart auf dem
kritischen Pfad. Die lower_bound-Konvention „Plateau → Ankunft" bleibt in beiden Richtungen
nötig.

**Und die Achse rechnet über die ROHEN Wegpunktabstände, nicht über `route.cum`.** Sonst ist
die Filmdauer allein durch die Catmull-Rom-Glättung 2,2–3,0 % zu lang — Etappe 4 verfehlte ihr
eigenes 1-%-Kriterium an der eigenen Konstruktion. Diese Abstände kann der Client selbst
rechnen (Fehler 0,00–0,09 %, §8D); das Server-`f` aus E11 wird nur für den **exakten Anker**
gebraucht, nicht für die Achse.

Das Modul gehört nach `src/`, neben `geo.ts` und `audiotracks.ts` — nicht nach `src/studio/`.
Ein Import Player→Studio zöge die Editor-Typenwelt in den Player-Chunk und drehte die bisher
saubere Abhängigkeitsrichtung um.

**D. `f` über die Wegpunkte (E4).** Statt `f × route.total` eine Tabelle: je Wegpunkt sein
`f` und sein `s` auf der gebauten Route. In `buildRoute` ist die eine Hälfte billig — Wegpunkt
`i` entspricht `dense[i · SEGS]` (für `waypoints[0…n-2]`; der letzte kommt nach der Schleife
aus `dense.push`), es fehlt nur, den Wegstand mitzuschreiben.

**Die andere Hälfte kann der Player NICHT selbst.** Eine frühere Fassung dieses Abschnitts
behauptete, er baue seine Route „aus denselben Wegpunkten, die der Server geschickt hat", und
könne die Rohdistanz nachrechnen. Das stimmt für aufgezeichnete Touren nicht:
`enrich.ts` liefert `vereinfacheSegment(seg.pts)` aus (Douglas-Peucker, 5 m), während `f` als
`dist / gesamtM` auf der **rohen** Zeitreihe gemessen wird (`zeit.ts`, `positionZurZeit`). Die
weggeworfenen Punkte tragen Länge, die clientseitig nicht rekonstruierbar ist.

Gemessen ist der Unterschied auf den vier lokalen Touren **klein** — 0,00–0,09 % Längenverlust
(Koh Pha-ngan 0,02 %, Stockholm 0,09 %), also weit unter der Catmull-Rom-Aufblähung von
+2,2–3,0 %, die den Routenanteil dominiert. Zwei Gründe, es trotzdem zu lösen: Für ein
Taktversprechen zählt nicht „klein", sondern „exakt" — und diese vier sind dünn abgetastete
Demo-Tracks (30-s-Raster). Eine 1-Hz-Aufzeichnung verliert bei 5 m Toleranz mehr; ungemessen.

**Also eine Richtungsentscheidung, nicht fünf Zeilen** — getroffen als **E11**: Der Server
schickt je ausgeliefertem Wegpunkt sein `f` mit (additiv, billig, natürliche Ergänzung zu
E10). Die Alternative — `f` künftig auf der vereinfachten Geometrie messen — hätte jeden
Bestands-Render verändert.

Räumt §4.3 weg und behebt denselben Fehler bei Kamera-Keyframes, Momenten und Wetter-Ankern
mit — **je Tour aber erst nach ihrem nächsten Render.** Bis dahin fehlt das Feld, der Player
fällt auf `f × route.total` zurück und behält den Fehler aus §4.3. Das ist harmlos (der
Rückfall IST das heutige Verhalten, nicht ein falsches) — anders als bei E10, wo ein Feld aus
dem alten Achsen-Modell aktiv in die Irre führte.

**E. Die Fortschrittsleiste wird filmlinear.** Folgt aus B. Und sie ist unabhängig davon
fällig: Bei jedem Foto-Halt steht `tour.s` still, also stehen Balken, Playhead und
Profilfüllung. Das Studio hat diesen Defekt am 2026-08-05 verlassen (gemessen: *„Playhead:
Stillstand vor Halt-Sprung — 28 von 39 Frames"*, *„Szenen-Anteil am Film: 52 %"*), der Player
hat ihn noch. **Nicht filmlinear werden:** Pseudo-Uhrzeit, Sonnenstand, Wetter-Timeline,
`next.km`, `syncDots` — die bleiben Streckengrößen.

---

## 9. Die Szene-Schicht

**Der rechnende Kern ist schon zur Hälfte geteilt** — nichts davon ist neu zu bauen:
`videoTonHuelle`, `videoLautstaerke`, `videoMusikDuck`, `VIDEO_FADE_S`, `VIDEO_DUCK`,
`STUDIO_PEGEL_VORGABE` ([audiotracks.ts](../../src/audiotracks.ts)); `clampMediaTrim`,
`videoFilmS`, `videoStandS`, `mediumHoldS`, `STOP_ENGINE_S`/`STOP_FADE_OUT_S`
([timeline.ts](../../src/studio/timeline.ts)); `NAHE_M` samt Gruppierungsregel.

Doppelt sind die DOM-/CSS-Schicht (~200 Zeilen TS + ~110 Zeilen CSS je Seite) und die Zahlen
aus §6C. **Ein geteiltes DOM-Modul wäre die falsche Antwort (E8):** Die beiden Karten teilen
die Optik, aber nicht ihr Zeitmodell.

**Erledigt am 14.08.** — angefangen mit Paket A, abgeschlossen mit der letzten Runde:
`klipDauerS`, `standzeitS` (samt exportiertem `HOLD_HIDE`), `klemmeSeitenverhaeltnis`,
`balkenAnteil`, dazu `kartenZeiten` und `videoStandS` aus E15, und zuletzt
`ausschnittDauerS` und `reihenfolgeImHalt`. Der CSS-Paar-Wächter steht in
[test/card-painter-css.test.ts](../../test/card-painter-css.test.ts).

Zwei Befunde aus dem Abschluss, die die Tabelle nicht vorhersah:

- **`tonPegelFuer` wurde `ausschnittDauerS`.** Geteilt war die Kurve längst
  (`videoTonHuelle`); doppelt war, worüber sie blendet — der Player nahm `endeS` roh, der
  Editor `endeS - vonS`. Beides war an seiner Stelle richtig (der Player liefert die
  geschnittene Fassung aus, `vonS` = 0), aber es waren zwei Formeln für eine Regel: Wer im
  Player je einen linken Schnitt zuließe, hätte dort eine zu lange Ausblende und niemanden,
  der es meldet.
- **`reihenfolgeImHalt` bekommt den Zweitschlüssel als ARGUMENT.** Geteilt ist der VORRANG
  (`reihe` schlägt alles), nicht die Messung: Der Player ordnet nach Streckenmetern, das
  Studio nach Aufnahmezeit — dort muss auch eine Aufnahme ohne verlässlichen Ort einzuordnen
  sein. Bei einer Umkehr auf der Strecke kommen beide deshalb legitim zu verschiedenen
  Folgen. Der alte Wächter (ein Regex auf `a.reihe ?? Number.POSITIVE_INFINITY` im Quelltext
  des Players) prüft jetzt Verhalten statt Zeichenketten.

**Der CSS-Wächter prüft die ZEITEN und ausdrücklich nicht die Optik.** Schatten, Rotation und
Polsterung dürfen verschieden sein — die Bühne liegt formatfüllend über der Karte, die
Vorschau klebt an einem Wegpunkt. Gleich sein müssen die vier Dauern (Blende, Flug, Abgang,
Blenden-Versatz), weil beide Seiten ihren Fortschritt über dieselben Funktionen rechnen; sie
stehen in verschiedenen EINHEITEN da (`0.5s` gegen `500ms`), ein Textvergleich fände hier
neun Unterschiede und keinen echten.

Geteilt wird ein DOM-freies `src/card-timing.ts` mit sechs reinen Funktionen — jede mit einem
konkreten Anlass von heute:

| Funktion | Anlass |
|---|---|
| `klipDauerS` / `kenBurnsDauerS` | die 1-Sekunden-Abweichung |
| `standzeitS` (mit exportiertem `HOLD_HIDE`) | die ungewachte `5.2` |
| `klemmeSeitenverhaeltnis(b, h)` | existiert nur als Inline-Ausdruck im Player; der Editor hat die Regel gar nicht |
| `balkenAnteil(imS, dauerS)` | heute drei Formeln für denselben Balken |
| `tonPegelFuer({ imS, ausschnittS })` | geteilte Kurve, verschiedene Argumente |
| `reihenfolgeImHalt` | zwei Implementierungen, nur per Textvergleich gekoppelt |

Dazu ein **CSS-Paar-Wächter** analog zu [base-css.test.ts](../../test/base-css.test.ts).

---

## 10. Stimmung und Wetter im Editor (E7)

**„Grading" ist der Mechanismus, Tag/Nacht die Ursache.** Der Zyklus wird als Farbkorrektur
auf die Satellitenkacheln gerechnet — Helligkeit, Sättigung, Kontrast. Dieser Teil trägt auch
auf einer Draufsicht. Licht (`setLight`) und Himmel (`setSky`) tragen nicht: Das eine braucht
Gelände, das andere einen Horizont.

**Der Editor sagt beides längst, er zeigt es nur nicht.** Es gibt eine Wetter-Bahn mit Modus
und Stärke und ein Tageszeit-Symbol im Pult — beides ohne Entsprechung auf der Karte.

**Der billigste erste Schritt ist nicht das Partikel-Overlay, sondern das Raster-Grading:**
`raster-brightness-*`, `raster-saturation`, `raster-contrast` aus `paramsAt` auf den
`'sat'`-Layer, dazu ein flacher Overcast-`fillRect`. Kamerafrei, **ein Paint je Änderung statt
einer dauerhaften rAF-Schleife**.

Vier Dinge, die man dabei falsch annimmt:

1. **`createWeather` ist NICHT ohne Änderung übertragbar.** Es nimmt zwar nur ein
   `HTMLElement`, verdrahtet aber `window.innerWidth/innerHeight` fest, und `#weather`s Regeln
   stehen in [style.css](../../src/style.css) — die [studio.html](../../studio.html) gar nicht
   lädt. Es braucht `getBoundingClientRect()`, einen `ResizeObserver` und die Regeln: ~10 Zeilen.
2. **`daynight.ts` ist nicht teilbar wie es ist.** Es schreibt direkt in die Karte
   (`setPaintProperty` auf Layer `'satellite'`; der Editor-Layer heißt `'sat'`). Der
   wiederverwendbare Kern ist `paramsAt(alt)` — **nicht exportiert** (der Typ schon).
3. **Die Performance-Sorge hat eine eingebaute Antwort.** `weather.setGate(fn)` friert das
   Overlay komplett ein, mit fertiger Blende ins Standbild. An „Abspielkopf wird gezogen"
   gehängt, kostet es während des Zugs **nichts** — das 5,5-ms-Ziehbudget bleibt unberührt.
4. **Das Tageszeit-Symbol nutzt bewusst eine Stunden-Heuristik**, nicht `sunPosition`, mit
   begründetem Kommentar. Nur anfassen, wenn die Karte ohnehin Grading bekommt.

---

## 11. Feinplatzierung (E6)

**Kein sichtbares Taktraster** — keine Taktlinien, keine BPM-Erkennung, kein Einrasten auf den
Schlag. Gebraucht wird Schlichteres: **Klips framegenau setzen und ihre Länge fein
bestimmen.** Wer den Takt treffen will, hört ihn und stellt den Wert ein; das Werkzeug muss
nur die Auflösung hergeben. Als Einheit bietet sich **1/24 s** an — die Engine kennt sie
bereits (`nudge` versteht ein Einzelbild genau so).

Heute geht das aus drei Gründen nicht:

1. **Die Zeitfelder des Ton-Inspectors zeigen `HH:MM`.** `clockTimeShort` formatiert mit
   `hour: '2-digit', minute: '2-digit'` — **Minutenauflösung**, und als Uhrzeit statt als
   Filmzeit. Gebraucht: Filmzeit mit Nachkommastellen, dazu die **Länge als eigenes Feld**
   (heute nur „Endet um").
2. **Es gibt kein Nudging.** Die Pfeiltasten bewegen den Abspielkopf (5 Filmsekunden) bzw. die
   Einfügemarke (60 s) — nie einen ausgewählten Klip. Gebraucht: Pfeil = 1 Frame,
   ⇧Pfeil = 1 s, auf dem fokussierten Objekt.
3. **Foto-Einblendungen sind gar nicht framegenau setzbar.** Ein Ton-Klip hat `versatzFilmS`
   (Fließkomma). Ein Medium hat nur seinen **sekundengenauen Aufnahme-Anker**: Verschieben
   heißt „auf die nächste Aufnahmesekunde", je nach Reisegeschwindigkeit 0,01–0,1
   Filmsekunden — ungefähr Frame-Größenordnung, aber nicht steuerbar. Abhilfe ist dieselbe wie
   beim Ton: ein additives `versatzFilmS` auch für `edits.medien`.

Zwei Kleinigkeiten, die man beim Bauen kippt: Das **Rasten muss sich aushebeln lassen**
(Modifier), sonst zieht es die eben gesetzte Feinlage weg — und der **Zoom muss die Auflösung
hergeben**, sonst ist ein Frame schmaler als ein Pixel.

---

## 12. Umsetzungsplan

**Eine Nummerierung, nicht zwei:** Die Schritte heißen wie ihre Etappe; was keine Etappe ist,
trägt seinen Namen. (Vorher standen „Punkt 3" und „Etappe 2" nebeneinander — eine
Verwechslungsquelle in Commit-Nachrichten.)

**Kein Schema-BRUCH, aber das Format wächst.** Zwei Etappen legen Felder dazu (Etappe 2:
`f` je ausgeliefertem Wegpunkt; Etappe 4b: Filmsekunde je Ereignis). Beides ist additiv,
`maptale/tour@1` bleibt, Bestandsdaten laufen weiter — aber **[austauschformat.md](../specs/austauschformat.md)
zieht mit**. Dort steht heute die Regel „Streckenpositionen als Bruchteil `f` (0..1), nie
Meter"; E10 ist die erste begründete Ausnahme davon und gehört dort erklärt, nicht nur hier.

### Auslieferungen

Sieben Pakete. Jedes ist ein Arbeitsgang mit eigenem „Fertig, wenn" — und **je ein eigener
Arbeitskontext**: Die Pakete fassen verschiedene Ecken an (Player-Engine, Server-Pipeline,
Studio-Zeitleiste), und wer alle drei gleichzeitig im Kopf hält, verliert Genauigkeit genau
dort, wo dieses Vorhaben sie braucht. Dieses Blatt ist die Übergabe zwischen ihnen.

| Paket | Inhalt | Größe | Auslieferung |
|---|---|---|---|
| **A** | Schritt 0 (nachsehen, was live ist) + Schritt 1 (Gruppe C) | S | eigenes Release |
| **B** | Etappe 1 — eine Uhr | M | **allein**, bewusst |
| **C** | Etappe 2 — alle `f`-Anker nach `s`, Server-`f` je Wegpunkt, Spec | M | mit D bündelbar |
| **D** | Etappe 3 — geteilte `filmachse.ts` über der Strecke (E12), dazu der Umzug von `musikVersatzS` (§6C) | L | erste hörbare Wirkung: der Ton springt beim Scrubben mit |
| **E** | Etappe 4 + Rampen im Server-Spiegel — gebaut in zwei Gängen (Engine, dann Anzeige) | XL | **als Release unteilbar** |
| **F** | Etappe 4b — Auslösen in Filmsekunden + Film-Anker | M | **gebaut** (14.08.) |
| **G** | Etappe 5 — die Leiste | M | **gebaut** (14.08.) |

**Was nicht geteilt werden darf, ist die AUSLIEFERUNG — nicht die Arbeit.** Etappe 4 und die
Rampen in [server/src/pipeline/film-axis.ts](../../server/src/pipeline/film-axis.ts) gehen in
DERSELBEN Auslieferung raus (s. Etappe 4). Zwischen E und F ist der Zustand konsistent, nur
noch nicht taktgenau — das ist die einzige zulässige Naht im Release-Block.

**Gebaut wird E dagegen in zwei Gängen**, denn es sind zwei Baustellen:

- **E-Engine** — Antrieb umdrehen, Rampe in die Kurve, die Zustandsmaschine abräumen (E13,
  E14), Server-Zwilling, Schnelllauf-Regeln (E16). Danach stimmt die DAUER; prüfbar am
  Kriterium unten und an einer Fahrt.
- **E-Anzeige** — die Foto-Karte an die Position hängen (E15) und die Schichtung umdrehen
  (E17). Danach stimmt das BILD; prüfbar am Scrubben durch einen Halt. **Erledigt am
  14.08.** — mit einem Befund, den erst die neue Schichtung sichtbar machte: Der
  Auto-Rückzug der UI lief nur bei `phase === 'ride'`, die Leiste blieb also die ganze
  Standzeit oben und deckte über der Karte die Bildunterschrift samt „Weiter" zu (93 px
  bei 1280 × 800). Er zählt den Halt jetzt zur laufenden Wiedergabe — dieselbe Lehre wie
  E13: ein Halt ist ein Zustand der Kurve, kein anderer Betriebsmodus.

Der zweite Gang braucht aus dem ersten nur `filmS` und die Halt-Intervalle. Dazwischen ist
der Player benutzbar, aber die Karte flackert an Halt-Kanten (sie wird noch getriggert statt
gestellt) — ein Zustand zum Prüfen, nicht zum Ausliefern.

**Der Entwurfsschritt vor E ist erledigt** (14.08.): Rückwärts fährt über dieselbe Kurve
(E13), die Rampe wird eine feste Form über eine feste Strecke (E14). Beide Entscheidungen
stehen bei Etappe 4 mit ihrer Begründung; E13 macht die Etappe kleiner, als sie im Plan
aussieht.

**Frei dazwischen, in beliebiger Reihenfolge:** Tag/Nacht im Editor (§10) und die
Szene-Schicht (§9). Die Feinplatzierung (§11) erst nach G.

**Schritt 0 — Nachsehen, was seit v0.60.4 live ist.** Der Video-Ton im Studio und der neue
Player-Pegel sind ausgeliefert, aber nie gehört. Braucht eine Tour mit Video.

**Schritt 1 — Gruppe C** (§6C): Seitenverhältnis und rohe `5.2` (samt `export` in `tour.ts`)
sind Zahlenkorrekturen — ein Nachmittag, je ein Wächter dazu.

**Ken Burns ist es NICHT.** Im Player ist der Zug eine CSS-`transition` — Wanduhr, nicht
pausierbar, nicht scrubbar: Unter dem „Angehalten"-Abzeichen läuft er weiter, während `holdT`
steht (die Pause-Korrektur aus v0.60.4 erreicht ihn nicht). Das Studio fährt dagegen eine
dauerhaft pausierte Animation mit negativem Delay. Die Differenz ist also nicht eine Sekunde,
sondern **ein anderes Zeitmodell** — dieselbe Sorte wie §6A. **Entschieden mit E15
(14.08.): Der Player übernimmt das Studio-Modell**, und zwar in Etappe 4 statt in der
Szene-Schicht — dort fällt es ohnehin an, weil die Karte auch rückwärts erscheinen soll.
Die 1-Sekunden-Zeile in §6C erledigt sich damit von selbst: Wenn beide Seiten ihren
Fortschritt aus derselben Filmzeit ziehen, gibt es keine zwei Dauern mehr.

**Etappe 1 — Eine Uhr.** `tick()` rechnet in `dtFilm` — echte, ungedeckelte Frame-Zeit;
`s`-Integration und alle Zeitzähler (`holdT`, `momentT`) laufen darauf; `visibilitychange`
pausiert. **Der
`dtFilm`-Deckel gehört überdacht:** Bei 12× lag das längste Frame bei 205 ms, ein 0,25-s-Deckel
greift dort knapp nicht — am Pixel 9 mit Kachel-Stockern liegt man darüber, und dann verliert
die Filmuhr wieder still, genau der Fehler, den diese Etappe behebt. Der Rückkehr-aus-dem-
Hintergrund-Fall hängt an `visibilitychange`, nicht am Deckel. Was doch verworfen wird, soll
**zählbar** sein statt unsichtbar (Zähler auf `window.__j`). Die Kamera bekommt **keinen
eigenen Deckel und keine Teilschritte** — sie läuft auf demselben `dt` (Falle 3).
**Vorher zu prüfen:** Liefert die Android-WebView `visibilitychange` beim Wechsel in den
Hintergrund? Sonst hat ausgerechnet die Plattform mit den gemessenen ~26 fps den Fall nicht
abgedeckt.
Test ohne Browser: 10 s Echtzeit mit 200-ms-Frames müssen 10 s Filmzeit ergeben, nicht 2,5 s.
*Fertig, wenn:* Bei 6× CPU-Drosselung deckt sich `Δs ÷ Tempo` mit `Δ audio.currentTime` auf
±2 % (heute 81,3 %) — **gemessen im Fenster „Phase `ride`, konstanter Modus, Tempo > 97 % des
Ziels"**, sonst mischen Rampen und Modus-Wechsel hinein; das Messskript wählt es (§16).
**Eigenes Release, bewusst allein.**

**Etappe 2 — `f` über die Wegpunkte.** Zwei Hälften (§8D, E11): Der Server schickt je
ausgeliefertem Wegpunkt sein `f` mit (additiv, Spec-Eintrag); `buildRoute` schreibt den
Wegstand je Wegpunkt mit.

**Es reicht nicht, `f * route.total` zu ersetzen** — diese Form steht praktisch nur bei den
Momenten. Die größeren Verbraucher rechnen **umgekehrt** und tauchen bei einer Suche nach der
Formel gar nicht auf: `tourAudio.setFrac(s / route.total)` gegen rohe `f0`/`f1`,
`kamFolger(s / route.total)` gegen `k.f`, `createTimeAt(frac)`, und das Wetter über
`km = f · Gesamt-km`. Sauberer als eine Tabelle in beide Richtungen: **alle `f`-Anker beim
Laden EINMAL nach `s` übersetzen**, danach rechnet der Player nur noch in Metern.

Drei Fallen dabei: Die Verkettung wirft je Folgesegment den ersten Punkt weg (`slice(1)`) —
die Index-Zuordnung Wegpunkt → `f` muss das mitmachen. Der **Rückwärts-Modus** dreht Segmente
UND Punkte um; die Tabelle muss gespiegelt werden (die Modus-Grenzen brauchten dafür schon
eine Behelfskonstruktion). Und **kuratierte `TOURS` bekommen nie ein Wegpunkt-`f`** — für sie
ist der Rückfall auf `f × route.total` dauerhaft, nicht übergangsweise.

*Fertig, wenn:* Der Median-Fehler aus §4.3 fällt unter 0,05 s — geprüft **je Ankerklasse**
(Audio, Kamera-Keyframes, Momente, Wetter), nicht nur als Gesamtzahl.

**Etappe 3 — Die geteilte Achse.** `src/film-axis.ts` als domänenfreier Kern; das Studio
benutzt ihn statt der eigenen Kopie; der Player rechnet seine Filmachse, **noch ohne sie
anzutreiben**; der Server prüft gegen ein Verhaltens-Fixture statt gegen Regex.

**Und zum Abschluss der Umzug von `musikVersatzS`** — die erste Stelle, an der die geteilte
Achse etwas HÖRBAR macht, und der Grund, warum sie hier steht und nicht später: Der Player
setzt heute beim Eintritt in einen Musik-Bereich hart `currentTime = spur.startS`
([audiotracks.ts](../../src/audiotracks.ts)). Wer mitten hineinspringt, hört das Stück von
vorn; wer INNERHALB eines Bereichs scrubbt, hört es einfach weiterlaufen — die Datei steht
danach an einer anderen Stelle als der Film, und zwar bis zum Bereichsende. Der Editor kann
es längst richtig (`musikVersatzS`, „wer mitten im Bereich startet, hört, was dort im Film
liefe"), nur rechnet die Funktion über die Filmkurve und liegt deshalb in `src/studio/` —
für den Player unerreichbar, solange die Achse dort wohnt (§8C). Mit dem Umzug ruft er
dieselbe Funktion, beim Eintritt UND am Ende jedes Scrubs.

*Fertig, wenn:* Das Tempo-Modell steht an genau zwei Stellen, kein Test liest mehr Quelltext
per Regex — und ein Scrub mitten in ein Musikstück setzt den Ton dort fort, wo der Film
steht (im Player wie im Editor, gegen dieselbe Filmsekunde geprüft).

**Etappe 4 — Der Antrieb dreht sich um.** **Eine Vorbedingung bleibt:** Video-Halte an die
Achse hängen statt an `ended` (§5.2). Dann: Rampen als explizite Form in die Achse; `s` aus
der Filmzeit ableiten; Bremsweg-Vorgriff und Ausrollschwelle entfallen; Scrubben, `seek`,
`nudge` und `mult` auf Filmsekunden.

**Rückwärts fährt über dieselbe Kurve (E13).** Die frühere Sorge — „an jedem Halt kleben" —
hat sich an der Praxis erledigt: Der Editor macht es seit Monaten genau so
([playback.ts](../../src/studio/playback.ts), `tick` rechnet `filmAt(kurve, alt) + tempo · dt`
mit negativem Tempo bis −4×), die Halte sind dort Plateaus derselben Kurve, und es ist
niemandem als Mangel aufgefallen. Der Player bekommt damit dasselbe Verhalten wie der Editor
statt eines eigenen.

Und das ist der Schritt, der Etappe 4 **kleiner** macht statt größer: Wenn „im Halt" ein
Zustand der KURVE ist (`filmS` liegt in einem Halt-Intervall) statt eines getriggerten
Phasenwechsels, entfallen `nextIdx`, `nextMomentIdx`, `syncNextIdx`, der Bremsweg-Vorgriff,
die Ausrollschwelle `speed < 4` und alle `dir > 0`-Schranken.

**Die Foto-Karte erscheint rückwärts genauso — und animiert rückwärts (E15).** *(Umgesetzt
am 14.08.: `Tour.synchronisiereKarte` → `UI.synchronisiereKarte`, CSS-Variable `--karte-zeit`.
`swapPhoto` ist ersatzlos entfallen — jede Aufnahme ist ein eigener Klip mit eigenem Auf- und
Abgang; `holdFrac` in der Telemetrie ebenso, der Balken wird im selben Frame gesetzt wie der
Rest.)* Das ist der
Teil, der Etappe 4 auf der DOM-Seite wieder größer macht, und er hängt an derselben
Umstellung: Im Editor stehen die Animationen dauerhaft auf `paused`, ihr Fortschritt kommt
aus einem NEGATIVEN DELAY (`--fe-zeit`) — rückwärts läuft dort alles von selbst rückwärts.
Der Player fährt dagegen echte Wanduhr-Animationen (Auftritt per Klassenwechsel, Ken Burns
als `transition`); die kann man nicht rückwärts laufen lassen, nur neu starten.

Bis Etappe 4 war das die richtige Trennung (§6A: „der Player läuft linear in Echtzeit, im
Editor wird gescrubbt"). Mit E2 verliert sie ihre Begründung — die Position ist dann auch im
Player eine Funktion der Filmzeit. Der Wechsel auf das Editor-Modell löst deshalb drei Dinge
in einem Zug: rückwärts stimmt, **Ken Burns wird pausierbar** (heute läuft er unter dem
„Angehalten"-Abzeichen weiter — der offene §6C-Eintrag erledigt sich hier), und **Scrubben
zeigt endlich etwas** (heute räumt `beginScrub` die Karte weg, wer durch einen Halt zieht,
sieht nichts). Die eine Grenze: Ein Video kann nicht rückwärts spielen — dort wird geseekt,
also Standbilder ohne Ton, genau wie im Editor.

**Zwei Dinge müssen mit der Rampe MITGEHEN, sonst hängen sie an einer anderen Uhr.** Das ist
dieselbe Regel wie in §8A, nur für Größen, die nicht die Filmzeit selbst sind:

- **Die Kameradistanz.** Sie zog mit τ = 2,2 s nach (rund 6 s bis sie steht), die Rampe ist in
  unter einer Sekunde fertig — dazwischen fährt man Fährtempo mit einer Fußgänger-Kamera.
  Gemessen als Bildschirm-Tempo (Fahrtempo ÷ Kameradistanz) sprang die Spitze auf das 5,3-Fache
  des Ruhewerts. Sie folgt deshalb derselben Rampe, und zwar am TEMPO geführt: Die Rampe ist
  eine Form über der ZEIT, eine Mischung über die Strecke hinkte ihr nach.
- **Die Fortbewegung, die Marker und Motorton lesen.** Sie kommt aus der Achse, nicht aus den
  rohen Modus-Grenzen — sonst läuft der Fußgänger-Marker über die Meter, die die Regel „Wechsel
  wandert auf den Halt" der neuen Fortbewegung zugeschlagen hat.

**Und die Geometrie muss dicht genug sein.** Die Achse rechnet in ROHEN Wegpunkt-Metern, die
Kamera fährt auf der gezeichneten Route — wo Catmull-Rom über weite Stützpunkte ausbeult, muss
die Kamera schneller werden, und der Überschuss sitzt in den KURVEN. An Stockholm liefen 2,2 %
des Films mehr als 50 % zu schnell (Spitze 4,9-fach), sichtbar als „die Schlenker wirken
extrem". `buildRoute` verdichtet die Stützpunkte deshalb vor der Glättung auf höchstens
`STUETZ_MAX_M` = 25 m; danach sind es 0,00 %. Das ist kein Datenproblem der Demo-Touren: Auch
eine App-Aufzeichnung legt bei Fährtempo hunderte Meter zwischen zwei Punkten.

**Und daraus folgt die Schichtung (E17): Die Bedienung gehört ÜBER das Bild.** *(Umgesetzt
am 14.08.: `.photo-layer` 12, `.finale` 13, darüber `.dock` 20, `.karten-info` 22 und
`.zurueck` 31; Wächter in [test/player-schichtung.test.ts](../../test/player-schichtung.test.ts).)*
Heute liegt
sie darunter (`.photo-layer` z-index 25 gegen `.dock` 20), und das trug nur, weil
`beginScrub` die Karte wegräumt — wer scrubbt, sieht sie nicht. Bleibt sie liegen, muss die
Leiste erreichbar sein, WÄHREND sie liegt. Das ist keine Kosmetik, sondern die Ordnung, die
jeder Videoplayer hat: Das Bild ist der Inhalt, die Steuerung liegt darauf. Mitzuziehen sind
`.finale` (26) und der Auto-Rückzug der UI — eine Leiste, die sich nach 3,2 s zurückzieht,
verdeckt ohnehin nichts, aber wenn sie auf Regung wiederkommt, muss sie oben sein.

**Der Schnelllauf geht auf 8× in BEIDEN Bühnen (E16)**, und mit ihm die zwei Regeln, die der
Editor schon hat: **Ton nur bei Tempo 1** ([playback.ts](../../src/studio/playback.ts):
„im Schnelllauf oder rückwärts klänge sie wie ein durchgedrehter Kassettenrekorder") und
**Karte aus ab 2×** ([editor.ts](../../src/studio/editor.ts): „dort will man die Strecke
überfliegen"). Das erledigt zugleich eine offene Lücke: Im Player läuft die Musik heute im
Schnelllauf weiter und driftet, weil `shuttle` keinen Ausgleich auslöst — mit dieser Regel
braucht sie keinen, sie klingt dort nicht. Im Editor wird aus `Math.min(t * 2, 4)` eine 8.

**Die Rampe ist eine feste Form über eine feste STRECKE (E14)**, keine nachgebaute
Exponentialkurve. Heute strebt `speed` das Ziel asymptotisch an (τ = 1,1 s beim Anfahren,
0,55 s beim Ausrollen): kräftig vorn, dann immer sanfter, **ohne definiertes Ende** — und die
Dauer hängt am Tempo (2,70 s je Halt auf der 41-km-Tour, 0,44 s auf der 356-m-Tour, wo nie
Vollgas erreicht wird). Genau diese Unschärfe ist der Grund, warum die Halt-Breite im Studio
heute nicht stimmen kann.

Stattdessen: eine ease-in-out-Form über eine feste Anfahrstrecke — sanft an, in der Mitte am
stärksten, sanft ins Tempo. Drei Folgen: Die Halt-Breite wird **exakt**, die Rampe ist im
Editor **zeichenbar**, und sie passt zur Achse, die seit E12 ohnehin über der Strecke rechnet
(eine Rampe über feste ZEIT müsste dort rückwärts aufgelöst werden). Nebeneffekt, gewollt:
Bei schneller Fortbewegung ist dieselbe Strecke früher durchfahren, der Antritt wirkt
knackiger; zu Fuß getragener.

**Die Länge wird kalibriert, nicht geraten** — an den heute gemessenen Rampen
([rampen-simulation.ts](../../scripts/messungen/rampen-simulation.ts)), damit sich die Fahrt
nicht sprunghaft anders anfühlt. Das Fahrgefühl ändert sich trotzdem hörbar am Antritt: kein
Ruck mehr ganz vorn. Das ist die eine Stelle dieses Vorhabens, die man SEHEN muss, bevor man
sie festschreibt (§14).

**NACHTRAG nach dem Abfahren (14.08.): Die Rampe gilt für JEDEN Tempowechsel.** Der erste
Wurf rampte nur um Halte herum; Modus-Grenzen sprangen von einem Frame zum nächsten — bei
Stockholm von zu Fuß auf Fähre, Faktor 6,25. Das war ein Fehler und kein Auslassen: Die alte
Engine hatte einen Tiefpass auf JEDE Tempoänderung, Etappe 4 hat ihn mit dem Integrator
entfernt, ohne ihn in der Kurve zu ersetzen. Sichtbar wurde es erst zusammen mit der Kamera,
die weiter geglättet folgt (`MODE_SCALE` walk 0,5/0,68 gegen ferry 2,3/2,2): erst schnell und
nah, dann schnell und weit — gemeldet als „auf einen Schlag sehr schnell, wird dann aber
scheinbar langsamer".

Die vorhandene Form verallgemeinert sich stetig, ein Halt ist seither der Sonderfall „Wechsel
von oder auf null": Über eine Rampenstrecke `L` von `v0` auf `v1` folgt die Geschwindigkeit
`v(u) = v0 + (v1 − v0) · smoothstep(u)`, daraus die Dauer `T = 2L/(v0 + v1)` und der
Weganteil `w(u) = [v0·u + (v1 − v0)·(u³ − u⁴/2)] / ((v0 + v1)/2)`. Für `v0 = 0` fällt exakt
die Halt-Rampe heraus. Zwei Festlegungen dazu, beide Entscheidungen und keine Ableitungen:
Die Rampe liegt **ganz im schnelleren Abschnitt** (beim Beschleunigen dahinter, beim Verzögern
davor), und kollidierende Rampen **teilen sich die Lücke anteilig nach ihrem Bedarf** — bei
zwei gleich langen genau hälftig.

Symmetrisch war der erste Wurf, und er war falsch: Die halbe Rampe lag dann im LANGSAMEREN
Abschnitt, man ging also die letzten 60 m zum Anleger schon mit anlaufendem Fährtempo. An
Stockholm gemessen mit dem 5,3-Fachen des Fußgängertempos, beim Aussteigen mit dem 6,6-Fachen —
und gemeldet als genau das: „da ist sogar das Laufen extrem schnell". Im schnelleren Abschnitt
stimmt es auch inhaltlich: Die Fähre beschleunigt, nachdem man eingestiegen ist, und der Wagen
bremst, bevor man aussteigt.

**Eine dritte Regel kam beim Nachfahren dazu**, und sie ist die eigentliche Lehre des harten
Falls: Ein Tempowechsel NÄHER als eine Rampenlänge an einem Halt wandert ganz **auf** den
Halt. Bei Stockholm liegt die Grenze zu Fuß → Fähre 13 m vor einem Foto-Halt; geteilt bekamen
Wechsel- und Bremsrampe je ein paar Meter, und der Film ging in 0,36 s auf volles Fährtempo,
um 0,06 s später stillzustehen — ein Ruck, wo vorher nur ein Sprung war. Auf den Halt gezogen
stimmt es auch inhaltlich: Dort steigt man ein, die neue Fortbewegung beginnt mit der
Weiterfahrt. Gemessen an der größten Tempo-Änderungsrate der Achse: 7 939 m/s² vorher, 560
m/s² danach — und 560 ist der Spitzenwert, den eine volle Fähr-Rampe von Natur aus hat.

**Und `MODUS_TEMPO.walk` geht von 0,4 auf 0,5** — gestalterisch, nach demselben Abfahren: Zu
Fuß wirkte einen Tick zu träge. Das ändert die Dauer jeder Tour mit Fußabschnitten.

**Die Rampen brauchen ihren Zwilling auf dem Server in DERSELBEN Auslieferung.**
[film-axis.ts](../../server/src/pipeline/film-axis.ts) kennt sie heute nicht (sie summiert nur
`meter / tempoMs` plus Halte). Bleibt sie zurück, lösen `anker + versatzFilmS` in Studio und
Render verschieden auf — exakt die Drift, die Etappe 3 gerade beendet hat.

*Fertig, wenn:* Die Gesamtdauer eines Durchlaufs deckt sich mit `spiel.gesamtS` im Studio auf
< 1 % (heute 9–13 %), an allen vier Fixtur-Touren.

**Etappe 4b — Ereignisse nach Filmzeit auslösen (E10).**

**Die Substanz ist die Auslöse-Logik, die JSON-Felder sind nur ihr Transport.** Solange
[audiotracks.ts](../../src/audiotracks.ts) in `frac` rechnet, ändert ein Feld daneben gar
nichts: `istAktiv` prüft `f0 <= frac && frac < f1`, und ein Klip, der ganz in einem Halt
liegt, hat `f0 === f1` — er bliebe stumm, welche Filmsekunde auch immer im JSON steht.
Deshalb gehören beide Teile in **dieselbe** Etappe:

1. `istAktiv` und `sfxSollFeuern` rechnen in **Filmsekunden** statt in `frac`. Beide sind
   **mit dem Studio geteilt** ([playback.ts](../../src/studio/playback.ts) importiert sie) —
   die Umstellung ändert Player und Editor in einem Zug, was hier erwünscht ist. Die
   0,02-Schwelle der SFX-Kante bekommt dabei ihre Entsprechung in Sekunden (Falle 2).
2. Additive Filmsekunde je Ereignis neben `f0`/`f1`, für Ton-Klips, Kamera-Keyframes und
   Momente; der Player nimmt sie, wenn sie da ist, sonst `f` wie bisher. Spec-Eintrag nicht
   vergessen (s. o.).
3. `enrich.ts` verwirft keine Klips mehr mit „liegt ganz in einer Standzeit".

> **Warum NACH Etappe 4 und nicht vorher.** Eine Filmsekunde ist keine absolute Größe — sie
> bedeutet, was die Achse sagt. Die Server-Achse kennt heute keine Rampen
> ([film-axis.ts](../../server/src/pipeline/film-axis.ts) summiert nur `meter / tempoMs` plus
> Halte); Etappe 4 legt sie hinein, und die Filmdauer wächst dadurch um 2,7–7,8 % (§14).
> „Filmsekunde 120,0" heißt vorher und nachher also etwas anderes, kumulativ über die Tour.
> Stünde Etappe 4b davor, trügen alle bis dahin gerenderten Touren still veraltete Anker —
> nichts sähe kaputt aus, es klänge nur falsch. Wer sie doch vorziehen will, muss einen
> **Re-Render-Lauf als Teil von Etappe 4** einplanen (das Repo kennt das Muster: „Bestands-
> touren brauchen Re-Render"). Der billigere Weg ist, die Reihenfolge zu respektieren.

*Fertig, wenn:* Ein Musik-Klip, der 2 s in einen 5,2-s-Halt hinein beginnt, setzt im Player
dort ein und nicht an der Halt-Kante — und keiner wird mehr mit „liegt ganz in einer
Standzeit" verworfen.

**Gebaut am 14.08.** Drei Nachträge aus der Umsetzung, die das Papier vorher nicht hatte:
Die Filmsekunde muss aus **`tour.filmS`** kommen und nie aus `filmBeiS(s)` — im Halt steht
`s`, der Rückweg über die Achse liefert dort die ganze Standzeit lang die ANKUNFT, also
genau den Wert, den `f` schon hat (aus `s` zurückgerechnet wäre das Feld wirkungslos
gewesen). Der Rückfall gilt **je Endpunkt einzeln** (`filmS ?? aus f0`, `filmBisS ?? aus f1`)
— dadurch bleibt ein Bereich auch dann ein Bereich, wenn nur eine der beiden Zahlen da ist,
und ein One-Shot braucht kein zweites Feld mit demselben Wert. Und die Server-Achse wird
seither **unbedingt** gebaut, nicht mehr nur bei Klips mit Anker-Feldern: Jedes Ereignis
bekommt seine Filmsekunde, also braucht sie jeder Zweig.

**Etappe 5 — Die Leiste.** Filmäquidistantes Höhenprofil, Halte mit Breite, `Telemetrie`
bekommt `frac` **und** `filmFrac`, `fracAt` liefert einen Filmanteil.

**Die Breite der Halte ist dabei keine Geschmacksfrage, sondern eine Folge.** Ein Halt
kostet Filmzeit; läuft der Playhead filmlinear, verbringt er dort mehrere Sekunden. Bliebe
der Halt ein Punkt, liefe der Kopf über ihn hinweg, während das Bild steht — genau der
Defekt, den das Studio am 2026-08-05 verlassen hat („Playhead: Stillstand vor Halt-Sprung,
28 von 39 Frames"). Und die Fläche ist zugleich der Griff: Ein Punkt lässt sich anspringen,
eine Breite lässt sich ANFAHREN — man kann mitten in einen Halt scrubben, was mit E15 auch
etwas zeigt.

Damit wird die Leiste des Players das, was die Zeitleiste des Editors längst ist: eine
Auskunft darüber, woraus der Film besteht. Der nächste Schritt in dieser Richtung wären
Miniaturen in den Halten (§2) — der ist bewusst NICHT Teil dieser Etappe.
*Fertig, wenn:* Der Playhead läuft durch einen Foto-Halt sichtbar durch, und die
Sonnenstand-/Wetter-Regie zeigt unverändert dieselben Werte an denselben Streckenpunkten.

**Gebaut am 14.08.**, gemessen mit [leiste-filmlinear.mjs](../../scripts/messungen/leiste-filmlinear.mjs)
(kuratierte und aufgezeichnete Tour): Der Kopf legt in einem 6-s-Halt 1,90 % der Leiste zurück
(Soll 1,91 %), sein längster Stillstand ist 0,11 s — der 10-Hz-Telemetrie-Takt, vorher die
ganze Standzeit. Ein Scrub in die Halt-Mitte landet auf 12,93 s (Ziel 12,93) und zeigt die
Karte mit `--karte-zeit: -3.000s`, also exakt der Halbzeit ihres Klips. Die Regie bekommt
weiterhin den Streckenanteil, Abweichung 0.

Vier Nachträge aus der Umsetzung:

- **Die Halt-Fläche darf nicht der Griff sein (E18).** Der erste Gedanke war, den Knopf
  selbst auf die Breite des Halts zu ziehen. Das hätte die Etappe gegen ihr eigenes Ziel
  gebaut: Ein Tipp in der Mitte spränge dann auf die ANKUNFT, also genau dorthin, wohin
  vorher jede Eingabe fiel. Die Fläche ist deshalb ein eigenes, nicht anfassbares Element
  (`.halt-flaeche`), und ein Scrub zieht quer durch sie hindurch.
- **`yAt` nimmt seither einen FILManteil (E19)** — mit dem Streckenanteil säßen die Punkte
  auf der falschen Höhe der eigenen Kurve. Auch `rebuildProfile` (nach dem Eintreffen der
  DEM-Höhen) rechnet damit, die Punkte tragen ihren Filmanteil im `dataset`.
- **Der Container der Punkte trägt jetzt zwei Sorten Kinder.** `punkte` fragt deshalb nach
  `.photo-dot` statt nach `children` — sonst läse `syncDots` `dataset.s` von einer Fläche
  und schaltete deren Zustand.
- **Der Balken bewegt sich weiter im 10-Hz-Takt**, nicht pro Frame: `emitStats` ist die
  einzige Quelle der Anzeige, und das war vor dieser Etappe genauso. Auf 100 ms fällt das
  nicht auf; wer es feiner will, ändert die Taktrate und nicht die Leiste.

**Was dabei auffiel und NICHT dazugehört:** `nudge` räumt die Karte weg (`raeumeKarte`),
statt sie auf die neue Filmsekunde zu stellen — wer im Halt Einzelbilder schaltet, sieht
nichts. Das ist eine Lücke von E15, keine der Leiste, und sie gehört zur Feinplatzierung
(§11), wo das Einzelbild ohnehin das Werkzeug ist.

**Danach — Feinplatzierung** (§11). Nach den Zeit-Etappen: Vorher stellte man Werte ein, die
der Player nicht einhält.

**Jederzeit dazwischen — Tag/Nacht im Editor** (§10), danach das Wetter mit Schalter. Und die
**Szene-Schicht** (§9): kleiner, sofort sichtbar, unabhängig.

**Ausdrücklich nicht:** die Filmachse ins Tour-JSON exportieren (E9). Die Begründung dafür
verschiebt sich mit dem Plan und sollte richtig dastehen:

- **Sie wird redundant, weil beide Seiten dieselbe Achse aus denselben Eingaben rechnen** —
  geteilte `filmachse.ts` (Etappe 3), Wegpunkt-`f` (E11), dieselben Modi und Halte. Nicht
  mehr, wie früher formuliert, „weil der Player ohnehin woanders ankommt": Nach Etappe 4
  kommt er genau dort an, das ist E2.
- **E10 deckt die eine Stelle ab, an der die Abbildung nicht umkehrbar ist** — den Halt. Ein
  bis zwei Zahlen je Ereignis statt einer ganzen Kurve.
- **Und sie ist teuer:** roh +17,8 % auf das größte `tour.json`, ~450 kB bei einer
  Ganztagestour.

Das heißt zugleich: **E9 trägt erst, wenn Etappen 2–4 stehen** — vorher rechnen die beiden
Achsen nicht dasselbe. Mit dem Vorbehalt aus Falle 4: Spät bekannte Videolängen können sie
wieder auseinanderziehen.

Ebenfalls nicht: die Rampen im Studio nachbilden (§5).

---

## 13. Fallen

1. **`frac` bedeutet ab Etappe 5 zwei Dinge.** Streckenanteil für Sonnenstand, Pseudo-Zeit,
   Wetter und `next.km`; Filmanteil für Balken, Playhead, Profil-x und Dot-x. Das
   Zeitleisten-Papier führt „zwei Film-Koordinatensysteme in einer Geste" als Falle und nennt
   es *immer* einen Bug. Zwei getrennte Feldnamen, keine Doppelbedeutung.
   **Umgesetzt so:** `Telemetrie` trägt `frac` UND `filmFrac`, die Scrub-Wege heißen
   `filmFrac` und `filmAnteilAt`. Die Kante zwischen beiden liegt in `UI.stats` und nirgends
   sonst: Balken und Playhead oben, ab `syncDots` wieder der Ort. Der eine Aufruf, der still
   kippen konnte, ist `onTick` — er treibt die Tag/Nacht-Regie an, die daraus
   `pointAt(route, frac · total)` rechnet; mit dem Filmanteil wanderte die Sonne im Halt
   weiter, während der Film steht. Gemessene Gegenprobe: `leiste-filmlinear.mjs` schneidet
   mit, was `onTick` bekommt, und vergleicht es gegen `tour.s / route.total`.
2. **`istAktiv` und `sfxSollFeuern` rechnen in `frac` — beide gehören in Etappe 4b**, nicht
   erst zur Leiste. Über einem Halt-Plateau bewegt sich `frac` nicht, ein Sprung darüber
   hinweg schon; und ein Klip ganz im Halt hat `f0 === f1` und ist damit nie aktiv. Beide sind
   **geteilt mit dem Studio**, also ändern sich beide Bühnen zugleich. (Falle 1 betrifft
   dagegen die ANZEIGE — das ist Etappe 5 und eine andere Baustelle.)
   **Die 0,02 sind keine kleine Zahl:** In `frac` sind das 2 % der ganzen Tour, auf
   Koh Pha-ngan ~4,4 Filmsekunden. Eine naiv übersetzte „0,02 s" verschluckte **jeden**
   One-Shot, weil jedes Frame länger dauert. Der neue Wert muss aus der schlechtesten
   Frame-Zeit hergeleitet werden — gemessen 205 ms bei 12×, am Telefon mehr (§4.1).
3. **Ein gedeckeltes `dtKamera` lässt die Kamera dauerhaft hinterherhängen — Teilschritte
   helfen dagegen NICHT.** Bleibt `dtKamera` bei 50 ms gedeckelt, während `dtFilm` frei läuft,
   integrieren alle Glättungsfilter bei 12× Drosselung nur ~65 % der vergangenen Zeit (§4.1),
   und der Blickpunkt schleppt sich hinter dem Fahrer her.
   **Die Abhilfe ist aber nicht Sub-Sampling, sondern der echte `dt`.** `Smooth.to` rechnet
   `1 − exp(−dt/τ)` — die exakte Lösung bei konstantem Ziel. Über ein langes Frame sammelt
   sich kein Fehler an, und N Teilschritte mit demselben Frame-End-Ziel ergeben **exakt**
   dasselbe (Exponentialfunktionen komponieren: `exp(−dt/τ)` = `exp(−dt/Nτ)^N`). Teilschritte
   kosteten also nur CPU auf genau dem Gerät, das schon Frames verliert.
   Der Deckel gehört damit nicht der Kamera, sondern nirgends: Die eine echte Frage ist, ob
   die Kamera bei einem langen Frame springen darf — und E1 beantwortet sie mit ja.
   *(Diese Falle stand zwei Fassungen lang falsch herum im Papier.)*
4. **„Was nicht an der Filmuhr hängt, muss ausdrücklich mitgehen" hat ZWEI belegte Fälle,
   und der zweite kam erst nach dem ersten.** Der offensichtliche ist der Hintergrund
   (Uhr steht, `<audio>` läuft — Paket B, nachgetragen). Der zweite ist die **verworfene
   Zeit**: Der Notdeckel (1,0 s) kappt, was ein gedrosseltes `rAF` ohne
   `visibilitychange` erzeugt — verdecktes Fenster, Kachel-Nachladen nach einem Sprung,
   langsames Gerät unter Last. Danach ist die Tondatei um genau diese Sekunden zu weit,
   dauerhaft, und wie weit hängt an der Vorgeschichte: In der Entwicklungs-Pane gemessen
   **29,4 s in zwei Frames**, hörbar als „dieselbe Stelle der Tour, andere Stelle des
   Stücks". Der Ausgleich hängt deshalb am Zähler selbst (`uhr.verworfenFrames` in
   `updateTrace`), nicht an den Sprungwegen — die kennt er nicht. Wer eine dritte Uhr
   einführt, prüft diese Liste: Bild, Ton, was noch?
5. **Die Achse hängt an Werten, die erst spät bekannt sind — und unter E2 springt dann `s`,
   nicht nur der Balken.** Videolängen kommen bei Altbestand erst mit `loadedmetadata`; ein
   Achsen-Neubau mitten in der Fahrt verschiebt die Abbildung Filmzeit → Position, und die
   Kamera setzt um. Entweder `dauerS` beim Import nachziehen (Migration) oder die Achse für
   die laufende Fahrt einfrieren. Fehlt `durationS` ganz, nimmt das Studio 5,2 s an — der
   Player muss dieselbe Annahme treffen.
6. ~~**Momente kosten im Studio Achsenbreite, in der Server-Achse nicht.**~~ **ERLEDIGT mit
   v0.60.5** (`baueMomentHalte` in `filmachse.ts`). War Vorbedingung für Etappe 3.

---

## 14. Was sich für den Nutzer ändert

**Der Player wird ein Videoplayer.** Das ist die Klammer um E13 bis E17, und es ist mehr als
die Summe der Einzelteile: Heute ist die Tour eine Fahrt, die man startet und die einem
Ereignisse vorlegt — ein Foto erscheint, weil die Engine gerade dort ankam. Danach ist sie
ein Film, in dem jede Stelle einen Zustand hat: Man kann mitten in ein Foto scrubben und
sieht es (mit seinem Ken-Burns-Stand an genau dieser Sekunde), man kann rückwärts hindurch,
die Bedienung liegt über dem Bild statt darunter, und in der Leiste hat jeder Halt die
Breite, die er im Film einnimmt.

Nichts davon ist eine neue Funktion. Es ist dieselbe Tour — mit dem Unterschied, dass sie
sich anfassen lässt, statt nur zu laufen.

**Die Tour fühlt sich anders an.** Anfahren und Ausrollen sind heute echtes Kameraverhalten.
In die Kurve gelegt bleiben sie erhalten — aber sie werden *gestaltet* statt zu *entstehen*,
und das ist eine Gelegenheit, sie zu ändern. Bewusst, nicht nebenbei.

**Jede bestehende Tour ändert ihre Dauer — auf dem Papier.** Wandert die Rampe in die Achse,
zeigt das Studio die *richtige* Dauer; der Film ist derselbe, die Zahl war vorher falsch.
Gemessen an den vier Fixtur-Touren gegen die Studio-Dauer VOR Etappe 4
([filmdauer.ts](../../scripts/messungen/filmdauer.ts),
[durchlauf-gegen-achse.mjs](../../scripts/messungen/durchlauf-gegen-achse.mjs)):

| Tour | vor Etappe 4 | mit Halt-Rampen | Modus-Rampen | `walk` 0,5 | jetzt | gesamt |
|---|---|---|---|---|---|---|
| 41 km, gemischt | 293,0 s | 314,6 s | −4,7 s | −2,2 s | **307,7 s** | +5,0 % |
| Stockholm (walk/tram/ferry) | 201,8 s | 228,8 s | −5,0 s | −16,6 s | **207,2 s** | +2,7 % |
| kurz, Rad | 51,0 s | 53,9 s | 0 | 0 | **53,9 s** | +5,7 % |
| Oberland, Rad | 171,5 s | 184,8 s | 0 | 0 | **184,8 s** | +7,8 % |

Also **2,7–7,8 % länger**, nicht die 9–13 %, die eine frühere Fassung hier nannte: Die
Modus-Rampen samt der Halt-Regel nehmen etwas zurück, das schnellere Fußtempo deutlich mehr —
und fast alles davon in Stockholm, das zu zwei Dritteln aus Fußwegen besteht. Reine Radtouren
haben weder Modus-Grenzen noch Fußwege und bleiben von beidem unberührt.

**Auf langsamen Geräten springt das Bild, statt zu schleichen.** Heute läuft die Tour bei
25 fps in Zeitlupe weiter und bleibt in sich stimmig — nur der Ton nicht. Danach hält sie die
Zeit und lässt Frames aus. Die Wahl, die jeder Videoplayer trifft, aber sichtbar.

---

## 15. Warum das die wartbarste Form ist

Nicht wegen der Genauigkeit. Wegen der Zahl der Stellen, die dasselbe wissen müssen.

Heute: **drei** Kopien des Tempo-Modells, **zwei** Uhren, **zwei** Parametrisierungen
derselben Strecke — und die Klammer darum sind Tests, die Quelltext nach Zeichenketten
absuchen. Das Repo dokumentiert selbst, was diese Bauform kostet: Die Modus-Liste ist schon
einmal auseinandergelaufen, die Gehabschnitts-Erkennung auch.

Danach: **zwei** Kopien (Web + Server, durch `rootDir` erzwungen, gegen ein gemeinsames
Fixture geprüft), **eine** Uhr, **eine** Parametrisierung. Die Rampe, die man heute an zwei
weiteren Stellen nachbilden müsste, existiert als eigenes Ding nicht mehr.

---

## 16. Werkzeuge

Die Messungen hinter allen Zahlen liegen in
[scripts/messungen/](../../scripts/messungen/README.md) — samt der sechs Fallen, die eine
Messung hier wertlos machen: gedrosseltes Headless (`chrome-headless-shell` ließ die Tour 20×
zu langsam laufen), der `dt`-Deckel (verfälscht genau das, was man messen will), das
0×0-Viewport des Entwicklungs-Panes, synthetische Klicks ohne User-Activation (unmuted
Autoplay bleibt geblockt, man misst „kein Ton", wo Ton wäre) — und `bringToFront()`, das in
Headless gar keinen Hintergrund herstellt: kein `visibilitychange`, rAF läuft weiter, die Uhr
wird nie angehalten und beide Vergleichsläufe kommen gleich heraus.
