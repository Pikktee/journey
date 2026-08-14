# Die Steuerleiste des Players nach Paket G

Stand: 14. August 2026 · Status: **Entwurf, nichts gebaut** · Betrifft: `src/ui.ts`, `src/style.css`,
`erlebnis.html`, `src/tour.ts` (Telemetrie)

Mockups: [player-ui-ideen.html](../mockups/player-ui-ideen.html) (Hauptdokument, zweite Runde),
[player-leiste-halte.html](../mockups/player-leiste-halte.html) (nur die Halt-Darstellung),
[player-steuerleiste.html](../mockups/player-steuerleiste.html) (erste Runde, Gesamtbild).

---

## 1. Warum das jetzt ansteht

Mit Paket G (Etappe 5 des Gleichlauf-Vorhabens) ist die Fortschrittsleiste **die Zeitachse des
Films** geworden: Halte haben darin echte Breite. Das ist keine Kosmetik, sondern verschiebt die
Grundlage mehrerer Anzeigen — und zwei davon verlieren dadurch ihren Grund.

**Die Höhenkurve in der Leiste ist seit G kein Höhenprofil mehr.** Sie wird filmäquidistant
abgetastet (`buildProfile` in [ui.ts](../../src/ui.ts)), zeigt also Höhe über FILMZEIT: Im Halt
ist sie flach, ein langsamer Fußweg wird breit gezogen, ein Fährabschnitt gestaucht. Dazu wird
sie bei flachen Touren auf eine **Mindest-Spanne von 150 m** gedehnt (Stockholm hat ~30 m echte
Spanne) — dort zeigt sie DEM-Rauschen statt Gelände. Als Diagramm war sie nie lesbar; als
Stimmungsbild steht sie jetzt allen anderen Elementen der Leiste im Weg.

**„Nächster Halt" (oben rechts) wiederholt, was die Leiste zeigt.** Das ist dieselbe
Argumentation, mit der das Fortbewegungsmittel schon aus der Telemetrie geflogen ist (s.
[CLAUDE.md](../../CLAUDE.md)): *Der Marker zeigt es, der Motorloop lässt es hören — ein Wort
dafür wiederholte das nur.* Seit G stehen die Halte als Blöcke in der Leiste, mit ihrer Breite,
und der Kopf läuft sichtbar darauf zu. Dazu zwei sachliche Fehler des Blocks:

- **„in 1,2 km" ist eine Streckenangabe zu einer Zeitachse** — genau die Doppeldeutigkeit, die
  in `frac`/`filmFrac` gerade auseinandergezogen wurde, nur auf der Textebene.
- **„Halt" ist eine Auskunft über die Reise, gemeint ist der Film.** Ein Foto ist nicht
  unbedingt ein Anhalten; der Halt ist ein Schnitt. Wer „nächster Halt" liest, denkt an eine
  Haltestelle.

---

## 2. Der gemessene Befund: der Griff ist breiter als der Halt

Gemessen am laufenden Player (Playwright, `kohphangan`, erster Foto-Halt):

| | Leiste | Halt-Fläche | Griff (`.photo-dot`) | Trefferfläche (`::before`, `inset: -7px`) |
|---|---|---|---|---|
| Desktop 1280 | 1006 px | 19,5 px | 11 px | **25 px** |
| Telefon 390 | 352 px | 6,8 px | 13 px | **27 px** |

E18 legt fest, dass die Halt-Fläche `pointer-events: none` ist und der Punkt am Halt-Beginn der
Griff bleibt — richtig begründet (ein Tipp in die Mitte spränge sonst auf die Ankunft). **Die
Trefferfläche des Punkts ist aber breiter als der Halt selbst**, auf dem Telefon um das
Vierfache. Ein *Tipp* in die Halt-Mitte landet deshalb doch auf der Ankunft; nur das *Ziehen*
erreicht die Mitte. Die mit G gewonnene Anfahrbarkeit ist per Finger also nur halb da.

Das Messskript `scripts/messungen/leiste-filmlinear.mjs` kann das nicht sehen: Es ruft
`beginScrub`/`scrub` programmatisch auf und geht damit am DOM-Treffer vorbei.

**Die Lösung liegt in der Gestaltung, nicht in der Trefferfläche:** Wird der Halt selbst zum
Griff (Variante „Kapsel" bzw. der Block der Zeitachsen-Fassung), löst sich das Problem auf,
statt dass zwei Griffe um dieselben Pixel streiten.

---

## 3. Die Richtungsentscheidung: Kurve raus

Vier Fassungen sind durchgespielt (Mockup „Halte"): Kapsel (A), Kapitel-Spur unter der Kurve
(B/B2), aufgehellter Zeitabschnitt (C), Saum am Fuß (D) — und die Fassung ohne Kurve (E).

**Empfehlung: E.** Die Leiste wird Bahn + Fortschritt + Halt-Blöcke. Der Einwand „B kostet
10 px Höhe" hat sich als falsch erwiesen — die Kurve auf 26 px gestaucht, passt beides in
dieselben 44 px (B2). Das eigentliche Argument gegen die Kurve ist inhaltlich (s. §1), nicht
räumlich.

**Das echte Höhenprofil wandert an einen Ort, an dem es wieder über die Strecke steht:** ins
Finale (die Bilanz der Fahrt) und/oder auf die Tour-Karten in Galerie und Profil (dort
entscheidet man, ob man eine Tour anschaut — „bergig oder flach" ist dafür eine echte
Auskunft). Nicht als Overlay über die laufende Fahrt.

---

## 4. Die Ideen im Einzelnen, mit Urteil

Vollständig bebildert in [player-ui-ideen.html](../mockups/player-ui-ideen.html).

### Empfohlen

- **Aktiver Halt mit Füllstand.** Steht der Kopf in einem Halt, wächst der Block, bekommt einen
  hellen Rand und füllt sich anteilig zur verstrichenen Standzeit. Beantwortet die einzige
  Frage, die im Halt aufkommt („läuft das noch?") — heute bewegt sich der Kopf dort so langsam,
  dass es von Stillstand kaum zu unterscheiden ist. Aus Daten, die die Engine schon hat.
- **Nähte bei mehreren Aufnahmen.** Ein Halt trägt `items[]` (Fotos < 120 m werden gruppiert).
  Feine Trennlinien im Block zeigen das. Regel dazu: **Nähte erst ab ~6 px je Abschnitt**, sonst
  ist es auf dem Telefon Grafikrauschen.
- **Filmzeit neben den Knöpfen** (`0:42 / 5:09`). Die Fassung aus der ersten Runde klebte sie an
  die Telemetrie — dort war sie eine vierte Zahl unter drei anderen und wirkte fremd. Neben den
  Knöpfen sitzt sie, wo die Hand ist, und verkürzt die Bahn nicht.
- **Scrub-Vorschau.** Beim Ziehen über einen Halt erscheint dessen Bild mit Titel, Filmzeit und
  Kilometer (bei mehreren Aufnahmen ein Zähler `2/3`), über freier Fahrt nur eine schmale Kachel
  mit Zeit und Ort. **Das ist der bessere Ersatz für „Nächster Halt"** — man sieht, was dort
  ist, statt es angekündigt zu bekommen, und zwar im Moment des Suchens.
  **Pflichtteil: die Randklemmung** — am Anfang und Ende der Bahn klemmt die Kachel am Rand,
  der Kopf wandert darunter weiter.

**Und das löst einen offenen Punkt des Gleichlauf-Konzepts** (§2, „Bekommen die Halte
Miniaturen?"): Das Bedenken war „kostet Kacheln, Platz und eine Telefon-Entscheidung". Beim
Scrubben ist es **eine** Kachel statt neun, nur solange der Finger liegt — dieselbe Wirkung zum
Bruchteil des Preises.

### Offen / abgeraten

- **Zeit an den Bahn-Enden** — klar zugeordnet, kostet aber auf dem Telefon ein Viertel der
  Griff-Fläche. Nein.
- **Zeit am mitlaufenden Kopf** — perfekt zugeordnet und genau deshalb ständig in Bewegung, an
  der Stelle, auf die man während der Fahrt schaut; verdeckt zudem den Halt, auf den man
  zuläuft. Nein als Dauerzustand — als *Scrub*-Zustand ist es richtig und geht in der
  Scrub-Vorschau auf.
- **Verbleibend statt verstrichen** (Tipp schaltet um, `−4:27`) — hübsche Zugabe, kein Mangel
  ohne sie. Später.
- **Telemetrie als eine Zeile** (`0:42 / 5:09 · 16,4 km · 312 m`) — ruhiger, aber „312 m" ohne
  Etikett ist mehrdeutig (Höhe? Rest?). Unentschieden.
- **Modus-Marken in der Bahn** (kleine Symbole an den Wechseln) — **widerspricht einer
  bestehenden Entscheidung** (Fortbewegungsmittel steht bewusst nicht in der Steuerleiste). Der
  Unterschied wäre, dass sie den Wechsel zeigen, *bevor* er kommt. Produktfrage, nicht
  Designfrage — nur mit Absicht bauen.
- **Höhenprofil oben rechts** (Chip mit Sparkline / aufklappbares Panel mit echter Spanne und
  km-Achse) — funktioniert dort besser als in der Leiste, aber: Ein Panel, das man öffnen muss,
  öffnet man einmal, und die freie Ecke ist selbst ein Gewinn fürs Bild. **Warten**, bis es
  jemand vermisst. Wenn der Chip kommt, muss die Höhe **unten aus der Telemetrie verschwinden**
  — sonst steht dieselbe Zahl zweimal im Bild.
- **„Faden" statt Verschwinden** (dünne Restlinie nach dem UI-Rückzug) — widerspricht der
  Entscheidung, dass die Bedienung ganz weggeht. Nein.

---

## 5. Was der Umbau anfassen würde

- [src/ui.ts](../../src/ui.ts) — `buildProfile`/`yAt`/`profileY` entfallen mit der Kurve;
  `buildDots` baut Block statt Punkt+Fläche; `stats` bekommt die Filmzeit als Text;
  `rebuildProfile` (heute nach den DEM-Höhen) entfällt ersatzlos.
- [src/style.css](../../src/style.css) — `.halt-flaeche`, `.photo-dot` (samt `::before`),
  `.progress`, neu: Bahn, Block-Zustände, Vorschau-Kachel.
- [erlebnis.html](../../erlebnis.html) — `#profile-svg` entfällt, `aside#next-stop` entfällt,
  Zeit-Element in der Steuerleiste dazu.
- [src/tour.ts](../../src/tour.ts) — `emitStats` liefert `next` dann nicht mehr (oder nur noch
  für die Vorschau); `filmS`/`gesamtS` als Text.
- **Elevation bleibt**: [elevation.ts](../../src/elevation.ts) füllt weiter `coords[i][2]`, die
  Höhe steht weiter in der Telemetrie — nur die Kurve in der Leiste geht.

Wächter, an die zu denken ist: [test/player-schichtung.test.ts](../../test/player-schichtung.test.ts)
(z-index-Ordnung) und `scripts/messungen/leiste-filmlinear.mjs` (die Abnahme von Paket G darf
nicht kaputtgehen — sie prüft Kopf-Wanderung, Scrub in die Halt-Mitte und die Regie am
Streckenanteil).

---

## 6. Offene Fragen für die Fortsetzung

1. Bleibt die **Höhe** in der Telemetrie, wenn kein Höhenchip kommt? (Ja — sie ist dann die
   einzige Auskunft über das Gelände.)
2. Braucht der Player überhaupt noch **„Distanz"**, wenn die Zeit da ist? Beides sind Auskünfte
   über verschiedene Achsen; die Frage ist, ob der Zuschauer die Strecke wissen will.
3. Wie sieht der Block aus, wenn ein Halt **ein Video** ist statt eines Fotos? Es hat eine
   echte Länge — vielleicht ein anderes Muster im Block.
4. Was zeigt die Vorschau bei einem Video-Halt — ein Standbild welcher Sekunde?
5. Soll die Scrub-Vorschau auch bei **Tastatur-Sprüngen** (J/K/L) kurz aufblitzen?
