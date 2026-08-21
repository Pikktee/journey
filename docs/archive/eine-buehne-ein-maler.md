---
stand: 2026-08-17
status: 'abgearbeitet: der Editor malt, Blitz und Letterbox-Balken sind zurückgebaut, die Karte fährt mit der Leiste'
betrifft:
  - Studio-Editor (src/studio/editor.ts, studio.html)
  - Player (src/card-painter.ts, src/card-layer.ts)
  - geteilte Zahlen (src/card-timing.ts)
  - Wächter (test/card-painter-css.test.ts)
archiviert_aus: concepts
---

# Eine Bühne, ein Maler

**Ziel:** Die Editor-Vorschau der Foto-Karte auf denselben Maler ziehen, den
Player und Film seit dem 2026-08-17 benutzen. Danach den Kamerablitz zurückbauen.
In dieser Reihenfolge, weil er sonst zweimal zurückgebaut wird.

Fortsetzung von
[Die Foto-Karte auf eine Leinwand](die-foto-karte-auf-eine-leinwand.md), das
abgearbeitet ist. Dort liegen Bezugshöhe, Kurven, Puffer-Mechanik und die
Tabelle der geteilten Zahlen; hier geht es nur noch um die dritte Bühne und um
einen Effekt, der zu viel ist.

---

## 1. Warum das nicht schon in Etappe 2 passiert ist

Es war ausgeschlossen, und zwar an zwei Stellen. §3.6 des Karten-Konzepts: „Der
Editor behält seine Mechanik. Er bleibt DOM." §8 führt „Keine geteilte
DOM-Komponente Player↔Editor" unter „Was wir nicht tun". Beide verweisen auf §6A
des [Gleichlauf-Konzepts](konzept_gleichlauf_player_editor.md), und dort steht
die Begründung in einer Tabellenzeile:

> **Zeitmodell der Anzeige.** Player: Ereignis + Wanduhr (`transition`,
> Zustandsmaschine `holdT`/`photoShown`). Editor: Funktion der Kopfposition
> (dauerhaft pausierte Animationen mit negativem Delay). **Warum getrennt:** Ein
> gemeinsames DOM-Bauteil müsste beide Modelle tragen.

**Diese Begründung ist abgelaufen, und man kann den Satz danebenlegen.** Sie
beschreibt den Player von vor E15. Seit E15 ist er ebenfalls eine Funktion der
Kopfposition, seit Etappe 2 ist er ein Maler. Es gibt keine zwei Zeitmodelle
mehr: Der Editor war die Bühne, die es richtig machte, und der Player hat
aufgeholt. Das Argument richtete sich außerdem gegen ein gemeinsames
**DOM-Bauteil**, das beide Modelle tragen müsste. Ein Maler trägt keines, er
bekommt eine Filmsekunde und zeichnet.

Dasselbe §3.6 hat die Frage vorhergesagt: „Ob er später denselben Maler benutzt,
ist eine eigene Frage, und eine leichtere, sobald es einen Maler gibt."

Und der Editor ist der Fall, dem ein Maler am **meisten** hilft, nicht am
wenigsten: Er scrubbt. Pausierte CSS-Animationen mit negativem Delay sind der
Behelf für genau das, was ein Maler von Natur aus tut. Der Kommentar an
`synchronisiereBild` sagt es selbst: Der Ken-Burns-Zug begann beim Einfügen des
`img` bei null, egal wo der Kopf stand.

---

## 2. Der Befund am Code

**Die beiden Seiten sind schon fast dieselbe Funktion.**
`synchronisiereBild(imS, dauerS, tempo)` in
[editor.ts](../../src/studio/editor.ts) und
`UI.synchronisiereKarte(imS, dauerS, tempo)` in [ui.ts](../../src/ui.ts) haben
dieselbe Signatur, rechnen dasselbe `kartenZeiten`, klemmen mit demselben
`videoStandS`, haben denselben Nur-bei-Änderung-Schreibschutz. Der Unterschied
ist der letzte Schritt: Die eine setzt vier CSS-Variablen, die andere ruft
`maleKarte`.

**Die Editor-Karte hat keine Knöpfe.** Nachgesehen: kein Klick-Handler auf
`#foto-einblendung`, im Markup nur Rahmen, Bild, Balken, Titel und Kennzahl.
Damit entfällt dort der aufwendigste Teil der Player-Migration, die
mitgeführten Klickflächen (Falle 5 des Karten-Konzepts), vollständig.

**Eine Leinwand über einer Panel-Fläche ist dort schon üblich.** Das Wetter läuft
im Editor über derselben `.karten-buehne`, und `flaeche()` in
[weather.ts](../../src/weather.ts) unterscheidet dafür `fixed` (Viewport) von
`absolute` (Container). Die Karten-Schicht hat die Unterscheidung übernommen und
braucht nichts Neues.

**Was echt getrennt bleibt**, und das sind dieselben drei Zeilen aus §6A, die
weiter gelten: Maßsystem (zwei Bühnen, zwei Geometrien), Ressourcen-Lebenszyklus
(der Player streamt voraus, der Editor springt im ungeschnittenen Master mit
beiden Schnittkanten im `dataset`) und die Ton-Bedienung (nur im Player). Alle
drei betreffen den AUFRUFER, keine davon den Zeichner.

---

## 3. Etappe 1: der Editor auf den Maler — **gebaut am 2026-08-17**

1. **Ein zweiter Maß-Satz.** `KARTEN_MASSE` in
   [kartenmaler.ts](../../src/card-painter.ts) trägt die drei Lagen der
   Player-Bühne, `EDITOR_MASSE` daneben die kleine Karte auf dem Leuchttisch.
   Welcher gilt, sagt `kartenSatz(buehne)` — und dieselbe Funktion liefert auch
   Lage, Maßstabsgrenzen und die Flugweite. Die ist damit dort angekommen, wo
   der Aufrufer sie braucht, ohne die Tabelle `KARTE_BUEHNE` zu verlassen: Der
   Maler nennt keine Bühne mehr beim Namen, er fragt seinen Satz.
2. **Eine Leinwand über `.karten-buehne`**, unter dem Panel-Beiwerk. Der Schleier
   bleibt dort `::after` mit `backdrop-filter`, genau wie im Player: Auf einer
   Leinwand hat er kein Gegenstück (§4 des Karten-Konzepts).
3. **`synchronisiereBild` ruft `maleKarte`.** Video-Seek, Schnittkanten und
   Lebenszyklus bleiben, wo sie sind.
4. **Löschen:** die Keyframes `feKenburns`, `feEntwickeln`, `feEinFlug`,
   `feAbgang`, `fotoBlitz`, die `.fe-*`-Regeln der Karte, die
   `--fe-*`-Choreografie und den Reduce-Block der Einblendung.

**Die Arbeit liegt in `editor.ts`**, und für die Datei gibt es einen eigenen
Umbauplan ([konzept_editor_zerlegung.md](konzept_editor_zerlegung.md)). Diese
Etappe soll in seiner Faserrichtung landen und nicht dagegen: Sie berührt genau
den Block, den er „Rest" nennt, und macht ihn kleiner.

### Drei Zahlen, die beim Bauen entschieden wurden

**`chrome: 306` ist keine geratene Reserve, sondern die `66cqh` der CSS-Fassung.**
Die Bildhöhe ist `hoehe − chrome × mass`, und weil `mass` im ungeklemmten Bereich
`hoehe / 900` IST, ergibt 306 = 0,34 × 900 genau zwei Drittel — bei JEDER
Bühnenhöhe und nicht nur bei einer. Wer die Zahl anfasst, ändert einen Anteil,
keine Pixel.

**Der Maßstab reicht tiefer** (0,55 statt 0,7). Die Editor-Bühne ist die
Kartenfläche neben der Zeitleiste, oft unter 560 px hoch; mit dem Player-Boden
wäre dort immer geklemmt, und das Bild bekäme statt 66 % nur 55 % der Fläche.

**Die Beschriftung reserviert EINE Zeile.** Im Player steht dort eine
Bildunterschrift, hier „15:58 Uhr · km 12,3" — zwei reservierte Zeilen wären
16 px Papier, das nie beschrieben wird.

### Was beim Abfahren auffiel und keine Vermutung war

**Eine Leinwand zeichnet sich nicht von selbst neu — und im Editor STEHT der
Kopf.** Falle 2 nennt die Panel-Größenänderung; der teurere Fall ist ein anderer.
Ein `img` in der DOM-Karte erschien von selbst, sobald es geladen war. Auf einer
Leinwand nicht: Wer in einen Halt scrubbte, sah die Karte fliegen, entwickeln und
liegen bleiben — mit LEEREM Bildfeld, bis irgendeine spätere Kopfbewegung ein
neues Bild anstieß. Im Player fällt das nie auf, weil dort der Film läuft und
jeder Frame ohnehin zeichnet. `zeigeFoto` hängt deshalb an `load` (Bild) und an
`loadeddata`/`seeked` (Video) einen Rückruf, der `synchronisiereFoto` noch einmal
ruft. Dieselbe Familie wie §8A des Gleichlauf-Konzepts: *Was nicht am Takt hängt,
muss ausdrücklich mitgehen.*

**Abgenommen** an der Koh-Pha-ngan- und der Stockholm-Tour (1440 × 900,
angemeldetes Profil): Auftritt, Mitte und Abgang eines Halts, das Räumen beim
Verlassen, ein Hochformat. Der VIDEO-Halt ist ungeprüft geblieben — keine der
lokalen Touren hat eine Videoaufnahme; geändert hat sich an seinem Weg nur die
Zeichenquelle, Seek und Ton-Hülle stehen unverändert.

## 4. Etappe 2: der Blitz — **gebaut am 2026-08-17**

**Gemessen am 2026-08-17.** Mit erzwungenem Flush (`getImageData`, ohne den misst
man nur das Einreihen der Canvas-Befehle und bekommt 0,04 ms statt 2), Leinwand
2981 × 1677:

| | Median | p95 |
|---|---|---|
| Kartenbild mit Blitz | 2,0 ms | 8,9 ms |
| Kartenbild ohne Blitz | 1,1 ms | 4,6 ms |
| nur der Verlauf | 1,5 ms | 3,8 ms |

Er verdoppelt die Kosten eines Kartenbildes und ist die teuerste einzelne
Operation darin. Am laufenden Player ist davon nichts zu sehen (13,93 ms
Frame-Abstand im Blitzfenster gegen 14,15 ms danach), weil der Halt Luft hat. Auf
einem schwachen Gerät wäre er das Erste, was wehtut.

**Der Grund ist trotzdem nicht die Leistung, sondern eine Beobachtung am Bild:**
Auf der Blitzspitze ist das Foto auch OHNE Blitz schon ein heller Schleier. Die
Karte steht dort bei 7 % Deckkraft, und das „Entwickeln" beginnt bei
`brightness(1.45)`. Der Blitz legt eine zweite weiße Schicht auf eine, die schon
da ist. Es sind zwei Gesten für dieselbe Sache im selben Moment.

Drei Gründe, die unabhängig davon gelten:

- **Die Metapher ist verkehrt.** Ein Blitz sagt „hier wird gerade fotografiert".
  Diese Fotos sind längst aufgenommen, sie werden gezeigt. Das „Entwickeln" ist
  die richtige Metapher, und es sitzt auf dem Foto statt über der Szene.
- **Er strobt.** Er hängt am Klip, nicht am Halt, also feuert er bei jedem
  Bildwechsel innerhalb eines Halts neu.
- **Der Auftritt ist ohnehin voll:** Blende, Flug mit Überschwingen, Entwickeln,
  gestaffelte Beschriftung. Der Blitz ist der vierte gleichzeitige Effekt.

**Was an seine Stelle tritt.** Der Halt wird dadurch markiert, dass die Umgebung
zurücktritt, nicht dass etwas aufblitzt. Dafür wandert der Schleier von der
Wanduhr auf die Filmzeit: Er schaltet heute per Klasse mit einer
0,8-s-Transition, an der Filmzeit käme er über den Flug hoch und ginge mit dem
Abgang wieder weg, in beide Richtungen und beim Scrubben. Das ist dieselbe Regel
wie überall sonst im Film, und sie fehlt hier als letzte.

**Gelöscht:** acht Einträge aus `KARTE` (`blitzDauerS`, `blitzSpitzeBei`,
`blitzSpitze`, `blitzMitteX/Y`, `blitzInnen`, `blitzAussen`, `blitzHalt*`),
`blitzDeckkraft` und der Radialverlauf im Maler, die Phase `blitz`, die Farbe
`KARTEN_FARBEN.blitz` und der Blitz-Block des Wächters. `.foto-flash` und
`.photo-flash` waren mit Etappe 1 schon weg — ein Element ohne Regeln stehen zu
lassen, um es in Etappe 2 zu löschen, wäre die schlechtere Zwischenstufe gewesen.
An ihrer Stelle steht eine Prüfung, die es vorher nicht gab: dass KEINE der acht
Zahlen und kein `createRadialGradient` wieder auftaucht.

### Wie der Schleier an die Filmzeit kam

`kartenschicht.ts` schreibt pro Frame `--schleier-sicht` — die Deckkraft der
Karte, also genau `phasen.sicht`. Drei Dinge, die man dabei kippt:

- **Eine CUSTOM PROPERTY und kein `style.opacity`.** Im Editor ist der Schleier
  ein `::after`, und ein Pseudo-Element nimmt keine Inline-Stile; seinen Host
  kann man dagegen beschriften. Beide Bühnen benutzen deshalb denselben Namen,
  der Player auf dem Element selbst, der Editor auf der Bühne darüber.
- **Die Klasse bleibt — sie schaltet nur noch den FILTER.** Ein
  bildschirmfüllender `backdrop-filter`, der dauernd stünde, wäre auf einem
  schwachen Gerät der teuerste Posten der Seite. Dass er beim Umschalten
  springt, sieht niemand: Dort steht die Karte noch bei Deckkraft 0.
- **Die Transition muss WEG, nicht kürzer werden.** Sie liefe sonst über die
  Werte, die die Filmzeit setzt — beim Scrubben wäre der Schleier eine halbe
  Sekunde hinter der Karte, und genau das war der Defekt.

**Gemessen** (angemeldetes Profil, 1440 × 900): Editor-Bühne im Auftritt
`--schleier-sicht` 0,087 bei einer Karte von 8,7 % Deckkraft, in der Haltmitte
1,000, nach dem Verlassen 0,000; Player ebenso (0,192 im Auftritt, 1,000 in der
Mitte). Am Bild ist im früheren Blitzfenster nichts Weißes mehr — die Karte ist
dort ein Hauch Papier über einer Karte, die man noch lesen kann.

### Nachtrag am selben Tag: die Letterbox-Balken auch

Der Blitz war nicht das einzige, was den Halt ankündigte. `.cine` legte oben und
unten je 9vh Schwarz über das Bild — auf 1080p zusammen 194 px. Sie sind
ersatzlos entfallen, aus demselben Grund: Sie stammen aus der Zeit, als der Halt
fast nichts hatte, was ihn markierte. Inzwischen tut das der Schleier, und er tut
es besser — er lässt die Szene stehen, statt ein Fünftel des Bildes zuzudecken.
Teuer waren sie genau dort, wo etwas liegt: unten die Steuerleiste, oben der Weg
hinaus. `body.cinema` bleibt und schaltet nur noch den `backdrop-filter`.

### Und die Karte SPRINGT nicht mehr, wenn die Leiste kommt

`bedienungSteht: boolean` ist ein `bedienung: number` von 0 bis 1 geworden.
Als Schalter sprang die Karte zwischen zwei Größen, sobald sich die Maus bewegte
oder die UI sich nach 3,2 s zurückzog: ein Umsprung mitten im stehenden Bild, den
nichts erklärt. Über den Anteil wird daraus eine Bewegung — die Leiste kommt, die
Karte macht ihr Platz. Drei Dinge tragen das:

- **Dauer und Kurve sind DIE DER LEISTE** (0,5 s, `ease` — dieselben, mit denen
  `.dock`, `.zurueck` und `.next-stop` blenden). Damit ist es eine Geste und
  nicht zwei Bewegungen, die zufällig zugleich stattfinden. Eine exponentielle
  Glättung stand hier zuerst und war asymptotisch: Sie sah nach 0,33 s fertig aus
  und kroch dann noch ein Drittel einer Sekunde nach.
- **Die Geometrie muss über dem Anteil MONOTON sein**, sonst wäre die gefahrene
  Größe ein Ruckeln statt eines Zugs. Der Maler mischt deshalb linear zwischen
  `chrome` und `chromeBedienung`; die Kurve gehört der Schicht.
- **Gezeichnet wird nur, wenn es im laufenden Bild noch niemand getan hat.** Läuft
  der Film, ruft er ohnehin jeden Frame `male()`. Steht er — Halt, Pause —, ist
  diese Schleife die einzige, die zeichnet: ohne sie bliebe die Karte auf ihrer
  alten Größe, während die Leiste kommt. Das ist Falle 2 zum dritten Mal.

Und die Karte ist bei stehender Leiste KLEINER geworden und sitzt höher
(`chromeBedienung` 335 → 380, `hubBedienung` 48 → 64): Auf 1080p blieben vorher
31 px zwischen Kartenkante und Leiste bei 94 px oben, jetzt sind es 76 unten und
75 oben. Gemessen, nicht geschätzt; `schmal` und `quer` blieben, wie sie waren
(auf dem Telefon waren es nie zu wenig — 129 px). Beim Erscheinen der Leiste
durchläuft die Karte 18 verschiedene Höhen in rund einer halben Sekunde.

### Und ein Fehler, der die ganze Zeit dalag: die Karte am Scrub

Wer bei einem Foto anhielt und dann scrubbte, behielt die Karte — egal wohin er
zog (gemessen: `filmS` 88 → 232, `s` 8974 → 26576, dieselbe Aufnahme). Sie hing
an einer PHASEN-FLANKE: `update` räumte sie nur, wenn die vorige Phase `photo`
oder `moment` war. `beginScrub` schreibt aber `phase = 'ride'`, bevor der erste
Kopfschritt sie lesen kann — die Flanke war weg, bevor sie jemand sah. Geheilt
hat es sich nur, wenn man zufällig durch einen ZWEITEN Halt zog, denn der setzte
die Phase neu; daher „meistens".

Das ist E13 an einer Stelle, die davon nichts mitbekommen hat: *Ein Halt ist ein
Zustand der Kurve, kein getriggerter Wechsel.* `raeumeKarte()` steht jetzt
unbedingt da, wo kein Halt ist, und nicht mehr in der Flanke; die Flanke trägt
nur noch, was wirklich eine ist — das weiche Anziehen der Kamera (`glide`).
Gegenprobe: mit der einen Zeile heraus zeigt die Sonde an derselben Stelle wieder
`karteLiegt: true`.

Nicht als Test abgesichert: `update()` braucht eine echte MapLibre-Karte und eine
gebaute Route, ein Unit-Test dafür wäre mehr Attrappe als Prüfung. Ein Regex auf
den Rumpf hielte die Regel nicht zusammen (dieselbe Begründung wie bei
`reihenfolgeImHalt` in einblendung.ts). Abgenommen ist er am laufenden Player.

---

## 4a. Was der Editor NICHT bekommen hat: eine Textkopie

Der Player trägt Titel und Bildunterschrift weiter im Dokument
(`figcaption.sr-only`) — Falle 1 des Karten-Konzepts, und dort ist sie Pflicht:
Eine Leinwand hat keinen Text, und die Karte IST in diesem Moment der ganze
Inhalt der Seite. Der Editor hat die Kopie ausdrücklich nicht bekommen, und das
ist eine Entscheidung, keine Lücke.

Seine Karte ist die Vorschau eines Werkzeugs, und jede Angabe darauf steht
dauerhaft als Text daneben: der Titel im Klip der Szenen-Bahn, Uhrzeit und
Kilometer im Pult der Kopfleiste. Eine versteckte Kopie wäre dieselbe Auskunft
ein zweites Mal, in einer Oberfläche, die ohnehin dicht ist — und sie änderte
sich bei jedem Kopfschritt. Der Wächter hält deshalb die PLAYER-Regel fest
(sr-only-Block samt seiner drei Felder) und nennt den Editor als benannte
Ausnahme: Wer das umdreht, sieht, dass hier eine Entscheidung stand.

Das gilt ausdrücklich nur, solange die Angaben daneben stehen. Verlöre die
Szenen-Bahn ihre Titel oder das Pult seine Zahlen, wäre die Karte die einzige
Quelle und bräuchte die Kopie.

---

## 5. Was der Wächter danach noch tut — **umgestellt**

Sein CSS-lesender Teil war nur da, um `studio.html` zu überwachen. Mit einem
Maler kann dort nichts mehr auseinanderlaufen, also ist er weg. Geblieben ist,
was schon vorher der stärkere Teil war, und dazugekommen ist einer:

- **`KARTE` gegen die RECHNUNG des Malers.** Ein Regex auf CSS prüft, welche
  Zeichenkette dasteht; `kartenPhasen` prüft, was herauskommt.
- **Die ganze Tabelle statt einzelner Werte.** Weil es keine zweite Bühne mehr
  gibt, an der ein umgangener Wert auffiele, verlangt der Wächter, dass der Maler
  jeden Eintrag aus `KARTE` auch LIEST. Die Liste kommt aus `Object.keys(KARTE)`
  und ist NICHT von Hand gepflegt — eine handgeschriebene stand hier zuerst und
  lief sofort auseinander (19 Namen für 23 Einträge); durch sie fiel genau das,
  was neu dazukam. Vier Werte sind benannte Ausnahmen mit Grund: die drei
  Schleier-Filterwerte (DOM, im Schleier-Test geprüft) und der
  Ken-Burns-Rückfall (in `einblendung.ts` selbst gelesen). Eine Ausnahme, die
  keinen Eintrag mehr hat, meldet der Wächter ebenfalls.
- **Die Totenliste, jetzt für beide Bühnen.** Eine vergessene Keyframe-Regel ist
  kein Fehler, den man sieht — sie liefe auf einem Element, das es nicht mehr
  gibt, bis jemand es wieder anlegt.
- **NEU: dass die zwei Bühnen-Sätze nur GEOMETRIE sind.** Die Lage wird im
  Editor gesetzt und nicht abgeleitet, seine Karte hat keine Knöpfe, sein
  Maßstab reicht tiefer, sein Bild nimmt zwei Drittel der Höhe ein. Das ist die
  Regel, die den Umbau trägt: Ohne sie wäre der zweite Satz bloß eine zweite
  Fassung mit anderem Namen.

Der EINE Teil der Karte, der weiterhin zweimal als CSS dasteht, ist der
Schleier — und er wird weiter Text gegen Text verglichen (`style.css` gegen
`studio.html`), weil er auf einer Leinwand kein Gegenstück hat.

---

## 6. Fallen

Die Fallenliste des [Karten-Konzepts](die-foto-karte-auf-eine-leinwand.md) gilt
vollständig weiter. Sie ist an einer echten Leinwand abgearbeitet und keine
Vermutung mehr. Vier davon sind hier scharf, und eine ist neu:

1. **`inset: 0` spannt eine Leinwand nicht auf.** Ein `canvas` ist ein ersetztes
   Element, ohne `width: 100%; height: 100%` liegt es in seiner PIXELgröße über
   der Seite. Bei `devicePixelRatio` 2 saß die Karte dadurch halb außerhalb, bei
   Ratio 1 fiel es nicht auf. Die zweite Schicht macht denselben Fehler ein
   zweites Mal, wenn niemand hinsieht.
2. **Eine Leinwand zeichnet sich nicht von selbst neu.** Im Editor zeichnet zwar
   jeder Kopfschritt, aber eine Panel-Größenänderung ist kein Kopfschritt, und
   `canvas.width` zu schreiben LÖSCHT die Fläche.
3. **`ctx.font` scheitert leise.** `document.fonts.ready` abwarten. **Diese Falle
   stand seit Etappe 2 der Kartenleinwand in der Liste und war NIE umgesetzt** —
   im ganzen Repo kam `document.fonts` nicht vor; aufgefallen ist es erst bei
   einer Gegenprüfung nach dieser Etappe. Heikel ist sie hier, weil Titel,
   Unterschrift und Pillen GEPUFFERT werden (Falle 9) und ihr Schlüssel den
   Schriftzustand nicht kennt: Einmal mit der Rückfallschrift gebacken, blieb es
   bis zum nächsten `raeumeKartenPuffer` dabei, also bis zum nächsten Resize —
   und im FILM für immer in der Datei. `kartenschicht.ts` verwirft die Puffer
   jetzt, sobald `document.fonts.ready` auflöst, und zeichnet einmal neu; bis
   dahin meldet `bereit()` `false`, sodass der Export wartet (dieselbe Bremse,
   die er für einen noch suchenden Video-Frame hat). Ohne `document.fonts` gilt
   sofort „bereit": Eine Zusicherung, die es nicht gibt, darf den Lauf nicht
   anhalten.
4. **`prefers-reduced-motion` als Schalter im Aufruf**, nie im Maler gelesen.
5. **NEU: Die Lage darf im Editor nicht abgeleitet werden.** Der Maler bestimmt
   sie heute aus Breite und Höhe (`kartenLage`), und für eine Vollbild-Bühne ist
   das richtig. Eine Editor-Fläche von etwa 700 × 500 fällt damit in `quer`
   (breiter als hoch und höchstens 560 hoch) und bekäme das Layout „Bild links,
   Text rechts" eines liegenden Telefons. Die Lage gehört deshalb zum
   Bühnen-Satz und wird gesetzt. Das nimmt eine Aussage aus §5 des
   Karten-Konzepts zurück („ein vierter Aufruf-Schalter wäre eine zweite
   Wahrheit"): Sie stimmte für eine Bühne, und mit der zweiten wird die Lage
   Teil ihrer Beschreibung.

---

## 7. Abnahme

Gemessen wurde nicht mit einem erweiterten
[kartenleinwand.mjs](../../scripts/messungen/kartenleinwand.mjs), sondern am
laufenden Editor und Player im angemeldeten Profil (1440 × 900): Auftritt, Mitte
und Abgang eines Halts, das Räumen beim Verlassen, ein Hochformat, dazu die
Zahlen des Schleiers auf beiden Bühnen (s. §3 und §4). Der Grund für den
Verzicht auf den Bildvergleich steht schon in der ursprünglichen Fassung dieses
Abschnitts: Pixelgleichheit ist hier nicht das Ziel, die Geometrien sind
verschieden und sollen es sein. Was gleich sein MUSS, sind die geteilten Zahlen —
und die hält seit dieser Etappe der Wächter fest, Wert für Wert und nicht
stichprobenweise am Bild (§5).

**Ungeprüft geblieben ist der VIDEO-Halt** im Editor: Keine der vier lokalen
Touren hat eine Videoaufnahme. Geändert hat sich an seinem Weg nur die
Zeichenquelle; Seek, Schnittkanten und Ton-Hülle stehen unverändert.

Die Zahl, die den Rückbau des Blitzes begleitet, ist die aus §4: Ein Kartenbild
kostet danach 1,1 statt 2,0 ms im Median.

---

## 8. Was offen bleibt

1. **Die Schleier-Messung** (§5A des Karten-Konzepts): Auf dem M4 kostet der
   Vollbild-`backdrop-filter` im Halt nichts messbares, auf einem schwachen Gerät
   könnte er der teuerste Posten sein. Er steht jetzt auf beiden Bühnen unter
   derselben Klasse und hängt an derselben Custom Property — wenn er fällt,
   fällt er an einer Stelle für alle.
2. **Der Video-Halt im Editor** (s. §7), sobald es eine Tour mit Video gibt.
3. **`editor.ts` ist immer noch über 7 000 Zeilen.** Diese Etappe hat den Block
   verkleinert, den [konzept_editor_zerlegung.md](konzept_editor_zerlegung.md)
   „Rest" nennt; der Umbauplan selbst steht weiter aus.
