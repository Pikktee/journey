---
stand: 2026-08-19
status: Entwurf, nichts gebaut
betrifft:
  - erlebnis.html
  - studio.html
  - index.html
  - galerie.html
  - src/routen.ts
  - public/
icon: paket
---

# Konzept: Maptale als installierbare Web-App auf iOS

**Ziel:** Auf dem iPhone lässt sich Maptale zum Home-Bildschirm hinzufügen und
verhält sich danach wie eine App: eigenes Icon, keine Adressleiste, ein Einstieg,
der zur eigenen Bibliothek führt. Es ist der Ersatz für die native App, die es
für Android gibt und für iOS auf absehbare Zeit nicht.

**Nicht** Gegenstand dieses Konzepts ist das Vollbild im gewöhnlichen mobilen
Browser. Das ist eine eigene, kleinere Sache und seit dem 2026-08-19 gebaut
([src/vollbild.ts](../../src/vollbild.ts)): Der Start-Knopf einer Tour ruft die
Fullscreen API, die auf Android und auf neuem iOS greift und sonst still
durchfällt. Die beiden Vorhaben wurden im Gespräch mehrfach verwechselt, deshalb
steht die Trennung hier oben.

## Warum überhaupt

Für Android gibt es die Aufnahme-App ([android/](../../android/)). Auf iOS gibt es
nichts, und eine native iOS-App ist ein eigenes Vorhaben mit eigener Sprache,
eigenem Store-Konto und eigener Auslieferung. Eine installierbare Web-App deckt
den Teil ab, der ohne Gerätezugriff auskommt: die eigenen Touren ansehen,
verwalten, teilen. Das **Aufzeichnen** deckt sie ausdrücklich nicht ab, siehe
unten.

## Der Kern: was ist Maptale auf einem iPhone?

Das ist die Frage, die vor jeder Technik steht, und sie ist noch nicht
beantwortet. Der Verdacht:

| Bereich | auf dem iPhone | Begründung |
| --- | --- | --- |
| Abspielen | ja, formatfüllend | der Player kann das längst |
| Galerie, Profil | ja | Listen und Karten, unkritisch |
| Bibliothek (`/app`) | ja | die eigenen Touren sehen und ordnen |
| Tour-Angaben, Sichtbarkeit | ja | wenige Felder |
| Kontoeinstellungen | ja | eine gewöhnliche Seite |
| **Editor (Zeitleiste)** | **nein** | s. unten |
| Aufzeichnen | nein | Web kann keinen Hintergrund-GPS-Dienst |

**Der Editor ist der eigentliche Streitpunkt.** Er lässt sich nicht „ausblenden"
und auch nicht responsiv verkleinern: Die Zeitleiste mit Klip-Ketten,
Trim-Griffen, Zustandsbändern und Kanten ist auf 390 px Breite kein reduziertes
Layout, sondern ein anderer Entwurf. Heute gibt es dort keinen Riegel, nur
Breakpoints ([studio.html](../../studio.html)). Zu entscheiden ist also eines von
dreien, und das ist die Hauptarbeit dieses Konzepts:

1. **Sperren mit Begründung** — eine Tafel „Schneiden geht am größeren
   Bildschirm", plus ein Weg, die Tour trotzdem anzusehen. Ehrlich, billig, und
   die Erwartung ist danach klar.
2. **Eine kleine Fassung entwerfen** — Halte durchblättern, Titel und
   Beschreibung ändern, Musik wählen; kein Trimmen, kein Ziehen von Kanten. Das
   wäre ein eigenes Mockup und ein eigener Bauabschnitt.
3. **Nichts tun** — der Editor ist da und unbedienbar. Das ist der Zustand von
   heute und der schlechteste, sobald die Seite wie eine App aussieht: In einer
   App erwartet niemand eine Seite, die auf diesem Gerät nicht funktioniert.

Ohne diese Entscheidung ist der Rest nicht bauwürdig.

## Was technisch nötig ist

### Manifest, und damit die Android-Frage

Ein `manifest.webmanifest` mit `display`, `start_url`, Icons und Farben. Das ist
die Stelle, an der man aufpassen muss: **Ein verlinktes Manifest macht die Seite
auch auf Android installierbar** (für ein echtes WebAPK zusätzlich mit einem
Service Worker, ohne ihn bleibt es eine Verknüpfung). Dann stünden zwei Icons
nebeneinander, die verschiedene Dinge sind: die native App zeichnet auf, die
Web-App nicht. Drei Wege:

- **Kein Manifest, nur die Apple-Metas** (`apple-mobile-web-app-capable` und
  Geschwister). iOS kommt damit aus, Android sieht nichts. Der Preis: keine
  `start_url` — die App startet auf der Seite, die beim Hinzufügen offen war.
- **Manifest ausliefern und Android in Kauf nehmen**, dafür aber im Produkt
  erklären, was welches Icon tut.
- **Manifest nur an iOS ausliefern.** Technisch möglich (der Server beantwortet
  ohnehin schon Seiten, s. [server/src/routes/seiten.ts](../../server/src/routes/seiten.ts)),
  aber es ist User-Agent-Sniffing an einer Stelle, die Nginx statisch bedient.
  Zuletzt zu prüfen, nicht zuerst.

### Der Einstiegspunkt

Wenn es ein Manifest gibt, ist `start_url` zu wählen. `/app` ist der Wunsch, aber
siehe den nächsten Punkt.

### Der angemeldete Zustand kommt nicht mit

**Die zu prüfende Annahme, und die teuerste, wenn sie stimmt:** Eine
Home-Bildschirm-Web-App hat auf iOS einen eigenen Storage-Container, getrennt von
Safari. Wer in Safari angemeldet ist und die App installiert, steht darin vor der
Anmeldebühne. Das heißt:

- Die App startet beim ersten Mal auf `/anmelden`, nicht auf `/app`. Da beide
  Pfade auf `studio.html` zeigen und `setzePfad` ohnehin nachschreibt, ist das
  kein Umbau, aber eine Erwartung, die man im Text bedienen muss.
- Die Sitzung muss lange halten. Wer sich nach jedem Aufruf neu anmeldet, hat
  keine App.
- **Am Gerät gegenzuprüfen, bevor irgendetwas gebaut wird.**

### Der Weg hinaus fehlt

Im Standalone-Modus gibt es keine Adressleiste und keine Browser-Zurück-Geste
(nur ein Wischen am Rand, das nicht überall greift). Damit wird jede eigene
Navigation zur einzigen. Konkret:

- Die Pille `.zurueck` im Player muss sichtbar bleiben. Sie darf **nicht** wie
  bei `body.app` ausgeblendet werden, denn dort ersetzt die native App den
  Rückweg, hier gibt es nichts.
- Externe Ziele (Impressum, Datenschutz, App-Download auf der Landing) öffnen im
  Standalone-Modus in einer Ansicht ohne Navigation. Zu prüfen, welche Links das
  betrifft und ob sie ein `target` brauchen.
- Ein `display-mode: standalone` als Unterscheidungsmerkmal im CSS, analog zu
  `body.app`.

### Icons und Startbild

`apple-touch-icon.png` liegt schon in [public/](../../public/). Dazu kämen die
Größen fürs Manifest und die Frage nach einem Startbild.

## Etappen (Vorschlag)

0. **Gegenprobe am Gerät**: Storage-Trennung, Sitzungsdauer, wie sich
   `display-mode: standalone` meldet, wie sich das Fehlen der Zurück-Geste
   anfühlt. Ohne diese halbe Stunde ist der Rest geraten.
1. **Die Entscheidung zum Editor** (oben, drei Wege), und wenn es Weg 2 wird, ein
   Mockup dazu.
2. Apple-Metas plus `display-mode`-Behandlung auf dem gewählten Seitensatz.
3. Manifest samt Android-Entscheidung.
4. Der Weg hinaus: Rückweg-Pille, externe Links, Einstiegstext für den
   nicht angemeldeten ersten Start.

## Was hier nicht hingehört

- **Offline-Betrieb.** Ein Service Worker, der Touren zwischenspeichert, ist ein
  eigenes Vorhaben. Eine Tour ist Satellitenkacheln, Geländedaten, Fotos und Ton;
  „offline verfügbar" ist keine Konfiguration, sondern ein Produkt.
- **Push-Nachrichten.** Braucht heute niemand.
- **Aufzeichnen im Browser.** Eine Web-Seite bekommt auf iOS keine
  Hintergrund-Ortung. Wer mit dem iPhone aufzeichnen will, braucht die native
  App, und das bleibt so.
