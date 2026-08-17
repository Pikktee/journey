---
stand: 2026-08-14
status: teilweise behoben, ein Rest offen
betrifft:
  - src/filmachse.ts
  - src/tour.ts
  - src/geo.ts
---

# Wie schnell sich der Film anfühlt

Aufgekommen beim Abfahren von Paket E (Etappe 4, „Der Antrieb dreht sich um") gegen die
Produktiv-Instanz. Gemeldet an einer Stelle: **Stockholm bei Pseudo-Uhrzeit 11:34** — der
Foto-Halt bei Route-km 4,0 unmittelbar vor der Fähre.

> „Warum geht das nach Einblendung des Fotos so EXTREM SCHNELL los? Die kurze
> Fußgänger-Strecke vor dem Wechsel zum Schiff ist schon sehr schnell, der Anfang der
> Bootsfahrt dann extrem schnell." · „Die Schlenker wirken ziemlich extrem und schnell."

Alles hier ist an dieser einen Stelle gemessen; die Werkzeuge stehen unten.

---

## Was behoben ist (c82e9c8)

Drei Ursachen, alle drei Folgen von Etappe 4, alle drei am selben Ort spürbar.

**1. Die Kurven waren schneller als die Geraden.** Die Achse rechnet in ROHEN
Wegpunkt-Metern, die Kamera fährt auf der gezeichneten Route — Catmull-Rom beult über weite
Stützpunkte aus, und der Überschuss sitzt in den Richtungswechseln. Vorher integrierte die
Engine `s` selbst und lief mit konstant 48 Route-Metern je Sekunde, in der Kurve wie auf der
Geraden. `buildRoute` verdichtet die Stützpunkte jetzt vor der Glättung auf
`STUETZ_MAX_M` = 25 m. **Vom Nutzer bestätigt: „deutlich smoother".**

**2. Die Modus-Rampe lag im falschen Abschnitt.** „Symmetrisch um die Grenze" hieß: die halbe
Rampe im LANGSAMEREN Abschnitt — man ging die letzten 60 m zum Anleger mit anlaufendem
Fährtempo (5,3-Faches des Fußgängertempos, beim Aussteigen 6,6-Faches). Sie liegt jetzt ganz
im schnelleren Abschnitt.

**3. Die Kameradistanz hing an einer eigenen Uhr** (τ = 2,2 s gegen eine Rampe von unter einer
Sekunde). Sie folgt jetzt derselben Rampe, am TEMPO geführt.

Messwerte dazu stehen in der Commit-Nachricht und lassen sich mit
[bildschirmtempo.mjs](../../scripts/messungen/bildschirmtempo.mjs) reproduzieren.

---

## Was NICHT behoben ist

**Der Antritt aus dem Foto-Halt in die Fähre und das Fußgängertempo fühlen sich weiter zu
schnell an.** Das Bildschirm-Tempo (Fahrtempo ÷ Kameradistanz) liegt nach den drei Fixes über
alle drei kuratierten Touren bei höchstens 1,3× des Ruhewerts — die Metrik sagt also „in
Ordnung", das Auge sagt etwas anderes. Daraus folgt: **Die Metrik misst das Falsche, oder
mindestens nicht alles.**

Zwei Kandidaten, beide gemessen, beide noch nicht angefasst:

### A. Die Rampendauer schrumpft mit dem Zieltempo

Die Rampe ist eine feste STRECKE (`RAMPE_M` = 120 m), ihre Dauer also `T = 2L/(v0+v1)` — je
schneller das Ziel, desto kürzer:

| Modus | Halt-Rampe über 120 m | Spitzenbeschleunigung |
|---|---|---|
| zu Fuß (60 m/s) | 4,0 s | 23 m/s² |
| Rad (120) | 2,0 s | 90 m/s² |
| Tram (150) | 1,6 s | 141 m/s² |
| Fähre (300) | **0,8 s** | **562 m/s²** |

Die alte Engine lief mit τ = 1,1 s **unabhängig vom Zieltempo**, brauchte für die Fähre also
rund 3 s. Der Antritt ist heute rund viermal so abrupt — und zwar, ohne dass das
Bildschirm-Tempo überschießt: Es ist die ANSTIEGSZEIT, nicht die Spitze. Genau daran ist eine
frühere Runde vorbeigelaufen, weil sie nur die Spitze gemessen hat.

**Abhilfe-Kandidat:** eine Mindest-Rampendauer (`RAMPE_MIN_S`), die die Rampenstrecke wachsen
lässt, wo 120 m zu schnell durchfahren sind. Zu Fuß und Rad blieben unverändert. Geschätzte
Kosten: +5 bis +7 % Filmdauer auf Touren mit schnellen Modi, nichts auf Radtouren.

### B. Zu Fuß ist der am stärksten geraffte Modus

`MODUS_TEMPO.walk` steht seit dem Rampen-Nachtrag auf 0,5 (60 m/s = 216 km/h):

| Modus | Filmtempo | realistisch | Zeitraffer |
|---|---|---|---|
| **zu Fuß** | 60 m/s | 1,4 m/s | **43×** |
| Fähre | 300 | 8 | 38× |
| Rad | 120 | 5 | 24× |
| Tram | 150 | 7 | 21× |
| Moped | 138 | 11 | 13× |
| Jeep | 174 | 14 | 12× |

Dazu steht `MODE_SCALE.walk` auf 0,5 — zu Fuß ist der einzige Modus, dessen Kamera NÄHER steht
als die Grundeinstellung (360 m statt 720 m). Stärkste Raffung und feinste sichtbare Textur
treffen also zusammen; bei gleicher Winkelgeschwindigkeit sieht feine Textur schneller aus als
grobe. Das erklärt, warum die Fähre mit 38× ruhig wirkt und der Fußweg mit 43× gehetzt.

**Vorsicht bei der Abhilfe:** 0,4 war dem Nutzer ausdrücklich „zu träge" — auf einer LANGEN
Fußstrecke. An der gemeldeten Stelle sind es 588 m zwischen zwei Fotos. Falls beides stimmt,
ist die Antwort nicht eine Zahl, sondern dass kurze Fußstrecken zwischen zwei Halten gar nicht
erst auf volles Tempo kommen sollten.

---

## Was ausdrücklich NICHT die Ursache ist

- **Die Roh-gegen-Route-Streckung** — behoben, s. o., und vom Nutzer bestätigt.
- **Die aufgezeichnete Geschwindigkeit.** Sie steht im GPS-Track, erreicht den Film aber nie:
  `filmsekunden = meter ÷ tempoMs(mode)`, konstantes Tempo je Fortbewegung. Die echte
  Geschwindigkeit geht nur in die EINSTUFUNG ein (`tempo.ts`, `schienen.ts`). Das ist E12/§8C
  und keine Nachlässigkeit — die Alternative wäre, die Achse über der Aufnahmezeit zu
  parametrisieren, was der Player nicht auflösen kann.
- **Die dünne Router-Geometrie der Demo-Touren.** Sie verschärfte Punkt 1, ist aber mit dem
  Vorverdichten strukturell entschärft — auch für Aufzeichnungen, die bei Fährtempo hunderte
  Meter zwischen zwei Punkten haben.

Offen daneben, ohne Bezug zum Tempo: Die Fährlinie von Stockholm hat 31 Punkte auf 19,6 km.
Ob sie an Inseln vorbeischneidet, sieht man erst seit dem Vorverdichten — vorher verdeckte
das der Catmull-Rom-Bogen.

---

## Werkzeuge

| Skript | Was es beantwortet |
|---|---|
| [bildschirmtempo.mjs](../../scripts/messungen/bildschirmtempo.mjs) | Sichtbares ÷ gemeintes Tempo (Kurven-Effekt) und Bildschirm-Tempo (Fahrtempo ÷ Kameradistanz) |
| [filmdauer.ts](../../scripts/messungen/filmdauer.ts) | Filmdauer je Tour, und was eine gestalterische Zahl daran ändert |
| [durchlauf-gegen-achse.mjs](../../scripts/messungen/durchlauf-gegen-achse.mjs) | Deckt sich ein echter Durchlauf mit der Achse? (Abnahme Etappe 4) |
| [rampen-simulation.ts](../../scripts/messungen/rampen-simulation.ts) | Was die Rampen der ALTEN Engine kosteten — die Kalibrier-Grundlage |

**Die Stelle zum Nachfahren:** `/tour/stockholm`, Filmsekunde 74–100 (Pseudo-Uhrzeit 11:20 bis
11:55). Foto-Halt bei km 3,42, Fußweg bis km 4,00, Foto-Halt, dann die Fähre.

**Messfalle:** Die Browser-Pane hat ein 0×0-Viewport, MapLibre lädt dort nicht — jede Messung
läuft über Playwright gegen den devhub-Dev-Server (`http://maptale.localhost:5123`).
