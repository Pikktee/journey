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

* [Monetarisierung](concepts/konzept_monetarisierung.md) — Die Esri-Lizenz klären.
* [Video-Export](concepts/konzept_video_export.md) — Etappe 2 (der Auftrag). [wartet auf: concepts/konzept_monetarisierung.md]
* [Die Foto-Karte auf eine Leinwand](concepts/die-foto-karte-auf-eine-leinwand.md)
* [Tempoempfinden](concepts/konzept_tempoempfinden.md) — Die zwei offenen Kandidaten messen.
* [Tracker-Anbindung](concepts/konzept_tracker_integrationen.md) — Nach Polar der zweite Anbieter.
* [Medien nachreichen](concepts/konzept_medien_nachreichen_und_loeschen.md) — Die App-Seite fehlt noch.

## Beschlossen · als Nächstes

Entschieden und vorbereitet, aber noch nicht angefangen.

* [Play Store](concepts/konzept_play_store_interner_test.md) — Die App aus dem APK-Versand herausholen.
* [Social Login](concepts/konzept_social_login.md) — Anmelden mit Google.
* [Newsletter](concepts/konzept_newsletter.md) — Teil B: der redaktionelle Versand.
* [Steuerleiste des Players](concepts/konzept_player_leiste_ui.md) — Die Leiste nach Paket G.
* [Studio-Editor zerlegen](concepts/konzept_editor_zerlegung.md) — Bevor `editor.ts` weiter wächst.

## Angedacht · ohne Termin

Gewollt, aber ohne Reihenfolge. Was hier steht, wartet auf einen Anlass.

* [Live mitverfolgen](concepts/konzept_live_mitverfolgen.md) — Live-Link während der Aufnahme.
* [Reisen und Sammlungen](concepts/konzept-reisen-sammlungen.md) — Mehrtägige Touren zusammenfassen.
* [Mehrsprachigkeit](concepts/konzept_mehrsprachigkeit_i18n.md) — `/de/` und `/en/`.
* [Editor-Ausbau](concepts/editor-ausbau.md) — Erzählerische Werkzeuge im Studio.
* [Tour nur aus Fotos](concepts/foto-tour.md) — Ganz ohne GPS-Track.
* [Modi konsolidieren](concepts/modi-konsolidierung.md) — Ein neuer Modus soll eine Zeile sein.
* [Bezeichner auf Englisch](concepts/konzept_codebase_english_refactoring.md) — Vertagt, Glossar gilt schon.
