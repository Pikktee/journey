# Zeitleisten-Umbau: Der Halt ist ein Objekt

Ergebnis der Mockup-Session vom **2026-08-04**. Ausgangspunkt war ein Fehlerbericht
(„nach Fotos snappt der Playhead hart ein, davor lässt sich nichts bearbeiten");
herausgekommen ist der Entwurf für die Studio-Zeitleiste. **Alle vier Etappen sind
seit 2026-08-05 im echten Editor umgesetzt** (§4). Das historische Mockup liegt unter
[docs/archive/mockups/studio-halt-und-spuren.html](../archive/mockups/studio-halt-und-spuren.html)
(Ansicht „Vorschlag", Deeplink `#vorschlag`). Was die Umsetzung am ECHTEN Editor
anders ergeben hat, steht je Etappe unter „Abweichungen von der Planung" (§4) und
in der zweiten Messtabelle (§6).

Dieses Dokument ergänzt [editor-ausbau.md](../concepts/editor-ausbau.md)
(erzählerische Werkzeuge, teils noch offen): dort steht das *Was*, hier das *Wie*
der Zeitleiste — mit Messwerten und verworfenen Alternativen.

---

## 1. Der Kernbefund: die Achse ist an Halten nicht umkehrbar

Die Filmzeit-Achse ([zeitleiste.ts `baueAchse`](../../src/studio/zeitleiste.ts)) webt
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

### 0. So sieht die Leiste danach aus

Dieser Abschnitt fehlte in der ersten Fassung — und genau das hat gekostet: Die
Umsetzung folgte der Mechanik unten Punkt für Punkt und baute sie in die alte
Hülle. Name, Reihenfolge und Wegfall einer Spur standen nirgends, also blieben
sie, wie sie waren (Nachtrag 2026-08-05, s. §4 „Nachtrag zu Etappe 2").

**Die Bahnen von oben nach unten:**

| # | Bahn | Höhe | Inhalt |
|---|---|---|---|
| 1 | **Szenen** | hoch (~80 px) | Fotos · Videos · **Momente** · beiläufige Bilder |
| 2 | **Musik & Effekte** | wächst mit den Lanes | Ton-Klips, überlappende gestapelt |
| 3 | **Fortbewegung** | 19 px | Zustandsbänder |
| 4 | **Kamera** | 19 px | Zustandsbänder |
| 5 | **Wetter** | 19 px | Zustandsbänder |

**Die Spur „Momente" entfällt.** Ein Moment hält den Film an wie ein Foto — er
hat nur kein Bild (Muster in Koralle statt Miniatur). Er gehört damit in die
Szenen-Bahn und nirgendwo sonst; eine eigene Spur für „Halt ohne Medium" wäre
eine Unterscheidung nach Herkunft statt nach Wirkung.

**Die Bahn heißt „Szenen", nicht „Fotos/Videos".** Das ist keine Kosmetik,
sondern die Voraussetzung für den Punkt davor: Solange die Bahn ihre
Dateitypen aufzählt, kann ein Moment dort nicht hinein, ohne dass die
Beschriftung lügt. „Szenen" benennt, was die Dinge im Film SIND. („Halte" war
der erste Vorschlag und wurde verworfen — zu technisch für das, was man dort
sieht.)

**Warum Ton oben und der Kontext unten** — und nicht die Ordnung „nach
Wirkung" aus [editor-ausbau.md](editor-ausbau.md) §1, die „klingt" zuletzt
führt: Jene Tabelle ordnet die begriffliche FAMILIE und stammt aus einer
Zeitleiste, in der alle Bahnen gleich hoch waren. Seit die drei
Zustandsbahnen 19-px-Zeilen sind — mit der Begründung „Material verdient
Fläche, Kontext verdient eine Zeile" (§2D) —, gehören sie an den Rand. Dazu
kommen zwei Dinge, die zusammenfallen:

- **Bild oben, Ton darunter** ist die stärkste Konvention in Schnittprogrammen
  (Premiere, Final Cut, Resolve, Avid). Wer je geschnitten hat, sucht den Ton
  unter dem Bild, nicht unter den Metadaten.
- **Die Sorten trennen sich sauber:** Szenen und Ton sind *Material* — Klips
  mit Anfang, Ende, Trimm-Kanten, Material-Anschlag. Die drei unteren sind
  *Zustände* — lückenlose Bänder, deren Kante ein Griff ist. Zwei Sorten, zwei
  Blöcke, unten ein ruhiger Sockel.

Praktisch zählt außerdem: Musik auf einen Schnitt auszurichten ist die
häufigste Feinarbeit. Liegen drei Bahnen dazwischen, springt der Blick jedes
Mal darüber.

### A. Szenen-Bahn: jede Aufnahme ist ein Klip

- **Halt = Kette aneinanderliegender Klips**, kein Cluster, kein Stapel, keine
  Zahl-Plakette. Der „Cluster" war nie ein eigenes Ding, sondern die Folge
  zusammenfallender Anker — als Stapel dargestellt, weil *Punkte* an derselben
  Stelle übereinanderlägen. Klips mit Breite haben das Problem nicht: Breite =
  Standzeit + Ausblendung (`HALT_ENGINE_S`/`HALT_AUSBLEND_S`).
- **Standzeit am rechten Griff** des Klips (Foto: `display.holdS`), live während
  des Zugs, Dauer-Blase am Griff. **Videos haben diesen Griff nicht** — ihre
  Standzeit ist eine Tatsache der Datei (der Player läuft bis zum Ende, `holdS`
  ist wirkungslos, [tour.js](../../src/tour.js)).
- **Videos zählen mit ihrer echten Länge.** Heute rechnet die Achse jedes Video
  wie ein Foto mit 5,2 s: ein 34-s-Video bekommt ~34 px statt ~200 px. `durationS`
  steht bereits im Tour-JSON — **es fehlt nur in der Editor-Route**
  ([tours.ts `/editor`](../../server/src/routes/tours.ts): liefert für Videos nur
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
  Damit läuft der Kopf durch Halte hindurch und Pfeiltasten (5 Filmsekunden)
  funktionieren überall. Beim Abspielen existiert das Muster schon
  (`renderPlayhead(anteilDirekt)`, [CLAUDE.md](../../CLAUDE.md)) — es muss die
  *eine* Wahrheit für Scrubben, Klick und Tasten werden.
- **Wo im Halt der Kopf steht, sagt der KLIP — keine zweite Anzeige.** Der
  Kopf steht sichtbar in einem Klip mit Breite: dass ein Halt läuft, wo darin,
  und wie viel Rest rechts davon bleibt, liest man an einer Stelle ab; bei
  einer Kette ist zusätzlich der aktive der hervorgehobene („Aufnahme 2 von 3"
  ohne ein Wort). Eine Statuszeile in der Kopfleiste, die dasselbe in Worten
  wiederholt, war eine **Krücke für eine Leiste, die den Halt nicht zeigen
  konnte** — sie ist mit dem Halt-als-Objekt gegenstandslos geworden und
  wieder gestrichen (Chronik in §4, Etappe 1). Merkregel für alles Weitere:
  Eine Anzeige, die einen Mangel kompensiert, muss verschwinden, wenn der
  Mangel behoben ist — sonst wird sie später mit einer Begründung
  verteidigt, die es nicht mehr gibt.
- **Der Kopf bleibt immer orange.** Er wechselte im Halt auf Lila — Farbe
  bezeichnet hier aber Identität, nicht Zustand; ein Ortsanzeiger, der auf
  halber Strecke die Farbe wechselt, liest sich als zweiter Kopf. Der Zustand
  steht ohnehin im Klip, in dem der Kopf steht.
- **Offen bleibt allein die PAUSE.** Sie fällt im Film fast auf einen Strich
  zusammen — dort war „Pause · 22 Min Aufnahme, im Film gerafft" kein
  Duplikat, sondern die einzige Auskunft. Ob sie einen eigenen Platz braucht
  oder als Tooltip an der Pausenmarke genügt, ist nicht entschieden.

### C. Fester Maßstab: der Schlüssel zur Fortbewegung

**Das Problem.** Die Fortbewegung bestimmt die Filmdauer (`MODE_SPEED` in
[tour.js](../../src/tour.js), gespiegelt in `tempoMs`): dieselbe Strecke ist zu Fuß
ein Vielfaches der Fährfahrt. Eine gezogene Modus-Grenze ändert also die Achse, auf
der sie selbst liegt. Solange die Leiste den **ganzen Film auf die Fensterbreite**
passt (heutiges Zoom-Modell: Faktor auf Basisbreite, [editor.ts](../../src/studio/editor.ts)
`zoom = 1` = eingepasst), skaliert jede Längenänderung **alles** — auch das, was vor
der Kante liegt und mit ihr nichts zu tun hat. Gemessen: Die Kante konnte beim
Loslassen entweder ihre Pixelstelle behalten (dann stand eine andere Filmsekunde
darunter: 0:36 statt 0:30) oder ihre Filmsekunde (dann sprang sie 16 px von der
Maus weg). **Beides falsch, und beides unvermeidbar in diesem Modell.**

**Die Lösung: px je Filmsekunde als feste Größe.**

- Beim Öffnen wird einmal **eingepasst** (fit); der Maßstab steht danach fest.
- Zoomen ändert den Maßstab (Knöpfe − ⤢ +, ⌘+/⌘−, ⇧Z = einpassen — die
  FCPX-Kürzel aus [studio-editor.html](../archive/mockups/studio-editor.html); Zoomen um die
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

- **Editor-Route** ([tours.ts `/editor`](../../server/src/routes/tours.ts)): je Video
  `dauerS` mitliefern — Quelle ist das gerenderte `tour.json` (`durationS` steht
  dort schon) bzw. der Anreicherungs-Cache; fehlt beides (unverarbeiteter
  Altbestand), lässt der Editor die 5,2-s-Annahme stehen und zeigt es an
  („Länge nach ‚Neu verarbeiten' bekannt").
- **Pipeline** ([video.ts](../../server/src/pipeline/video.ts)): bei gesetztem
  `trim` **immer Transcode** — der Remux-Pfad (`-c copy`) schneidet nur an
  Keyframes und träfe den Schnittpunkt um Sekunden. `durationS` im Tour-JSON ist
  danach die getrimmte Länge.
- **Enrich** ([enrich.ts](../../server/src/pipeline/enrich.ts)): Audio-Anker
  `anker + versatzFilmS + dauerFilmS` beim Rendern über die Film-Achse in die
  `f0/f1`-Anteile des Tour-JSON übersetzen (die Achse steht der Pipeline über
  [filmtempo.ts](../../server/src/pipeline/filmtempo.ts) zur Verfügung).
- **Player** ([audiotracks.js](../../src/audiotracks.js),
  [abspielen.ts](../../src/studio/abspielen.ts)): `loop` aus dem Overlay statt
  pauschal `el.loop = true` für Musik; SFX mit `loop: true` brauchen ein
  Bereichsende (heute one-shot). `einstiegS` = Start-Seek (das Eintritts-Seek-
  Muster existiert in abspielen.ts bereits).

---

## 4. Umsetzungsplan

Vier Etappen, jede einzeln releasebar. Reihenfolge nach Nutzen ÷ Risiko; die
Schema-Änderung kommt bewusst zuletzt.

### Etappe 1 — Playhead, Halt-Intervalle, Videolänge, Maßstab *(kein Schema-Bruch)* — **UMGESETZT 2026-08-05**

Das Ausgangsproblem, plus das Fundament für alles Weitere.

Abweichungen von der Planung, gemessen am echten Editor:

- Den **Lila-Wechsel des Kopfes** gab es nur im Mockup — im Editor war der
  Kopfstrich immer orange. Nichts zu entfernen.
- **Die Statuszeile in der Kopfleiste ist wieder gestrichen** (Nutzer-Befund):
  Als Pille, die nur bei Halten erscheint, verschob sie beim Scrubben Uhr,
  Werkzeuge und Zoom-Regler daneben — die ganze Leiste sprang. Eine Anzeige, die
  die Bedienelemente bewegt, kostet mehr, als sie sagt — und sie sagte nichts
  Neues: Seit der Halt ein Klip mit Breite ist, steht der Kopf sichtbar
  darin, und Restdauer wie Stelle in der Kette liest man dort ab (dazu zeigt
  die Karte das eingeblendete Bild). Die AUSKUNFT bleibt
  (`haltBeiFilmS`/`beschreibeHaltStand`, getestet) — sie gehört ab Etappe 2 auf
  den Klip selbst, wo sie nichts verschiebt. Mit ihr ist auch die
  Zeitraffer-Erkennung wieder raus.
- **Bandbeschriftungen kürzen in Stufen und SAGEN es.** Passt „Wolkig 52%"
  nicht, steht dort „Wolkig …"; reicht auch das nicht, schneidet CSS mit
  `text-overflow: ellipsis` ab. Der alte Alles-oder-nichts-Schnitt ließ ein
  56-px-Band unbeschriftet, obwohl das Wort 45 px braucht (Berner Oberland bei
  2:09) — und ein bloßes „Wolkig" ohne Auslassungspunkte sähe aus, als WÄRE das
  die Angabe. Man sucht einen fehlenden Wert nicht, wenn man nicht weiß, dass er
  existiert. Zwei Dinge gehören dazu: `kuerzeBeschriftungen` läuft auch nach
  jeder **Maßstabsänderung** (rAF-gebündelt) — beim Hineinzoomen wird das Band
  breit, dann gehört der volle Text wieder hinein; und unter 74 px Bandbreite
  rückt der Text per **Container-Query** an den Rand, weil dort die Polsterung
  (2×9 px) der größte Posten ist.
- **`aufnahmeHaltS`** (neu) ersetzt `haltedauerS` überall dort, wo es um die
  Filmzeit EINER Aufnahme geht — Achse, Halt-Breite, Überfahr-Marken der
  Wiedergabe, Inspector-Summe. `haltedauerS` bleibt für die Foto-Standzeit.
- Die **Editor-Route** nimmt `dauerS` aus drei Quellen (Manifest → Anreicherungs-
  Cache → tour.json), nicht nur aus dem tour.json: die App misst schon beim
  Aufnehmen, und dann steht die Länge vor dem ersten Rendern zur Verfügung.
- `aktuelleStopps()` fällt aus dem Achsen-Cache mit ab — die Halt-Auskunft darf
  `baueStopps` (Projektion jeder Aufnahme auf den ganzen Track) nicht je
  Scrub-Frame rechnen. Gilt weiter, auch ohne die gestrichene Anzeige: ab
  Etappe 2 fragt der Klip dieselbe Funktion.

1. `baueAchse` gibt die Halte als **Intervalle** zurück (`{offsetS, breiteS,
   filmVon, filmBis, indizes}` statt nur `{offsetS, breiteS}`) — die Auskunft
   „steht der Kopf in einem Halt, und wo darin?" gibt es heute nicht.
2. **Playhead führend in Filmsekunden** (Scrubben, Klick, Pfeiltasten,
   Abspielen aus einer Quelle). Die Auskunft „wo im Halt" entsteht als
   Funktion (`haltBeiFilmS`/`beschreibeHaltStand`) und wird getestet — sie
   bekommt aber KEINE eigene Anzeige in der Kopfleiste, s. Abweichungen oben.
3. **Videolänge**: Editor-Route liefert `dauerS`; Achse und Szenen-Breite nutzen
   sie. **Momente** bekommen Achsenbreite (als Halte).
4. **Zoom-Modell auf px/Filmsekunde umstellen** — das bestehende Faktor-Modell
   (`zoom`, `wendeZoomAn`, `ankerScroll`) bleibt als Bedienung, aber die
   gespeicherte Größe wird der Maßstab; fit = Startzustand. Beim Zug einer
   Fortbewegungs-Grenze (Etappe 3) wird er eingefroren; hier reicht: Maßstab
   ändert sich nur durch Zoomen/Einpassen, nie durch Datenänderung.
   `waehleFilmStufe(pxProS)` ist schon maßstabsfähig.
5. Tests in [test/](../../test/): Halt-Intervalle, Kopf-in-Halt-Auskunft,
   Pfeiltasten über einen Halt, Achse mit Videolänge, Stufenwahl.

**Fertig, wenn:** der Kopf an einer Tour mit 6-s-Halt per Pfeiltaste und Scrub
durch den Halt läuft — sichtbar daran, dass er sich innerhalb des Halt-Klips
bewegt, statt an dessen Kante zu kleben.

### Etappe 2 — Szenen-Bahn *(kein Schema-Bruch)* — **UMGESETZT 2026-08-05**

Abweichungen von der Planung, gemessen am echten Editor:

- **Momente blieben in ihrer eigenen Bahn** — die Begründung war, dass ihr
  Umzug eine Entscheidung über ihre BEDIENUNG ist (Zug, Inspector, „+"-Menü)
  und nicht zur Klip-Kette gehört. Sie hielt nur, weil §2 die Zielgestalt
  nicht beschrieb; **überholt durch den Nachtrag unten.** Für „beiläufige
  Bilder" bleibt sie gültig: die gibt es im Editor noch gar nicht.
- **Der Filmstreifen im Inspector ist ersatzlos entfallen.** Er war der einzige
  Weg, die Aufnahmen eines Halts umzuordnen oder eine davon herauszulösen —
  beides tut jetzt der Klip-Zug an der Stelle, an der man es sieht. Zwei Wege
  zur selben Sache, einer davon ohne Zeitbezug, wären eine Verdopplung.
- **Der ganze Halt wandert nur noch über die KARTE.** Auf der Leiste zieht man
  einen Klip; der Kartenpunkt bewegt weiter alle Aufnahmen des Halts gemeinsam.
  Damit sind auch Schnapp-Ziel, Vorschau-Plakette und `dOffsetOhneCluster`
  aus dem Leisten-Zug verschwunden.
- **Zwei Züge, zwei Schreibweisen.** Die Standzeit wird LIVE ins Overlay
  geschrieben (man soll den Film wachsen und alles Spätere nachrücken sehen),
  der Klip-Zug erst beim Loslassen (dort bewegt sich nur das gezogene Element).
  Beide bleiben genau ein Undo-Schritt — `renderNachZug` schreibt `letzterStand`
  nicht fort. Ein Zug, der auf seinem eigenen Platz endet, schreibt gar nichts:
  `reiheVergeben` erzeugte sonst ein neues Overlay und damit einen LEEREN
  Undo-Schritt, den man später einmal umsonst rückgängig macht.
- **Beim Standzeit-Zug wird der Maßstab eingefroren — und bleibt es** (§2C,
  eigentlich für Etappe 3 vorgesehen): eingepasst folgt er sonst der wachsenden
  Filmdauer, die Leiste schrumpft unter der Hand und der Griff bleibt hinter dem
  Zeiger zurück. Ihn nach dem Loslassen wiederherzustellen war der erste Wurf
  und ein Nutzer-Befund: die Leiste sprang dann auf „alles im Fenster" zurück —
  also genau die Skalierung, gegen die der feste Maßstab gebaut ist, denn sie
  verschiebt auch alles VOR der geänderten Stelle. Der Fit gehört zum Öffnen und
  zum Zoomen, nicht zu einer Datenänderung; „×" und ⇧Z werden danach sichtbar
  aktiv. Gemessen: Zug +200 px ⇒ Film 2:46 → 3:17, Maßstab 1,0× → 1,2× (ehrlich
  angezeigt), erster Klip pixelidentisch bei x = 178.
- **Die Foto-Einblendung hängt jetzt am KOPF, nicht an einer Uhr.** Zwei
  Fehlerberichte hatten dieselbe Wurzel: Beim Scrubben kam gar kein Bild (die
  Einblendung war eine Überfahr-Marke des Abspielers), und beim Abspielen ging
  es 0,8 s vor seinem Klip aus (der Timer lief über die reine Standzeit, der
  Klip über Standzeit + Ausblendung). `synchronisiereFoto` liest bei jeder
  Kopfbewegung `haltBeiFilmS` — dieselbe Kette, aus der die Klips entstehen.
  `ZeigeMarke`/`Schritt.zeige` sind entfallen; das ist wieder die Merkregel aus
  §2B: eine Anzeige, die einen Mangel kompensiert, verschwindet mit ihm.
- **Die Dauer-Blase hängt an einer EIGENEN Klasse** (`zieht-dauer`), nicht an
  `zieht`: sonst schwebte beim Verschieben eines Klips eine Standzeit-Angabe
  über dem Bild — eine Antwort auf eine Frage, die gerade niemand stellt.
- **Der Standzeit-Griff bekam eine Zug-Schwelle** (4 px, wie der Klip-Zug) —
  vorher schrieb schon ein Pixel Mauswackeln beim Klick eine Standzeit ins
  Overlay. Die Rechnung setzt AN der Schwelle an, nicht am Druckpunkt: sonst
  spränge die Dauer beim Losfahren um die Schwellenbreite, und eingepasst sind
  4 px schnell eine ganze Sekunde.
- **Ein Video bekommt keinen Standzeit-Griff** (der Player läuft bis zum
  Dateiende, `holdS` ist dort wirkungslos) und **kein `img`, wenn weder Kachel
  noch Poster da sind** — eine `.mp4` als Bildquelle zeigt nur das Symbol für
  „kaputt".
- **Die Klip-Beschriftung wird von Container-Queries geschaltet, nicht von
  `kuerzeBeschriftungen`.** Die Schwellen aus §2A (150 / 232 px) haben sich
  unverändert bewährt; gemessen schalten die Stufen bei 34 / 156 / 525 px
  Klipbreite.

Gemessen am Editor (Koh-Pha-ngan-Seed, 12 Aufnahmen, 1600 px Fenster):
Standzeit +21,8 s ⇒ Film 4:53 → 5:15, Maßstab unverändert 1,7×, links der
Kante pixelidentisch; Andocken, Umordnen und Standzeit je genau ein
Undo-Schritt; Leerzug null; alle drei Ausbaustufen schalten bei 34 / 156 /
525 px wie vorgesehen; Speichern nimmt `holdS` und `reihe` an. Foto-Einblendung
am Klip m3 (78,80–84,79 s): beim Abspielen sichtbar 79,0–84,7 s (Messraster
0,2 s), beim Scrubben an ab Ankunft +0,1 s, Balken 0,01 / 0,50 / 0,98 an
Anfang / Mitte / Ende, dahinter aus.

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

### Etappe 3 — Zustandsbahnen *(kein Schema-Bruch)* — **UMGESETZT 2026-08-05**

Abweichungen von der Planung, gemessen am echten Editor:

- **Die Bisektion ist NICHT eingebaut** — die geforderte Messung hat sie
  erledigt. Ein Zieh-Frame kostet 14 Achsenbauten (`zerlegeFuerAnzeige` +
  `baueAchse`), gemessen in Node auf einem M4, **ohne** den Rest des Frames
  (Ø / max über 40 Läufe):

  | Trackpunkte | Bisektion, voll | Bisektion, Halte vorgerechnet | `baueGrenzKurve` |
  |---|---|---|---|
  | 335 (Koh Pha-ngan, echt) | 0,62 / 1,04 ms | 0,29 / 0,33 ms | 0,017 ms **einmal** |
  | 993 | 1,39 / 1,46 ms | 0,73 / 0,78 ms | 0,041 ms einmal |
  | 2 967 (≈52 min bei 1 Hz) | 4,06 / 4,90 ms | 2,07 / 2,18 ms | 0,080 ms einmal |
  | 9 876 (≈2,7 h bei 1 Hz) | **12,51 / 15,09 ms** | 6,64 / 7,17 ms | 0,205 ms einmal |

  Der Mockup-Wert (Ø 1,4 ms, §6) galt für einen dünnen Track. An 10 000 Punkten
  reißt die naive Variante das 8-ms-Budget, und selbst mit vorgerechneten Halten
  bleiben 6,6 ms — kein Puffer, wenn Render und Karte noch dazukommen. Die
  Auswertung der Kurve liegt je Frame unter der Messschwelle (< 0,005 ms).

  **Warum `baueGrenzKurve` sie ersetzt — und dabei einfacher ist.** Die
  Filmposition der Grenze hängt NUR von dem ab, was VOR ihr liegt: Bis zur
  vorigen Grenze ändert sich beim Ziehen gar nichts, und dazwischen gilt das
  Tempo des LINKEN Bands, egal wohin man zieht. Also ist F(t) eine feste,
  stückweise lineare, monotone Funktion über dem Fenster [vorige Grenze,
  nächste Grenze]. Sie entsteht EINMAL beim Zug-Start (Fahrzeit über die
  Trackpunkte des Fensters, Halte als Sprünge eingewebt — dieselbe Stelle wie
  die Achse, `webeHalte`) und wird danach in beide Richtungen ausgewertet. Die
  Bisektion suchte iterativ, was hier direkt dasteht; und sie war auf 0,2 s
  genau, während die Kurve exakt ist. Nachträglich zeigte sich die Messreihe
  ohnehin als hypothetisch: Der Editor-Track ist serverseitig auf 5 m
  vereinfacht ([tours.ts](../../server/src/routes/tours.ts)) — aus einem GPX mit
  9 000 Punkten kommen im Editor **541** an.
- **Dieselbe Rechnung trägt die Filmdauer-Vorschau** (`filmDauerBeiGrenze`):
  Verschiebt man die Kante, wechselt genau die Strecke zwischen alter und neuer
  Lage den Modus; ihre Filmzeit ändert sich um die Differenz der Kehrwerte der
  Tempi. Keine zweite Achse nötig.
- **Die eigene Kante wird über den INDEX gefunden, nicht über eine
  Zeit-Toleranz.** Der Overlay-Anker ist sekundengenau (`offsetZuIso` schneidet
  die Millisekunden ab), die Wechselzeit im Track ist es nicht — 7839,1 gegen
  7840. Mit „alles vor mir / alles nach mir" wurde die eigene Kante zum rechten
  Nachbarn, das Zug-Fenster war der Abschnitt DAVOR, und die Kante klemmte nach
  7 px fest. Kostete eine Runde.
- **Der Rast-Bug beim Rechtsziehen: drei Fassungen, eine Ursache.** Meldung des
  Nutzers nach der ersten Fassung: „`rasteAnHalt` mischt Filmsekunden aus der
  Grenzkurve mit Halt-Positionen aus der Achse — die beiden laufen rechts der
  ursprünglichen Kante auseinander." Genau so war es, und die zwei Anläufe
  danach haben gezeigt, dass die Ursache tiefer liegt als das Mischen:

  1. **Fassung 1 (gemischt).** `filmS` ist die Zeigerstelle, aus der die
     Grenzkurve die Landezeit macht; `halt.filmVon/filmBis` kamen dagegen aus
     der Achse. Links der ursprünglichen Kante sind beide identisch, rechts
     davon nicht — dort gilt in der Kurve der linke Modus, in der Achse der
     rechte. Damit prüfte die Zeit-Toleranz (`|halt.offsetS − t| ≤ 0,5 s`) einen
     anderen Halt als der Intervall-Test, und „davor/dahinter" wurde an einem
     Intervall entschieden, das zu einer fremden Aufnahme gehörte.
  2. **Fassung 2 (alles in Kurven-Koordinaten).** Rechnerisch sauber und an der
     echten Tour belegt: Der Halt wandert beim Loslassen um 41 px nach, die
     Kante landet exakt auf seiner Flanke. Trotzdem falsch — der hervorgehobene
     Halt stand **159 px neben der Ziellinie**, weil er auf der Leiste noch an
     seinem alten Platz gezeichnet war. Man rastet an etwas ein, das man dort
     nicht sieht (Screenshot des Nutzers).
  3. **Fassung 3 (Achsen-Koordinaten, kein Rasten bei der Fortbewegung).** Jetzt
     stimmte das Zielen mit dem Bild überein, aber der Zug lief in die
     eigentliche Wurzel: Zeigt der Zeiger auf eine Filmsekunde INNERHALB eines
     Halts, liefert die Umkehrung dessen Zeit — und die Hin-Richtung fällt per
     lower_bound auf seine LINKE Flanke (§1). Gemessen sprang die Kante beim
     Loslassen um 5,4 s / 17,6 px zurück. Zudem war die Bedienung inkonsistent:
     Ziellinie bei Kamera und Wetter, keine bei der Fortbewegung.

  **Die Ursache** ist keine Rechenfrage, sondern eine der Darstellung: Die
  Leiste zeigte während des Zugs die ALTE Anordnung, gelandet wurde in der
  NEUEN. Eine Vorschau kann dann zeigen, worauf man zielt, ODER wo es landet —
  nie beides. Also geht die Leiste mit (Nutzer-Vorschlag): Jeder Zieh-Frame
  schreibt die Grenze und baut neu auf (`renderNachZug`, ein Undo-Schritt),
  Klips, Bänder, Marken und die Filmdauer rücken live nach. Damit fallen Zielen
  und Landen wieder zusammen, alle drei Bahnen rasten an dem Halt, den man
  sieht, und §7 ist entschieden.
- **Möglich ist das erst durch die exakte Umrechnung.** Der ursprüngliche Grund
  für die Entkopplung war, dass die Kante dem Zeiger davonlief (116 px) — das
  lag an der Achse des Vorframes, nicht am Live-Schreiben. Mit `baueGrenzKurve`
  steht die Kante nach jedem Neuaufbau wieder unter dem Zeiger (gemessen
  0,1 px; Restabweichung ist die Sekundenrundung des ISO-Ankers).
- **Kosten gemessen**: 5,5 ms je Zieh-Frame im Median (Koh Pha-ngan, 335
  Trackpunkte, 12 Klips), 4,0 ms bei 541 Punkten ohne Medien. Die Klips kosten
  mehr als die Trackpunkte. Und die 10 000-Punkte-Sorge aus der
  Bisektions-Messung ist unbegründet: Der Editor-Track ist serverseitig auf 5 m
  vereinfacht — aus einem GPX mit 9 000 Punkten werden 541.
- **Die Ziellinie ist eine Orientierung durch alle Bahnen**, nicht nur eine
  Rast-Vorschau: den ganzen Zug über sichtbar (Haarstrich), beim Einrasten
  hervortretend (lila). Wer eine Grenze setzt, will sehen, was dort zeitlich
  übereinanderliegt — dieselbe Frage, die die Halt-Zone bei der Auswahl
  beantwortet.
- **Am Ende schreiben ALLE Züge live** — Kanten wie Momente. Die in §2D
  vorgesehene Entkopplung („Modell erst beim Loslassen") war die Antwort auf ein
  Problem, das die Grenzkurve gelöst hat; sie hat sich damit selbst erledigt.
  Was bleibt, ist ihr eigentlicher Kern: Während eines Zugs wird `letzterStand`
  nicht fortgeschrieben, also ist der ganze Zug genau ein Undo-Schritt.
- **Kamera und Wetter hätten die Entkopplung nicht gebraucht.** Dort ändert der
  Zug die Achse nicht — Zielen und Landen fallen ohnehin zusammen. Die
  Schwierigkeit war von Anfang an nur die der Fortbewegung; das war beim
  Schreiben von §2D nicht zu sehen.

Gemessen am Editor (Koh Pha-ngan, 1600 px Fenster, Maßstab 1,0×):
freier Fortbewegungs-Zug ⇒ Kante folgt dem Zeiger auf 0,1 px, links davon alles
pixelidentisch, Film 4:53 → 4:56; Zug über einen Halt ⇒ der Halt wandert
sichtbar mit (644,8 → 686,3 px), Etikett „2:34 · 18:06 Uhr · rastet hinter den
Halt · Film 4:53 → 5:05", Ziellinie deckungsgleich mit der Kante; Wetter-Kante
auf einen Halt ⇒ Ziellinie exakt auf dessen Flanke (0,0 px). Je Zug ein
Undo-Schritt.

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

### Etappe 4 — Ton & Video-Trim *(Schema-Ergänzung, §3)* — **UMGESETZT 2026-08-05**

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

**Umgesetzt so — und das kam beim Bauen dazu:**

- **Der Vertragstest kam VOR der Erweiterung**
  ([server/test/vertrag-tourjson.test.ts](../../server/test/vertrag-tourjson.test.ts)):
  Schnappschüsse des gerenderten `tour.json` für elf echte Overlay-Formen. Er
  ist bewusst grob — er prüft nicht eine Regel, sondern das ganze Ergebnis.
  Dazu eine Probe, dass sich die Fälle überhaupt UNTERSCHEIDEN: ohne sie könnten
  elf identische Ergebnisse „grün" sein und der Vertrag bewachte nichts. Genau
  die schlug beim ersten Lauf an — der Video-Schnitt wirkt in `bereiteVideosAuf`,
  nicht in `reichereAn`, im reinen Enrich-Harnisch war der Fall also wirkungslos.
- **Der alte Pfad bleibt buchstäblich der alte.** `enrich.ts` nimmt die
  Film-Verankerung nur, wenn eines der neuen Felder GESETZT ist; sonst läuft der
  Code von vorher Zeichen für Zeichen durch. Ein Roundtrip Zeit → Film → Zeit
  wäre auf dem Papier identisch, in Gleitkomma aber nicht — und hätte die
  Schnappschüsse aller Bestandsformen verschoben.
- **Die Pipeline braucht eine eigene Film-Achse**
  ([server/src/pipeline/filmachse.ts](../../server/src/pipeline/filmachse.ts)):
  Ein Versatz in Filmsekunden ist ohne die Halte nicht auffindbar. Sie ist der
  Spiegel von `baueAchse` — gleiche Gruppierung (120 m), gleiche Halt-Dauern,
  gleiche lower_bound-Konvention; Drift-Wächter halten beides zusammen.
- **`videoMeta` musste cachefähig BLEIBEN und trotzdem auf den Schnitt hören.**
  Sie hing bis dahin nur an den Rohdaten und überlebte jedes Edit-Speichern im
  Anreicherungs-Cache — ein Schnitt ist aber ein Edit. Dafür gibt es jetzt eine
  `videoSchnittSignatur` neben der `trimSignatur`.
- **Der Schnitt entsteht NEBEN dem Master, nie an seiner Stelle** (`m1.cut.mp4`).
  Würde in die Auslieferungsdatei geschnitten, wäre der zweite Schnitt einer in
  den ersten — das Overlay rechnet aber in Dateisekunden des Originals, und
  „Trim zurücknehmen" fände das Weggeschnittene nirgends wieder. Deshalb trägt
  `VideoMeta` zusätzlich `quellDauerS`: die Länge des MATERIALS, an der die
  Trimm-Kanten im Studio anschlagen.
- **Ein Effekt war nie eine Marke — die LEISTE hat ihn nur so gezeichnet.** Der
  Player spielt einen One-Shot bis zum Dateiende aus. Der Klip mit Dateibreite
  zeigt also, was ohnehin passiert; `dauerFilmS` braucht es erst, wenn jemand
  kürzer schneidet. Dateilängen stehen nirgends im Datenmodell (der Katalog
  führt Namen, keine Sekunden) — der Editor misst sie per `loadedmetadata`.
- **Aufgewertet wird nur der Klip, den man ANFASST.** Anders als bei
  `materialisiereModi`: Dort MUSS die ganze Stufenfunktion fest werden, weil
  eine einzelne neue Grenze die späteren Abschnitte mitrisse. Ton-Klips sind
  unabhängige Objekte.
- **Der Ripple kostet keine Zeile.** Ein Video liegt in einer Halt-Kette ohne
  Lücken; wird sein Ausschnitt kürzer, wird sein Halt schmaler, die Achse baut
  sich neu, alles Folgende rückt vor. Es gibt keinen Ripple-Zweig.
- **`musik`/`sfx` beschreibt jetzt die ROLLE, nicht die Form** (Nutzer-Rückfrage:
  „wo ist hier noch der Unterschied?"). Antwort: an genau zwei Stellen im
  Player, und beide fragen dasselbe — der Zuschauer-Schalter „Musik" nimmt den
  Score weg und lässt den Ton des Ortes stehen, und unter dem eigenen Ton eines
  Videos duckt nur die Musik. Die alte Beschriftung („über eine Strecke" / „ein
  Zeitpunkt") beschrieb eine Form, die es nicht mehr gibt → „Rolle: Filmmusik ·
  Ton der Szene". Der Umschalter verlor dabei zwei Dinge still: `bis` fiel weg
  (Länge geht jetzt vorher nach `dauerFilmS`) und die Loop-Vorgabe hängt an der
  Rolle (`loopNachRollenwechsel`).
- **Loop AUS holt den Klip ans Material zurück** (`setzeLoop`, ebenfalls
  Nutzer-Befund). Vorher blieb die überschüssige Länge stehen und füllte sich
  hinter der Wellenform mit Stille — man musste von Hand nachziehen, um zu
  sehen, wo das Material endet. Gemessen: 113,3 s → 100,08 s = exakt die Datei.
- **Die Zeitfelder des Inspectors waren ein toter Bedienpfad.** Sie schrieben
  `ab`/`bis`, die seit der Aufwertung keinen Vorrang mehr haben — ab dem ersten
  Kantenzug wirkungslos, und beim LESEN zeigten sie eine Zeit, die im Film
  nichts bedeutet (08:37 statt 08:32). Sie gehen jetzt durch dieselben
  `verschiebeTon`/`trimmeRechts` wie der Zug; `loeseFokusAuf` bekommt die
  Ton-Spanne als Rückruf herein, weil das Modul die Achse nicht kennt.
- **Gemessen an der Probetour** (34-s-Video, 3 Aufnahmen, 3 Ton-Klips): linke
  Kante +80 px → „1:03 · ab 0:17 der Datei" (Anfang und Einstieg wandern
  gemeinsam); weit nach links → „1:20 · kein Material mehr", und zwar bei
  `loop: true` — Loop hebt nur den RECHTEN Anschlag auf. Standzeit +24,5 s →
  der Ton-Klip dahinter rückt +116,0 px, der davor exakt 0 px. Video-Schnitt
  13,9 s → Filmdauer 2:29 → 2:15, `m2.cut.mp4` misst 20,08 s, der Master
  `m2.web.mp4` weiterhin 34 s.

### Nachtrag zu Etappe 2 — die Gestalt der Leiste — **UMGESETZT 2026-08-05**

Nach den Etappen 1–4 stimmt die Mechanik, aber die Leiste sieht anders aus als
in §2.0 beschrieben — weil §2.0 damals fehlte. Drei Punkte, ein Zusammenhang:

1. **„Fotos/Videos" → „Szenen"** ([studio.html](../../studio.html), Spurname).
   Die Voraussetzung für Punkt 2: Solange die Bahn ihre Dateitypen aufzählt,
   passt ein Moment dort nicht hinein.
2. **Die Spur „Momente" entfällt**; Momente werden Klips der Szenen-Bahn —
   Muster in Koralle statt Miniatur, Achsenbreite haben sie seit Etappe 1.
   Das ist die eigentliche Arbeit: Zug, Auswahl, Inspector und das
   „+"-Menü müssen von der alten Bahn auf die Szenen-Bahn wechseln.
3. **„Musik & Effekte" rückt nach oben**, direkt unter die Szenen — die drei
   Zustandsbahnen bilden den Sockel (Begründung in §2.0).

Kein Schema-Bruch, keine Berührung mit Etappe 4. Punkt 1 und 3 sind je eine
Zeile, Punkt 2 ist ein echter Umbau.

**Fertig, wenn:** die Leiste von oben nach unten Szenen · Musik & Effekte ·
Fortbewegung · Kamera · Wetter zeigt, ein Moment als Klip in der Szenen-Bahn
liegt und sich dort auswählen, verschieben und in der Dauer ändern lässt.

**Wie es gebaut ist.** Der Moment-Klip ist derselbe `.halt-klip` wie eine
Aufnahme (eigene Reconcile-Karte `momentEls`, geschlüsselt an `ab`), nur ohne
Miniatur: an ihrer Stelle das Muster in Koralle. Sein rechter Griff zieht
`momente[].dauerS` — dieselbe Geste wie die Standzeit eines Fotos, andere
Grenzen (`klemmeMomentDauer`, 1–30 s aus schema/edits.ts). Zwei Dinge sind
dabei UMGEBAUT worden, nicht nur umgehängt:

- **Der Zug schreibt nicht mehr live.** Als Punkt ohne Breite durfte er das
  (§2 „Momente sind Punktereignisse"); mit Achsenbreite läge um seine
  Ruhelage eine tote Zone von seiner eigenen Breite, weil die Rückrechnung
  px → Zeit über sein eigenes Plateau geht. Er folgt jetzt wie der
  Aufnahme-Klip dem Zeiger und schreibt einmal beim Loslassen — über eine
  Zug-Achse OHNE diesen Moment. Dafür trägt ein `AchsenHalt` seit hier einen
  `schluessel`: `indizes` überlebt das Weglassen eines Halts nicht.
- **Die Halte für die Achse baut `achsenHalte()`**, eine Stelle statt drei
  Kopien (Achse, Klip-Zug, Moment-Zug). Nebenbei behoben: die Zug-Achse des
  Aufnahme-Klips ließ bis dahin ALLE Momente weg und rechnete dadurch um
  deren Filmzeit daneben.

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

Dazu die, die erst der echte Editor gekostet hat (Etappen 2 und 3):

9. **Zwei Film-Koordinatensysteme in einer Geste sind immer ein Bug.** Beim
   Fortbewegungs-Zug gibt es die Achse (was gezeichnet ist) und die Grenzkurve
   (wo die Kante landet); rechts der Kante laufen sie auseinander. Jede Größe,
   die man vergleicht — Zeigerstelle, Halt-Intervall, Ziellinie —, muss aus
   DERSELBEN stammen. Der einzige saubere Übergabepunkt zwischen beiden ist die
   AUFNAHMEZEIT. Sauber wird es aber erst, wenn die Leiste im Zug mitgeht (§4,
   Etappe 3).
10. **Overlay-Anker sind SEKUNDENgenau** (`offsetZuIso` schneidet die
    Millisekunden ab), Track-Zeiten sind es nicht. Zeit-Toleranzen unter einer
    Sekunde unterscheiden deshalb nichts Verlässliches: Die eigene Kante eines
    Zugs findet man über den INDEX in der Kantenliste, nicht über „alles vor
    mir / alles nach mir" (sonst wird sie ihr eigener Nachbar). Und „strikt
    hinter dem Halt" ist eine ganze Sekunde, kein Epsilon.
11. **Eine Anzeige, die an einer UHR hängt statt an der Position, driftet.** Die
    Foto-Einblendung lief über einen Timer und war deshalb beim Scrubben gar
    nicht da und beim Abspielen 0,8 s zu kurz. Alles, was „gerade gilt", ist
    eine Funktion der Kopfposition.
12. **Ein Zug, der nichts ändert, darf nichts schreiben.** Die Overlay-Mutatoren
    liefern immer ein neues Objekt — der Referenzvergleich in `renderAlles`
    macht daraus einen LEEREN Undo-Schritt, den man später einmal umsonst
    rückgängig macht.
13. **Der Fit gehört zum Öffnen und zum Zoomen, nicht zu einer Datenänderung.**
    Wer ihn nach einem Zug wiederherstellt, skaliert die ganze Leiste — auch
    alles VOR der geänderten Stelle. Ein waagerechter Scrollbalken ist dann kein
    Fehler, sondern die Folge einer Nutzerhandlung.
14. **In einen Halt VOR sich kann die Fortbewegungs-Kante nicht landen** — und
    das ist keine Rechenschwäche, sondern die Sache selbst. Ein Halt RECHTS der
    Kante steht auf einer Filmposition, die von der Filmzeit VOR ihm abhängt,
    also von der Kante; zieht man die Kante in ihn hinein, rutscht er im selben
    Zug nach hinten weg (gemessen: Halt bei Film 86–106, Kante rastet auf seine
    Rückseite, Halt steht danach bei 125–145). Einen Fixpunkt gibt es dafür
    nicht: „hinter dem Halt" und „auf dem Pixel, wo der Halt gerade gezeichnet
    ist", sind hier zwei verschiedene Orte. Wichtig ist nur, dass es sich im
    nächsten Frame fängt — und das tut es, weil ein Halt in ruhiger Lage stets
    RECHTS der Kante liegt; ein Dauerflackern ist damit ausgeschlossen. Als
    Vertrag festgehalten in `test/studio-baukasten.test.ts` („Ausnahme: in einen
    Halt VOR sich …").
15. **Die globalen Knopf-Regeln schlagen jede Klasse.** `button:hover` gibt dem
    Klip eine graue Fläche, `button:active { transform: scale(…) }` ERSETZT sein
    `translateX` beim Ziehen. Beides in einer eigenen Regel zurücknehmen.

---

## 6. Messwerte

### Am MOCKUP (Koh-Pha-ngan-Beispieltour: 52 min Aufnahme → 3:00 Film)

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
| Bisektion (14 Schritte) | Ø 1,4 ms, max 4,6 ms je Zieh-Frame — **trägt am echten Track nicht**, s. §4 Etappe 3 |
| Rastung mit 0,01-Filmsekunden-Epsilon | bis 71 px neben der Ziellinie (lower_bound) |
| Ton-Magnetik: Standzeit +10 s | alle späteren Klips exakt +10 s |

---

### Am ECHTEN Editor (Koh-Pha-ngan-Seed: 41 km, 12 Aufnahmen, 335 Trackpunkte, 4:53 Film, 1600 px Fenster)

| Befund | Wert |
|---|---|
| Klip-Zug: Andocken / Umordnen / Standzeit | je genau EIN Undo-Schritt; Zug auf den eigenen Platz: null |
| Ausbaustufen der Klips (Container-Query) | schalten bei 34 / 156 / 525 px Klipbreite |
| Standzeit-Zug +200 px | Film 2:46 → 3:17, Maßstab 1,0× → 1,2×, erster Klip pixelidentisch (x = 178) |
| Foto-Einblendung, Klip m3 (78,80–84,79 s) | Abspielen sichtbar 79,0–84,7 s (Raster 0,2 s); Scrubben an ab Ankunft + 0,1 s |
| Fortbewegungs-Zug, frei | Kante landet 0,1 px neben der Zieh-Stelle, links davon pixelidentisch |
| dito, Fassung 2 (Kurven-Koordinaten) | Ziellinie 0,0 px exakt — aber 159 px neben dem hervorgehobenen Halt |
| dito, Fassung 3 (kein Rasten, Zeiger im Halt) | Rücksprung 5,4 s / 17,6 px (lower_bound, §1) |
| Halt beim Rechtsziehen | wandert 41 px nach (644,8 → 686,3 px), weil der Film wächst |
| Zieh-Frame mit Live-Aufbau | Median 5,5 ms / p95 6,7 (335 Punkte, 12 Klips) · 4,0 / 4,9 ms (541 Punkte, 0 Medien) |
| `baueGrenzKurve` statt Bisektion | 0,205 ms EINMAL bei 10 000 Punkten statt 12,5 ms je Frame |
| Editor-Track nach Server-Vereinfachung (5 m) | GPX mit 9 000 Punkten → **541** im Editor |

---

## 7. Offen (bewusst nicht entschieden)

- ~~**Rastet die Fortbewegungs-Grenze an Halten?**~~ ENTSCHIEDEN (Etappe 3):
  Ja — aber erst, seit die Leiste im Zug mitgeht. Der beschriebene Versatz war
  keine Konzeptschwäche, sondern die Folge davon, dass die Leiste die alte
  Anordnung zeigte, während die Kante in der neuen landete. Wird sie
  fortwährend in den Zielzustand gesetzt, fällt der Versatz weg und der Halt
  wandert sichtbar mit (s. §4, Etappe 3).
- **Dauerhafte Kennzeichnung der Halt-Zonen in den Zustandsbahnen** — fünf
  Varianten diskutiert, Empfehlung „nur beim Ziehen sichtbar" (ggf. + feine
  Trennstriche). Offen gelassen.
- **Titel-Spur** und die weiteren Bausteine aus
  [editor-ausbau.md](editor-ausbau.md) — die Szenen-Bahn ist dafür der Platz,
  aber nichts davon ist hier verplant.
- **Die Ordnungstabelle in [editor-ausbau.md](editor-ausbau.md) §1** („gilt ·
  hält an · läuft nebenher · klingt") widerspricht der Reihenfolge in §2.0.
  Sie ordnet die begriffliche Familie, nicht die Bahnen auf dem Schirm — das
  sollte dort dazugeschrieben werden, sonst kollidieren die beiden Dokumente
  beim nächsten Mal wieder.

---

## 8. Lehre fürs nächste Konzeptpapier

Drei der vier Nachbesserungen dieser Runde gingen nicht auf einen Denkfehler
zurück, sondern auf eine **Auslassung derselben Sorte**: Das Papier war als
Begründungssammlung geschrieben — warum etwas so und nicht anders gerechnet
wird —, nicht als Beschreibung des Zielzustands.

- Die **Statuszeile** wurde gebaut, weil ihre Begründung dastand; dass sie
  gegenstandslos wird, sobald der Halt Breite hat, stand nicht da.
- **Name, Reihenfolge und Wegfall der Momente-Spur** standen nirgends. Eine
  Umsetzung, die dem Papier exakt folgt, baut korrekte Mechanik in die alte
  Hülle — genau das ist passiert.

Für die Mechanik hat die Form funktioniert (Fallen, Messwerte, verworfene
Alternativen haben mehrfach getragen). Für die Gestalt braucht es einen
eigenen Abschnitt, der schlicht sagt, wie es hinterher aussieht — §2.0 ist
zwölf Zeilen lang und hätte drei Runden gespart. **Was nicht im Dokument
steht, existiert für die nächste Session nicht**, egal wie oft es besprochen
oder wie sichtbar es im Mockup war.
