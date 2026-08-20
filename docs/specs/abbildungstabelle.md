---
stand: 2026-08-20
status: Welle 0 abgenommen am 2026-08-20 — alle zwölf Streitpunkte entschieden (A: alle Empfehlungen, B: AxisStop, C: Tokens gehen mit, DESIGN.md bekommt ein border-Token); Tabelle eingefroren
betrifft:
  - docs/specs/abbildungstabelle.tsv
  - docs/concepts/konzept_codebase_english_refactoring.md
  - scripts/abbildungstabelle-pruefen.mjs
systemteile: [Backend, Player, Studio, App]
---

# Abbildungstabelle: deutscher Bezeichner zu englischem

Das Werkstück der Welle 0. Sie ist nicht Beiwerk zum Umbau, sie IST der Umbau: Jede
spätere Welle, jedes Migrationsskript, jeder Agenten-Prompt und der Lauf über die
`betrifft:`-Listen liest diese eine Tabelle. Die Daten liegen maschinenlesbar in
[abbildungstabelle.tsv](abbildungstabelle.tsv), sechs Spalten, Tab-getrennt:

| Spalte | Inhalt |
|---|---|
| `ist` | der ganze heutige Bezeichner, nie ein Wortbestandteil |
| `ziel` | die englische Zielform, oder `bleibt` für Eingefrorenes |
| `art` | eine von 50 Arten, s. unten |
| `fundort` | Datei, Tabelle.Spalte oder `METHODE /pfad`; entscheidet bei Homonymen |
| `welle` | 1 bis 9 nach dem Wellenplan, `-` für alles Eingefrorene |
| `bemerkung` | Begründung, Fallstrick, Glossar-Verweis; `VORSCHLAG: ` wenn nicht durch §6 gedeckt |

Geprüft wird sie mit `node scripts/abbildungstabelle-pruefen.mjs` (Exit 1 bei Form,
Widerspruch oder Kollision).

## Woher die Zeilen kommen

| Quelle | Einträge |
|---|---:|
| Glossar §6.1 bis §6.10, §4.2 Werte, §5 Wellenplan, §3.4 Eingefrorenes | 462 |
| HTTP-API: alle 95 Routen, Felder und Werte ([api.md](api.md)) | 239 |
| Inventur `server/src` | 437 |
| Inventur `src/` | 827 |
| Inventur `android/` | 422 |
| Inventur CSS, DOM und Custom Properties | 1052 |
| abzüglich doppelt oder unschärfer erhobener Zeilen | −20 |
| zuzüglich vier aufgespaltener Sammelzeilen | +4 |
| **Summe** | **3423** |

Verteilt auf die Wellen (Stand 2026-08-20, nach den Nachträgen der Wellen 1 und 2):
618 in Welle 1 (Verträge), 427 in 2 (Server), 185 in 3 (Studio-Modelle), 635 in 4
(Studio-Verdrahtung), 387 in 5 (Player), 721 in 6 (Produktseiten), 371 in 7
(Android), 1 in 9 (die Env-Variablen als Block), 104 eingefroren. Beim Bau waren
es 3423; die Differenz sind die Zeilen, die eine gebaute Welle nachgetragen hat.

**1382 Einträge tragen `VORSCHLAG: `** (40 %). Sie sind nicht durch das Glossar gedeckt,
sondern beim Bauen entstanden, und genau sie sind der Grund, warum das Glossar nach der
Abnahme eingefroren wird: Danach erfindet kein Agent mehr etwas.

## Die drei Eigenschaften aus §11, und ob sie tragen

**Ganze Bezeichner, nie Wortbestandteile.** Erfüllt und maschinell nachgezählt. Wie nötig
das ist, sagt die Gegenprobe: Der Eintrag `s` steckt als Zeichenfolge in 1675 anderen
Einträgen, `an` in 342, `ort` in 166, `art` in 160, `ab` in 121. Wer je Wortstamm ersetzt,
zerstört in einem Lauf mehr, als die ganze Welle bringt. Das Beispiel aus §11 steht so in
der Tabelle: `karte` allein hat drei Zeilen (`map` als Zugriff auf die Editor-Landkarte,
`card` als Klasse und als DOM-id der Foto-Karte), und daneben stehen 59 weitere Einträge,
die mit „karte" beginnen, jeder mit seiner eigenen Entscheidung.

**Der Fundort ist eine eigene Spalte.** Sie trägt: **55 Ist-Namen haben mehr als eine
Zielform**, und jede ist an ihrem Ort richtig. Die teuersten:

| Ist | Zielformen je Fundort |
|---|---|
| `fehler` | `error` als Spalte, Feld und CSS-Klasse, `failed` als Statuswert, `errorCount` als Zähler im Protokoll |
| `titelbild` | `banner` in `users`, API und Profil; `cover` in `edits` und Tour (auch in `EditsFortschreibung.kt`) |
| `spur` | `trackSignature` in `stats`, `track` in der App-Aufzeichnung, `lane` als Zeitleisten-Bahn |
| `an` | `on` als Einwilligungswert, `enabled` als Schalterfeld, `to` in der Test-Mail-Antwort |
| `zeit` | `time` als placement-Wert, `at` als Protokoll-Zeitstempel |
| `modus` | `travelMode` in Room, `authMode` als dataset-Schlüssel der Anmeldung |
| `dateien` | `file_count` als Zähler in `exporte`, `files` als Liste in der API |
| `fotos` | `placedMedia` in `stats` (zählt Fotos UND Videos), `photos` in der Speicher-Aufteilung |

**Vier Zeilen mussten dafür aufgespalten werden**, und sie sind der Beleg, dass die Spalte
nicht dekorativ ist. Sie fassten mehrere Fundorte unter einer Zielform zusammen, und in
je einem dieser Fundorte war die Zielform falsch:

- `an` ist an zwei Routen der Schalter (`enabled`), in der Antwort von
  `POST /api/admin/mailvorlagen/:key/test` aber die Empfängeradresse (`to`, es ist
  `admin.email`). Ohne Blick in den Handler wäre `enabled: "admin@…"` entstanden.
- `fehler` ist überall das Fehlerfeld (`error`), in `GET /api/admin/protokoll` aber die
  ANZAHL der Fehler-Einträge, also `errorCount` nach §6.0 Regel 4.
- `titelbild` ist an den Konto-Routen `banner`, in `PUT /api/tours/:id/edits` aber das
  Tour-Titelbild und damit `cover`. Die Zeile enthielt beide Routen.
- `fotos` ist in `stats` `placedMedia`, in `GET /api/auth/me/speicher` aber die
  Bilddateien der Speicher-Aufteilung, getrennt von `videos`, also `photos`.

Keine dieser vier hätte eine Prüfung gefunden: Innerhalb einer Zelle gibt es keinen
Widerspruch. Gefunden hat sie erst die Frage „welche Zeilen nennen mehrere Fundorte und
tragen zugleich einen Namen, der anderswo anders übersetzt wird?"

**Vier weitere Zeilen standen auf der falschen Seite des Homonyms.** Im Studio hieß alles
mit „karte" zunächst `card`, obwohl vier dieser Klassen zur LANDKARTE des Editors gehören:
`karte-werkzeuge` und `karte-zoom` sind die Zoomleiste (ihre eigenen Knöpfe waren schon
richtig als `map-zoom-in`/`map-zoom-out` erkannt), `karte-info` ist die Attribution, und
`karten-schleier` ist der Wetterschleier über `#editor-map`. Sie heißen jetzt `map-tools`,
`map-zoom`, `map-attribution` und `map-scrim` und tragen „KORREKTUR bei der Abnahme" in
der Bemerkung. Der Editor hat beides auf einer Fläche: die Landkarte und die Foto-Karte
darüber, deren Bühne (`karten-buehne`, `karten-leinwand`) korrekt `card` bleibt.

**Die Art-Liste ist vollständig.** 50 Arten, die zehn größten: `css-klasse` 604,
`export-funktion` 574, `dom-id` 350, `export-typ` 329, `funktion` (Kotlin) 187,
`api-feld` 168, `datei` 147, `export-konstante` 146, `css-variable` 81, `db-spalte` 75.
Die Sorten, die §11 als „erst durch die parallele Prüfung gefunden" nennt, stehen drin:
2 Push-Schlüssel, 2 Push-Werte, 6 Mail-Platzhalter, 8 DB-Schlüsselzeilen, 6
Fragment-Schlüssel, 6 Kanal-IDs, 2 Cookies, 14 Storage-Schlüssel.

## Prüfergebnis

**Keine Widersprüche, keine Kollisionen, keine Formfehler.** Kein Ist-Name hat am selben
Fundort zwei Zielformen (ein Agent müsste sonst raten), und keine zwei Ist-Namen zeigen
in derselben Datei auf dieselbe Zielform (nach dem Umbenennen stünden sonst zwei Dinge
unter einem Namen).

Was die Prüfung dafür gefunden hat, ist eine eigene Sorte Befund: **126 Namen leben in
zwei getrennt kompilierten Welten**, und bei elf davon sind die beiden Zielformen
auseinandergelaufen. Das ist die Nahtliste aus §3.3, und es ist genau die Stelle, an der
ein Fehler nicht auffällt: Kein Compiler verbindet die Welten, und die Drift-Wächter
vergleichen VERHALTEN, nicht Namen.

## Zwölf Streitpunkte für die Abnahme

**A. Zehn Spiegel, die einen Namen brauchen — ENTSCHIEDEN am 2026-08-20:** der
Betreiber hat alle Empfehlungen übernommen, die Tabelle trägt sie als
`ENTSCHIEDEN`-Zeilen. Die Gegenüberstellung bleibt als Beleg stehen.
(Das Prüfskript meldet elf: `Titelbild` ist der Fehlalarm darunter — Cover/Banner
ist das GEWOLLTE Homonym aus §6.1, Tour gegen Profil, die Bemerkungen der Zeilen
sagen es.)

| Ist | Server schlägt vor | Web schlägt vor | Empfehlung |
|---|---|---|---|
| `filmBeiZeit` | `filmTimeAtRecordingTime` | `filmAtTime` | die lange Form: sie sagt, WELCHE Zeit gemeint ist, und die Verwechslung von Aufnahme- und Filmzeit ist der teuerste Fehler dieses Codes |
| `zeitBeiFilm` | `recordingTimeAtFilmTime` | `timeAtFilm` | dieselbe, als Gegenstück |
| `HALT_AUSBLEND_S` | `STOP_FADE_S` | `STOP_FADE_OUT_S` | `STOP_FADE_OUT_S`: es blendet AUS, und `fade` allein ließe die Richtung offen |
| `pruefeHandleForm` | `validateHandleForm` | `validateHandle` | `validateHandleForm`: daneben steht die Prüfung auf Verfügbarkeit, die etwas anderes tut |
| `HANDLE_TEXTE` | `HANDLE_TEXTS` | `HANDLE_ERROR_TEXTS` | `HANDLE_ERROR_TEXTS`: es sind ausschließlich Fehlermeldungen |
| `loopAktiv` | `loopEnabled` | `loopActive` | `loopEnabled`: §6.0 Regel 2 nennt `enabled` als Boolean-Form |
| `EinladungsZustand` | `InvitationState` | `InvitationStatus` | `…Status`: der Wert heißt in der API `status` |
| `WartelistenZustand` | `WaitlistState` | `WaitlistStatus` | dito |
| `VorlagenStand` | `TemplateStatus` | `MailTemplatesState` | `MailTemplateStatus`: `Template` allein ist im Repo mehrdeutig, `Status` folgt der API |
| `ExportStand` (Datenexport) | `DataExportStatus` | `DataExportState` (`kontomodell.ts`) | `DataExportStatus`: der Wert heißt in der API `status`; der Video-Export-Zwilling in `exportformat.ts` ist ein ANDERES Ding und bleibt `ExportProgress` |

Die beiden `handle.ts`-Zwillinge und die `filmachse`-Paare sind namentlich in §3.3 als
blinde Nähte geführt. Wer hier nichts entscheidet, bekommt zwei Wellen später zwei Namen
für eine Sache, und nichts wird rot.

**B — ENTSCHIEDEN am 2026-08-20: `AxisStop`.** `Halt` heißt zweimal etwas anderes. Das Glossar entscheidet „`stop` ist der Ort,
`hold` die Dauer". Beim Bauen kam ein dritter Fall dazu: `Halt` in
[filmachse.ts](../../src/filmachse.ts) ist das Halt-INTERVALL der Achse, und `Stop` ist
für den gruppierten Foto-Halt aus `stopps.ts` schon vergeben. Vorschlag: `AxisStop`.
`main.ts` importiert beide Module, ein gemeinsamer Name ginge nicht.

**C — ENTSCHIEDEN am 2026-08-20: sie gehen mit, und DESIGN.md bekommt ein
allgemeines `border`-Token** (der Drift-Wächter wird damit übersetzungsfrei).
Die Frage, wie sie stand: Die Tabelle sagt ja und leitet die 81 Custom Properties
aus den englischen Tokens in [DESIGN.md](../../DESIGN.md) ab (`--akzent` → `--primary`,
`--tafel` → `--card`, `--fokus-ring` → `--focus-ring`). Damit verschwindet die
Übersetzung, die der Drift-Wächter heute überbrückt. Eine Stelle bleibt offen: `--rand`
heißt in DESIGN.md `topbar-border`, wird aber überall als allgemeiner Rand benutzt.
Entweder bekommt DESIGN.md ein `border`-Token, oder eine Rest-Übersetzung bleibt.

Nicht zu entscheiden, weil das Glossar es schon tut: `mid` statt `medium` (§6.9), die
drei Bedeutungen von „Spur" (`track`/`lane`/`audioTrack`), die Pegel-Wörter
(`volume`/`gain`/`masterGain`). Die Tabelle folgt ihnen ohne Abweichung.

## Zwei Befunde nebenbei

**Die Begründung in §4.2 zum `tokens`-Blob stimmt nicht.** Dort steht, er trage „nur
fremde Schlüssel"; tatsächlich sind es deutsche (`zugriff`, `erneuerung`, `laeuftAb`,
`externerNutzer`). Die Entscheidung bleibt trotzdem richtig, nur die Begründung ist eine
andere: Der Blob liegt AES-verschlüsselt in der Zeile und ist per `UPDATE` gar nicht
umschreibbar. Der Satz in §4.2 gehört ausgetauscht.

**Eine Route ohne Aufrufer.** `POST /api/tracker/:provider/sync` ist samt Bremse und
Antwortfeldern registriert, aber weder Web noch App rufen sie: Der „Jetzt abrufen"-Knopf,
für den sie gebaut wurde, existiert in keiner Oberfläche. Kein Migrations-Thema, aber es
fiel bei der Vollzählung auf und steht sonst nirgends.

## Was die Tabelle nicht ist

Sie ist **keine Ersetzungsliste zum Blind-Anwenden**. Der Fundort sagt, wo eine Zeile
gilt, nicht wo sie greift: `fehler` als Statuswert steht in sechs Dateien, die Zeile
nennt die Tabelle. Und sie ersetzt die Nahtliste nicht, sie ergänzt sie um die Namen.

Sie ist auch **nicht das Glossar**. §6 bleibt die Quelle der Wörter; diese Tabelle ist
ihre Anwendung auf jeden einzelnen Bezeichner im Repo. Wo beide sich widersprechen, gilt
§6, und die Tabelle wird korrigiert.

**Für die Start-Migration** (§4.3) wird aus den Zeilen mit Art `json-feld`, `json-wert`
und `schema-kennung` die Datenstruktur `server/src/migrations/keys-v2.ts` erzeugt, nicht
abgeschrieben: „Die Abbildung ist dieselbe Tabelle wie im Code, nicht zwei Listen."
