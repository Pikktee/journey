# Polar AccessLink einrichten

Der Adapter ([server/src/tracker/provider/polar.ts](../../server/src/tracker/provider/polar.ts))
ist gebaut; was hier steht, sind die Handgriffe, die Zugangsdaten brauchen und deshalb nicht
im Code stehen können. Hintergrund und Entwurf: [konzept_tracker_integrationen.md](../concepts/konzept_tracker_integrationen.md).

## 1. Client anlegen (einmalig, erledigt am 2026-08-09)

[admin.polaraccesslink.com](https://admin.polaraccesslink.com) — self-serve, kein Review.
Hinterlegt sind beide Rückkehr-Adressen im selben Client:

```
https://maptale.io/api/tracker/polar/callback     (Default)
http://localhost:8787/api/tracker/polar/callback  (Entwicklung)
```

Der Adapter schickt `redirect_uri` deshalb IMMER explizit mit — Polars Default-Mechanik
greift nie, und das ist bei mehreren registrierten Adressen auch Pflicht.

Client-ID und -Secret gehören in die Server-Umgebung:

```
MAPTALE_POLAR_CLIENT_ID=…
MAPTALE_POLAR_CLIENT_SECRET=…
```

## 2. Token-Schlüssel setzen (Pflicht, sonst ist ALLES aus)

Ohne ihn sind alle OAuth-Anbieter „nicht verfügbar" — es gibt bewusst keinen
Klartext-Rückfall für die gespeicherten Tokens:

```bash
openssl rand -base64 32
```

Das Ergebnis als `MAPTALE_TRACKER_SCHLUESSEL` hinterlegen. **Nie rotieren, ohne es zu
wollen:** Jede vorhandene Verknüpfung wird damit unlesbar und muss neu autorisiert werden
(der Server setzt sie dann auf `abgelaufen` mit sichtbarem Hinweis, aber die Autorisierung
ist weg). Er ist genau deshalb eine eigene Variable und nicht aus `MAPTALE_COOKIE_SECRET`
abgeleitet — das rotiert man beiläufig.

## 3. Erst deployen, dann den Webhook registrieren

**Die Reihenfolge ist Pflicht, nicht Ordnungsliebe:** Polar schickt beim Anlegen einen PING an
die angegebene Adresse und legt den Webhook nur an, wenn er **200** zurückbekommt. Läuft dort
noch eine Fassung ohne die Route — oder sind auf dem Server `MAPTALE_POLAR_CLIENT_ID`/`_SECRET`
nicht gesetzt, dann meldet die Registry den Anbieter als unbekannt —, antwortet sie **404**,
und Polar lehnt mit `WebhookPingFailedException` ab.

Vorher also: Version-Tag setzen (`npm run release minor`), Deploy abwarten, Variablen aus
Schritt 1 und 2 in der Server-Umgebung hinterlegen, Container neu starten. Gegenprobe:

```bash
curl -i -X POST https://maptale.io/api/webhooks/tracker/polar -H 'Content-Type: application/json' -d '{"event":"PING"}'
```

Erwartet ist **200**. Kommt 404, fehlt der Code oder die Client-Zugangsdaten; kommt 401, ist
etwas am Ping-Pfad kaputt (er läuft absichtlich vor der Signaturprüfung — der Schlüssel dafür
entsteht ja erst im nächsten Schritt).

Polar erzeugt das Signatur-Geheimnis beim Anlegen des Webhooks und **liefert es genau einmal
aus**. Es gibt kein „nochmal anzeigen".

```bash
curl -X POST https://www.polaraccesslink.com/v3/webhooks \
  -u "$MAPTALE_POLAR_CLIENT_ID:$MAPTALE_POLAR_CLIENT_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"events":["EXERCISE"],"url":"https://maptale.io/api/webhooks/tracker/polar"}'
```

Aus der Antwort `data.signature_secret_key` **sofort** sichern:

```
MAPTALE_POLAR_WEBHOOK_SECRET=…
```

Danach den API-Container neu starten, damit er die Variable sieht.

Drei Dinge, die man dabei falsch macht:

- **Pro Client gibt es nur EIN Abo.** Es kann auf Produktion ODER auf einen
  Entwicklungs-Tunnel zeigen, nicht auf beides. Für die Entwicklung ist deshalb der manuelle
  Abruf (`POST /api/tracker/polar/sync`) der vorgesehene Weg — er holt dieselben Aktivitäten
  ohne Webhook. Wer den Tunnel doch braucht, legt einen zweiten Client an.
- **Ohne hinterlegtes Geheimnis wird jede ECHTE Zustellung abgewiesen** (401), nicht
  durchgewunken. Ein Webhook, der ohne Prüfung annimmt, wäre ein kostenloser Weg, fremde
  Konten mit Arbeit zu belasten. Der PING ist die eine Ausnahme — er ist nicht prüfbar (der
  Schlüssel entsteht erst als Antwort auf ihn) und löst nichts aus.
- **Bestehendes Abo prüfen** geht mit `GET /v3/webhooks` (dieselbe Basic-Auth). Ein zweites
  anzulegen scheitert.

## 4. Verknüpfen und testen

1. Auf `/konto` verbinden — der Browser geht zu Polar und kommt auf `/konto#tracker=verbunden`
   zurück.
2. **Danach** ein Training aufzeichnen und in Polar Flow synchronisieren. Die Reihenfolge ist
   nicht verhandelbar: Polar liefert **keine Historie**, sondern nur, was nach der
   Registrierung entsteht. Wer vorher aufzeichnet, wartet vergeblich.
3. Die Tour erscheint privat in der Bibliothek; die Importliste im Konto zeigt Status und im
   Fehlerfall den Grund.

Kommt nichts an, in dieser Reihenfolge prüfen:

| Prüfen | Wie |
|---|---|
| Ist der Import überhaupt gemeldet? | Importliste im Konto (`GET /api/tracker/imports`) |
| Kam die Zustellung an? | Server-Log — eine abgewiesene Signatur steht als 401 |
| Liegt es an der Zustellung? | `POST /api/tracker/polar/sync` holt dieselbe Aktivität ohne Webhook |
| Hat die Aktivität eine Route? | Status `uebersprungen` mit Grund — Hallentraining hat keine |

## 5. Was der Import mit den Daten macht

Geholt werden **GPS-Route (GPX), Startzeit, Dauer und Sportart** — mehr nicht. Keine
Herzfrequenz, keine Kalorien, keine Trainingswerte: Was Maptale nicht abspielt, holt es auch
nicht. Die Sportart wird nur zum Raten der Fortbewegungsart benutzt und im Manifest nicht
gespeichert.

Als `member-id` geht bei der Registrierung die **Polar-Nutzerkennung** heraus, nicht unsere
Benutzer-ID — Polar verlangt nur Eindeutigkeit, und unsere Kennung wäre eine Weitergabe ohne
Zweck.

**Vor dem Live-Gang gehört das in [datenschutz.html](../../datenschutz.html):** welche Daten
von Polar geholt werden, dass ein Zugangs-Token gespeichert ist, und wie man trennt (die
Touren bleiben dabei erhalten).
