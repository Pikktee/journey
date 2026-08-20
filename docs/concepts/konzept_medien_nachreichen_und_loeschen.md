---
stand: August 2026
status: Server und Studio gebaut (2026-08-09), App offen
betrifft:
  - server/
  - src/studio/
  - android/
  - datenschutz.html
icon: bilder
---

# Konzept: Medien nachreichen & endgültig löschen

Mockups liegen fertig vor: [studio-aufnahmen-nachreichen.html](../mockups/studio-aufnahmen-nachreichen.html)
(Studio) und [app-aufnahmen-hinzufuegen.html](../mockups/app-aufnahmen-hinzufuegen.html) (App).

## 1. Zielsetzung

Zwei Dinge, die heute nicht gehen und zusammengehören, weil beide am Manifest hängen:

1. **Nachreichen:** Fotos/Videos zu einer bestehenden Tour hinzufügen — im Studio per
   Dateiauswahl, in der App aus der Galerie (auch während der Aufnahme).
2. **Endgültig löschen:** Ein entferntes Medium ist wirklich weg — Rohdatei, Ableitungen,
   Quota. Nicht nur aus der Wiedergabe genommen.

Das Nachreichen ist zugleich **Etappe 0 der Tracker-Integrationen**
([konzept_tracker_integrationen.md](konzept_tracker_integrationen.md)): Eine Cloud-Tour
entsteht dort track-only und ist sofort `bereit` — genau der Zustand, in dem das Hinzufügen
heute mit 409 abgewiesen wird. Ohne diese Route liefert der Polar-Import eine leere Karte
mit Linie; der Hybrid-Fluss „14 Fotos aus diesem Zeitraum gefunden — hinzufügen?" ist der
eigentliche Produktwert.

## 2. Ist-Stand und warum es heute nicht geht

- `PUT /api/tours/:id/media/:mid` ([server/src/routes/media.ts](../../server/src/routes/media.ts))
  verlangt eine **im Manifest vorhandene** Medien-ID und antwortet bei Status
  `bereit`/`verarbeitung` mit **409** — Medien sind nach dem Rendern absichtlich
  unveränderlich (`immutable`-Cache-Header der Auslieferung).
- Das Manifest wird beim Anlegen der Tour geschrieben und danach nie mehr angefasst
  (Android-CLAUDE: „Manifest unveränderlich"). Die Medien-IDs vergibt der Client.
- „Löschen" existiert nur als Overlay-Flag `edits.medien[id].removed`
  ([server/src/schema/edits.ts](../../server/src/schema/edits.ts)): Medium aus der
  Wiedergabe nehmen, **die Rohdatei bleibt liegen** — und zählt weiter aufs Quota.

## 3. Nachreichen: das Manifest wird append-only

**Neue Route `POST /api/tours/:id/medien`** nimmt neue Manifest-Einträge entgegen
(`type`, `file`, `takenAt`, optional `anchor`/`caption`/`durationS`/`quelle` — dieselbe Form
wie `UploadMedium`). Danach je Datei das bestehende `PUT /api/tours/:id/media/:mid`, zum
Abschluss `reprocess`.

**Nachgereicht (2026-08-10): `quelle` macht die Route idempotent.** Ein Eintrag mit bereits
bekannter `quelle` wird nicht ein zweites Mal angelegt — die vorhandene Zuordnung geht
zurück, Länge und Reihenfolge der Antwort bleiben gleich. Nötig geworden ist das mit dem
Foto-Nachzug der App: Sie kann den Bestand einer Tour nur über das GERENDERTE `tour.json`
prüfen, und das kennt nachgereichte Medien erst nach dem Rendern. Scheitert `reprocess`,
wiederholt sie den Lauf und lüde dieselben Bilder ein zweites Mal hoch. Das Studio setzt das
Feld nicht: Dort wählt ein Mensch Dateien aus, und zwei Aufnahmen desselben Augenblicks sind
Absicht. Damit ist die offene Entscheidung 14.1 des Tracker-Konzepts
beantwortet: **eigene Route**, nicht „Manifest ergänzen + finalize" über den bestehenden Weg.

Entwurfsentscheidungen:

- **Die IDs vergibt der SERVER**, nicht der Client (Antwort der Route enthält die
  Zuordnung Eintrag → ID). Beim Anlegen war die Client-Vergabe nötig (idempotente
  Wiederholung des Uploads); beim Nachreichen entschärft die Server-Vergabe die bekannte
  Medien-ID-Kollisionsklasse und garantiert, dass keine ID je wiederverwendet wird.
- **Append-only:** Bestehende Einträge werden von dieser Route nie verändert oder
  entfernt. Die `immutable`-Zusage der Auslieferung bleibt gültig, weil kein Dateiname
  je neu belegt wird.
- **Statusregel:** erlaubt bei `angelegt`, `bereit`, `fehler`; **409 nur bei
  `verarbeitung`** (der Renderer liest `media/` gerade). Das `PUT` für nachgereichte
  IDs muss in denselben Zuständen erlaubt sein — der heutige pauschale
  `bereit`-Riegel gilt dann nur noch für Einträge, deren Datei bereits liegt
  (Überschreiben bleibt verboten).
- **Quota und Verifikation wie beim Upload** (Vorabprüfung per Content-Length, harte
  Pro-Datei-Grenze im Stream-Guard).
- **Platzierung:** wie beim Erst-Upload — GPS-Anker schlägt Zeit, sonst Zeit-Platzierung
  entlang des Tracks. Die Zeitzonen-Fallen beim Galerie-Abgleich (EXIF ohne Zone) stehen
  im Tracker-Konzept, Abschnitt 4, und gelten hier wörtlich.

**Clients:**

- **Studio:** Dateiauswahl, EXIF-Auslese clientseitig wie beim Erst-Upload
  (Mockup „Aufnahmen nachreichen"). Kein Galerie-Scan — ein Browser hat keine Galerie.
- **App:** Galerie-Scan im Zeitfenster der Tour, Auswahl-Dialog, Upload; auch während
  einer laufenden Aufnahme (Mockup „Aufnahmen hinzufügen"). Kein stiller Scan, nichts
  ohne Zustimmung — dieselbe Linie wie im Tracker-Konzept.

## 4. Löschen heißt löschen

**Entscheidung (2026-08-09): Ein gelöschtes Medium wird physisch gelöscht** — Rohdatei,
Bildfassungen, Thumbnails, ggf. Poster — und der Speicher wird frei. Das Overlay-Flag
`geloescht` bleibt, ändert aber seine Rolle: Es ist der **Zwischenzustand während der
Bearbeitung**, nicht mehr der Endzustand.

Warum: Wer ein Foto löscht, erwartet nicht, dass es serverseitig weiterliegt und aufs
Quota zählt — das ist auch die DSGVO-Linie des Projekts. Das alte Verhalten („aus der
Wiedergabe nehmen, Datei bleibt") war ein redaktionelles Werkzeug, keine Antwort auf die
Absicht „weg damit". Ein eigenes „nur ausblenden, aber behalten" wird bewusst **nicht**
angeboten: Es verkomplizierte die Oberfläche um genau diese Unterscheidung, und wer ein
Bild behalten will, hat es in seiner Galerie — Maptale ist nicht der Fotospeicher.

### 4.1 Zweistufig im Studio, sofort in der App

- **Studio:** Während der Bearbeitung kippt Löschen nur das Overlay-Flag — **Undo/Redo
  funktioniert weiter** (der Editor-Undo lebt vom Referenzvergleich des Overlays; hart
  löschen mitten in der Sitzung zerstörte ihn). **Beim Speichern** werden als `geloescht`
  markierte Medien physisch gelöscht, mit klarer Ansage vorher („2 Fotos werden endgültig
  gelöscht"). Danach ist es weg — auch aus Quota und Datenexport.
- **App:** kein Undo-Stack → Bestätigungsdialog, dann sofort hart löschen
  (`DELETE`-Route direkt).

### 4.2 Mechanik auf dem Server

- **Route `DELETE /api/tours/:id/media/:mid`** — erlaubt bei `angelegt`, `bereit`,
  `fehler`; **409 nur bei `verarbeitung`**. Der `immutable`-Cache-Header steht dem nicht
  entgegen: Eine gelöschte Datei wird `404`, nicht stale ausgeliefert — der Riegel bei
  `bereit` schützt vor *Überschreiben unter altem Namen*, nicht vor Verschwinden.
- **Tombstone statt Manifest-Umbau:** Der Manifest-Eintrag bleibt stehen (das Manifest
  ist das Protokoll dessen, was hochgeladen wurde), die **Pipeline überspringt Einträge
  ohne Datei**. So bleibt append-only intakt und keine Medien-ID wird je neu vergeben.
- **Mit der Rohdatei fallen die Ableitungen:** Bildfassungen, Thumbnail, bei Videos die
  geschnittene Auslieferungsdatei und das Poster. Anschließend `reprocess`, damit das
  gerenderte `tour.json` das Medium nicht mehr referenziert (im Studio passiert das mit
  dem Speichern ohnehin; die App stößt es nach dem Löschen an).
- **Titelbild-Sonderfall:** War das gelöschte Bild das Cover, wählt der nächste Render
  ein neues (derselbe Fallback wie beim Anlegen).
- **Overlay-Hygiene:** Der `edits.medien[id]`-Eintrag eines physisch gelöschten Mediums
  wird beim Speichern mit entfernt — ein Edit auf eine Datei, die es nicht mehr gibt,
  ist toter Zustand.
- **Quota:** `pruefeQuota`/`artDerDatei` zählen nur, was liegt — mit dem Löschen der
  Dateien ist der Speicher automatisch frei, keine Sonderlogik.

### 4.3 Zusagen nach außen

- **[datenschutz.html](../../datenschutz.html):** Beschreibung des Löschens prüfen und
  auf „endgültig, Speicher wird frei" schärfen — die heutige Overlay-Semantik darf dort
  nicht als Dauerzustand stehen bleiben.
- **Datenexport (Art. 20):** exportiert wird, was existiert — ein gelöschtes Medium
  taucht nicht mehr auf, sein Tombstone im Manifest schon (er enthält keine Bilddaten,
  nur Metadaten des einstigen Uploads: Zeitpunkt, Typ, Dateiname).

## 5. Reihenfolge und Einordnung

| # | Schritt | Inhalt | Stand |
|---|---|---|---|
| 1 | **Server: Nachreichen** | `POST …/medien`, Statusregeln, Server-IDs, Tests | **fertig** (2026-08-09) |
| 2 | **Server: Löschen** | `DELETE …/media/:mid`, Tombstone-Überspringen in der Pipeline, Ableitungen, Cover-Fallback | **fertig** (2026-08-09) |
| 3 | **Studio** | Nachreichen-Dialog (Mockup), Löschen zweistufig beim Speichern, Ansage | **fertig** (2026-08-09) |
| 4 | **App** | Galerie-Scan im Zeitfenster, Auswahl, Upload; Löschen mit Bestätigung | offen |
| — | Tracker-Foto-Nachzug | schrumpft auf den App-Teil (Scan, Zeitzonen, Dialog) — der Server-Teil ist erprobt | offen |

Was beim Bauen anders entschieden wurde als oben skizziert:

- **Der Editor blendet nur Tombstones aus, nicht jeden Eintrag ohne Datei.** Bei einer Tour im
  Status `angelegt` läuft der Upload gerade erst — ein Medium dort verschwinden zu lassen,
  hätte den Befund-Screen leer gezeigt. Die Pipeline filtert weiterhin beides.
- **Nach dem Nachreichen läuft `reprocess`, kein Edit-Speichern.** Ein neues Foto hat noch
  keinen Bildbefund im Anreicherungs-Cache; ein billiger Render ließe es ohne
  Wetter-Verfeinerung und ohne Benennung mitlaufen.
- **Die Ablage-Aufnahme ist im Streifen ein Ring, kein zweiter Farbton** — `--warn` (#e8a13c)
  und `--akzent` (#f59e0b) sind beide Bernstein und nebeneinander nicht zu unterscheiden.

Schritte 1–3 sind für sich auslieferbar und ein eigenständiges Feature, auch ohne dass je
ein Tracker angebunden wird. Der App-Teil (4) ist der teuerste (Berechtigungen,
Zeitzonen-Heuristik, UI-Fluss) und lohnt spätestens, wenn Cloud-Touren existieren, denen
Fotos fehlen.

## 6. Tests (Skizze)

| Prüft |
|---|
| Nachreichen bei `bereit` legt Manifest-Eintrag an, `PUT` der neuen Datei erlaubt, alte Dateien weiter unüberschreibbar |
| Nachreichen bei `verarbeitung` → 409 |
| Server-IDs kollidieren nie mit vorhandenen (auch nicht mit gelöschten/Tombstones) |
| `DELETE` entfernt Rohdatei + Ableitungen, Quota sinkt, zweites `DELETE` idempotent |
| Pipeline rendert eine Tour mit Tombstone ohne Fehler und ohne Referenz auf das Medium |
| Cover-Fallback, wenn das Titelbild gelöscht wurde |
| Studio-Speichern: `geloescht`-markierte Medien → `DELETE` + Overlay-Eintrag entfernt |
