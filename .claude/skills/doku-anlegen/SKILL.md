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

Die erste `#`-Überschrift ist der Titel. Direkt darunter, jede Angabe optional:

```markdown
# Konzept: Sprechende Wegpunkte

Stand: 2026-08-17 · Status: **Entwurf, nichts gebaut** · Betrifft: `src/tour.ts`, `server/src/pipeline/`
Systemteile: Player, Backend

**Ziel:** Ein Satz, der sagt, was jemand danach kann und heute nicht.
```

- **`Status:`** treibt die Ampel *und* steht als Satz auf der Roadmap-Karte. Deshalb
  konkret schreiben: „Etappen 0–6 gebaut, Polar live" sagt etwas, „in Arbeit" nicht.
  Wortwahl zählt: `nichts gebaut|Entwurf|Konzept,` → Entwurf, `teilweise|Etappe|Paket|offen`
  → Unterwegs, `gebaut|live|erledigt` → Gebaut, `abgearbeitet|abgeschlossen` → gilt als
  durch und verschwindet aus der Roadmap.
- **`Systemteile:`** nur setzen, wenn die Ableitung danebenliegt — sie zählt die
  genannten Pfade und gewichtet den eigenen Ort am schwersten.
- **`Archiviert aus: <bereich>`** schreibt der Viewer beim Archivieren selbst.

## 3. Klappentext in `docs/README.md`

Der Viewer nimmt den Satz aus der Liste dort; fehlt er, nimmt er den ersten Absatz
(der oft „Ziel:" oder eine Warnung ist). Also eintragen:

```markdown
* [`konzept_sprechende_wegpunkte.md`](concepts/konzept_sprechende_wegpunkte.md) — Ein Satz, wofür das Dokument gut ist.
```

## 4. Auf die Roadmap

Nur für Konzepte und Mockups, und nur von Hand: Eine Reihenfolge ist eine
Entscheidung. In [`docs/roadmap.md`](../../../docs/roadmap.md) unter die passende
Phase (`In Arbeit` · `Beschlossen` · `Angedacht`):

```markdown
* [konzept_sprechende_wegpunkte.md](concepts/konzept_sprechende_wegpunkte.md) — der nächste Schritt, nicht die Zusammenfassung.
```

Im laufenden Viewer geht das auch per „…"-Menü an der Karte. Was in keiner Phase
steht, erscheint unter „Ohne Phase" und wird beim Bauen gemeldet — vergessene
Konzepte fallen dadurch auf.

## 5. Ein Mockup anlegen

Eine `.html` in `docs/mockups/`, Namenspräfix bestimmt den Systemteil:
`app-` (Android), `player-`, `studio-`, `live-` (öffentliche Seiten).

- `<title>Mockup — <Was es zeigt></title>` — der Viewer schneidet „Mockup — " weg.
- Bilder relativ aus `docs/mockups/landing|titelbilder|tourbilder/` laden. Diese
  Ordner sind Arbeitskopien für die Prototypen, kein Bildarchiv; ungenutzte Dateien
  meldet der Bau.
- Die Vorschau nimmt der Bau mit Headless-Chrome auf (`--neu` erzwingt es). Im
  Dev-Server bekommt ein geöffneter Prototyp automatisch eine Leiste mit „← Doku",
  Roadmap und Archivieren.
- Design-Tokens aus [`DESIGN.md`](../../../DESIGN.md) verwenden, damit der Prototyp
  aussieht wie das Produkt.

## 6. Danach

```bash
npm run docs -- --ohne-bilder   # ~1 s, ohne Mockup-Screenshots
npm test                        # der Wächter prüft Bereiche, Systemteile, Roadmap
```

Der Bau meldet, was er nicht erraten konnte: Dokumente ohne Systemteil, Konzepte
ohne Phase, Bilder, die kein Prototyp nutzt, tote Verweise in `roadmap.md`.

## Sprache

Deutsch, wie im ganzen Repo. **Kein langer Gedankenstrich in neuen Texten** (Punkt,
Komma oder Doppelpunkt; oft sind zwei Sätze besser), und nicht die Wörter „Formular"
oder „wie das Wetter steht". Zahlen im Fließtext nur, wenn sie stimmen bleiben —
zählbare Mengen nennt der Viewer selbst.
