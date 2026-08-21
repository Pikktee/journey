---
name: mockup-anlegen
description: HTML-Mockups für Maptale zeichnen — wohin sie gehören, welchen Kopf sie tragen, was sie zeigen müssen und wie sie im Doku-Viewer erscheinen. Nutzen, wenn ein Mockup, ein Oberflächen-Entwurf oder eine neue Runde eines bestehenden Entwurfs entsteht, überarbeitet oder archiviert wird.
---

# Ein Mockup anlegen

Ein Mockup ist eine **einzelne HTML-Datei in `docs/mockups/`**, die zeigt, wie
etwas aussehen und sich anfühlen soll. Es ist kein Screenshot und kein Feature:
Es soll eine Entscheidung vorbereiten.

Das Wort ist festgelegt: **Mockup**, nicht Prototyp und nicht Entwurf.
„Prototyp" verspricht etwas Lauffähiges, „Entwurf" ist im Viewer schon ein
Ampel-Zustand.

## 1. Datei und Name

`docs/mockups/<bereich>-<sache>.html`, kebab-case. Das Präfix bestimmt den
Systemteil: `app-` (Android), `player-`, `studio-`, `live-` (öffentliche
Seiten). Bilder liegen daneben in `docs/mockups/landing|titelbilder|tourbilder/`
und werden relativ geladen; ungenutzte Dateien meldet der Bau.

## 2. Der Kopf

```html
<title>Mockup — Player-Startscreen</title>
<meta name="maptale:stand" content="2026-08-18">
<meta name="maptale:status" content="Entwurf, nichts gebaut">
<meta name="maptale:systemteile" content="Player">
<meta name="maptale:gehoert_zu" content="concepts/konzept_x.md">
```

- Der **Titel** trägt „Mockup — " als Präfix; der Viewer schneidet es weg. Ohne
  Titel steht der Dateiname auf der Kachel.
- **`stand`** ist ein ISO-Datum: Auf welchem Stand ist der Inhalt? Von Hand
  gepflegt. Das Dateidatum kommt aus Git und steht getrennt daneben — eine
  Tippfehler-Korrektur ändert es, den Stand nicht.
- **`status`** ist ein Satz: Was ist aus dem Vorschlag geworden? Er treibt die
  Ampel über Schlüsselwörter (`Entwurf|nichts gebaut|verworfen|vertagt` →
  Entwurf, `Etappe|teilweise|Paket|offen` → Unterwegs, `gebaut|live|erledigt` →
  Gebaut). Ohne Satz keine Ampel, und das ist besser als ein erfundener.
- **`gehoert_zu`** mit UNTERSTRICH (der Leser akzeptiert nur `[a-z_]`), und nur
  nötig, wenn das Konzept das Mockup nicht selbst verlinkt.

Heute tragen 2 von 17 Mockups diesen Kopf. Die anderen 15 stehen im Viewer ohne
Sachstand da, das ist der teuerste Fehler dieser Liste.

## 3. Was ein Mockup zeigen muss

- **Ganz oben: vorher und nachher, nebeneinander.** Links der heutige Zustand,
  rechts der empfohlene neue. Wer das Mockup öffnet, sieht damit in einer
  Sekunde, worum es geht und was sich ändert. Der Rest der Seite begründet
  danach. Gibt es kein „vorher" (etwas Neues), steht links, was heute an dieser
  Stelle passiert oder fehlt.
- **Echte Inhalte, kein Lorem.** Echte Tournamen, echte Kilometer, der längste
  Titel, den es wirklich gibt. Blindtext versteckt genau die Layoutfehler,
  wegen derer man zeichnet.
- **Die drei harten Fälle mitzeichnen:** leer, sehr lang, Fehler. Sie kosten im
  Bau die meiste Zeit und fehlen in Entwürfen fast immer.
- **Varianten nebeneinander**, nicht nacheinander. Untereinander lässt sich
  vergleichen; ein Karussell zwingt zum Erinnern.
- **Zu jeder Variantengruppe gehört eine EMPFEHLUNG.** Zwei gleichwertige
  Vorschläge nebeneinander verschieben die Entscheidung nur. Also sichtbar
  markieren, welche gemeint ist, mit einem Satz warum — und was gegen sie
  spricht, gehört dazu.
- **Erklärungstexte kurz.** Ein Vorspann von zwei Sätzen, je Kapitel einer.
  **Kein langer Gedankenstrich**; Punkt, Komma oder Doppelpunkt.

## 4. Wie es sich anfühlen muss

**So nah am Endzustand wie möglich.** Ein Mockup, das nur ein Standbild ist,
beantwortet die Frage nicht, wegen der man es baut.

- Hover- und Fokus-Zustände auf allem, was im Produkt anfassbar wäre.
- Klickbare Wege innerhalb der Datei (Reiter, Auswahl, Aufklapper) — mit ein
  paar Zeilen Vanilla-JS, ohne Framework.
- Übergänge dort, wo das Produkt sie hätte.
- Animation nur, wenn sie der Gegenstand ist. Eine Choreografie, die niemand
  gefragt hat, macht die Datei schwer und den Entwurf unlesbar.

## 5. Aussehen

- **[`DESIGN.md`](../../../DESIGN.md) gilt**, wie im Produkt: Outfit, die
  Farbrollen, Radien, `font-variant-numeric: tabular-nums` bei Zahlen, kein
  Mono und kein Versalien-Sperrsatz.
- **Tokens kopieren, nicht verlinken.** Ein `<link>` auf `src/base.css` ließe
  ein archiviertes Mockup still mitwandern und in zwei Jahren die heutige Marke
  zeigen. Ein Mockup ist ein eingefrorener Stand.
- **Eine Datei, keine Abhängigkeiten, kein Build.** Sie muss sich aus dem
  Finder heraus öffnen lassen.
- Die Schrift kommt von Google Fonts (`Outfit`), mit ehrlicher Rückfallkette
  `Outfit, system-ui, sans-serif`: Ohne Netz muss das Mockup benutzbar
  aussehen. Die lokale Kopie des Viewers liegt in `docs/_site/`, und das ist
  nicht eingecheckt.
- **Unten rechts ist besetzt.** Der Dev-Server hängt beim Ausliefern die
  Mockup-Leiste dorthin (fest positioniert, eigener Namensraum). Wer dort etwas
  Wichtiges platziert, verdeckt es sich selbst.

## 6. Das Konzept dazu

Die Beziehung entsteht im **Konzept**: Wer dort die HTML-Datei verlinkt, stellt
sie her. Fehlt sie, trägt die Kachel die Marke „ohne Konzept".

Drei Fälle, und nur der erste braucht ein neues Dokument:

| Lage | Was anlegen |
| --- | --- |
| Das Mockup bereitet eine Entscheidung vor | **Mini-Konzept** in `docs/concepts/`: worum es geht, was der Entwurf vorschlägt, welche Frage offen ist. Mit `stand` und `status`. |
| Es zeichnet etwas längst Beschlossenes | Nur den Link im **vorhandenen** Konzept |
| Es wurde gezeichnet und direkt gebaut | Nichts. Bei 6 von 17 ist das heute so. |

Ein Stummel-Konzept **ohne** `status` und `stand` macht die Doku messbar
unordentlicher: Es erscheint sofort unter „Ohne Phase" und in der Bau-Meldung.

**Auf die Roadmap kommt das Konzept, nie das Mockup.** Geplant wird eine
Entscheidung; das Mockup ist eine Antwort darin. Der Dienst weist `.html`
ausdrücklich zurück.

## 7. Eine neue Runde

Neue Runde = **neue Datei** (`…-v2`, `…-final`), denn die Abfolge ist der Wert.
Im Viewer steht trotzdem nur **eine**: Die alte Runde wandert im selben Zug nach
`docs/archive/mockups/` — über den Viewer (Kachel-Menü „Archivieren"), weil er
die Verweise nachzieht. Sonst stehen drei Kacheln nebeneinander, die dasselbe
zeigen, und niemand weiß, welche gilt.

**Verloren geht dabei nichts:** Die aktuelle Runde trägt in ihrem Kopf eine
Zeile mit den früheren, als Links ins Archiv.

```html
<nav class="runden">
  <span>Runde 3</span>
  <a href="../archive/mockups/player-ui-ideen.html">Runde 1: Ideen</a>
  <a href="../archive/mockups/player-steuerleiste.html">Runde 2: was übrig bleibt</a>
</nav>
```

Der Pfad ist relativ und trägt in beiden Welten: im Dev-Server unter
`/doku/mockups/…` und beim Doppelklick im Finder.

## 8. Danach

```bash
npm run docs
npm test
```

Der Bau meldet, was er nicht erraten konnte: Mockups ohne Konzept, Bilder, die
kein Mockup nutzt, Mockups in `roadmap.md`.

## Vorlage

```html
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Mockup — <Was es zeigt></title>
<meta name="maptale:stand" content="JJJJ-MM-TT">
<meta name="maptale:status" content="Entwurf, nichts gebaut">
<meta name="maptale:systemteile" content="Player">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* Tokens aus DESIGN.md, kopiert und damit eingefroren. */
  :root {
    --akzent: #f59e0b;
    --akzent-2: #ff6f52;
    --auf-akzent: #1a1206;
    --text: #f2ede3;
    --muted: rgba(242, 237, 227, 0.64);
    --faint: rgba(242, 237, 227, 0.42);
    --glas-rand: rgba(255, 255, 255, 0.1);
    --grund: #06080c;
    --flaeche: #111722;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 46px 40px 120px;
    background: var(--grund); color: var(--text);
    font-family: Outfit, system-ui, sans-serif; font-weight: 300;
    font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  }
  h1 { margin: 0 0 8px; font-size: 34px; font-weight: 700; letter-spacing: -0.015em; }
  .lead { max-width: 74ch; margin: 0 0 20px; color: var(--muted); font-size: 15.5px; line-height: 1.62; }
  h2.kapitel { margin: 0 0 5px; padding-top: 52px; color: var(--akzent);
               font-size: 12px; font-weight: 500; }
  /* Die Empfehlung ist sichtbar ausgezeichnet, nicht nur beschrieben. */
  .empfehlung { border-color: color-mix(in srgb, var(--akzent) 55%, transparent); }
</style>
</head>
<body>
  <h1><Was es zeigt></h1>
  <p class="lead">Ein Satz: welche Frage steht zur Entscheidung.</p>

  <!-- Zuerst der Vergleich: links heute, rechts der Vorschlag. -->
  <section class="vergleich">
    <figure><figcaption>Heute</figcaption><!-- Ist-Zustand --></figure>
    <figure class="empfehlung"><figcaption>Vorschlag</figcaption><!-- neue Fassung --></figure>
  </section>

  <!-- Danach die Kapitel: je Frage die Varianten nebeneinander,
       eine davon mit .empfehlung und einem Satz warum. -->
</body>
</html>
```

## Sprache

Deutsch, wie im ganzen Repo. Kein langer Gedankenstrich in neuen Texten, und
keines der zwei verworfenen Wörter („Formular", „wie das Wetter steht").
