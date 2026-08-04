# Zeitleisten-Umbau: Der Halt ist ein Objekt

Ergebnis der Mockup-Session vom **2026-08-04**. Ausgangspunkt war ein Fehlerbericht
(„nach Fotos snappt der Playhead hart ein, davor lässt sich nichts bearbeiten");
herausgekommen ist ein durchgespielter Entwurf für die nächste Ausbaustufe der
Studio-Zeitleiste. **Alles hier ist am Mockup verifiziert, nichts davon ist im
echten Editor umgesetzt.** Das Mockup ist
[docs/mockups/studio-halt-und-spuren.html](mockups/studio-halt-und-spuren.html)
(Ansicht „Vorschlag", Deeplink `#vorschlag`; „Heute" stellt das Ist-Verhalten
daneben) — es gehört mit ins Repo, die Begründungen unten verweisen auf seine
Kommentare.

Dieses Dokument ergänzt [editor-ausbau.md](editor-ausbau.md) (erzählerische
Werkzeuge, 2026-07-27): dort steht das *Was*, hier steht das *Wie* der Zeitleiste —
mit Messwerten, verworfenen Alternativen und einem Umsetzungsplan in vier Etappen.

---

## 1. Der Kernbefund: die Achse ist an Halten nicht umkehrbar

Die Filmzeit-Achse ([zeitleiste.ts `baueAchse`](../src/studio/zeitleiste.ts)) webt
jeden Foto-Halt als **Sprung** ein: zwei Stützstellen auf derselben Aufnahmesekunde,
`filmS` davor und danach. Ein Halt verbraucht Filmzeit, aber keine Aufnahmezeit —
deshalb gibt es in Aufnahmezeit **keinen Wert für „mitten im Halt"**.

Alles, was in dieser Session schiefging (und vorher im Editor schiefging), hat diese
eine Wurzel:

- **Der Playhead klebte:** Position als Aufnahmezeit gespeichert, beim Zeichnen
  zurückgerechnet → `interpoliere` (lower_bound) fällt auf die **linke** Haltkante.
  Gemessen: 28 von 39 Frames Stillstand, dann Sprung um die volle Standzeit. Mit
  Pfeiltasten (5 s je Druck) kommt man an einem 6,0-s-Halt **nie** vorbei.
- **Ton-Klips sprangen an Haltkanten:** Anker in Aufnahmezeit können „endet mitten
  in der Standzeit" nicht ausdrücken.
- **Zustands-Grenzen erstarrten über Halten:** beim Ziehen über einen breiten Halt
  bewegte sich die Kante 135 px lang nicht — es gibt dort keine Zwischenposition.

**Die Regel daraus, für alle Etappen:** Während einer Geste ist die **Leisten-
position (Filmsekunde bei festem Maßstab) die führende Größe**; in Aufnahmezeit wird
erst beim Loslassen übersetzt, und die Anzeige läuft während des Zugs **nicht durch
das Datenmodell**. Gespeichert wird weiterhin Aufnahmezeit (stabile Anker, wie
überall im Overlay) — aber die Interaktion rechnet in Film.

---

## 2. Die Entscheidungen

### A. Szenen-Bahn: jede Aufnahme ist ein Klip

- **Halt = Kette aneinanderliegender Klips**, kein Cluster, kein Stapel, keine
  Zahl-Plakette. Der „Cluster" war nie ein eigenes Ding, sondern die Folge
  zusammenfallender Anker — als Stapel dargestellt, weil *Punkte* an derselben
  Stelle übereinanderlägen. Klips mit Breite haben das Problem nicht: Breite =
  Standzeit + Ausblendung (`HALT_ENGINE_S`/`HALT_AUSBLEND_S`).
- **Standzeit am rechten Griff** des Klips (Foto: `display.holdS`), live während
  des Zugs, Dauer-Blase am Griff. **Videos haben diesen Griff nicht** — ihre
  Standzeit ist eine Tatsache der Datei (der Player läuft bis zum Ende, `holdS`
  ist wirkungslos, [tour.js](../src/tour.js)).
- **Videos zählen mit ihrer echten Länge.** Heute rechnet die Achse jedes Video
  wie ein Foto mit 5,2 s: ein 34-s-Video bekommt ~34 px statt ~200 px. `durationS`
  steht bereits im Tour-JSON — **es fehlt nur in der Editor-Route**
  ([tours.ts `/editor`](../server/src/routes/tours.ts): liefert für Videos nur
  `poster`).
- **Momente sind Halte** und gehören mit Achsenbreite in dieselbe Bahn (Muster in
  Koralle statt Bild). Heute haben sie null Breite — an der Beispieltour waren
  13,6 s Film unsichtbar (190,3 s real vs. 176,7 s Achse). Deckt sich mit
  [editor-ausbau.md](editor-ausbau.md) §1: ein Moment ist grammatikalisch ein Halt.
- **Beiläufige Bilder** (laufen nebenher, docs/editor-ausbau.md) bleiben in
  derselben Spur: schmaler, gestrichelt, tiefer — den Unterschied sagt die Breite
  (keine Standzeit), nicht ein Spurwechsel, den man erst lernen müsste.
- **Thumbnails: Kopf- und Fußminiatur, kein Filmstreifen.** `repeat-x` über die
  Klipbreite wiederholte beim Aufziehen dasselbe Foto — ein Foto hat aber nur ein
  Einzelbild; es zu kacheln behauptet einen Verlauf, den es nicht gibt. Jetzt
  Premieres Konvention: Miniatur am Anfang, Name in der Mitte, ab genug Breite
  eine zweite Miniatur am Ende. Drei Ausbaustufen (nur Bild < 150 px < Bild+Name
  < 232 px < Bild+Name+Bild) als **Container-Queries**, nicht als JS-Klassen —
  `kuerzeBeschriftungen` läuft während eines Zugs bewusst nicht (erzwungenes
  Layout), die Stufen müssen aber im Zug schalten.
- **Klip-Zug: eine Geste, zwei Bedeutungen.** Innerhalb der eigenen Kette =
  Reihenfolge (Einfügelinie, risikofrei); darüber hinaus = Ort auf der Route.
  Über einem *fremden* Halt dockt der Klip an (über dessen volle Breite — dort
  gibt es keine Zwischenposition, s. §1); das Zug-Etikett am Zeiger sagt
  jederzeit, was gerade passiert („Reihenfolge · Platz 2 von 3" vs.
  „Ort · km 12,3 · 16:04 Uhr" vs. „An den Halt ‚X' anschließen").
- **Reconcile statt Neubau:** Klips werden fortgeschrieben (im echten Editor
  geschlüsselt an `medium.id`, nicht am Titel!), Kartenpunkte nach
  Halt-Zusammensetzung. Neubau pro Zieh-Frame kostete 2,34 ms und — schlimmer —
  das gezogene Element samt dekodierter `<img>`; mit Fortschreiben 0,4 ms.
- **Halt-Zone** (gestrichelte Führung durch alle Bahnen) nur für den
  **ausgewählten** Halt — über alle gelegt waren es zwölf Linien Dauerunruhe.

### B. Playhead: läuft durch, bleibt orange

- **Führende Größe ist die Filmsekunde** (`kopfFilmS`), nicht die Aufnahmezeit.
  Damit läuft der Kopf durch Halte hindurch, Pfeiltasten (5 Filmsekunden)
  funktionieren überall, und die Statuszeile kann sagen, *wo im Halt* er steht:
  „Halt · Dschungelbach · 2,1 s von 8,0 s — die Uhr steht bei 18:42". Beim
  Abspielen existiert das Muster schon (`renderPlayhead(anteilDirekt)`,
  [CLAUDE.md](../CLAUDE.md)) — es muss die *eine* Wahrheit für Scrubben, Klick
  und Tasten werden.
- **Der Kopf bleibt immer orange.** Er wechselte im Halt auf Lila — Farbe
  bezeichnet hier aber Identität, nicht Zustand; ein Ortsanzeiger, der auf halber
  Strecke die Farbe wechselt, liest sich als zweiter Kopf. Der Zustand steht als
  Wort in der Statuszeile; deren kleine **Marke** darf lila sein (ein Etikett ist
  genau der Ort für einen Zustand).

### C. Fester Maßstab: der Schlüssel zur Fortbewegung

**Das Problem.** Die Fortbewegung bestimmt die Filmdauer (`MODE_SPEED` in
[tour.js](../src/tour.js), gespiegelt in `tempoMs`): dieselbe Strecke ist zu Fuß
ein Vielfaches der Fährfahrt. Eine gezogene Modus-Grenze ändert also die Achse, auf
der sie selbst liegt. Solange die Leiste den **ganzen Film auf die Fensterbreite**
passt (heutiges Zoom-Modell: Faktor auf Basisbreite, [editor.ts](../src/studio/editor.ts)
`zoom = 1` = eingepasst), skaliert jede Längenänderung **alles** — auch das, was vor
der Kante liegt und mit ihr nichts zu tun hat. Gemessen: Die Kante konnte beim
Loslassen entweder ihre Pixelstelle behalten (dann stand eine andere Filmsekunde
darunter: 0:36 statt 0:30) oder ihre Filmsekunde (dann sprang sie 16 px von der
Maus weg). **Beides falsch, und beides unvermeidbar in diesem Modell.**

**Die Lösung: px je Filmsekunde als feste Größe.**

- Beim Öffnen wird einmal **eingepasst** (fit); der Maßstab steht danach fest.
- Zoomen ändert den Maßstab (Knöpfe − ⤢ +, ⌘+/⌘−, ⇧Z = einpassen — die
  FCPX-Kürzel aus [mockups/studio-editor-mockups](../docs/mockups); Zoomen um die
  Mitte des sichtbaren Ausschnitts; Untergrenze ist „alles im Blick", darunter
  entstünde nur Leerrand).
- **Beim Ziehen einer Fortbewegungs-Grenze wird der Maßstab eingefroren** (fit
  geht aus). Dann bleibt links der Kante alles pixelgenau stehen, die Kante liegt
  bei 0:30 **und** unter der Maus, und nur was dahinter liegt, rückt — genau die
  Aussage, die stimmt. Der Nutzer-Testfall („Moped bis 0:30 ziehen") landete
  vorher bei 0:36 bzw. mit 116-px-Sprung; mit festem Maßstab: **gelandet 0:30,
  Sprung 0 px, links pixelidentisch.**
- Das Maßband wählt seine Stufe **nach Maßstab**, nicht nach Filmdauer
  (`waehleFilmStufe(pxProS)` existiert bereits): feinste Stufe mit ≥ 90 px
  Abstand — eingepasst 0:15er-Schritte, voll gezoomt 0:02er.
- Waagerechter Scroll entsteht damit nur als Folge einer Nutzerhandlung
  (hineinzoomen oder Film verlängern), **nie beim Öffnen**.

### D. Zustandsbahnen: drei gleichrangig, ziehbar, ehrlich

- **Fortbewegung · Kamera · Wetter als drei gleichrangige, schmale Bahnen**
  (19 px), lückenlose Bänder mit Text direkt darauf. Verworfen (mit
  Nutzer-Feedback): Gruppierung „Im Film / Auf der Strecke", „Reise"-Klappspur,
  Kamera/Wetter als Unterspuren, Wechsel-Marken statt Bändern,
  blass/kräftig-Unterscheidung Automatik vs. Entscheidung („man sollte direkt
  sehen, was ist" — zumal `materialisiereModi` die Unterscheidung beim ersten
  Eingriff ohnehin auflöst).
- **Der Griff ist EIN Riegel auf der Fuge** (3 px, dunkler Ring, hover/Zug
  orange), Bandtext mit 11 px Abstand. Zwei Fallen, die die Griffe vorher
  unsichtbar/kaputt machten, stehen in §5.
- **Während des Zugs folgt die Kante dem Zeiger als reine Anzeigegröße** —
  Band, Griff und Beschriftung wandern lückenlos mit (max. 1 px Abweichung
  gemessen), das Datenmodell bleibt unberührt. Die **Ziellinie** zeigt, wo es
  beim Loslassen landet: Strich nur beim Einrasten (sonst läge er deckungsgleich
  auf der Kante), Etikett immer („0:30 · 15:33 Uhr", beim Rasten „rastet
  hinter den Halt"), bei der Fortbewegung zusätzlich die Folge:
  „· Film 3:00 → 3:29". Der betroffene Halt leuchtet mit.
- **Einrasten an Haltkanten: ±0,5 s Aufnahmezeit**, nicht Filmsekunden-Epsilon.
  „Dahinter" braucht einen Zeitstempel *strikt* nach der Haltzeit; 0,01
  Filmsekunden schmolzen auf dem Rückweg durch die Achse auf ein halbes
  Tausendstel und verloren gegen die lower_bound-Konvention — die Kante landete
  bis 71 px neben der Ziellinie. Eine halbe Sekunde Aufnahmezeit ist eindeutig
  und auf der Leiste unsichtbar schmal.
- **Grenzen klemmen in Pixeln (14 px), nicht in Sekunden** — mit ±1 s konnten
  zwei Grenzen so nah zusammenrücken, dass das Band dazwischen unsichtbar und
  unanfassbar wurde. Dieselbe Sorge wie `klemmeGrenze` (mindestens ein
  Trackpunkt bleibt im Abschnitt).
- **Fortbewegung: Aufnahmezeit ↔ Filmsekunde ist eine Fixpunktsuche.** Die
  Grenze beeinflusst die Abbildung, auf der sie liegt; mit der Achse des letzten
  Frames gerechnet sprang die Kante beim Loslassen 116 px. Gesucht ist die Zeit
  t, deren Filmposition in der Achse, *die t erzeugt*, die gewünschte ist. Die
  Abbildung ist monoton → **Bisektion**, 14 Schritte ≈ 0,2 s Genauigkeit,
  Ø 1,4 ms / max 4,6 ms pro Zieh-Frame am Mockup-Track. (Analytisch ginge es
  exakt — die Achse ist stückweise linear und nur das Segment der Grenze ändert
  sich — aber die Bisektion ist robust und einfach; erst optimieren, wenn die
  Messung an einem dichten echten Track es verlangt.)
- **Diskutiert und entschieden:** eine Aufnahmezeit-Achse („an den Track
  koppeln") hätte die Bänder trivial gemacht, aber die Szenen zerstört — 93 der
  180 Filmsekunden der Beispieltour sind Standzeit (52 % des Films → 0 px,
  acht Striche), die 5-Minuten-Pause bekäme 10 % der Leiste für 0,5
  Filmsekunden. Damit wäre exakt das Ausgangsproblem zurück. Filmzeit-Achse
  bleibt; der Konflikt lag im Breitenmodell, nicht in der Achse (s. §C).

### E. Ton: verankert an der Reise, getrimmt am Material

- **Ein Ton-Klip hängt an der Strecke, nicht an einer festen Filmsekunde**
  (FCPX „connected clip"). Er merkt sich: **Anker in Aufnahmezeit** (wo auf der
  Reise), **Versatz in Filmsekunden** (wo genau — auch mitten in einer
  Standzeit, was reine Aufnahmezeit nicht ausdrücken kann, s. §1) und **Länge in
  Filmsekunden** (Musik läuft in Echtzeit, sie dehnt sich nicht mit der Kamera).
  Damit rückt Ton mit, wenn Standzeiten oder Fortbewegung sich ändern — vorher
  war er das einzige Element, das liegen blieb. Gemessen: Standzeit des ersten
  Fotos +10 s → alle späteren Klips exakt +10 s, Anker unverändert, Längen
  unverändert; Fortbewegungs-Grenze gezogen → jeder Klip rückt um *seinen*
  Anteil (13 s im gedehnten Bereich, 31 s dahinter, 0 s davor).
- **Trimmen wie FCPX:** linke Kante = Anfang UND Datei-Einstieg wandern
  gemeinsam (der Inhalt bleibt an seinem Platz im Film, vorne fällt etwas weg);
  rechte Kante = nur das Ende. **Anschlag ist an beiden Kanten das Material** —
  Trimmen legt frei, was da ist, und erfindet nichts; Stille entsteht durch eine
  Lücke *zwischen* Klips, nie in einem. Am Anschlag sagt das Etikett
  „kein Material mehr" (eine Kante, die kommentarlos stehen bleibt, liest sich
  als hakender Griff). 3-px-Totzone, damit ein Auswahl-Klick nicht schneidet.
- **Loop hebt nur den RECHTEN Anschlag auf.** `el.loop` springt am Dateiende
  auf den Anfang zurück — es gibt keine Wiederholung *vor* dem Anfang. (Der
  erste Wurf erlaubte links Beliebiges und ließ den Versatz modulo in die Datei
  wandern: das Stück setzte mitten drin ein, obwohl man „mehr vom Anfang"
  gezogen hatte. Vom Nutzer gefunden.) Loop ist eine **Einstellung im
  Inspector** (auf dem Klip nur das ⟲-Zeichen) — auf dem Klip wäre sie eine
  Ausnahme, die Lautstärke/Blende/Dateiwechsel nicht auch bekommen könnten.
- **Effekte sind dieselbe Sorte Klip wie Musik** (andere Farbe). Als Marke ohne
  Länge verschwieg die Leiste, wie lange sie klingen — sie haben eine Länge, die
  ihrer Datei; Loop ist wählbar (Brandung ja, Zikaden nein).
- **Wellenform gehört zur Datei, nicht zum Klip:** Hintergrund in Dateibreite
  (`dateiS · pxProS`), um den Einstieg verschoben, Wiederholung nur bei Loop —
  beim Trimmen wandert der *Ausschnitt*, man sieht, was man wegschneidet.
  Gestaucht sähe jeder Trim wie ein Tempowechsel aus.
- **Überlappende Klips mischen sich** (wie der Player es tut) und stapeln in
  Lanes (greedy, `musikLanes` existiert).

### F. Video: trimmen wie Ton, rücken wie eine Kette

- **Beide Kanten trimmen**, gleiche Griffe, gleiche Gesten wie Ton. Anschlag ist
  die Datei (`dateiS`); Loop gibt es nicht (wäre bei einem Video Unsinn). Der
  alte Satz „ein Video trägt seine Länge, kein Griff — sie steht nicht zur Wahl"
  stimmt für die *Standzeit*, nicht für den *Schnitt*.
- **Ripple:** ein Video liegt in einer Halt-Kette, die keine Lücken kennt —
  vorne wegschneiden rückt alles Folgende vor, es bleibt keine Lücke.
- Beschriftung getrimmt: „0:22 von 0:34" (der Anteil sagt mehr als die nackte
  Zahl); ungetrimmt schlicht „0:34 Video".

---

## 3. Datenmodell: additiv, keine Migration

Schema-ID bleibt `maptale/edits@1`; neue Felder sind optional, alte bleiben
gültig. Aufwertung nach dem bewährten Muster „erster Eingriff schreibt fest"
(`materialisiereModi`, `schreibeWetterFest`): das Studio schreibt beim ersten
Speichern die neuen Felder, der Render bevorzugt sie, `ab`/`bis` bleiben als
Fallback lesbar. **Nie destruktiv.**

```ts
// AudioEdit (server/src/schema/edits.ts) — Ergänzungen:
interface AudioEdit {
  // … bestehend: datei, typ, ab, bis?, lautstaerke?, quelle?
  /** NEU: Anker in Aufnahmezeit (ISO) — die Stelle der Reise. Vorrang vor `ab`. */
  anker?: string
  /** NEU: Feinlage relativ zum Anker in FILMsekunden (darf in einer Standzeit liegen). */
  versatzFilmS?: number
  /** NEU: Länge im Film in Sekunden. Vorrang vor `bis`. */
  dauerFilmS?: number
  /** NEU: Einstieg in die Datei in Sekunden (linker Trim). Default 0. */
  einstiegS?: number
  /** NEU: Wiederholung über das Dateiende hinaus. Default: musik=true, sfx=false
   *  (exakt das heutige Player-Verhalten — kein Verhaltensbruch für Bestand). */
  loop?: boolean
}

// MedienEdit — Ergänzung:
interface MedienEdit {
  // … bestehend
  /** NEU: Video-Schnitt in DATEI-Sekunden. Nur für type=video. */
  trim?: { vonS: number; bisS?: number }
}
```

Folgen außerhalb des Schemas:

- **Editor-Route** ([tours.ts `/editor`](../server/src/routes/tours.ts)): je Video
  `dauerS` mitliefern — Quelle ist das gerenderte `tour.json` (`durationS` steht
  dort schon) bzw. der Anreicherungs-Cache; fehlt beides (unverarbeiteter
  Altbestand), lässt der Editor die 5,2-s-Annahme stehen und zeigt es an
  („Länge nach ‚Neu verarbeiten' bekannt").
- **Pipeline** ([video.ts](../server/src/pipeline/video.ts)): bei gesetztem
  `trim` **immer Transcode** — der Remux-Pfad (`-c copy`) schneidet nur an
  Keyframes und träfe den Schnittpunkt um Sekunden. `durationS` im Tour-JSON ist
  danach die getrimmte Länge.
- **Enrich** ([enrich.ts](../server/src/pipeline/enrich.ts)): Audio-Anker
  `anker + versatzFilmS + dauerFilmS` beim Rendern über die Film-Achse in die
  `f0/f1`-Anteile des Tour-JSON übersetzen (die Achse steht der Pipeline über
  [filmtempo.ts](../server/src/pipeline/filmtempo.ts) zur Verfügung).
- **Player** ([audiotracks.js](../src/audiotracks.js),
  [abspielen.ts](../src/studio/abspielen.ts)): `loop` aus dem Overlay statt
  pauschal `el.loop = true` für Musik; SFX mit `loop: true` brauchen ein
  Bereichsende (heute one-shot). `einstiegS` = Start-Seek (das Eintritts-Seek-
  Muster existiert in abspielen.ts bereits).

---

## 4. Umsetzungsplan

Vier Etappen, jede einzeln releasebar. Reihenfolge nach Nutzen ÷ Risiko; die
Schema-Änderung kommt bewusst zuletzt.

### Etappe 1 — Playhead, Halt-Intervalle, Videolänge, Maßstab *(kein Schema-Bruch)*

Das Ausgangsproblem, plus das Fundament für alles Weitere.

1. `baueAchse` gibt die Halte als **Intervalle** zurück (`{offsetS, breiteS,
   filmVon, filmBis, indizes}` statt nur `{offsetS, breiteS}`) — die Auskunft
   „steht der Kopf in einem Halt, und wo darin?" gibt es heute nicht.
2. **Playhead führend in Filmsekunden** (Scrubben, Klick, Pfeiltasten,
   Abspielen aus einer Quelle); Statuszeile „Halt · ‹Titel› · x s von y s — die
   Uhr steht bei ‹Zeit›" bzw. „Pause · gerafft". Lila-Wechsel des Kopfes
   entfernen (Statuszeilen-Marke behält die Farbe).
3. **Videolänge**: Editor-Route liefert `dauerS`; Achse und Szenen-Breite nutzen
   sie. **Momente** bekommen Achsenbreite (als Halte).
4. **Zoom-Modell auf px/Filmsekunde umstellen** — das bestehende Faktor-Modell
   (`zoom`, `wendeZoomAn`, `ankerScroll`) bleibt als Bedienung, aber die
   gespeicherte Größe wird der Maßstab; fit = Startzustand. Beim Zug einer
   Fortbewegungs-Grenze (Etappe 3) wird er eingefroren; hier reicht: Maßstab
   ändert sich nur durch Zoomen/Einpassen, nie durch Datenänderung.
   `waehleFilmStufe(pxProS)` ist schon maßstabsfähig.
5. Tests in [test/](../test/): Halt-Intervalle, Kopf-in-Halt-Auskunft,
   Pfeiltasten über einen Halt, Achse mit Videolänge, Stufenwahl.

**Fertig, wenn:** der Kopf an einer Tour mit 6-s-Halt per Pfeiltaste und Scrub
durch den Halt läuft und die Statuszeile die Position im Halt nennt.

### Etappe 2 — Szenen-Bahn *(kein Schema-Bruch)*

1. Foto-Dots + Cluster-Streifen → **Klip-Kette** je Halt (§2A): Reconcile an
   `medium.id`, Kopf/Fuß-Miniatur (`thumb` mit `src`-Fallback!),
   Container-Query-Stufen, Momente/Videos/beiläufige in derselben Bahn.
2. Standzeit-Griff (schreibt `display.holdS` — Feld existiert), Dauer-Blase,
   ein Zug = ein Undo-Schritt (`renderNachZug`-Muster).
3. Klip-Zug Reihenfolge/Ort mit Zug-Etikett und Halt-Andocken; Halt-Zone für
   die Auswahl.
4. Tests: Ketten-Layout aus Halten, Reihenfolge-Zug, Andock-Schwellen.

**Fertig, wenn:** die Foto-Bahn ohne Cluster auskommt und ein Halt mit drei
Aufnahmen als drei anfassbare Klips liegt.

### Etappe 3 — Zustandsbahnen *(kein Schema-Bruch)*

1. Drei schmale Bahnen (19 px), Bänder mit Text, Riegel-Griffe (§2D; CSS-Fallen
   in §5 beachten).
2. Zug-Entkopplung: Kante am Zeiger (Anzeigegröße), Modell erst beim Loslassen;
   Ziellinie + Etikett; Einrasten ±0,5 s; Klemmen in Pixeln. `materialisiereModi`
   und `schreibeWetterFest` bleiben unverändert die Schreib-Muster.
3. Fortbewegung: Maßstab beim Zug einfrieren, Filmdauer-Vorschau im Etikett,
   Bisektion für die Loslass-Zeit. **Vorher an der Frankfurt-Tour messen**
   (dichtester realer Track) — Budget: < 8 ms pro Zieh-Frame; sonst analytische
   Lösung (stückweise linear) statt Bisektion.
4. Tests: Fixpunkt (Loslass-Stelle = Zieh-Stelle), Rast-Seite (vor/hinter),
   Klemm-Mindestbreite, „ein Zug = ein Undo-Schritt".

**Fertig, wenn:** „Moped-Kante auf 0:30 ziehen" bei 0:30 landet, ohne Sprung,
und links davon nichts wandert.

### Etappe 4 — Ton & Video-Trim *(Schema-Ergänzung, §3)*

1. Schema-Felder + Validierung (`pruefeEdits`), Render-Vorrangregeln,
   Vertragstests: Alt-Overlay ohne neue Felder rendert unverändert.
2. Editor: Ton-Klips mit zwei Trimm-Kanten, Anker-Nachführung nach jeder Geste,
   Lanes, Wellenform, Loop im Inspector; Video-Kanten mit Ripple.
3. Player + Studio-Abspielen: `loop` aus Overlay, SFX-Loop mit Ende,
   `einstiegS`-Seek.
4. Pipeline: Video-Trim (Transcode-Zwang), `durationS` getrimmt; Drift-Wächter,
   dass Editor-Annahmen (`HALT_ENGINE_S` etc.) und Pipeline synchron bleiben,
   existiert (filmtempo).
5. Tests: Trim-Anschläge (auch Loop-links-Verbot), Magnetik (Standzeit ±10 s →
   Ton rückt exakt), Alt-Daten-Aufwertung idempotent.

**Fertig, wenn:** ein geloopter Musik-Klip links am Dateianfang stoppt, rechts
beliebig wächst, bei Standzeit-Änderung mitrückt — und ein getrimmtes Video im
gerenderten Film an der richtigen Stelle schneidet.

---

## 5. Fallen, die diese Session gekostet haben

Für die Umsetzung — jede davon hat im Mockup mindestens eine Runde gekostet:

1. **`border` + `overflow: hidden` frisst das Randpixel.** Ein echter Rand liegt
   außerhalb der Polsterbox; das äußerste Pixel gehörte dem Klip-Körper statt dem
   Trimm-Griff — statt zu trimmen verschob man. Rahmen als `inset box-shadow`,
   Griffe bündig `left/right: 0` (bzw. −1 px, wo `overflow: visible` gilt).
2. **Ein absolut positioniertes Kind ohne `left` sitzt an seiner statischen
   Stelle** — hinter der Polsterung, also auf dem ersten Buchstaben des
   Bandtexts. Der Band-Griff saß deshalb „auf dem Text", egal wie er aussah.
   Mehr Polsterung half nicht (schob beides). `left: 0` ist die Korrektur.
3. **ResizeObserver-Callback, der Layout ändert, braucht einen
   Letzter-Wert-Vergleich** — sonst bricht Chrome die Schleife ab („undelivered
   notifications") und die Leiste bleibt auf der allerersten Messung stehen.
   Der Observer ist trotzdem nötig: die vertikale Scrollleiste erscheint erst
   nach dem Foto-Laden und nimmt der Leiste ~15 px, die eine `resize`-einmalige
   Messung nicht kennt (→ Phantom-Scrollbalken).
4. **Kurze Klips: Griffe mit `width: min(11px, 33%)`** — feste Breiten
   überlappten sich, der Körper gewann, aus Trimmen wurde Verschieben.
5. **Nicht umkehrbare Abbildungen nie im Zug rückübersetzen** (§1) — Anzeige in
   Leisten-/Filmkoordinaten führen, Modell erst beim Loslassen.
6. **Epsilon-Zeitstempel überleben die Achsen-Rundreise nicht** (lower_bound):
   Rast-Seite über ±0,5 s *Aufnahmezeit* ausdrücken, nicht über Filmsekunden.
7. **Container-Queries statt gemessener JS-Klassen** für alles, was während
   eines Zugs umschalten muss (Messfunktionen laufen im Zug bewusst nicht).
   Achtung Kaskade: der `display:none`-Basisblock muss *nach* der allgemeinen
   Regel stehen, sonst hebt sie ihn bei gleicher Spezifität auf.
8. **Touch:** 11–13-px-Griffe sind Maus-Maße. Im echten Editor bei
   `(pointer: coarse)` Trefferzonen ≥ 24 px vorsehen (Optik darf schmal bleiben).

---

## 6. Messwerte (Mockup, Koh-Pha-ngan-Beispieltour: 52 min Aufnahme → 3:00 Film)

| Befund | Wert |
|---|---|
| Playhead „Heute": Stillstand vor Halt-Sprung | 28 von 39 Frames, dann Sprung um volle Standzeit |
| Pfeiltaste (5 s) an 6,0-s-Halt | kommt nie vorbei |
| 34-s-Video mit 5,2-s-Annahme | ~34 px statt ~200 px Achsenbreite |
| Momente ohne Achsenbreite | 13,6 s Film unsichtbar (190,3 vs. 176,7 s) |
| Zieh-Frame Neubau → Reconcile | 2,34 ms → 0,4 ms |
| Szenen-Anteil am Film (Standzeiten) | 52 % — Argument gegen Aufnahmezeit-Achse |
| Fortbewegungs-Zug, Achse des Vorframes | 116-px-Sprung beim Loslassen |
| dito, mit festem Maßstab + Fixpunkt | 0-px-Sprung, Ziel exakt getroffen |
| Bisektion (14 Schritte) | Ø 1,4 ms, max 4,6 ms je Zieh-Frame |
| Rastung mit 0,01-Filmsekunden-Epsilon | bis 71 px neben der Ziellinie (lower_bound) |
| Ton-Magnetik: Standzeit +10 s | alle späteren Klips exakt +10 s |

---

## 7. Offen (bewusst nicht entschieden)

- **Rastet die Fortbewegungs-Grenze an Halten?** Konzeptbedingt wandert der Halt
  beim Einrasten mit (Filmdauer ändert sich; im Mockup bis 42 px neben der
  Vorschau — korrekt, aber sichtbar). Alternative: für die Fortbewegung gar
  nicht einrasten. Am echten Editor mit echten Touren entscheiden.
- **Dauerhafte Kennzeichnung der Halt-Zonen in den Zustandsbahnen** — fünf
  Varianten diskutiert, Empfehlung „nur beim Ziehen sichtbar" (ggf. + feine
  Trennstriche). Offen gelassen.
- **Titel-Spur** und die weiteren Bausteine aus
  [editor-ausbau.md](editor-ausbau.md) — die Szenen-Bahn ist dafür der Platz,
  aber nichts davon ist hier verplant.
