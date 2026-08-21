---
stand: 2026-08-21
status: Entwurf, nichts gebaut
betrifft:
  - src/studio/map-mood.ts
  - src/studio/editor.ts
  - src/daynight.ts
  - src/weather.ts
icon: kamera
---

# Konzept: Stimmung und Wetter im Editor

**Ziel:** Die Editor-Karte zeigt, was der Film zeigt. Wer eine Nachtfahrt schneidet,
sieht sie nachts, und wer Regen gesetzt hat, sieht ihn.

Dieses Blatt ist E7 aus dem [Gleichlauf-Konzept](../archive/konzept_gleichlauf_player_editor.md).
Der Plan dort ist abgearbeitet, dieser Teil war nie gebaut; er steht seither
allein und wurde beim Archivieren herausgelöst, damit er nicht mit ins Archiv fällt.

## Der Befund

**„Grading" ist der Mechanismus, Tag/Nacht die Ursache.** Der Zyklus wird als Farbkorrektur
auf die Satellitenkacheln gerechnet: Helligkeit, Sättigung, Kontrast. Dieser Teil trägt auch
auf einer Draufsicht. Licht (`setLight`) und Himmel (`setSky`) tragen nicht: Das eine braucht
Gelände, das andere einen Horizont.

**Der Editor sagt beides längst, er zeigt es nur nicht.** Es gibt eine Wetter-Bahn mit Modus
und Stärke und ein Tageszeit-Symbol im Pult, beides ohne Entsprechung auf der Karte.

## Der erste Schritt

**Der billigste erste Schritt ist nicht das Partikel-Overlay, sondern das Raster-Grading:**
`raster-brightness-*`, `raster-saturation`, `raster-contrast` aus `paramsAt` auf den
`'sat'`-Layer, dazu ein flacher Overcast-`fillRect`. Kamerafrei, **ein Paint je Änderung statt
einer dauerhaften rAF-Schleife**.

## Vier Dinge, die man dabei falsch annimmt

1. **`createWeather` ist NICHT ohne Änderung übertragbar.** Es nimmt zwar nur ein
   `HTMLElement`, verdrahtet aber `window.innerWidth/innerHeight` fest, und die Regeln von
   `#weather` stehen in [style.css](../../src/style.css), die [studio.html](../../studio.html)
   gar nicht lädt. Es braucht `getBoundingClientRect()`, einen `ResizeObserver` und die
   Regeln: rund 10 Zeilen.
2. **`daynight.ts` ist nicht teilbar, wie es ist.** Es schreibt direkt in die Karte
   (`setPaintProperty` auf Layer `'satellite'`; der Editor-Layer heißt `'sat'`). Der
   wiederverwendbare Kern ist `paramsAt(alt)`, und der ist **nicht exportiert** (der Typ schon).
3. **Die Performance-Sorge hat eine eingebaute Antwort.** `weather.setGate(fn)` friert das
   Overlay komplett ein, mit fertiger Blende ins Standbild. An „Abspielkopf wird gezogen"
   gehängt, kostet es während des Zugs **nichts**: Das 5,5-ms-Ziehbudget bleibt unberührt.
4. **Das Tageszeit-Symbol nutzt bewusst eine Stunden-Heuristik**, nicht `sunPosition`, mit
   begründetem Kommentar. Nur anfassen, wenn die Karte ohnehin Grading bekommt.

## Offen

- **Steht der Wetter-Schalter im Editor anfangs an oder aus?** Aus wäre ruhiger beim
  Schneiden, an wäre ehrlicher zum Film.
- **Zieht das Tageszeit-Symbol nach?** Mit echtem Grading daneben ist die Begründung für die
  Stunden-Heuristik schwächer.
