---
stand: 2026-08-20
status: Welle 1 in Arbeit — Verträge, Clients, Start-Migration und Specs stehen; offen ist die Abnahme nach §8
betrifft:
  - server/src/db.ts
  - server/src/routes/
  - docs/concepts/konzept_codebase_english_refactoring.md
  - docs/specs/abbildungstabelle.tsv
systemteile:
  - server
icon: buchstaben
---

# Welle 1: Stand und Übergabe

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

1. **Der Blick auf die Seiten.** Die Touren sind gegen den Leser des Players
   geprüft, nicht im laufenden Player angesehen — dafür bräuchte es eine zweite
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

Zwei Lehren: **Wer an einer Start-Migration baut, stoppt vorher die Dev-Instanz**
(`devhub down journey`) oder zeigt mit `MAPTALE_DATEN_DIR` auf eine
Wegwerf-Kopie. Und die Dateimigration hängt am MARKER, nicht an der Datei —
der Zustand „Marker 2, Ordner unmigriert" ist im Entwurf nicht vorgesehen und
heilt sich nicht selbst (das Nachrendern schon, aber nur für Touren, die die DB
noch kennt). Für Prod ist das unkritisch (dort läuft einmal fertiger Code),
aber ein Kandidat für einen billigen Wächter in einer späteren Welle:
`.schema` = 2 und trotzdem eine `anreicherung.json` gefunden = laute Warnung.

## Nahtliste §3.3, Zeile für Zeile

| Naht | Ergebnis |
|---|---|
| API-Felder Server → Web | gezogen. Die Gegenprobe war ein Abgleich der Pfade in `api.md` mit den registrierten Fastify-Routen in beide Richtungen: keine dokumentierte ohne Route, keine Route ohne Eintrag. Dabei fielen elf Client-Aufrufe auf alte Adressen auf (`/api/galerie`, `/api/auth/me/geraete`, `/api/audio-bibliothek`, …) und fünf Stellen, die die Fehlerhülle als `koerper.fehler` lasen. Der Smoke über die Seiten steht noch aus |
| API-Felder Server → Android | gezogen. `ApiClient.kt` samt Data Classes; die String-Vergleiche stehen auf `"ready"`/`"failed"`/`"processing"` (`TourenScreen.kt`, `ImportViewModel.kt`, `UploadWorker.kt`) |
| `edits.json` ← Android | gezogen. `EditsFortschreibung.kt` schreibt `media`, `cover`, `caption` und `maptale/edits@2` |
| `test/fixtures/filmachse.json` | angefasst, obwohl Welle 5: die Moment-Arten sind Vertragswerte (`orbit`/`ascend`/`linger`). Fixture, Web-Hälfte und Server-Spiegel im selben Commit |
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
