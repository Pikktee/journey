# Konzept: Codebase-Bezeichner auf Englisch

**Stand:** 7. August 2026 · **am 13.08. geprüft und VERTAGT** (§9) — nichts davon umgesetzt,
und bis auf Weiteres bleibt auch neuer Code deutsch. Was jetzt schon gilt: die linke
Glossar-Spalte (§6), ein Wort je Begriff.
**Anlass:** Zukunftssicherheit (Mitentwickler, Hiring, öffentliche APIs) bei
weiterhin deutschem Chat und deutschen Produkttexten.
**Leitplanke:** Coding-Agenten übernehmen die Tipparbeit; Menschen halten
Glossar, Wellengrenze und Review. Kein Big-Bang.

---

## 1. Ziel und Nicht-Ziel

### Ziel
Interne Bezeichner (Funktionen, Typen, Variablen, Dateinamen, später DB/API)
auf **Englisch** vereinheitlichen.

### Bleibt Deutsch
- UI-Texte, Mail-Vorlagen, Rechtstexte, Commit-Messages-Stil nach Geschmack
- Produktchat und Specs dürfen Deutsch bleiben
- Domain-Wörter im Glossar haben eine feste englische Code-Form; die
  deutsche Bedeutung steht daneben

### Nicht-Ziel (eigene Themen)
- Mehrsprachigkeit der Oberfläche → [konzept_mehrsprachigkeit_i18n.md](konzept_mehrsprachigkeit_i18n.md)
- Modus-Konsolidierung → [modi-konsolidierung.md](modi-konsolidierung.md)

### Ausgangslage: der Player ist schon englisch

Die Codebase ist **nicht durchgehend deutsch**, und das prägt den Zuschnitt der
Wellen unten. Gemessen am 2026-08-11:

| Bereich | Sprache der Bezeichner |
|---|---|
| Player (`src/*.js`) | **englisch** — der alte Prototyp-Code |
| Studio, Konto, Profil, Admin (`src/**/*.ts`) | deutsch |
| Server (`server/`), Android (`android/`) | deutsch |

Im Player sind rund **30 von 839** Bezeichnern deutsch (~4 %) — durchweg jüngere
Ergänzungen: `planeRueckzug`, `kamFolger`, `merkeSeitenverhaeltnis`,
`setzeViewportHoehe`, `zeichneKopf`, `hoehenPruefen` und ein paar mehr in
`main.js`, `photopins.js`, `atmosphere.js`, `ui.js`, `tour.js`.

Deshalb kommt der Player in den Wellen 1–7 **nicht vor**: Dort ist fast nichts zu
tun. Die Wellen greifen genau dort, wo nach dem Prototyp weitergebaut wurde.

**Verhältnis zur TypeScript-Migration**
([konzept_player_typescript.md](../archive/konzept_player_typescript.md)): Die beiden
Vorhaben berühren sich kaum — das eine betrifft `src/*.js`, das andere alles
darum herum. Die eine echte Abhängigkeit läuft in eine Richtung: Wer die ~30
Restnamen des Players anfassen will, tut das **nach** der TS-Migration, weil
Umbenennen dann eine typgeprüfte Operation über den ganzen Graph ist statt einer
Textsuche. Umgekehrt gewinnt die TS-Migration nichts davon, vorher anglisiert zu
haben.

### Agenten-Qualität
Englisch im Code macht Agenten **nicht** grundsätzlich schlechter, solange
Glossar + `CLAUDE.md` mitziehen. Schlechter wird es durch **Halb-Umbau**
(drei Synonyme für dieselbe Sache) und Docs, die noch die alten Namen führen.

---

## 2. Spielregeln

1. **Das Glossar ist verbindlich.** Kein Agent erfindet Synonyme
   (`Halt` ist nicht mal `stop`, mal `hold`, mal `pause`).
2. **Eine Welle = ein PR-Thema**, CI grün, kurzer manueller Smoke, dann weiter.
3. **Persistierte Verträge zuletzt** (JSON-Felder, SQLite, Room, URL-Pfade) —
   mit Versionierung oder Alias, nie stumm umbenannt.
4. **Pro Welle Docs mitziehen** (`CLAUDE.md`, Studio-/Server-CLAUDE, Specs) —
   nicht erst am Ende.
5. **UI-Strings nicht mit-refactorn.** Code `visibility`, Label „Sichtbarkeit“.

Vor dem Start in `CLAUDE.md` die Sprachregel anpassen:

> Code-Bezeichner Englisch (siehe Glossar in
> `docs/concepts/konzept_codebase_english_refactoring.md`). UI- und
> Produkttexte Deutsch. Chat darf Deutsch.

---

## 3. Wellen-Reihenfolge

| Welle | Inhalt | Risiko |
|------:|--------|--------|
| **0** | Glossar einfrieren, CLAUDE-Regel, Scope-Grenze, Smoke-Checkliste | — |
| **1** | Internals ohne Persistenz: zuerst `editmodell.ts` + Tests (s. §5) | niedrig |
| **2** | Weitere Studio-DOM-freie Module (`zeitleiste`, `tonklip`, `stopps`, `pruefung`) | niedrig |
| **3** | Studio-Verdrahtung (`editor.ts`, `studio.ts`) + Dateiumbenennungen der Welle | mittel |
| **4** | Server-Internals (Pipeline, Mail-Bausteine) — **Route-Pfade und JSON-Felder bleiben** | mittel |
| **5** | Android ViewModels/Screens (Enums-Speicherwerte und Room-Spalten bleiben) | mittel |
| **6** | API-Transporttypen & interne Helper; URL-Aliases optional | hoch |
| **7** | DB-Spalten, Room-Felder, Overlay-/Tour-JSON-Felder mit Schema-Bump / Migration | sehr hoch |
| **8** | Rest-Docs, Mockup-Kommentare, Aufräumen verbotener Synonyme | niedrig |
| **9** *(optional)* | Die ~30 deutschen Restnamen im Player (s. §1). **Erst nach der TS-Migration** — dann greift „Symbol umbenennen" typgeprüft. | niedrig |

**Aufwand (realistisch, mit Agenten):** eher **mehrere Wochen gestreckt** als
„2–3 Tage“. Tipparbeit ist billig; Review, Migration und Altbestand sind es nicht.
Die frühere Schätzung von 2,5 Tagen unterschätzt Persistenz und Drift-Wächter massiv.

---

## 4. Persistenz — nicht in Welle 1–5

Diese Namen sind Verträge. Umbenennung braucht Versionierung, Migration und
Rückwärtslesbarkeit.

### JSON
- Schema-IDs: `maptale/upload@1`, `maptale/edits@1`, `maptale/tour@1`,
  `maptale/anreicherung@1`
- Overlay-Felder u. a.: `medien`, `geloescht`, `reihe`, `holdS`, `trim`,
  `vonS`, `bisS`, `modi`, `kamera`, `momente`, `audio`, `wetter`, `titelbild`,
  `anker`, `versatzFilmS`, `dauerFilmS`, `einstiegS`, `lautstaerke`, `quelle`,
  `staerke`
- Anreicherung: `befunde`, `videoMeta`, `videoSchnittSignatur`, `trimSignatur`,
  `orte`, `wetterRoh`
- Upload: `modiAutomatisch`, `trackFile`, `takenAt`, …

### HTTP / URLs
- `/api/...`-Pfade, `/@handle`, `/tour/:id`, `/konto`, `/anmelden`, …
- Tour-IDs `t_…`

### SQLite / Room
- Spalten und Tabellen in `server/src/db.ts` und Android `Entities.kt`
- Enum-**Speicherwerte** wie `AUFNAHME`, `ENTWURF`, `LAEDT_HOCH` (Android)

**Muster für Welle 7:** interne Code-Namen neu, externe Felder alt — oder
Schema-Bump (`edits@2`) mit Leser, der `@1` noch versteht. Nicht mischen.

---

## 5. Welle 1 — konkreter Schnitt

### Scope
| Drin | Draußen |
|------|---------|
| `src/studio/editmodell.ts` — exportierte **Funktionen** und **Typnamen** | Interface-**Felder**, die `edits.json` spiegeln (`geloescht`, `reihe`, `staerke`, `ab`, …) |
| Aufrufer-Anpassungen nur so weit nötig (`editor.ts`, `tonklip.ts`, …) | Dateiumbenennung `editmodell.ts` → später (Ende Welle 2/3) |
| Tests: `test/studio-editor.test.ts`, `studio-baukasten.test.ts`, `studio-stopps.test.ts`, `studio-tonklip.test.ts`, `studio-inspektor.test.ts` | Server-Schema, Android, DB |

### Warum dieser Schnitt
- DOM-frei, gut getestet, zentral für den Editor
- Trainiert das Glossar an echten Namen (`materialisiereModi`, `mitMedienEdit`, …)
- Kein Persistenz-Risiko, wenn JSON-Felder unangetastet bleiben

### Umbenenn-Liste Welle 1 (Funktionen / Typen)

| Ist | Soll |
|-----|------|
| `Modus` | `TravelMode` |
| `WetterModus` | `WeatherMode` |
| `TrackPunkt` | `TrackPoint` |
| `MediumEdit` | `MediaEdit` *(Typname; Felder unverändert)* |
| `MediumEditPatch` | `MediaEditPatch` |
| `ModusGrenze` | `TravelModeBoundary` |
| `WetterGrenze` | `WeatherBoundary` |
| `KameraPreset` | `CameraPreset` — Literalwerte `nah`/`mittel`/`weit`/`standard` bleiben (Overlay-Vertrag) |
| `KameraGrenze` | `CameraBoundary` |
| `MomentArt` | `CameraMomentKind` — Literalwerte `umkreisen`/`aufstieg`/`innehalten` bleiben |
| `KameraMoment` | `CameraMoment` |
| `AudioEintrag` | `AudioEntry` |
| `AudioPatch` | `AudioPatch` *(ok)* |
| `EditOverlay` | `EditOverlay` *(ok)* |
| `EditorSegment` | `EditorSegment` *(ok)* |
| `UndoStapel` | `UndoStack` |
| `TrackProjektion` | `TrackProjection` |
| `AnzeigeAbschnitt` | `DisplaySegment` |
| `MediumBasis` / `MediumAnzeige` | `MediaBase` / `MediaView` |
| `erfasseUndo` | `recordUndo` |
| `offsetZuIso` / `isoZuOffset` | `offsetToIso` / `isoToOffset` |
| `projiziereAufTrack` | `projectOntoTrack` |
| `punktZuOffset` | `pointAtOffset` |
| `naechsterPunktIndex` | `nearestPointIndex` |
| `mitMedienEdit` | `withMediaEdit` |
| `mitModusGrenze` / `ohneModusGrenze` | `withTravelModeBoundary` / `withoutTravelModeBoundary` |
| `materialisiereModi` | `materializeTravelModes` |
| `mitTrim` | `withTourTrim` |
| `mitKameraGrenze` / `ohneKameraGrenze` | `withCameraBoundary` / `withoutCameraBoundary` |
| `mitWetterGrenze` / `ohneWetterGrenze` | `withWeatherBoundary` / `withoutWeatherBoundary` |
| `mitMoment` / `ohneMoment` | `withCameraMoment` / `withoutCameraMoment` |
| `mitAudioEintrag` / `ohneAudioEintrag` | `withAudioEntry` / `withoutAudioEntry` |
| `mitAudioPatch` | `withAudioPatch` |
| `pruefeOverlay` | `validateOverlay` |
| `zerlegeFuerAnzeige` | `splitForDisplay` |
| `miniaturQuelle` | `thumbnailSource` |
| `effektiveMedien` | `effectiveMedia` |
| `LEERES_OVERLAY` | `EMPTY_OVERLAY` |
| `HISTORIE_MAX` | `HISTORY_MAX` |
| `WETTER_MODI` | `WEATHER_MODES` |
| `MOMENT_DEFAULT_S` | `MOMENT_DEFAULT_S` *(ok)* |

`MODI` kann `TRAVEL_MODES` werden — Werte (`walk`, …) bleiben.

### Agenten-Prompt (Welle 1, Vorlage)

```
Welle 1 des Englisch-Refactors (docs/concepts/konzept_codebase_english_refactoring.md §5).

Nur: Typ- und Funktionsnamen in src/studio/editmodell.ts + alle Aufrufer/Tests.
Glossar in dem Dokument ist verbindlich.
NICHT umbenennen: Interface-Felder die edits.json spiegeln, Schema-Strings,
Literalwerte nah/mittel/weit/umkreisen/…, Dateinamen, Server, Android.

Danach: npm test (betroffene Studio-Tests) und npm run typecheck.
```

### Done-Kriterien Welle 1
- [ ] Tabelle oben umgesetzt
- [ ] `npm test` und `npm run typecheck` grün
- [ ] Kein Diff an `server/src/schema/edits.ts` Feldnamen
- [ ] Kurzverweis in `src/studio/CLAUDE.md`: neue Namen + Link zum Glossar
- [ ] Smoke: Tour im Studio öffnen, Modus-Grenze ziehen, Undo einmal

---

## 6. Glossar (verbindlich)

Synonyme in der rechten Spalte sind **verboten**, außer hier erlaubt.
Neue Begriffe zuerst hier eintragen, dann im Code verwenden.

**Solange die Migration vertagt ist (§9), gilt die LINKE Spalte genauso verbindlich.**
Das ist die wichtigere Hälfte: Ein Synonym kostet heute, in jeder Suche und in jedem
Konzept — die englische Zielform kostet erst, wenn übersetzt wird. Und eine Übersetzung
wird billig, wenn vorher pro Begriff EIN Wort dasteht; teuer wird sie, wenn man erst die
Bedeutung sortieren muss, bevor man ein Wort wählen kann.

Drei Doppel stehen unten noch in der linken Spalte, weil sie so im Code stehen. Sie sind
hiermit aufgelöst — umbenannt wird **beiläufig**, wenn eine Etappe die Stelle ohnehin
öffnet, nie als eigener Lauf:

| Begriff | verbindlich deutsch | Alt-Namen im Code | wo |
|---|---|---|---|
| Ort, an dem der Film anhält | **Halt** | `Stopp`, `PlayerStopp`, `gruppiereStopps`, `stops`, Datei `stopps.ts` | Player + `src/studio/stopps.ts` |
| Wie lange die Karte steht | **Standzeit** | `haltedauerS` (neben `klemmeStandzeit` in derselben Datei) | `zeitleiste.ts` |
| Zeit, die der Film läuft | **Filmzeit** | — (einheitlich) | — |

`HOLD_HIDE`/`holdT`/`display.holdS` bleiben, wie sie sind: englisches Prototyp-Erbe des
Players und im Austauschformat ein persistiertes Feld (Welle 7).

### 6.1 Domain-Kern

| Deutsch / Ist | Englisch (Code) | Nicht verwenden / Hinweis |
|---------------|-----------------|---------------------------|
| Tour (technisch) | `tour` | nicht `trip` für Tour-JSON |
| Halt / Stopp (Foto-Halt) | `stop` | nicht `pause` (Aufnahme-Pause); nicht `hold` (das ist Standzeit/`holdS`) |
| Halt-Intervall | `stopInterval` | |
| Halt-Stück (Aufnahme in Kette) | `stopItem` | |
| Filmzeit | `filmTime` | nicht wall-clock |
| Aufnahmezeit | `recordingTime` | |
| Achse (Filmzeit-Abbildung) | `timelineAxis` | UI-Leiste = `timeline` |
| Anker | `anchor` | |
| Reihe (Order im Halt) | `order` / Feld `reihe` bleibt bis Welle 7 | |
| Titelbild (Tour) | `cover` / `coverImage` | Profil-Banner: `profileBanner` |
| Fortbewegung / Modus | `travelMode` | nicht UI-„mode“ |
| Modus-Grenze | `travelModeBoundary` | |
| Standzeit / Haltedauer | `holdDuration` — Feld bleibt `holdS` | |
| Sichtbarkeit (Tour) | `visibility` | getrennt von Profil/Suchindex |
| Pause (GPS-Stillstand) | `pause` | `collapsePauses` / Zeitraffer getrennt |
| Overlay / Edits | `editOverlay` | |

### 6.2 Auth, Konto, Profil

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---------------|-----------------|---------|
| Benutzer | `user` | |
| Konto | `account` | nicht `profile` |
| Profil | `profile` | öffentlich |
| Anzeigename | `displayName` | |
| Handle | `handle` | nicht `username` |
| Einwilligung | `consent` | nicht `preference` |
| Newsletter-Einwilligung | `newsletterConsent` | |
| Textfassung (Rechtstext) | `textVersion` | |
| Suchmaschinen (Schalter) | `searchIndexing` | nicht mit `visibility` mischen |
| Einladung | `invitation` | |
| Warteliste | `waitlist` | |
| Gerät (Sitzung/App) | `device` | |
| Sitzung | `session` | ≠ App-Token |
| Export-Stand | `exportStatus` | |
| läuft ab am | `expiresAt` | |

### 6.3 Studio / Zeitleiste

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---------------|-----------------|---------|
| Zeitleiste | `timeline` | |
| Zustandsband | `stateBand` | kein Clip |
| Szenen-Klip | `sceneClip` | |
| Ton-Klip | `audioClip` | |
| Fokus (Auswahl) | `selection` | ≠ Playhead |
| materialisiere… | `materialize…` | ganze Stufenfunktion festschreiben |
| mitX / ohneX | `withX` / `withoutX` | immutable Updates |
| baue… | `build…` | |
| setze… | `set…` | |
| prüfe… | `validate…` / `check…` | Upload-Befund: `importReport` |
| Trim (Tour) | `tourTrim` | Video: `mediaTrim` / Feld `trim` |
| gelöscht (Overlay) | Code später `removed`; Feld `geloescht` bis Welle 7 | nicht Datei löschen |
| effektive Medien | `effectiveMedia` | |
| Kamera-Moment-Arten | Literale bleiben; Typ `CameraMomentKind` | `innehalten` → Kind-Wert bleibt bis Welle 7 |
| Umkreisen / Aufstieg / Innehalten (Aktion) | später `orbit` / `rise` / `hold` als Literal-Bump | |

### 6.4 Server / Pipeline

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---------------|-----------------|---------|
| laden (DB/Tour) | `load…` | |
| verarbeiten | `processTour` | |
| Anreicherung | `enrichment` | |
| kollabierePausen | `collapsePauses` | GPS-Drift |
| raffePausen | `compressPauses` | Film-Zeitraffer |
| Befund (Vision) | `finding` | ≠ Upload-`importReport` |
| Benennung | `naming` | |
| darfSehen | `canView` | |
| nurOwner | `requireOwner` | |
| registriere…Routen | `register…Routes` | ≠ Benutzer-Registrierung |
| Protokoll (Admin) | `auditLog` | |

### 6.5 Android

| Deutsch / Ist | Englisch (Code) | Hinweis |
|---------------|-----------------|---------|
| AufzeichnungScreen | `RecordingScreen` | |
| TourenScreen | `ToursScreen` | |
| AufzeichnungsService | `RecordingService` | |
| starteAufnahme / beendeAufnahme | `startRecording` / `finishRecording` | |
| Bewegungserkennung | `activityRecognition` | |
| AufnahmeModus (Foto/Video) | `captureMode` | ≠ `travelMode` |
| Status-Enum-**Namen** | `Recording`, `Draft`, … | **Speicherwerte** `AUFNAHME` … bleiben bis Migration |
| TeilenBlatt | `ShareSheet` | |
| Ruhe / Lädt / Fertig | `Idle` / `Loading` / `Complete` | |

### 6.6 Datei- / Modulnamen (Wellen 2–3)

| Ist | Soll |
|-----|------|
| `editmodell.ts` | `edit-model.ts` |
| `zeitleiste.ts` | `timeline.ts` |
| `tonklip.ts` | `audio-clip.ts` |
| `stopps.ts` | `stops.ts` |
| `pruefung.ts` | `import-validation.ts` |
| `sichtbarkeit.ts` | `visibility.ts` |
| `profilmodell.ts` | `profile-model.ts` |
| `kontomodell.ts` | `account-model.ts` |
| `profilbearbeiten.ts` | `edit-profile.ts` |
| `titelbilder.ts` | `profile-banners.ts` |
| `routen.ts` | `routes.ts` |
| `anreicherung.ts` | `enrichment.ts` |
| `exportinhalt.ts` | `export-content.ts` |

`anreicherung.json` auf Disk: **nicht** mit dem Modul umbenennen (Welle 7).

---

## 7. Arbeitsmodus mit Coding-Agenten

1. Welle wählen, Glossar-Auszug + „nur dieses Modul“ + Ausschlussliste nennen.
2. Agent: Rename + Tests; Mensch: Namenskonsistenz und Vertragsgrenzen prüfen.
3. CI grün → Glossar um gefundene Lücken ergänzen → nächste Welle.
4. Verbot: „Rename the whole repository to English in one go.“

---

## 8. Smoke-Checkliste (nach jeder Welle)

- [ ] Web: `npm test` + `npm run typecheck`
- [ ] Server (ab Welle 4): `cd server && npm test`
- [ ] Android (ab Welle 5): `./gradlew test`
- [ ] Manuell: Anmelden → Tour öffnen → Editor-Grenze ziehen → Speichern → Player
- [ ] Diff enthält keine unbeabsichtigten JSON-Feld-Renames (`geloescht`, `medien`, …)

---

## 9. Entscheidungstor

Start, wenn mindestens eines gilt:

- bald Mitentwickler ohne Deutsch, oder
- öffentliche API/Lib geplant, oder
- der bestehende Hybrid (schon teils Englisch) stört mehr als der Umbau.

### Stand 13. August 2026: geprüft und VERTAGT

Aufgekommen mitten in Paket B des [Gleichlauf-Umbaus](konzept_gleichlauf_player_editor.md):
Der legt neue geteilte Module an (`filmuhr.ts`, `einblendung.ts`, bald `filmachse.ts`), und
die Frage war, ob wenigstens die englisch entstehen sollen.

**Entschieden: nein. Alles bleibt deutsch, auch neue Module.** Damit ist die frühere
Empfehlung dieses Abschnitts („neue Module bereits englisch, stop the bleeding") ausdrücklich
zurückgenommen. Drei Gründe:

1. **Die Regel wäre nicht ablesbar gewesen.** Der naheliegende Schnitt „`src/*.ts` ist der
   Player, also englisch" hält nicht: Flach in `src/` liegen auch `passwortstaerke.ts`,
   `app-nav.ts`, `dialogschicht.ts`, `entwicklungsstand.ts`, `handle.ts` — Produktmodule der
   deutschen Seite ohne eigenes Verzeichnis. Eine Grenze hätte entweder Dateien verschoben
   (mitten in den Etappen, die genau diese Dateien anfassen) oder wäre eine Liste zum
   Nachschlagen geworden.
2. **Der Mix ist teurer als der Aufschub.** Eine englische Insel plus Sonderregel erzeugt
   genau den Zustand, den §1 als agentenschädlich benennt — und der wächst mit jedem Paket.
3. **Später wird es kaum teurer.** Die Arbeit steckt laut diesem Papier in Review,
   Persistenz und Drift-Wächtern, nicht in der Zahl der Namen. Ob dreißig Bezeichner mehr zu
   übersetzen sind, ist Tipparbeit für einen Agenten.

**Was stattdessen gilt:** die linke Glossar-Spalte (§6) — ein Wort je Begriff, auf Deutsch.
Das ist die Wartbarkeitsfrage, die heute wirklich Geld kostet, und sie ist von der Sprache
unabhängig.

**Wieder aufmachen, wenn** eines der drei Tor-Kriterien oben eintritt. Bis dahin ist diese
Frage beantwortet — wer sie erneut stellt, findet hier die Antwort samt Begründung, statt sie
neu herzuleiten.

---

## 10. Nächster Schritt

Solange vertagt (§9), gibt es genau einen: **die deutschen Doppel beiläufig auflösen** —
`Stopp` → Halt, `haltedauerS` → Standzeit —, wenn eine Etappe die Stelle ohnehin öffnet.
Kein eigener Lauf dafür.

Wenn das Tor aufgeht:

1. Dieses Dokument reviewen (Glossar-Streitpunkte: vor allem `Halt` → `stop`).
2. CLAUDE-Sprachregel anpassen (Welle 0).
3. Welle 1 per Agenten-Prompt in §5 ausführen.
