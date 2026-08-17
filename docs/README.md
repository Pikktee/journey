# Maptale Dokumentation

```
docs/
├── ops/             # Betrieb, Deployment-Runbooks & Release-Anleitungen
├── specs/           # Datenformate, Schnittstellen & Datenmodell-Spezifikationen
├── architecture/    # Umgesetzte Architektur-Entscheidungen & technische Designs
├── concepts/        # Offene Zukunfts-Features & Entwürfe (noch nicht / nicht ganz gebaut)
├── mockups/         # Aktuelle HTML-Prototypen als Vorlage
└── archive/         # Historie — Ablage, keine Gliederung (s. unten)
```

## Zum Lesen: der Doku-Viewer

```bash
npm run docs
```

Baut aus diesem Ordner eine kleine Website nach `docs/_site/`. Sie ist in drei
Ebenen aufgebaut, damit nicht alles auf einmal auf einen einprasselt:
**Übersicht** (wo anfangen, Roadmap, die Bereiche, zuletzt Bewegtes) →
**Bereich** (die Dokumente eines Bereichs, nach Status filterbar) →
**Dokument** (Text mit Inhaltsverzeichnis und Querverweisen). Dazu Volltextsuche
(⌘K), die Mockups als aufgenommene Vorschauen und die **Verweis-Karte**: ein
Graph über den ganzen Viewport (Kräfte-Layout, beim Bauen gerechnet und
deterministisch), zoombar mit dem Mausrad, verschiebbar durch Ziehen, mit
Bereichsfiltern und einer Suche, die Treffer hervorhebt statt zu filtern.

Ansehen auf zwei Wegen:

* **Über den Dev-Server** (devhub, läuft ohnehin): <http://maptale.localhost:5123/doku/>.
  Ausgeliefert wird sie von einem eigenen Plugin in
  [`vite.config.js`](../vite.config.js) — roh und nur im Dev, weil Vite jede
  `.css` sonst zu `text/javascript` umbaut und die Seiten ungestaltet blieben.
* **Ohne Server**: `docs/_site/index.html` im Finder doppelklicken. Der Viewer
  kommt deshalb ohne `fetch` und ohne ES-Module aus.
* **Aus der Verwaltung heraus**: Die Kopfleiste von `/admin` trägt einen
  Doku-Link, sichtbar nur auf dem eigenen Rechner (`istLokal` in
  [`src/admin/adminmodell.ts`](../src/admin/adminmodell.ts)). Ist die Doku noch
  nicht gebaut, antwortet der Dev-Server mit dem nötigen Befehl statt mit der
  Landing.

* `npm run docs -- --ohne-bilder` überspringt die Mockup-Screenshots (~1 s statt ~30 s).
* `npm run docs -- --neu` nimmt alle Vorschauen neu auf.
* `npm run docs -- --oeffnen` öffnet die Übersicht gleich im Browser.

Die Ausgabe steht in `.gitignore` und ist **kein Vite-Einstieg**: Diese Seiten
bleiben lokal — hier stehen Verträge, Zugänge und Preisüberlegungen. Der
Generator liegt in [`scripts/docs-viewer/`](../scripts/docs-viewer/).

**Listen sortieren und lesen.** Jede Liste hat neben den Filtern ein Feld
**Sortierung**: zuletzt geändert (Voreinstellung), A bis Z, kürzeste zuerst,
meist verlinkt. Vorher kamen die Dokumente in Dateinamen-Reihenfolge — für den
Leser eine zufällige Ordnung, weil alle `konzept_*` schon durch ihren Namen
beieinanderstehen. Die Zeitangabe auf den Karten ist **relativ** („vor 3 Tagen",
in der ersten Woche mit grünem Punkt), das genaue Datum steht im Tooltip.

**Die Schrift liegt lokal.** Der Bau lädt Outfit einmal nach
`docs/_site/assets/outfit.woff2`; über Google Fonts waren es zwei Roundtrips,
und beim Eintreffen der Datei sprang die Seite sichtbar um. Ohne Netz beim
ersten Bau bleibt es beim CDN-Weg, dann greift der metrische Ersatz aus
`basis.css`.

**Neues erscheint von selbst, und zwar ohne dass jemand den Generator anfasst:**

* Eine neue `.md` unter `docs/<bereich>/` steht sofort auf der Bereichsseite,
  in der Suche und in der Verweis-Karte. Ihren Klappentext nimmt sie aus der
  Liste unten, sonst aus ihrem ersten Absatz.
* Ein **neuer Ordner** unter `docs/` wird ein eigener Bereich — mit
  Standardfarbe und einer Warnung beim Bauen, damit ihm jemand Farbe, Motiv und
  einen Satz gibt (`BEREICHE` in `scripts/docs-viewer/sammeln.mjs`).
* Eine neue **`CLAUDE.md`** irgendwo im Repo landet automatisch im Bereich
  „Handbuch"; die Tabelle dort gibt nur noch schönere Titel und Klappentexte.
* **Zahlen im Text sind immer gezählt**, nie geschrieben. Ein Wächter
  ([`test/docs-viewer.test.mjs`](../test/docs-viewer.test.mjs)) hält das fest —
  samt der Regel, dass Archiviertes nicht in die vordersten Zeilen rutscht.

## Direkt im Viewer arbeiten

Wenn der Viewer über den Dev-Server läuft (nicht als Datei), kann er auch
schreiben — die API dafür hängt in [`vite.config.js`](../vite.config.js) und
gibt es nur dort:

Zu erreichen sind sie über das **„…"-Menü** an jeder Karte und auf jeder
Dokumentseite. Ein Klick auf eine Mockup-Kachel öffnet direkt den Prototyp;
dort hängt der Dev-Server eine kleine **Leiste** an (zurück zur Doku, Roadmap,
Archivieren) — angehängt beim Ausliefern, nicht in die Datei geschrieben: Das
Mockup ist eine Vorlage und soll auch im Finder genau das zeigen, was es zeigt.

* **Bearbeiten** — Knopf über jedem Dokument. Der Quelltext wird beim Öffnen
  frisch geholt (nicht aus der gebauten Seite), `⌘S` speichert, danach baut
  der Viewer sich selbst neu. Geschrieben wird in die echte `.md`.
* **Archivieren / Zurückholen** — verschiebt per `git mv` nach
  `docs/archive/` und zurück in einen wählbaren Bereich. Mockups wandern nach
  `docs/archive/mockups/`.
* **Roadmap** — im „…"-Menü jedes Konzepts und jedes Mockups: Phase wählen oder
  „Nicht eingeplant"; das × an einem Roadmap-Eintrag der Übersicht nimmt ihn
  ebenfalls heraus. Die aktuelle Phase steht als Chip auf der Karte, damit man
  dafür kein Menü öffnen muss.

**Overlays hängen am `body`.** Menüs, Klappen und Hinweis-Blasen werden beim
Öffnen aus ihrem Platz im DOM herausgehängt, fest positioniert und in den
Viewport geklemmt (`zeigeSchwebend` in
[`assets/viewer.js`](../scripts/docs-viewer/assets/viewer.js)). Der Grund steht
dort ausführlich: `backdrop-filter` (Kopfleiste, Glas-Panels) und
`overflow: hidden` (Karten mit runden Ecken) beschneiden ihre Nachfahren, und
dagegen hilft kein `z-index`. Wer ein neues Overlay baut, nimmt diese Hilfe.

Geschrieben wird ausschließlich in `docs/` und in die Handbuch-Dateien an der
Wurzel; jeder Pfad wird aufgelöst und danach geprüft. Die Grenzen stehen in
[`scripts/docs-viewer/dienst.mjs`](../scripts/docs-viewer/dienst.mjs) und
werden vom Wächter mitgetestet.

## Archiv

Archivierte Dokumente liegen weiter in `docs/archive/`, sind im Viewer aber
**kein eigener Bereich**: Sie hängen unter dem Bereich, aus dem sie kamen —
aufklappbar am Ende von dessen Seite. Eine eigene Kachel führte in einen Raum,
in dem Konzepte und Architektur-Notizen durcheinanderlagen; ihre Nachbarschaft
bleibt so dort, wo sie hingehört.

Woher ein Dokument kam, steht **in ihm**, direkt unter der Überschrift:

```markdown
Archiviert aus: concepts
```

Der Viewer schreibt diese Zeile beim Archivieren selbst und entfernt sie beim
Zurückholen. Die Git-Historie kannte die Herkunft nur bei zweien von fünf
Altfällen (der Rest wurde direkt im Archiv angelegt), und beim Lesen der Datei
beantwortet sie die Frage gar nicht. Ohne Zeile landet ein Dokument bei den
Konzepten.

## Systemteile

Neben dem Bereich („wie verbindlich ist das?") trägt jedes Dokument und jedes
Mockup eine zweite Achse: **welchen Teil des Produkts** es betrifft — Android-App,
Backend, Studio, Player, Öffentliche Seiten, Landing, Verwaltung, Betrieb.
Mehrfachnennung ist der Normalfall.

Die Zuordnung wird **abgeleitet, nicht gepflegt**: Die Dokumente nennen ihre
Dateien ohnehin (`src/studio/editor.ts`, `server/src/pipeline/…`), Mockups tragen
ihren Teil im Dateinamen (`app-`, `player-`, `studio-`). Der eigene Ort wiegt dabei
am schwersten — das Handbuch des Studios verweist mehr auf den Server als auf sich
selbst. Wo die Ableitung danebenliegt, übersteuert eine Kopfzeile:

```markdown
Systemteile: Studio, Android-App
```

Angezeigt wird die Achse als Chip auf jeder Karte und Einzelseite, als Filter auf
Bereichs- und Mockup-Seite, als Hervorhebung in der Verweis-Karte und als Treffer
in der Suche („android" findet, was die App betrifft). Ein Text, der fast alles
betrifft, bekommt statt sieben Chips das Wort **Produktweit**. Beim Bauen meldet
der Generator, wie viele Dokumente ohne Zuordnung bleiben.

## Roadmap

Der Roadmap-Bereich der Übersicht kommt aus [`roadmap.md`](roadmap.md): Phasen
als `##`-Überschriften, darunter je ein Listenpunkt pro Konzept oder Mockup.

Die Ansicht ist bewusst ungleich gewichtet und ehrlich statt glatt:

* **Die erste Phase bekommt die breiteste Spalte** und je Eintrag den
  Statussatz, den nächsten Schritt und das Alter der letzten Änderung; die
  letzte Phase nur noch Titel. Der Blick folgt der Fläche, also folgt die
  Fläche der Verbindlichkeit.
* **Der Statussatz steht auf der Karte**, nicht nur die Ampel: „Etappen 0–6
  gebaut, Polar live" beantwortet die Frage „wie weit?", „Unterwegs" nicht.
  Sagt er nur „Konzept, nichts gebaut", bleibt er weg — das wiederholt die
  Phase.
* **„vor 7 Tagen"** in der ersten Spalte, ab einer Woche in Warnfarbe: Was in
  Arbeit ist und ruht, ist die interessanteste Zahl einer Roadmap.
* **„Stand prüfen"** erscheint, wo Phase und Dokument sich widersprechen (in
  Arbeit, aber „nichts gebaut"). Eines von beidem ist dann nicht mehr wahr.
* **Drei Töpfe statt einem**: eingeplant, **Abgearbeitet** (der Plan ist durch)
  und **Ohne Phase**. Vorher lag beides zusammen und die Liste behauptete
  Versäumnisse, wo Erledigtes stand.
Die Phasen heißen **In Arbeit · Beschlossen · Angedacht** — benannt nach dem
Grad der Entscheidung, nicht nach einem Datum, das ein Entwurf ohnehin nicht
halten kann. Die
**Reihenfolge** steht dort (eine Entscheidung), der **Stand** dagegen im
Dokument selbst (`Status:`-Zeile) — zwei Quellen für zwei Fragen, damit die
zweite Angabe nicht veraltet. Konzepte ohne Phase erscheinen unter „Noch nicht
eingeplant" und werden beim Bauen gemeldet.

---

**Für Coding-Agenten:** Verbindlich sind `ops/`, `specs/`, `architecture/` und die
unten gelisteten offenen `concepts/`. `archive/` ignorieren (widerspricht oft dem
Ist-Stand oder beschreibt erledigte Arbeit).

---

## Ordner-Übersicht

### 1. `ops/` (Operations & Release)
* [`deploy-cloudpanel.md`](ops/deploy-cloudpanel.md) — VPS-Deployment mit Hetzner & CloudPanel.
* [`android-release.md`](ops/android-release.md) — Bauen, Signieren und Veröffentlichen der Android-APK.
* [`tracker-zugaenge.md`](ops/tracker-zugaenge.md) — Wo man den Schnittstellenzugang je Anbieter beantragt, welches Modell dahintersteht und wie weit es ist (Abhak-Liste).
* [`polar-einrichten.md`](ops/polar-einrichten.md) — Polar AccessLink: Client, Token-Schlüssel, Webhook-Registrierung (das Geheimnis gibt es nur einmal).
* [`push-einrichten.md`](ops/push-einrichten.md) — Firebase-Projekt, `google-services.json` und Dienstkonto für die Push-Meldung „deine Tour ist fertig".

### 2. `specs/` (Spezifikationen)
* [`austauschformat.md`](specs/austauschformat.md) — `.maptale`-Export/Import-Format und `tour.json`.
* [`overlay-und-tourjson.md`](specs/overlay-und-tourjson.md) — Rollenverteilung zwischen `edits.json`, `anreicherung.json` und `tour.json`.

### 3. `architecture/` (Umgesetzte Entscheidungen)
* [`systemuebersicht.md`](architecture/systemuebersicht.md) — Tech-Stack & High-Level-Systemarchitektur (Einstieg mit Diagrammen).
* [`foto-pins-3d.md`](architecture/foto-pins-3d.md) — Three.js Custom-Layer für 3D-Fotopins & Mercator-Skalierung.
* [`zeitleiste-umbau.md`](architecture/zeitleiste-umbau.md) — Filmzeit-Achse, Halt-Klips, Zustandsbänder, Ton-Trim.
* [`konzept_profil_konto.md`](architecture/konzept_profil_konto.md) — Handle, Profil, Konto, Newsletter-Einwilligung, Export, SEO-Meta.

### 4. `concepts/` (Offene Konzepte)
* [`konzept_play_store_interner_test.md`](concepts/konzept_play_store_interner_test.md) — Android Play Store, interner Test als erster Schritt.
* [`konzept_social_login.md`](concepts/konzept_social_login.md) — Anmelden mit Google (später Apple).
* [`konzept_newsletter.md`](concepts/konzept_newsletter.md) — Teil B: redaktioneller Newsletter-Versand (Teil A ist live).
* [`konzept_mehrsprachigkeit_i18n.md`](concepts/konzept_mehrsprachigkeit_i18n.md) — Mehrsprachigkeit & `/de/` / `/en/`-Routing.
* [`konzept_tracker_integrationen.md`](concepts/konzept_tracker_integrationen.md) — Garmin/Strava Sync & automatische Foto-Zuordnung.
* [`konzept_medien_nachreichen_und_loeschen.md`](concepts/konzept_medien_nachreichen_und_loeschen.md) — Additive Medien-Route & endgültiges Löschen (Etappe 0 der Tracker-Integrationen).
* [`konzept_codebase_english_refactoring.md`](concepts/konzept_codebase_english_refactoring.md) — Bezeichner auf Englisch: Wellenplan, Glossar, Welle‑1-Schnitt.
* [`konzept-reisen-sammlungen.md`](concepts/konzept-reisen-sammlungen.md) — Sammlungen & mehrtägige Reisen.
* [`modi-konsolidierung.md`](concepts/modi-konsolidierung.md) — Fortbewegungs-Modi auf eine zentrale Tabelle ziehen.
* [`konzept_editor_zerlegung.md`](concepts/konzept_editor_zerlegung.md) — `editor.ts` in Karte / Inspector / Zeitleiste / Menüs zerlegen.
* [`konzept_live_mitverfolgen.md`](concepts/konzept_live_mitverfolgen.md) — Live-Link während der App-Aufnahme; Spur und Medien in Echtzeit.
* [`konzept_gleichlauf_player_editor.md`](concepts/konzept_gleichlauf_player_editor.md) — Ein Film, zwei Bühnen: Editor und Player zur Deckung bringen, bis auf den Takt genau.
* [`konzept_tempoempfinden.md`](concepts/konzept_tempoempfinden.md) — Warum sich der Film an manchen Stellen zu schnell anfühlt: drei behobene Ursachen, zwei offene Kandidaten, die Messwerkzeuge dazu.
* [`editor-ausbau.md`](concepts/editor-ausbau.md) — Erzählerische Werkzeuge im Studio.
* [`foto-tour.md`](concepts/foto-tour.md) — Foto-basierte Touren ohne GPS-Track.
* [`konzept_kartenleinwand.md`](concepts/konzept_kartenleinwand.md) — Die Foto-Karte auf eine Leinwand: die letzte Stelle, an der Player und Video-Export auseinanderlaufen (der Ken Burns läuft im Export heute in die Gegenrichtung). Entwurf.
* [`konzept_video_export.md`](concepts/konzept_video_export.md) — Tour als MP4. Etappe 1 gebaut (Film in Player-Tempo, Studio-Blatt). Der geraffte Clip und der Cloud-Auftrag kommen danach.
* [`konzept_monetarisierung.md`](concepts/konzept_monetarisierung.md) — Esri-Lizenz (anonyme World Imagery vs. Location Platform) und wer zahlt (Hersteller, nicht Zuschauer). Vertragstexte E204/E300 im Wortlaut: Player als Produkt erlaubt, **MP4-Export nicht**. Dazu Kostendeckel (Esri hat keinen) und zweite Bildquelle. Entwurf, nichts gebaut.
* [`ideen-inspiration.md`](concepts/ideen-inspiration.md) — Rohideen-Backlog (nichts beschlossen).

### 5. `mockups/` (Aktuelle Vorlagen)
* [`studio-login.html`](mockups/studio-login.html) — Anmeldebühne.
* [`studio-konto.html`](mockups/studio-konto.html) — Profil & Kontoeinstellungen (abgenommen, in `DESIGN.md` referenziert).
* [`studio-aufnahmen-nachreichen.html`](mockups/studio-aufnahmen-nachreichen.html) — Medien nachträglich im Studio.
* [`app-aufnahmen-hinzufuegen.html`](mockups/app-aufnahmen-hinzufuegen.html) — Medien nachträglich in der App.
* [`app-live-teilen.html`](mockups/app-live-teilen.html) — Live-Freigabe während der Android-Aufnahme.
* [`live-ansicht.html`](mockups/live-ansicht.html) — Live-Zuschaueransicht (`/live/…`).

### 6. `archive/` (Historie)
Siehe [`archive/README.md`](archive/README.md). Enthält u. a. den Tool-Katalog,
alte Luhambo-/CI-/Logo-Mockups, den Zeitleisten-Mockup-Stand vor der Umsetzung und
das [Renderer-Labor](archive/renderer-labor.md) (2026-08-11 ausgebaut — was es gab,
was es gelehrt hat, wie man es zurückholt) sowie
[antialias-verworfen.md](archive/antialias-verworfen.md) (MSAA war seit MapLibre 5
stumm aus; nachgemessen, ohne sichtbaren Effekt, Flags entfernt) und die
[Player-TS-Migration](archive/konzept_player_typescript.md) (erledigt mit v0.60.0 —
lesenswert für die Methodik: topologische Wellen, Äquivalenztest, Smoke-Aufbau).
