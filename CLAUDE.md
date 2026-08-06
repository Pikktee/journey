# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

Maptale ist eine App für Relive-artige 3D-Kamerafahrten über eine GPS-Route mit
automatischen Foto-Stopps — vollständig auf freien Kartendaten. Web-Player in Vanilla JS + Vite
(neue Module in TypeScript), gerendert mit MapLibre GL JS.

**Maptale wird von einem Prototyp zu einem echten Produkt ausgebaut** (Aufnahme-Plattform,
Meilensteine M1–M9): eigene Touren aufzeichnen (Android), hochladen, serverseitig anreichern
und mit der vorhandenen Player-Engine abspielen. Das Repo ist ein **Monorepo**:

- **Root**: Web-Player (Vite). Spielt statische `TOURS` und aufgezeichnete Touren
  (`?tour=srv:<id>` → [src/remote.ts](src/remote.ts) gegen das Backend).
- **[server/](server/)**: Backend (Node 22 + Fastify + better-sqlite3, TypeScript strict).
  Upload → Anreicherungs-Pipeline (Benennung via Nominatim, Pausen-Kollaps — GPS-Drift im
  Stand wird auf den Schwerpunkt gezogen, sonst zittert die Kamera und die km-Statistik lügt;
  läuft in `ladeOriginalSegmente`, der von Editor UND Render geteilten Stelle —, Track-
  Vereinfachung, Timeline mit Pausen-Zeitraffer, Medien-Platzierung, Edit-Overlay,
  Auto-Wetter via Open-Meteo, Wetter-Verfeinerung per Foto-Bildanalyse) → Tour-JSON. Dazu Mehrbenutzer-Betrieb: Konten mit
  Mail-Bestätigung, Passwort-Reset, Quota, Sichtbarkeit, Rollen und Einladungen
  ([server/src/auth/](server/src/auth/), `quota.ts`, `mail.ts`).
  Schema-Doku: [docs/specs/austauschformat.md](docs/specs/austauschformat.md);
  wer wofür zuständig ist (Rohdaten / Overlay / Tour-JSON / Cache) und wohin ein neues Feld
  gehört: [docs/specs/overlay-und-tourjson.md](docs/specs/overlay-und-tourjson.md).
- **Studio** ([studio.html](studio.html) + [src/studio/](src/studio/)): Weboberfläche zum
  Hochladen und Bearbeiten aufgezeichneter Touren (s. eigener Abschnitt unten).
- **Öffentliche Seiten**: [galerie.html](galerie.html) (alle auf `public` gestellten Touren,
  Logik in [src/galerie/](src/galerie/)) und [profil.html](profil.html) (`/@henrik`, die
  Reisen einer Person; `?id=…` bleibt als Alias, Logik in [src/profil/](src/profil/)). Beide
  ohne Anmeldung; die Kartendaten teilen sie sich
  ([galeriemodell.ts](src/galerie/galeriemodell.ts)), alles Übrige der Profilseite —
  Kennzahlen, Link-Chips, „gehört mir?" — steht DOM-frei in
  [profilmodell.ts](src/profil/profilmodell.ts). **Kennzahlen summiert der SERVER und nur
  über öffentliche Touren**: „12 Touren" neben drei sichtbaren Karten wäre eine Auskunft über
  die anderen neun. Das Bearbeiten-Modal wird erst für den Besitzer nachgeladen
  ([profilbearbeiten.ts](src/profil/profilbearbeiten.ts)). Ohne Anzeigenamen steht im Kopf
  der HANDLE (nicht „Ohne Namen" — das beschrieb ein leeres Datenbankfeld, nicht die
  Person; er fällt dann aus dem Beiwerk, sonst stünde er zweimal), und ohne gewähltes
  Titelbild zeigt das Banner eines der vier mitgelieferten, deterministisch aus dem Handle
  gewählt ([titelbilder.ts](src/profil/titelbilder.ts) `standardTitelbild`) — zufällig
  bekäme dieselbe Person bei jedem Aufruf ein anderes Kopfbild.
- **Kontoeinstellungen** ([konto.html](konto.html) + [src/konto/](src/konto/)): eigene Seite
  unter `/konto`, nicht im Studio (s. eigener Abschnitt unten).
- **Benutzerverwaltung** ([admin.html](admin.html) + [src/admin/](src/admin/)): Konten,
  Rollen und Einladungen (s. eigener Abschnitt unten).
- **[android/](android/)**: Aufnahme-App (Kotlin, Compose, minSdk 29) — s. eigener Abschnitt.

Sprache im gesamten Projekt (Code-Kommentare, UI, Doku, Commit-Messages) ist **Deutsch** —
auch in server/ und android/ (deutsche Bezeichner).

**Design System.** Kanonische Quelle für Marke, Farben, Typografie und UI-Dos/Don’ts ist
[`DESIGN.md`](DESIGN.md) (Google DESIGN.md-Format). Coding-Assistenten und UI-Arbeit folgen
dieser Datei; CSS-Variablen, [`src/brand.ts`](src/brand.ts) und Android `Theme.kt` /
`Typografie.kt` sind Ableitungen. Kurzregel: Outfit überall; Zahlen mit
`font-variant-numeric: tabular-nums` (Compose: `fontFeatureSettings = "tnum"`), nicht Mono.

## Commands

```bash
npm install
npm run dev      # Vite-Dev-Server, Port 5173 (strictPort — belegt = Fehler, nicht Ausweichport)
npm run build    # Produktions-Build nach dist/
npm run preview  # gebautes dist/ lokal servieren
npm run release  # Version anheben + Tag pushen → triggert Deploy (bugfix|minor|major)
```

Weitere Arbeitsbereiche:

```bash
npm test                      # Web-Unit-Tests (Vitest: geo.js, remote.ts/timeAt, audiotracks.js
                              #   und die Studio-Logik — Editor, Baukasten, Upload, EXIF)
npm run typecheck             # tsc --noEmit; die CI deployt ohne grünen Typecheck nicht
cd server && npm run dev      # Backend (tsx watch, Port 8787; via PORT übersteuerbar)
cd server && npm test         # Backend-Tests (Vitest)
cd server && npm run test:coverage  # dieselben Tests mit Coverage-Gate 80 % (wie in der CI)
cd android && ./gradlew test  # Android-Unit-Tests (JAVA_HOME auf JDK 17 setzen)
```

Optik-Verifikation läuft weiterhin über den Dev-Server im Browser. Dev-Proxy: `/api` →
`http://localhost:8787` (übersteuerbar via `MAPTALE_API`-Env, z. B. wenn 8787 belegt ist —
auf dem Server läuft die API aus demselben Grund auf Host-Port 8790).

Tour-Auswahl per Query-Param am Player: `/erlebnis.html?tour=<id aus TOURS>` (Default
`kohphangan`), aufgezeichnete Touren via `?tour=srv:<id>`. `/?tour=…` funktioniert weiterhin,
wird aber von der Landing auf `/erlebnis.html` umgeleitet. `?app=1` markiert die Android-WebView.

**Deployment.** Hetzner-VPS mit CloudPanel (Railway und der Caddy-Container sind abgelöst):
CloudPanels Nginx serviert den statischen Build und proxyt `/api`; **nur die API läuft im
Container** ([docker-compose.cloudpanel.yml](docker-compose.cloudpanel.yml) →
[server/Dockerfile](server/Dockerfile), Host-Port `127.0.0.1:8790` → Container 8787,
Daten-Bind-Mount `/srv/maptale/daten`). Ein Version-Tag `vX.Y.Z` triggert
[.github/workflows/deploy.yml](.github/workflows/deploy.yml): Gate aus Web-Tests + Typecheck +
Build, Backend-Tests mit Coverage-Gate und Android-Unit-Tests → API-Image nach GHCR → per SSH
`docker compose -f docker-compose.cloudpanel.yml up -d` plus `rsync` des `dist/` in den
Site-Docroot. Tags erzeugt [scripts/release.sh](scripts/release.sh) (`npm run release`). Nötige
Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `CLOUDPANEL_DOCROOT` (fehlt letzteres, wird der
Rollout still übersprungen). Runbook: [docs/ops/deploy-cloudpanel.md](docs/ops/deploy-cloudpanel.md).
**Derselbe Tag baut die Android-App** und hängt den APK ans Release
`android-X.Y.Z` — der Download-Knopf der Landing zeigt fest auf
`releases/latest/download/maptale-android.apk` und lief, solange das von Hand geschah,
regelmäßig dem Code hinterher. Die App-Version kommt aus derselben `package.json`
(`versionCode` = `major*10000 + minor*100 + patch`); ohne hinterlegten Debug-Keystore
(`ANDROID_DEBUG_KEYSTORE_BASE64`) signiert jeder Lauf anders und der APK kann eine vorhandene
Installation nicht aktualisieren: [docs/ops/android-release.md](docs/ops/android-release.md).
`docker-compose.yml` + [Caddyfile](Caddyfile) bleiben als Alt-Weg für Server ohne CloudPanel.

## Architektur

Es gibt drei unabhängige Frontends: den **Player** ([erlebnis.html](erlebnis.html) +
[src/main.js](src/main.js)), das **Studio** ([studio.html](studio.html) +
[src/studio/](src/studio/)) und eine schlanke **Landing** ([index.html](index.html), kein
MapLibre). Alle sind eigene Vite-Einstiege ([vite.config.js](vite.config.js)).

**Der URL-Raum steht in [src/routen.ts](src/routen.ts) — und nur dort.** Kein Router: Nginx
liefert die Seiten statisch aus, nur `/api` geht in den Container. Aus der Tabelle leiten sich
die Vite-Eingänge, alle Links (`pfad('player', '?tour=…')`), die Dev-Middleware in
[vite.config.js](vite.config.js) und die `location`-Blöcke des Vhosts ab; ein Drift-Wächter
([test/routen.test.ts](test/routen.test.ts)) hält Vhost und die Server-Kopie
([server/src/webpfade.ts](server/src/webpfade.ts), Mail-Links — eigener `rootDir`, kann nicht
importieren) dagegen. **URLs tragen kein `.html`**; die `…​.html`-Adressen antworten zwar
weiterhin (die Dateien liegen im Build), aber nichts im Code zeigt mehr dorthin — Nebeneffekt,
keine Zusage. Drei Pfade zeigen auf `studio.html`, weil dieselbe Seite drei Dinge ist: die Tür
(`/anmelden`, `/registrieren`) und der Raum dahinter (`/app`); welcher gilt, weiß nur der
Anmeldezustand, also schreibt `setzePfad` ihn per `replaceState` nach (samt Tab-Titel). Der
Pfad heißt **nicht** `/studio`: Ein Konto braucht auch, wer nur mit der App aufzeichnet.
**Beim Rollout muss der Vhost mitgehen** — ohne `try_files $uri $uri.html …` und die drei
`location =`-Blöcke landet jeder Anmelde- und Bestätigungslink still auf der Landing.
[deploy/cloudpanel-nginx.conf](deploy/cloudpanel-nginx.conf) ist die Vorlage; sie wird von
Hand in CloudPanel eingesetzt und **wird vom Deploy nicht mitgezogen** (auf dem Server steht
CloudPanels eigenes Gerüst, nicht diese Datei — Handgriff und Gegenprobe:
[docs/ops/deploy-cloudpanel.md](docs/ops/deploy-cloudpanel.md), Abschnitt 2). Bei Mehrsprachigkeit
wird aus `pfad: '/anmelden'` ein Eintrag je Sprache samt `/en/`-Präfix — die Aufrufer nennen
den sprachneutralen Namen, nicht den Pfad, und ändern sich nicht.

**Neben der Tabelle liegt genau ein zweiter Namensraum: `/@henrik`** — die Adresse einer
Person ([src/handle.ts](src/handle.ts), Server-Kopie [server/src/handle.ts](server/src/handle.ts),
Vhost `location ~ ^/@`). Er steht bewusst NICHT in `ROUTEN`: Ohne das `@` teilte sich ein
Handle den Namensraum mit allen Seitenpfaden, und jeder neue Pfad entwertete still einen
vergebenen Handle. Aus demselben Grund ist die Liste reservierter Wörter eine eigene und
keine Ableitung aus `ROUTEN` — der Wächter prüft nur die eine Richtung (jeder Pfad muss
reserviert sein). Drei Dinge, die man dabei zerstört: `encodeURIComponent('@')` macht `%40`
daraus (deshalb baut `profilPfad` den Pfad selbst); die Dev-Middleware muss gegen
`HANDLE_REGELN` prüfen statt bloß auf `/@`, weil Vite unter genau diesem Präfix seine eigenen
Adressen bedient (`/@vite/client`, `/@fs/…`); und ein geänderter Handle wandert 90 Tage in
`handles_reserviert`, damit alte Links weiter zur Person führen, statt an den nächsten
Interessenten zu fallen. Die alte Form `?id=…` bleibt für immer bedienbar — die Profilseite
schreibt sie per `replaceState` auf `/@…` um.

Der Player läuft clientseitig ab einem `map.on('load')`-Callback in [src/main.js](src/main.js),
der die Module verdrahtet. Der zentrale Datenfluss:

**Route als Bogenlängen-Parameter.** [src/geo.js](src/geo.js) `buildRoute()` nimmt Wegpunkte,
glättet sie (Catmull-Rom) und resampled sie auf ~14 m Schritte. Die entstehende `route` trägt
`coords` (lng,lat,ele), kumulierte Distanzen `cum` und `total`. **Die eine Zustandsvariable, die
alles antreibt, ist `s` — die Position entlang der Route in Metern.** `pointAt(route, s)`,
`bearingAt(route, s)`, `nearestS(route, lnglat)` übersetzen zwischen `s`, Koordinaten und
Kurswinkel. Fotos und Modus-Wechsel werden über `s` verankert.

**Tour-Konfiguration als Daten.** [src/tours.js](src/tours.js) exportiert `TOURS` — pro Tour:
`segments` (jedes mit `pts` und `mode`), `photos` (mit
`anchor`-Koordinate), Intro-/Finale-Texte, optional `time` (für Tag/Nacht), `geoid` und `weather`.
`weather` ist eine kuratierte Wetter-Timeline `[{ km, mode, k }]` (km entlang der Route) und hat
Vorrang vor dem historischen Auto-Wetter — nötig, wenn das ERA5-Archiv einen Effekt nie codiert
(z.B. Gewitter über Koh Pha-ngan). main.js verkettet die Segmente
zu einer Wegpunktliste, baut die Route und verankert Fotos via `nearestS`. Nahe beieinander
liegende Fotos (< 120 m in `s`) werden zu einem **Stopp** mit mehreren `items` gruppiert.

**Kamera-Engine.** [src/tour.js](src/tour.js) `Tour` ist das Herzstück. Sie nutzt MapLibres
**FreeCamera-API** (nicht zoom-basiert), weil zoom-basierte Kameras in steilem Gelände im Hang
stecken bleiben — die Kamera hat eine explizite Flughöhe über Grund plus Blickpunkt. Jede
Kameragröße läuft durch einen `Smooth`-Filter (exponentielle Glättung mit `tau`), wodurch
Phasenwechsel automatisch zu weichen Schwenks werden. Phasen: `intro` (Orbit) → Fahrt →
Foto-Orbit → Finale. Pro Modus skalieren `MODE_SPEED`/`MODE_SCALE` Tempo und Kameradistanz;
`PRESETS` (nah/mittel/weit) sind die vom Nutzer wählbaren Einstellungsgrößen. Die Engine ruft
pro Frame `ui.updateTrace(s, pos)` und optional `ui.onTick(frac)` auf.

**Fortbewegungs-Modi** sind `walk | bike | moped | jeep | tram | ferry`. Die Liste muss an vier
Stellen deckungsgleich bleiben: `MODE_SPEED`/`MODE_SCALE` ([src/tour.js](src/tour.js)),
`MODE_ICONS` ([src/map.js](src/map.js)), `MODE_SOUND` ([src/vehicle.js](src/vehicle.js), nur
die drei mit Motorgeräusch: moped/jeep/ferry — die Tram fährt lautlos) und `MODI` ([server/src/schema/upload.ts](server/src/schema/upload.ts), von
dort beziehen Studio-Typ und alle JSON-Schema-Enums ihre Werte). Sie **lief schon einmal
auseinander** — Studio und Server kannten `moped`/`jeep` nicht, obwohl Engine, Icons und
Motorsound sie längst unterstützten; aufgezeichnete Touren konnten diese Modi deshalb nie
bekommen. Ein Drift-Wächter in [test/studio-baukasten.test.ts](test/studio-baukasten.test.ts)
vergleicht die Listen (und die Tempo-Faktoren) jetzt automatisch.
Der Modus wird bei der Aufnahme EINMAL angegeben; wo jemand stattdessen zu Fuß war, trennt
[server/src/pipeline/tempo.ts](server/src/pipeline/tempo.ts) beim Rendern selbst ab (s. unten).
Im Editor ist **jeder Modus-Wechsel eine ziehbare Kante** — auch die von der Automatik
erkannte. Beim ersten Zug schreibt `materialisiereModi` ([editmodell.ts](src/studio/editmodell.ts))
die ganze erkannte Aufteilung als Grenzen fest: `edits.modi` ist eine Stufenfunktion, die AB
ihrem Punkt alles Folgende übersteuert — eine einzelne neue Grenze mitten in der Automatik
risse die späteren Abschnitte mit. `klemmeGrenze` hält jede Kante zwischen ihren Nachbarn UND
lässt mindestens einen Trackpunkt im Abschnitt: sonst gälte der Zustand für keinen Punkt, das
Band verschwände aus der Anzeige und wäre nicht mehr anzufassen.

**Höhen zweistufig.** Wegpunkt-Höhen sind nur der Startwert. Nach dem Laden holt
[src/elevation.js](src/elevation.js) echte DEM-Höhen aus AWS Terrarium-Tiles (async fetch +
Bilinear-Sampling), glättet sie und überschreibt `coords[i][2]`; Höhenmeter und Höhenprofil
werden neu berechnet. Fähr-Abschnitte werden auf Meereshöhe geklemmt (DEM rauscht über Wasser).
Fällt der Fetch aus (offline), bleibt es beim Wegpunkt-Profil.

**Rendering-Schichten.** [src/map.js](src/map.js) baut den MapLibre-Stil: Esri-Satellit über
AWS-Terrain-DEM (`EXAGGERATION`-Konstante), Atmosphäre, Routen-Layer, Foto-Wegpunkte
(`addSpotLayers`), Fahrer-Marker (`createRider`/`setRiderIcon` mit `MODE_ICONS`).
[src/daynight.js](src/daynight.js) + [src/sun.js](src/sun.js) mappen Streckenanteil → Pseudo-Uhrzeit
→ Sonnenstand → Szenenstimmung (nur wenn `cfg.time` gesetzt ist).
**Foto-Stopps sind 3D-PINS** ([src/photopins.js](src/photopins.js), Standard;
`?pins3d=0` = alte flache Kreise, `?pins3d=foto` = Bild im Kopf): Fußring am Boden, Mast,
Kopfscheibe mit Nummer. Eigener Three.js-Custom-Layer, weil MapLibre 5 Symbole/Kreise nicht
über Grund heben kann (`symbol-z-offset` gibt es dort nicht). Die Größe kommt aus der
KAMERADISTANZ, nicht als feste Meterhöhe — sonst wäre der Pin im Intro-Anflug ein Zahnstocher
und am Foto-Orbit ein Sendemast. Voll dargestellt wird nur ein FENSTER um die aktuelle
Position (nächster Stopp, zuletzt besuchter, am Desktop der zweite kommende), alles andere
bleibt ein flacher Bodenpunkt: am Pixel 9 kostete das Querformat mit vier Pins doppelt so
viel CPU wie das Hochformat mit einem (7 % Bildrate → mit Detailstufe unter der Messschwelle).
Rechenregeln DOM-frei und getestet in [src/pinmodell.ts](src/pinmodell.ts); Machbarkeit,
Messwerte und Fallen (Mercator-y-Flip cullt Bodenflächen!) in
[docs/architecture/foto-pins-3d.md](docs/architecture/foto-pins-3d.md).

**Gebäude sind ein einzelner fill-extrusion-Layer** (`buildings-3d`; MapLibre kann kein
AO/Schatten/Fenster). [src/buildings.js](src/buildings.js) sampelt beim Kachel-Laden die echte
Dachfarbe aus dem Esri-Satellitenpixel am Gebäude-Zentroid und setzt sie per `feature-state`
{color} (nachts ignoriert → dunkle Palette). **Kritisch:** In den OpenFreeMap-Kacheln fehlt
`hide_3d`, ~15 % der Polygone überlappen (Umriss + parts) und flimmern durch koplanares
Z-Fighting; clientseitig ist das geometrisch nicht sauber lösbar. Deshalb werden ALLE
Gebäudefarben (gesampelt wie Fallback-Palette) auf **konstante Luminanz** normalisiert — der
Z-Fight kippt dann nur im Farbton, kaum sichtbar. Echte Geometrie-Bereinigung + Dächer/Schatten
brauchen einen zweiten Renderer; drei Wege sind gebaut und per Query-Flag wählbar: `?deck=1`
(deck.gl-Gebäude über MapLibre, [src/deckbuildings.js](src/deckbuildings.js)), `?scene=1`
(eigenständige deck.gl-Szene, [src/deckscene.js](src/deckscene.js)) und `?roofs=1` (leichter
Three.js-Dächer-Renderer, [src/buildings3d.js](src/buildings3d.js)). Geerdete Wurf-Schatten
([src/shadows.js](src/shadows.js)) laufen im Default-Pfad mit (`?noshadows=1` schaltet sie aus).
Begründung und Vergleich: [docs/architecture/renderer-plan.md](docs/architecture/renderer-plan.md).

**UI.** [src/ui.js](src/ui.js) `UI` verwaltet Overlays, Steuerleiste, Telemetrie, Höhenprofil und
die Fortschrittsleiste. Das Scrubbing (Ziehen/Tippen auf der Timeline, inkl. Foto-Dots) wird in
main.js über Pointer-Events verdrahtet und ruft `tour.beginScrub/scrub/endScrub` bzw.
`tour.jumpToPhoto`. Der Player-DOM liegt statisch in [erlebnis.html](erlebnis.html); JS greift
per `id` zu. **Die UI zieht sich während der Fahrt selbst zurück** (`body.ui-clean`, nach 3,2 s
Ruhe; Weg zurück, Halt-Chip, Steuerleiste UND Mauszeiger) und kommt bei der nächsten Regung wieder —
auf jeder Zeigerart, deshalb gibt es keinen Knopf und keine Taste dafür mehr. Zwei Fallen:
`pointermove` feuert auch ohne Handbewegung, sobald sich der Inhalt unter dem stehenden Zeiger
ändert (also pro Frame) — ohne Koordinaten-Vergleich käme die UI nie zur Ruhe; und `:hover` (die
Ausnahme „Maus liegt auf der Steuerleiste") darf nur bei `(hover: hover)` zählen, weil die
Pseudoklasse auf Touch nach einem Tipp am getippten Element hängen bleibt.

**Oben links steht genau EIN Element: der Weg hinaus** — die Pille `.zurueck`, fest positioniert
über dem Intro. Sie steht die ganze Fahrt über da (nicht nur im Startscreen), trägt das Wort der
Herkunft (Studio · Entdecken · Profil aus dem Referrer, sonst „Startseite") und geht per
`history.back()`, damit Scrollposition und Zustand der Liste erhalten bleiben. Der frühere
Marken-/Titelblock daneben ist **ersatzlos weg** (samt `body.intro-open`): er war nur während
der Fahrt sichtbar und wiederholte dort Ort und Route, die im Startscreen formatfüllend stehen
und unterwegs im Halt-Chip und in der Telemetrie weiterlaufen. Sein Kicker war zugleich ein
Home-Link auf die Landing — genau der Griff, über den man aus „Entdecken" heraus auf der
Startseite landete. Aus demselben Grund hat die Steuerleiste **keinen Menü-Knopf** mehr (zum
Startscreen einer Tour führt das Finale) und das Studio spielt im **selben Tab** ab (`spielAb`):
ein zweites Fenster hätte keinen Weg zurück, nur ein Schließkreuz. Im App-Modus (`body.app`)
bleibt die Pille aus — dort führt `.app-exit` in der Steuerleiste in die Tourliste.
Die einzige `h1` des Players ist seither der Intro-Titel.

**Typografie im Player folgt [`DESIGN.md`](DESIGN.md):** Outfit überall, Kennzahlen mit
`font-variant-numeric: tabular-nums` — **kein Mono und kein Versalien-Sperrsatz**. Der einzige
verbleibende Mono-Platz ist das API-Schlüssel-Feld des Google-3D-Testmodus (Debug); die
Karten-Attribution läuft seit dem Kartendaten-Popup ebenfalls in Outfit. Die kleinen gesperrten
Etiketten („NÄCHSTER HALT", „DISTANZ", „KM 12.3") waren die alte Sprache; Label sind jetzt
Satzschrift.

**Die Pflicht-Attribution ist ein ⓘ-Knopf mit Popup** ([src/karteninfo.ts](src/karteninfo.ts)),
nicht MapLibres compact-Control (`attributionControl: false`): eine Glaskarte, die pro Quelle
nennt, WAS man ihr ansieht (Satellitenbild · Gelände · Gebäude · Wetter). Zwei Punkte, die man
leicht „aufräumt": Der Inhalt wird aus den `attribution`-Feldern der Stil-Quellen gebaut — eine
neue Kachelquelle erscheint dadurch von selbst, ohne Rollen-Eintrag als „Kartendaten", aber
niemals ungenannt. Und das Element hängt am **body**, nicht im Kartencontainer: dessen `z-index`
gilt nur innerhalb des Karten-Stacking-Contexts, das Popup verschwand dort hinter der
Steuerleiste (Nebeneffekt: der Knopf bleibt im Google-3D-Modus sichtbar, wo MapLibres Canvas
ausgeblendet ist). Solange es offen steht, hält `body.info-offen` den Auto-Rückzug der UI an.

**Eine Tour beginnt am Anfang.** Der Player merkt sich Position und Wiedergabezustand
(`maptale:pos:<id>`), aber die Wiederaufnahme hängt an einem **Einmal-Ticket** im sessionStorage
(`maptale:weiter:<id>`): Nur der Renderer-/Ansicht-Umschalter legt es unmittelbar vor seinem
eigenen Reload, der nächste Start verbraucht es sofort. Vorher genügte ein 30-Minuten-Fenster im
localStorage — wer eine Tour verließ und erneut startete, landete bei Kilometer 14 statt im
Startscreen. Ohne Ticket wird der Merker nicht einmal gelesen.

**Das Fortbewegungsmittel steht NICHT in der Telemetrie.** Der Marker auf der Karte zeigt es,
der Motorloop lässt es hören — ein Wort „Unterwegs mit · Jeep 4×4" in der Steuerleiste
wiederholte das nur. Der Modus wird weiter pro Frame verfolgt (`modeKey` in `ui.stats`), denn an
seiner Kante hängen Marker-Icon und Motorsound.

**Atmosphäre und Wetter.** [src/atmosphere.js](src/atmosphere.js) (Horizont-Dunst, Wolken,
Sterne, Sonne) und [src/weather.js](src/weather.js) (Regen/Schnee/Nebel/Gewitter als
Partikel-Overlay) liegen über der Karte. Das Wetter kommt entweder aus der kuratierten
`weather`-Timeline der Tour, aus dem Tour-JSON des Servers oder — als Fallback — aus
[src/autoweather.js](src/autoweather.js) (Open-Meteo an den Foto-Ankern).
[src/audiotracks.js](src/audiotracks.js) spielt die im Studio gesetzten Musik-/SFX-Spuren.

**„Google 3D"-Modus (`?tiles3d=1`).** [src/tiles3d.js](src/tiles3d.js) rendert Google
Photorealistic 3D Tiles — den echten Fotoscan der Stadt, also „die echten Gebäude, die dort
stehen" — in einer eigenen, lazy geladenen **Three.js**-Szene via 3DTilesRendererJS (kein
Cesium). MapLibre läuft dabei **unsichtbar weiter** (die Tour-Engine braucht dessen Terrain-
Abfragen); die Kamera wird pro Frame in ECEF gespiegelt (`extCamera`, `WGS84_ELLIPSOID`).
Route/Fahrer/Tag-Nacht sind integriert. Aktivierung über einen Google-Map-Tiles-API-Key
(`VITE_GOOGLE_MAP_TILES_API_KEY` im Dev bzw. `localStorage`). Grenze: Google deckt nur ~2.500
Städte ab (nicht alpin) → für unabgedeckte Regionen bleibt der MapLibre-Boden der Fallback.
Renderer-Landschaft & Begründung: [docs/architecture/renderer-plan.md](docs/architecture/renderer-plan.md).

## Studio

Die Weboberfläche für aufgezeichnete Touren ([studio.html](studio.html), Vite-Einstieg;
Logik in [src/studio/](src/studio/)). Kein Router — Login-, App- und Editor-Ansicht liegen
gleichzeitig im DOM und werden per `hidden` umgeschaltet; der Editor wird lazy importiert,
damit MapLibre nicht ins Basis-Bundle kommt.

Anmeldebühne, Bibliothek, Upload-Befund, Edit-Overlay, Audio-Bibliothek, Ton-Klips und die
gesamte Zeitleiste (Achse in Filmzeit, Klip-Ketten, Zustandsbänder, Abspielen, Undo/Redo)
samt der CSS- und Pointer-Fallen stehen in **[src/studio/CLAUDE.md](src/studio/CLAUDE.md)** —
die Datei lädt automatisch, sobald unter `src/studio/` gearbeitet wird. Was der Server aus
Rohdaten + Overlay macht (Bildfassungen, Gehabschnitte, Pausen-Zeitraffer, Video-Faststart),
steht in **[server/CLAUDE.md](server/CLAUDE.md)**.

## Kontoeinstellungen

Eigene Seite ([konto.html](konto.html) + [src/konto/](src/konto/)), erreichbar über das
Konto-Menü — dort stehen seither zwei Einträge: „Mein Profil" (auf `/@handle`, nicht auf
`/profil`) und „Kontoeinstellungen". Sie liegt NICHT im Studio: Das Studio ist der
Schneideraum, das hier der Ordner mit den Papieren. Rechnende Teile stehen DOM-frei in
[kontomodell.ts](src/konto/kontomodell.ts), die Formulare werden nachgeladen
([kontodialoge.ts](src/konto/kontodialoge.ts)); die Dialogschicht teilt sie sich mit der
Profilseite ([src/dialogschicht.ts](src/dialogschicht.ts)).

Vier Dinge, die man dabei leicht „vereinfacht":

- **Die Adresse wechselt erst nach dem Klick im NEUEN Postfach.** Bis dahin wohnt sie im
  Mail-Token (`mail_tokens.nutzlast`, Zweck `email`) — stünde sie vorher in `users`,
  gehörte das Konto ab dem Absenden einer Adresse, die niemand bestätigt hat. Der Klick
  IST die Bestätigung (kein zweiter Verifikationslauf), der Link zeigt auf
  `/konto#email=<token>` und der Hash wird beim Einlösen sofort aus der Adresszeile
  geräumt. Ist die Adresse schon vergeben, ist die ANTWORT dieselbe wie im Erfolgsfall —
  nur die Mail bleibt aus, sonst wäre die Route eine Auskunft darüber, wer ein Konto hat.
- **Passwort und E-Mail-Wechsel verlangen das aktuelle Passwort.** Eine offene Sitzung
  beweist nur, dass jemand am Gerät saß. Der Passwortwechsel beendet danach alle anderen
  Zugänge (auch die App-Tokens) und behält genau die eigene Sitzung — sonst wirft er einen
  aus der Seite, auf der man gerade steht.
- **„Angemeldete Geräte" sind Sitzungen UND App-Tokens.** Die App meldet sich mit einem
  Token an, nicht mit einer Sitzung; eine Liste nur aus Sitzungen hätte genau das Gerät
  nicht dabei, an das die meisten zuerst denken. Die IDs tragen deshalb ein Präfix
  (`sitzung:` / `app:`). Von der Herkunft wird nur gespeichert, was zum Wiedererkennen
  nötig ist: roher User-Agent (die Deutung „Chrome auf macOS" passiert in
  `kontomodell.ts`, damit eine bessere Deutung keine Migration kostet) und **zwei Oktette**
  der IP. Das steht so auch in [datenschutz.html](datenschutz.html) — wer es erweitert,
  ändert dort eine Zusage.
- **Der Speicherbalken misst am LIMIT, nicht an der Summe**, und die Teile ergeben das
  Belegte (deshalb der Eimer `sonstiges`). Aufgeschlüsselt wird nach Dateiendung, nicht
  nach Ordner — in `media/` liegen Fotos, Videos, Poster und Klänge nebeneinander
  (`artDerDatei` in [server/src/quota.ts](server/src/quota.ts)). Eigene Route und nicht
  Teil von `/auth/me`: Die Aufteilung läuft über alle Dateien aller Touren, `/auth/me` ist
  der heißeste Aufruf der API.

**Der Sichtbarkeits-Schalter steht an ZWEI Stellen** (hier und im Bearbeiten-Modal des
Profils) und ist EIN Zustand — man sucht ihn hier beim Aufräumen und dort beim Bearbeiten;
auseinanderlaufen kann nichts, weil beide dasselbe Feld schreiben.

Noch nicht gebaut (eigene Etappen in
[docs/concepts/konzept_profil_konto.md](docs/concepts/konzept_profil_konto.md)): die
Newsletter-Einwilligung, der ZIP-Datenexport und der Schalter „In Suchmaschinen
erscheinen" — letzterer wäre heute eine Zusage ohne Deckung, weil `profil.html` als
statische Seite ein festes `noindex` trägt.

## Benutzerverwaltung

Eigene Seite ([admin.html](admin.html) + [src/admin/](src/admin/)), nicht Teil des Studios:
Das Studio ist der Schneideraum für Touren, das hier ist Hausverwaltung. Erreichbar über das
Konto-Menü im Studio — der Eintrag erscheint nur für Admins. Rechnende Teile liegen DOM-frei in
[adminmodell.ts](src/admin/adminmodell.ts), Server-Seite in
[server/src/routes/admin.ts](server/src/routes/admin.ts) hinter `erfordereAdmin`.

Die Reiter, das Protokoll und die Dialog-Fallen der Oberfläche stehen in
**[src/admin/CLAUDE.md](src/admin/CLAUDE.md)**; Rollen, Einladungspflicht, Warteliste (DSGVO-
Fristen!) und die System-Mails in **[server/CLAUDE.md](server/CLAUDE.md)**.

**Passwörter werden bewertet, nicht reglementiert.** [passwortstaerke.ts](src/passwortstaerke.ts)
(DOM-frei, getestet) folgt der NIST-Linie: **Länge ist der Hebel**, erzwungene Zeichenklassen
sind es nicht — „Hund!2026" erfüllt jede klassische Regel und ist trotzdem schlecht,
„lampe wolke treppe" erfüllt keine und ist gut. Abzüge gibt es für bekannte Muster,
Tastaturwege, Wiederholungen und alles, was in Name oder E-Mail steht (deshalb bekommt die
Bewertung diese Felder als FUNKTION — sie ändern sich, während das Passwort schon getippt ist).
Bewusst kein zxcvbn: dessen Wörterbücher lägen im Basis-Bundle jeder Anmeldeseite.
[passwortfeld.ts](src/passwortfeld.ts) hängt Balken, Rat und Sichtbarkeits-Schalter an ein
vorhandenes Input (Studio-Registrierung, Passwort-Reset, Admin-Dialog) und bringt sein CSS
selbst mit — sonst stünde derselbe Block in zwei HTML-Dateien und liefe auseinander. Der
Absende-Knopf sperrt erst, wenn tatsächlich etwas Schwaches im Feld steht: Ein von Anfang an
grauer Knopf sähe aus, als wäre das Formular kaputt.

## Android-App

Aufnahme-App unter [android/](android/) (Kotlin, Compose, minSdk 29) — Architektur,
Upload-Fluss und die Fallen (Medien-IDs, Manifest-Unveränderlichkeit, WebView-Session,
Room-Migrationen) stehen in [android/CLAUDE.md](android/CLAUDE.md); die Datei lädt
automatisch, sobald unter `android/` gearbeitet wird.

## Konventionen

- Design / Marke: [`DESIGN.md`](DESIGN.md) — Single Source of Truth für Assistenten und UI.
- `window.__j` bündelt Debug-Handles des Players (`map`, `route`, `tour`, `rider`, `eleReady`
  u.a.); das Studio hat analog `window.__studio` mit den Accessoren `karte()` und `zustand()`.
- Externe Datenquellen brauchen sichtbare Attribution (Esri/Maxar, AWS Terrain) — auch in
  späteren Video-Exporten einbrennen. Siehe [README.md](README.md).
- Neue Tour hinzufügen = neuer Eintrag in `TOURS`; keine Code-Änderung an der Engine nötig.
- **Die besuchten Seiten tragen das Umami-Skript** (`https://analytics.maptale.io/script.js`
  mit `data-website-id`, jeweils Zeile 5 im `<head>`): index, erlebnis, studio, galerie,
  profil, konto (eine gewöhnliche Seite des Produkts — anders als die Verwaltung, die nur
  der Betreiber sieht). **Ohne Tag und zwar absichtlich:** admin (die eigene Verwaltung ist kein Publikum),
  impressum und datenschutz. Wer eine Seite dazunimmt, entscheidet also, in welche Gruppe sie
  gehört — vergessen fällt nicht auf, denn die Seite funktioniert, taucht in der Auswertung
  nur nie auf. Ausgewertet wird im Verwaltungs-Reiter „Statistiken" (natives Dashboard,
  daneben ein Link auf die Umami-Oberfläche). **Die Erhebung ist in
  [datenschutz.html](datenschutz.html) beschrieben** (Abschnitt 2 „Reichweitenmessung",
  dazu Rechtsgrundlage in 3, Cookie-Frage in 8, Empfänger in 9, **Frist 12 Monate** in 10 und
  die WebView-Ausnahme in 7): Wer am Umfang etwas ändert, ändert dort eine Zusage — und die
  12 Monate müssen in Umami auch tatsächlich eingestellt sein, sonst steht dort eine Frist,
  die die Datenbank nicht einhält. Die App misst nur das ABSPIELEN, weil sie den Player als
  WebView lädt; Aufzeichnen und Hochladen laufen an Umami vorbei.

## Medien-Generierung

**Medien werden AUSSCHLIESSLICH über zwei Dienste generiert — keine anderen: Bilder über
fal.ai, Audio über ElevenLabs.** Keine anderen Bild-/Audio-/Video-Generatoren verwenden.
Beide Keys liegen in `.env` (`FAL_KEY`, `ELEVEN_LABS_KEY`) — nur lokal/Dev, nicht in den
Build/das Repo. API-Formen, Generier-Skripte, die kuratierte Studio-Bibliothek
(`public/audio/sfx/`) und die Wiedergabe-Wege im Player beschreibt der Skill
`medien-generierung` ([.claude/skills/medien-generierung/SKILL.md](.claude/skills/medien-generierung/SKILL.md))
— er lädt, sobald Medien erzeugt oder neu generiert werden sollen.
