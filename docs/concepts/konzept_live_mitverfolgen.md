---
stand: 2026-08-07
status: Konzept, nichts gebaut
betrifft:
  - android/
  - server/
  - Web-Player (eigene Live-Ansicht)
  - src/routes.ts
  - später ggf. iOS
icon: antenne
---

# Konzept: Live mitverfolgen

**Ziel:** Während jemand in der Android-App aufzeichnet, können andere über einen
Link **in Echtzeit zuschauen** — wachsende Spur, Position, und Fotos/Videos, sobald
sie ankommen. Derselbe magische Moment wie „ich bin unterwegs“, aber in Maptale-
Sprache (Spur · Halt · Bild), nicht als generischer blauer Punkt.

**Mockups:** [app-live-teilen.html](../mockups/app-live-teilen.html) (Aufnahme-Freigabe),
[live-ansicht.html](../mockups/live-ansicht.html) (Zuschauer).

Verwandt, aber anders:
- Fertige Tour teilen (`unlisted` / `/tour/t_…`) — das bleibt der Weg *nach* der Fahrt.
- [konzept_tracker_integrationen.md](konzept_tracker_integrationen.md) — fremde
  Tracker; hier ist die **eigene App** die Quelle.
- [ideen-inspiration.md](ideen-inspiration.md) §6 „Geschenk-Tour“ — verwandtes
  Link-Modell, aber für abgeschlossene private Touren.

> **Produktpriorität:** Geniales Feature, aber **nicht** vor stabilem
> Upload-/Studio-/Player-Alltag und den Wartungsplänen
> ([Editor-Zerlegung](konzept_editor_zerlegung.md),
> [Player-TS](../archive/konzept_player_typescript.md)). Live multipliziert genau diese
> Flächen.

---

## 1. Das Erlebnis in einem Satz

> Du tippst in der App auf „Live teilen“, schickst den Link, und wer ihn öffnet,
> sieht dich auf der Karte weiterwandern — und jedes Foto, das du machst, taucht
> dort auf, sobald das Netz mitspielt.

Nicht: gemeinsames Schneiden, Video-Livestream, öffentlicher Feed, Chat.

---

## 2. Leitentscheidungen

1. **Live ist eine Session, keine Tour.** Die fertige Tour entsteht wie heute am
   Ende (Manifest → Pipeline → `tour.json`). Live darf diesen Vertrag nicht
   verbiegen — kein halbfertiges `tour.json` als Wahrheit während der Fahrt.
2. **Der Link ist die Zugangskontrolle** — analog zu `unlisted`: unerratbares
   Token, kein Login für Zuschauer. Wer den Link hat, schaut mit. (Optional später:
   Session beenden = Link tot.)
3. **Zuschauer = Web.** Kein zweiter Android-Viewer in v1. Die App zeichnet;
   Messenger öffnen den Link im Browser (und in der App-WebView nur, wenn ihr das
   später wollt).
4. **Medien sind „bald live“, nicht Broadcast.** Foto/Video erscheinen nach
   Upload (komprimiert, wie heute). Kein WebRTC-Videostream in v1 — das wäre ein
   anderes Produkt.
5. **Opt-in pro Aufnahme.** Standard aus. Live kostet Akku, Daten und ist eine
   bewusste Preisgabe des Standorts in Echtzeit — das muss die UI sagen
   (Datenschutz! siehe §10).
6. **Vanilla-Web bleibt.** Realtime braucht Transport + Zustand, kein
   UI-Framework-Rewrite (siehe Gesprächsstand Wartbarkeit).

---

## 3. Was v1 ist — und was bewusst nicht

### v1 (MVP) — schon magisch

| Fähigkeit | Ja |
|---|---|
| Wachsende GPS-Spur auf MapLibre | ✓ |
| Fahrer-Marker an der aktuellen Position | ✓ |
| Optional leichte Kamerafahrt „hinterher“ (einfach, nicht die volle `Tour`-Engine) | ✓ |
| Foto erscheint als Pin/Karte, sobald hochgeladen | ✓ |
| Video: Poster oder kurzer Hinweis „Video · wird vorbereitet“, Abspielen wenn Datei da | ✓ |
| Link kopieren / teilen aus der laufenden Aufnahme | ✓ |
| Session beenden mit Aufnahme-Ende (oder explizit „Live aus“) | ✓ |
| Zuschauer ohne Konto | ✓ |
| `noindex`, nicht in Galerie/Profil | ✓ |

### Nicht in v1

| Idee | Warum später / nie so |
|---|---|
| Voller Relive-Film live (Wetter, Musik, Pausen-Zeitraffer, Foto-Orbit-Phasen) | Pipeline braucht abgeschlossene Tour; Live-Player ≠ `Tour`-Engine |
| Video als Echtzeit-Stream | WebRTC, Codecs, Kosten, Akku |
| Öffentliche „gerade unterwegs“-Liste | anderes Produkt, Privacy-Hölle |
| Chat / Reaktionen / Mehrspieler-Cursor | Social-Scope sprengt MVP |
| Collab-Schnitt im Studio während Live | eigenes Realtime-Thema |
| Zuschauer steuern die Kamera beliebig | erst wenn Grundflow sitzt |
| Live ohne Anmeldung des Aufzeichners | Missbrauch; Session hängt am Konto |

### v2 (nach MVP, skizziert)

- Nach Session-Ende: ein Tipp „Als Tour öffnen“ → bestehende `/tour/t_…` (Pipeline
  fertig oder „wird noch gebaut“-Zustand).
- Live-Wiederholung (Recording der Live-Spur) — nur wenn jemand danach fragt.
- Zuschauer-Zähler für den Aufzeichner („3 schauen zu“) — nett, nicht nötig fürs Wow.
- iOS dieselbe API.

---

## 4. Architekturüberblick

```
┌─────────────────┐     Punkte / Medien      ┌──────────────────┐
│  Android-App    │ ───────────────────────► │  API (Fastify)   │
│  Aufzeichnung   │     + Live-Session       │  Live-Store      │
│  Foreground-Svc │ ◄── Link / Token ─────── │  (Memory/SQLite) │
└─────────────────┘                          └────────┬─────────┘
                                                      │ SSE (v1)
                                                      ▼
                                             ┌──────────────────┐
                                             │  /live/<token>   │
                                             │  MapLibre-Viewer │
                                             └──────────────────┘
```

**Zwei Welten parallel:**

| | Live-Session | Fertige Tour |
|---|---|---|
| Identität | `live_<token>` / Session-ID | `t_<id>` |
| Wahrheit | Punktliste + Medien-Metadaten | Manifest + Overlay + `tour.json` |
| Lebensdauer | Stunden, dann weg oder archiviert | dauerhaft |
| Player | schlanke Live-Ansicht | bestehender `erlebnis`-Player |

Am **Ende** der Aufnahme: wie heute Upload des vollen Manifests + Medien →
Pipeline. Die Live-Session kann auf die entstehende `tourId` zeigen („Gleich
als Film“), muss aber nicht dieselben Bytes sein.

---

## 5. Server

### 5.1 Datenmodell (Skizze)

```
live_sessions
  id              text PK          -- z.B. lv_…
  user_id         text NOT NULL
  token_hash      text UNIQUE      -- Klartext nur im Link, speichern wie Mail-Tokens
  status          'live'|'beendet'|'abgebrochen'
  gestartet_at    text
  beendet_at      text NULL
  tour_id         text NULL        -- gesetzt wenn/ sobald die echte Tour existiert
  titel_provisorisch text NULL
  letzte_pos_at   text NULL        -- für „noch online?“-Heuristik
```

Punkte und Medien-Metadaten:

- **Kurzlebig / heiß:** Ringpuffer oder Append-only Blob/JSON-Lines im Storage
  unter `live/<sessionId>/track.jsonl` + `media.jsonl` — oder SQLite-Tabellen
  `live_punkte` / `live_medien`, wenn Abfragen einfacher sind.
- **Kein** Schreiben in `original/manifest.json` während Live — Manifest bleibt
  der unveränderliche Upload am Ende (Android-CLAUDE: Manifest unveränderlich
  nach Upload).

### 5.2 API (Skizze)

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| `POST` | `/api/live` | App (Auth) | Session starten → `{ sessionId, url, token }` |
| `POST` | `/api/live/:id/punkte` | App | Batch GPS-Punkte (wie Room-Batch) |
| `POST` | `/api/live/:id/medien` | App | Metadaten + Upload-URL/Multipart analog Tour-Medien |
| `POST` | `/api/live/:id/ende` | App | Status beendet; optional `tourId` |
| `GET` | `/api/live/s/:token` | Zuschauer | Snapshot: Spur bisher, letzte Pos, Medienliste |
| `GET` | `/api/live/s/:token/stream` | Zuschauer | **SSE** (empfohlen für v1) mit Events |

**Warum SSE vor WebSocket in v1:** Ein Weg Server→Client reicht (Zuschauer senden
nichts). Einfacher hinter Nginx/CloudPanel, weniger State, gut genug für
Punkt-Ticks alle 1–5 s. WebSocket später, wenn Bidirektion oder binäre Frames
nötig werden.

Event-Typen (SSE `event:`):

```
snapshot   — voller Stand (beim Connect)
punkt      — ein oder mehrere Trackpunkte
medium     — neues Foto/Video (id, lng/lat, takenAt, thumbUrl?)
status     — live | beendet | stale
```

### 5.3 Raten und Größe

- Punkte: App batched (z. B. alle 5–15 s oder N Meter), Server akzeptiert max.
  ~1 Batch/s pro Session, harte Deckelung gegen kaputte Clients.
- Max. Session-Dauer z. B. 12 h, danach auto-`beendet`.
- Max. Zuschauer-Verbindungen pro Session (z. B. 50) — freundliche 503 darüber.
- Speicher: Track einer Tageswanderung ist klein; Medien zählen gegen bestehende
  Quota des Users (dieselbe Logik wie Tour-Upload).

### 5.4 Sichtbarkeit und SEO

- Live-URLs **nicht** in Sitemap, **nicht** in Galerie.
- Meta: `noindex` (wie private/unlisted-Köpfe).
- Vorschaukarte (og:) optional mit generischem „Live unterwegs · Maptale“ —
  **ohne** Live-Koordinaten im HTML-Kopf (sonst landen sie in Messenger-Caches).
  Koordinaten nur im nachgeladenen API/SSE.

---

## 6. Android

Heute schon vorhanden und nutzbar:

- `AufzeichnungsService` (Foreground) + `AufzeichnungsZustand`
- Punkte in Room, Batch-Flush
- Medien-IDs, Upload über WorkManager
- Teilen-Infrastruktur für fertige Links

### 6.1 Ablauf v1

1. Nutzer startet Aufnahme wie heute.
2. Optional: Schalter **„Live teilen“** (vor oder während). Erklärtext: Standort
   ist für alle mit Link sofort sichtbar.
3. App: `POST /api/live` → Link in die Zwischenablage / System-Share-Sheet.
4. Parallel zum Room-Schreiben: dieselben Punkte (gefiltert wie fürs Manifest)
   periodisch an `/punkte`.
5. Foto/Video: lokal speichern wie heute; **zusätzlich** sobald Datei bereit,
   Live-Medien-Upload (darf scheitern und retry — Live ist best-effort; die
   Tour-Qualität hängt weiter am finalen Upload).
6. Aufnahme beenden: `POST …/ende`, dann bestehender `UploadWorker` für die Tour.
   Live-Link zeigt „Beendet“ und idealerweise Button zur Tour, sobald `tourId`
   bekannt.

### 6.2 Fallen

- **Akku/Daten:** Live-Upload von Original-Videos parallel zur Aufnahme ist hart.
  v1: Fotos bevorzugt live; Videos erst Poster/Thumbnail live, volle Datei über
  den normalen Tour-Upload — oder stark verkleinertes Live-Vorschaubild.
- **Offline:** Spur lokal weiter; nach Netz wieder Batches. Zuschauer sehen Lücke
  oder „Verbindung unterbrochen“ beim Aufzeichner-Status (`stale`, wenn
  `letzte_pos_at` > z. B. 90 s).
- **Service-Tod:** wie heute Punkte retten; Live-Session auf Server bleibt `live`
  bis Timeout → `stale`/`beendet`.
- **Manifest unveränderlich:** Live-API ist ein **zweiter Kanal**, kein Patchen
  des Tour-Manifests während der Fahrt.

---

## 7. Web — Live-Ansicht

### 7.1 URL

Eigener Namensraum, nicht `/tour/…` (das verspricht einen fertigen Film):

```
/live/<token>
```

- Parametrisiert wie `/@handle` und `/tour/<id>` — **nicht** als flacher Eintrag
  in `ROUTES`, sondern Helfer `livePath(token)` neben `tourPath` /
  `profilePath` in [src/routes.ts](../../src/routes.ts) (oder schmale Parallel-
  Datei), plus Vhost/`proxy_pass` zum Server oder statische Seite + API.
- Empfehlung: schlanke `live.html` (Vite-Eingang) oder Server liefert HTML wie
  bei `/@` / `/tour/` mit Meta-Markern. Token nur im Pfad, nicht als langlebige
  Query.

Reserviertes Wort: `live` in die Handle-Reservierung aufnehmen, falls noch
nicht abgedeckt.

### 7.2 Was die Seite tut

1. `GET /api/live/s/:token` → bisherige Spur zeichnen, Marker setzen.
2. SSE öffnen → Punkte anhängen, bei `medium` Pin + optional Einblendung.
3. UI minimal: Marke „LIVE“, ggf. seit wann, Distanz grob, keine Studio-Chrome.
4. Bei `beendet`: Hinweis + Link zur Tour, wenn `tour_id` gesetzt; sonst
   „Aufzeichnung beendet“.

### 7.3 Nicht die volle Tour-Engine

`src/tour.ts` für Intro-Orbit, Foto-Phasen, Zeitraffer ist für **abgeschlossene**
Routen gebaut. Live v1:

- MapLibre-Karte (Stil an Player angelehnt, Attribution bleibt).
- Linie + Marker; Kamera folgt mit einfachem `easeTo` / Soft-Follow.
- Kein Wetter-Partikel-Zwang, keine Musikpflicht. (Labor-Renderer gibt es seit
  dem 2026-08-11 ohnehin nicht mehr, s.
  [../archive/renderer-labor.md](../archive/renderer-labor.md).)

Später kann eine „Live-Inszenierung“ wachsen — eigener Codepfad, kein
Flag-Missbrauch am Default-Player.

---

## 8. Etappen (Umsetzung, wenn priorisiert)

| Etappe | Liefergegenstand | Wow? |
|---:|---|---|
| **0** | Spec: Punkt-JSON, Token-Format, SSE-Events; leerer Store + Auth-Riegel | — |
| **1** | App startet Session + sendet Punkte; Web zeigt Spur + Marker | **Ja** |
| **2** | Link teilen aus der Aufnahme-UI; Session-Ende / stale | Ja |
| **3** | Fotos live (Metadaten + Bildfassung); Pins auf der Karte | **Ja** |
| **4** | Nach Ende: Anbindung an fertige `tourId` / „Film öffnen“ | Komplett |
| **5** | Video-Poster live; Zuschauer-Limit; Feinschliff Akku | Robust |

Etappe 1 allein reicht für den ersten internen Test („schau, ich gehe um den
Block“). Etappe 3 ist das Produktversprechen mit Kamera.

---

## 9. Abgrenzung zur fertigen Tour

| Frage | Antwort |
|---|---|
| Ist Live eine Sichtbarkeitsstufe? | **Nein.** `private` / `unlisted` / `public` bleiben Tour-Stufen. |
| Sieht man Live in der Galerie? | **Nein.** |
| Wird die Pipeline während Live angestoßen? | **Nein** — erst mit finalem Upload. |
| Können Edits (Musik, Wetter) live sein? | **Nein** in v1; Studio bleibt nach der Fahrt. |
| Derselbe Link nach der Fahrt? | Entweder Redirect auf `/tour/t_…` oder Live-Seite mit CTA — entscheiden in Etappe 4. Nicht zwei Wahrheiten parallel ewig offen lassen. |

---

## 10. Datenschutz und Zusagen

Live-Standort ist **besondere Sorgfalt** (Echtzeit ≠ nachträglicher Track in einer
Tour).

Mindestens in [datenschutz.html](../../datenschutz.html) festhalten, bevor es
shippt:

- Was übertragen wird (GPS-Punkte in Echtzeit, Medien).
- Wer es sieht (jeder mit Link).
- Wie lange die Session-Daten liegen (z. B. Löschung X Stunden nach Ende).
- Dass der Schalter Opt-in ist und jederzeit beendbar.
- Keine Aufnahme in Analytics von Koordinaten-Inhalten (Umami bleibt seitenbezogen).

Technisch: Token wie andere Geheimnisse hashen; Logs ohne Roh-Token und ohne
unnötige Koordinaten-Dumps.

---

## 11. Risiken

| Risiko | Mitigation |
|---|---|
| Erwartung „wie Relive-Film, nur live“ | UI sagt „Live-Karte“, nicht „Film“; CTA zum Film nach Ende |
| Akku / mobile Daten | Batches, Foto vor Video, klare Opt-in-Kopie |
| Link geleakt | Session beenden; später optional neues Token / Ablauf |
| Server-Last durch SSE | Cap Zuschauer; Polling-Fallback alle 5 s wenn SSE stirbt |
| Doppelte Upload-Logik App | Live-Medien-Client dünn halten; finaler Weg bleibt WorkManager |
| Feature zu früh | Hinter Admin-/Account-Flag oder Build-Flavor bis Etappe 3 sitzt |

---

## 12. Nicht-Ziele (nochmal klar)

- UI-Framework nur für Live einführen.
- Google-3D / deck-Labor für Live.
- Live als Ersatz für Studio-Schnitt.
- Öffentliches Discovery „wer ist gerade unterwegs“.

---

## 13. Erfolg

- Eine Person kann von unterwegs einen Link schicken; eine zweite sieht innerhalb
  von Sekunden die Spur wachsen.
- Ein Foto aus der App erscheint beim Zuschauer, ohne die Aufnahme zu beenden.
- Nach dem Stopp entsteht wie heute eine normale Tour — Live war die Brücke,
  nicht ein Paralleluniversum.
- Datenschutz-Text und Opt-in stimmen mit dem Verhalten überein.

---

## 14. Offene Entscheidungen (vor Etappe 1)

1. **Token im Pfad** (`/live/…`) vs. kurzer Code — Empfehlung: langer unerratbarer
   Token wie Tour-IDs ([server/src/ids.ts](../../server/src/ids.ts)).
2. **SSE vs. kurzes Polling zuerst** — Empfehlung: SSE, Polling als Fallback.
3. **Live-Medien in Quota / eigenem Ordner** — Empfehlung: dieselbe User-Quota,
   Pfad `live/<sessionId>/…`, nach Tour-Finalize optional aufräumen oder
   übernehmen.
4. **Muss die Tour schon existieren, bevor Live startet?**  
   - A: Session ohne `tourId`, Tour erst am Ende (einfacher).  
   - B: Tour sofort als `private` anlegen, Live nur Broadcast (näher am finalen
     Upload, komplexer).  
   **Empfehlung v1: A.**
5. **Kamerafolge aggressiv oder Nutzer-gescrollte Karte?** — Empfehlung: Follow
   an, mit „Karte loslösen“-Geste.
