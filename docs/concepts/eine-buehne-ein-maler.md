---
stand: 2026-08-17
status: Entwurf, nichts gebaut
betrifft:
  - Studio-Editor (src/studio/editor.ts, studio.html)
  - Player (src/kartenmaler.ts, src/kartenschicht.ts)
  - geteilte Zahlen (src/einblendung.ts)
  - Wächter (test/einblendung-css.test.ts)
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

## 3. Etappe 1: der Editor auf den Maler

1. **Ein zweiter Maß-Satz.** `KARTEN_MASSE` in
   [kartenmaler.ts](../../src/kartenmaler.ts) trägt heute die drei Lagen der
   Player-Bühne. Der Editor bekommt seine eigene: kleine Karte auf einem
   Leuchttisch. Die Flugweite, heute die einzige benannte Variante in
   `KARTE_BUEHNE`, wandert vermutlich dorthin. Beim Bauen entscheiden, nicht
   vorher.
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

## 4. Etappe 2: der Blitz

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

**Löschen:** acht Einträge aus `KARTE` (`blitzDauerS`, `blitzSpitzeBei`,
`blitzSpitze`, `blitzMitteX/Y`, `blitzInnen`, `blitzAussen`, `blitzHalt*`), den
Blitz-Block des Wächters, `.foto-flash` in `studio.html` und den Rest von
`.photo-flash`.

---

## 5. Was der Wächter danach noch tut

Sein CSS-lesender Teil ist nur da, um `studio.html` zu überwachen. Mit einem
Maler kann nichts mehr auseinanderlaufen, dort bleibt also nichts zu bewachen.
Was bleibt, ist der Teil, der heute schon der stärkere ist: `KARTE` gegen die
RECHNUNG des Malers, und die Prüfung, dass die alten Keyframes nicht wieder
auftauchen. `KARTE_BUEHNE` wird, was es sein soll: benannte Geometrie-Varianten
statt derselbe Effekt zweimal geschrieben.

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
3. **`ctx.font` scheitert leise.** `document.fonts.ready` abwarten.
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

[scripts/messungen/kartenleinwand.mjs](../../scripts/messungen/kartenleinwand.mjs)
ist die Vorlage und wird erweitert: dieselbe Aufnahme, dieselbe Filmsekunde,
Editor-Bühne gegen Player-Bühne. Geprüft wird nicht Pixelgleichheit (die
Geometrien sind verschieden und sollen es sein), sondern dass jede geteilte Zahl
auf beiden Bühnen dieselbe ist: Ken-Burns-Stand, Entwickeln-Fortschritt,
Balkenfüllung, Deckkraft, Winkel.

Für Etappe 2 gibt es nichts zu messen, dort wird gelöscht. Die Zahl, die den
Rückbau begleitet, ist die aus §4: Ein Kartenbild kostet danach 1,1 statt 2,0 ms.

---

## 8. Auftrag für den nächsten Kontext

1. **Etappe 1 zuerst, und das ist der Kern des Vorschlags.** Solange es zwei
   Bühnen sind, ist jeder Rückbau zwei Änderungen. Der Blitz ist der erste
   Nutznießer und zugleich der Beleg, dass sich die Migration bezahlt.
2. **Nicht anfassen, ohne in die Tabelle zu sehen.** `KARTE` und `KARTE_BUEHNE`
   in [einblendung.ts](../../src/einblendung.ts) sind die geteilten Zahlen, die
   Geometrie je Bühne steht in `KARTEN_MASSE`.
3. **Die Schleier-Messung aus dem Karten-Konzept kommt mit** (§5A dort): Auf dem
   M4 kostet der Vollbild-`backdrop-filter` im Halt nichts messbares, auf einem
   schwachen Gerät könnte er der teuerste Posten sein. Wenn er fällt, fällt er
   auf allen Bühnen zugleich.
4. **Frischer Kontext.** Etappe 1 fasst eine Datei mit über 7 000 Zeilen an.
