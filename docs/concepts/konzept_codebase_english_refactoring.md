---
stand: 2026-08-20
status: Wellen 0 bis 3 gebaut; Welle 1 ist als v0.67.0 ausgeliefert, die Wellen 2 und 3 warten auf den nächsten Release. Wellen 4 bis 8 offen, Schritt 9 (Env) ganz am Ende. Was je Welle geschah, steht in ihrem Abschnitt.
betrifft:
  - server/src/db.ts
  - server/src/schema/edits.ts
  - server/src/schema/upload.ts
  - server/src/routes/auth.ts
  - server/src/routes/tours.ts
  - src/studio/api.ts
  - src/remote.ts
  - src/studio/editmodell.ts
  - src/studio/zeitleiste.ts
  - src/studio/tonklip.ts
  - src/studio/pruefung.ts
  - src/filmachse.ts
  - src/kartenmaler.ts
  - android/app/src/main/java/app/maptale/daten/Entities.kt
  - android/app/src/main/java/app/maptale/daten/LuhamboDb.kt
  - android/app/src/main/java/app/maptale/upload/ApiClient.kt
  - android/app/src/main/java/app/maptale/upload/EditsFortschreibung.kt
  - CLAUDE.md
  - docs/specs/austauschformat.md
  - docs/specs/overlay-und-tourjson.md
  - docs/specs/abbildungstabelle.md
  - docs/specs/api.md
icon: buchstaben
---

# Konzept: Codebase-Bezeichner auf Englisch

**Beschlossen.** Interne Bezeichner gehen auf Englisch, einschließlich aller
persistierten Verträge und der HTTP-API. Die vertagte Fassung vom 13.08. ist
überholt (§10), die früheren Fassungen vom 19.08. sind durch diese ersetzt (§0).

**Leitplanke:** Coding-Agenten übernehmen die Tipparbeit; Menschen halten
Glossar, Wellengrenze und Review. Kein Big-Bang. Kein Rückwärtsleser.

---

## 0. Was diese Fassung gegenüber der ersten vom 19.08. ändert

Die erste Fassung hatte Welle 1 als „DB + vier JSON-Dateien + Room" geschnitten
und sich darauf verlassen, dass der Compiler den Rest aufreißt. Ein Review gegen
den Code hat sieben Stellen gefunden, an denen das nicht trägt. Jede hat hier
ihren Abschnitt:

1. **Die HTTP-API ist ein Vertrag und fehlte.** 73 Pfade, rund 45 davon mit
   deutschen Wörtern, dazu deutsche Feldnamen in fast jeder Antwort. Web und
   Android tippen diese Typen von Hand nach, kein Compiler verbindet die Seiten.
   **Entschieden: die API geht mit**, Pfade und Felder, in Welle 1 (§3.2, §6.7).
2. **„Der Compiler reißt es auf" gilt nicht an den Nähten.** `server/` und
   `src/` sind getrennte `tsconfig`-Welten, Kotlin sieht nichts davon, und
   `EditsFortschreibung.kt` schreibt `edits.json` über ein rohes `JsonObject`.
   Die Nähte stehen jetzt als Liste (§3.3).
3. **Die Specs verlangen schon heute eine Versionserhöhung** („Schema-Änderungen
   erhöhen die `@`-Version", `austauschformat.md`). Die Kennung wird erhöht,
   ein Leser für die alte Fassung wird NICHT gebaut (§4.1). Das ist kein
   Kompatibilitätsweg, sondern die Fehlermeldung.
4. **„Keine Datenbewegung" stimmt nur für Spaltennamen.** Sieben Tabellen tragen
   deutsche Werte in `CHECK`-Constraints, dazu ein partieller Index auf
   `'laeuft'` und JSON-Blobs in Spalten. Werte gehen mit, und das ist je Tabelle
   ein Neubau, kein `RENAME` (§4.2).
5. **Der Einmal-Lauf war nicht betreibbar.** Ein gelöschtes Skript unter
   `scripts/` erreicht weder den Datenordner im Container noch die
   Dev-Instanzen noch einen Snapshot. Die JSON-Umschreibung wird eine
   eingecheckte **Start-Migration** neben der DB-Leiter, und `tour.json` wird
   nicht umgeschrieben, sondern **neu gerendert** (§4.3).
6. **Die Nutzer-Annahme hat Zahlen und eine Frist** (§4.5). Der APK hängt
   öffentlich an der Landing, Einladungen und Warteliste sind live, Play Store
   steht in der Roadmap davor.
7. **Android braucht Room v4 mit `fallbackToDestructiveMigration()`**, nicht
   nur eine Neuinstallation: Ein APK-Update derselben Signatur stürzt sonst beim
   Start ab (§4.4).

Dazu: Glossar-Lücken gefüllt (`export` als neues Homonym, `Aufnahme`, `Pause`,
API-Pfade), die Modultabelle vollständig, die Messskripte als blinder Fleck
benannt, Topf C korrigiert, ein Rückweg in §8.

**Ein drittes Review am Abend des 19.08.** (Agent adversarial gegen den Code,
57 Prüfschritte) hat zehn weitere Befunde ergeben; sie sind direkt in die
Abschnitte eingearbeitet: Env-Variablen und Fragment-Schlüssel als
eingefrorene Verträge (§3.4), die WebView-Brücke und die CSS-`<link>`-Namen
als Nähte (§3.3), SQL-Strings als in-Welt-blinder Fleck (§3.1, §8), die
korrigierte Re-Render-Mechanik samt `luhambo/*@1` (§4.3), Android als
`tour.json`-Leser (§3.2, §5), die korrigierten Enum-Fakten und WorkManager
(§4.4), `mail_templates.key`/`settings.key` und die Banner-Pfade (§4.2), das
`fehler`-Feld der Ablehnungsantwort und die App-Seite des Rückwegs (§4.1,
§8), dazu Zählkorrekturen (16 Tabellen, 7 CHECK-Tabellen), die
vervollständigte Dateiliste (§6.6) und fünf Glossar-Nachträge.

**Eine parallele Code-Prüfung vom selben Tag** (zweite Sitzung, am 19.08.
abends zusammengeführt) hat dieselbe Fassung unabhängig gegen den Code
gestellt. Was sie zusätzlich fand, steht an Ort und Stelle; die Stücke, die
den Bauplan ändern und nicht nur den Text: `mail_tokens.nutzlast` ist KEIN
JSON-Blob, sondern ein roher String (§4.2); die Platzhalter `{{frist}}`,
`{{groesse}}`, `{{austragenLink}}` stehen wörtlich im gespeicherten Text der
`mailvorlagen`-Zeilen und gehen im selben `UPDATE` mit (§4.2); der Marker
`daten/.schema` ist eine Leiter, kein Schalter (§4.3); das Re-Render schaltet
den Status je Tour und nicht für alle zugleich, weil Galerie und Profile hart
auf `bereit` filtern (§4.3); es gibt kein zod im Projekt (§4.3); `verarbeite`
ist heute nicht exportiert (§3.3); die Push-Nutzlast `typ: 'import-fertig'` und
der Import von `src/routen.ts` in `vite.config.js` sind Nähte (§3.3); die
kuratierten Klangdateien unter `public/audio/sfx/` sind persistierte DATEN und
wandern nicht (§3.4); `placement` trägt deutsche Werte und `stats.fotos` zählt
Medien, nicht Fotos (§6.9); dazu CSS, DOM und Custom Properties als eigene Sorte
(§6.10), `/api/push/geraete` (§6.7), das Front Matter der Doku (§7), der
Totalausfall der alten App im Deploy-Fenster (§5), neun Glossar-Zeilen und
die Abbildungstabelle als Werkstück von Welle 0 (§11).

---

## 1. Ziel und Nicht-Ziel

### Ziel

Interne Bezeichner auf **Englisch** vereinheitlichen: Funktionen, Typen,
Variablen, Dateinamen, DB-Tabellen und -Spalten, DB-Werte mit Codebedeutung,
JSON-Schlüssel und -Werte in allen vier Tour-Dateien, HTTP-API-Pfade unter
`/api/` und ihre Felder, Room-Tabellen, -Spalten und Enum-Speicherwerte,
DataStore-Schlüssel.

### Bleibt Deutsch

- UI-Texte, Mail-Vorlagen, Rechtstexte, Hilfetexte
- Commit-Messages, Produktchat, Konzepte und Specs als Prosa
- Der Inhalt der Tabelle `mailvorlagen` (Text, keine Struktur)
- Die Kennungen der Einwilligungs-Historie (`textfassung`, z. B.
  `registrierung-2026-08-06`): Das ist Beweismaterial nach Art. 7 DSGVO,
  kein Schlüssel

### Nicht-Ziel

- **Seiten-Pfade.** `/anmelden`, `/konto`, `/galerie`, `/@handle`, `/tour/t_…`
  sind Produkttext. Mehrsprachigkeit macht daraus `/de/anmelden` neben
  `/en/login` (→ [konzept_mehrsprachigkeit_i18n.md](konzept_mehrsprachigkeit_i18n.md)).
  Die API-Pfade unter `/api/` sind davon ausdrücklich **ausgenommen**: Sie sind
  Code, kein Produkttext, und gehen mit.
- Mehrsprachigkeit der Oberfläche (dasselbe Dokument)
- Modus-Konsolidierung → [modi-konsolidierung.md](modi-konsolidierung.md)
- Die Wurzel-`CLAUDE.md` zu kürzen (100 KB; war nach dem Aufräumen im August
  25 KB). Ein eigenes Thema, unabhängig von der Sprache.

### Ausgangslage, gemessen am 2026-08-19

| Bereich | Stand |
|---|---|
| Player-Kern (`src/*.ts`, 80 Dateien) | gemischt: englisches Prototyp-Erbe, deutscher Neubau darüber (`filmachse`, `filmuhr`, `kartenmaler`, `kartenschicht`, `einblendung`, `streckenanker`, `tourtexte`, `wetterhimmel`, `vollbild`, `karteninfo`, `exportfilm`, dazu die deutschen Ergänzungen in `tour.ts`, `ui.ts`, `main.ts`) |
| Studio, Konto, Profil, Admin, Galerie | deutsch |
| Server (`server/src`, 74 Dateien) | deutsch, Verträge gemischt (`upload@1` fast englisch, `edits@1` fast deutsch, `tour@1` gemischt) |
| Android (59 Kotlin-Dateien) | deutsch |
| SQLite | 16 Tabellen, `user_version` 22; 11 Tabellennamen und rund 80 Spalten deutsch, 7 `CHECK`-Wertemengen deutsch |
| HTTP-API | 73 Pfade, rund 45 mit deutschen Wörtern; Feldnamen überwiegend deutsch |

Grobzählung der `export`-Deklarationen: `src/` 816, `server/src/` 414, jeweils
**rund die Hälfte** mit deutschem Wortstamm (Heuristik über Stämme, nicht
belastbar auf zehn Prozent genau; die Größenordnung reicht für den Schnitt).

### Ein Nebengewinn und ein Nebenverlust

**Deutsch hat hier ein Homonym, das Englisch auflöst: `Karte`.** Landkarte
(`karteninfo`, `kartenstimmung`) und Foto-Karte (`kartenmaler`, `kartenschicht`,
`KARTEN_MASSE`) liegen beide im Player, beide werden pro Frame gezeichnet, eine
Suche nach `karte` findet beides. Auf Englisch `map` und `card`.

**Englisch schafft dafür eines: `export`.** Video-Export (`exportfilm.ts`,
`exportformat.ts`, `exportblatt.ts`) und DSGVO-Datenexport (`export.ts`,
`exportinhalt.ts`, `exportlauf.ts`, Tabelle `exporte`) hießen auf Deutsch schon
gleich und würden es auf Englisch erst recht. Das Glossar trennt sie als
`filmExport` und `dataExport` (§6.1). Dasselbe gilt für `Aufnahme` (der Vorgang
des Aufzeichnens gegen das einzelne Foto) und `Pause` (GPS-Stillstand gegen
angehaltene Wiedergabe).

### Agenten-Qualität

Englisch im Code macht Agenten **nicht** schlechter, solange Glossar und
`CLAUDE.md` mitziehen. Schlechter wird es durch **Halb-Umbau** (drei Synonyme
für eine Sache) und durch Docs mit alten Namen. Beides adressiert §7.

---

## 2. Spielregeln

1. **Das Glossar ist verbindlich.** Kein Agent erfindet Synonyme. Neue Begriffe
   zuerst in §6, dann im Code.
2. **Eine Welle = ein PR-Thema**, CI grün, kurzer manueller Smoke, dann weiter.
3. **Verträge werden EINMAL umgeschrieben.** Die Schema-Kennung steigt auf `@2`
   (§4.1); für `@1` gibt es **keinen Leser**, keine Aliase, keine dauerhafte
   Übersetzungsschicht. Die Umschreibung der Bestandsdaten ist eine
   eingecheckte, idempotente Start-Migration (§4.3), kein Lesepfad.
4. **Pro Welle Docs mitziehen** nach §7, nicht erst am Ende.
5. **UI-Strings nicht mit-refactorn.** Code `visibility`, Label „Sichtbarkeit".
6. **Was kein Compiler sieht, steht auf der Nahtliste** (§3.3) und wird in der
   Welle, die die Naht berührt, von Hand geprüft.

Vor dem Start in `CLAUDE.md` die Sprachregel anpassen (Welle 0):

> Code-Bezeichner Englisch (Glossar in
> `docs/concepts/konzept_codebase_english_refactoring.md` §6), einschließlich
> API-Pfaden unter `/api/`, DB-Schema und JSON-Schlüsseln. UI- und Produkttexte
> Deutsch. Doku und Chat Deutsch.

---

## 3. Die Verträge: Inventur

### 3.1 Was ein Vertrag ist

Alles, was **zwei getrennt kompilierte Seiten teilen** oder **auf Platte
liegt**. Getrennt kompiliert sind hier vier Welten: `src/` (Web), `server/src/`
(eigener `rootDir`, `tsconfig.json` der Wurzel schließt `server` aus),
`android/` (Kotlin) und die Skripte unter `scripts/` (nicht typgeprüft). Eine
Umbenennung innerhalb einer Welt fängt der Compiler; eine Umbenennung ÜBER eine
Grenze hinweg fängt niemand. Eine Ausnahme gilt auch INNERHALB der Server-Welt:
SQL steht als roher String in Hunderten `db.prepare(…)`-Aufrufen, Spalten wie
Werte (`SET status = 'fehler' WHERE status = 'verarbeitung'` in
[app.ts](../../server/src/app.ts), `KARTEN_SPALTEN` in
[gallery.ts](../../server/src/routes/gallery.ts), viele weitere). `tsc` bleibt
dabei grün; der Halt ist die Testsuite plus der Abnahme-Grep aus §8.

### 3.2 Die Verträge und ihre Leser

| Vertrag | Wo | Leser (außerhalb des Schreibers) | Kennung |
|---|---|---|---|
| SQLite-Schema | `server/src/db.ts` | nur Server | `user_version` 22 |
| `original/manifest.json` | Datenordner | Server (Pipeline), Android (Schreiber) | `maptale/upload@1` |
| `edits.json` | Datenordner | Server, Studio (über API), **Android** (`EditsFortschreibung.kt`, rohes `JsonObject`) | `maptale/edits@1` |
| `anreicherung.json` | Datenordner | nur Server (Cache) | `maptale/anreicherung@1` |
| `tour.json` | Datenordner | Player (`src/remote.ts`), **Android** (`ApiClient.kt` parst es aus `GET /api/tours/:id`: `ServerTourDetail`, Foto-Nachzug-Abgleich), Export-ZIP | `maptale/tour@1` |
| JSON in DB-Spalten | `tours.stats_json`, `rueckmeldungen.kontext`, `tracker_verknuepfungen.tokens` (`mail_tokens.nutzlast` ist ein roher String, §4.2) | Server, Web (`stats` in Listen) | keine |
| **HTTP-API** | `server/src/routes/*`, `server/src/app.ts` | Web (`src/studio/api.ts`, `src/remote.ts`, `src/konto`, `src/profil`, `src/admin`, `src/galerie`, `src/app-nav.ts`), **Android** (`ApiClient.kt`, `TourenScreen.kt`, `ImportViewModel.kt`, `TrackerModell.kt`) | keine |
| Room | `Entities.kt`, `LuhamboDb.kt` | nur App | Version 3, zwei Migrationen |
| DataStore | `api_token`, `email`, `server_url`, `fotos_automatisch` | nur App | keine |
| Cookies | `maptale_session`, `maptale_dabei` | Browser | keine |
| localStorage | `maptale.ansicht`, `maptale.editor.stimmung`, `maptale_profil_cache`, `maptale:weather`, `maptale:weather-int`, `maptale:music`, `maptale:audio`; sessionStorage `maptale:video-sound` | Browser | keine |
| WebView-Brücke | `maptale:hintergrund`/`maptale:vordergrund` (Events), `window.MaptaleApp.verlassen()` | App (`PlayerScreen.kt`) ↔ Player (`src/main.ts`) | keine |
| `postMessage`-Kanal | `src/exportformat.ts` | Studio ↔ Export-Rahmen, gleiche Welt | keine |
| `window.__j`, `window.__studio` | Player, Studio | **`scripts/messungen/*`** (Playwright) | keine |
| Query-Parameter | `?tour`, `?app`, `?dev`, `?pins3d`, `?reverse` | Android-WebView (`?app=1`), Bookmarks | keine |

**Was von der Tabelle in Welle 1 gehört:** die ersten sieben Zeilen und Room.
DataStore, Cookies, localStorage, Query-Parameter und der `postMessage`-Kanal
gehen in der Welle ihres Moduls mit (§5); bei den vier App-seitigen
DataStore-Schlüsseln ist ein Schlüsselwechsel eine Abmeldung, also ein
bewusster Schritt in Welle 7, nicht beiläufig.

### 3.3 Die Nähte, die kein Compiler sieht

Jede Welle, die eine dieser Stellen berührt, prüft sie von Hand und lässt den
zugehörigen Test laufen:

| Naht | Warum blind | Halt |
|---|---|---|
| API-Felder Server → Web | handgetippte Typen in `src/studio/api.ts`, `src/remote.ts`, `src/konto/*`, `src/profil/*`, `src/admin/*`, `src/galerie/*` | Welle 1 ändert beide Seiten in einem Commit; Smoke über alle Seiten (§8) |
| API-Felder Server → Android | `ApiClient.kt` Data Classes, String-Vergleiche auf `"bereit"`/`"fehler"` (`TourenScreen.kt:258`, `ImportViewModel.kt:119`) | Welle 1; App-Release im selben Tag wie der Server |
| `edits.json` ← Android | `EditsFortschreibung.kt` mit rohen Schlüsseln `"medien"`, `"titelbild"`, `"caption"` | Welle 1; Android-Unit-Test auf die neuen Schlüssel |
| `test/fixtures/filmachse.json` | EIN Fixture, zwei Testwelten (`test/filmachse.test.ts`, `server/test/filmtempo.test.ts`) | Welle 5 ändert Fixture und Server-Spiegel zusammen |
| Server-Spiegel ohne Import | `server/src/webpfade.ts`, `server/src/handle.ts`, `server/src/pipeline/filmtempo.ts`, `filmachse.ts`, `STUDIO_PEGEL` in `schema/edits.ts` | bestehende Drift-Wächter in `test/routen.test.ts`, `test/filmachse.test.ts`, `test/audio*.test.ts` |
| Text-Wächter | Tests, die Quelltext als Zeichenkette lesen (`test/newsletter-einwilligung.test.ts`, `test/session-hinweis.test.ts`, `test/routen.test.ts`, `test/basis-css.test.ts`) | laufen ohnehin; wer rot wird, passt den Wächter an, nicht den Code |
| Messskripte | `scripts/messungen/*.ts|mjs` importieren `src/filmachse`, `src/einblendung`, `src/kartenmaler`, `src/streckenanker`, `src/geo` und lesen `window.__j.filmachse`, `.filmS`, `.uhr`, `.exportMess`; `scripts/seed-demo-touren.mjs` importiert `src/tours` | Welle 5 zieht `scripts/messungen` mit, Welle 6 den Rest von `scripts/`; Abnahme: jedes Messskript einmal gestartet |
| `vite.config.js` → `src/routen.ts` | die Config importiert `EINSTIEGE`, `PFAD_ZU_DATEI`, `ROUTEN` und `tourAusPfad`; sie ist kein TypeScript und läuft in Vites eigenem Loader | Welle 6, im selben Commit. Fällt laut auf (die Config lädt nicht), steht aber sonst auf keiner Liste |
| `camera[].preset` → `PRESETS` in `src/tour.ts` | der Player löst den Wert über `PRESETS[name] ?? PRESETS.mittel` auf; der Rückfall ist STILL. Welle 1 benennt die Werte, `tour.ts` ist Welle 5: Dazwischen fiele jede Kamerakante auf „mittel" | Welle 1 zieht BEIDE Stellen im selben Commit mit: die Schlüssel von `PRESETS` UND den Vergleich `k.preset === 'standard'` in `src/main.ts` (`kamFolger`): `standard` steht gar nicht in `PRESETS`, sondern wird dort abgefangen und auf die Einstellung des Zuschauers gelegt; nach `default` liefe er in `distanzFuer`, fiele still auf „mittel" und überschriebe genau die Wahl, die er respektieren soll. `MODE_SCALE` bleibt, Modi wandern nicht |
| `verarbeite` in `routes/tours.ts` | heute NICHT exportiert; die Start-Migration aus §4.3 muss sie rufen | Welle 1 exportiert oder verschiebt sie, bevor die Migration entsteht |
| Push-Nutzlast Server → App | [push.ts](../../server/src/push.ts) sendet `{ typ: 'import-fertig', tourId, importId }`, [MaptalePushDienst.kt](../../android/app/src/main/java/app/maptale/push/MaptalePushDienst.kt) vergleicht `data["typ"] != "import-fertig"`. Schlüssel UND Wert deutsch, und die Leser liegen in verschiedenen Wellen (Server 2, App 7) | Welle 1, zusammen mit den übrigen API-Feldern. Sonst kommt jede Import-fertig-Meldung still nie mehr an |
| Vhost | `deploy/cloudpanel-nginx.conf` proxyt `/api`, `/@`, `/tour/`, `/umami` und die Sitemaps | unberührt, solange `/api/` Präfix bleibt |
| WebView-Brücke | `maptale:hintergrund`/`vordergrund` + `window.MaptaleApp.verlassen()` verbinden Welle 5 (Player) und Welle 7 (App); versagt LAUTLOS (Optional-Chaining schluckt den toten Exit, ohne das Hintergrund-Event kommt der Ton-Drift zurück) | Welle 5 lässt beide Kanäle unangetastet; Welle 7 ändert beide Seiten in EINEM Commit (derselbe Tag baut Web und APK) |
| CSS-`<link>`-Namen | `basis.css`, `grundelemente.css`, `werkzeug.css`, `rechtstext.css` hängen als `<link>` in den HTML-Köpfen, dazu `basisZuerst()` in vite.config.js | Welle 6 ändert HTML, CSS-Dateinamen und vite.config zusammen; danach jede Seite im Dev UND gebaut ansehen |
| Extern registrierte URLs | OAuth-Callback und Webhook der Tracker-Anbieter (`/api/tracker/:provider/callback`, `/api/webhooks/tracker/:provider`) | schon englisch, **bleiben wortgleich**; eine Änderung hieße Neuregistrierung beim Anbieter |
| Mail-Links auf die API | `/api/export/:token` (48 h gültig), `/api/newsletter/ein-klick/:token` (noch kein Versand live) | Welle 1 zu einem Zeitpunkt ohne laufenden Export; Newsletter-Versand ist Teil B und noch nicht gebaut |

### 3.4 Was ausdrücklich NICHT dazugehört

- **Seiten-Pfade** (§1). Auch `/@handle`, `/tour/t_…`, `/sitemap-*.xml`.
- **Tour-IDs** `t_…`: Das Präfix IST die Unterscheidung zu den kuratierten
  `TOURS` und steht so im Player-Vertrag.
- **Der Inhalt** von `mailvorlagen` (Ausnahme: die Platzhalter darin, §4.2),
  `newsletter_einwilligungen.textfassung` und allen Rechtstexten.
- **Extern registrierte Pfade** (Tracker-Callback, Webhook): schon englisch.
- **Die Ordnerstruktur je Tour** (`original/`, `media/`): schon englisch;
  `anreicherung.json` wird zu `enrichment.json` (§4.3).
- **Die WERTE der mitgelieferten Titelbilder** (`serpentinen.jpg`, `kueste.jpg`,
  `nachtstadt.jpg`, `wueste.jpg` unter `public/titelbilder/`): `users.titelbild`
  trägt sie als blanken Dateinamen, [profile-fields.ts](../../server/src/profile-fields.ts)
  baut daraus `/titelbilder/<name>`. Die Spalte wird umbenannt (§6.8), die
  Dateinamen selbst bleiben: Sie sind Daten, keine Bezeichner. Der ORDNER
  `public/titelbilder/` bleibt ebenfalls wortgleich: Sein Präfix baut der
  SERVER (`profilfelder.ts`, Welle 2), der Ordner liegt im Web-Build (Welle 6),
  zwei Wellen und zwei Compiler-Welten für einen Pfad, und ein statischer
  Ordnername ist kein Bezeichner. Die EIGENEN Uploads unter `titelbild/<ts>.jpg`
  sind der andere Fall und stehen in §4.2.
- **Die kuratierten Klangdateien** unter `public/audio/sfx/` (`amb-bach.mp3`,
  `amb-bergwind.mp3`, `mus-nachtfahrt.mp3`, …, 28 Stück). Ihre Namen sind als
  `audio[].datei` in jedem `edits.json` und als `src` in jedem `tour.json`
  PERSISTIERT; der Katalog steht in
  [sfxbibliothek.ts](../../src/studio/sfxbibliothek.ts), die acht
  Auto-Musik-Stücke gespiegelt in
  [music-choice.ts](../../server/src/pipeline/music-choice.ts) (Drift-Wächter in
  `test/studio-baukasten.test.ts`), `mus-nachtfahrt.mp3` zusätzlich in
  [tours.ts](../../src/tours.ts). Wer sie in Welle 5 oder 6 „mitnimmt", bricht
  jede Bestandstour mit Ton. Daten, keine Bezeichner. Die Motorloops
  `public/audio/eng-*.mp3` und die Wetter-Loops daneben sind der harmlosere
  Fall: nur `vehicle.ts`/`weather.ts` kennen sie, nie ein `edits.json`.
- **Die Umgebungsvariablen** (`MAPTALE_*`, gelesen in
  [config.ts](../../server/src/config.ts), rund 20 Stück, viele deutsch:
  `MAPTALE_DATEN_DIR`, `MAPTALE_ADMIN_PASSWORT`, `MAPTALE_HINTER_TLS` …). Sie
  werden aus einer VPS-`.env` und aus CI-Secrets gesetzt, die AUSSERHALB jedes
  Diffs liegen: Eine Umbenennung wäre unsichtbar, bis der Container mit dem
  Default `./daten` startet und der Datenordner leer aussieht. Sie bleiben
  **bis zum Schluss** wortgleich und wandern als eigener Ops-Schritt 9 NACH
  Welle 8 (§5), nie innerhalb einer Code-Welle: Sie hängen an keinem Vertrag
  und keinem Leser außer `config.ts`, können also zu jedem Zeitpunkt gehen, und
  am Ende ist der stille Konfigurationsfehler der einzige Schritt des Tages
  statt einer Nebensache im Lärm eines Migrations-Deploys. Drei Fakten dafür,
  die die parallele Prüfung erhoben hat: `konfigAusEnv` hat für fast alles
  eine Vorgabe, der Fehler ist also
  lautlos (Schaden bei `MAPTALE_HINTER_TLS`: Cookies ohne `Secure`;
  `MAPTALE_BASIS_URL`: Mail-Links auf `localhost:5173`; dazu Absender,
  Admin-Passwort, Speicher-Limit). Der Signaturschlüssel ist NICHT betroffen
  (`MAPTALE_COOKIE_SECRET` ist englisch, und
  [docker-compose.cloudpanel.yml](../../docker-compose.cloudpanel.yml) erzwingt
  ihn mit `${…:?}` beim Start). Und die `.env` allein reicht nie: Das
  Compose-File reicht jede Variable NAMENTLICH in den Container, und
  [server/Dockerfile](../../server/Dockerfile) setzt `MAPTALE_DATEN_DIR=/data`
  als Vorgabe; beide liegen im Repo.
- **Die Fragment-Schlüssel der Mail- und Einladungslinks** (`#einladung=`,
  `#newsletter-aus=`, `#email=`, `#reset=`, `#verify=`): Sie stehen in bereits
  verschickten Mails, und der Abmeldelink ist ausdrücklich ohne Frist
  (Art. 7 Abs. 3 DSGVO). Gebaut vom Server
  ([waitlist.ts](../../server/src/routes/waitlist.ts),
  [newsletter.ts](../../server/src/newsletter.ts), [auth.ts](../../server/src/routes/auth.ts)),
  geparst im Web ([konto.ts](../../src/konto/konto.ts),
  [studio.ts](../../src/studio/studio.ts)), ein drittes Mal gebaut in
  [adminmodell.ts](../../src/admin/adminmodell.ts): kein Compiler verbindet die
  Seiten. Eingefroren wie die Seiten-Pfade. `#tracker=` (Werte
  `verbunden/abgebrochen/abgelaufen/fehler`, OAuth-Rücksprung aus
  [tracker.ts](../../server/src/routes/tracker.ts), gelesen in
  [trackerkarte.ts](../../src/konto/trackerkarte.ts)) steht in keiner Mail und
  ist flüchtig; es friert der Einheitlichkeit wegen mit ein, dieselbe Naht,
  dieselbe Regel.
- **Die Notification-Kanal-IDs der App** (`aufzeichnung`, `importe`, `upload`,
  [LuhamboApp.kt](../../android/app/src/main/java/app/maptale/LuhamboApp.kt)):
  Sie persistieren je Installation SAMT den Einstellungen, die jemand pro
  Kanal getroffen hat. Bleiben wortgleich.

---

## 4. Persistenz und API als Einmal-Lauf

Der Bestand ist klein genug, dass der schwere Weg (Versionierung mit
Rückwärtslesern, Aliase, Doppelbetrieb) nicht nötig ist. Die Option verfällt
mit fremden Daten im System; §4.5 hält die Zahlen und die Frist.

### 4.1 Die Schema-Kennungen steigen auf `@2`, Leser für `@1` gibt es nicht

`austauschformat.md` §„Versionierung" sagt schon heute: „Schema-Änderungen
erhöhen die `@`-Version." Das gilt weiter. `maptale/upload@2`, `edits@2`,
`enrichment@2` (umbenannt, s. §4.3), `tour@2`. Was NICHT gebaut wird, ist ein
Leser für `@1`: Eine alte App, die `upload@1` sendet, bekommt **400 mit
Klartext** („App aktualisieren"), und die App zeigt ihn an. Ohne Erhöhung wäre
die Ablehnung ein opaker `additionalProperties`-Fehler, und `@1` hieße zwei
verschiedene Dinge. Der Satz in der Spec, das Backend „darf alte
Manifest-Versionen weiter annehmen", wird in Welle 1 ersetzt durch: „nimmt genau
die aktuelle an; ältere werden mit Hinweis abgelehnt."

Damit die Bestands-App den Hinweis auch ZEIGT, trägt genau diese eine
Ablehnungsantwort den Klartext zusätzlich im alten Feld `fehler` (neben
`error`): Die alte App liest ihre Fehlermeldungen aus `fehler`
([ApiClient.kt](../../android/app/src/main/java/app/maptale/upload/ApiClient.kt))
und zeigte sonst den rohen JSON-Body. Das ist die einzige bewusste
Alt-Ausnahme des ganzen Umbaus und im Code als solche markiert. Sie ist eine
Zeile in der Ablehnungsantwort und kein Rückwärtsleser: Sie gilt nur für
abgelehnte `@1`-Uploads und verschwindet zusammen mit der Start-Migration in
Welle 8, nicht früher. Gebraucht wird sie, solange irgendwo eine alte App
laufen kann; die Start-Migration dagegen läuft schon beim ersten Start des
neuen Servers.

**Mit `@2` fällt auch der Alt-Alias `luhambo/…@1`.** `remote.ts` akzeptiert
heute `luhambo/tour@1` gleichberechtigt neben `maptale/tour@1`, die
Schema-Köpfe von `upload.ts` und `edits.ts` nennen `luhambo/upload@1` und
`luhambo/edits@1` kompatibel. Die Start-Migration erkennt beide alten Kennungen
(§4.3); der neue Code kennt nur noch `maptale/…@2`. Das ist Teil dieser Welle
und keine Nachlässigkeit.

### 4.2 SQLite: Spalten per `RENAME`, Werte per Neubau

**Spalten und Tabellen** sind ein weiterer Schritt in der `user_version`-Leiter
([server/src/db.ts](../../server/src/db.ts)) mit `ALTER TABLE … RENAME COLUMN`
und `RENAME TO`. Keine Datenbewegung. 11 Tabellennamen und rund 80 Spalten, die
vollständige Abbildung steht in §6.8.

**Werte** sind etwas anderes. Sieben Tabellen tragen deutsche Werte in
`CHECK`-Constraints, und `RENAME COLUMN` kann die nicht ändern (die achte
Zeile der Tabelle, `mail_tokens.zweck`, ist schon englisch und bleibt):

| Tabelle | Spalte | Werte heute | Werte danach |
|---|---|---|---|
| `tours` | `status` | `angelegt, verarbeitung, bereit, fehler` | `created, processing, ready, failed` |
| `users` | `rolle` | `nutzer, admin` | `user, admin` |
| `exporte` | `status` | `laeuft, fertig, fehler` | `running, done, failed` |
| `newsletter_einwilligungen` | `zustand` / `quelle` | `an, aus` / `registrierung, konto, abmeldelink` | `on, off` / `signup, account, unsubscribe_link` |
| `rueckmeldungen` | `status` | `offen, in_arbeit, erledigt` | `open, in_progress, done` |
| `tracker_importe` | `status` | `wartet, laeuft, fertig, fehler, uebersprungen` | `pending, running, done, failed, skipped` |
| `tracker_verknuepfungen` | `status` | `aktiv, abgelaufen, getrennt` | `active, expired, disconnected` |
| `mail_tokens` | `zweck` | `verify, reset, email` | bleibt |

Jede dieser Tabellen wird nach dem SQLite-Rezept neu gebaut (neue Tabelle
anlegen, `INSERT … SELECT` mit `CASE` über die Werte, alte löschen, umbenennen,
Indizes neu anlegen). Der partielle Index `idx_exporte_laufend … WHERE status =
'laeuft'` entsteht dabei als `WHERE status = 'running'` neu. Das ist
Datenbewegung, in Sekunden erledigt, aber sie gehört benannt: Der
Migrationsschritt läuft in einer Transaktion, und der Test, der die Leiter von
Version 0 hochfährt, bekommt je Tabelle eine Zeile mit altem Wert, die danach
den neuen tragen muss.

**JSON-Blobs in Spalten** (`tours.stats_json` mit `fotos`, `spur`;
`rueckmeldungen.kontext`; `tracker_verknuepfungen.tokens`) werden im selben
Migrationsschritt per `UPDATE` über die Glossartabelle umgeschrieben. `tokens`
trägt nur fremde Schlüssel und bleibt. **`mail_tokens.nutzlast` ist KEIN
Blob**, sondern ein roher String (die neue Mail-Adresse beim Adresswechsel,
[auth.ts](../../server/src/routes/auth.ts), `eingeloest.nutzlast`); dort wird
nur die Spalte zu `payload`, der Inhalt bleibt unangetastet. Wer ihn als JSON
zu lesen versucht, findet keine Schlüssel und „repariert" ihn im schlimmsten
Fall.

**Und zwei Tabellen tragen deutsche Schlüssel als ZEILEN ohne `CHECK`:**
`mailvorlagen.schluessel` (nach §6.8 `mail_templates.key`) hält die
Admin-Abweichungen unter den Code-Schlüsseln `verifikation`, `email-wechsel`,
`warteliste`, `warteliste-einladung`
([mail-templates.ts](../../server/src/mail-templates.ts));
`einstellungen.schluessel` (`settings.key`) die Betriebs-Schalter
`einladung_pflicht` und `warteliste_offen`. Beide bekommen im selben
Migrationsschritt ein `UPDATE … SET key = CASE …` und je eine Zeile im
Leiter-Test. Ohne das fällt der neue Code STILL zurück: Die im Admin
angepasste Vorlage wird unter `verification` nicht gefunden und der
Code-Standard verschickt, `einladung_pflicht` gilt wieder als ungesetzt (die
Vorgabe ist zufällig „zu").

**Die Platzhalter in gespeicherten Vorlagen gehen mit.** `mailvorlagen.ts` nutzt
`{{link}}`, `{{code}}`, `{{name}}`, `{{frist}}`, `{{groesse}}`,
`{{austragenLink}}`. Die letzten drei sind deutsch und stehen **wörtlich im
Inhalt** der `mailvorlagen`-Zeilen, den §1 sonst deutsch lässt. Wer sie nur im
Code umbenennt, lässt jede angepasste Vorlage künftig `{{frist}}` als Klartext
in die Mail rendern. Also: Code UND gespeicherter Text im selben `UPDATE`. Das
ist die eine Stelle, an der die Migration Produkttext anfasst, und sie fasst
nur die Platzhalter an, nicht die Sprache drumherum.

**`users.titelbild` und `users.avatar` speichern PFADE** in deutsche
Ordner (`titelbild/<ts>.jpg`, `avatar/<ts>.jpg`,
[routes/auth.ts](../../server/src/routes/auth.ts)); der Satz „Ordnerstruktur
schon englisch" aus §3.4 gilt nur je Tour. Die Start-Migration benennt die
Benutzer-Ordner um und schreibt die Werte im selben Schritt: Nur die Spalte
umzubenennen bräche jedes Banner, nur die Werte ohne die Dateien ebenso.

### 4.3 JSON auf Platte: Start-Migration, und `tour.json` wird neu gerendert

Die erste Fassung wollte ein Einmal-Skript unter `scripts/`, das nach dem Lauf
gelöscht wird. Das scheitert am Betrieb: Auf dem Server läuft nur die API im
Container, die Daten liegen unter `/srv/maptale/daten`; jede Dev-Instanz, die
Smoke-Instanz (`MAPTALE_DATEN_DIR`) und jeder Snapshot von vor Welle 1 brauchen
dasselbe Werkzeug; und zwischen `docker compose up` des neuen Images und dem
Skriptlauf läse der neue Code alte Schlüssel.

Deshalb: **eine Start-Migration im Server, neben der DB-Leiter.** Der Marker
`daten/.schema` ist eine LEITER wie `user_version` und kein Schalter: Wird die
Welle nach §5 in fünf Teilschritte gebrochen, bringt jeder seinen eigenen Stand
mit (2, 3, 4 …), sonst läuft der zweite Schritt gegen Daten, deren Stand er
nicht kennt, oder gar nicht. Beim Start
liest der Server `daten/.schema` (Marker, heute nicht vorhanden = Stand 1),
durchläuft bei Stand 1 alle Tour-Ordner, bildet die Schlüssel von
`original/manifest.json`, `edits.json` und `anreicherung.json` nach der
Glossartabelle ab, benennt `anreicherung.json` in `enrichment.json` um,
schreibt die Kennungen auf `@2` und setzt den Marker auf 2. Idempotent, in
einer Transaktion je Tour (Schreiben in `.neu`, dann `rename`), eingecheckt
unter `server/src/migrations/`. **Gleich englisch benannt**: Welle 0 hat die
Sprachregel schon gesetzt, und neu entstehender Code wäre sonst der erste
Verstoß gegen sie. Das ist **kein Rückwärtsleser**: Es liest die
alte Form genau einmal, in Ruhe, vor dem ersten Request. Sechs Regeln:

- **Die Abbildung ist dieselbe Tabelle wie im Code**, nicht zwei Listen. Sie
  steht als Datenstruktur in `server/src/migrations/keys-v2.ts` und wird
  von einem Test gegen die Schema-Dateien gehalten: Jeder neue Schlüssel muss im
  Schema vorkommen, jeder alte darf es nicht mehr. **Es gibt kein zod im
  Projekt**; die Verträge sind handgeschriebene JSON-Schema-Objekte plus
  TypeScript-Typen in `server/src/schema/*.ts`, und genau dagegen läuft der Test.
- **`tour.json` wird nicht umgeschrieben, sondern neu gerendert.** Nach der
  Migration rendert der Server jede Tour mit Status `ready` neu, und zwar
  SERIELL und über den Edits-Speichern-Pfad
  (`verarbeite(app, id, { frisch: false })`, heute nicht exportiert, s. §3.3),
  nicht über `reprocess`: Der ist
  per Definition `frisch: true` und verwirft genau den Cache, den dieser Lauf
  braucht ([tours.ts](../../server/src/routes/tours.ts)). Wer sich hier vertut,
  bezahlt für jede Bestandstour Bildanalyse, Reverse-Geocoding und Wetter und
  macht aus einem Fenster von Minuten eines von Stunden. Eine „Warteschlange"
  gibt es auch nicht; `app.verarbeitungen` ist eine Map sofort gestarteter,
  parallel laufender Promises, und parallel hieße: alle Touren gleichzeitig
  gegen Nominatim (1 req/s) und die bezahlte Bildanalyse. Das Nachholen hängt
  an der DATEI, nicht am Marker: Bei jedem Start wird jede `ready`-Tour, deren
  `tour.json` noch `@1` trägt, neu gerendert, bis keine mehr da ist. Damit
  heilt sich ein Absturz mitten im Lauf von selbst. Touren, die zum
  Migrationszeitpunkt in `verarbeitung` oder `fehler` stehen, bekommen kein
  automatisches Re-Render (ihr nächster `reprocess` rendert ohnehin frisch);
  die Abnahme in §8 zählt sie. Eine Schlüssel-Abbildung auf `tour.json`
  träfe nicht, was der neue Code anders ableitet, und die Bestandstouren-
  Rückfälle aus `CLAUDE.md` („tragen die alten Texte, bis sie neu gerendert
  werden"; `f` statt `filmS`; Alt-Kicker) erledigen sich dabei mit.
- **Der Status wechselt je Tour, nicht für alle zugleich.** Er wird erst
  unmittelbar vor ihrem Render auf `processing` gezogen und danach zurück; bis
  dahin antwortet `/api/tours/:id` für DIESE Tour mit `processing`, der Player
  zeigt das wie heute. Alle gleichzeitig umzustellen legt nicht nur den Player
  still: Galerie, Profile und die Tour-Sitemap filtern hart auf
  `status = 'bereit'` ([gallery.ts](../../server/src/routes/gallery.ts),
  [pages.ts](../../server/src/routes/pages.ts)), also wäre die öffentliche
  Galerie leer, jedes Profil zeigte null Touren, und jeder geteilte
  `/tour/t_…`-Link samt seiner Vorschaukarte antwortete mit Fehler. Gestaffelt
  ist immer nur eine Tour unsichtbar.
- **Die Abbildung nimmt auch die Alt-Kennungen `luhambo/*@1` an.**
  [upload.ts](../../server/src/schema/upload.ts),
  [edits.ts](../../server/src/schema/edits.ts) und
  [remote.ts](../../src/remote.ts) akzeptieren sie heute; die ältesten Touren
  tragen sie noch. Ohne die zweite Zeile in der Abbildung fielen genau die
  durch.
- **`enrichment.json` ist ein Cache.** Klemmt die Abbildung, wird die Datei
  gelöscht und beim Render neu gebaut (kostet Geocoding und Bildanalyse, nichts
  Unwiederbringliches). Die Migration bildet sie trotzdem ab, weil die
  Bildanalyse der teuerste Posten der Pipeline ist.
- **Die Signaturen werden NEU BERECHNET, nicht abgebildet.** `trimSignatur` und
  `videoSchnittSignatur` sind kein Schlüssel, sondern stringifiziertes JSON der
  Edits (`JSON.stringify(edits.trim)`, [enrichment.ts](../../server/src/pipeline/enrichment.ts)).
  Nach der Umbenennung `start/ende` und `vonS/bisS` passt die gespeicherte
  Zeichenkette nie wieder zur neu gerechneten: Jede Tour liefe in die volle
  Anreicherung, Geocoding und Bildanalyse inklusive. Die Start-Migration ruft
  deshalb dieselben Signatur-Funktionen über den migrierten Edits auf und
  schreibt das Ergebnis in die migrierte `enrichment.json` (Befund vom
  2026-08-19, Review der zweiten Fassung).

Die Start-Migration bleibt im Code, solange irgendwo Stand-1-Daten liegen
können (Snapshots, Geräte des Betreibers). Sie wird in einer späteren Welle
entfernt, wenn der Marker überall 2 ist; das ist ein eigener Commit mit dem
Satz „ab hier ist Stand 1 nicht mehr lesbar."

### 4.4 Android: Room v4, destruktiv, einmal

Room steht auf Version 3 mit zwei Migrationen.
[LuhamboDb.kt](../../android/app/src/main/java/app/maptale/daten/LuhamboDb.kt)
verzichtet heute ausdrücklich auf `fallbackToDestructiveMigration`, mit der
Begründung, auf dem Gerät lägen unwiederbringliche Aufnahmen. Für diesen einen
Schritt gilt das nicht (nur Geräte des Betreibers, §4.5). Aber **„Neuinstallation
statt Migration" ist ein Code-Schritt**: Ein APK-Update derselben Signatur
(CI-Keystore) auf ein Gerät mit v3 stürzt ohne Migration beim Start ab. Also:
Version 4, `fallbackToDestructiveMigration()` im Builder, der Kommentar im
selben Commit umgeschrieben. Nach Welle 7 kommt die Zusage zurück: Aufruf raus,
Kommentar wieder hin, ab v5 wieder echte Migrationen.

Mit umzubenennen sind die **Enum-Speicherwerte**, aber nur zwei Enums
speichern überhaupt per `.name`: `TourStatus` (`AUFNAHME, ENTWURF, LAEDT_HOCH,
HOCHGELADEN, FEHLER`) und `MediumUploadStatus` (`LOKAL, HOCHGELADEN`), s.
`EnumKonverter` in
[LuhamboDb.kt](../../android/app/src/main/java/app/maptale/daten/LuhamboDb.kt).
**`Modus` speichert `.schluessel`** und die sind schon englisch (`walk`,
`bike`, …): Wer den Converter auf `.name` „vereinheitlicht", schreibt `WALK`
in die DB und ins Manifest und bricht den `upload@2`-Vertrag, dessen Werte
gerade NICHT wandern. Und **`Bewegungsart` liegt in keiner Tabelle** (kein
Converter, lebt nur im Speicher der Aufzeichnung): reine Kotlin-Umbenennung
in Welle 7, keine Speicherwerte. Die Room-Tabellennamen (`touren`, …) und
Spalten (`titel`, `beschreibung`, `endeMs`, `distanzM`, `genauigkeitM`,
`aufgenommenMs`, `ankerLng`, `typ`, `datei`, `modusAutomatisch`) gehen mit;
bei destruktiver Migration ist das eine Umbenennung im Code, sonst nichts.

**WorkManager ist ein zweites Room.** Er persistiert Worker-KLASSENNAMEN und
Unique-Work-Namen in einer eigenen, updatefesten Datenbank: `"upload-$tourId"`
([UploadWorker.kt](../../android/app/src/main/java/app/maptale/upload/UploadWorker.kt)),
periodisch `"tracker-abfrage"`, `"fotonachzug-$tourId"`. Ein APK-Update mit
umbenannten Worker-Klassen lässt eingereihte Uploads und den periodischen
Tracker-Abruf mit ClassNotFound scheitern; dieselbe Fehlerklasse, für die
oben Room v4 eingeführt wird, ein Stockwerk tiefer. Welle 7 cancelt beim
ersten Start einmalig die alten Unique-Works und reiht sie unter den neuen
Klassen neu ein. Die Notification-Kanal-IDs bleiben wortgleich (§3.4).

### 4.5 Die Annahme, und wann sie verfällt

Der leichte Weg steht auf drei Annahmen. Sie werden in Welle 0 **gemessen und
hier eingetragen**, nicht geglaubt:

| Annahme | Prüfung | Stand 2026-08-19 |
|---|---|---|
| Es gibt so gut wie keine fremden Nutzerdaten | `SELECT count(*) FROM users WHERE rolle='nutzer'`; `SELECT count(*) FROM tours WHERE owner_id <> <Betreiber>`; aktive `sessions`/`tokens` je Konto | **gemessen 2026-08-19: 0 fremde.** 3 Konten (2 davon `nutzer`), 15 Touren auf 2 Besitzer, alle Konten laut Betreiber seine eigenen |
| Der APK läuft nur auf Geräten des Betreibers | Download-Zahl des GitHub-Releases; `tokens`-Zeilen mit App-Label fremder Konten | **gemessen 2026-08-19: ja.** 17 Downloads über ~50 Releases (Muster 0–2 je Release), 3 App-Tokens auf 2 Konten, beide der Betreiber. Der Knopf hängt weiter öffentlich an der Landing, die Messung altert also |
| Ein Datenverlust wäre verschmerzbar | Betreiber-Entscheid, hier festgehalten | ja, laut Entscheid vom 19.08. |

**Das Tor ist damit offen** (Stand 2026-08-19): keine Zahl über der Schwelle,
§4 gilt wie beschlossen. Die Messung ist eine Momentaufnahme; liegt zwischen
ihr und dem Welle-1-Deploy mehr als ein Monat, wird sie wiederholt (drei
Abfragen, fünf Minuten).

Daraus zwei Regeln bis zum Ende von Welle 1: **Keine neuen Einladungen** aus
der Warteliste, und **Play Store** ([konzept_play_store_interner_test.md](konzept_play_store_interner_test.md))
kommt NACH dieser Welle, nicht davor; die Roadmap ist entsprechend sortiert.
Überschreitet eine der Zahlen die Schwelle (fremde Touren > 10 oder ein fremdes
App-Gerät), wird §4 neu entschieden, und dann heißt die Antwort Versionierung
mit Leser.

---

## 5. Reihenfolge der Wellen

| Welle | Inhalt | Risiko |
|------:|--------|--------|
| **0** ✅ | Zahlen aus §4.5, **Abbildungstabelle** gebaut und abgenommen (§11), Glossar eingefroren, Sprachregel in `CLAUDE.md`, DB-Snapshot, Abnahme-Checkliste, Roadmap sortiert | keins |
| **1** ✅ | **Verträge und ihre Leser**: SQLite (Spalten, Tabellen, Werte, Blobs), `upload@2`, `edits@2`, `enrichment@2`, `tour@2`, **HTTP-API** (Pfade und Felder), Room v4, Start-Migration, Re-Render, plus aller Code, der dadurch rot wird, plus die Nähte aus §3.3; die beiden Specs | mittel, und heute am billigsten |
| **2** ✅ | Server-Internals: Pipeline, Routen-Handler, Mail-Bausteine, Auth, Dateiumbenennungen in `server/src` | mittel |
| **3** ✅ | Studio, DOM-freie Module (`editmodell`, `zeitleiste`, `tonklip`, `pruefung`; `stopps` geht nach Tabelle mit Welle 5) | niedrig |
| **4** | Studio-Verdrahtung (`editor.ts`, `studio.ts`, `abspielen`, `exportblatt`, `nachreichen`, `sfxbibliothek`, `tipp`, `kartenstimmung`) + Dateiumbenennungen | mittel |
| **5** | Player-Engine (`tour`, `filmachse`, `filmuhr`, `kartenmaler`, `kartenschicht`, `einblendung`, `streckenanker`, `ui`, `main`, `exportfilm`, `exportformat`, `vollbild`, `karteninfo`, `tourtexte`, `wetterhimmel`, `pinmodell`) + `window.__j` + `scripts/messungen` + `test/fixtures/filmachse.json` mit Server-Spiegel | mittel |
| **6** | Übrige `src/`-Module: Konto, Profil, Admin, Galerie, die flachen Produktmodule (`routen`, `handle`, `app-nav`, `sichtbarkeit`, `passwort*`, `feedback*`, `einladungscode`, `session-hinweis`, `entwicklungsstand`, `rechtstextgliederung`, `dialogschicht`) + localStorage und sessionStorage | niedrig |
| **7** | Android: ViewModels, Screens, Services, Enum-Namen, DataStore-Schlüssel; Zusage in `LuhamboDb.kt` zurück | niedrig (nur eigene Geräte) |
| **8** | Doku nach §7: Topf A übersetzen, Topf C archivieren, Start-Migration ausbauen, wenn der Marker überall 2 ist | niedrig |
| **9** | Betrieb: die `MAPTALE_*`-Env-Variablen (§3.4) samt `docker-compose.cloudpanel.yml`, `server/Dockerfile`, CI-Secrets und den Runbooks in `docs/ops/`. Handgriff in drei Schritten: neue Namen ZUSÄTZLICH in die Server-`.env`, deployen, alte Zeilen entfernen. Kein Code-Rename in den Wellen davor, ein Ops-Schritt mit eigenem Rollback (`.env` zurück, voriges Image) | niedrig, aber still: kein Compiler, kein Test, kein Diff sieht den Fehler |

**Warum Welle 1 zuerst und nicht zuletzt.** Die Feldnamen sind das, worum sich
alles andere herumbaut. Käme sie zuletzt, hätte Welle 3 Typen umbenannt, deren
Felder deutsch bleiben mussten (`MediaEdit` mit `geloescht`, `reihe`,
`staerke`), und die späte Welle hätte dieselben Dateien ein zweites Mal
geöffnet. Zuerst die Verträge heißt: Jede spätere Welle arbeitet gegen bereits
englische Daten.

**Welle 1 ist die größte und die einzige irreversible.** Sie lässt sich nicht
klein schneiden, ohne genau die Übersetzungsschicht einzuziehen, die dieses
Papier vermeiden will. Wenn sie zu groß wird, ist die Bruchlinie **je Vertrag**
und in dieser Reihenfolge, jeder Schritt für sich atomar und deploybar:

1. SQLite + die API-Felder, die direkt aus Zeilen kommen (`users`, `tours`,
   Admin-Routen) + Web- und Android-Leser dieser Felder
2. `upload@2` + Android-Manifestbau + `POST /api/tours/:id/media`
3. `edits@2` + Studio-Typen + `EditsFortschreibung.kt`
4. `enrichment@2` + `tour@2` + Player-Leser + App-Leser (`ApiClient.kt`
   parst das Tour-JSON: `ServerTourDetail`, Foto-Nachzug) + Re-Render;
   App-Release am selben Tag, wie bei Schritt 1 bis 3
5. Alle ÜBRIGEN API-Pfade (rein mechanisch, zuletzt, weil sie nichts
   Fachliches ändern). `POST /api/tours/:id/medien` → `…/media` gehört zu
   Schritt 2: Er ist Teil des Upload-Vertrags und nicht bloß ein Pfad

Nicht nach Modul aufteilen. Jeder Schritt bringt seine Start-Migration und
seinen eigenen Marker-Stand mit (§4.3).

**Die Bruchlinie verkleinert das WEB-Risiko, nicht das Android-Risiko.** Schon
Schritt 1 ändert die Felder und Statuswerte, die die App liest; die Bedingung
„App-Release am selben Tag" gilt danach für jeden der fünf Schritte, also
fünfmal statt einmal. Wer den Split wählt, um die Kopplung zur App loszuwerden,
wählt ihn aus dem falschen Grund.

**Verhältnis zu Astro und i18n: beide kommen danach.** Entschieden am
2026-08-19. Der [Astro-Umstieg](konzept_astro_umstieg.md) fasst dieselben
Dateien an wie Welle 6 (`app-nav.ts`, `routen.ts`, die HTML-Einstiege), und
[Mehrsprachigkeit](konzept_mehrsprachigkeit_i18n.md) wartet auf Astro. Die
Kette ist Englisch, dann Astro, dann i18n: Wer zuerst umstellt, fasst jede
Datei einmal an. Die Gegenrichtung kostet nichts, weil Astro dann auf
englischen Modulnamen aufbaut.

### Welle 1: Schnitt

| Drin | Draußen |
|---|---|
| Spalten, Tabellen, Werte und JSON-Blobs in `db.ts` samt neuem Migrationsschritt (§4.2) | Seiten-Pfade, Tour-IDs |
| Felder und Werte in `schema/edits.ts` und `schema/upload.ts`, Kennungen auf `@2` | Inhalt von `mailvorlagen`, `textfassung` |
| Felder in `tour.json` und `enrichment.json`; Re-Render aller Touren | Prosa in `docs/` außer den zwei Specs |
| **API-Pfade unter `/api/` und alle Request-/Response-Felder** (§6.7) | extern registrierte Pfade (Tracker) |
| Web-Leser: `src/studio/api.ts`, `src/remote.ts`, `src/konto/*`, `src/profil/*`, `src/admin/*`, `src/galerie/*`, `src/app-nav.ts` (nur die API-Typen und Feldzugriffe, nicht die Modulnamen) | Umbenennungen, die weder Compiler noch Nahtliste verlangen |
| Android-Leser: `ApiClient.kt`, `Manifest.kt`, `EditsFortschreibung.kt`, `TourenScreen.kt`/`ImportViewModel.kt` (Statuswerte), `MaptalePushDienst.kt` (Push-Schlüssel, mit `push.ts`), Room-Entities, Enum-Speicherwerte, Room v4 | Android-Screens, ViewModels, Service-Namen (Welle 7) |
| Start-Migration in `server/src/migrations/` (entsteht gleich englisch, §4.3) | |
| `docs/specs/austauschformat.md` und `overlay-und-tourjson.md` | |

Die Regel, die trägt: In Welle 1 wird umbenannt, **was die Vertragsänderung rot
macht oder was auf der Nahtliste steht**. Alles, was ein Agent „bei der
Gelegenheit" mitnehmen möchte, gehört in seine Welle.

**Die beiden Specs gehören in dieselbe Welle**, nicht in Welle 8. Sie
beschreiben genau die Felder, die hier wandern; einen Commit lang falsch wären
sie die gefährlichste Datei im Repo.

**Deploy von Welle 1 ist EIN Tag**, der Server und App zusammen baut (das tut
der Release-Lauf ohnehin). Die App auf den Geräten des Betreibers wird am selben
Tag aktualisiert; bis dahin antwortet der Server einer alten App mit dem
Klartext aus §4.1, und zwar in beiden Feldnamen.

**Was eine alte App in diesem Fenster erlebt, ist ein Totalausfall**, nicht eine
Fehlermeldung: `session-aus-token` heißt anders (die Player-WebView bekommt
keine Sitzung), `/api/auth/me/profil` und `/api/push/geraete` sind 404, und die
Statuswerte der Tourliste sind unbekannt, also zeigt jede Tour „Wird
verarbeitet" ([TourenScreen.kt](../../android/app/src/main/java/app/maptale/ui/TourenScreen.kt)
fällt in den `else`-Zweig). Für die Geräte des Betreibers ist das tragbar.
Findet die Messung aus §4.5 ein FREMDES App-Gerät, ist es das nicht mehr, und
dann wird vorher eine tolerante App-Fassung ausgeliefert, die beide Feld- und
Wortmengen liest. Das ist ein Vorwärtsleser im eigenen Client für zwei Wochen
und kein Rückwärtsleser im Server.

### Welle 2: gebaut am 2026-08-20

427 Zeilen der Abbildungstabelle, 36 Moduldateien unter `server/src` und 16
Testdateien daneben. Umbenannt wurde token-basiert über den TypeScript-Scanner
und nicht per Textersetzung: Deutsche Kommentare, Mail-Texte und die alten
JSON-Schlüssel in `migrations/keys-v2.ts` sind Daten und mussten stehen bleiben.
Vier Dinge, die dabei aufgefallen sind:

- **`TrackerAnbieter` konnte nicht `TrackerProvider` heißen.** Unter dem Namen
  steht in derselben Datei seit je das Adapter-Interface, das der Tabellenbau
  als schon englisch überging. Die Union heißt `TrackerProviderId` (sie IST
  eine Kennung, §6.0 Regel 7), das Interface behält seinen Namen. 56 Typfehler
  in einem Zug, also der laute Fall. Der leise wäre gewesen, wenn beide Namen
  in verschiedenen Dateien gelegen hätten.
- **Der Tabellen-Prüfer sieht diese Sorte Kollision nicht.** Er vergleicht
  Zielformen gegeneinander, nicht gegen den Bestand. Wer eine Welle baut,
  prüft die Zielformen zusätzlich gegen die Namen, die schon englisch sind.
- **`PlatzhalterInfo` war schon halb gewandert.** Welle 1 hat den Typ als
  Beiwerk der Mail-Vorlagen-Antwort auf `PlaceholderInfo` gezogen; die Zeile
  dieser Welle sagt `PlaceholderDescription` (§6.0 verbietet `info`), und die
  gilt.
- **Die Testdateien folgen ihrem Modul**, wie §6.6 es verlangt, und haben jetzt
  ihre eigenen Tabellenzeilen. Ohne Zeile bleiben die fünf ohne eindeutiges
  Modul: `bildfassungen`, `medien-nachreichen`, `vertrag-tourjson`, `leiter`
  und der Helfer.

Rot geworden sind vier Text-Wächter im Web, und das war die gute Nachricht:
`routen.test.ts` (Server-Kopie `web-paths.ts`, `HANDLE_PATTERN`,
`MARKER_OPEN`/`MARKER_CLOSE`), `studio-baukasten.test.ts` (`WEATHER_MODES`,
`AUTO_MUSIC`), `newsletter-einwilligung.test.ts` (`CONSENT_TEXTS`) und
`markdown-links.test.ts` mit 60 toten Doku-Links. Angepasst wurde der Wächter,
nicht der Code.

### Welle 3: gebaut am 2026-08-20

Die vier DOM-freien Studio-Module `editmodell.ts`, `zeitleiste.ts`, `tonklip.ts`
und `pruefung.ts`, umbenannt wie Welle 2 über den TypeScript-Language-Service
(`findRenameLocations`), nicht per Textersetzung. Rot geworden ist dabei nur,
was Aufrufstelle ist: `editor.ts`, `studio.ts`, `stopps.ts`, `abspielen.ts`,
`nachreichen.ts`, `kartenstimmung.ts` und die Testdateien. Fünf Dinge, die dabei
aufgefallen sind:

- **`stopps.ts` bleibt deutsch.** Der Wellenplan oben zählt es zu Welle 3, die
  Abbildungstabelle stellt alle seine Zeilen auf 5 — und die Tabelle hat recht:
  `Stopp` und `NAHE_M` haben Zwillinge in [geo.ts](../../src/geo.ts), gehalten
  von einem Drift-Wächter. Angefasst wurde darin nur, was durch `editmodell`
  und `zeitleiste` rot wurde.
- **Zwei Zielformen der Tabelle kollidierten mit Welle 5**, und beide waren
  dort als „beim Umbau prüfen" markiert: `Achse` → `FilmAxis` trifft
  `Filmachse` → `FilmAxis`, `baueAchse` → `buildFilmAxis` trifft
  `baueFilmachse` → `buildFilmAxis` — und `zeitleiste.ts` IMPORTIERT beide aus
  [filmachse.ts](../../src/filmachse.ts). Der Editor-Typ heißt jetzt
  `TimelineAxis` / `buildTimelineAxis` (§6.3: Zeitleiste = `timeline`), der
  Name `FilmAxis` bleibt dem geteilten Modul. Dieselbe Sorte Befund wie
  `TrackerAnbieter` in Welle 2, nur diesmal in der Tabelle vorhergesehen.
- **`Fokus` heißt `EditorSelection`, nicht `Selection`.** Der bloße Name
  verdeckt den gleichnamigen lib.dom-Typ in jeder importierenden Datei; die
  Tabelle nannte die Ausweichform bereits.
- **Drei Eigenschaften bleiben deutsch, und das ist Absicht**: `breiteS`,
  `filmVon` und `filmBis`. `AxisStop` erfüllt strukturell `Halt` aus
  `filmachse.ts`, `StopInterval` spiegelt dessen `HaltIntervall` — die
  Umbenennung öffnet den Player-Kern samt Server-Zwilling und gehört nach
  Welle 5. Sie stehen mit dieser Begründung als eigene Zeilen in der Tabelle.
- **Die WERTE der modulinternen Unions bleiben**, obwohl ihre Felder wandern:
  `EditorSelection['kind']` (`modus`/`kamera`/`wetter`) teilt seine Wörter mit
  den `data-spur`-Werten und dem `GrenzArt` von `editor.ts`, `RulerMark.edge`
  (`anfang`/`ende`) baut die CSS-Klasse `am-anfang`, und `Message.tone`
  (`hinweis`/`warnung`) wird in `studio.ts` verglichen. Alle vier gehören damit
  in Welle 4, nicht hierher.

Neu in der Tabelle: 55 Zeilen — die Eigenschaften der Editor-Typen als Art
`property`, dazu `moveToSlot` (für `ordneEin`, das es in `nachreichen.ts` ein
zweites Mal gibt) und die „bleibt"-Zeilen. Modulinterne Variablennamen sind
mitgegangen, aber bewusst NICHT eingetragen: Sie haben keinen Leser außerhalb
ihrer Funktion, und 200 Zeilen davon machten die Tabelle für die Wellen danach
unlesbarer, nicht genauer.

### Wellen 3 bis 6: Namen

Die Umbenenn-Tabelle für `editmodell.ts` bleibt gültig und wird einfacher, weil
die Feld-Ausnahmen entfallen:

| Ist | Soll |
|-----|------|
| `Modus` | `TravelMode` |
| `WetterModus` | `WeatherMode` |
| `TrackPunkt` | `TrackPoint` |
| `MediumEdit` / `MediumEditPatch` | `MediaEdit` / `MediaEditPatch` |
| `ModusGrenze` / `WetterGrenze` | `TravelModeBoundary` / `WeatherBoundary` |
| `KameraPreset` / `KameraGrenze` | `CameraPreset` / `CameraBoundary` |
| `MomentArt` / `KameraMoment` | `CameraMomentKind` / `CameraMoment` |
| `AudioEintrag` | `AudioEntry` |
| `UndoStapel` | `UndoStack` |
| `TrackProjektion` | `TrackProjection` |
| `AnzeigeAbschnitt` | `DisplaySegment` |
| `MediumBasis` / `MediumAnzeige` | `MediaBase` / `MediaView` |
| `erfasseUndo` | `recordUndo` |
| `offsetZuIso` / `isoZuOffset` | `offsetToIso` / `isoToOffset` |
| `projiziereAufTrack` | `projectOntoTrack` |
| `punktZuOffset` | `pointAtOffset` (liefert den Punkt zu einem Offset) |
| `naechsterPunktIndex` | `nearestPointIndex` |
| `mitMedienEdit` | `withMediaEdit` |
| `mitModusGrenze` / `ohneModusGrenze` | `withTravelModeBoundary` / `withoutTravelModeBoundary` |
| `materialisiereModi` | `materializeTravelModes` |
| `mitTrim` | `withTourTrim` |
| `mitKameraGrenze` / `ohneKameraGrenze` | `withCameraBoundary` / `withoutCameraBoundary` |
| `mitWetterGrenze` / `ohneWetterGrenze` | `withWeatherBoundary` / `withoutWeatherBoundary` |
| `mitMoment` / `ohneMoment` | `withCameraMoment` / `withoutCameraMoment` |
| `mitAudioEintrag` / `ohneAudioEintrag` | `withAudioEntry` / `withoutAudioEntry` |
| `pruefeOverlay` | `validateOverlay` |
| `zerlegeFuerAnzeige` | `splitForDisplay` |
| `miniaturQuelle` | `thumbnailSource` |
| `effektiveMedien` | `effectiveMedia` |
| `LEERES_OVERLAY` / `HISTORIE_MAX` | `EMPTY_OVERLAY` / `HISTORY_MAX` |
| `WETTER_MODI` / `MODI` | `WEATHER_MODES` / `TRAVEL_MODES` |

### Welle 5: der Player

Die Wörter stehen in §6.3a, die Modulnamen in §6.6. Drei Dinge, die nur hier
vorkommen: `window.__j` wird zu `window.__maptale` mit englischen Schlüsseln
(`filmAxis`, `filmTime`, `clock`, `exportStats`), die Messskripte unter
`scripts/messungen/` ziehen im selben Commit mit, und
`test/fixtures/filmachse.json` wird zu `film-axis.json` mit englischen
Schlüsseln auf beiden Seiten (Web-Test und `server/test/filmtempo.test.ts`).

---

## 6. Glossar (verbindlich)

Synonyme in der rechten Spalte sind **verboten**, außer hier erlaubt. Neue
Begriffe zuerst hier eintragen, dann im Code verwenden. Die linke Spalte gilt
weiter für alles, was noch deutsch ist: ein Wort je Begriff. Drei Doppel sind
damit aufgelöst und werden beiläufig bereinigt, wenn eine Welle die Stelle
ohnehin öffnet:

| Begriff | verbindlich | Alt-Namen im Code | wo |
|---|---|---|---|
| Ort, an dem der Film anhält | **Halt** / `stop` | `Stopp`, `PlayerStopp`, `gruppiereStopps` | Player + `src/studio/stopps.ts` |
| Wie lange die Karte steht | **Standzeit** / `holdDuration`, Feld `holdS` | `haltedauerS` | `zeitleiste.ts`, `editor.ts` |
| Zeit, die der Film läuft | **Filmzeit** / `filmTime` | einheitlich | |

**Der eine Streitpunkt aus der ersten Fassung ist entschieden:** `stop` ist der
Ort, `hold` ist die Dauer dort. Beides ist im Englischen üblich (ein Kamera-
„hold" auf einem Motiv) und das Feld `holdS` existiert in drei Verträgen.

### 6.0 Namensformen

Das Glossar regelt die Wörter, dieser Abschnitt die Formen. Er gilt für jede
Welle; die Umbenenn-Agenten wenden ihn tausendfach an, also steht er hier und
nicht im Kopf eines Agenten-Prompts.

| Ebene | Form |
|---|---|
| Funktionen, Variablen, JSON-Felder | `camelCase` |
| Typen, Klassen, Interfaces, Enums | `PascalCase` (kein `I`-, kein `T`-Präfix) |
| Konstanten | `SCREAMING_SNAKE` |
| Dateinamen, API-Pfade | `kebab-case` |
| SQLite (Tabellen, Spalten) | `snake_case` |
| Kotlin-Enum-Speicherwerte | `SCREAMING_SNAKE` |

Dazu neun Regeln, jede eine Zeile:

1. **Einheiten stehen im Namen**: `…S` Sekunden, `…Ms` Millisekunden, `…M`
   Meter, `…Km` Kilometer; Zeitstempel `…At` (DB: `…_at`). Das ist heute schon
   Praxis (`holdS`, `filmS`, `RAMPE_M`) und bleibt Pflicht.
2. **Booleans** sind Adjektiv oder tragen `is`/`has`/`can` (`removed`,
   `enabled`, `canView`); nie negiert (kein `notVisible`, sondern `hidden`).
3. **Funktionen verb-first** nach Wirkung: `build…`/`load…`/`set…`/`validate…`,
   immutable Updates `with…`/`without…`, Handler `on…`. Ein Verb je Bedeutung:
   `load` für DB und Datei, nicht abwechselnd `fetch`/`get`/`read`.
4. **Sammlungen Plural, Element Singular**; Zähler heißen `…Count`
   (`file_count`), nie das Plural-Wort als Zahl.
5. **Amerikanisches Englisch**: `color`, `canceled`, `traveled`.
6. **Füllwörter verboten**: `data`, `info`, `manager`, `helper`, `util` als
   Namensbestandteil ohne Aussage.
7. **Abkürzungen** nur etablierte: `id`, `url`, `api`, `db`, `sfx`.
8. **`type` vor `kind`**: `type` für die Gattung eines Dings (`mediaType`);
   `kind` nur, wo `type` kollidiert oder schon vergeben ist (`moments[].kind`).
9. **Der Stil ist Werkzeug**: Prettier (`semi: false`, `singleQuote`,
   `printWidth 100`) und ESLint laufen im Deploy-Gate (eingeführt am
   2026-08-19, Format-Commit steht in `.git-blame-ignore-revs`). Die
   ESLint-Aus-Liste in [eslint.config.mjs](../../eslint.config.mjs) trägt
   Zählstände und schrumpft pro Welle; Kotlin folgt dem offiziellen
   Kotlin-Style (ktlint ist offen und kommt spätestens mit Welle 7).

### 6.1 Domain-Kern

| Deutsch / Ist | Englisch (Code) | Nicht verwenden / Hinweis |
|---|---|---|
| Tour (technisch) | `tour` | nicht `trip` |
| Halt (Foto-Halt) | `stop` | nicht `pause` |
| Halt-Intervall | `stopInterval` | |
| Halt-Stück (Aufnahme in der Kette) | `stopItem` | |
| Aufnahme (Vorgang des Aufzeichnens) | `recording` | `RecordingScreen`, `startRecording` |
| Aufnahme (das einzelne Foto/Video) | `medium` / `media` | nicht `capture`, nicht `shot`; im Halt `stopItem` |
| Aufnahmeart (Foto/Video) | `mediaType` | Android-Kamera: `captureMode` |
| Standzeit | `holdDuration`, Feld `holdS` | |
| Filmzeit | `filmTime`, Feld `filmS` | nicht wall-clock |
| Aufnahmezeit | `recordingTime` | |
| Anker | `anchor` | |
| Reihe (Ordnung im Halt) | `order` | Feld `reihe` geht in Welle 1 mit |
| Titelbild (Tour) | `cover` | |
| Titelbild (Profil) | `banner` | nicht `cover`, nicht `header` |
| Dachzeile | `kicker` | Feld `dachzeile` |
| Fortbewegung / Modus | `travelMode` | nicht UI-`mode` |
| Modus-Grenze | `travelModeBoundary` | |
| Sichtbarkeit (Tour) | `visibility` | getrennt von Profil und Suchindex |
| Pause (GPS-Stillstand) | `pause`, `collapsePauses` | |
| Pause (Wiedergabe angehalten) | `paused` | Zustand, nie `pause` als Substantiv |
| Overlay / Edits | `editOverlay` | |
| GPS-Spur | `track` | |
| Bahn der Zeitleiste | `lane` | nicht `track` |
| Ton-Zeile | `audioClip` / `audioTrack` | drittes „Spur": ohne Regel drei Synonyme (§6.3) |
| Pegel je Klip | `volume` | Feld `lautstaerke` → `volume` (§6.9) |
| Pegel, gerendert | `gain` | steht schon so im Tour-JSON (`audio[].gain`) |
| Pegel, Master | `masterGain` | `KURATIERTER_PEGEL` → `CURATED_GAIN`, `STUDIO_PEGEL` → `STUDIO_GAIN` |
| gelöscht (Overlay) | `removed` | Feld `geloescht` geht in Welle 1 mit |
| Video-Export | `filmExport` | nicht bloß `export` |
| Datenexport (Art. 20 DSGVO) | `dataExport` | Tabelle `data_exports` |
| Befund (Bildanalyse) | `finding` | |
| Befund (Upload-Prüfung) | `importReport` | |
| Fehler (Statuswert) | `failed` | §4.2; nie `error` als Status |
| Fehler (Feldname der Meldung) | `error` | §6.7; zwei englische Wörter für ein deutsches, bewusst getrennt |

### 6.2 Auth, Konto, Profil

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---|---|---|
| Benutzer | `user` | |
| Konto | `account` | nicht `profile` |
| Profil | `profile` | öffentlich |
| Anzeigename | `displayName` | |
| Handle | `handle` | nicht `username` |
| Einwilligung | `consent` | nicht `preference` |
| Textfassung (Rechtstext) | `textVersion` | Inhalt bleibt deutsch |
| Suchmaschinen (Schalter) | `searchIndexing` | nicht mit `visibility` mischen |
| Einladung | `invitation` | |
| Warteliste | `waitlist` | |
| Gerät (Sitzung/App) | `device` | |
| Sitzung | `session` | ist nicht App-Token |
| läuft ab am | `expiresAt` | |
| Rolle | `role`, Werte `user`/`admin` | |
| Speicher (Quota) | `storage` | |

### 6.3 Studio / Zeitleiste

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---|---|---|
| Zeitleiste (UI) | `timeline` | |
| Zustandsband | `stateBand` | kein Clip |
| Szenen-Klip | `sceneClip` | |
| Ton-Klip | `audioClip` | |
| Fokus (Auswahl) | `selection` | ist nicht Playhead |
| materialisiere… | `materialize…` | |
| mitX / ohneX | `withX` / `withoutX` | immutable Updates |
| baue… / setze… | `build…` / `set…` | |
| prüfe… | `validate…` / `check…` | |
| Trim (Tour) | `tourTrim` | Video: `mediaTrim` |
| Klangbibliothek | `audioLibrary` | |
| Nachreichen (Medien) | `addMedia` | Route `POST /api/tours/:id/media` |
| AchsenKurve (Zeit→Strecke) | `AxisCurve` | `zeitleiste.ts` |

### 6.3a Player und Film

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---|---|---|
| Karte (Landkarte) | `map` | |
| Karte (Foto-Karte) | `card` | der aufgelöste Homonym-Fall |
| Maler | `painter` | `kartenmaler` → `cardPainter` |
| Bühne | `stage` | |
| Schleier | `scrim` | nicht `veil`, nicht `overlay` |
| Klip (einer Aufnahme) | `clip` | |
| Filmuhr | `filmClock` | die eine Uhr der Engine |
| verworfene Frames | `droppedFrames` | |
| Filmachse | `filmAxis` | Abbildung Filmzeit ↔ Strecke; `timeline` ist die UI-Leiste |
| Halt-Intervall der Achse | `AxisStop` | `Halt` in `filmachse.ts`; NICHT `Stop` (der gruppierte Foto-Halt) und nicht `Hold` (die Dauer) — Abnahme 2026-08-20 |
| Rampe | `ramp`, `RAMP_M` | Tempowechsel, nicht nur am Halt |
| Streckenposition `s` | `s` | bleibt |
| Strecke bei Filmzeit | `distanceAtFilmTime` | war `streckeBeiFilm` |
| Filmzeit bei Strecke | `filmTimeAtDistance` | war `filmBeiS` |
| rohe ↔ gebaute Meter | `rawAtRoute` / `routeAtRaw` | nur `main.ts` kennt beide |
| Einblendung (Zeitrechnung) | `cardTiming` | |
| Bildschirm-Tempo | `screenSpeed` | Fahrtempo ÷ Kameradistanz |
| Vollbild | `fullscreen` | |
| Wetterhimmel | `weatherSky` | |
| Fortschrittsleiste | `progressBar` | |
| Halt-Fläche (auf der Leiste) | `stopSpan` | |
| Telemetrie | `telemetry` | |
| Weg hinaus (Pille oben links) | `exitPill` | |
| Startscreen / Finale-Tafel | `introPanel` / `finalePanel` | |
| Entwickeln (der Karte) | `develop` | |
| Stützpunkt (Routen-Verdichtung) | `vertex`, `VERTEX_MAX_M` | `geo.ts`; nicht `waypoint` (das ist der Wegpunkt) |
| Pegel (Lautstärke) | `volume` / `gain` / `masterGain` | nach Bedeutung, s. §6.1; NICHT `level` (wäre das dritte Wort für einen Begriff) |
| Filmspur | `FilmTrack` | `tour.ts`; die GPS-Spur ist `track`, die Zeitleisten-Bahn `lane` |
| Karten-Kachel (MapLibre) | `tile` | `KACHEL` in `demclean-rechnung.ts` → `TILE`, `kachelA/kachelB` in `atmosphere.ts` → `tileA/tileB` |
| Listen-Kachel (Tour in Galerie) | `thumbnail` | nicht `tile`: das ist die Kartenkachel |
| Foto-Karte als DOM-Artefakt | `photoCard` | `card` allein wird sonst wieder mehrdeutig, s. `trackerkarte.ts` → `tracker-card.ts` und die Bildkarten der Galerie |

### 6.4 Server / Pipeline

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---|---|---|
| laden (DB/Tour) | `load…` | |
| verarbeiten | `processTour` | |
| Anreicherung | `enrichment`, Datei `enrichment.json` | |
| kollabierePausen | `collapsePauses` | GPS-Drift |
| raffePausen | `compressPauses` | Film-Zeitraffer |
| Benennung | `naming` | |
| darfSehen | `canView` | |
| nurOwner | `requireOwner` | |
| registriere…Routen | `register…Routes` | nicht Benutzer-Registrierung |
| Protokoll (Admin) | `auditLog` | |
| Rückmeldung | `feedback` | |
| Einstellung (Betrieb) | `setting` | nicht `option` |
| Bremse (Rate-Limit) | `rateLimit` | |
| Manifestsperre | `manifestLock` | |
| Bildfassung | `imageVariant` | |
| Gehabschnitt | `walkSegment` | `pipeline/tempo.ts` |

### 6.5 Android

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---|---|---|
| AufzeichnungScreen | `RecordingScreen` | |
| TourenScreen | `ToursScreen` | |
| AufzeichnungsService | `RecordingService` | |
| starteAufnahme / beendeAufnahme | `startRecording` / `finishRecording` | |
| Bewegungserkennung | `activityRecognition` | |
| Bewegungsart | `ActivityKind`, Werte `ON_FOOT`, `CYCLING`, `VEHICLE` | nicht persistiert (kein Converter), Welle 7 |
| AufnahmeModus (Foto/Video) | `captureMode` | nicht `travelMode` |
| TourStatus | `RECORDING`, `DRAFT`, `UPLOADING`, `UPLOADED`, `FAILED` | Speicherwerte, Welle 1 |
| MediumUploadStatus | `LOCAL`, `UPLOADED` | Speicherwerte, Welle 1 |
| TeilenBlatt | `ShareSheet` | |
| Ruhe / Lädt / Fertig | `Idle` / `Loading` / `Complete` | |
| DataStore `fotos_automatisch` | `auto_photos` | Welle 7, bewusst |

### 6.6 Datei- und Modulnamen

Vollständig für `src/` flach, `src/studio/`, und die deutschen Dateien unter
`server/src/`. Was nicht in der Tabelle steht, ist schon englisch oder ein
Ordner, dessen Inhalt die Welle benennt. **Diese Tabelle ist der Anfang der
Abbildungstabelle, nicht ihr Ende** (§11): Vollständigkeit wird in Welle 0
maschinell erhoben; was hier steht, sind die Fälle, bei denen die Zielform eine
Entscheidung war. Zwei bekannte Lücken, damit niemand sie für abgedeckt hält:
die Ordnernamen `src/konto/`, `src/profil/`, `src/galerie/` (stehen in jedem
Importpfad und sind nirgends entschieden) und die Testdateien
(`test/vollbild.test.ts`, `test/kartenmaler.test.ts`,
`server/test/anreicherung.test.ts`, …), die mit ihrem Modul in dessen Welle
gehen.

| Ist | Soll | Welle |
|-----|------|------:|
| `src/studio/editmodell.ts` | `edit-model.ts` | 4 |
| `src/studio/zeitleiste.ts` | `timeline.ts` | 4 |
| `src/studio/tonklip.ts` | `audio-clip.ts` | 4 |
| `src/studio/stopps.ts` | `stops.ts` | 5 (nicht 4: [einblendung.ts](../../src/einblendung.ts) und [geo.ts](../../src/geo.ts) importieren es, die Umbenennung öffnet Player-Kern-Dateien) |
| `src/studio/pruefung.ts` | `import-validation.ts` | 4 |
| `src/studio/abspielen.ts` | `playback.ts` | 4 |
| `src/studio/exportblatt.ts` | `export-sheet.ts` | 4 |
| `src/studio/kartenstimmung.ts` | `map-mood.ts` | 4 |
| `src/studio/nachreichen.ts` | `add-media.ts` | 4 |
| `src/studio/sfxbibliothek.ts` | `sfx-library.ts` | 4 |
| `src/studio/tipp.ts` | `tooltip.ts` | 4 |
| `src/filmachse.ts` | `film-axis.ts` | 5 |
| `src/filmuhr.ts` | `film-clock.ts` | 5 |
| `src/kartenmaler.ts` | `card-painter.ts` | 5 |
| `src/kartenschicht.ts` | `card-layer.ts` | 5 |
| `src/einblendung.ts` | `card-timing.ts` | 5 |
| `src/streckenanker.ts` | `route-anchors.ts` | 5 |
| `src/karteninfo.ts` | `map-attribution.ts` | 5 |
| `src/tourtexte.ts` | `tour-texts.ts` | 5 |
| `src/wetterhimmel.ts` | `weather-sky.ts` | 5 |
| `src/vollbild.ts` | `fullscreen.ts` | 5 |
| `src/exportfilm.ts` | `film-export.ts` | 5 |
| `src/exportformat.ts` | `film-export-channel.ts` | 5 |
| `src/pinmodell.ts` | `pin-model.ts` | 5 |
| `src/demclean-rechnung.ts` | `dem-clean-math.ts` | 5 |
| `src/sichtbarkeit.ts` | `visibility.ts` | 6 |
| `src/profil/profilmodell.ts` | `profile-model.ts` | 6 |
| `src/profil/profilbearbeiten.ts` | `edit-profile.ts` | 6 |
| `src/profil/titelbilder.ts` | `profile-banners.ts` | 6 |
| `src/konto/kontomodell.ts` | `account-model.ts` | 6 |
| `src/konto/kontodialoge.ts` | `account-dialogs.ts` | 6 |
| `src/konto/trackerkarte.ts` / `trackermodell.ts` | `tracker-card.ts` / `tracker-model.ts` | 6 |
| `src/galerie/galeriemodell.ts` | `gallery-model.ts` | 6 |
| `src/admin/adminmodell.ts` | `admin-model.ts` | 6 |
| `src/passwortstaerke.ts` | `password-strength.ts` | 6 |
| `src/passwortfeld.ts` | `password-field.ts` | 6 |
| `src/dialogschicht.ts` | `dialog-layer.ts` | 6 |
| `src/entwicklungsstand.ts` | `release-stage.ts` | 6 |
| `src/routen.ts` | `routes.ts` | 6 |
| `src/einladungscode.ts` | `invitation-code.ts` | 6 |
| `src/feedbackknopf.ts` / `feedbackformular.ts` / `feedbackmodell.ts` | `feedback-button.ts` / `feedback-form.ts` / `feedback-model.ts` | 6 |
| `src/session-hinweis.ts` | `session-notice.ts` | 6 |
| `src/rechtstextgliederung.ts` | `legal-text-outline.ts` | 6 |
| `server/src/pipeline/anreicherung.ts` | `enrichment.ts` | 2 |
| `server/src/pipeline/bild.ts` / `bildnachtrag.ts` | `image.ts` / `image-addendum.ts` | 2 |
| `server/src/pipeline/filmachse.ts` / `filmtempo.ts` | `film-axis.ts` / `film-tempo.ts` | 2 |
| `server/src/pipeline/musikwahl.ts` / `schienen.ts` / `signatur.ts` / `zeit.ts` | `music-choice.ts` / `rails.ts` / `signature.ts` / `time.ts` | 2 |
| `server/src/exportinhalt.ts` / `exportlauf.ts` / `export.ts` | `data-export-content.ts` / `data-export-run.ts` / `data-export.ts` | 2 |
| `server/src/bremse.ts` / `manifestsperre.ts` / `mailvorlagen.ts` / `maillayout.ts` | `rate-limit.ts` / `manifest-lock.ts` / `mail-templates.ts` / `mail-layout.ts` | 2 |
| `server/src/protokoll.ts` / `rueckmeldungen.ts` / `profilfelder.ts` / `titelbilder.ts` / `webpfade.ts` | `audit-log.ts` / `feedback.ts` / `profile-fields.ts` / `profile-banners.ts` / `web-paths.ts` | 2 |
| `server/src/seiten.ts` (Meta-Kopf-Logik) / `server/src/routes/seiten.ts` | `page-meta.ts` / `routes/pages.ts` (zwei Dateien, zwei Namen: gleichnamig liefe die Suche ins Leere) | 2 |
| `server/src/routes/galerie.ts` / `bibliothek.ts` / `warteliste.ts` / `rueckmeldungen.ts` | `routes/gallery.ts` / `audio-library.ts` / `waitlist.ts` / `feedback.ts` | 2 |
| `server/src/auth/einladungen.ts` / `warteliste.ts` / `passwort.ts` | `auth/invitations.ts` / `waitlist.ts` / `password.ts` | 2 |
| `server/src/tracker/krypto.ts` / `touranleger.ts` / `importlauf.ts` / `normalisierer.ts` / `testprovider.ts` / `vertrag.ts` | `tracker/crypto.ts` / `tour-creator.ts` / `import-run.ts` / `normalizer.ts` / `test-provider.ts` / `contract.ts` | 2 |
| `src/basis.css` / `grundelemente.css` / `werkzeug.css` / `rechtstext.css` | `base.css` / `page-elements.css` / `toolkit.css` / `legal-text.css` (samt `<link>`-Zeilen in den HTML-Köpfen und `basisZuerst()` in vite.config.js, s. Nahtliste) | 6 |
| `server/src/migrations/` (neu in Welle 1) | entsteht **gleich englisch** (§4.3) | 1 |
| `android/…/daten/LuhamboDb.kt` | `MaptaleDb.kt` | 7 |

`anreicherung.json` auf Platte wird in Welle 1 zu `enrichment.json`, nicht mit
dem Modul.

### 6.7 HTTP-API

**Pfade.** Alles unter `/api/`. Präfix bleibt, der Vhost kennt nur ihn. Was
schon englisch ist (`/api/tours/:id/editor|edits|finalize|reprocess|track|audio`,
`/api/media/…`, `/api/tracker/…`, `/api/webhooks/…`, `/api/export/:token`,
`/api/auth/login|logout|register|me`), bleibt wortgleich. **`/api/push/` gehört
NICHT dazu**: Der einzige Pfad darunter ist `/api/push/geraete`, und der steht
in der Tabelle.

| Ist | Soll |
|---|---|
| `/api/admin/benutzer[/:id]` | `/api/admin/users[/:id]` |
| `/api/admin/einladungen[/:code]` | `/api/admin/invitations[/:code]` |
| `/api/admin/einstellungen` | `/api/admin/settings` |
| `/api/admin/mailvorlagen[/:schluessel[/test\|/vorschau]]` | `/api/admin/mail-templates[/:key[/test\|/preview]]` |
| `/api/admin/protokoll` | `/api/admin/audit-log` |
| `/api/admin/rueckmeldungen[/:id]` | `/api/admin/feedback[/:id]` |
| `/api/admin/statistiken` | `/api/admin/stats` |
| `/api/admin/warteliste[/:id[/einladen]]` | `/api/admin/waitlist[/:id[/invite]]` |
| `/api/audio-bibliothek[/:datei]` | `/api/audio-library[/:file]` |
| `/api/auth/einladung-pruefen` | `/api/auth/check-invitation` |
| `/api/auth/email-bestaetigen` | `/api/auth/confirm-email` |
| `/api/auth/verifiziere` | `/api/auth/verify` |
| `/api/auth/passwort-reset[-anfordern]` | `/api/auth/password-reset[-request]` |
| `/api/auth/session-aus-token` | `/api/auth/session-from-token` |
| `/api/auth/warteliste[/austragen\|/bestaetigen]` | `/api/auth/waitlist[/leave\|/confirm]` |
| `/api/auth/me/geraete[/:id]` | `/api/auth/me/devices[/:id]` |
| `/api/auth/me/passwort` | `/api/auth/me/password` |
| `/api/auth/me/profil` | `/api/auth/me/profile` |
| `/api/auth/me/speicher` | `/api/auth/me/storage` |
| `/api/auth/me/suchmaschinen` | `/api/auth/me/search-indexing` |
| `/api/auth/me/titelbild` | `/api/auth/me/banner` |
| `/api/benutzer/:id/avatar\|profil\|titelbild` | `/api/users/:id/avatar\|profile\|banner` |
| `/api/galerie` | `/api/gallery` |
| `/api/gesundheit` | `/api/health` |
| `/api/media/:tourId/:datei` | `/api/media/:tourId/:file` |
| `/api/newsletter/abmelden` | `/api/newsletter/unsubscribe` |
| `/api/newsletter/ein-klick/:token` | `/api/newsletter/one-click/:token` |
| `/api/push/geraete` | `/api/push/devices` |
| `/api/rueckmeldung` | `/api/feedback` |
| `/api/tours/:id/audio/:datei` | `/api/tours/:id/audio/:file` |
| `/api/tours/:id/bibliothek-audio/:datei` | `/api/tours/:id/library-audio/:file` |
| `POST /api/tours/:id/medien` | `POST /api/tours/:id/media` (Sammlung; `PUT/DELETE …/media/:mid` bleiben) |
| `/api/tracker/imports/gesehen` | `/api/tracker/imports/seen` |

Die Vollzählung der Aufrufer erzeugt Welle 0 mechanisch, aber NICHT mit dem
naiven Einzeiler: Eine Suche nur nach einfach gequoteten Literalen fand beim
Review 23 von 97 Registrierungen. Template-Literale im Web, mehrzeilige
Registrierungen im Server und Kotlin-Doppelquotes fallen durch. Welle 0 nutzt
ein kleines Skript, das alle drei Quote-Arten und mehrzeilige Aufrufe abdeckt;
jeder Pfad, der nur auf einer Seite vorkommt, ist ein Befund. Query-Parameter
gehen mit den Pfaden: `?gesehen=1` an `/api/tracker/imports/pending` wird
`?seen=1` ([ApiClient.kt](../../android/app/src/main/java/app/maptale/upload/ApiClient.kt)
↔ [tracker.ts](../../server/src/routes/tracker.ts)).

**Felder.** Request- und Response-Körper folgen §6.1 bis §6.5. Die häufigsten:
`anzeigename` → `displayName`, `titelbild[Url]` → `banner[Url]`, `suchmaschinen`
→ `searchIndexing`, `sichtbarkeit` → `visibility`, `fehler` → `error`,
`rolle` → `role`, `geraete` → `devices`, `speicher` → `storage`, `an` (Schalter)
→ `enabled`, `notiz` → `note`, `autor` → `author`, `bereit`/`verarbeitung` als
Statuswerte → `ready`/`processing` (§4.2). Die vollständige Liste je Route
erzeugt der Agent in Welle 1 aus den Handlern und legt sie als Tabelle unter
`docs/specs/api.md` ab; diese Datei gibt es heute nicht und sie ist der
bleibende Ort für den API-Vertrag.

**Fehlercodes und Meldungen** bleiben, was sie sind: Der Klartext ist
Produkttext (deutsch), der Code (`400`, `409`, `413`) ist Zahl.

### 6.8 SQLite

Tabellen (Werte s. §4.2):

| Ist | Soll |
|---|---|
| `einladungen` | `invitations` |
| `einstellungen` | `settings` |
| `exporte` | `data_exports` |
| `handles_reserviert` | `reserved_handles` |
| `mailvorlagen` | `mail_templates` |
| `newsletter_einwilligungen` | `newsletter_consents` |
| `push_geraete` | `push_devices` |
| `rueckmeldungen` | `feedback` |
| `tracker_importe` | `tracker_imports` |
| `tracker_verknuepfungen` | `tracker_links` |
| `warteliste` | `waitlist` |
| `users`, `tours`, `sessions`, `tokens`, `mail_tokens` | bleiben |

Spalten (nur die deutschen; `snake_case`; `…_am` → `…_at`):

| Tabelle | Ist → Soll |
|---|---|
| `users` | `anzeigename`→`display_name`, `profil_sichtbarkeit`→`profile_visibility`, `rolle`→`role`, `handle_geaendert_am`→`handle_changed_at`, `ort`→`location`, `titelbild`→`banner`, `suchmaschinen`→`search_indexing` |
| `tours` | `fehler`→`error`, `finale_ziel`→`finale_target`, `dachzeile`→`kicker` |
| `sessions` | `ip_praefix`→`ip_prefix`, `zuletzt_gesehen`→`last_seen_at` |
| `mail_tokens` | `zweck`→`purpose`, `nutzlast`→`payload` |
| `invitations` | `notiz`→`note`, `erstellt_von`→`created_by`, `erstellt_am`→`created_at`, `ablauf`→`expires_at`, `eingeloest_von`→`redeemed_by`, `eingeloest_am`→`redeemed_at` |
| `settings` | `schluessel`→`key`, `wert`→`value` |
| `data_exports` | `benutzer_id`→`user_id`, `angefordert_am`→`requested_at`, `fertig_am`→`finished_at`, `laeuft_ab_am`→`expires_at`, `dateien`→`file_count`, `fehler`→`error` |
| `reserved_handles` | `frei_ab`→`free_from` |
| `mail_templates` | `schluessel`→`key`, `betreff`→`subject`, `titel`→`title`, `text`→`body`, `knopf`→`button`, `fuss`→`footer`, `geaendert_am`→`updated_at`, `geaendert_von`→`updated_by` |
| `newsletter_consents` | `benutzer_id`→`user_id`, `zeitpunkt`→`at`, `zustand`→`state`, `quelle`→`source`, `textfassung`→`text_version` |
| `push_devices` | `benutzer_id`→`user_id`, `plattform`→`platform`, `angelegt_am`→`created_at`, `zuletzt_gesehen_am`→`last_seen_at` |
| `feedback` | `benutzer_id`→`user_id`, `kontext`→`context`, `quelle`→`source`, `notiz`→`note`, `angelegt_am`→`created_at`, `geaendert_am`→`updated_at` |
| `tracker_imports` | `benutzer_id`→`user_id`, `anbieter`→`provider`, `externe_id`→`external_id`, `gemeldet_am`→`reported_at`, `fertig_am`→`finished_at`, `gesehen_am`→`seen_at`, `wiederholbar`→`retryable`, `versuche`→`attempts`, `fehler`→`error` |
| `tracker_links` | `benutzer_id`→`user_id`, `anbieter`→`provider`, `externer_nutzer`→`external_user`, `laeuft_ab_am`→`expires_at`, `verbunden_am`→`connected_at`, `zuletzt_sync_am`→`last_sync_at`, `letzter_fehler`→`last_error` |
| `waitlist` | `notiz`→`note`, `eingetragen_am`→`joined_at`, `eingetragen_ip`→`joined_ip`, `bestaetigt_am`→`confirmed_at`, `bestaetigt_ip`→`confirmed_ip`, `eingeladen_am`→`invited_at`, `eingeladen_code`→`invited_code` |

Die Schlüssel in `settings.key` (`einladung_pflicht`, `warteliste_offen`)
und `mail_templates.key` sind Codewerte und gehen nach §6.4 mit; die Werte in
`mail_templates` (Betreff, Text) bleiben deutsch.

### 6.9 Die vier Tour-Dateien

**`upload@2`** (Manifest, schon fast englisch): `modiAutomatisch` →
`travelModesAuto`, `quelle` → `source`, `entfernt` → `removed`, `medien` (Route
Nachreichen) → `media`. Rest bleibt.

**`edits@2`**: `medien` → `media`; je Medium `geloescht` → `removed`, `reihe` →
`order`, `trim.vonS/bisS` → `trim.fromS/toS`; `modi` → `travelModes` mit `ab` →
`from`; `trim.start/ende` → `trim.start/end`; `kamera` → `camera` mit `preset`
`nah/mittel/weit/standard` → `near/mid/far/default` (nicht `medium`: das Wort ist
in §6.1 die einzelne Aufnahme), `skala` → `scale`;
`momente` → `moments` mit `art` → `kind` (`umkreisen/aufstieg/innehalten` →
`orbit/ascend/linger`), `dauerS` → `durationS`; `audio[]` mit `datei` → `file`,
`typ musik/sfx` → `type music/sfx`, `ab/bis` → `from/to`, `lautstaerke` →
`volume`, `quelle bibliothek/benutzer` → `source library/user`, `anker` →
`anchor`, `versatzFilmS` → `offsetFilmS`, `dauerFilmS` → `durationFilmS`,
`einstiegS` → `startS` (so heißt es im Tour-JSON schon); `wetter` → `weather`
mit `staerke` → `intensity`; `titelbild` → `cover`.

**`enrichment@2`** (war `anreicherung@1`): `befunde` → `findings`, `orte` →
`places`, `wetterRoh` → `weatherRaw`, `trimSignatur` → `trimSignature`,
`videoSchnittSignatur` → `videoCutSignature`; innere Schlüssel nach Glossar.

**`tour@2`**: `reihe` → `order`, `moments[].art` → `kind`, `dauerS` →
`durationS`, `camera[].skala` → `scale`, `autor` → `author` mit `anzeigename`
→ `displayName`, `fehler` → `error`, `stats.spur` → `stats.trackSignature`,
`camera[].preset` mit denselben Werten wie in `edits@2` (`near/mid/far/default`).
Die Statuswerte nach §4.2. Wird nicht migriert, sondern neu gerendert (§4.3).

Zwei Werte in `tour@2`, die man beim Abschreiben übersieht:

- **`placement`** trägt deutsche WERTE: `'gps' | 'zeit' | 'manuell' |
  'unplatziert'` ([placement.ts](../../server/src/pipeline/placement.ts)),
  `editmodell.ts` SCHREIBT `'manuell'`, `editor.ts` vergleicht darauf und
  schlägt in `PLACEMENT_NAMEN` nach; der Typ ist dabei blankes `string`
  (`api.ts`, `editmodell.ts`), der Compiler sieht also nichts. Sie gehen mit,
  zu `gps/time/manual/unplaced`, samt Schreiber, Vergleich und Tabelle im
  Studio. Ohne diese Zeile
  bleibt ein deutscher Wertesatz im „fertig migrierten" Vertrag stehen, oder er
  wird umbenannt und der Editor-Vergleich läuft still leer.
- **`stats.fotos` wird NICHT `stats.photos`, sondern `stats.placedMedia`.** Der
  Wert zählt `media.filter((m) => m.anchor)` ([enrich.ts](../../server/src/pipeline/enrich.ts)),
  also Fotos UND Videos. `photos` wäre derselbe Fehler, den §6.1 gerade
  verbietet: die einzelne Aufnahme heißt `medium`, nicht `photo`. Dasselbe gilt
  für `tours.stats_json` in der DB (§4.2), das denselben Schlüssel trägt.

### 6.10 CSS, DOM und Custom Properties

Eine eigene Sorte, die in den ersten Fassungen nur als Dateinamen vorkam: weder
Code-Bezeichner, den ein Compiler kennt, noch Produkttext. Diese Namen stehen
gleichzeitig in `.ts`, `.css` und `.html`, und drei davon werden von Werkzeug
gelesen, nicht von Menschen.

**21 von 40 Custom Properties** in [basis.css](../../src/basis.css) sind
deutsch: `--akzent`, `--akzent-2`, `--auf-akzent`, `--blau`, `--gruen`, `--rot`,
`--lila`, `--papier`, `--tafel`, `--linie`, `--glas`, `--glas-rand`,
`--schatten`, `--rand`, `--rand-hell`, `--bg-tief`, `--text-gedaempft`,
`--text-zart`, `--fokus-ring`, `--radius-karte`, `--blatt-basis`.

**Die übrigen kommen dazu und liegen verstreut**: `--blatt-grundelemente` und
`--blatt-werkzeug` in ihren Blättern, `--konto-lesebreite` in
`grundelemente.css` und `konto.html`, `--lesebreite` in `rechtstext.css`,
`--seitenrand` und `--navh-leiste` in `index.html`, `--streifen-rand`,
`--zeit-breite` und `--inspector-breite` in `studio.html` und den
Studio-Modulen (`editor.ts`, `tonklip.ts`), `--karten-mass` und
`--schleier-sicht` in `style.css` und `kartenschicht.ts`. Wer die Inventur aus
`basis.css` allein zieht, findet die Hälfte nicht, und wer nur CSS-Dateien
durchsucht, verfehlt die HTML-Köpfe und die `.ts`, die sie setzen. Dazu Klassen und ids quer
durch Player und Studio: `.halt-flaeche`, `.karten-leinwand`, `.karten-info`,
`.karten-info-popup`, `.zurueck`, `.zurueck-wort`, `.kompakt-quer`,
`body.info-offen`, `dataset.s`. Die Blattdateinamen selbst stehen in §6.6 und
auf der Nahtliste.

**Sie gehen mit, in der Welle ihres Moduls** (Player-Klassen in Welle 5,
Produktseiten in Welle 6). Drei Fallen:

- **`--blatt-basis` ist Werkzeug, kein Stil.** An dieser Custom Property erkennt
  `basisZuerst()` in [vite.config.js](../../vite.config.js) die Basisblätter
  nach dem Bauen, weil Vite eine CSS-Datei nach ihrem JS-Chunk benennt. Wer sie
  umbenennt und die Config vergisst, kippt die CSS-Kaskade, und zwar NUR im
  Build. Der Dev-Server sieht richtig aus.
- **Mindestens fünf Wächter lesen diese Namen als Text**
  ([basis-css](../../test/basis-css.test.ts),
  [player-schichtung](../../test/player-schichtung.test.ts) mit
  `.karten-leinwand`, `.dock`, `.zurueck`, `.karten-info`,
  [app-nav](../../test/app-nav.test.ts), [einblendung-css](../../test/einblendung-css.test.ts),
  [entwicklungsstand](../../test/entwicklungsstand.test.ts)). Sie werden rot,
  und das ist die gute Nachricht; angepasst wird der Wächter, nicht der Code.
- **`DESIGN.md` führt seine Tokens SCHON englisch** (`primary`, `amber`, `text`,
  `muted`, `bg`, `surface`, `glass`, `paper`), und `basis.css` leitet daraus
  deutsche Variablennamen ab. Der Drift-Wächter hält beides deckungsgleich und
  überbrückt dabei heute eine Übersetzung. Das ist die einzige Stelle im Repo,
  an der Deutsch und Englisch bereits per Test aneinandergebunden sind: Gehen
  die Tokens mit, verschwindet die Übersetzung und der Wächter wird einfacher.
  Bleiben sie, ist `--fokus-ring` neben `focus-ring` in DESIGN.md dauerhaft genau der
  Hybrid, den §1 vermeiden will.

`DESIGN.md` selbst bleibt fast unangetastet: Sein YAML ist der Inhalt, nicht der
Kopf, und die Tokens dort sind bereits die Zielform. **Entschieden bei der
Abnahme am 2026-08-20: Die Custom Properties GEHEN MIT**, abgeleitet aus den
DESIGN.md-Tokens (`--akzent` → `--primary`, `--tafel` → `--card`), und die eine
Ausnahme wird keine: `--rand` wird `--border`, und DESIGN.md bekommt dafür ein
allgemeines `border`-Token (heute existiert nur `topbar-border`) — der
Drift-Wächter ist danach übersetzungsfrei.

---

## 7. Die Doku: sortieren, nicht neu schreiben

Gemessen am 2026-08-19: `docs/` ohne `_site` sind **45 Dateien**, dazu fünf
`CLAUDE.md` mit **230 KB** (Wurzel 100 KB, Studio 68 KB, Server 35 KB, Android
22 KB, Admin 5 KB). Das klingt nach einem eigenen Vorhaben, ist es aber nicht,
sobald man drei Dinge auseinanderhält.

**Die Bezeichner sind der kleinere Teil.** Deutsche Namen in Code-Spannen über
das ganze Repo: rund **700 Stellen**, großzügig gezählt. Das ist dieselbe
Abbildungstabelle wie im Code, angewandt auf `.md`.

**Die Substanz sind Messwerte, und die kann niemand neu schreiben.** Treffer
auf Zahlen mit Einheit und „gemessen/kalibriert": `konzept_gleichlauf_player_editor`
148, `zeitleiste-umbau` 149, `die-foto-karte-auf-eine-leinwand` 79,
`src/studio/CLAUDE.md` 65, `CLAUDE.md` 59, `foto-pins-3d` 40,
`konzept_video_export` 38. Ein Neuschrieb ersetzt die Prosa, die billig war,
und verliert die Zahlen, die es nicht waren.

**Ein Drittel der Konzepte ist gar nicht betroffen.** Monetarisierung, Social
Login, Play Store, Live mitverfolgen, i18n, Reisen und Sammlungen:
Absichtstexte enthalten kaum Namen.

| | Was | Behandlung |
|---|---|---|
| **A** | die fünf `CLAUDE.md`, `austauschformat.md`, `overlay-und-tourjson.md`, das neue `docs/specs/api.md` | Tabelle anwenden, dann **ein** Lesedurchgang je Datei. Hiernach handeln Agenten. Die Specs laufen in Welle 1 mit |
| **B** | Absichts-Konzepte für Ungebautes | unangetastet |
| **C** | abgearbeitete Befund-Dokumente: `die-foto-karte-auf-eine-leinwand.md` (Status „abgearbeitet"), `docs/architecture/zeitleiste-umbau.md` (kein Kopf, seit 05.08. umgesetzt), `konzept_gleichlauf_player_editor.md` | ins Archiv, deutsch eingefroren. **Vorher** wandern die offenen Stücke des Gleichlauf-Konzepts (§9 Szene-Schicht, §10 Tag/Nacht im Editor, §11 Feinplatzierung) als eigene Zeilen in die Roadmap, sonst archiviert man offene Arbeit. Umgehängt wird über den Doku-Viewer |
| **D** | `docs/archive/` | nie anfassen |

**Das Front Matter bricht in ALLEN Töpfen, auch in B.** Jedes Dokument trägt
`betrifft:`-Pfade, aus denen der Viewer Bereiche und Systemteile ableitet
([kopf.mjs](../../scripts/docs-viewer/kopf.mjs)); dieses Dokument selbst listet
`src/studio/editmodell.ts`. Nach den Wellen 4 bis 6 zeigen diese Pfade in fast
allen 45 Dokumenten ins Leere, und „unangetastet" für Topf B gilt nur für den
TEXT. Also: **je Umbenennungs-Welle ein mechanischer Lauf über alle
`betrifft:`-Listen**, gegen dieselbe Dateitabelle aus §6.6. Das ist kein
Lesedurchgang und kostet nichts; vergessen fällt es dagegen erst auf, wenn im
Viewer die Hälfte der Zuordnungen fehlt.

**Was hier nicht gebündelt wird:** „Wir haben zu viel Doku" und „wir wechseln
die Sprache" sind zwei Entscheidungen. Zusammengelegt wird der Sprachwechsel
zur Gelegenheit, Messwerte zu verlieren, und das fällt erst auf, wenn in einem
halben Jahr jemand fragt, warum die Rampe 120 m ist und nicht 200.

---

## 8. Abnahme je Welle

- [ ] Web: `npm test` + `npm run typecheck`
- [ ] `npm run lint` + `npm run format:check` (braucht node_modules BEIDER
      Welten; das Lint-Script prüft das selbst und bricht sonst mit Klartext
      ab, statt Tausende Phantom-Befunde zu melden)
- [ ] Server: `cd server && npm test` (Coverage-Gate 80 % wie in der CI)
- [ ] Android ab Welle 1 (Room, Manifest, Edits): `./gradlew test`
- [ ] Manuell: Anmelden, Tour öffnen, Modus-Grenze ziehen, Speichern, Player
- [ ] Nahtliste §3.3 durchgegangen für jede berührte Naht
- [ ] `status` und `stand` dieses Dokuments nachgezogen, Roadmap-Schritt aktuell

Zusätzlich für Welle 1:

- [ ] Zahlen aus §4.5 erhoben und eingetragen; Schwelle nicht überschritten
- [ ] DB-Snapshot UND Kopie des Datenordners vor dem Lauf
- [ ] Start-Migration zuerst gegen die Kopie (lokale Instanz mit
      `MAPTALE_DATEN_DIR`), dann scharf
- [ ] Migrations-Test: Leiter von `user_version` 0 bis 23 mit je einer Zeile
      je Werte-Tabelle; danach englische Werte und alle Indizes vorhanden
- [ ] Jede migrierte Tour nach dem Re-Render einmal im Player geöffnet, nicht nur die erste
- [ ] Eine Tour vollständig neu hochgeladen und gerendert (App und Studio-Upload)
- [ ] App neu installiert, eine Aufnahme gemacht, hochgeladen; eine Aufnahme
      mit alter App-Version gegen den neuen Server: Klartext-Ablehnung sichtbar
- [ ] Jede Seite einmal geöffnet (Galerie, Profil, Konto mit Geräten und
      Speicher, Verwaltung alle Reiter): keine leeren Felder, keine 404 im
      Netzwerk-Tab
- [ ] Grep über den Datenordner nach den alten Schlüsseln: keine Treffer;
      `daten/.schema` = 2
- [ ] Grep über `src/` und `android/` nach alten API-Pfaden: keine Treffer
- [ ] Grep über `server/src` nach ALLEN alten Tabellen-, Spalten- und
      Wertenamen: keine Treffer (SQL-Strings sieht kein Compiler, §3.1)
- [ ] Keine `ready`-Tour trägt mehr `tour.json@1`; Touren in `fehler` oder
      `verarbeitung` zum Migrationszeitpunkt sind gezählt und benannt (§4.3)
- [ ] Banner und Avatare aller Konten laden (Pfad-Werte + Ordner, §4.2)
- [ ] Kein laufender Datenexport zum Zeitpunkt des Deploys (48-h-Links)
- [ ] Galerie und ein Profil WÄHREND des Re-Renders geöffnet: nie leer (§4.3)
- [ ] Eine angepasste Mail-Vorlage aus der Verwaltung verschickt: Platzhalter
      gefüllt, nicht als `{{…}}` im Text (§4.2)
- [ ] `einladung_pflicht` und `warteliste_offen` nach der Migration gelesen:
      Wert wie vorher, nicht die Vorgabe
- [ ] `placement`-Werte und `stats.placedMedia` in einer neu gerenderten
      `tour.json`; der Editor markiert eine von Hand gesetzte Aufnahme weiter
      als manuell platziert (§6.9)
- [ ] Eine Import-fertig-Push-Meldung auf dem Gerät angekommen (§3.3)

Zusätzlich für Welle 5 und 7:

- [ ] Player aus der App heraus gestartet, in den Hintergrund und zurück: Ton
      und Bild laufen synchron (die WebView-Brücke aus §3.3)
- [ ] Jedes Messskript unter `scripts/messungen/` einmal gestartet (Welle 5)

Zusätzlich für Schritt 9 (Env-Variablen):

- [ ] `.env` auf dem Server trägt BEIDE Namenssätze, BEVOR deployt wird, und
      `docker-compose.cloudpanel.yml`, `server/Dockerfile` und die
      CI-Secrets sind im selben Commit mitgegangen (§3.4)
- [ ] Nach dem Deploy: `docker compose exec api env | grep MAPTALE_` zeigt die
      neuen Namen mit den erwarteten Werten; eine Mail ausgelöst, der Link
      zeigt auf die echte Domain und nicht auf `localhost:5173`; der
      Datenordner ist der befüllte unter `/data`
- [ ] Erst danach die alten Zeilen aus der `.env` entfernt

**Rückweg für Welle 1** (der einzige irreversible Schritt): altes Image-Tag in
`docker-compose.cloudpanel.yml` eintragen, Datenordner aus der Kopie
zurückspielen, DB aus dem Snapshot, `dist/` des vorigen Tags per `rsync`. Das
ist ein Handgriff von zehn Minuten, aber nur, solange Kopie und Snapshot
existieren; beides wird erst nach Abnahme der Welle 2 gelöscht.

**Und der Rückweg hat eine App-Seite**, die der Handgriff nicht abdeckt: Ein
APK-Downgrade auf einem Gerät mit Room v4 stürzt ab (es gibt keinen
Downgrade-Pfad), und die neue App sendet `upload@2` gegen den
zurückgerollten Server, der das nur als opaken Schema-Fehler kennt. Also:
Rollback nur, solange seit dem App-Update keine Aufnahme entstanden ist;
sonst die Aufnahme VOR dem Rollback gegen den neuen Server hochladen, oder
das Gerät auf der neuen App lassen und den nächsten Anlauf abwarten.

---

## 9. Arbeitsmodus mit Coding-Agenten

1. Welle wählen, Glossar-Auszug plus „nur diese Dateien" plus Ausschlussliste
   plus die Nähte dieser Welle aus §3.3.
2. Agent: Rename und Tests. Mensch: Namenskonsistenz, Wellengrenze, Nähte.
3. CI grün, Glossar um gefundene Lücken ergänzen, nächste Welle.
4. Verbot: „Rename the whole repository to English in one go."
5. Verbot: Rückwärtsleser, Aliase, Kompatibilitätsschichten, Doppelrouten
   (§2.3). Die Start-Migration ist die eine erlaubte Stelle, die alte Schlüssel
   kennt, und sie kennt sie nur beim Start.

### 9.1 Wie umbenannt wird

Aus den Wellen 1 bis 3, jede Zeile ein bezahlter Fehler:

- **Token-basiert, nie per Textersetzung.** Ein Skript über den
  TypeScript-Language-Service (`findRenameLocations`) fasst nur Bezeichner an.
  Deutsche Kommentare, Produkttexte und die alten JSON-Schlüssel in
  `migrations/keys-v2.ts` sind DATEN; ein Lauf über Wortstämme nimmt sie mit.
- **Zielformen vor dem Bauen gegen den BESTAND greppen.** Das Prüfskript
  vergleicht Zielformen nur gegeneinander, nicht gegen Namen, die schon englisch
  sind. So lief `TrackerAnbieter → TrackerProvider` auf ein bestehendes
  Interface (Welle 2), und `Achse`/`Filmachse` zielten beide auf `FilmAxis`
  (Welle 3). Zwei Dinge dürfen nie denselben Zielnamen bekommen.
- **Shorthand-Eigenschaften sind SCHLÜSSEL.** `{ ab }` → `{ from }` benennt
  nicht nur eine Variable um: Wo das Objekt als `dataset`, `setAttribute`,
  `JSON.stringify` oder Query weitergereicht wird, heißt danach das FELD anders.
  Genau so lagen die Bandkanten des Editors einen Tag lang auf Produktion still,
  ohne dass ein Test rot wurde.
- **Kommentare bleiben deutsch, ihre Symbol-VERWEISE nicht.** `s.
  AuthDienst.hebeAdmins` zeigt nach der Umbenennung ins Leere; nach Welle 2
  waren es 56 solche Stellen. Gezogen wird der Verweis (erkennbar an Backtick,
  Punkt-Notation, „s. "), nie die Prosa: „von Einladung zu Einladung" in einer
  Mail-Vorlage bleibt.
- **Die Tabelle schlägt das Konzept**, wenn beide sich widersprechen: Sie kennt
  den Fundort. So blieb `stopps.ts` korrekt bei Welle 5, obwohl §5 es zu Welle 3
  zählt.
- **Text-Wächter werden rot, und das ist die gute Nachricht.** Angepasst wird
  der Wächter, nicht der Code. Doku-Links und `betrifft:`-Listen wandern
  mechanisch mit; Zwillinge aussparen, die in einer anderen Welle liegen.

### 9.2 Was kein Test sieht

Fünf Sorten, alle in Welle 1 gleichzeitig gerissen, während 957 Tests grün
waren. Drei davon bewacht seither
[test/client-vertrag.test.ts](../../test/client-vertrag.test.ts):

| Sorte | Wirkung | Wächter |
|---|---|---|
| Client-Pfad zeigt auf eine Route, die es nicht mehr gibt | ganze Oberfläche tot | ja (1) |
| `$('…')` findet sein Element nicht | Modul stirbt beim Start | ja (2) |
| `value=`/`data-*` trägt einen alten Vertragswert | 400 bei jeder Eingabe | ja (3) |
| Request-Body sendet deutsche Schlüssel | „Ungültige Anfrage" | nein |
| Antwortfeld heißt anders, als der handgetippte Typ sagt | leere Felder, falsche Rückfalltexte | **nein** |

Die letzte ist die teuerste: **Ein Typ und sein Test können gemeinsam falsch
sein.** `GalerieTour.titel` gegen `title` des Servers stand so im Interface UND
im Fixture; sichtbar wurde es erst auf Produktion als „Namenlose Reise". Dagegen
hilft nur, die Seite nach jeder Welle wirklich zu benutzen — und zwar die
angemeldeten Seiten über ein echtes Browserprofil, nicht über eine Pane, die
MapLibre nicht fertig lädt.

**`GEBAUTE_WELLEN` im Wächter ist Handarbeit** und gehört in denselben Commit
wie `status` und `stand`.

---

## 10. Entscheidungstor

Die vertagte Fassung nannte drei Kriterien, unter denen wieder aufgemacht wird:
Mitentwickler ohne Deutsch, öffentliche API, oder der Hybrid stört mehr als der
Umbau.

**Stand 19. August 2026: geöffnet.** Zwei Beobachtungen stützen es:

- Die Prämisse der Vertagung („später wird es kaum teurer") stimmt für den
  Code, aber nicht für die Persistenz und die API. Dort wird es sprunghaft
  teurer, sobald fremde Daten oder fremde Clients im System sind, und dieser
  Punkt ist noch nicht erreicht (§4.5 misst ihn).
- Der Hybrid ist seit dem 13.08. gewachsen: Der ganze Gleichlauf-Umbau ist
  deutsch auf englisches Prototyp-Erbe gesetzt worden.

### Historie: die Vertagung vom 13. August 2026

Aufgekommen mitten in Paket B des
[Gleichlauf-Umbaus](konzept_gleichlauf_player_editor.md), der neue geteilte
Module anlegte (`filmuhr.ts`, `einblendung.ts`, `filmachse.ts`). Entschieden
wurde: alles bleibt deutsch, auch neue Module. Begründung damals: Die Regel
wäre nicht ablesbar gewesen; ein Mix aus englischer Insel und Sonderregel ist
teurer als der Aufschub; später werde es kaum teurer. Der dritte Punkt hat sich
für Persistenz und API als falsch erwiesen, die ersten zwei als Kosten
bestätigt: Genau der beschriebene Hybrid ist entstanden.

### Historie: die erste beschlossene Fassung vom 19. August 2026, Vormittag

Schnitt „DB + vier JSON + Room", Einmal-Skript unter `scripts/`, keine
Versionserhöhung, API nicht erwähnt. Im Review am selben Tag an sieben Stellen
gegen den Code gefallen (§0). Ersetzt durch diese Fassung.

---

## 11. Nächster Schritt

**Erledigt am 2026-08-19, vor Welle 0:** die Werkzeug-Vorstufe. Prettier
(De-facto-Stil festgeschrieben, einmaliger Format-Lauf über alle TS/JS-Dateien,
Commit in `.git-blame-ignore-revs`) und ESLint (typbasiert über beide
tsconfig-Welten, Aus-Liste mit Zählständen in
[eslint.config.mjs](../../eslint.config.mjs)) laufen im Deploy-Gate. CSS und
HTML bleiben vorerst unformatiert: Wächter-Tests lesen dort Quelltext als
Zeichenkette. ktlint für Android ist offen (spätestens Welle 7).

**Welle 0, und ihr Ergebnis ist EIN Werkstück: die Abbildungstabelle.** Sie
ist nicht Beiwerk zum Umbau, sie IST der Umbau. Jede spätere Welle, jedes
Migrationsskript, jeder Agenten-Prompt und der Lauf über die `betrifft:`-Listen
(§7) lesen dieselbe Tabelle. Solange sie nicht steht und abgenommen ist, fällt
keine Zeile Code. Konkret und in dieser Reihenfolge:

1. **Zahlen aus §4.5** auf dem Server erheben und eintragen. Liegt eine über
   der Schwelle, endet Welle 0 hier und §4 wird neu entschieden; die Tabelle
   wird dann trotzdem gebraucht, aber für einen anderen Plan.
2. **Roadmap**: Play Store hinter dieses Vorhaben; Einladungen bis Ende
   Welle 1 pausieren.
3. **Tabelle bauen** — **erledigt am 2026-08-20**:
   [docs/specs/abbildungstabelle.tsv](../specs/abbildungstabelle.tsv) mit 3423
   Einträgen, beschrieben in
   [abbildungstabelle.md](../specs/abbildungstabelle.md), geprüft von
   `scripts/abbildungstabelle-pruefen.mjs` (keine Widersprüche, keine
   Kollisionen). Nebenprodukt [api.md](../specs/api.md) steht: 95 Routen mit
   Feldern und Aufrufern. Drei Befunde daraus stehen in §11a. Maschinenlesbar und an einer Stelle. Sie führt je
   Eintrag: Ist-Name, Zielform, Art, **Fundort**, Welle, Bemerkung. Quellen sind
   §6.1 bis §6.10 und die Liste aller deutschen Exporte in `src/`,
   `server/src`, `android/` samt aller API-Felder je Route, die ein Agent
   erzeugt; was im Glossar fehlt, wird beim Bauen sichtbar (§6.6 nennt die
   bekannten Lücken). Nebenprodukt: `docs/specs/api.md` (Ist-Stand).

   Drei Eigenschaften entscheiden, ob die Tabelle ausführbar ist oder nur
   aussieht wie eine Tabelle:

   - **Sie führt ganze Bezeichner, nie Wortbestandteile.** `karte` steckt in
     `kartenmaler` (card), `karteninfo` (map), `kartenstimmung` (map) und
     `--radius-karte` (Galerie-Karte, also weder noch). Eine Zeile je
     Kompositum, und die Ersetzung greift nur auf vollständige Bezeichner. Wer
     je Wortstamm ersetzt, baut drei Fehler in einem Lauf.
   - **Der Fundort ist eine eigene Spalte, weil die Art nicht reicht.**
     Derselbe Ist-Name hat kontextabhängig zwei Zielformen: `titelbild` ist
     `banner` in `users`, API und Profil, aber `cover` in `edits` und Tour;
     `fehler` ist `error` als Feld und `failed` als Statuswert; `quelle` ist
     als Feld überall `source`, aber seine WERTE wandern in
     `newsletter_einwilligungen` (`registrierung/konto/abmeldelink`) und
     bleiben in `rueckmeldungen` (`web/app`); `Befund` ist `finding` in der
     Pipeline und `importReport` beim Upload. Ohne Fundort ist die Tabelle
     mehrdeutig und ein Agent rät.
   - **Die Art-Liste ist länger als sie aussieht**: Bezeichner, DB-Spalte,
     DB-Wert, DB-Schlüsselzeile (§4.2), JSON-Feld, JSON-Wert, API-Pfad,
     API-Feld, Datei, Ordner, CSS-Variable, CSS-Klasse, DOM-id,
     Storage-Schlüssel, Cookie (`maptale_dabei`), Push-Schlüssel (§3.3),
     Mail-Platzhalter (§4.2). Push-Schlüssel und Mail-Platzhalter hat erst
     die parallele Prüfung gefunden; sie stehen sonst in keiner Welle. Eingefrorenes (Env,
     Fragment-Schlüssel, Kanal-IDs, §3.4) steht mit Zielform „bleibt" in der
     Tabelle, damit die Entscheidung lesbar bleibt und niemand sie als Lücke
     nachträgt.
4. **Tabelle abnehmen — erledigt am 2026-08-20**: alle zwölf Streitpunkte
   entschieden (A: die Empfehlungen, B: `AxisStop`, C: Tokens gehen mit samt
   `border`-Token), §6 ist damit EINGEFROREN. Die Streitpunkte stehen als
   eigener Abschnitt in
   [abbildungstabelle.md](../specs/abbildungstabelle.md): zehn Spiegel, deren
   Zielformen in Server und Web auseinandergelaufen sind (darunter beide
   `handle.ts`-Zwillinge und `HALT_AUSBLEND_S`), `Halt` als drittes Ding in
   `filmachse.ts`, und ob die CSS-Tokens mitgehen (§6.10). Erledigt haben sich
   `mid` gegen `medium`, die drei Bedeutungen von „Spur" und die Pegel-Wörter:
   Das Glossar entscheidet sie, und die Tabelle folgt ihm ohne Abweichung.
   Ergebnis: ein eingefrorenes §6.
5. **Sprachregel in `CLAUDE.md`** anpassen (§2) — **erledigt am 2026-08-20**.
6. **DB-Snapshot und Kopie** des Datenordners (§8) — unmittelbar VOR dem
   Welle-1-Deploy anlegen, nicht Wochen vorher: Ein alter Snapshot wiegt in
   Sicherheit und stellt beim Rückweg alte Daten wieder her.
7. Erst danach Welle 1, Schritt 1 (§5): SQLite + die Felder, die direkt aus
   Zeilen kommen. Sie beginnt mit der Migration, nicht mit dem Rename.

## 11a. Drei Befunde aus dem Bau der Tabelle

**Die Begründung in §4.2 zum `tokens`-Blob stimmt nicht.** Dort steht, er trage
„nur fremde Schlüssel". Die Inventur findet deutsche (`zugriff`, `erneuerung`,
`laeuftAb`, `externerNutzer`). Die Entscheidung „bleibt" ist trotzdem richtig,
nur die Begründung ist eine andere: Der Blob liegt AES-verschlüsselt in der
Zeile und ist per `UPDATE` gar nicht umschreibbar. Der Satz gehört
ausgetauscht, wenn Welle 1 die Stelle öffnet.

**Die Nahtliste in §3.3 ist unvollständig, und zwar systematisch.** Sie nennt
die Server-Spiegel, die jemandem eingefallen sind. Maschinell erhoben leben
**126 Namen in zwei getrennt kompilierten Welten**, bei elf sind die
Zielvorschläge auseinandergelaufen. Für Welle 1 heißt das: Der Spiegel-Abgleich
gehört in die Abnahme jeder Welle, nicht nur in die Liste. Er ist eine Zeile:
`node scripts/abbildungstabelle-pruefen.mjs`.

**Eine Route hat keinen Aufrufer.** `POST /api/tracker/:provider/sync` ist samt
Bremse und Antwortfeldern registriert, wird aber weder vom Web noch von der App
gerufen: Der „Jetzt abrufen"-Knopf, für den sie gebaut wurde, fehlt in jeder
Oberfläche. Kein Migrations-Thema, aber es fiel bei der Vollzählung auf und
stand sonst nirgends.
