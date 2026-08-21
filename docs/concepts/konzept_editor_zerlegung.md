---
stand: 2026-08-17
status: Entwurf, nichts davon umgesetzt
betrifft: [src/studio/editor.ts]
icon: module
---

# Umbauplan: Studio-Editor zerlegen (`editor.ts`)

**Ziel:** [src/studio/editor.ts](../../src/studio/editor.ts) so aufteilen, dass
Alltagsänderungen (Inspector-Feld, Kartenmarker, Zeitleisten-Geste, Spur-Menü) in
einer überschaubaren Datei landen, ohne Verhalten zu ändern.

**Nachgezählt am 2026-08-17: 7 181 Zeilen.** Beim Schreiben dieses Plans waren es
rund 6 100. Die Datei ist in zehn Tagen um etwa 18 Prozent gewachsen, und das ist
die Zahl hier, die für sich spricht: Die Prämisse „bevor `editor.ts` weiter wächst"
ist keine Vorsorge mehr, sie ist überfällig. Die Bestandsaufnahme in §1 schätzt die
Blöcke deshalb zu klein. Ihre Verhältnisse dürften noch stimmen, die absoluten
Zahlen nicht, und wer den Plan aufnimmt, zählt zuerst nach.

**Ein Vorhaben wartet konkret darauf:** [Eine Bühne, ein Maler](../archive/eine-buehne-ein-maler.md)
zieht die Editor-Vorschau der Foto-Karte auf den Maler des Players und berührt
dabei genau den Block, den §1 „Rest" nennt. Es macht ihn kleiner (die
`--fe-*`-Choreografie und fünf Keyframes fallen weg) und sollte in der
Faserrichtung dieses Plans landen, nicht dagegen.

Ergänzt
[editor-ausbau.md](editor-ausbau.md) (Was) und
[zeitleiste-umbau.md](../archive/zeitleiste-umbau.md) (Wie der Achse); hier geht
es nur um **Code-Organisation**.

> Die reine Logik liegt schon in `edit-model.ts`, `timeline.ts`, `audio-clip.ts`,
> `stopps.ts`, `playback.ts`. Was bleibt, ist DOM- + MapLibre-Verdrahtung — und die
> ist in einer Datei zu einem Hotspot geworden.

---

## 1. Bestandsaufnahme

| Block (Schätzung) | ~Zeilen | Kernfunktionen |
|---|---:|---|
| Zeitleiste zeichnen + Pointer | ~2 000+ | `renderTimeline`, `wireTimeline`, `dragClip`, `timelineDrag`, `startEdgeDrag`, `moveBoundary`, `renderPlayhead` |
| Inspector / Felder / EXIF | ~1 000+ | `renderInspector`, `buildMediumFields`, `buildAudioFields`, `buildTimeField`, `buildInfoSection` |
| Karte / Track / Marker | ~500 | `buildMap`, `drawTrack`, `drawMarker`, `buildMarkerEntry`, `drawSelection`, `clickOnMap` |
| Menüs / Ablage / Großansicht | ~400 | `showFloatingMenu`, `openLaneMenu`, `renderTray`, `dragOffTray`, `showLarge` |
| Kern (Öffnen, Render, Undo, Speichern) | ~500 | `openEditor`, `loadData`, `renderAll`, `speichern`, Undo/Redo |
| Rest (SFX-Dialog, Tour-Einstellungen, Hilfen) | ~1 500 | `buildSfxRow`, `openTourSettings`, `wireOnce`, … |

Die Arbeitsteilung im Kopfkommentar von `editor.ts` bleibt gültig:

> Reine Logik in `edit-model.ts` + `timeline.ts`; hier nur DOM + MapLibre.

Neu ist die zweite Regel:

> **Verdrahtung nach Oberfläche trennen** — eine Datei = eine Ansprechfläche
> (Karte · Inspector · Zeitleiste · Menüs). Der Kern orchestriert, er implementiert
> keine Gesten.

---

## 2. Leitregeln (nicht verhandelbar)

1. **Verhalten zuerst, Dateien danach.** Jede Welle endet mit grünen Studio-Tests und
   einem manuellen Smoke (Öffnen → Klip ziehen → Grenze ziehen → Speichern → Vorschau).
   Kein sichtbarer Unterschied außer ggf. Dateinamen in Stacktraces.
2. **Keine neue Abstraktionsschicht „für Architektur“.** Kein Event-Bus, kein DI-
   Container, kein Framework. Module exportieren Funktionen; der Kern hält den
   Zustand `z` und reicht Callbacks / Getter.
3. **Zustand bleibt zentral.** Der Editor-Zustand (`z`, Overlay, Fokus, Playhead)
   wandert **nicht** in die Teilmodule als eigene Quelle. Teilmodule bekommen
   lesende Zugriffe und schreibende Callbacks — sonst entstehen zwei Wahrheiten.
4. **Keine Logik zurück in den Kern ziehen.** Was heute schon in `timeline.ts` /
   `edit-model.ts` rechnet, bleibt dort. Beim Herauslösen nur verschieben, was DOM
   oder MapLibre berührt.
5. **Eine Welle = ein PR-Thema.** CI grün (`npm test`, `npm run typecheck`), dann
   weiter. Kein „halb Inspector, halb Zeitleiste“ in einem Commit.
6. **Englisch-Rename ist ein anderes Projekt.** Bezeichner bleiben deutsch, solange
   [konzept_codebase_english_refactoring.md](konzept_codebase_english_refactoring.md)
   nicht bewusst gestartet ist. Sonst zwei Umbauten gleichzeitig.

---

## 3. Zielstruktur

```
src/studio/
  editor.ts              # Kern: oeffne/schliesse, z, renderAlles, Undo, Speichern
  editorkarte.ts         # MapLibre: Track, Marker, Fokus, Klick → Anker
  editorinspektor.ts     # rechtes Panel: Fokus-Felder, EXIF, Tour-Einstellungen
  editorzeitleiste.ts    # DOM der Leiste + Pointer-Gesten (nutzt timeline.ts)
  editormenue.ts         # Schwebe-Menüs, Spur-„+“, Kontextaktionen
  editormedien.ts        # Ablage, Großansicht, Drag aus Ablage (optional Welle 5)
  edit-model.ts          # unverändert (DOM-frei)
  timeline.ts          # unverändert (DOM-frei)
  audio-clip.ts / stopps.ts / playback.ts  # unverändert
```

Namen bewusst mit `editor*`-Präfix: klar von der reinen Logik (`timeline.ts`)
getrennt, und Vite/Lazy-Import aus `studio.ts` bleibt ein Einstieg (`editor.ts`).

**Öffentliche API nach außen bleibt klein:**

```ts
export async function openEditor(tourId: string, zurueck: () => void): Promise<void>
export function closeEditor(): void
```

Alles andere ist modul-intern oder wird nur zwischen den `editor*`-Dateien geteilt.

---

## 4. Wellen

### Welle 0 — Inventar und Nahtstellen (kein Verhalten)

**Was:** Kurze Tabelle am Dateianfang von `editor.ts` (oder in diesem Konzept
fortgeschrieben): Funktion → Zielmodul. Die Top-Blöcke mit Zeilenbereichen markieren
(`// --- Karte ---` usw.), **ohne** zu verschieben.

**Fertig wenn:** Jede der ~184 Funktionen hat ein Ziel; unklare Fälle sind gelistet
(nicht „irgendwann“).

**Aufwand:** klein (halber Tag).

---

### Welle 1 — Menüs herausziehen (`editormenue.ts`)

**Warum zuerst:** kleinste Fläche, klare Grenze, entzerrt `openLaneMenu` /
`showFloatingMenu` / `menuEntry` sofort.

**Mitnehmen:**
- `showFloatingMenu`, `closeLaneMenu`, `menuEntry`, `openLaneMenu`
- Hilfen, die **nur** Menüs brauchen

**Nicht mitnehmen:** Aktionen hinter den Einträgen (die rufen weiter in den Kern /
Overlay-Schreiber).

**Schnittstelle (Skizze):**

```ts
export function openLaneMenu(args: {
  spur: string
  knopf: HTMLElement
  markeOffset: () => number
  // Callbacks: Moment anlegen, Audio einsetzen, …
  beiMoment: (art: CameraMomentKind) => void
  beiAudioAusBibliothek: () => void
  // …
}): void
```

**Fertig wenn:** Spur-„+“ und Kontextmenüs unverändert; `editor.ts` um ~150–200 Zeilen
leichter.

---

### Welle 2 — Karte (`editorkarte.ts`)

**Mitnehmen:**
- `buildMap`, `buildTrackLayer`, `drawTrack`, `drawMarker`, `buildMarkerEntry`,
  `drawSelection`, `fitViewport`, `clickOnMap`
- Marker-Map (`Medien-ID → MarkerEintrag`) — gehört zur Karte, nicht zum Kern

**Braucht vom Kern:**
- aktuellen Track / Stopps / Fokus-Spanne (Getter)
- Callbacks: Anker verschieben, Fokus setzen, Halt wählen

**Fallen (aus Studio-CLAUDE):**
- Marker **fortschreiben**, nicht abreißen (sonst leere Kreise beim Klick).
- Fokus-Leuchten nur für den **ausgewählten** Halt, nicht alle.
- Kartenklick projiziert auf Track (`projectOntoTrack` aus `edit-model`).

**Fertig wenn:** Marker ziehen, Fokus-Abschnitt, Kartenklick → Anker; Tests zu
Stopps/Projektion unverändert grün.

---

### Welle 3 — Inspector (`editorinspektor.ts`)

**Mitnehmen:**
- `renderInspector`, `renderWithoutInspector`, `buildMediumFields`, `buildAudioFields`,
  `buildTimes`, `buildTimeField`, `feld` / `auswahl` / `regler` / `hinweis`
- EXIF-Block (`loadMediumData`, `buildInfoSection`, …)
- Tour-Einstellungen (`openTourSettings` und Panel-Inhalt)

**Schnitt:** Inspector **baut DOM und hängt Listener**; Schreiben läuft über dieselben
`withMediaEdit` / `mitAudioPatch` / … wie heute. Kein zweites Overlay-Modell.

**Fallen:**
- Flex-`flex-shrink` am hohen EXIF-Block (`flex: none`).
- Globale `button:hover` schlägt Klassen — Primärflächen in `:hover` wiederholen.
- Fokus speichert Identität; Spanne kommt aus `resolveSelection()` je Render.

**Fertig wenn:** alle Fokus-Arten (Medium, Ton, Band, Moment, Tour) editierbar;
Inspector-Tests (`studio-inspector.test.ts` soweit vorhanden) grün.

---

### Welle 4 — Zeitleisten-DOM + Pointer (`editorzeitleiste.ts`)

**Der teuerste Schnitt.** Hier liegen die gemessen kritischen Gesten
(Live-Rebuild im Zug, Filmzeit-Kopf, Klip-Reconcile).

**Mitnehmen:**
- `renderTimeline`, `wireTimeline`
- alle `zieh*` / `startEdgeDrag` / `timelineDrag` / `moveBoundary` /
  `renderPlayhead` / Klip-Bau (`buildClip`, …)

**Nicht mitnehmen / nicht neu erfinden:**
- `buildTimelineAxis`, `buildBoundaryCurve`, `stopAtFilmS`, … bleiben in `timeline.ts`
- Ton-Trim-Mathe bleibt in `audio-clip.ts`

**Schnittstelle:** Modul bekommt `host`-Elemente (Bahnen, Maßband, Kopf) und ein
schmales `ZeitleisteApi`:

```ts
type ZeitleisteApi = {
  liesZustand: () => EditorZeitZustand  // playhead, fokus, overlay-Snapshot, maßstab
  schreibeOverlay: (naechstes: EditOverlay, opts?: { zug?: boolean }) => void
  nachZugRender: () => void             // ohne Undo-Fortschreibung
  vollerRender: () => void
  // …
}
```

**Fallen (nicht „aufräumen“):**
- Während des Zugs: Maßstab einfrieren; bei Klip-Zug kein kompletter Listen-Neubau.
- `setPointerCapture`: Ziel im `pointerdown` merken.
- Auswahlrahmen innen (`inset` / `::after`), sonst frisst `overflow` den Rand.
- Fortbewegungs-Grenze über `buildBoundaryCurve`, nicht Bisektion.

**Fertig wenn:** Smoke-Checkliste §6 komplett; bestehende Tests
(`studio-playback`, `studio-audio-clip`, `studio-stopps`, …) grün; kein spürbarer
Rückschritt beim Ziehen (Ziel: weiter &lt; 8 ms/Frame am Editor-Track).

---

### Welle 5 — Medien-Nebenflächen (optional)

Ablage, Großansicht, Drag-aus-Ablage, SFX-Katalog-Zeilen — wenn nach Welle 1–4 noch
&gt; ~2 000 Zeilen in `editor.ts` liegen. Sonst im Kern lassen, bis sie stören.

---

## 5. Was bewusst im Kern bleibt

| Verantwortung | Warum |
|---|---|
| `openEditor` / `closeEditor` / `loadData` | Lebenszyklus, Lazy-Grenze zu MapLibre |
| `z` + Undo-Stack + `lastState` | eine Wahrheitsquelle |
| `renderAll` | Orchestrierung: Karte → Leiste → Inspector → Historie-Knöpfe |
| `speichern` / Neu verarbeiten | API-Grenze |
| Einmal-Verdrahtung der Shell-Knöpfe | gehört zur Seite, nicht zur Leiste |

Zielgröße Kern nach Welle 4: **ideal &lt; 1 200 Zeilen**, akzeptabel &lt; 1 800.

---

## 6. Manuelle Smoke-Checkliste (jede Welle)

Auf einer echten Tour mit Fotos, mindestens einem Video und Ton:

1. Editor öffnen, Ausschnitt passt, Marker sichtbar.
2. Foto-Klip in der Kette umordnen; außerhalb → Ort ändern; Undo einmal.
3. Standzeit am Foto-Griff; Video-Trim links/rechts; Materialanschlag-Etikett.
4. Fortbewegungs-Kante über einen Halt ziehen (Live-Bands + Filmdauer-Etikett).
5. Ton-Klip verschieben/trimmen; Loop aus → Länge am Material.
6. Inspector: Caption, Halt-Dauer, Audio-Lautstärke, EXIF aufklappen.
7. Spur-„+“ → Moment anlegen; Speichern; Vorschau im Player.
8. Ablage → Medium auf die Leiste (wenn Ablage betroffen).

---

## 7. Tests und Wächter

- Bestehende DOM-freie Tests bleiben die Sicherheitsleine; sie müssen in keiner Welle
  schwächer werden.
- Kein Pflicht-UI-Test-Framework neu einführen.
- Optional nach Welle 4: ein kleiner Drift-Wächter, der verbietet, dass `editor.ts`
  wieder Pointer-Handler für `[data-…]`-Klips enthält (Regex auf typische Muster) —
  nur wenn das Zurückrutschen real wird, nicht prophylaktisch.

---

## 8. Reihenfolge und Abhängigkeiten

```
Welle 0 → 1 (Menü) → 2 (Karte) → 3 (Inspector) → 4 (Zeitleiste) → [5]
```

- Welle 4 nicht vor 2/3 starten: sonst muss die Zeitleiste noch gegen den Monolithen
  rückrufen, und der Gewinn verpufft.
- Parallel zu Produktfeatures nur Welle 0–2; Welle 4 braucht ein ruhiges Fenster
  (kein paralleler Zeitleisten-Feature-PR).
- Unabhängig von der Player-TS-Migration
  ([konzept_player_typescript.md](../archive/konzept_player_typescript.md)).

---

## 9. Nicht-Ziele

- Editor auf ein Framework (React/Svelte) umschreiben.
- Zeitleisten-**Logik** aus `timeline.ts` zurück in den DOM-Layer mischen.
- „Clean Architecture“-Ordner (`domain/`, `infrastructure/`) ohne Nutzen für Vite-Bundles.
- Bezeichner auf Englisch (eigenes Konzept).

---

## 10. Erfolg

- Alltagsänderung an Inspector oder Karte ohne Scrollen durch Pointer-Gesten.
- Zeitleisten-Bugfix in einer Datei, die man im Kopf halten kann.
- `editor.ts` ist Orchester, nicht Baustelle.
- Kein Regressionsfenster länger als eine Welle (jede Welle shippbar).
