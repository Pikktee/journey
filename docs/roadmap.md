# Roadmap

**Diese Datei ist die Quelle des Roadmap-Bereichs im Doku-Viewer** (`npm run docs`).
Sie wird von Hand gepflegt: Eine Reihenfolge kann man aus Dokumenten nicht ableiten,
sie ist eine Entscheidung.

So funktioniert sie:

* Jede `##`-Überschrift ist eine Phase. Vor dem `·` steht, wie VERBINDLICH sie
  ist, dahinter grob das Wann.

  Die drei Stufen benennen bewusst den Grad der Entscheidung und nicht den
  Zeitpunkt (das ist der Kern des verbreiteten „Now / Next / Later": ein Datum
  ist ein Versprechen, das ein Entwurf nicht halten kann):
  **In Arbeit** — angefangen, im Code sichtbar. **Beschlossen** — entschieden,
  aber noch nicht begonnen. **Angedacht** — gewollt, wartet auf einen Anlass.
  Wer die Namen ändert, ändert sie hier; der Viewer liest sie aus dieser Datei.
* Der Absatz darunter sagt in einem Satz, worum es in der Phase geht.
* Jeder Listenpunkt verweist auf ein Dokument. Der Text nach dem Gedankenstrich ist
  der nächste Schritt, nicht die Zusammenfassung des Dokuments.
* Was in keiner Phase steht, erscheint im Viewer unter „Noch nicht eingeplant" —
  vergessene Konzepte fallen dadurch auf, statt zu verschwinden.

Der Stand der Umsetzung kommt NICHT von hier, sondern aus der `Status:`-Zeile des
jeweiligen Dokuments. Wer eine Etappe abschließt, ändert sie dort.

---

## In Arbeit · laufend

Angefangen und noch nicht fertig. Was hier steht, ist im Code sichtbar.

* [konzept_video_export.md](concepts/konzept_video_export.md) — Etappe 2 (Auftrag), aber erst nach der Klärung der Bildquelle.
* [konzept_monetarisierung.md](concepts/konzept_monetarisierung.md) — Esri-Lizenz klären: sie blockiert den Video-Export.
* [konzept_tempoempfinden.md](concepts/konzept_tempoempfinden.md) — die zwei offenen Kandidaten messen.
* [konzept_tracker_integrationen.md](concepts/konzept_tracker_integrationen.md) — nach Polar der zweite Anbieter.
* [konzept_medien_nachreichen_und_loeschen.md](concepts/konzept_medien_nachreichen_und_loeschen.md) — App-Seite fehlt noch.

## Beschlossen · als Nächstes

Entschieden und vorbereitet, aber noch nicht angefangen.

* [konzept_play_store_interner_test.md](concepts/konzept_play_store_interner_test.md) — die App aus dem APK-Versand herausholen.
* [konzept_social_login.md](concepts/konzept_social_login.md) — Anmelden mit Google.
* [konzept_newsletter.md](concepts/konzept_newsletter.md) — Teil B: der redaktionelle Versand.
* [konzept_player_leiste_ui.md](concepts/konzept_player_leiste_ui.md) — die Steuerleiste nach Paket G.
* [konzept_editor_zerlegung.md](concepts/konzept_editor_zerlegung.md) — `editor.ts` zerlegen, bevor er weiter wächst.

## Angedacht · ohne Termin

Gewollt, aber ohne Reihenfolge. Was hier steht, wartet auf einen Anlass.

* [konzept_live_mitverfolgen.md](concepts/konzept_live_mitverfolgen.md) — Live-Link während der Aufnahme.
* [konzept-reisen-sammlungen.md](concepts/konzept-reisen-sammlungen.md) — Sammlungen und mehrtägige Reisen.
* [konzept_mehrsprachigkeit_i18n.md](concepts/konzept_mehrsprachigkeit_i18n.md) — `/de/` und `/en/`.
* [editor-ausbau.md](concepts/editor-ausbau.md) — erzählerische Werkzeuge im Studio.
* [foto-tour.md](concepts/foto-tour.md) — Touren ganz ohne GPS-Track.
* [modi-konsolidierung.md](concepts/modi-konsolidierung.md) — ein neuer Modus soll eine Zeile sein.
* [konzept_codebase_english_refactoring.md](concepts/konzept_codebase_english_refactoring.md) — Bezeichner auf Englisch.
