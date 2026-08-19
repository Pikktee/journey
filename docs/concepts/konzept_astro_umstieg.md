---
stand: 2026-08-19
status: Entwurf, nichts gebaut
betrifft:
  - vite.config.js
  - index.html
  - galerie.html
  - profil.html
  - konto.html
  - admin.html
  - studio.html
  - erlebnis.html
  - impressum.html
  - datenschutz.html
  - feedback.html
  - src/app-nav.ts
  - src/routen.ts
  - server/src/seiten.ts
  - scripts/docs-viewer/
icon: module
---

# Konzept: Umstieg auf Astro

**Ziel:** Layouts. Die Kopf- und Fußzeile stehen einmal an einer Stelle statt
fünfmal ausgeschrieben in HTML-Dateien. Dazu Content Collections und
Server-Routen im eigenen Fastify, und eine Grundlage, auf der Mehrsprachigkeit
danach wenig zusätzliche Mechanik braucht.

## Warum jetzt

**Der Fall ruht auf Layouts, Content Collections und SSR im eigenen Fastify.**
Mehrsprachigkeit trägt bei, ist aber nicht der Auslöser. Eine frühere Fassung
dieses Papiers hat das anders behauptet; die Prüfung der Astro-Dokumentation am
2026-08-19 hat die Behauptung nicht gehalten (s. den nächsten Abschnitt). Wer
das Konzept mit „wir brauchen Astro wegen i18n" zusammenfasst, fasst es falsch
zusammen.

Was aber unabhängig davon gilt: **Der Umstieg gehört VOR die erste Zeile
i18n-Code.** Ob mit Astro oder mit einer leichteren Lösung, die Übersetzung
zweimal zu bauen wäre die teuerste aller Varianten.

Der Schmerz von heute ist der andere Teil der Begründung. Der Header liegt ausgeschrieben in jeder
Datei:

```
galerie.html   1619 Zeichen        profil.html   1605
konto.html     1605                admin.html    1336
studio.html    3159
```

`appHeaderHtml()` in [app-nav.ts](../../src/app-nav.ts) ist die kanonische
Fassung im Code, ein Wächter hält die Dateien damit deckungsgleich. Das Markup
steht statisch in den Seiten, damit es im ersten Bildaufbau da ist, und das ist
richtig so. Aber es ist wieder **Test statt Architektur**: Die Vorlage existiert,
sie kann nur nicht zur Bauzeit ausgeführt werden. Ein Layout erzeugt sie,
statt sie zu vergleichen, und der Wächter wird überflüssig.

## Was Astros i18n wirklich leistet, und was nicht

Geprüft an der Dokumentation, weil die Kurzformel „i18n eingebaut" mehr
verspricht, als eingelöst wird:

| liefert Astro | liefert Astro **nicht** |
| --- | --- |
| Sprache aus der URL (`Astro.currentLocale`) | die Übersetzungen selbst, `ui.ts` schreibt man |
| `prefixDefaultLocale`, `redirectToDefaultLocale` | den `useTranslations`-Helfer (dokumentiertes Muster, rund 10 Zeilen) |
| `getRelativeLocaleUrl()` | **hreflang-Tags**, von Hand im Layout |
| Fallback-Routing bei fehlender Übersetzung | Sitemaps je Sprache (separate Integration) |

Es bleiben Routing-Helfer und Fallbacks. Das Fallback-Routing ist der einzige
Teil, der von Hand wirklich unangenehm wäre.

**Der eigentliche Zwang ist ein anderer:** Unser deutscher Text steht inline in
den HTML-Dateien. Ohne Werkzeug hieße Mehrsprachigkeit, zehn Dateien je Sprache
zu duplizieren und synchron zu halten. Das löst aber schon eine **Template
Engine**, nicht erst ein Framework (`vite-plugin-virtual-mpa` erzeugt mehrere
Dateien aus einer Vorlage).

**Und nicht jede Seite braucht Bauzeit-Übersetzung:**

| Seiten | Bedarf |
| --- | --- |
| `index`, `impressum`, `datenschutz`, `galerie`, `profil`, `erlebnis` | **zur Bauzeit**: SEO, Vorschaukarten, `lang`-Attribut |
| `studio`, `konto`, `admin`, `feedback` | **zur Laufzeit genügt**: hinter dem Login, `noindex`, kein Crawler |

Für die vier hinteren reicht ein Wörterbuch mit `data-i18n`-Attributen. Es
bleiben sechs Seiten mit echtem Bauzeit-Bedarf.

Daraus folgt die ehrliche Gegenrechnung: Template Engine plus eigene
Sprachlogik kostet rund 19 Pakete und ein kleines Subsystem von uns
(Spracherkennung, Fan-out beim Bauen, hreflang, Sitemaps, Vhost). Das Risiko
dabei ist benennbar: Es würde die **fünfte Stelle**, an der der URL-Raum lebt.

## Die Entscheidung, und woran sie gemessen wurde

Gewählt ist **Astro** (geprüft an 7.2.3). Alles Folgende ist am 2026-08-19 an
einem echten Bau gemessen, nicht aus der Dokumentation übernommen.

### Was am Nutzer ankommt

```
dist/index.html            <script>-Tags: 0
3 Seiten gebaut in 208 ms
```

Eine Seite ohne eigenes Skript liefert **kein Byte JavaScript** aus. Kein
Runtime, kein Hydrations-Gerüst. Für Landing, Impressum und Datenschutz ist das
weniger als heute.

### Was es im Repo kostet

Vite ist vorhanden, es zählt also die Differenz:

| | node_modules | Pakete | zusätzlich |
| --- | --- | --- | --- |
| Vite allein (vorhanden) | 29 MB | 14 | . |
| Vituum + Nunjucks | 32 MB | 33 | +3 MB, +19 |
| vite-plugin-handlebars | 35 MB | 21 | +6 MB, +7 |
| Eleventy 3 | 22 MB | 110 | +22 MB, +110 |
| Vike | 67 MB | 57 | +38 MB, +43 |
| **Astro 7** | 144 MB | 191 | **+115 MB, +177** |

Astro ist rund das Vierzigfache der leichtesten Alternative. Das ist der Preis,
und er trifft den Betreuer, nicht die Nutzer.

### Wie die leichten Alternativen abschneiden

| | Layouts | i18n-Routing | Collections | SSR in Fastify |
| --- | --- | --- | --- | --- |
| vite-plugin-handlebars | ja | nein | nein | nein |
| Vituum | ja | nein | JSON daneben | nein |
| Eleventy 3 | ja | Plugin, Handarbeit | ja | nein |
| Vike | ja | nur Anleitung | nein | ja |
| Astro 7 | ja | Helfer und Fallbacks | ja | ja |

Alle sind aktiv gepflegt, daran liegt es nicht. Sie **lösen den Schmerz von
heute**, also die Layouts, und zwar zu einem Bruchteil des Gewichts. Was sie
nicht mitbringen, ist alles Weitere: Sprach-Routing samt Fallbacks, Collections,
Server-Routen. Wer sie wählt, entscheidet sich dafür, diese Teile selbst zu
bauen und zu pflegen.

Vituum ist dabei die unattraktivste Wahl, unabhängig vom Ausgang: zu schwer, um
wegwerfbar zu sein, und zu leicht, um die Entscheidung zu ersparen. Wenn nur die
Layouts gebraucht werden, ist der wegwerfbare 20-Zeilen-Haken in
`transformIndexHtml` besser (null neue Pakete, benutzt `appHeaderHtml()` weiter,
schreibt keine Vorlage um). **Genau diese beiden Enden vergleicht der Bake-off
in Etappe 0.**

Verworfen sind ebenso **Next.js, Nuxt und SvelteKit**, und Next scheitert
ausgerechnet am Auslöser: i18n ist im App Router aufwendiger als heute
(Middleware für die Spracherkennung, `[locale]`-Segmente, eine Bibliothek wie
`next-intl`, dazu getrennte Übersetzungswege für Server und Client), und das
eingebaute i18n-Routing arbeitet **nicht** mit `next export` zusammen. Dazu
React in jedem Bundle, auch in der Landing, die heute keines hat, und im Dev
doppelt aufgerufene Effekte, was bei MapLibre plus Three.js kein Detail ist.

## Zwei Dinge, die Astro bei uns billiger macht als gedacht

**Die CSS-Reihenfolge löst es besser als wir.** Das war der größte befürchtete
Reibungspunkt: `basisZuerst()` in [vite.config.js](../../vite.config.js) existiert,
weil Vite gebautes CSS ans Ende des `<head>` hängt und die Basis dort alles
überschreibt, was eine Seite absichtlich anders macht. Der Fehler zeigt sich nur
im Build und damit erst nach dem Deploy. Gemessen an einem echten Astro-Bau:

```
LINK   /_astro/Grund.DBZdGLc3.css               ← die Basis
STYLE  .knopf[data-astro-cid-…]{padding:99px}   ← die Abweichung der Seite
```

Richtig herum, ohne Zutun. Astros Rangfolge ist `<link>` < importiert <
seiteneigen, und Seitenstile bekommen zusätzlich einen Scope-Selektor, gewinnen
also auch bei gleicher Spezifität. **`basisZuerst()` entfällt ersatzlos**, samt
seiner Falle.

**Der Node-Adapter läuft in unserem Fastify.** `@astrojs/node` 11.1.3 kennt
`mode: 'middleware'`, und die Dokumentation zeigt das Einhängen für Express UND
Fastify. Es kommt also **kein zweiter Prozess** dazu. Damit könnten `/@handle`
und `/tour/<kennung>` als echte Server-Routen entstehen, statt dass
[seiten.ts](../../server/src/seiten.ts) das gebaute HTML über Nginx holt und
zwischen zwei Kommentaren Text ersetzt. Der Marker-Vertrag, der
Fünf-Minuten-Cache und die Abhängigkeit „Container muss Nginx erreichen" fielen
weg.

## Trägerschaft und was daran zu beobachten ist

Astro ist MIT-lizenziert, mit offener Governance, öffentlicher Roadmap und
offener Budgetierung über Open Collective. Es gibt keinen kostenpflichtigen
Kern.

**Seit Januar 2026 sind alle Vollzeit-Beschäftigten der Astro Technology Company
Angestellte von Cloudflare** und arbeiten dort weiter an Astro. Das beantwortet
die Frage nach der Finanzierung, schafft aber eine neue: Ein
Infrastrukturunternehmen beschäftigt das Kernteam und hat ein Interesse daran,
dass Astro-Anwendungen auf Workers laufen. Passend dazu war in Astro 6.0
ausgerechnet der Cloudflare-Adapter neu gebaut.

**Unser Plan hängt am Node-Adapter.** Ob der erstklassig gepflegt bleibt oder
zum geduldeten Nebenpfad wird, ist die eine Sache, die vor dem Umstieg zu prüfen
und danach zu beobachten ist. Ablesbar an den Commits und am Umfang der
Release-Notes, nicht an einer Ankündigung.

## Migrationsschnitt

**Von den Inhaltsseiten zu den Anwendungen**, nicht umgekehrt. Der Gewinn ist
vorne am größten und das Risiko hinten.

1. `impressum`, `datenschutz` (reiner Inhalt, dazu Kandidaten für Markdown mit
   Layout: `datenschutz.html` hat 655 Zeilen und wird bei jeder Funktionsänderung
   angefasst)
2. `index` (Landing)
3. `galerie`, `profil`, `feedback`
4. `konto`, `admin`
5. `studio`, `erlebnis` zuletzt. Sie gewinnen am wenigsten und können am meisten
   kaputtgehen.

Der Player bleibt dabei **unverändertes TypeScript**. `tour.ts`, `ui.ts`,
`filmachse.ts`, `kartenmaler.ts` und der ganze Rest der Engine werden nicht
angefasst; eine Astro-Seite bindet `main.ts` als Skript ein, mehr nicht. Das
hier ist eine Entscheidung über die Hülle und das Routing, nicht über die
Anwendung.

## Etappen

0. **Bake-off statt Argument.** Dieselben zwei Seiten zweimal bauen, je eine
   Inhaltsseite und eine App-Hülle, beide mit `/de/` und `/en/`: einmal in Astro,
   einmal in Vite plus Template Engine plus selbst geschriebener Sprachlogik.
   Dazu im Astro-Zweig der Durchstich, der die offene Frage klärt: eine Seite
   über `mode: 'middleware'` in Fastify eingehängt, mit Meta-Daten pro Adresse,
   und ein Blick auf den Pflegestand des Node-Adapters (s. oben). Danach ist
   gemessen, was die eigene Lösung wirklich kostet, statt geschätzt. Etwa ein
   Tag Arbeit, und er ersetzt die Diskussion.
1. **Gerüst**: Astro neben dem bestehenden Build, `basis.css` und
   `grundelemente.css` als Import im Layout, Header und Footer als Komponenten
   aus `app-nav.ts` überführt.
2. **Inhaltsseiten** nach dem Schnitt oben, Schritt 1 bis 3.
3. **`routen.ts` auflösen.** Der URL-Raum kommt dann aus dem Dateibaum; was von
   der Tabelle übrig bleibt, sind die sprachneutralen Namen für `pfad()`. Der
   Vhost verliert seine `location`-Blöcke für Seitenpfade, der Drift-Wächter
   schrumpft. Hier fällt auch `/erlebnis` weg, das heute nur existiert, damit
   `erlebnis.html` im Build bleibt.
4. **Werkzeug-Seiten**, Schritt 4 des Schnitts.
5. **`/@handle` und `/tour/<kennung>` als Astro-Routen**, Marker-Ersetzung in
   `seiten.ts` entfällt.
6. **Player und Studio.**
7. **i18n**, und erst jetzt.

## Die Sprachfrage liegt davor

[Bezeichner auf Englisch](konzept_codebase_english_refactoring.md) steht auf
„geprüft und VERTAGT" mit einem ausdrücklichen Entscheidungstor. Diese Frage
gehört **vor** den Umstieg entschieden, auch wenn die Antwort „bleibt vorerst
deutsch" lautet.

Der Grund ist mechanisch: Der Umstieg legt eine Menge neuer Dateien an, Layouts,
Komponenten, Seiten. Sie auf Deutsch zu schreiben und später umzubenennen wäre
doppelte Arbeit; sie schon englisch zu schreiben widerspräche der geltenden
Regel jenes Konzepts, dass auch neue Module deutsch bleiben, um keinen Mix zu
erzeugen. Beide Züge sind große mechanische Sweeps über dieselben Dateien und
gleichzeitig nicht reviewbar.

Was der Englisch-Umbau für die Doku bedeutet, hängt mit dran und ist dort nicht
geregelt. Die Größenordnung, gemessen an sieben Bezeichnern in `docs/` plus
`CLAUDE.md`: `einblendung` 122 Nennungen, `filmachse` 116, `kartenmaler` 54,
`filmuhr` 15, `MODUS_TEMPO` 14, `streckenanker` 9. Es bricht nichts, aber die
Prosa veraltet still, und der Doku-Viewer repariert Links auf **Dateien**, nicht
Bezeichner im Fließtext. Vorschlag zur Regel: `CLAUDE.md` und Specs gehen je
Welle mit, `docs/archive/` wird **nicht** angefasst (es beschreibt einen
vergangenen Zustand, ein Umschreiben fälschte die Aufzeichnung), laufende
Konzepte gehen mit ihrer Welle, unbebaute erst beim Bauen.

## Fallen

- **Die `<!-- maptale:meta -->`-Marker** sind ein Vertrag zwischen Build und
  Server, und ein Wächter prüft sie. Bis Etappe 5 müssen sie durch Astros
  Head-Verwaltung unverändert hindurchkommen.
- **Die großen `<style>`-Blöcke in den Seiten.** Sie sind Absicht (was zweimal
  vorkommt, gehört in ein Blatt; was einmal vorkommt, bleibt in der Seite) und
  werden in Astro zu scoped styles. Der Scope-Selektor ändert die Spezifität,
  das ist hier ein Gewinn, kann aber einzelne Regeln kippen, die sich heute auf
  gleiche Spezifität verlassen.
- **`dokuAusliefern` und `saubereUrls`** sind eigene Vite-Plugins und müssen als
  Astro-Integration oder über die Vite-Konfiguration weiterlaufen.
- **Der Doku-Viewer** ist ein handgeschriebener Generator mit 4834 Zeilen. Seine
  erzeugende Hälfte deckt sich mit Astros Content Collections, die andere Hälfte
  (Zurückschreiben im Dev, Umbenennen mit Link-Reparatur, Bereichs-Ableitung,
  Verweis-Graph, Verlauf aus `git log`) nicht. Er ist **nicht Teil dieses
  Umstiegs** und wäre ein eigenes Vorhaben.
- **Der Vhost muss mitgehen**, von Hand in CloudPanel. Er wird vom Deploy nicht
  mitgezogen, und mit Etappe 3 ändern sich seine `location`-Blöcke deutlich.

## Nicht Gegenstand

- **Kein SPA.** Die Navigation bleibt ein Dokumentwechsel, und das ist gewollt:
  Er räumt MapLibre, den Three.js-Layer, den AudioContext, vier Ton-Schleifen mit
  eigenen Timern und die Filmuhr in einem Zug ab. In einem Dokument müsste das
  von Hand geschehen, jedes Mal.
- **Astros `ClientRouter` ist offen.** Er navigiert im selben Dokument und ließe
  sich pro Link abschalten, also SPA-artig zwischen den Inhaltsseiten und ein
  echter Wechsel in den Player hinein. Nebeneffekt wäre, dass der Startscreen
  einer Tour im Vollbild ankäme (s.
  [konzept_maptale_als_ios_webapp.md](konzept_maptale_als_ios_webapp.md)). Zu
  messen, nicht anzunehmen, und nichts, was diesen Umstieg begründet.
- **Der MP4-Export** hängt an einer Export-Seite im `iframe` und ist bis Etappe 6
  nicht betroffen.
