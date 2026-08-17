---
name: doku-anlegen
description: Neue Dokumente, Konzepte und HTML-Mockups für Maptale anlegen — wohin sie gehören, welchen Kopf sie tragen, wie sie in Viewer und Roadmap erscheinen. Nutzen, wenn ein Konzept, eine Architektur-Notiz, ein Runbook, eine Spezifikation oder ein Prototyp entsteht, umbenannt, archiviert oder eingeplant wird.
---

# Doku anlegen

Alles unter `docs/` wird vom lokalen Viewer gelesen (`npm run docs`, dann
<http://maptale.localhost:5123/doku/>). Er **leitet ab, statt zu verlangen** — ein
neues Dokument erscheint ohne jede Registrierung. Was er nicht erraten kann,
meldet er beim Bauen. Vollständige Beschreibung: [`docs/README.md`](../../../docs/README.md).

## 1. Wohin gehört es?

| Ordner | Inhalt | Frage, die er beantwortet |
| --- | --- | --- |
| `docs/concepts/` | Entwürfe, offene Vorhaben | Was wollen wir bauen? |
| `docs/architecture/` | umgesetzte Entscheidungen | Wie funktioniert es heute? |
| `docs/specs/` | Datenformate, Schnittstellen | Was ist verbindlich? |
| `docs/ops/` | Deployment, Zugänge, Release | Wie mache ich es nach? |
| `docs/mockups/` | HTML-Prototypen als Vorlage | Wie soll es aussehen? |
| `docs/archive/` | Erledigtes, Verworfenes | Warum wurde es so? |

Ein **neuer Ordner** wird automatisch ein eigener Bereich; der Bau warnt, dass ihm
Farbe, Motiv und Satz fehlen (`BEREICHE` in `scripts/docs-viewer/sammeln.mjs`).

## 2. Der Kopf eines Dokuments

**Front Matter in der ersten Zeile**, danach die `#`-Überschrift. Jede Angabe
ist freiwillig; der Viewer zeigt sie als Tafel unter dem Titel.

```markdown
---
stand: 2026-08-17
status: Entwurf, nichts gebaut
betrifft:
  - src/tour.ts
  - server/src/pipeline/
systemteile: [Player, Backend]
---

# Konzept: Sprechende Wegpunkte

**Ziel:** Ein Satz, der sagt, was jemand danach kann und heute nicht.
```

- **`status`** treibt die Ampel *und* steht als Satz auf der Roadmap-Karte. Deshalb
  konkret schreiben und als FREITEXT: „Etappen 0–6 gebaut, Polar live" sagt etwas,
  „in Arbeit" nicht. Wortwahl zählt: `nichts gebaut|noch nicht gebaut|nichts davon
  umgesetzt|vertagt|Entwurf|geplant` → Entwurf, `teilweise|Etappe|Paket|offen` →
  Unterwegs, `gebaut|live|erledigt` → Gebaut, `abgearbeitet|abgeschlossen` → gilt als
  durch und verschwindet aus der Roadmap.
- **`stand`** als ISO-Datum (`2026-08-17`); „August 2026" bleibt stehen, wo der Tag
  nie behauptet wurde.
- **`betrifft`** ist eine Liste von Pfaden, aus der auch die Systemteile abgeleitet
  werden. **`systemteile`** nur setzen, wenn diese Ableitung danebenliegt.
- **`archiviert_aus`** schreibt der Viewer beim Archivieren selbst.
- **Nur diese Feldnamen** werden gelesen; ein Tippfehler wäre stumm, deshalb hält
  ein Wächter die Liste (`FELDER` in `scripts/docs-viewer/kopf.mjs`).
- Die **alte Prosa-Zeile** (`Stand: … · Status: … · Betrifft: …`) gilt weiter als
  Rückfall. Nicht BEIDES setzen: Zwei Stände sind einer zu viel, und der Wächter
  meldet es.

## 3. Klappentext in `docs/README.md`

Der Viewer nimmt den Satz aus der Liste dort; fehlt er, nimmt er den ersten Absatz
(der oft „Ziel:" oder eine Warnung ist). Also eintragen:

```markdown
* [`konzept_sprechende_wegpunkte.md`](concepts/konzept_sprechende_wegpunkte.md) — Ein Satz, wofür das Dokument gut ist.
```

## 4. Auf die Roadmap

**Nur KONZEPTE, keine Prototypen**, und nur von Hand: Eine Reihenfolge ist eine
Entscheidung. Ein Mockup ist eine Antwort in einem Konzept — es hat keinen
Status, keine Ampel und kann nie abgearbeitet sein. Ist der Prototyp der nächste
Schritt, steht das im Schritt-Text seines Konzepts samt Link (der Link stellt
zugleich die Beziehung her). Ein Prototyp in `roadmap.md` wird beim Bauen
gemeldet, und der Dienst weist ihn ab. In [`docs/roadmap.md`](../../../docs/roadmap.md) unter die passende
Phase (`In Arbeit` · `Beschlossen` · `Angedacht`):

```markdown
* [konzept_sprechende_wegpunkte.md](concepts/konzept_sprechende_wegpunkte.md) — der nächste Schritt, nicht die Zusammenfassung.
```

Im laufenden Viewer geht das auch per „…"-Menü an der Karte. Was in keiner Phase
steht, erscheint unter „Ohne Phase" und wird beim Bauen gemeldet — vergessene
Konzepte fallen dadurch auf.

## 4a. Wenn eine Etappe fertig ist

**Im selben Commit wie der Code**, nicht später:

1. `status` auf den neuen Sachstand — konkret, nicht „in Arbeit": „Etappe 2
   gebaut, 3 offen", „Server und Studio gebaut, App offen". Ist der PLAN durch
   (nicht das Produkt), gehört „abgearbeitet" hinein; dann fällt das Konzept von
   selbst aus der Roadmap.
2. `stand` auf das heutige Datum (ISO). Ohne das ist der neue Status nicht von
   einem alten zu unterscheiden.
3. Den **nächsten Schritt** in [`docs/roadmap.md`](../../../docs/roadmap.md)
   nachziehen — er ist das Einzige, was auf der Roadmap-Karte steht. Ist nichts
   mehr zu tun, den Eintrag herausnehmen.
4. Steht das Vorhaben in einer Phase, die nicht mehr stimmt (fertig, aber noch
   „In Arbeit"), die Phase wechseln. Der Viewer zeigt den Widerspruch als
   „Stand prüfen" an, aber erst, wenn ihn jemand ansieht.

Warum von Hand: `status` ist eine Behauptung über Code, und die lässt sich nicht
ableiten. Zwei Versuche, den Verdacht am Git-Datum der Dateien aus `betrifft` zu
messen, sind gescheitert — `src/ui.ts` wird von allem angefasst, die Prüfung
schlug bei 7 von 17 Konzepten falsch an. Der Bau meldet deshalb nur den Fall ohne
Ratespiel: laufend, aber der Kopf seit über drei Wochen unangetastet.

## 4b. Umbenennen statt neu anlegen

Ändert sich der Name eines vorhandenen Dokuments, **nicht von Hand verschieben**:
Das „…"-Menü im Viewer benennt Überschrift und Dateiname in einem Zug um und
zieht die Verweise in `docs/` und im Handbuch nach (Index, Roadmap,
Querverweise). Von Hand bleibt fast immer einer stehen, und ein toter Link fällt
erst auf, wenn ihn jemand braucht.

## 5. Ein Mockup anlegen

Eine `.html` in `docs/mockups/`, Namenspräfix bestimmt den Systemteil:
`app-` (Android), `player-`, `studio-`, `live-` (öffentliche Seiten).

- `<title>Mockup — <Was es zeigt></title>` — der Viewer schneidet „Mockup — " weg.
- Stand und Status als `<meta name="maptale:stand|status|systemteile" content="…">`
  im `<head>`. HTML kennt kein Front Matter; die Namen sind dieselben.
- Bilder relativ aus `docs/mockups/landing|titelbilder|tourbilder/` laden. Diese
  Ordner sind Arbeitskopien für die Prototypen, kein Bildarchiv; ungenutzte Dateien
  meldet der Bau.
- **Keine Vorschaubilder mehr.** Die Kacheln zeigten Screenshots, die den Anfang
  des Prototyps trafen — bei uns also Marke, Titel und Merksatz statt der
  Oberfläche. Im Dev-Server bekommt ein geöffneter Prototyp eine Leiste mit
  „← Doku", Datei-Griffen und Archivieren — KEINE Roadmap-Phase, die kommt ans
  Konzept.
- **Zu welchem Konzept gehört der Entwurf?** Wird aus den Links abgeleitet: Wer
  im Konzept den Prototyp verlinkt, stellt die Beziehung her, und die Kachel
  zeigt „Gehört zu …". Fehlt der Link, obwohl die Beziehung besteht:
  `<meta name="maptale:gehoert-zu" content="concepts/x.md">`.
- Design-Tokens aus [`DESIGN.md`](../../../DESIGN.md) verwenden, damit der Prototyp
  aussieht wie das Produkt.

## 6. Danach

```bash
npm run docs                    # ~1 s
npm test                        # der Wächter prüft Bereiche, Systemteile, Roadmap
```

Der Bau meldet, was er nicht erraten konnte: Dokumente ohne Systemteil, Konzepte
ohne Phase, Bilder, die kein Prototyp nutzt, tote Verweise in `roadmap.md`.

## Sprache

Deutsch, wie im ganzen Repo. **Kein langer Gedankenstrich in neuen Texten** (Punkt,
Komma oder Doppelpunkt; oft sind zwei Sätze besser), und nicht die Wörter „Formular"
oder „wie das Wetter steht". Zahlen im Fließtext nur, wenn sie stimmen bleiben —
zählbare Mengen nennt der Viewer selbst.
