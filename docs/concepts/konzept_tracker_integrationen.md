# Konzept: Tracker-Integrationen & Automatische Foto-Zuordnung

Stand: August 2026 · Status: **Etappen 0–6 gebaut**, Polar live (2026-08-10) ·
Betrifft: `server/`, `android/`, `src/konto/`, später `ios/`

Was steht: die additive Medien-Route (Etappe 0, eigenes Konzept), der anbieterblinde Kern
(Etappe 1), der **Polar-Adapter** (Etappe 3), die Kontoseite „Verbundene Dienste"
(Etappe 4) samt Datenschutz-Absatz, die App-Naht (Etappe 5) und **Push** (Etappe 6). Der
Webhook ist bei Polar registriert und in Produktion verifiziert: richtig signiert → 200,
gefälscht → 401, PING → 200. Damit kann jemand sein Polar-Konto verbinden und bekommt neue
Aufzeichnungen ohne Handgriff als Tour.

Push ist gebaut, aber noch nicht scharf: Es fehlt das Firebase-Projekt samt Dienstkonto —
ein Handgriff in der Konsole, kein Code ([docs/ops/push-einrichten.md](../ops/push-einrichten.md)).
Solange es fehlt, ist das Feature AUS und nicht kaputt; die App bleibt bei ihrem
periodischen Abruf.

Auch der **Foto-Nachzug** (Etappe 7) steht: Die App sieht im Zeitfenster einer Cloud-Tour in
der Galerie nach und ergänzt die Bilder — automatisch bei stehender Einwilligung, sonst auf
Nachfrage in der Tour.

Was fehlt: die weiteren Anbieter (Etappen 8 ff.).

## 1. Zielsetzung

GPS-Tracks aus externen Sport-Trackern (Polar, Wahoo, Suunto, Ride with GPS, später
Strava/Garmin) landen **ohne Handgriff** als spielbare Maptale-Tour im Konto; die Fotos
derselben Zeitspanne kommen aus der Galerie des Telefons dazu. Das ist das Relive-Modell,
und es ist der einzige Weg, der ohne Aufnahme-App auskommt: Wer mit der Uhr fährt, hat das
Handy in der Tasche.

Drei Anforderungen stehen über allem und entscheiden jede Detailfrage in diesem Dokument:

1. **Lose gekoppelt.** Ein neuer Anbieter ist eine neue Datei, kein Eingriff in Upload,
   Pipeline oder Clients.
2. **Plattformneutral.** Android, Web und die spätere iOS-App sprechen denselben REST-Vertrag.
   Kein Provider-SDK in einer App, kein zweiter OAuth-Client pro Plattform.
3. **Ein Pipeline-Zweig.** Eine Cloud-Tour ist nach dem Anlegen von einer App-Tour nicht mehr
   zu unterscheiden. Kein „Cloud-Rendering", kein Sonderfall im Player.

---

## 2. Leitentscheidung: Der Server trägt die Cloud, die Clients sind dünn

| Schicht | Verantwortung | Aufwand |
|---|---|---|
| **Server** (Node/TS) | OAuth-Tokens, Webhooks, Provider-Adapter, Track→GPX, Tour anlegen, Pipeline anstoßen | einmal |
| **Mobile** (Android, später iOS) | Konto verknüpfen (Browser), Galerie im Zeitfenster scannen, Benachrichtigung, „Öffnen mit" | dünn, pro Plattform |
| **Web** (Konto / Studio) | dieselben Verknüpfungs- und Status-Routen, Datei-Import | dünn |

**Warum nicht im Client:** Webhooks brauchen eine öffentlich erreichbare Adresse — ein Telefon
hat keine. OAuth-Client-Secrets und Refresh-Tokens auf dem Gerät sind aus jedem APK
extrahierbar. FIT/GPX-Normalisierung und die gesamte Anreicherung existieren serverseitig
bereits. Und ein Kotlin-Modul für Polar wäre in Swift ein zweites Mal zu schreiben — der
REST-Vertrag ist nicht.

**Warum kein KMP/Shared-Module-Projekt:** Was Android und iOS wirklich teilen müssten, ist
genau das, was der Server ohnehin macht. Übrig bleiben Deep Links, Galerie-Rechte und
Benachrichtigungen — drei Dinge, die pro Plattform sowieso verschieden sind. Ein
Shared-Module-Setup kostete Build-Komplexität für null geteilte Zeilen.

Weg A (Health Connect / HealthKit) bleibt ein **optionaler lokaler Seiteneingang**: Er speist
dieselbe Upload-Naht, speichert aber keine Tokens und braucht keinen Server-Adapter. Zur
Erinnerung, warum er den Cloud-Weg nicht ersetzt: Google beschränkt das Lesen fremder
Trainings-Routen im Hintergrund hart — „Zero-Click" ist damit nicht erreichbar, ein
Tippen bleibt immer.

---

## 3. Architektur

```
┌───────────────────────────────────────────────────────────────────┐
│  Clients (Android · iOS · Web)                                    │
│  - OAuth starten (Custom Tab / Browser), Deep Link zurück         │
│  - Verknüpfungen listen und trennen                               │
│  - Fotos zur Tour nachreichen (EXIF-Zeitfenster)                  │
│  - Benachrichtigung „Tour bereit" / „Fotos ergänzen?"             │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ REST (Bearer-Token / Session-Cookie)
┌─────────────────────────────▼─────────────────────────────────────┐
│  server/src/tracker/                                              │
│                                                                   │
│  TrackerDienst        Verknüpfungen, Tokens, Importe, Dedup       │
│       │                                                           │
│       ├── Registry ──► TrackerProvider (Interface)                │
│       │                 ├── PolarProvider                         │
│       │                 ├── WahooProvider                         │
│       │                 ├── SuuntoProvider                        │
│       │                 ├── RideWithGpsProvider                   │
│       │                 ├── StravaProvider   (bedingt)            │
│       │                 └── GarminProvider   (wenn Partner frei)  │
│       │                                                           │
│       ├── Normalisierer   FIT/TCX/Streams → kanonisches GPX       │
│       ├── TourAnleger     Manifest + track.gpx + finalize         │
│       └── Importlauf      Hintergrundarbeit nach Webhook          │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ unverändert
        POST /api/tours → PUT track.gpx → POST finalize → Pipeline
```

### 3.1 Der Provider-Vertrag

Ein Anbieter implementiert nur, was er kann. Alles Gemeinsame — Tokens erneuern, Dedup,
Quota, Tour anlegen, Fehler protokollieren — steht genau einmal im Kern.

```ts
// server/src/tracker/vertrag.ts — Skizze, Bezeichner deutsch wie im übrigen Server
export type TrackerAnbieter = 'polar' | 'wahoo' | 'suunto' | 'ridewithgps' | 'strava' | 'garmin'

export interface ProviderTokens {
  zugriff: string
  erneuerung?: string | null
  /** ISO; fehlt bei Anbietern mit unbefristeten Tokens (Polar). */
  laeuftAb?: string | null
  /** Anbieter-eigene Nutzerkennung (Polar member/user-id, Strava athlete-id …). */
  externerNutzer?: string | null
}

/** Was der Webhook meldet: „Nutzer X hat Aktivität Y" — mehr nicht. */
export interface TrackerEreignis {
  externerNutzer: string
  externeId: string
  art: 'aktivitaet' | 'abmeldung'
}

/** Anbieterneutraler Rohtrack: Bytes plus das Nötigste zum Anlegen der Tour. */
export interface RohTrack {
  format: 'gpx' | 'fit' | 'tcx' | 'punkte'
  bytes?: Uint8Array
  /** Für Anbieter ohne Datei (Strava-Streams, Ride with GPS-JSON). */
  punkte?: Array<{ lat: number; lng: number; ele?: number; zeit: string }>
  titel?: string | null
  sportart?: string | null
  start: string
  ende: string
}

export interface TrackerProvider {
  readonly id: TrackerAnbieter
  /** Ohne konfigurierte Zugangsdaten meldet die Registry den Anbieter als „nicht verfügbar". */
  readonly konfiguriert: boolean

  autorisierungsUrl(zustand: string, redirectUri: string): string
  tauscheCode(code: string, redirectUri: string): Promise<ProviderTokens>
  erneuereTokens?(erneuerung: string): Promise<ProviderTokens>

  /** Einmalige Pflichtschritte nach dem Verknüpfen (Polar: Nutzer registrieren). */
  nachVerknuepfung?(tokens: ProviderTokens): Promise<void>
  /** Beim Trennen: Abo/Autorisierung beim Anbieter aufheben. */
  trenne?(tokens: ProviderTokens): Promise<void>

  webhook?: {
    /** Signatur/Challenge prüfen. Falsch = 401, kein Import. */
    verifiziere(anfrage: WebhookAnfrage): boolean | Promise<boolean>
    parseEreignisse(anfrage: WebhookAnfrage): TrackerEreignis[]
    /** Manche Anbieter verlangen eine Echo-Antwort (Strava: hub.challenge). */
    antwort?(anfrage: WebhookAnfrage): unknown
  }

  /** Ohne Webhook: seit `seit` neue Aktivitäten auflisten (Polling-Fallback). */
  listeNeue?(tokens: ProviderTokens, seit: string): Promise<TrackerEreignis[]>

  holeTrack(tokens: ProviderTokens, externeId: string): Promise<RohTrack>
}
```

Zwei Entwurfsentscheidungen darin, die man leicht „vereinfacht":

**`RohTrack` kennt `punkte` als eigenes Format.** Strava und Ride with GPS liefern keine
Datei, sondern JSON-Reihen. Wer sie im Adapter schon zu GPX-XML serialisiert, schreibt in
jedem solchen Adapter denselben Serialisierer — und die Tests prüfen dann String-Vergleiche
statt Koordinaten. Der Normalisierer ist die eine Stelle, die GPX schreibt.

**`konfiguriert` ist Teil des Vertrags, nicht der Registry-Logik.** Ein Anbieter ohne
hinterlegte Client-ID darf nicht in der Oberfläche stehen — sonst führt „Verbinden" auf eine
Fehlerseite des Anbieters. Dieselbe Linie wie `openRouterKey`/`umamiDbPasswort` in
`config.ts`: fehlt der Schlüssel, ist das Feature aus, nicht kaputt.

### 3.2 Der Kern (einmal, anbieterblind)

| Baustein | Aufgabe |
|---|---|
| `TrackerDienst` | Verknüpfungen speichern/lesen, Tokens entschlüsseln und erneuern, Importe anlegen, Status führen |
| `Importlauf` | Nach dem Webhook: Track holen → normalisieren → Tour anlegen → finalize. Fehler landen im Import, nicht im Log-Nirvana |
| `Normalisierer` | FIT / TCX / Punkte → GPX. GPX wird durchgereicht |
| `TourAnleger` | Manifest bauen (`trackFile`), `original/track.gpx` schreiben, finalize anstoßen — **ruft** die bestehenden Pfade, dupliziert sie nicht |
| `Registry` | Anbieter registrieren, nach `konfiguriert` filtern |

**Die Dedup-Sperre liegt in der Datenbank, nicht im Code.** Webhooks werden bei Zustellzweifeln
wiederholt (Wahoo staffelt bis 72 h), und zwei parallele Zustellungen sehen zwischen „gibt's
schon?" und dem INSERT dasselbe. Der Trick: `tours.client_tour_id` ist bereits `UNIQUE(owner_id,
client_tour_id)` und wird von der App für genau diesen Zweck benutzt. Eine Cloud-Tour bekommt
`client_tour_id = 'polar:1234567'` — damit gilt die vorhandene Idempotenz von `POST /api/tours`
unverändert, und die zweite Zustellung bekommt dieselbe Tour-ID zurück, statt eine zweite Tour
anzulegen. Die Tabelle `tracker_importe` führt zusätzlich Status und Fehler; ihr UNIQUE-Index
ist der zweite Riegel, keiner davon ist der einzige.

**Webhooks antworten sofort.** Strava verlangt eine Antwort in unter zwei Sekunden, und einen
FIT-Download plus Pipeline schafft niemand in dieser Zeit. Muster ist der Datenexport: Route
antwortet `200`, Arbeit läuft danach. Wie bei `app.verarbeitungen` wird der laufende Import in
einer Map gehalten, damit Tests gezielt darauf warten können statt zu pollen.

### 3.3 Der Client-Vertrag

Dieselbe REST-Oberfläche für Android, iOS und Web. Sie ist der ganze Grund, warum die Clients
dünn bleiben — sie muss deshalb stehen, bevor der erste Client gebaut wird.

**Die URL-Pfade sind englisch** (Entscheidung 2026-08-09, Linie von
[konzept_codebase_english_refactoring.md](konzept_codebase_english_refactoring.md)): Sie sind
Außenfläche, und die Callback-URL brennt in jeder Anbieter-Registrierung ein — ein späterer
Umzug auf englische Pfade bräche alle Verknüpfungen. Die internen Bezeichner bleiben deutsch
wie im übrigen Server.

| Route | Zweck |
|---|---|
| `GET /api/tracker/providers` | Liste: Kennung, Anzeigename, verfügbar, verbunden seit, letzter Import |
| `POST /api/tracker/:provider/connect` | `{ ziel: 'web' \| 'app' }` → `{ autorisierungsUrl }` (mit `state`) |
| `GET /api/tracker/:provider/callback` | OAuth-Redirect-Ziel; leitet auf `/konto#tracker=…` bzw. `maptale://tracker/…` |
| `DELETE /api/tracker/:provider` | Trennen: Tokens löschen, Abo/Autorisierung beim Anbieter aufheben |
| `POST /api/tracker/:provider/sync` | Manuell nachziehen (Polling-Anbieter, „hat nicht geklappt"-Knopf) |
| `GET /api/tracker/imports` | Letzte Importe: Status, Tour-ID, Zeitfenster, Fehler |
| `GET /api/tracker/imports/pending` | Was der Client noch nicht gesehen hat (Grundlage der Benachrichtigung) |

Fotos laufen über die **additive Medien-Route** — entschieden am 2026-08-09, ausgearbeitet in
[konzept_medien_nachreichen_und_loeschen.md](konzept_medien_nachreichen_und_loeschen.md).
Der frühere Gedanke „Manifest ergänzen + erneutes `finalize` über den bestehenden Weg" trug
nicht: Eine Cloud-Tour ist nach dem Anlegen `bereit`, und genau in diesem Status weist
`PUT /api/tours/:id/media/:mid` heute mit 409 ab. Die additive Route ist damit **Etappe 0
dieses Plans** — ohne sie liefert der erste Auto-Import eine leere Karte mit Linie.

Der Ablauf in der App:

1. Custom Tab / `SFSafariViewController` mit der Autorisierungs-URL öffnen (kein WebView —
   mehrere Anbieter blockieren eingebettete Browser für OAuth).
2. Redirect → Server → Deep Link `maptale://tracker/polar?ok=1` zurück in die App.
3. Später: neue Tour da → Benachrichtigung (s. Abschnitt 9).
4. Optional: Galerie im Zeitfenster der Tour scannen, Fotos nachschieben.

**Der `state`-Parameter ist Pflicht und wird serverseitig gehalten** (kurzlebig, an die
Sitzung gebunden). Ohne ihn lässt sich einem Angemeldeten fremd ein Fremdkonto unterschieben —
das ist der klassische OAuth-CSRF, und er trifft genau die Verknüpfungs-Route.

### 3.4 Manueller Datei-Import — der Weg, der ohne jede Freigabe funktioniert

Garmin, COROS, jede Uhr mit Export: Der Nutzer lädt GPX/FIT selbst hoch. Das ist kein
Notbehelf, sondern der einzige Weg, der sofort und für alle Anbieter funktioniert — und er
nutzt denselben `TourAnleger`.

- **Web/Studio:** GPX-Auswahl gibt es heute schon; ergänzt wird FIT (über denselben
  Normalisierer) und eine kurze Anleitung „So exportierst du aus Garmin Connect".
- **Android/iOS:** Share Sheet / „Öffnen mit" registrieren (`.gpx`, `.fit`) — aus Garmin
  Connect heraus zwei Tipps bis zur Tour.
- **Vorteil gegenüber jeder API:** keine Historie-Grenze. Polar liefert nur, was nach der
  Verknüpfung entsteht; eine Datei von 2019 geht immer.

### 3.5 Health Connect / HealthKit — lokaler Seiteneingang

```
Health Connect / HealthKit → App baut Segmente → bestehender Client-Upload
```

Kein Server-Adapter, keine Tokens, keine Webhooks. Nur sinnvoll, wenn der Anbieter dort
schreibt und keine brauchbare Cloud-API hat. Nachrangig gegenüber allem in Abschnitt 5.

---

## 4. Hybrid: Track aus der Cloud, Fotos vom Telefon

Der Track kommt vom Server, die Fotos kann nur das Gerät beisteuern — genau so macht es
Relive, und genau daran hängt der wahrgenommene Wert („meine Tour, meine Bilder").

1. Webhook → Server legt die Tour **nur mit Track** an. Sie ist sofort spielbar.
2. Der Client erfährt davon (Abschnitt 9) und ergänzt die Fotos des Zeitfensters —
   **automatisch, wenn die stehende Einwilligung erteilt ist** (Entscheidung 2026-08-09):
   Beim Verknüpfen (oder in den App-Einstellungen) schaltet der Nutzer einmal „Fotos
   automatisch ergänzen" ein; danach lädt die App ohne Nachfrage hoch und meldet es als
   Benachrichtigung („Tour Frankfurt · 3 Fotos hinzugefügt"). Ohne diese Einwilligung
   bleibt es beim Vorschlag mit Nachfrage („14 Fotos gefunden — hinzufügen?").
3. Hochgeladen wird über die additive Medien-Route
   ([konzept_medien_nachreichen_und_loeschen.md](konzept_medien_nachreichen_und_loeschen.md)),
   Tour neu verarbeitet, Medien landen über die bestehende Zeit-Platzierung an ihrem Ort.

Drei Leitplanken der Automatik:

- **Nur echte Kameraaufnahmen** (DCIM-/Kamera-Bucket) — keine Screenshots, keine
  Messenger-Ordner. Der Zeitfenster-Scan erwischt sonst das fotografierte Dokument aus
  der Pause.
- **Rückgängig ist echt:** Ein hinzugefügtes Foto lässt sich endgültig löschen (Rohdatei
  weg, Speicher frei) — die Benachrichtigung führt direkt dorthin.
- **Die Einstellung lebt in der APP, nicht auf dem Server:** Die Galerie liegt auf dem
  Gerät, und bei zwei Geräten am Konto soll nur das mit den Fotos hochladen. Keine
  Migration, kein Server-Feld.

Drei Fallen, die man erst im Betrieb merkt:

**Zeitzonen.** EXIF-Zeitstempel tragen oft keine Zone (`DateTimeOriginal` ist lokale
Kamerazeit), Tracks tragen UTC. Ohne `OffsetTimeOriginal` oder GPS-Zeit im Bild muss die Zone
der Tour angenommen werden — bei einer Reise mit Zeitzonenwechsel liegt man sonst um Stunden
daneben. Ein Toleranzfenster (±2 h Vorschlag, Nutzer bestätigt) ist ehrlicher als eine
falsche Automatik.

**Fotos mit GPS schlagen die Zeit.** Hat das Bild eigene Koordinaten, wird es dort verankert;
die Zeit ist nur der Rückfall. Das ist bereits die Logik im Manifest (`anchor` optional) —
sie muss hier nur richtig gefüttert werden.

**Kein Scan ohne Einwilligung.** Gelesen und hochgeladen wird nur mit Zustimmung — entweder
der stehenden („Fotos automatisch ergänzen", s. oben, jederzeit widerruflich) oder der
Nachfrage pro Tour. Die Automatik ist keine Ausnahme von dieser Regel, sondern ihre
Einmal-Form. Am Desktop gibt es nur die Dateiauswahl — ein Browser hat keine Galerie, und
das ist gut so.

---

## 5. Anbieter — Steckbriefe und Aufwand

Bewertet nach dem, was für Maptale zählt: **Kommt eine GPS-Route heraus, wie schnell bekomme
ich Zugang, und pusht der Anbieter von selbst?**

| Prio | Anbieter | Zugang | Kosten | Route | Push | Format | Adapter-Aufwand |
|---|---|---|---|---|---|---|---|
| 1 | **Polar** | Self-serve | gratis | ja | Webhook | **GPX** | klein |
| 2 | **Datei** | — | — | ja | — | GPX/FIT | klein (Normalisierer) |
| 3 | **Wahoo** | Sandbox → Review | gratis | ja | Webhook | FIT | mittel |
| 4 | **Suunto** | Partner-Antrag | gratis | ja | Webhook | FIT | mittel |
| 5 | **Ride with GPS** | Self-serve (Anfrage) | gratis | ja | Polling | JSON/GPX | klein |
| 6 | Strava | Antrag + Tier-Modell | **teils kostenpflichtig** | ja | Webhook | **nur Streams** | mittel–groß |
| 7 | Garmin | Enterprise-Programm | gratis, aber Freigabe | ja | Push | FIT/TCX/GPX | mittel, **blockiert** |

Strava trägt in dieser Tabelle mehr, als seine Zeile verrät: Über die offizielle
Garmin-Connect-Synchronisation ist es der einzige legitime Weg zu Garmin-Nutzern, solange das
Enterprise-Programm zu ist.
| — | Withings | Public API | gratis | **nein** | Webhook | — | nicht als Track-Quelle |

### Polar — der erste Adapter

**Gebaut am 2026-08-10** ([provider/polar.ts](../../server/src/tracker/provider/polar.ts), 28
Fixture-Tests). Vier Dinge stellten sich beim Bauen anders dar, als sie hier standen:

- **Die Zugriffstokens laufen NICHT ab** („will not expire unless explicitly revoked") — der
  Adapter hat deshalb kein `erneuereTokens` und setzt `laeuftAb: null`. Das bestätigt die
  Annahme oben, aber ausdrücklich: Ein gesetztes Ablaufdatum schickte den Kern in eine
  Erneuerung, die es bei Polar gar nicht gibt.
- **Ein zweiter `POST /v3/users` antwortet 409** („already registered"). Beim Neuverbinden ist
  das der NORMALFALL — als Fehler behandelt scheiterte jedes zweite Verbinden.
- **Die Startzeit ist lokale Zeit OHNE Zone plus ein separater Versatz in Minuten**
  (`start-time` + `start-time-utc-offset`). Wer einfach `Z` anhängt, verschiebt jede Tour um
  ihren Zonen-Versatz — und weil Tageszeit, Sonnenstand und Foto-Platzierung daran hängen,
  fällt es als „falsches Licht" auf, nicht als Zeitfehler.
- **`has-route` sagt VOR dem Download, ob es eine Route gibt.** Eine Krafteinheit hat keine;
  sie trotzdem zu holen wäre ein Aufruf für nichts. Ein 404 auf die GPX-Datei wird zusätzlich
  wie „ohne Route" behandelt — die Doku sagt zu diesem Fall nichts.

Dazu eine Eigenheit der API selbst: Polar schreibt seine JSON-Felder uneinheitlich
(`start-time` neben `start_time`). Der Adapter liest **beide** Schreibweisen; sich für eine zu
entscheiden hieße, es beim ersten echten Training herauszufinden.

Self-serve über das AccessLink-Portal, kein Review, keine Firma nötig. OAuth 2.0; die
Zugriffstokens sind langlebig, ein Refresh-Zyklus entfällt. **Zwei Eigenheiten bestimmen den
Adapter:** Nach dem Token-Tausch muss der Nutzer einmal bei der App registriert werden
(`POST /v3/users`) — ohne diesen Schritt liefert die API nichts, und der Fehler ist beim
Debuggen ein stilles Nichts. Und geliefert wird **nur, was nach der Registrierung entsteht**:
Es gibt keine Historie. Der Track kommt fertig als GPX (`GET /v3/exercises/{id}/gpx`), damit
ist Polar der einzige Anbieter, der den Normalisierer gar nicht braucht — deshalb steht er
vorn. Webhook meldet `EXERCISE`, signiert per HMAC.

### Wahoo

Entwicklerportal mit sofortiger Sandbox, Produktionsfreigabe per Review, kostenlos. OAuth 2.0
mit kurzlebigen Zugriffstokens (Stunden) und **einmal verwendbaren** Refresh-Tokens — wer den
neuen Refresh-Token nach dem Erneuern nicht speichert, hat die Verknüpfung verloren. Das ist
der Grund, warum das Erneuern im Kern liegt und nicht im Adapter: eine falsche Stelle, ein
zerstörter Zustand. Der Webhook liefert eine Zusammenfassung samt URL auf die FIT-Datei;
zugestellt wird mit Wiederholungen über Stunden bis Tage, weshalb Dedup keine Kür ist.

### Suunto

Partner-Antrag mit Beschreibung der App, kostenlos, Bearbeitung typischerweise ein bis zwei
Wochen. Kein Selbstbedienungszugang, aber auch keine Enterprise-Hürde. Tracks als FIT,
Benachrichtigungen per Webhook. Sinnvoll, sobald der FIT-Weg für Wahoo ohnehin steht — dann
ist Suunto im Wesentlichen OAuth plus Endpunkte.

### Ride with GPS

Kleine Zielgruppe, aber sehr geringer Aufwand: OAuth, Trips als JSON mit Punkten (oder GPX).
Kein Webhook — Polling beim Öffnen der Kontoseite und per Tagesintervall genügt bei dieser
Nutzerzahl. Guter Kandidat, um den **Polling-Pfad** überhaupt einmal zu bauen, den später
jeder Anbieter ohne Push braucht.

### Strava — technisch mühsam, aber die einzige legitime Garmin-Brücke

Strava ist der Anbieter mit dem schlechtesten Aufwand-Nutzen-Verhältnis **pro Zeile Code** und
zugleich der mit der größten Reichweite: Garmin Connect synchronisiert von Haus aus und
automatisch nach Strava, der Nutzer schaltet das einmal ein. Wer Garmin erreichen will, ohne
auf das Enterprise-Programm zu warten, erreicht es hier — offiziell, ohne Zugangsdaten des
Nutzers und ohne Bastelei (s. Garmin-Steckbrief).

Drei Gründe, warum es trotzdem nicht der erste Adapter ist:

1. **Kein GPX.** Die API gibt Aktivitäten nicht als Datei heraus; die Route muss aus den
   Streams (`latlng`, `altitude`, `time`) rekonstruiert werden — mit reduzierter Auflösung
   gegenüber dem Original. Für eine Kamerafahrt ist das brauchbar, aber es ist Arbeit und
   Qualitätsverlust.
2. **Zugangsmodell in Bewegung.** Strava hat Tiers, Antragspflicht und Kontingente in den
   letzten Jahren mehrfach geändert, teils kostenpflichtig. **Vor der Umsetzung neu prüfen** —
   was hier stünde, wäre bis zum Start veraltet.
3. **Auflagen.** Branding-Pflichten und Nutzungsbeschränkungen des API-Agreements berühren
   genau das, was Maptale erzeugt (Videos, Darstellung neben Daten anderer Plattformen). Das
   ist vor dem ersten Code zu klären, nicht danach.

Der Adapter selbst ist unspektakulär: Webhook mit `hub.challenge`-Verifikation beim Anlegen,
Ereignisse `create`/`update`/`delete` und Abmeldung, Antwort in unter zwei Sekunden.

### Garmin — und warum es keinen Umweg gibt

Technisch der beste Zugang (Push, Dateien in mehreren Formaten), organisatorisch der
schwerste: Enterprise-Programm, Firmenangaben, Review, und die Aufnahme ist zeitweise
ausgesetzt. Antrag stellen, wenn das Produkt öffentlich steht; bis dahin ist der Adapter ein
leerer Registry-Platz.

Die naheliegende Frage — ob eine Automatisierungs-Plattform das überbrückt — ist **mit Nein
beantwortet**, und zwar seit kurzem eindeutiger als früher:

- **Kein offizielles Zapier / IFTTT / Make.** Garmin bietet für Connect keine dieser
  Integrationen an.
- **Inoffizielle Bibliotheken sind tot.** `python-garminconnect` und `garth` — die Basis
  praktisch aller Bastellösungen — wurden im **März 2026 von Garmin ausgesperrt**
  (TLS-Fingerprinting plus Cloudflare Turnstile). Was seitdem noch funktioniert, startet einen
  echten Browser und fängt die Antworten der Weboberfläche ab. Das verlangt die
  Garmin-Zugangsdaten des Nutzers, verstößt gegen die Nutzungsbedingungen und bricht beim
  nächsten Schutz-Update. Kein Produktweg, auch nicht „vorübergehend".
- **Health Connect hilft nicht.** Garmin schreibt seit 2025 hinein — aber die geteilten Daten
  sind Distanz, Kalorien, Puls, Tempo, Höhenmeter, Schritte. **Die GPS-Route ist nicht dabei**,
  also fehlt genau das eine Feld, um das es hier geht. (Und selbst wenn: fremde Routen gibt
  Health Connect im Hintergrund nicht heraus, s. Abschnitt 15.)

Bleiben zwei Wege, und beide sind gut genug:

1. **Strava als Relais.** Garmin Connect synchronisiert offiziell und automatisch nach Strava;
   der Nutzer schaltet das einmal ein. Damit ist der Strava-Adapter (Prio 10) zugleich der
   Garmin-Zugang — von Garmin selbst vorgesehen, ohne fremde Zugangsdaten, ohne Scraping.
2. **Datei-Export** (Abschnitt 3.4). Braucht keine Freigabe von niemandem und reicht beliebig
   weit in die Vergangenheit — das kann keine API dieser Liste.

### Withings

Keine GPS-Route in der Public API. Als **Track**-Quelle scheidet Withings aus; das war die
ursprüngliche Frage und sie ist mit Nein beantwortet. (Gewicht/Schlaf wären Daten ohne Ort —
für Maptale ohne Verwendung.)

### Testen ohne Hardware

Keine der Freigaben verlangt ein Gerät, und keine der Integrationen lässt sich nur mit einem
testen: Hersteller-App am Handy installieren, dort eine GPX/FIT-Datei als Aktivität
hochladen, Webhook per Tunnel (ngrok) oder Staging empfangen. Die Unit-Tests laufen ohnehin
gegen gespeicherte Fixture-Payloads — echte Netzaufrufe gehören nicht in die Suite.

---

## 6. Datenmodell (eine Migration)

Ein Migrationsschritt in `server/src/db.ts` (aktuell 16 Schritte, dies wäre 17), zwei
Tabellen. Skizze:

```sql
CREATE TABLE tracker_verknuepfungen (
  id TEXT PRIMARY KEY,
  benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anbieter TEXT NOT NULL,
  externer_nutzer TEXT,              -- Zuordnung Webhook → Konto
  tokens TEXT NOT NULL,              -- AES-GCM, s. Abschnitt 7
  laeuft_ab_am TEXT,
  status TEXT NOT NULL CHECK (status IN ('aktiv','abgelaufen','getrennt')),
  verbunden_am TEXT NOT NULL,
  zuletzt_sync_am TEXT,
  letzter_fehler TEXT
);
-- Ein Konto verknüpft einen Anbieter genau einmal.
CREATE UNIQUE INDEX idx_tracker_konto ON tracker_verknuepfungen(benutzer_id, anbieter);
-- Der Webhook kennt nur die Anbieter-Nutzerkennung: dieser Index ist der Zuordnungsweg.
CREATE UNIQUE INDEX idx_tracker_extern ON tracker_verknuepfungen(anbieter, externer_nutzer)
  WHERE externer_nutzer IS NOT NULL;

CREATE TABLE tracker_importe (
  id TEXT PRIMARY KEY,
  benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anbieter TEXT NOT NULL,
  externe_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('wartet','laeuft','fertig','fehler','uebersprungen')),
  tour_id TEXT REFERENCES tours(id) ON DELETE SET NULL,
  gemeldet_am TEXT NOT NULL,
  fertig_am TEXT,
  gesehen_am TEXT,                   -- Client hat die Benachrichtigung abgeholt
  fehler TEXT
);
CREATE UNIQUE INDEX idx_importe_dedup ON tracker_importe(benutzer_id, anbieter, externe_id);
CREATE INDEX idx_importe_offen ON tracker_importe(benutzer_id, status);
```

Dazu kommt mit der Push-Etappe eine dritte, kleine Tabelle (`push_geraete`: Benutzer,
Plattform, Token, zuletzt gesehen) — sie gehört nicht zum Tracker, sondern zur App, wird aber
hier zuerst gebraucht. Ein abgelehnter Token (`UNREGISTERED` von FCM) wird gelöscht, nicht
protokolliert: Ein Gerätetoken ohne Gerät ist kein Vorfall, sondern eine deinstallierte App.

Drei Punkte, die man beim Vereinfachen verliert:

- **`externer_nutzer` ist der einzige Zuordnungsweg** vom Webhook zum Konto. Der Anbieter
  schickt seine eigene Nutzerkennung, nicht unsere. Fehlt der Index, wird aus jeder
  Zustellung ein Tabellen-Scan; fehlt das Feld, ist die Zustellung unzustellbar.
- **`uebersprungen` ist ein eigener Status**, kein Fehler: Aktivitäten ohne GPS (Hallentraining,
  Krafteinheit) melden Anbieter genauso. Als Fehler geführt, stünde die Fehlerliste eines
  Vielsportlers dauerhaft voll.
- **`gesehen_am` statt „gelesen"-Flag im Client.** Zwei Geräte am selben Konto sollen dieselbe
  Tour nicht doppelt melden; der Zustand gehört auf den Server.

---

## 7. Sicherheit und Datenschutz-Mechanik

**Tokens werden verschlüsselt abgelegt** (AES-256-GCM, Schlüssel aus eigener Umgebungsvariable
`MAPTALE_TRACKER_SECRET` — nicht aus `cookieSecret` ableiten: ein Cookie-Geheimnis
rotiert man beiläufig, und dann wären alle Verknüpfungen tot). Fehlt der Schlüssel, sind alle
OAuth-Anbieter „nicht konfiguriert" — kein Klartext als Rückfall.

**Jeder Webhook wird verifiziert**, bevor irgendetwas passiert: HMAC-Signatur (Polar, Wahoo),
Challenge-Handshake (Strava). Eine unsignierte Zustellung, die einen Import auslöst, ist ein
kostenloser Weg, fremde Konten mit Arbeit zu belasten. Verifikation schlägt fehl → `401`,
kein Eintrag, kein Log-Spam.

**Die Webhook-Route läuft vor jeder Anmeldeprüfung** — sie hat keinen Benutzer. Ihre Autorität
ist die Signatur, und ihr einziger Schreibzugriff geht über `externer_nutzer`.

**Quota und Verifikation gelten wie beim Upload.** Ein Cloud-Import ist ein Upload: Konto ohne
bestätigte E-Mail → kein Import (Status `fehler`, sichtbare Meldung im Konto). Speicher voll →
`uebersprungen` mit Hinweis, nicht stilles Verwerfen.

**Trennen heißt trennen:** Tokens löschen, Autorisierung beim Anbieter aufheben, Webhook-Abo
abbestellen. Bereits importierte Touren bleiben — sie gehören dem Nutzer, nicht der
Verknüpfung. Das ist eine Aussage, die in die Oberfläche gehört („Deine Touren bleiben
erhalten").

**Abmeldung von außen** (Strava sendet Deauthorize-Ereignisse, andere lassen Tokens ungültig
werden) setzt die Verknüpfung auf `abgelaufen` mit sichtbarem Hinweis „bitte neu verbinden" —
eine stumm tote Verknüpfung ist die schlimmere Variante: Der Nutzer wartet auf Touren, die
nie kommen.

**`datenschutz.html` wird erweitert, bevor der erste Anbieter live geht:** welche Daten von
welchem Anbieter geholt werden (GPS-Track, Zeit, Sportart, Titel), dass Tokens gespeichert
sind, wie man trennt, und dass die Galerie nur nach Zustimmung und nur im Zeitfenster der Tour
gelesen wird. Im Repo ist das eine Zusage — wer den Umfang später ändert, ändert sie dort mit.

---

## 8. Konfiguration und Betrieb

Neue Umgebungsvariablen nach dem Muster aus `config.ts` (leer = nicht gesetzt = Feature aus):

```
MAPTALE_TRACKER_SECRET      # Pflicht für alle OAuth-Anbieter
MAPTALE_POLAR_CLIENT_ID / _SECRET / _WEBHOOK_SECRET
MAPTALE_WAHOO_CLIENT_ID / _SECRET / _WEBHOOK_SECRET
MAPTALE_SUUNTO_CLIENT_ID / _SECRET / _ABO_SCHLUESSEL
MAPTALE_RWGPS_CLIENT_ID / _SECRET
MAPTALE_STRAVA_CLIENT_ID / _SECRET / _VERIFY_TOKEN
MAPTALE_FCM_SERVICE_ACCOUNT     # Push; Dienstkonto-JSON als Base64 (s. Abschnitt 9)
```

Betriebliches, das erfahrungsgemäß erst beim ersten Ausfall auffällt:

- **Webhook-Adressen sind pro Umgebung verschieden.** Produktion registriert die
  öffentliche URL, Entwicklung einen Tunnel. Zwei Abos auf dieselbe Anbieter-App
  gleichzeitig lassen manche Anbieter nicht zu — dann braucht Entwicklung eine eigene
  App-Registrierung beim Anbieter.
- **Der Vhost braucht keinen neuen Block:** alles liegt unter `/api`, das ist bereits
  weitergeleitet.
- **Nginx-Body-Limit** prüfen, falls ein Anbieter größere Nutzlasten schickt (Webhooks sind
  klein; FIT-Downloads holt der Server selbst, sie gehen nicht durch den Proxy).
- **Ausfall des Anbieters** ist der Normalfall, nicht die Ausnahme: Wiederholung mit Backoff,
  danach Import als `fehler` mit lesbarem Grund im Konto.

---

## 9. Die Benachrichtigung: echter Push, und dafür Firebase

„Deine Tour ist fertig" ist der Moment, an dem das ganze Feature sichtbar wird — er gehört
nicht in ein Abholintervall. Also **FCM**, und damit ein Firebase-Projekt.

**Warum es keine ernsthafte Alternative gibt.** FCM ist der einzige von Google sanktionierte
Weg, ein Gerät im Deep Doze zu wecken. Die freien Gegenentwürfe — UnifiedPush mit ntfy, ein
eigener WebSocket — brauchen beide einen dauerhaften **Foreground-Service** samt permanenter
Benachrichtigung in der Leiste, und selbst dann kommen Nachrichten im Mobilfunknetz und auf
sparsam eingestellten Geräten verspätet oder gar nicht an. UnifiedPush setzt zusätzlich voraus,
dass der Nutzer eine zweite App (den Distributor) installiert — für eine Consumer-App keine
Option.

**Was es kostet: fast nichts.** FCM ist gratis und ohne Mengenbegrenzung. Und die App hängt
über `play-services-location` (Fused Location für die Aufzeichnung) ohnehin schon an den
Google Play Services — Firebase bringt also **keine neue Ökosystem-Abhängigkeit** in ein
bisher googlefreies Projekt, sondern nur:

- ein Firebase-Projekt und `google-services.json` (das gehört wie jeder Schlüssel nicht ins
  Repo, sondern in die CI-Secrets — sonst bricht der Release-Build der Landing-APK),
- einen `FirebaseMessagingService` in der App plus Token-Registrierung,
- eine Tabelle `push_geraete` auf dem Server (Benutzer, Token, Plattform, zuletzt gesehen) und
  den Versand über die FCM HTTP-v1-API mit Dienstkonto,
- die Datenschutz-Punkte unten.

**Die Nachricht trägt keine Inhalte, nur einen Anlass.** `{ typ: 'import-fertig', tourId }` —
den Rest holt die App über die vorhandenen Routen. Ein Push mit Titel und Ort der Tour liefe
über Googles Server und läge auf dem Sperrbildschirm; beides ist unnötig, wenn ein Wecken
genügt. FCM ist **nicht** Ende-zu-Ende-verschlüsselt.

**Beim Bauen kam eine Korrektur dazu (2026-08-10): Der Registrierungs-Token ist Geschichte.**
Mit SDK 25.1.0 (Juni 2026) hat FCM ihn zugunsten der **Firebase-Installations-ID (FID)**
abgelöst — `getToken`, `deleteToken` und `onNewToken` sind deprecated, an ihre Stelle treten
`register()`, `unregister()` und `onRegistered()`, und die v1-API führt ihr Feld `token`
ausdrücklich als „Deprecated: Use `fid` instead". Der Server schickt deshalb `fid`. Wer
diesen Abschnitt später liest und eine Anleitung von 2024 danebenlegt, baut sonst gegen ein
abgekündigtes Feld — die Übergangszeit verdeckt es, weil `token` eine FID noch annimmt.
Die Spalte in `push_geraete` heißt trotzdem neutral `token`: Auf iOS steht dort später der
APNs-Gerätetoken, und ein Feld je Plattform hieße, in jeder Abfrage zu entscheiden, welches
gerade gilt.

### 9.1 Datenschutz — was FCM verlangt

Was zu Google fließt: Registrierungs-Token, IP des Geräts, Zeitpunkt, Zustellstatus, Inhalt
der Nachricht. Das Token ist ein personenbezogenes Datum — für sich pseudonym, bei uns aber
mit dem Konto verknüpft. Vertragspartner ist Google Ireland Ltd., verarbeitet wird auch in den
USA; Auftragsverarbeitung über die *Firebase Data Processing and Security Terms*, US-Transfer
gestützt auf Googles DPF-Zertifizierung. Der entsprechende Absatz steht in
`datenschutz.html` Abschnitt 9 bereits — Google ist dort nur als Empfänger für Push zu
ergänzen (dazu Speicherdauer des Tokens in Abschnitt 10 und der App-Abschnitt 7).

Vier Punkte, die man beim Bauen leicht übergeht:

1. **Die Übertragung beginnt vor der ersten Nachricht.** `firebase-messaging` zieht
   `firebase-installations` mit; die erzeugt beim App-Start eine Installations-ID und meldet
   sie an Google — auch wenn nie ein Push verschickt wird. Deshalb **Auto-Init aus**
   (`firebase_messaging_auto_init_enabled=false` im Manifest) und erst nach der Zustimmung
   `setAutoInitEnabled(true)`. `firebase-analytics` gar nicht erst als Abhängigkeit aufnehmen.
2. **Der Kanal bleibt funktional.** „Deine Tour ist fertig" ist Vertragserfüllung; „Neue
   Funktion im Studio!" wäre Werbung und bräuchte eine eigene Einwilligung (§ 7 UWG) —
   dieselbe Linie wie beim Newsletter. Die Berechtigungsabfrage ab Android 13 ist der
   natürliche Zustimmungsmoment.
3. **Das Token lebt wie eine Sitzung.** Löschen bei Abmeldung, bei `UNREGISTERED` von FCM und
   mit dem Konto (Art. 17). Es gehört in den Datenexport (`exportinhalt.ts`) — sonst wird die
   Zusage „alles, was zu deinem Konto gehört" still unvollständig — und vermutlich in dieselbe
   Liste wie „Angemeldete Geräte" in den Kontoeinstellungen.

   **Umgesetzt wurde davon alles außer der Liste** (2026-08-10), und das mit Absicht: Ein
   Push-Gerät ist kein zweites Gerät neben dem App-Zugang, es IST derselbe. Als eigene Zeile
   stünde dasselbe Telefon zweimal da, mit zwei Abmelde-Knöpfen, von denen einer weniger tut
   als der andere. Stattdessen hängt die Zeile am App-Token (`ON DELETE CASCADE`): Wer den
   Zugang abmeldet, beendet die Meldungen dorthin mit. Im Export steht sie dagegen sehr wohl —
   sie ist das eine Datum, das an Google geht (Art. 15 Abs. 1 lit. c), und ohne den Wert
   ließe sich dort nichts zuordnen. Das ist kein Widerspruch zur Regel „keine Zugangsmittel im
   Archiv": Eine FID öffnet nichts, sie ist eine Adresse.
4. **Keine neue Ökosystem-Abhängigkeit, aber eine sichtbarere.** Die App nutzt über
   `play-services-location` bereits Google-Komponenten; ob das im App-Abschnitt der
   Datenschutzerklärung beschrieben ist, gehört bei dieser Gelegenheit geprüft.

**Das Abholen bleibt trotzdem im Plan — als Rückfall, nicht als Startstufe.** Ein periodischer
`WorkManager`-Lauf (Mindestintervall 15 min, Bedingung Netz) fragt
`GET /api/tracker/importe/offen` ab. Er fängt drei reale Fälle: Geräte ohne Play Services,
verlorene oder von der Herstellersoftware verschluckte Push-Nachrichten, und den Zeitraum
zwischen „Konto verknüpft" und „Push-Token registriert". `gesehen_am` in `tracker_importe`
sorgt dafür, dass beide Wege dieselbe Tour nicht zweimal melden.

**Web:** kein Web-Push. Die Kontoseite zeigt die Importe als Liste — für eine Seite, die man
aktiv aufruft, ist das die richtige Form.

**iOS später:** APNs statt FCM, oder FCM als gemeinsame Fassade über beide. Die Entscheidung
gehört ins iOS-Projekt; der Server braucht dafür nur ein zweites `plattform`-Feld in
`push_geraete`, das deshalb von Anfang an existiert.

---

## 10. Tests

Vitest, Coverage-Gate 80 % wie im übrigen Backend. Was geprüft wird:

| Datei | Prüft |
|---|---|
| `tracker-vertrag.test.ts` | Registry: nicht konfigurierte Anbieter fehlen in der Liste; jeder registrierte hat eine Kennung |
| `tracker-normalisierer.test.ts` | FIT-Fixture → GPX mit erwarteter Punktzahl; Punkte-Format → GPX; kaputte Datei wirft sauber |
| `tracker-import.test.ts` | Webhook → Tour angelegt; **zweite identische Zustellung legt keine zweite Tour an**; Aktivität ohne GPS → `uebersprungen`; Quota voll → kein Import |
| `tracker-oauth.test.ts` | `state` erforderlich und einmalig; abgelaufener Token wird erneuert; Erneuerung fehlgeschlagen → Status `abgelaufen` |
| `tracker-webhook.test.ts` | falsche Signatur → 401, kein Import; Antwortzeit ohne Wartezeit auf den Importlauf |
| `tracker-polar.test.ts` u. a. | pro Adapter: gespeicherte Fixture-Payloads → erwartete Ereignisse |

Die Adapter bekommen ihre HTTP-Funktion **injiziert** — dasselbe Muster wie `Geocoder`,
`WetterQuelle`, `SchienenQuelle` in der Pipeline: Produktion reicht `fetch` herein, Tests eine
Fassung mit Fixtures. Kein Netz in der Suite, keine flackernden Tests.

---

## 11. Datei-Schnitt im Repo

```
server/src/tracker/
  vertrag.ts              # Typen, TrackerProvider, RohTrack
  tracker.ts              # TrackerDienst (Verknüpfungen, Tokens, Importe)
  importlauf.ts           # Hintergrundarbeit: holen → normalisieren → anlegen
  normalisierer.ts        # FIT/TCX/Punkte → GPX
  touranleger.ts          # ruft die bestehenden Tour-/Media-Pfade
  krypto.ts               # Token-Verschlüsselung
  registry.ts
  provider/
    polar.ts
    wahoo.ts
    suunto.ts
    ridewithgps.ts
    strava.ts             # später
server/src/routes/
  tracker.ts              # Nutzer-API
  tracker-webhooks.ts     # /api/webhooks/tracker/:anbieter (ohne Anmeldung)
server/test/tracker-*.test.ts
server/test/fixtures/tracker/…      # echte, anonymisierte Payloads + FIT-Beispiel

src/konto/trackerkarte.ts           # Web: Verknüpfungen in den Kontoeinstellungen
android/app/src/main/java/app/maptale/tracker/   # dünn: OAuth-Start, Deep Link, Foto-Nachzug
```

`app.ts` bekommt `registriereTrackerRouten(app)` und eine Dekoration `app.tracker` — dieselbe
Zeile wie bei Export und Newsletter. **Sonst ändert sich an bestehenden Dateien nichts**
außer `db.ts` (Migration), `config.ts` (Env) und `datenschutz.html`.

**Beim Bauen kamen zwei Abweichungen dazu:**

- **`legeTourAn` und `finalisiereTour` wurden aus den Routen in `tours.ts` herausgezogen** und
  sind jetzt Funktionen, die Route UND TourAnleger rufen. Der Vorsatz „ruft die bestehenden
  Pfade, dupliziert sie nicht" ließ sich sonst nicht einlösen: Die Regeln darin (Verifikation,
  Idempotenz über `client_tour_id`, Medien-IDs, Zeit-Semantik, `private` als Vorgabe) hätten
  sonst doppelt gepflegt werden müssen.
- **Die Webhook-Routen liegen in einem eigenen Fastify-Plugin-Bereich.** Sie brauchen den
  ROHEN Body für die Signaturprüfung (`JSON.parse` + `JSON.stringify` liefert nicht zwingend
  dieselben Bytes zurück), und ein Content-Type-Parser gilt je Bereich — global gesetzt hinge
  der rohe Body an jeder Route, auch an den mehrere MB großen Manifesten.

---

## 12. Do / Don't

**Do**
- Ein Anbieter = eine Datei + ein Registry-Eintrag + Fixture-Tests.
- Webhook sofort beantworten, Arbeit in den Hintergrund.
- Dedup in der Datenbank verankern (`client_tour_id` + UNIQUE-Index), nicht im Code prüfen.
- Tokens verschlüsselt; Erneuerung ausschließlich im Kern.
- Fehler sichtbar machen — im Konto, mit lesbarem Grund.
- Clients nur gegen den REST-Vertrag bauen.

**Don't**
- Provider-Logik in `tours.ts` / `media.ts` streuen.
- OAuth-Secrets oder Refresh-Tokens auf dem Gerät halten.
- Pro Plattform einen eigenen Polar-Client.
- Garmin-Scraping oder inoffizielle Endpunkte als Produktweg.
- Withings als Track-Quelle annehmen.
- Einen zweiten Finalize-/Pipeline-Zweig für „Cloud-Touren" bauen.
- Die Galerie ohne Zustimmung lesen oder außerhalb des Tour-Zeitfensters scannen.

---

## 13. Umsetzungsplan

Reihenfolge nach Nutzen pro Aufwand. Jede Etappe ist für sich auslieferbar — nach Etappe 2
kann jemand Garmin-Dateien importieren, ohne dass ein einziger OAuth-Adapter existiert.

| # | Etappe | Inhalt | Ergebnis | Aufwand |
|---|---|---|---|---|
| 0 | ~~**Additive Medien-Route**~~ | `POST /api/tours/:id/medien` + endgültiges Löschen + Studio-Nachreichen ([eigenes Konzept](konzept_medien_nachreichen_und_loeschen.md)) | **fertig** (2026-08-09) | — |
| 1 | ~~**Kern**~~ | `vertrag.ts`, `TourAnleger`, `Importlauf`, Migration 17, Registry, Tests | **fertig** (2026-08-09): Der TestProvider legt eine echte Tour an | — |
| 2 | **Datei-Weg** | Normalisierer (FIT/TCX→GPX), Share-Intent Android, Studio-Hinweis Garmin-Export | Jede Uhr der Welt ist bedient | 2–3 Tage |
| 3 | ~~**Polar**~~ | OAuth, `POST /v3/users`, Webhook mit HMAC, GPX holen | **Adapter fertig** (2026-08-10); Webhook-Registrierung und Praxistest offen: [docs/ops/polar-einrichten.md](../ops/polar-einrichten.md) | — |
| 4 | ~~**Client-Naht**~~ | Kontoseite „Verbundene Dienste" (Web), Verknüpfen/Trennen/Status, Importliste, Datenschutz-Absatz | **fertig** (2026-08-10) | — |
| 5 | ~~**Android dünn**~~ | OAuth im System-Browser, Deep Link, `WorkManager`-Abfrage als Rückfall | **fertig** (2026-08-10) | — |
| 6 | ~~**Push (FCM)**~~ | `FirebaseMessagingService`, `push_geraete` (Migration 18), HTTP-v1-Versand, Datenschutz-Absatz | **Code fertig** (2026-08-10); es fehlt allein das Firebase-Projekt samt Dienstkonto: [docs/ops/push-einrichten.md](../ops/push-einrichten.md) | — |
| 7 | ~~**Foto-Nachzug (App)**~~ | Galerie-Scan im Zeitfenster (nur Kamera-Ordner), Zeitzonen-Toleranz, Automatik mit stehender Einwilligung + Benachrichtigung, sonst Frage in der Tour | **fertig** (2026-08-10) | — |
| 8 | **Wahoo** | OAuth mit Refresh-Rotation, Webhook, FIT-Download | Zweiter Anbieter, FIT-Weg im Betrieb erprobt | 2–3 Tage |
| 9 | **Strava** | nach Prüfung von Tier-Modell und Auflagen; Streams→GPX | **Der Garmin-Zugang**, plus größte eigene Nutzerbasis | 4–5 Tage |
| 10 | **Suunto** | Antrag früh stellen; Adapter analog Wahoo | Vierter Anbieter | 2 Tage + Wartezeit |
| 11 | **Ride with GPS** | OAuth, Polling-Pfad im Kern | Polling-Weg existiert für alle künftigen Anbieter | 2 Tage |
| 12 | **iOS** | derselbe REST-Vertrag, APNs, HealthKit optional | Zweite Plattform ohne Server-Änderung | im iOS-Projekt |
| — | Garmin (direkt) | Antrag stellen, wenn das Produkt öffentlich steht | offen; bis dahin über Etappe 9 versorgt | blockiert |

**Erstes sinnvolles Release: Etappen 0–7** — additive Medien-Route, Kern, Datei-Weg, Polar,
Web- und Android-Naht, Push und Foto-Nachzug. Alles davon steht bis auf den **Datei-Weg
(Etappe 2)**, der übersprungen wurde: Er hängt an keiner der anderen Etappen, und Polar
liefert GPX fertig — der Normalisierer wird erst mit Wahoo (FIT) zur Pflicht.

**Zugänge früh beantragen, sie sind Wartezeit, keine Arbeit:** Der Polar-Zugang
liefert **keine Historie** — je früher verknüpft, desto eher gibt es echte
Testaktivitäten. Der **Polar-Zugang besteht seit 2026-08-09** (AccessLink-Admin,
self-serve; Client-ID/-Secret in `server/.env` als `MAPTALE_POLAR_CLIENT_ID`/`_SECRET`,
Datentyp nur „Exercise data"). **Beide Redirect-URLs sind im selben Client hinterlegt**
(`https://maptale.io/api/tracker/polar/callback` als Default plus
`http://localhost:8787/…` für Dev) — der Adapter schickt `redirect_uri` deshalb IMMER
explizit mit, Polars Default-Mechanik greift nie. Der Webhook samt
`signature_secret_key` wird erst mit dem Adapter per `POST /v3/webhooks` registriert;
**pro Client gibt es nur EIN Abo** — Dev testet daher über den manuellen Sync
(Transaktions-Pull, der Webhook ist nur der Wecker) oder zeigt das Abo vor dem Launch
vorübergehend auf einen Tunnel. Suunto-Antrag und der spätere Garmin-Antrag bleiben
offen — sie sind Wartezeit, keine Arbeit. Jeder weitere Anbieter
kostet danach 2–3 Tage, und genau das ist der Zweck des Zuschnitts: Der teure Teil wird einmal
bezahlt.

**Strava ist von Prio 10 auf 9 gerückt** und hat seinen Charakter geändert: Es ist nicht
„noch ein Anbieter", sondern der einzige legitime Weg zu Garmin-Nutzern (s. Garmin-Steckbrief).
Wer die Reihenfolge kürzt, sollte eher Suunto und Ride with GPS schieben als Strava.

Was den Aufwand erfahrungsgemäß sprengt, wenn man es unterschätzt: der **FIT-Parser** (eine
Bibliothek nehmen, nicht selbst schreiben), die **Token-Erneuerung mit rotierenden
Refresh-Tokens** (ein Denkfehler = alle Verknüpfungen tot) und die **Zeitzonen beim
Foto-Matching** (Abschnitt 4).

---

## 14. Offene Entscheidungen

Nichts davon blockiert Etappe 1, aber jedes will vor seiner Etappe beantwortet sein:

1. ~~**Fotos nachreichen: bestehender Weg oder eigene Route?**~~ **Entschieden (2026-08-09):
   eigene additive Route** `POST /api/tours/:id/medien` mit server-vergebenen IDs, dazu
   endgültiges Löschen — s. [konzept_medien_nachreichen_und_loeschen.md](konzept_medien_nachreichen_und_loeschen.md).
   Sie ist Etappe 0 dieses Plans (s. Abschnitt 13), nicht Teil von Etappe 7.
2. **Tour-Sichtbarkeit beim Auto-Import.** `private` wie beim Upload ist die konsistente
   Antwort — aber eine Tour, die von selbst entsteht und niemand sieht, könnte auch übersehen
   werden. Vermutlich `private` plus deutliche Meldung.
3. **Fortbewegungsart aus der Sportart.** Anbieter melden „Ride"/„Run"/„Hike"; daraus
   `bike`/`walk` abzuleiten ist naheliegend — die Zuordnungstabelle gehört in den Kern, nicht
   in jeden Adapter, und die vorhandene Server-Erkennung (Tempo, Schienen) bleibt darüber.
4. **Mindestlänge für einen Import.** Eine 400-m-Aktivität als Tour anzulegen erzeugt Müll im
   Konto. Ein Schwellwert (Vorschlag: 1 km oder 10 min) mit Status `uebersprungen`.
5. **Strava-Auflagen** (Branding, Darstellung, Videos) — vor Etappe 10 im aktuellen
   API-Agreement prüfen, nicht aus diesem Dokument übernehmen.

---

## 15. Anhang: Warum nicht „einfach Health Connect"

Die ursprüngliche Frage war, ob Health Connect den ganzen Aufwand erspart. Nein, und die
Gründe gehören festgehalten, damit sie nicht in einem halben Jahr neu recherchiert werden:

- **Routen sind besonders geschützt.** `READ_EXERCISE_ROUTES` lässt sich nicht wie eine
  gewöhnliche Berechtigung erfragen — sie wird nur in den Health-Connect-Einstellungen oder
  über einen eigenen Systemdialog erteilt. Und selbst mit „Immer erlauben" gibt Health Connect
  fremde Routen **im Hintergrund grundsätzlich nicht** heraus: Der Aufruf antwortet
  `ExerciseRouteResult.ConsentRequired`. Google empfiehlt ausdrücklich, Routen nur bei
  bewusster Nutzer-Interaktion im Vordergrund anzufordern. Der automatische Import ohne Zutun —
  der Kern der Idee — fällt damit weg, und das ist keine Lücke in der Umsetzung, sondern die
  Absicht der Plattform.
- **Kein Server-Zugang.** Health Connect hat keine Cloud-Schnittstelle; alles muss über eine
  Android-App laufen, die die Daten liest und hochlädt. Genau die Kopplung, die dieses Konzept
  vermeidet.
- **Nur ein Gerät, nur eine Plattform.** Health Connect kennt keinen Desktop, und iOS braucht
  ohnehin HealthKit. Die Cloud-Wege gelten überall gleich.
- **Der wichtigste Anbieter schreibt die Route gar nicht.** Garmin teilt mit Health Connect
  Distanz, Kalorien, Puls, Tempo, Höhenmeter und Schritte — **keine GPS-Route**. Der
  Umweg „Garmin → Health Connect → Maptale" scheitert also schon an den Daten, nicht erst an
  der Berechtigung.

Health Connect bleibt deshalb, was Abschnitt 3.5 beschreibt: ein bequemer Seiteneingang für
Android-Nutzer, deren Anbieter keine brauchbare API hat — kein Fundament.
