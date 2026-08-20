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
* **Eingeplant werden KONZEPTE, keine Mockups.** Ein Mockup ist eine Antwort
  in einem Konzept und kein eigener Plan: Es hat keinen Status, keine Ampel und
  kann nie abgearbeitet sein — auf einer Karte neben Konzepten fehlte ihm genau
  die Auskunft, um die es hier geht. Ist das Mockup der nächste Schritt, steht
  das im Schritt-Text seines Konzepts, samt Link. Der Link stellt zugleich die
  Beziehung Konzept↔Mockup her, die der Viewer sonst nicht kennt. Wer trotzdem
  ein Mockup einträgt, bekommt beim Bauen eine Meldung.
* Jeder Listenpunkt verweist auf ein Dokument. **Der Linktext ist der Name auf der
  Karte** — kurz und einheitlich, nicht der Dateiname und nicht die volle
  Überschrift des Dokuments („Studio-Editor zerlegen" statt „Umbauplan:
  Studio-Editor zerlegen (editor.ts)"). Steht dort noch ein Dateiname, nimmt der
  Viewer den Dokumenttitel.
* Der Text nach dem Gedankenstrich ist der **nächste Schritt**, nicht die
  Zusammenfassung des Dokuments. Er ist das Einzige, was auf der Karte steht: Der
  Stand kommt aus dem Dokument und hängt im Tooltip.
* **`[wartet auf: <pfad>]` am Zeilenende** macht aus der Liste einen Ablauf. Die
  Gegenrichtung („blockiert …") leitet der Viewer selbst ab und zeigt sie auf der
  anderen Karte — notiert wird sie nur EINMAL, am wartenden Eintrag, denn dort
  denkt man beim Einplanen darüber nach. Sie steht in derselben Zeile und nicht
  als Unterpunkt: Beim Verschieben in eine andere Phase hängt der Viewer ganze
  Zeilen um, ein Unterpunkt bliebe zurück.
* Was in keiner Phase steht, erscheint im Viewer unter „Noch nicht eingeplant" —
  vergessene Konzepte fallen dadurch auf, statt zu verschwinden.

Der Stand der Umsetzung kommt NICHT von hier, sondern aus der `Status:`-Zeile des
jeweiligen Dokuments. Wer eine Etappe abschließt, ändert sie dort.

---

## In Arbeit · laufend

Angefangen und noch nicht fertig. Was hier steht, ist im Code sichtbar.

* [Steuerleiste des Players](concepts/konzept_player_leiste_ui.md) — Die Leiste nach Paket G.


## Beschlossen · als Nächstes

Entschieden und vorbereitet, aber noch nicht angefangen.

* [Bezeichner auf Englisch](concepts/konzept_codebase_english_refactoring.md) - Welle 0 abgeschlossen (2026-08-20): [Abbildungstabelle](specs/abbildungstabelle.md) abgenommen und eingefroren, Sprachregel gesetzt. Jetzt Welle 1: die Verträge samt API, EIN Deploy-Tag; direkt davor DB-Snapshot und Kopie des Datenordners. Bis dahin keine neuen Einladungen. Ganz am Ende Schritt 9: die Env-Variablen als eigener Ops-Schritt.
* [Play Store](concepts/konzept_play_store_interner_test.md) - Die App aus dem APK-Versand herausholen. [wartet auf: concepts/konzept_codebase_english_refactoring.md]
* [Tempoempfinden](concepts/konzept_tempoempfinden.md) — Die zwei offenen Kandidaten messen.
* [Video-Export](concepts/konzept_video_export.md) — Etappe 2 (der Auftrag). [wartet auf: concepts/konzept_monetarisierung.md]
* [Medien nachreichen](concepts/konzept_medien_nachreichen_und_loeschen.md) — Die App-Seite fehlt noch; das Mockup dafür steht ([app-aufnahmen-hinzufuegen.html](mockups/app-aufnahmen-hinzufuegen.html)).
* [Tracker-Anbindung](concepts/konzept_tracker_integrationen.md) — Nach Polar der zweite Anbieter.
* [Newsletter](concepts/konzept_newsletter.md) — Teil B: der redaktionelle Versand.
* [Studio-Editor zerlegen](concepts/konzept_editor_zerlegung.md) — Bevor `editor.ts` weiter wächst.
* [Umstieg auf Astro](concepts/konzept_astro_umstieg.md) — Etappe 0: Pflegestand des Node-Adapters prüfen und den Durchstich bauen. [wartet auf: concepts/konzept_codebase_english_refactoring.md]
* [Mehrsprachigkeit](concepts/konzept_mehrsprachigkeit_i18n.md) — `/de/` und `/en/`. [wartet auf: concepts/konzept_astro_umstieg.md]

## Angedacht · ohne Termin

Gewollt, aber ohne Reihenfolge. Was hier steht, wartet auf einen Anlass.

* [Live mitverfolgen](concepts/konzept_live_mitverfolgen.md) — Live-Link während der Aufnahme.
* [Reisen und Sammlungen](concepts/konzept-reisen-sammlungen.md) — Mehrtägige Touren zusammenfassen.
* [Editor-Ausbau](concepts/editor-ausbau.md) — Erzählerische Werkzeuge im Studio.
* [Tour nur aus Fotos](concepts/foto-tour.md) — Ganz ohne GPS-Track.
* [Modi konsolidieren](concepts/modi-konsolidierung.md) — Ein neuer Modus soll eine Zeile sein.
* [Die Tafeln auf die Leinwand](concepts/die-tafeln-auf-die-leinwand.md) — Erst die Klickflächen von Startscreen und Finale, dann die Optik.
* [Monetarisierung](concepts/konzept_monetarisierung.md) — Die Esri-Lizenz klären.
* [Social Login](concepts/konzept_social_login.md) — Anmelden mit Google.
* [Maptale als iOS-Web-App](concepts/konzept_maptale_als_ios_webapp.md) — Erst die Gegenprobe am Gerät: Bleibt man in der installierten Fassung angemeldet?
