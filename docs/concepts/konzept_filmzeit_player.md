# Der Player läuft auf Filmzeit

Stand: 12. August 2026 · Status: **Konzept, nichts gebaut** · Betrifft: `src/` (Player), `src/studio/`, `server/src/pipeline/`

**Ziel:** Bild und Ton laufen synchron — auf jedem Gerät, und deckungsgleich mit dem
Schnitt im Studio. Heute tun sie beides nicht, und zwar aus zwei verschiedenen Gründen,
von denen nur einer bekannt war.

Ausgelöst hat das die Beobachtung: „Im Player läuft die Musik ganz anders als im Studio
Editor." Die naheliegende Erklärung — dem Player fehlt die Filmachse des Studios, also
exportieren wir sie ins Tour-JSON — ist beim Nachmessen durchgefallen. Sie behebt das
Problem nicht, und das eigentliche Problem ist größer.

---

## 1. Der Kernbefund: zwei Uhren, nicht eine fehlende Kurve

Bild und Ton im Player hängen an **verschiedenen Uhren**:

- **Das Bild** zählt aufsummierte Frame-Zeit, bei 50 ms gedeckelt —
  [`tour.ts:791`](../../src/tour.ts): `const dt = Math.min((now - this.lastT) / 1000, 0.05)`.
  Jedes Frame, das länger dauert, verliert die Differenz **still**.
- **Der Ton** zählt die Echtzeit-Uhr seines `<audio>`-Elements. Die verliert nie.

Der Deckel ist ein sinnvoller Schutz gegen Sprünge nach einem Hänger. Aber er macht die
Bilduhr zu einer Uhr, die unter Last **langsamer geht** — und nichts zieht den Ton mit.
Solange diese beiden Uhren getrennt laufen, ist „100 % synchron" nicht erreichbar, egal
wie genau die Daten sind.

Das ist der eine Grund. Der zweite ist der bekannte: Der Player fährt in Streckenmetern
und beschleunigt weich, das Studio rechnet Meter ÷ Modus-Tempo ohne Rampen. Beide Gründe
zusammen ergeben die gemeldete Beobachtung.

**Was daraus folgt, ist nicht „eine Kurve exportieren", sondern „eine Uhr, eine Achse".**

---

## 2. Messwerte

Alle Zahlen an den vier lokalen Touren, 12. August 2026.

### 2.1 Die Uhren laufen auseinander (Chromium, CDP-CPU-Drosselung)

Gemessen wurde die **stetige Fahrt** (Halte und Rampen ausgeschlossen: Phase `ride`,
Tempo > 97 % des Ziels), Berner Oberland, je 25 s:

| Drosselung | Bildrate | Bilduhr läuft mit | Versatz nach 5 min Film |
|---|---|---|---|
| 1× | 72,6 fps | **99,7 %** der Echtzeit | 1 s |
| 6× | 34,3 fps | **81,3 %** | 56 s |
| 12× | 19,2 fps | **46,1 %** | 162 s |
| 20× | 13,8 fps | — (Zieltempo nie erreicht) | — |

Der Mechanismus, direkt an den Frame-Abständen derselben rAF-Kette nachgewiesen (20 s):

| Drosselung | Bildrate | Frame-Zeit p50 / p95 / max | Frames über 50 ms | Von der Engine verworfen |
|---|---|---|---|---|
| 1× | 70,3 fps | 12,7 / 27,7 / 48 ms | 0,0 % | **0,0 s (0 %)** |
| 6× | 37,9 fps | 23,9 / 61,3 / 96 ms | 11,3 % | **1,0 s (5,0 %)** |
| 12× | 25,4 fps | 17,6 / 130,5 / 205 ms | 28,9 % | **7,1 s (35,3 %)** |

Zwei Dinge, die man daran ablesen muss:

1. **Der Median täuscht.** Bei 12× liegt die halbe Verteilung bei harmlosen 17,6 ms — der
   Verlust steckt vollständig im Schwanz (p95: 130 ms). Eine Anzeige „25 fps" verrät den
   Fehler nicht.
2. **Die Schwelle liegt niedriger als gedacht.** Schon bei knapp 38 fps im Mittel gehen
   5 % der Zeit verloren. Für Maptale ist das kein Randfall: Der Engpass ist gemessen die
   MapLibre-Pipeline (~72–90 % der Frame-Zeit,
   [`performance-engpass-maplibre`](../archive/renderer-labor.md)), und am Pixel 9 sind
   unter Last ~26 fps gemessen worden.

**Nicht gemessen, aber aus dem Code sicher:** Der Player hat **keinerlei
`visibilitychange`-Behandlung** (`grep` über `src/`: nur `studio/editor.ts` und
`admin/admin.ts` haben eine). Wird der Tab versteckt, hält `requestAnimationFrame` an, das
Bild friert ein — die `<audio>`-Elemente laufen weiter. Nach 30 s im Hintergrund ist die
Musik 30 s weiter als das Bild. Das Studio pausiert in diesem Fall (`halteAbspielen()`),
der Player nicht.

### 2.2 Der Player braucht länger als der Film, den das Studio zeigt

Die Geschwindigkeitslogik der Engine ([`tour.ts:916-953`](../../src/tour.ts)) in Node
nachgebildet und mit festem `dt = 1/60` integriert. Der Browser taugt dafür nicht:
headless drosselt rAF, und der 50-ms-Deckel verfälscht genau das, was gemessen werden soll.

| Tour | Stopps | Studio-Film | Player | Differenz | davon Route | davon Rampen | je Stopp |
|---|---|---|---|---|---|---|---|
| Koh Pha-ngan | 12 | 293,0 s | 330,2 s | **+37,2 s (12,7 %)** | +4,8 s | +32,4 s | 2,70 s |
| Stockholm | 8 | 201,8 s | 220,1 s | **+18,3 s (9,1 %)** | +3,7 s | +14,7 s | 1,83 s |
| Berner Oberland | 6 | 171,5 s | 191,1 s | **+19,5 s (11,4 %)** | +3,7 s | +15,9 s | 2,64 s |
| Runde bei Völklingen | 3 | 51,0 s | 52,4 s | +1,4 s (2,8 %) | +0,1 s | +1,3 s | 0,44 s |

Zwei Ursachen:

**Die Rampen (85 % des Fehlers).** Anfahren kostet exakt `τ = 1,1 s` je Halt, unabhängig
vom Tempo: aus `v(t) = V(1 − e^{−t/τ})` folgt für die Zeit über eine Strecke `s` genau
`T = s/V + τ`. Ausrollen kostet `0,55·ln(V/4) − 0,55·(1 − 4/V)`, bei Vollgeschwindigkeit
also 1,34 s. Zusammen ~2,4 s analytisch, 2,6–2,7 s simuliert (die Differenz ist der
Bremsweg-Vorgriff `speed · 0,62`).

**Das Modell ist nicht durch eine Konstante ersetzbar:** 2,70 s je Stopp auf der 41-km-Tour,
aber 0,44 s auf der 356-m-Tour — dort erreicht die Engine zwischen den Stopps nie
Vollgeschwindigkeit. Wer die Rampen im Studio nachbilden will, braucht dort eine
**Simulation der Engine-Schleife**, keine Zahl.

**Die Route (15 %).** `buildRoute` glättet mit Catmull-Rom (18 Stützpunkte je Wegpunkt-Span)
und tastet auf 14 m ab. Das Ergebnis ist länger als die Rohgeometrie, in der der Server `f`
misst:

| Tour | roh | `route.total` | Abweichung |
|---|---|---|---|
| Koh Pha-ngan | 40.941 m | 41.833 m | **+2,18 %** |
| Stockholm | 24.133 m | 24.755 m | **+2,58 %** |
| Berner Oberland | 16.262 m | 16.703 m | **+2,71 %** |
| Runde bei Völklingen | 356 m | 367 m | **+3,04 %** |

### 2.3 Der Rest, den keine Uhr behebt

Server und Player parametrisieren dieselbe Strecke verschieden — der Server misst `f` auf
der Rohgeometrie, der Player rechnet `f × route.total` auf der geglätteten Route. Gemessen
je Rohpunkt am selben physischen Ort, mit **monotoner** Zuordnung (sonst schnappt eine sich
kreuzende Route auf den falschen Vorbeigang), umgerechnet in Filmsekunden:

| Tour | Filmdauer | Median | p90 | max |
|---|---|---|---|---|
| Koh Pha-ngan | 221,0 s | 0,70 s | 0,88 s | **9,02 s** |
| Stockholm | 141,8 s | 0,40 s | 0,68 s | 0,82 s |
| Berner Oberland | 135,5 s | 0,22 s | 0,64 s | 0,98 s |
| Runde bei Völklingen | 3,0 s | 0,03 s | 0,05 s | 0,05 s |

Typisch eine halbe Sekunde. Die 9 s auf Koh Pha-ngan liegen dort, wo Wegpunkte weit
auseinanderstehen (Fährabschnitt) und Catmull-Rom entsprechend frei interpoliert.

Betroffen ist **alles, was mit `f` ankommt**: Audio-`f0`/`f1`, Kamera-Keyframes,
`moments[].f`, `weather[].km`. Fotos nicht — die werden über `nearestS` neu verankert.

---

## 3. Verworfen: die Filmachse ins Tour-JSON exportieren

Das war der erste Vorschlag. Er ist aus drei Gründen durchgefallen.

**Er löst das Problem nicht.** Eine Kurve sagt dem Player, *wo* Filmsekunde X liegt. Sie
sorgt nicht dafür, dass er dort *zur* Sekunde X ankommt. Um sie zu nutzen, müsste der Ton
nachgezogen werden — bei 2,7 s je Halt ein hörbarer Sprung. Und gegen den Uhrenversatz aus
§2.1 hilft sie überhaupt nicht.

**Sein Informationsgehalt ist fast vollständig redundant.** Die Kurve trägt Modusgrenzen,
Standzeiten und die Rohlänge. Die ersten beiden hat der Player längst (`segments[].mode`,
`media[].display.holdS`, `durationS`), die dritte steht als `stats.km` schon im Tour-JSON —
sie wird in [`main.ts`](../../src/main.ts) nur nirgends gelesen.

**Er ist teurer, als er aussieht.** Roh — eine Stützstelle je Trackpunkt, wie
`baueFilmAchse` sie heute baut — sind es **+17,8 %** auf das größte lokale `tour.json`
(5.755 B auf 32 kB) und bei einer Ganztagestour mit 1-s-GPX rund **450 kB**. Analytisch
destilliert wären es ~31 Stützstellen (~0,7 kB), weil f→Filmsekunde **stückweise linear per
Konstruktion** ist: Die Steigung ist `gesamtM / (120 · tempo(mode))`, konstant innerhalb
eines Modus, mit senkrechten Sprüngen an den Halten. Aber dafür bräuchte es
Destillat-Logik, deren Maß die Halt-Plateaus nicht wegkürzen darf; dazu ein unbedingter
Achsen-Bau (heute nur bei Ton-Ankern, `enrich.ts:383`), ein Feld in `TourJson` und
`RemoteTourCfg`, ein Eintrag im [Austauschformat](../specs/austauschformat.md) — und alle
**11 Schnappschüsse** des Vertragstests verschieben sich.

## 3b. Ebenfalls verworfen: die Rampen im Studio nachbilden

Der billige Zwischenweg wäre: `baseSpeed` mit `stats.km · 1000 / route.total` skalieren und
die Rampen in `filmtempo.ts`/`baueAchse` nachrechnen. Das nähme rund 11 % Versatz auf
Bruchteile herunter und kostet einen halben Tag.

**Verworfen, weil es die Wartungslast erhöht statt senkt.** Das Tempo-Modell steht heute
schon **dreimal** — [`tour.ts`](../../src/tour.ts),
[`studio/zeitleiste.ts`](../../src/studio/zeitleiste.ts),
[`server/pipeline/filmtempo.ts`](../../server/src/pipeline/filmtempo.ts) —, zusammengehalten
von Wächtern, die den **Quelltext** per Regex lesen. Die Rampen sind nicht als Konstante
nachbildbar (§2.2), also käme in zwei der drei Kopien eine Simulation der Engine-Schleife
dazu. Und beim späteren Umbau wäre die Arbeit vollständig weg: Ein Player, der seine
Position aus der Achse ableitet, hat keine Rampe mehr, die man nachbilden könnte.

Der Regex-Wächter ist dabei der schwächste Punkt im Bestand.
`server/test/filmachse.test.ts` prüft unter anderem, ob im Studio-Quelltext der Kommentar
`Umkehrung; Plateau → Ankunft` steht. Eine gleichwertige Umformulierung bricht ihn; eine
echte Verhaltensänderung an anderer Stelle nicht.

---

## 4. Die Entscheidungen

### A. Eine Uhr — die Filmzeit kommt aus der Echtzeit

Die Engine zählt Filmsekunden aus einer monotonen Echtzeituhr statt aus aufsummierten,
geklemmten Frames. Ein langsames Gerät lässt das Bild dann **springen**, nicht
**nachlaufen** — das ist die richtige Wahl für einen Film mit Ton.

Der Deckel bleibt, wo er hingehört: bei der **Kamera-Glättung**. Das ist genau die
Trennlinie, die ohnehin durch den Code geht — alles Inhaltliche (was wann kommt) hängt an
der Position, alles Ästhetische (wie weich es kommt) an `dt`: `Smooth.to`, `glide`,
`skyLift`, `tuck`, `reposeTween`.

**`visibilitychange` ist Teil dieser Entscheidung, nicht ein Zusatz.** Ohne Deckel würde ein
zurückkehrender Hintergrund-Tab die Filmzeit um die volle Abwesenheit vorschieben. Der
Player pausiert beim Verstecken (wie das Studio) und setzt beim Zurückkommen den Bezugspunkt
neu.

**Kein Audio-Masterclock.** Naheliegend wäre, die Filmzeit aus `audio.currentTime` zu
nehmen, wie es Videoplayer tun. Das geht hier nicht: Musik liegt in **Bereichen** `[f0,f1)`,
mehrere dürfen sich überlappen, und zwischen ihnen ist Stille. Es gibt keine durchgehende
Tonspur, an die man sich hängen könnte. Läuft die Filmuhr in Echtzeit, ist das auch nicht
nötig — beide Uhren sind dann dieselbe Uhr.

### B. Die Position folgt der Filmzeit, nicht umgekehrt

Heute ist `s` die eine Zustandsvariable und die Filmzeit gibt es gar nicht. Danach ist die
Filmsekunde führend und `s = anteilBei(kurve, filmS) · total`.

Das ist im Kern **eine Zeile** — der Integrator [`tour.ts:926`](../../src/tour.ts) —, und
der Studio-Abspieler betreibt genau dieses Modell schon
([`abspielen.ts:93`](../../src/studio/abspielen.ts), `tick()`).

Was dabei **verschwindet**, ist der Punkt: Anfahren und Ausrollen sind dann keine emergente
Eigenschaft einer Differentialgleichung mehr, sondern eine **Form in der Kurve**. Es gibt
kein zweites Modell, das nachgebildet werden müsste — die Achse *ist* die Wahrheit.

Nebeneffekte, alle in die richtige Richtung: `mult` (2×/4×) wird ein Faktor auf die
Filmzeit; `nudge` (Einzelbild) wird 1/24 Filmsekunde statt einer Strecke; Scrubben wird
filmlinear und damit positionstreu.

### C. Eine geteilte Filmachse als Modul

Ein neues `src/filmachse.ts`, importiert von **Player und Studio**. Aus drei Kopien werden
zwei.

Der gemeinsame Kern ist ~60 Zeilen und domänenfrei: *(Abschnittslängen in Metern, Modus je
Abschnitt, Halte als Position + Breite in Filmsekunden) → Stützstellenkurve + Halt-Intervalle
+ Interpolation in beide Richtungen*. `interpoliere` ist zwischen Studio und Server heute
schon **byte-identisch**, `webeHalte` unterscheidet sich in zwei Zeilen.

**Die x-Achse wird die Strecke, nicht die Aufnahmezeit.** Im Studio ist `p[3]`
(Aufnahmezeit) reiner Schlüssel — die abhängige Größe entsteht rein geometrisch. Über der
Strecke wird die Abbildung außerdem **eindeutig umkehrbar**: In der Zeitachse ist eine reale
Pause ein Plateau (Umkehrung mehrdeutig, per Konvention „Ankunft"), über der Strecke ist sie
ein Punkt. Der Server spart sich damit den Zwischenschritt
`positionZurZeit(reihe, zeitBeiFilm(achse, filmS)).f` ([`enrich.ts:404`](../../server/src/pipeline/enrich.ts)).

**Der Server behält seine Kopie.** `server/tsconfig.json` hat `rootDir: "."` — ein Import
aus `../../src/` fällt heraus. Das ist die einzige echte Grenze; Vite ist keine
(Studio→Player-Importe gibt es längst, `abspielen.ts` importiert `../audiotracks.js`). Aber
die Kopie wird **gegen ein Verhaltens-Fixture** geprüft statt gegen Quelltext-Regex: eine
JSON-Datei mit Eingaben und erwarteten Filmsekunden, die beide Seiten durchrechnen.

Das Modul gehört nach `src/`, neben `geo.ts` und `audiotracks.ts` — nicht nach
`src/studio/`. Ein Import Player→Studio zöge die Editor-Typenwelt in den Player-Chunk und
drehte die bisher saubere Abhängigkeitsrichtung um.

### D. `f` über die Wegpunkte abbilden

Statt `f × route.total` eine echte Tabelle. Der Player baut seine Route aus **denselben
Wegpunkten**, die der Server geschickt hat — er kann also für jeden Wegpunkt beides
ausrechnen: die kumulierte Rohdistanz (= `f` des Servers) und sein `s` auf der gebauten
Route.

In `buildRoute` ist das billig: Wegpunkt `i` entspricht exakt `dense[i · SEGS]` (die
Catmull-Rom-Schleife setzt `j = 0` genau auf `p1 = waypoints[i]`). Es fehlt nur, den
Wegstand an dieser Stelle mitzuschreiben — rund fünf Zeilen und ein Feld `wegpunktS` in
`Route`.

Das räumt §2.3 weg und behebt denselben Fehler bei Kamera-Keyframes, Momenten und
Wetter-Ankern gleich mit.

### E. Die Fortschrittsleiste wird filmlinear

Folgt aus B — eine Leiste, die weiter in Metern denkt, während die Engine in Filmsekunden
läuft, wäre die schlimmste Variante von beidem.

Und sie ist unabhängig davon fällig: Bei jedem Foto-Halt steht `tour.s` still, also stehen
Balken, Playhead und Profilfüllung. Das Studio hat genau diesen Defekt am 2026-08-05
verlassen (gemessen: *„Playhead: Stillstand vor Halt-Sprung — 28 von 39 Frames"*,
*„Szenen-Anteil am Film: 52 %"*, [zeitleiste-umbau.md](../architecture/zeitleiste-umbau.md)).
Der Player hat ihn noch.

**Was NICHT filmlinear wird:** Pseudo-Uhrzeit, Sonnenstand, Wetter-Timeline, `next.km`,
`syncDots`. Die bleiben Streckengrößen. `createTimeAt` erwartet ausdrücklich den
Streckenanteil.

---

## 5. Umsetzungsplan

Fünf Etappen, jede einzeln releasebar. Kein Schema-Bruch in keiner davon — das
Austauschformat bleibt unverändert.

### Etappe 1 — Eine Uhr *(kein Schema-Bruch)*

1. `tick()` trennt zwei Größen: `dtKamera` (weiter bei 50 ms gedeckelt, für alle `Smooth`,
   `glide`, `skyLift`, `tuck`, `reposeTween`) und `dtFilm` (Echtzeit, gedeckelt erst bei
   ~0,25 s als Hänger-Schutz).
2. `s`-Integration und alle Zeitzähler (`holdT`, `momentT`) laufen auf `dtFilm`.
3. `visibilitychange`: beim Verstecken pausieren, beim Zurückkommen `lastT` neu setzen.
4. Test: Frame-Abstände simulieren (kein Browser), prüfen dass 10 s Echtzeit mit 200-ms-Frames
   10 s Filmzeit ergeben und nicht 2,5 s.

**Fertig, wenn:** Bei 6× CPU-Drosselung deckt sich `Δs ÷ Tempo` mit `Δ audio.currentTime`
auf ±2 % (heute: 81,3 %) — mit dem Messskript aus dieser Untersuchung.

### Etappe 2 — `f` über die Wegpunkte *(kein Schema-Bruch)*

1. `buildRoute` schreibt `wegpunktS: number[]` mit.
2. `main.ts` baut daraus die Tabelle Roh-`f` ↔ `s` und ersetzt alle `f * route.total`
   (Audio-Anker, Kamera-Keyframes, Momente, Wetter).
3. Test gegen die gemessenen Fixtures: der Median-Fehler aus §2.3 muss auf < 0,05 s fallen.

**Fertig, wenn:** Ein Musik-Bereich `f0 = 0,5` beginnt an demselben physischen Punkt, den
der Server gemeint hat — nachgewiesen an der Koh-Pha-ngan-Tour, wo der Fehler heute lokal
9 s beträgt.

### Etappe 3 — Die geteilte Achse *(kein Schema-Bruch)*

1. `src/filmachse.ts`: der domänenfreie Kern (~60 Zeilen), parametrisiert über die Strecke.
2. `src/studio/zeitleiste.ts` benutzt ihn statt der eigenen Kopie; die Studio-spezifischen
   Teile (Tupel-Punkte, `HaltIntervall`-Extras, Trim-Klemme, Momente) bleiben als Adapter.
3. Der Player rechnet seine Filmachse — **noch ohne sie anzutreiben**. Sie ist zunächst nur
   Anzeige-Größe.
4. Der Server behält seine Kopie, prüft sie aber gegen ein gemeinsames **Verhaltens-Fixture**
   statt gegen Quelltext-Regex.
5. Wächter abbauen: `filmtempo.test.ts` (Zeilen 28/32/41/47/55) und `filmachse.test.ts`
   (142–156) werden gegenstandslos, ebenso die Tempo-Vergleiche in
   `studio-baukasten.test.ts` (322/330/351).

**Fertig, wenn:** Das Tempo-Modell steht an genau zwei Stellen (`src/filmachse.ts`,
`server/src/pipeline/filmtempo.ts`) und kein Test liest mehr Quelltext per Regex.

### Etappe 4 — Der Antrieb dreht sich um *(kein Schema-Bruch)*

1. Anfahren und Ausrollen wandern als **explizite Form** in die Achse (je Halt ein
   Ein-/Ausschwing-Abschnitt statt einer emergenten Rampe).
2. `tour.ts`: `s = anteilBei(kurve, filmS) · total`; `speed` wird abgeleitet (für Marker,
   Motorsound, Bremsweg-Anzeige), nicht mehr integriert.
3. Der Bremsweg-Vorgriff (`speed · 0,62`) und die Ausrollschwelle (`speed < 4`) entfallen —
   die Halte stehen als Intervall in der Kurve.
4. `beginScrub`/`scrub`/`endScrub`/`seek`/`nudge`/`mult` auf Filmsekunden.
5. `syncNextIdx` mit seinem 160-m-Vorlauf wird ein Filmsekunden-Vorlauf.

**Fertig, wenn:** Die Gesamtdauer eines Durchlaufs deckt sich mit `spiel.gesamtS` im Studio
auf < 1 % (heute 9–13 %), gemessen an allen vier Fixtur-Touren.

### Etappe 5 — Die Leiste *(kein Schema-Bruch)*

1. `buildProfile` tastet filmäquidistant ab (Stützstellenzahl hoch — bei 140 Samples über
   5 min ist ein 5,2-s-Halt nur 2,4 Samples breit und fällt unter die Auflösung).
2. `buildDots`/`syncDots`: Halte bekommen **Breite** statt eines Punktes; `dataset.s` bleibt
   in Metern (der Übergabepunkt für `jumpToPhoto`, und Meter sind die eine Größe, die beide
   Koordinatensysteme kennen).
3. `Telemetrie` bekommt ein zweites Feld: `frac` (Strecke) **und** `filmFrac` (Film).
4. `fracAt` beim Scrubben liefert einen Filmanteil.

**Fertig, wenn:** Der Playhead läuft durch einen Foto-Halt sichtbar durch, und die
Sonnenstand-/Wetter-Regie zeigt unverändert dieselben Werte an denselben Streckenpunkten.

---

## 6. Fallen

1. **`frac` bedeutet ab Etappe 5 zwei Dinge.** Streckenanteil für Sonnenstand, Pseudo-Zeit,
   Wetter und `next.km`; Filmanteil für Balken, Playhead, Profil-x und Dot-x. Das
   Zeitleisten-Papier führt „zwei Film-Koordinatensysteme in einer Geste" als Falle Nr. 9 und
   nennt es *immer* einen Bug. Zwei getrennte Feldnamen, keine Doppelbedeutung.
2. **`sfxSollFeuern` prüft eine Kante mit Schwelle 0,02 in `frac`.** Über einem Halt-Plateau
   bewegt sich `frac` nicht, ein Sprung darüber hinweg schon. Die Regel muss auf Filmsekunden
   umgestellt werden, sonst feuern Effekte am Halt doppelt oder gar nicht — und sie ist
   **geteilt mit dem Studio** (`abspielen.ts` importiert sie), also ändern sich beide Seiten
   zugleich.
3. **Die dt-Trennung ist keine Kosmetik.** Wird `dtFilm` versehentlich auch in `Smooth.to`
   gereicht, ruckelt die Kamera bei jedem langen Frame sichtbar — der Deckel ist genau dort
   der richtige Schutz.
4. **Video-Halte enden nach Dateiende, nicht nach Filmzeit.** `onMediaEnded` bleibt der
   Auslöser; die Achse muss die *geschnittene* Länge ansetzen. Fehlt `durationS`
   (unverarbeiteter Altbestand), nimmt das Studio 5,2 s an — der Player muss dieselbe Annahme
   treffen, sonst zeigen beide verschiedene Filme.
5. **Die Achse hängt an Werten, die erst spät bekannt sind.** Videolängen kommen bei
   Altbestand erst mit `loadedmetadata`. Dann braucht es einen zweiten Aufbau, und der Balken
   springt einmal nach.
6. **Momente kosten im Studio Achsenbreite, in der Server-Achse nicht.** Das ist ein
   bestehender Fehler (`enrich.ts` füttert `baueAchsenHalte` nur mit Medien) und muss vor
   Etappe 3 behoben sein, sonst zementiert die geteilte Achse den Unterschied.
7. **`resumeAt` hat keinen Aufrufer.** Beim Umbau nicht „mitmigrieren", sondern löschen.

---

## 7. Was sich für den Nutzer ändert

**Die Tour fühlt sich anders an.** Anfahren und Ausrollen sind heute echtes Kameraverhalten.
In die Kurve gelegt bleiben sie erhalten — aber sie werden dann *gestaltet* statt zu
*entstehen*, und das ist eine Gelegenheit, sie zu ändern. Das sollte bewusst passieren, nicht
nebenbei.

**Jede bestehende Tour wird 9–13 % länger — auf dem Papier.** Wandert die Rampe in die
Achse, zeigt das Studio die *richtige* Dauer. Wer heute „4:53" gewohnt ist, sieht danach
„5:25". Der Film ist derselbe; die Zahl war vorher falsch.

**Auf langsamen Geräten springt das Bild, statt zu schleichen.** Heute läuft die Tour bei
25 fps in Zeitlupe weiter und bleibt in sich stimmig — nur der Ton nicht. Danach hält sie
die Zeit und lässt Frames aus. Das ist die Wahl, die jeder Videoplayer trifft, aber es ist
eine sichtbare Änderung.

---

## 8. Offene Entscheidungen

- **Bleibt der Zuschauer-`mult` (2×/4×)?** Als Faktor auf die Filmzeit ist er sauber. Er
  macht aber jede Aussage „der Film ist 5:25 lang" relativ.
- **Wie sieht die Rampe in der Kurve aus?** Die heutige Form ist exponentiell mit τ = 1,1 s
  bzw. 0,55 s. Eine ease-in-out-Form über eine feste Strecke wäre einfacher zu beschreiben
  und im Studio zeichenbar.
- **Bekommen Halte in der Leiste sichtbare Breite** (wie im Studio) oder bleiben es Punkte
  auf ihrem Beginn? Breite ist ehrlicher, kostet aber CSS und eine Trefferfläche.
- **Wird `stats.km` nach Etappe 2 noch gebraucht?** Die Wegpunkt-Tabelle macht die
  Skalierung gegenstandslos — das Feld bleibt für die Anzeige.

---

## 9. Warum das die wartbarste Form ist

Nicht wegen der Genauigkeit. Wegen der Zahl der Stellen, die dasselbe wissen müssen.

Heute: **drei** Kopien des Tempo-Modells, **zwei** Uhren, **zwei** Parametrisierungen
derselben Strecke — und die Klammer darum sind Tests, die Quelltext nach Zeichenketten
absuchen. Das Repo dokumentiert selbst, was diese Bauform kostet: Die Modus-Liste ist schon
einmal auseinandergelaufen, die Gehabschnitts-Erkennung auch.

Danach: **zwei** Kopien (Web + Server, durch `rootDir` erzwungen, gegen ein gemeinsames
Fixture geprüft), **eine** Uhr, **eine** Parametrisierung. Die Rampe, die man heute an zwei
weiteren Stellen nachbilden müsste, existiert als eigenes Ding nicht mehr.

Der kleine Fix aus §3b wäre in einem halben Tag erledigt und würde diese Bilanz in jeder
Zeile verschlechtern.
