---
stand: 2026-08-20
status: Welle 1 in Arbeit — Schritt 1 (SQLite + API) gebaut, Gates noch rot; Schritte 2–5 offen
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
- **Server-Tests** mechanisch nachgezogen; `tsc` grün, `npm test` noch rot
  (Stand: 105 von 886).

## Was offen ist

1. `upload@2` samt `POST /api/tours/:id/media`, `media.ts` und dem Manifest-Bau.
2. `edits@2` samt Studio-Typen und `EditsFortschreibung.kt`.
3. `enrichment@2` + `tour@2` + Player-Leser + `PRESETS`/`kamFolger` (§3.3) +
   Re-Render.
4. Die Web-Leser: `src/studio/api.ts`, `src/remote.ts`, `src/konto/*`,
   `src/profil/*`, `src/admin/*`, `src/galerie/*`, `src/app-nav.ts`.
5. Android: `ApiClient.kt`, `Manifest.kt`, `EditsFortschreibung.kt`,
   `TourenScreen.kt`/`ImportViewModel.kt`, `MaptalePushDienst.kt`,
   Room-Entities + v4 mit `fallbackToDestructiveMigration`, Enum-Speicherwerte,
   WorkManager-Neueinreihung.
6. Die 400er-Ablehnung für `@1`-Uploads mit Klartext in BEIDEN Feldnamen
   (`fehler` UND `error`) — die einzige bewusste Alt-Ausnahme (§4.1).
7. Start-Migration unter `server/src/migrations/` samt generiertem `keys-v2.ts`
   und dem Marker `daten/.schema`.
8. Die beiden Specs (`austauschformat.md`, `overlay-und-tourjson.md`) und
   `api.md`.
9. Abnahme nach §8, Nahtliste §3.3 abhaken, `status`/`stand` des Konzepts und
   der Roadmap-Schritt.

## Entscheidungen unterwegs

- **Reihenfolge:** Der DB-Leiter-Schritt und seine Leser stehen in EINEM Zug,
  nicht getrennt. Ein Zwischenstand mit englischen Spalten und deutscher API
  hätte eine Übersetzungsschicht gebraucht, die §2.3 gerade verbietet. Die
  Start-Migration für die JSON-Dateien kommt NACH den Verträgen, die sie
  abbildet — vorher gäbe es die Zielnamen nicht.
- **Indexnamen gehen mit** (`idx_exporte_laufend` → `idx_data_exports_running`
  usw.). Sie stehen in keiner Zeile der Abbildungstabelle, tragen aber die alten
  Tabellennamen im Wort und fielen sonst beim Abnahme-Grep aus §8 auf. Reine
  DDL-Bezeichner ohne Leser ausserhalb von `db.ts`. **Offene Frage an Henrik.**
- **`titelbild/<ts>.jpg` wird `banner/<ts>.jpg`** (Upload-Ordner im
  Benutzer-Storage). §4.2 verlangt die Umbenennung der Benutzer-Ordner, die
  Tabelle hat dafür keine Zeile. Der Ordner `daten/benutzer/` selbst bleibt
  vorerst. **Offene Frage an Henrik.**
- **`#tracker=`-Werte bleiben deutsch.** §3.4 friert sie ausdrücklich ein, die
  Abbildungstabelle nennt sie im Fundort zweier `api-wert`-Zeilen trotzdem
  (`abgelaufen`, `fehler`). Nach der Rangfolge der Quellen gilt §3.4.
  **Offene Frage an Henrik.**
- **`GET /api/tracker/providers` antwortet `{ providers: […] }`.** Die Tabelle
  bildet `anbieter` auf `provider` ab; hier ist der Schlüssel eine LISTE, und
  `provider` für ein Array wäre falsch. **Offene Frage an Henrik.**
- **Nicht angefasst, weil die Tabelle keine Zeile hat:** die übrigen Felder von
  `VorlagenEintrag` in der Antwort von `GET /api/admin/mail-templates`
  (`name`, `anlass`, `platzhalter[].name|beschreibung|beispiel`, `hatLink`,
  `standard`). Sie sind Teil des API-Vertrags, stehen aber weder in §6.7 noch in
  der Tabelle. **Offene Frage an Henrik.**
- **`daten/exporte/` bleibt** als Ablagename der Export-Archive: ein
  Datenordner, kein Bezeichner, und ein Umzug verwaiste laufende Archive.
- Der Ordner `public/audio/sfx/`, die Fragment-Schlüssel der Mail-Links und die
  `MAPTALE_*`-Variablen bleiben wortgleich (§3.4).
