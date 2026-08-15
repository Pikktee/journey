# Schnittstellen-Zugänge — wo man sich registriert

Arbeitsliste für die Tracker-Anbindung (`server/src/tracker/`). Sie sagt **nicht**, welcher
Adapter als Nächstes gebaut wird — das steht in
[konzept_tracker_integrationen.md](../concepts/konzept_tracker_integrationen.md), Abschnitt 5
— sondern nur, **wo man den Zugang beantragt und wie weit das ist**.

Der Unterschied ist wichtig, weil beide Seiten verschieden lange dauern: Ein Adapter ist ein
Tag Arbeit, eine Partner-Freigabe kann Wochen liegen oder nie kommen. Deshalb wird der
Zugang **vor** dem Adapter beantragt, nicht danach.

Stand: 2026-08-15.

## Status-Legende

`—` offen · `→` beantragt, wartet · `✓` erteilt · `✗` abgelehnt oder zu

## Die Liste

| ✓ | Anbieter | Zugang beantragen | Modell | Stand |
|---|---|---|---|---|
| [x] | **Polar** | https://admin.polaraccesslink.com | Self-serve mit Polar-Flow-Konto | **✓ erteilt, Adapter live** (`provider/polar.ts`, 2026-08-10) |
| [ ] | **Wahoo** | https://developers.wahooligan.com/applications/new | Sandbox sofort, Produktion nach Review | — |
| [ ] | **Suunto** | https://apizone.suunto.com/how-to-start | Partnerprogramm, Webformular | — |
| [ ] | **Ride with GPS** | https://ridewithgps.com/api | Anfrage per Formular/Mail | — |
| [ ] | **Strava** | https://www.strava.com/settings/api | Self-serve, aber Tier-Modell + Auflagen | — |
| [ ] | **COROS** | api@coros.com (Formalien: [Help-Center](https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application)) | Antrag per Mail, OAuth2 | — |
| [ ] | **komoot** | https://support.komoot.com/hc/en-us/articles/10331570510618-komoot-API | Partner-API, kein Self-serve | — |
| [ ] | **Garmin** | https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/ | Enterprise-Programm | **✗ Formular seit Längerem „Under Construction"** |
| — | SIGMA | — | **kein Entwicklerprogramm** | ✗ existiert nicht |

## Was bei jedem zu beachten ist

**Polar** — erledigt. Jeder Polar-Flow-Nutzer kann sich einen Client anlegen, ohne Antrag und
ohne Wartezeit; das war der Grund, mit Polar anzufangen. Die Rückruf-URLs (Produktion *und*
`localhost` für die Entwicklung) werden auf derselben Admin-Seite gepflegt.

**Wahoo** — zweistufig: Der Sandbox-Client ist sofort da und reicht zum Bauen, die
Produktionsfreigabe ist ein Review. Im Antrag zählt, wie genau man Zweck und angefragte
Scopes beschreibt — Wahoo begrenzt den Zugang ausdrücklich auf Anträge mit erkennbarem
Verwendungszweck. Also erst bauen, dann mit laufendem Beispiel um Produktion bitten.

**Suunto** — Aufnahme ins Partnerprogramm per Webformular, danach Abo der Development-API
(alle Endpunkte, kleinere Kontingente). Kostenlos, aber mit Freigabeschritt.

**Ride with GPS** — kleiner Anbieter, formlose Anfrage, historisch unkompliziert. Kein Push,
also Polling; dafür sauberes JSON/GPX.

**Strava** — der Zugang ist self-serve, die **Auflagen** sind das Thema. Seit dem Update
gilt: Aktivitätsdaten dürfen Fremd-Apps nur *dem Nutzer selbst* zeigen. Für Maptale betrifft
das die öffentliche Galerie und `/@handle` — eine aus Strava importierte Tour öffentlich zu
stellen ist damit womöglich nicht gedeckt. Das ist **vor** dem Adapter zu klären, nicht
danach; sonst steht die Frage erst, wenn Nutzer schon Touren drin haben. Dazu ab Juni 2026
ein Strava-Abo für Standard-Tier-Entwickler.

**COROS** — Antrag per Mail an die Entwickler-Operations, dann Standard-OAuth2. Verlangt
Firmendaten, technische Kontakte und die Redirect-URIs vorab.

**komoot** — es gibt eine vollwertige OAuth2-API auf geplante und aufgezeichnete Touren, aber
**keine Selbstregistrierung**: Client-ID und Secret kommen laut Doku „vom Account Manager".
Das ist eine Geschäftsbeziehung, kein Formular. Seit der Übernahme durch Bending Spoons
(März 2025, danach großer Stellenabbau) ist offen, wie ansprechbar das Programm ist. Anfragen
kostet nichts — einplanen sollte man es nicht.

**Garmin** — kein Weg. Das Zugangsformular steht seit Längerem auf „Under Construction", das
Programm ist ohnehin Enterprise-only. Der vorgesehene Umweg ist **Strava**: Garmin Connect
synchronisiert offiziell und automatisch dorthin, der Nutzer schaltet es einmal ein.
Inoffizielle Bibliotheken (`garth`, `python-garminconnect`) sind seit März 2026 ausgesperrt
und kommen als Produktweg nicht in Frage.

**SIGMA** — es gibt schlicht kein Programm. Die SIGMA Cloud synchronisiert nur zwischen den
eigenen Installationen; die Weitergabe nach außen ist eine feste Zielliste in der
RIDE-App (Strava, komoot u. a.). Dort aufgenommen zu werden hieße, SIGMA zu einem
Produkt-Einbau zu bewegen. Der Weg für SIGMA-Nutzer ist deshalb der **Datei-Weg**: Export aus
der RIDE-App und Teilen nach Maptale (Etappe 2 des Konzepts) — der bedient nebenbei jede Uhr
und jeden Radcomputer, auch die ohne Programm.

## Regel

**Der Datei-Weg macht keinen dieser Anträge überflüssig, aber jeden von ihnen unkritisch.**
Solange FIT/TCX/GPX-Import und der Android-Share-Intent stehen, ist kein Nutzer ausgesperrt,
wenn ein Antrag liegen bleibt — die Anbindung erspart ihm den Handgriff, sie ist nicht die
Bedingung.
