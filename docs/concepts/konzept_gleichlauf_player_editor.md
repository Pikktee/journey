# Gleichlauf: ein Film, zwei Bühnen

Stand: 12. August 2026 · Status: **Entscheidungen getroffen, nichts gebaut** · Betrifft: `src/` (Player), `src/studio/`, `server/src/pipeline/`

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
| E9 | **Die Filmachse wird NICHT ins Tour-JSON exportiert** | 12.08. | §4 |

## 2. Offene Punkte

- **Bleibt der Zuschauer-`mult` (2×/4×)?** Als Faktor auf die Filmzeit bleibt der Schnitt in
  sich stimmig — aber ein Schalter, der die Filmdauer halbiert, ist eine bewusste Ausnahme
  vom Taktversprechen (E5).
- **Wie sieht die Rampe in der Kurve aus?** Heute exponentiell (τ = 1,1 s bzw. 0,55 s). Eine
  ease-in-out-Form über eine feste Strecke wäre einfacher zu beschreiben und im Studio
  zeichenbar.
- **Ken Burns: welche Zahl stimmt?** `holdS + 1.8` gegen `holdS + 0.8` (§6C). Erst messen,
  wie lange die Karte auf jeder Seite *tatsächlich* sichtbar ist — die Absicht ist aus dem
  Code nicht lesbar, weil Kommentar und Zahl sich widersprechen.
- **Steht der Wetter-Schalter im Editor anfangs an oder aus?** Aus wäre ruhiger beim
  Schneiden, an wäre ehrlicher zum Film.
- **Bekommen Halte in der Player-Leiste sichtbare Breite** (wie im Studio) oder bleiben es
  Punkte auf ihrem Beginn?
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

Alle Zahlen an den vier lokalen Touren, 12. August 2026. Werkzeuge und Messfallen: §16.

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

**Die Route (15 %).** `buildRoute` glättet (Catmull-Rom, 18 Stützpunkte je Span) und tastet
auf 14 m ab. Ergebnis gegenüber der Rohgeometrie, in der der Server `f` misst: **+2,18 %**
(Koh Pha-ngan), +2,58 % (Stockholm), +2,71 % (Oberland), +3,04 % (Völklingen).

### 4.3 Der Rest, den keine Uhr behebt

Server und Player parametrisieren dieselbe Strecke verschieden — der Server misst `f` auf der
Rohgeometrie, der Player rechnet `f × route.total` auf der geglätteten Route. Je Rohpunkt am
selben physischen Ort gemessen, **monotone** Zuordnung (sonst schnappt eine sich kreuzende
Route auf den falschen Vorbeigang), in Filmsekunden:

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

⇒ **Etappen 1–4 sind alle vier Pflicht.**

### Zwei Dinge, die sonst still dagegen arbeiten

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
| **Zeitmodell der Anzeige** | Ereignis + Wanduhr (`transition`, Zustandsmaschine `holdT`/`photoShown`) | Funktion der Kopfposition (dauerhaft pausierte Animationen mit negativem Delay, Balken *gesetzt* statt animiert, Video per Seek) | Der Player läuft linear in Echtzeit, im Editor wird **gescrubbt**. Ein gemeinsames DOM-Bauteil müsste beide Modelle tragen — [zeitleiste-umbau.md](../architecture/zeitleiste-umbau.md) führt das als Merkregel: *„Eine Anzeige, die an einer UHR hängt statt an der Position, driftet."* |
| **Ressourcen-Lebenszyklus** | `_stopVideo` mit `load()`, gestaffeltes Vorladen, Standbild + Generationszähler | Neuaufbau per `replaceChildren`, Seek statt Play, beide Schnittkanten im `dataset` (die Datei ist der ungeschnittene Master) | Der Player streamt einen Film **voraus**; der Editor springt in einer Datei umher, die er hat |
| **Ton-Bedienung** | Ton-Knopf, `sessionStorage`-Gedächtnis | keiner | Gehört dem **Zuschauer**, nicht dem Schneidenden |
| **Layout** | Vollbild-Bühne, `--photo-ar`/`--vh-app` (samt Android-WebView-Falle: `100dvh` ist dort NULL) | Container-Queries in einer Panel-Fläche | Zwei Bühnen, zwei Maßsysteme |
| **Karte** | Satellit + Gelände + FreeCamera-Flug | schlanker Raster-Stil, Pitch 0, klickbar | Instrument gegen Bild (§3) |
| **Atmosphäre** | Horizont-Dunst, Sonne, Sterne, Wolkenband | — | Bei Pitch 0 gibt es keinen Horizont. [atmosphere.ts](../../src/atmosphere.ts) steigt an drei Stellen selbst aus: `// Kamera schaut nach unten — kein Himmel im Bild` |

### B. Erzwungen redundant — Werkzeug, nicht Entwurf

| Was | Warum unvermeidbar | Absicherung |
|---|---|---|
| Server-Kopie des Tempo-Modells ([filmtempo.ts](../../server/src/pipeline/filmtempo.ts)) | `server/tsconfig.json` hat `rootDir: "."` — ein Import aus `../../src/` fällt heraus | Heute Regex auf den Quelltext von `tour.ts`. Künftig ein **gemeinsames Verhaltens-Fixture**, das beide Seiten durchrechnen |

Das ist die einzige Kopie, die bleiben **muss**. Alle anderen sind Gewohnheit.

### C. Heute redundant — und soll es nicht sein

| Was | Stand | Schaden |
|---|---|---|
| **Filmachse / Tempo** | 3 Kopien, per Quelltext-Regex gekoppelt (einer prüft, ob ein *Kommentar* dasteht) | die 9–13 % aus §4.2 |
| **Standzeit `5.2`** | 4 Stellen, bewacht sind 2. Die vierte steht roh in [ui.ts](../../src/ui.ts), weil `HOLD_HIDE` in [tour.ts](../../src/tour.ts) **nicht exportiert** ist | stille Abweichung, von keinem Test gesehen |
| **Ken-Burns-Dauer** | `holdS + 1.8` (Player) gegen `holdS + 0.8` (Editor) | **1 Sekunde** — und der Player-Kommentar sagt „holdS + Ausblende", während die Ausblende 0,8 ist |
| **Seitenverhältnis** | gemessen und geklemmt (0,62–1,85) gegen fest `aspect-ratio: 3/2` + `object-fit: cover` | Ein Hochformat-Foto steht im Player hochkant und wird im Editor auf den **Mittelstreifen** beschnitten — genau den, den der Player-Kommentar ausdrücklich vermeiden will |
| **CSS-Zwillinge** | Fortschrittsbalken wörtlich gleich; Ken-Burns-Endskala 1.01/1.02; „Ken Burns aus" = 1.0/1.04; Entwickeln-Filter verschieden | Der Farb-Wächter greift nicht: Er verbietet rohe Werte, die als **Token** existieren — `#d8d2c4`, `#8a7a63`, `#f5a524` sind keine |
| **Halt-Gruppierung** | zwei Implementierungen (`gruppiereStopps` / `baueStopps`) | nur per Textvergleich gekoppelt |

---

## 7. Der Stapel

Fünf Schichten, von unten. Nur die oberste ist an 3D gebunden.

| Schicht | Modul | Heute | Künftig |
|---|---|---|---|
| **Ton** | [audiotracks.ts](../../src/audiotracks.ts) | ✅ geteilt | unverändert — die Vorlage für alles andere |
| **Zeit** | `src/filmachse.ts` *(neu)* | 3 Kopien | 1 Web-Modul + 1 Server-Spiegel (erzwungen), Fixture statt Regex |
| **Szene** | `src/einblendung.ts` *(neu)* | Kern teils geteilt, Zahlen doppelt | 6 reine Funktionen (§9) |
| **Stimmung** | `sunPosition` + `paramsAt` | `sunPosition` ist rein; `paramsAt` **nicht exportiert** | geteilte *Rechnung*, getrennte *Anwendung* |
| **Wetter** | [weather.ts](../../src/weather.ts) | nur Player | dasselbe Modul auf beiden Bühnen |

**Was das einbringt:** aus 3 Tempo-Kopien werden 2, aus 4 Standzeit-Stellen 1, die
Szene-Zahlen von 2 auf 1 — und vier Wächter, die Quelltext nach Zeichenketten absuchen,
verschwinden ersatzlos.

---

## 8. Die Zeit-Schicht im Einzelnen

**A. Eine Uhr (E1).** Die Engine zählt Filmsekunden aus einer monotonen Echtzeituhr statt aus
aufsummierten, geklemmten Frames. Ein langsames Gerät lässt das Bild dann **springen**, nicht
**nachlaufen** — die richtige Wahl für einen Film mit Ton. Der Deckel bleibt, wo er hingehört:
bei der **Kamera-Glättung** (`Smooth.to`, `glide`, `skyLift`, `tuck`, `reposeTween`). Das ist
genau die Trennlinie, die ohnehin durch den Code geht: Inhaltliches hängt an der Position,
Ästhetisches an `dt`.

`visibilitychange` gehört dazu, nicht als Zusatz: Ohne Deckel schöbe ein zurückkehrender
Hintergrund-Tab die Filmzeit um die volle Abwesenheit vor.

**Kein Audio-Masterclock.** Naheliegend wäre, die Filmzeit aus `audio.currentTime` zu nehmen.
Geht nicht: Musik liegt in **Bereichen** `[f0,f1)`, mehrere dürfen sich überlappen, dazwischen
ist Stille. Es gibt keine durchgehende Tonspur. Läuft die Filmuhr in Echtzeit, ist es auch
nicht nötig — beide Uhren sind dann dieselbe.

**B. Die Position folgt der Filmzeit (E2).** Im Kern **eine Zeile** — der Integrator in
[tour.ts](../../src/tour.ts) wird `s = anteilBei(kurve, filmS) · total`; der Studio-Abspieler
betreibt dieses Modell schon ([abspielen.ts](../../src/studio/abspielen.ts), `tick()`).
Anfahren und Ausrollen sind danach keine emergente Eigenschaft einer Differentialgleichung
mehr, sondern eine **Form in der Kurve** — es gibt kein zweites Modell zum Nachbilden.
Nebeneffekte, alle in die richtige Richtung: `mult` wird ein Faktor auf die Filmzeit, `nudge`
wird 1/24 Filmsekunde, Scrubben wird filmlinear und damit positionstreu.

**C. Eine geteilte Filmachse (E3).** `src/filmachse.ts`, importiert von Player und Studio. Der
gemeinsame Kern ist ~60 Zeilen und domänenfrei: *(Abschnittslängen, Modus je Abschnitt, Halte
als Position + Breite) → Stützstellenkurve + Halt-Intervalle + Interpolation in beide
Richtungen*. `interpoliere` ist zwischen Studio und Server heute schon **byte-identisch**,
`webeHalte` unterscheidet sich in zwei Zeilen.

**Die x-Achse wird die Strecke, nicht die Aufnahmezeit.** Im Studio ist der Zeitstempel reiner
Schlüssel — die abhängige Größe entsteht rein geometrisch. Über der Strecke wird die Abbildung
außerdem **eindeutig umkehrbar**: In der Zeitachse ist eine reale Pause ein Plateau
(Umkehrung mehrdeutig, per Konvention „Ankunft"), über der Strecke ist sie ein Punkt.

Das Modul gehört nach `src/`, neben `geo.ts` und `audiotracks.ts` — nicht nach `src/studio/`.
Ein Import Player→Studio zöge die Editor-Typenwelt in den Player-Chunk und drehte die bisher
saubere Abhängigkeitsrichtung um.

**D. `f` über die Wegpunkte (E4).** Der Player baut seine Route aus **denselben Wegpunkten**,
die der Server geschickt hat — er kann für jeden beides ausrechnen: die kumulierte Rohdistanz
(= `f` des Servers) und sein `s` auf der gebauten Route. In `buildRoute` ist das billig:
Wegpunkt `i` entspricht exakt `dense[i · SEGS]`. Es fehlt nur, den Wegstand mitzuschreiben —
fünf Zeilen und ein Feld `wegpunktS` in `Route`. Räumt §4.3 weg und behebt denselben Fehler
bei Kamera-Keyframes, Momenten und Wetter-Ankern mit.

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
`STUDIO_PEGEL_VORGABE` ([audiotracks.ts](../../src/audiotracks.ts)); `klemmeVideoTrim`,
`videoFilmS`, `videoStandS`, `aufnahmeHaltS`, `HALT_ENGINE_S`/`HALT_AUSBLEND_S`
([zeitleiste.ts](../../src/studio/zeitleiste.ts)); `NAHE_M` samt Gruppierungsregel.

Doppelt sind die DOM-/CSS-Schicht (~200 Zeilen TS + ~110 Zeilen CSS je Seite) und die Zahlen
aus §6C. **Ein geteiltes DOM-Modul wäre die falsche Antwort (E8):** Die beiden Karten teilen
die Optik, aber nicht ihr Zeitmodell.

Geteilt wird ein DOM-freies `src/einblendung.ts` mit sechs reinen Funktionen — jede mit einem
konkreten Anlass von heute:

| Funktion | Anlass |
|---|---|
| `klipDauerS` / `kenBurnsDauerS` | die 1-Sekunden-Abweichung |
| `standzeitS` (mit exportiertem `HOLD_HIDE`) | die ungewachte `5.2` |
| `klemmeSeitenverhaeltnis(b, h)` | existiert nur als Inline-Ausdruck im Player; der Editor hat die Regel gar nicht |
| `balkenAnteil(imS, dauerS)` | heute drei Formeln für denselben Balken |
| `tonPegelFuer({ imS, ausschnittS })` | geteilte Kurve, verschiedene Argumente |
| `reihenfolgeImHalt` | zwei Implementierungen, nur per Textvergleich gekoppelt |

Dazu ein **CSS-Paar-Wächter** analog zu [basis-css.test.ts](../../test/basis-css.test.ts).

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

1. **Die Zeitfelder des Ton-Inspectors zeigen `HH:MM`.** `uhrzeitKurz` formatiert mit
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

Kein Schema-Bruch in keiner Etappe — das Austauschformat bleibt unverändert.

**0. Nachsehen, was seit v0.60.4 live ist.** Der Video-Ton im Studio und der neue Player-Pegel
sind ausgeliefert, aber nie gehört. Braucht eine Tour mit Video.

**1. Gruppe C, die drei kleinen Reparaturen** (§6C): Seitenverhältnis, Ken-Burns-Sekunde, rohe
`5.2` (samt `export` in `tour.ts`). Heute Fehler, unabhängig von jedem Umbau, **nichts davon
wird später weggeworfen**. Je ein kleiner Wächter dazu. Ein Nachmittag.

**2. Etappe 1 — Eine Uhr.** `tick()` trennt `dtKamera` (weiter bei 50 ms gedeckelt) von
`dtFilm` (Echtzeit, gedeckelt erst bei ~0,25 s als Hänger-Schutz); `s`-Integration und alle
Zeitzähler (`holdT`, `momentT`) laufen auf `dtFilm`; `visibilitychange` pausiert. Test ohne
Browser: 10 s Echtzeit mit 200-ms-Frames müssen 10 s Filmzeit ergeben, nicht 2,5 s.
*Fertig, wenn:* Bei 6× CPU-Drosselung deckt sich `Δs ÷ Tempo` mit `Δ audio.currentTime` auf
±2 % (heute 81,3 %) — Messskript in §16. **Eigenes Release, bewusst allein.**

**3. Etappe 2 — `f` über die Wegpunkte.** `buildRoute` schreibt `wegpunktS` mit; `main.ts`
ersetzt alle `f * route.total`.
*Fertig, wenn:* Der Median-Fehler aus §4.3 fällt unter 0,05 s.

**4. Etappe 3 — Die geteilte Achse.** `src/filmachse.ts` als domänenfreier Kern; das Studio
benutzt ihn statt der eigenen Kopie; der Player rechnet seine Filmachse, **noch ohne sie
anzutreiben**; der Server prüft gegen ein Verhaltens-Fixture statt gegen Regex.
*Fertig, wenn:* Das Tempo-Modell steht an genau zwei Stellen und kein Test liest mehr
Quelltext per Regex.

**5. Etappe 4 — Der Antrieb dreht sich um.** **Vorbedingung:** Video-Halte an die Achse
hängen statt an `ended` (§5). Dann: Rampen als explizite Form in die Achse; `s` aus der
Filmzeit ableiten; Bremsweg-Vorgriff und Ausrollschwelle entfallen; Scrubben, `seek`, `nudge`,
`mult` auf Filmsekunden.
*Fertig, wenn:* Die Gesamtdauer eines Durchlaufs deckt sich mit `spiel.gesamtS` im Studio auf
< 1 % (heute 9–13 %), an allen vier Fixtur-Touren.

**6. Etappe 5 — Die Leiste.** Filmäquidistantes Höhenprofil, Halte mit Breite, `Telemetrie`
bekommt `frac` **und** `filmFrac`, `fracAt` liefert einen Filmanteil.
*Fertig, wenn:* Der Playhead läuft durch einen Foto-Halt sichtbar durch, und die
Sonnenstand-/Wetter-Regie zeigt unverändert dieselben Werte an denselben Streckenpunkten.

**7. Feinplatzierung** (§11). **Nach** den Zeit-Etappen: Vorher stellte man Werte ein, die der
Player nicht einhält.

**8. Tag/Nacht im Editor** (§10), danach das Wetter mit Schalter. Unabhängig vom Rest, kann
dazwischen.

**9. Szene-Schicht** (§9). Kleiner, sofort sichtbar, unabhängig; jederzeit dazwischen.

**Ausdrücklich nicht:** die Filmachse ins Tour-JSON exportieren (E9) — sie löst das Problem
nicht, ihr Informationsgehalt ist bis auf `stats.km` redundant (das der Player heute schon
bekommt und ignoriert), und roh wäre sie +17,8 % auf das größte `tour.json` bzw. ~450 kB bei
einer Ganztagestour. Und: die Rampen im Studio nachbilden (§5).

---

## 13. Fallen

1. **`frac` bedeutet ab Etappe 5 zwei Dinge.** Streckenanteil für Sonnenstand, Pseudo-Zeit,
   Wetter und `next.km`; Filmanteil für Balken, Playhead, Profil-x und Dot-x. Das
   Zeitleisten-Papier führt „zwei Film-Koordinatensysteme in einer Geste" als Falle und nennt
   es *immer* einen Bug. Zwei getrennte Feldnamen, keine Doppelbedeutung.
2. **`sfxSollFeuern` prüft eine Kante mit Schwelle 0,02 in `frac`.** Über einem Halt-Plateau
   bewegt sich `frac` nicht, ein Sprung darüber hinweg schon. Muss auf Filmsekunden umgestellt
   werden — und sie ist **geteilt mit dem Studio**, also ändern sich beide Seiten zugleich.
3. **Die dt-Trennung ist keine Kosmetik.** Wird `dtFilm` versehentlich in `Smooth.to`
   gereicht, ruckelt die Kamera bei jedem langen Frame sichtbar.
4. **Die Achse hängt an Werten, die erst spät bekannt sind.** Videolängen kommen bei Altbestand
   erst mit `loadedmetadata`. Dann braucht es einen zweiten Aufbau, und der Balken springt
   einmal nach. Fehlt `durationS` ganz, nimmt das Studio 5,2 s an — der Player muss dieselbe
   Annahme treffen.
5. ~~**Momente kosten im Studio Achsenbreite, in der Server-Achse nicht.**~~ **ERLEDIGT mit
   v0.60.5** (`baueMomentHalte` in `filmachse.ts`). War Vorbedingung für Etappe 3.

---

## 14. Was sich für den Nutzer ändert

**Die Tour fühlt sich anders an.** Anfahren und Ausrollen sind heute echtes Kameraverhalten.
In die Kurve gelegt bleiben sie erhalten — aber sie werden *gestaltet* statt zu *entstehen*,
und das ist eine Gelegenheit, sie zu ändern. Bewusst, nicht nebenbei.

**Jede bestehende Tour wird 9–13 % länger — auf dem Papier.** Wandert die Rampe in die Achse,
zeigt das Studio die *richtige* Dauer. Wer „4:53" gewohnt ist, sieht danach „5:25". Der Film
ist derselbe; die Zahl war vorher falsch.

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
[scripts/messungen/](../../scripts/messungen/README.md) — samt der vier Fallen, die eine
Messung hier wertlos machen: gedrosseltes Headless (`chrome-headless-shell` ließ die Tour 20×
zu langsam laufen), der `dt`-Deckel (verfälscht genau das, was man messen will), das
0×0-Viewport des Entwicklungs-Panes, und synthetische Klicks ohne User-Activation (unmuted
Autoplay bleibt geblockt, man misst „kein Ton", wo Ton wäre).
