---
stand: 2026-08-20
status: abgearbeitet — Wellen 1 bis 3 sind gebaut, ausgeliefert und abgenommen; die dauerhaften Lehren stehen in §9.1 und §9.2 des Konzepts
betrifft:
  - server/src/db.ts
  - server/src/routes/
  - docs/concepts/konzept_codebase_english_refactoring.md
  - docs/specs/abbildungstabelle.tsv
systemteile: [server]
icon: buchstaben
archiviert_aus: specs
---

# Welle 1: Stand und Übergabe

> **Archiviert am 2026-08-20.** Dieser Arbeitszettel hat die Wellen 1 bis 3
> begleitet und ist mit ihrer Abnahme erledigt. Was daraus dauerhaft gilt, steht
> im Konzept: [§9.1 Wie umbenannt wird](../concepts/konzept_codebase_english_refactoring.md)
> und §9.2 „Was kein Test sieht". Hier bleibt der Verlauf stehen, weil die
> Messwerte und die Nahtliste sonst verloren gingen.

Arbeitsstand der Englisch-Migration, Welle 1
([Konzept](../concepts/konzept_codebase_english_refactoring.md)). Diese Datei ist
ein ARBEITSZETTEL und verschwindet mit der Abnahme der Welle; maßgeblich bleiben
das Konzept und die [Abbildungstabelle](abbildungstabelle.tsv).

## Was steht

- **DB-Snapshot vor dem Lauf** liegt unter `~/Dev/.maptale-snapshot-welle1/daten/`
  (404 MB, per rsync von `178.104.147.230:/srv/maptale/daten`, nur lesend geholt).
  Er ist zugleich die Kopie für den Migrationslauf nach §8 und der Rückweg.
  **Nicht löschen vor Abnahme der Welle 2.**
- **Die Zahlen aus §4.5 sind am 2026-08-20 gegen den Snapshot nachgemessen** und
  unverändert: 3 Konten (2 davon Rolle `nutzer`), 15 Touren auf 2 Besitzer, alle
  im Status `bereit`, 3 App-Tokens auf 2 Konten, kein laufender Datenexport,
  keine angepasste Mail-Vorlage. Keine Zahl über der Schwelle, das Tor bleibt offen.
- **`verarbeite` heißt `processTour` und ist exportiert** (Nahtliste §3.3) —
  die Start-Migration braucht sie.
- **DB-Leiter-Schritt 23** (`server/src/db.ts`): Tabellen- und Spalten-RENAMEs,
  Neubau der sieben Tabellen mit deutschen `CHECK`-Werten, Schlüsselzeilen in
  `settings` und `mail_templates`, Mail-Platzhalter im gespeicherten Text,
  JSON-Blobs in `tours.stats_json` und `feedback.context`.
  Gegen die Snapshot-Kopie durchgelaufen: `user_version` 23, 16 Tabellen
  englisch, `foreign_key_check` leer, Zeilenzahlen unverändert (15 Touren,
  3 Konten, 5 Sitzungen, 3 Tokens).
- **Server-Code**: SQL, Zeilen-Typen, API-Pfade und API-Felder nach §6.7/§6.8.
- **Die vier Verträge stehen auf `@2`**: `maptale/upload@2`, `maptale/edits@2`,
  `maptale/enrichment@2` (früher `anreicherung@1`) und `maptale/tour@2`.
- **Alle Leser**: Web (`src/studio/api.ts`, `src/remote.ts`, `src/konto/*`,
  `src/profil/*`, `src/admin/*`, `src/galerie/*`) und Android (`ApiClient.kt`,
  `Manifest.kt`, `EditsFortschreibung.kt`, `TourenScreen.kt`,
  `ImportViewModel.kt`, `MaptalePushDienst.kt`, Room-Entities, Enum-Speicherwerte,
  Room v4 mit `fallbackToDestructiveMigration`).
- **Die 400er-Ablehnung für `@1`-Uploads** mit Klartext in BEIDEN Feldnamen
  (`error` UND `fehler`) — die einzige bewusste Alt-Ausnahme (§4.1).
- **Start-Migration** unter `server/src/migrations/`: `keys-v2.ts` wird aus der
  Abbildungstabelle ERZEUGT (`node scripts/keys-v2-generieren.mjs`), `start.ts`
  bildet Manifest, Overlay und Cache ab und benennt `titelbild/` in `banner/`
  um, `nachrender.ts` rendert jede Tour mit alter `tour.json` seriell nach.
  Der Marker `daten/.schema` ist die Leiter.
- **Zwei neue Wächter**: `server/test/start-migration.test.ts` (jeder neue
  Schlüssel steht im JSON-Schema, jeder alte nicht mehr) und
  `server/test/leiter.test.ts` (Stand 0 → 23 mit je einer Werte-Zeile).
- **Die Specs** (`austauschformat.md`, `overlay-und-tourjson.md`, `api.md`) und
  die sachlichen Verweise in den fünf `CLAUDE.md`.
- **Gates grün**: Web 957 Tests, Server 896 Tests bei 93,5 % Coverage (Gate 80),
  Typecheck, Lint, `format:check`, Android `./gradlew test`.
- **Der Migrationslauf gegen die Prod-Kopie ist durch** (2026-08-20, Arbeitskopie
  `~/Dev/.maptale-welle1-lauf/daten`, der Snapshot daneben blieb unangetastet):
  Leiter auf `user_version` 23, `daten/.schema` = 2, alle 15 Tour-Ordner
  abgebildet, `anreicherung.json` heißt `enrichment.json`, alle 15 `tour.json`
  auf `maptale/tour@2` nachgerendert und alle 15 Touren wieder auf `ready`.
  Der Grep über den Kopie-Ordner findet KEINEN alten Schlüssel und keine
  `@1`- oder `luhambo/`-Kennung mehr; `tours.stats_json` trägt `placedMedia`,
  `trackSignature`, `end`. Der Anreicherungs-Cache hat den Lauf überlebt
  (Befunde, Orte, Wetter-Rohdaten stehen, die Signaturen in neuer Form) — es
  gab also weder Geocoding noch bezahlte Bildanalyse.
- **Die 15 gerenderten Touren laufen durch `adaptiereTour`** aus
  `src/remote.ts`, dem Leser des Players: kein `RemoteTourFehler`, jede mit
  Route, Medien und Ton. Die eine Tour mit Kamerakante und Momenten steht auf
  `preset: 'mid'` und `kind: 'orbit'|'linger'` — genau die Werte, an denen der
  stille Rückfall in `PRESETS` gehangen hätte.

## Was offen ist

1. ~~**Der Blick auf die Seiten.**~~ **Erledigt am 2026-08-20** (s. eigener
   Abschnitt): Studio, Konto, Verwaltung samt Reitern, Galerie und der Player
   auf einer migrierten Tour im Browser abgenommen; vier Sorten Nachzügler
   gefunden und behoben. Ursprünglicher Text: Die Touren sind gegen den Leser
   des Players geprüft, nicht im laufenden Player angesehen — dafür bräuchte es eine zweite
   Instanz auf der Kopie, und Dev-Server gehören auf diesem Rechner devhub. Der
   Weg dorthin wäre ein eigenes Profil:
   `devhub adopt journey --profil smoke --slot NN` mit
   `MAPTALE_DATEN_DIR=~/Dev/.maptale-welle1-lauf/daten`. **Entscheidung von
   Henrik**, weil es die devhub-Registry und eine `devhub.json` im Repo anfasst.
2. **Smoke über alle Web-Seiten** — die Web-Tests fassen keine Adresse an;
   genau deshalb blieben elf Client-Pfade und fünf Fehlerhüllen-Leser bis zum
   Abgleich mit `api.md` unentdeckt (s. Nahtliste).
3. **Der Deploy-Tag.** Er ist bewusst EIN Tag: Server, Web und APK gehen
   zusammen (§4.4). Bis dahin keine neuen Einladungen.

## Ein Vorfall nach dem Bau, und seine Lehre

**Die lokale Dev-Instanz hat während des Wellenbaus Daten verloren** (bemerkt am
2026-08-20: „Meine Touren" leer). Ursache war nicht der fertige Migrationscode,
sondern `tsx watch`: Der Dev-Server lief unter devhub mit, startete bei jedem
Speichern neu und führte dabei HALBFERTIGE Stände der Leiter gegen `server/daten`
aus. Ein Zwischenstand verlor die `tours`-Zeilen und setzte den Marker vorzeitig
auf 2 — der fertige Code hielt die Daten danach für migriert. Repariert durch
Rekonstruktion der vier Zeilen aus den Tour-Ordnern, Marker zurück auf 1,
Neustart; Dateimigration und Nachrendern heilten den Rest selbst (Cover inklusive).

**Eine löschende Route wird nicht „zur Probe" aufgerufen.** Beim Prüfen der
Konto-Funktionen wurde `DELETE /api/auth/me` mit absichtlich falschem Passwort
gerufen, in der Annahme, sie verlange eines wie der Passwort- und der
Adresswechsel. Sie verlangt keines: Damit war die lokale Dev-Instanz gelöscht,
Konto, drei Demo-Touren und eine Aufzeichnung. Wiederhergestellt sind das Konto
(über `auth.legeBenutzerAn`) und die drei Demo-Touren
(`scripts/seed-demo-touren.mjs`); die Aufzeichnung „Runde bei Völklingen" ist
lokal weg. Produktion und beide Welle-1-Sicherungen blieben unberührt. Was eine
Route verlangt, liest man im Schema, BEVOR man sie anfasst. Der Befund selbst
ist ein Produktthema und steht als eigenes Konzept:
[Konto löschen absichern](../concepts/konzept_kontoloeschung_absichern.md).

Zwei weitere Lehren: **Wer an einer Start-Migration baut, stoppt vorher die Dev-Instanz**
(`devhub down journey`) oder zeigt mit `MAPTALE_DATEN_DIR` auf eine
Wegwerf-Kopie. Und die Dateimigration hängt am MARKER, nicht an der Datei —
der Zustand „Marker 2, Ordner unmigriert" ist im Entwurf nicht vorgesehen und
heilt sich nicht selbst (das Nachrendern schon, aber nur für Touren, die die DB
noch kennt). Für Prod ist das unkritisch (dort läuft einmal fertiger Code),
aber ein Kandidat für einen billigen Wächter in einer späteren Welle:
`.schema` = 2 und trotzdem eine `anreicherung.json` gefunden = laute Warnung.

## Ausgeliefert am 2026-08-20 als v0.67.0

Der Deploy-Tag ist gelaufen: Gate grün (Web, Server mit Coverage, Android), Image
nach GHCR, `dist/` in den Docroot, APK am Release. Die Start-Migration lief beim
ersten Start des neuen Containers **auf Produktion**: 15 Tour-Ordner abgebildet,
15 Touren auf `maptale/tour@2` nachgerendert, `daten/.schema` = 2,
`user_version` = 23, keine `anreicherung.json` und keine `@1`-Kennung mehr.
Statuswerte und Schlüsselzeilen englisch. Vorher gezogen und unberührt als
Rückweg: `~/Dev/.maptale-deploy-20260820-2016/daten` (404 MB).

**Ein Fehler ist dabei durchgerutscht und wurde als v0.67.1 nachgereicht:** Die
Galerie und die Profilseite zeigten „Namenlose Reise" statt der Titel.
`galeriemodell.ts` las `tour.titel`, der Server schickt `title` — und der
handgetippte Typ `GalerieTour` deklarierte selbst das deutsche Feld, das
Fixture im Test benutzte es ebenfalls. **Ein Typ und sein Test können gemeinsam
falsch sein**; das ist genau die fünfte Sorte, gegen die es keinen mechanischen
Wächter gibt. Sie war auf Prod sichtbar, bevor sie irgendwo rot wurde.

Was der Deploy NICHT beweist: den Flug selbst. Die Browser-Pane bekommt
MapLibre nicht fertig geladen (`map.loaded()` bleibt false, bekannte Grenze der
Umgebung). Geprüft ist, dass der Player `tour@2` liest, Route und Filmachse
baut und den Startscreen aus den migrierten Daten füllt.

## Der Smoke, und was er gefunden hat (2026-08-20)

Der Blick auf die laufenden Seiten war der letzte offene §8-Punkt, und er hat
**fünf Sorten Nachzügler** gefunden, die alle Gates passiert hatten:

1. **`src/admin/api.ts` zeigte vollständig auf die alten Adressen** — die
   Verwaltung war tot. Der Abgleich, den `api.md` für die anderen Clients
   geleistet hat, erfasste diese Datei nicht.
2. **Das Sitzungsfeld heißt `user`, gelesen wurde `benutzer`** (admin/api.ts,
   admin.ts, konto/konto.ts, app-nav.ts). Wirkung: angemeldet sein und
   trotzdem „nicht angemeldet" lesen.
3. **Statuswerte im Studio** standen noch auf `bereit`/`fehler`/`verarbeitung`
   und `tour@1`. Wirkung: jede Tour galt als „arbeitet noch", die Liste fasste
   alle drei Sekunden ewig nach.
4. **Zwei DOM-IDs waren versehentlich mitgezogen** (`library`,
   `editor-media-hinweis`). Die Tabelle führt sie als **Welle 4**; das HTML
   blieb deutsch, der Selektor lief ins Leere und riss die Seite ab, bevor
   die Liste überhaupt geladen wurde. Verführt hat der gleichlautende
   API-Wert `bibliothek` → `library`, der tatsächlich Welle 1 ist: **derselbe
   Ist-Name, zwei Arten, zwei Wellen** — genau der Fall, für den die Tabelle
   die Fundort-Spalte hat.

5. **Ein Vertragswert stand in einer HTML-Datei**: Das
   `<option value="nutzer">` des Anlege-Dialogs. Der Server kennt nur noch
   `user`, also wies er jedes neue Konto mit 400 „Ungültige Anfrage" ab. Das
   ist die Sorte, die KEIN Abgleich sieht: Ein Enum-Wert steht weder im Pfad
   noch als Schlüssel im Body, und Tests fassen HTML-Attributwerte nicht an.
   Gefunden durch Benutzung.

Dazu eine UI-Regression: Die Reiterzähler der Verwaltung zeigten „0 open"
statt „0 offen" (§2.5 — UI-Strings wandern nicht mit).

**Nachtrag aus Welle 3 (2026-08-20): die Shorthand-Falle.** Welle 1 hatte in
`editor.ts` die lokale Variable `ab` zu `from` umbenannt — und weil sie als
Shorthand in ein Objekt ging (`{ from, mode }`), das als DOM-Attribute gesetzt
wird, hieß der Schlüssel danach `data-from`, gelesen wurde weiter `data-ab`.
Wirkung: Auf Produktion ließ sich seit v0.67.0 **keine Modus-, Kamera- oder
Wetter-Grenze mehr ziehen**. Kein Test wurde rot, kein Wächter sah es; gefunden
hat es erst das Abfahren im Editor, behoben ist es mit v0.67.2.

**Die Lehre ist eng und wichtig: Eine Umbenennung, die durch Shorthand-Syntax
läuft, ändert einen SCHLÜSSEL.** `{ ab }` und `{ from }` sind zwei verschiedene
Objekte, und der TypeScript-Language-Service benennt hier korrekt um — der
Fehler entsteht erst dort, wo der Schlüssel eine Fremdsprache spricht (DOM,
JSON, Query). Vor jeder weiteren Welle deshalb: Shorthand-Eigenschaften, die in
`dataset`, `setAttribute`, `JSON.stringify` oder eine URL fließen, von Hand
ansehen. Der Editor hat noch mehr davon, sie liegen in Welle 4.

**Nachtrag aus Welle 2 (2026-08-20): tote Symbol-Verweise in Kommentaren.** Die
Sprachregel lässt Kommentare deutsch, und das ist richtig — aber ein Kommentar,
der ein SYMBOL nennt (`s. AuthDienst.hebeAdmins`), zeigt nach der Umbenennung
ins Leere. Nach Welle 2 waren es 56 Stellen in 29 Dateien; kein Test sieht sie,
denn es ist Prosa. Gezogen werden darf nur der Verweis, nie die Prosa: „von
Einladung zu Einladung" in einer Mail-Vorlage muss stehen bleiben. Erkennung
über den Kontext (Backtick, Punkt-Notation, „s. "), Skript im Scratchpad der
Sitzung; ein Alternations-Regex über alle Namen, sonst läuft es minutenlang.
**Für jede weitere Welle mitmachen.**

**Die Lehre für die Wellen 2 bis 8:** Drei billige Wächter hätten vier der fünf
Sorten gefunden, und alle drei sind ein Skript, kein Lesedurchgang:

1. alle Client-Pfade gegen die registrierten Fastify-Routen,
2. alle `$('…')`-Selektoren gegen die IDs der zugehörigen HTML-Datei (vor
   Welle 4 und 6 Pflicht, denn dort wandern die DOM-IDs wirklich),
3. alle `value="…"` und `data-*="…"` in den HTML-Dateien gegen die Ist-Werte
   der Abbildungstabelle aus bereits gebauten Wellen.

**Gebaut am 2026-08-20 als [test/client-vertrag.test.ts](../../test/client-vertrag.test.ts).**
Gegenprobe: Die drei echten Fehler dieses Tages einzeln zurückgespielt, jeder
wurde gemeldet (toter Admin-Pfad, `$('library')`, `<option value="nutzer">`),
danach wieder entfernt und alles grün. Drei Dinge, die beim Bau aufgefallen sind
und die man beim nächsten Anfassen leicht kippt:

- **Wächter 3 darf nicht über Feldnamen raten.** Der erste Anlauf verglich die
  id des `<select>` mit dem Feldnamen des Server-Schemas und übersah genau den
  echten Fehler: Die id ist deutsch (`kd-rolle`), das Feld englisch (`role`).
  Jetzt liest er die Abbildungstabelle, die beide Seiten kennt.
- **`GEBAUTE_WELLEN` ist Handarbeit** und die einzige Stelle, an der der Wächter
  still zu wenig prüfen kann. Wer Welle 2 baut, trägt die `2` dort ein, im
  selben Commit wie `status` und `stand` des Konzepts.
- **Drei Ausnahmen stehen benannt im Test** (`data-spur`, `data-wlevel`,
  `data-modus`): Homonyme, die wie Vertragswerte heißen, aber nie zum Server
  gehen. Genau der Fall, für den die Tabelle eine Fundort-Spalte hat.

Der Body-Abgleich (1) muss dabei **jeden Aufruf** sehen, nicht nur die mit einem
Objektliteral direkt im `options`-Objekt: Die Konto-Dialoge reichen ihre Felder
an eine Hilfsfunktion weiter (`sende(url, daten, methode)`), und genau dort
standen vier deutsche Schlüssel, die der erste Scan übersah (`an` statt
`enabled` zweimal, `passwort` statt `password`, `alt`/`neu` statt `old`/`new`).
Und er muss **`scripts/` einschließen**: `seed-demo-touren.mjs` und
`import-gpx.mjs` sprechen dieselbe API, bauen Upload-Manifeste und lasen
`login.benutzer` — ihre Bezeichner wandern erst in Welle 6, ihre API-FELDER
gehören aber in Welle 1.

Die fünfte Sorte (Feldnamen der Antwort, hier `user` gegen `benutzer`) bleibt
Handarbeit oder braucht generierte Client-Typen — das wäre ein eigenes Vorhaben
und steht bewusst nicht in diesem Konzept.

## Nahtliste §3.3, Zeile für Zeile

| Naht | Ergebnis |
|---|---|
| API-Felder Server → Web | gezogen. Die Gegenprobe war ein Abgleich der Pfade in `api.md` mit den registrierten Fastify-Routen in beide Richtungen: keine dokumentierte ohne Route, keine Route ohne Eintrag. Dabei fielen elf Client-Aufrufe auf alte Adressen auf (`/api/galerie`, `/api/auth/me/geraete`, `/api/audio-bibliothek`, …) und fünf Stellen, die die Fehlerhülle als `koerper.fehler` lasen. Der Smoke über die Seiten steht noch aus |
| API-Felder Server → Android | gezogen. `ApiClient.kt` samt Data Classes; die String-Vergleiche stehen auf `"ready"`/`"failed"`/`"processing"` (`TourenScreen.kt`, `ImportViewModel.kt`, `UploadWorker.kt`) |
| `edits.json` ← Android | gezogen. `EditsFortschreibung.kt` schreibt `media`, `cover`, `caption` und `maptale/edits@2` |
| `test/fixtures/film-axis.json` | angefasst, obwohl Welle 5: die Moment-Arten sind Vertragswerte (`orbit`/`ascend`/`linger`). Fixture, Web-Hälfte und Server-Spiegel im selben Commit |
| Server-Spiegel ohne Import | unberührt geblieben, Drift-Wächter grün. `STUDIO_PEGEL` heißt `STUDIO_GAIN`, der Wächter zieht mit |
| Text-Wächter | einer war rot, und zwar zu Recht: `test/newsletter-einwilligung.test.ts` baute die Label-Präfixe (`registrierung-…`) aus dem Quellen-Schlüssel. Der Wortlaut-Nachweis nach Art. 7 bleibt deutsch, also steht die Zuordnung jetzt ausdrücklich im Wächter |
| Messskripte | unberührt (Welle 5) |
| `vite.config.js` → `src/routen.ts` | unberührt (Welle 6) |
| `camera[].preset` → `PRESETS` | gezogen, beide Stellen im selben Commit: die Schlüssel von `PRESETS` in `src/tour.ts` (`near`/`mid`/`far`), die `data-preset` in `erlebnis.html` und der Vergleich `k.preset === 'default'` in `src/main.ts` |
| `verarbeite` in `routes/tours.ts` | exportiert als `processTour`, vor der Start-Migration |
| Push-Nutzlast Server → App | gezogen. `{ type: 'import-finished' }` auf beiden Seiten; nachgeprüft an `push.ts` gegen `MaptalePushDienst.kt` |
| Vhost | unberührt — das Präfix `/api/` bleibt |
| WebView-Brücke | unberührt (Welle 5/7) |
| CSS-`<link>`-Namen | unberührt (Welle 6) |
| Extern registrierte URLs | wortgleich geblieben (`/api/tracker/:provider/callback`, `/api/webhooks/tracker/:provider`) |
| Mail-Links auf die API | `/api/export/:token` bleibt wortgleich, ein laufendes Archiv überlebt den Umbau also. `/api/newsletter/ein-klick/:token` heißt jetzt `/one-click/` — Teil B ist nicht gebaut, es gibt keinen versendeten Link |

## Entscheidungen unterwegs

- **Reihenfolge:** Der DB-Leiter-Schritt und seine Leser stehen in EINEM Zug,
  nicht getrennt. Ein Zwischenstand mit englischen Spalten und deutscher API
  hätte eine Übersetzungsschicht gebraucht, die §2.3 gerade verbietet. Die
  Start-Migration für die JSON-Dateien kommt NACH den Verträgen, die sie
  abbildet — vorher gäbe es die Zielnamen nicht.
- **Indexnamen gehen mit** (`idx_exporte_laufend` → `idx_data_exports_running`
  usw.). Sie stehen in keiner Zeile der Abbildungstabelle, tragen aber die alten
  Tabellennamen im Wort und fielen sonst beim Abnahme-Grep aus §8 auf. Reine
  DDL-Bezeichner ohne Leser ausserhalb von `db.ts`.
  **Entschieden 2026-08-20 (Abnahme der offenen Punkte):** ja, sie gehen mit; die Tabelle trägt jetzt eine `db-index`-Zeile.
- **`titelbild/<ts>.jpg` wird `banner/<ts>.jpg`** (Upload-Ordner im
  Benutzer-Storage). §4.2 verlangt die Umbenennung der Benutzer-Ordner, die
  Tabelle hat dafür keine Zeile. Der Ordner `daten/benutzer/` selbst bleibt
  vorerst.
  **Entschieden 2026-08-20 (Abnahme der offenen Punkte):** so bleibt es; Tabellen-Zeile nachgetragen (`ordner`, Welle 1).
- **`#tracker=`-Werte bleiben deutsch.** §3.4 friert sie ausdrücklich ein, die
  Abbildungstabelle nennt sie im Fundort zweier `api-wert`-Zeilen trotzdem
  (`abgelaufen`, `fehler`). Nach der Rangfolge der Quellen gilt §3.4.
  **Entschieden 2026-08-20 (Abnahme der offenen Punkte):** §3.4 gilt, die Werte bleiben deutsch; die zwei Fundort-Nennungen sind nur Kontext, keine Aufträge.
- **`GET /api/tracker/providers` antwortet `{ providers: […] }`.** Die Tabelle
  bildet `anbieter` auf `provider` ab; hier ist der Schlüssel eine LISTE, und
  `provider` für ein Array wäre falsch.
  **Entschieden 2026-08-20 (Abnahme der offenen Punkte):** `providers` ist richtig (§6.0 Regel 4, Sammlungen Plural); Tabellen-Zeile nachgetragen.
- **Nicht angefasst, weil die Tabelle keine Zeile hat:** die übrigen Felder von
  `VorlagenEintrag` in der Antwort von `GET /api/admin/mail-templates`
  (`name`, `anlass`, `platzhalter[].name|beschreibung|beispiel`, `hatLink`,
  `standard`). Sie sind Teil des API-Vertrags, stehen aber weder in §6.7 noch in
  der Tabelle.
  **Entschieden 2026-08-20 (Abnahme der offenen Punkte):** sie gehen mit, noch in dieser Welle umgesetzt:
  `anlass` → `occasion` (nicht `description` — das ist in derselben Datei schon
  die Zielform von `beschreibung`, die Kollision verböte der Wächter),
  `platzhalter` → `placeholders` (Typ `PlaceholderInfo`), `beschreibung` →
  `description`, `beispiel` → `example`, `hatLink` → `hasLink`, `standard` →
  `defaultContent` (nicht `default`: läse sich neben `customized` wie ein
  Boolean). `name` war schon englisch. Sechs Tabellen-Zeilen nachgetragen,
  beide Testwelten grün.
- **`daten/exporte/` bleibt** als Ablagename der Export-Archive: ein
  Datenordner, kein Bezeichner, und ein Umzug verwaiste laufende Archive.
- Der Ordner `public/audio/sfx/`, die Fragment-Schlüssel der Mail-Links und die
  `MAPTALE_*`-Variablen bleiben wortgleich (§3.4).
