# Messungen: Bild, Ton und Filmzeit

Werkzeuge, mit denen die Befunde in
[konzept_gleichlauf_player_editor.md](../../docs/concepts/konzept_gleichlauf_player_editor.md)
entstanden sind. Sie gehören ins Repo, weil das Konzept **Abnahmekriterien** nennt, die man
ohne sie nicht prüfen kann („Fertig, wenn bei 6× CPU-Drosselung `Δs ÷ Tempo` sich mit
`Δ audio.currentTime` auf ±2 % deckt").

Sie sind kein Teil von Build oder Testlauf — sie messen einen laufenden Dev-Server bzw.
lesen die gerenderten Touren der lokalen Instanz.

## Fünf Fallen, die jede Messung hier wertlos machen

Sie haben beim ersten Mal drei Anläufe gekostet. Wer sie nicht kennt, misst etwas anderes,
als er glaubt — und merkt es nicht, weil das Ergebnis plausibel aussieht.

1. **`chrome-headless-shell` drosselt `requestAnimationFrame`.** Playwrights Standard-
   Headless ist die Shell, und dort lief die Tour rund **20× zu langsam**. Deshalb starten
   die Browser-Skripte mit `channel: 'chromium'` (volles Headless). Wer das ändert, misst
   die Bildrate des Messaufbaus statt die des Players.
2. **Der `dt`-Deckel verfälschte genau das, was man messen will** — bis Etappe 1. `tour.ts`
   rechnete `dt = Math.min((now - lastT) / 1000, 0.05)`; jede Messung, die die Fortbewegung
   der Engine gegen die Wanduhr hielt, maß damit den Deckel mit. Seit v0.62.0 zählt
   [src/filmuhr.ts](../../src/filmuhr.ts) echte Frame-Zeit, und der Notdeckel dort liegt bei
   1,0 s — weit über jedem Frame, das eine Drosselung erzeugt. Wer misst, sollte trotzdem
   `window.__j.uhr.verworfenS` mitlesen: Ist die Zahl > 0, hat der Aufbau ausgesetzt (und
   nicht bloß gestockt), und die Messung wertet einen anderen Vorgang.
   Für die Rampen wurde die Geschwindigkeitslogik in Node nachgebildet
   ([rampen-simulation.ts](rampen-simulation.ts)) statt im Browser gemessen — das bleibt
   richtig, dort geht es um die Form der Kurve, nicht um die Uhr.
3. **Der Browser-Pane der Entwicklungsumgebung hat ein 0×0-Viewport**, `rAF` feuert dort
   gar nicht und MapLibre lädt nie. Er taugt für DOM-Zugriffe auf eine ANGEMELDETE Sitzung,
   nicht für Optik oder Timing.
4. **Synthetische Klicks erzeugen keine User-Activation.** `el.click()` aus einem Skript
   lässt unmuted-Autoplay geblockt — das Video läuft dann stumm über den Rückfall, und man
   misst „kein Ton", wo Ton wäre. Entweder mit
   `--autoplay-policy=no-user-gesture-required` starten (so machen es die Skripte hier)
   oder mit echten Eingabe-Ereignissen arbeiten.
5. **`page.bringToFront()` erzeugt in Headless KEINEN Hintergrund.** Eine zweite Seite nach
   vorn zu holen sieht aus wie ein Tab-Wechsel, liefert aber weder `visibilitychange` noch
   hält es die rAF-Kette an: Die Uhr wurde in einem so gebauten Lauf nie pausiert
   (`window.__j.uhr.pausen === 0`) und beide Vergleichsläufe kamen erwartungsgemäß gleich
   heraus — gemessen wurde nichts. Der Hintergrund muss hergestellt werden: **erst** die
   rAF-Kette kappen (`window.requestAnimationFrame` ersetzen), **dann**
   `visibilityState: 'hidden'` samt Ereignis. Die Reihenfolge ist Teil der Falle — läuft rAF
   weiter, hebt die Selbstheilung der Uhr die Pause nach zwei Frames wieder auf (das ist so
   gewollt, s. `src/filmuhr.ts`, macht die Messung aber wertlos).
   `hintergrund-versatz.mjs` macht es richtig; wer selbst misst, prüft `pausen` und
   `pausiertS` als Kontrolle, dass der Hintergrund überhaupt eingetreten ist.

Ein Kniff daneben, der keine Falle ist, sondern nützlich: Um eine Aufnahme im Editor zu einem
**Video** zu machen, ohne Server-Daten anzufassen, lässt sich die Antwort von
`/api/tours/:id/editor` clientseitig umschreiben (`window.fetch` patchen bzw. Playwright-
`route`). So wurde der Video-Ton im Studio geprüft, obwohl keine lokale Tour ein Video hat.

## Voraussetzungen

Playwright ist **keine** Abhängigkeit dieses Projekts. Die Browser-Skripte lösen es über
`PLAYWRIGHT` auf (sonst über den normalen Modulpfad):

```bash
PLAYWRIGHT=/pfad/zu/node_modules/playwright/index.mjs node scripts/messungen/frame-verlust.mjs 6
```

Der Dev-Server läuft über `devhub` (nicht selbst starten); die Adresse kommt aus
`MAPTALE_WEB`, Vorgabe `http://maptale.localhost:5123`. Die Daten-Skripte lesen
`server/daten/tours`, umlenkbar über `MAPTALE_DATEN_DIR`.

## Die Skripte

| Datei | Was sie misst | Aufruf |
|---|---|---|
| [bild-gegen-tonuhr.mjs](bild-gegen-tonuhr.mjs) | Wie weit die Bilduhr der Engine unter Last von der Echtzeit-Uhr des Tons abweicht. **Abnahmekriterium für Etappe 1.** Wertet nur stetige Fahrt (Halte und Rampen ausgeschlossen). | `node … 6` (CPU-Drosselung) |
| [frame-verlust.mjs](frame-verlust.mjs) | Den Mechanismus dahinter: Frame-Abstände derselben rAF-Kette, Anteil über dem 50-ms-Deckel, verworfene Zeit. | `node … 12` |
| [hintergrund-versatz.mjs](hintergrund-versatz.mjs) | Was der Drosselungs-Lauf NICHT sieht: den Versatz zwischen Bild und Ton nach einer Zeit im Hintergrund. Läuft zweimal — einmal wie ausgeliefert, einmal mit überschriebenem `uhr.laeuft` (das Gate-Verhalten vor dem Nachtrag) — und zeigt so die Wirkung statt nur den Zustand. | `node …` |
| [rampen-simulation.ts](rampen-simulation.ts) | Anfahr-/Ausrollkosten je Halt — die Geschwindigkeitslogik in Node nachgebildet, festes `dt`. Vergleicht Player-Dauer gegen Studio-Filmzeit je Tour. | `npx tsx …` |
| [routen-laenge.ts](routen-laenge.ts) | Wie viel länger `route.total` (Catmull-Rom + 14-m-Resample) gegenüber der Rohgeometrie ist, in der der Server `f` misst. | `npx tsx …` |
| [anker-versatz.ts](anker-versatz.ts) | Den Rest, den keine Uhr behebt: Server-`f` gegen Player-`frac` am selben physischen Punkt, in Filmsekunden. Zuordnung **monoton**, sonst schnappt eine sich kreuzende Route auf den falschen Vorbeigang. | `npx tsx …` |

Die `.ts`-Skripte importieren `src/geo.ts` und laufen deshalb über `tsx`, nicht über `node`.

## Messwerte vom 12. August 2026

Als Bezugspunkt — wer etwas ändert, sollte gegen diese Zahlen prüfen. Herleitung und
Einordnung stehen im [Konzept](../../docs/concepts/konzept_gleichlauf_player_editor.md), §4.

| Messung | Ergebnis |
|---|---|
| Bilduhr bei 1× / 6× / 12× Drosselung | 99,7 % / 81,3 % / 46,1 % der Echtzeit |
| Verworfene Zeit durch den 50-ms-Deckel | 0 % / 5,0 % / 35,3 % |
| Player gegen Studio-Filmzeit | +9,1 % … +12,7 % (vier Touren) |
| davon Rampen je Stopp | 0,44 s (Kurztour) … 2,70 s |
| `route.total` gegen Rohgeometrie | +2,18 % … +3,04 % |
| Anker-Versatz, Median / p90 | 0,03–0,70 s / 0,05–0,88 s |

**Nach Etappe 1 (13. August 2026, „eine Uhr"):** dieselbe Messung, dieselbe Tour —
**99,8 % / 99,7 % / 99,6 %** (eine Messreihe, 1× / 6× / 12×; Einzelläufe streuen um ein
knappes Prozent). Die Bildrate fällt unverändert (60 → 31 → 19 fps): Das Gerät lässt jetzt
Bilder aus, statt die Tour zu verlangsamen.

Der fehlende Rest ist **nicht verlorene Zeit** — `verworfenS` bleibt 0 —, sondern das
Messfenster selbst: Es lässt bis 3 % Untertempo zu (`speed > ziel * 0.97`), und die
gewerteten Intervalle liegen im Mittel etwas unter dem Ziel.

Und **6 s Hintergrund** ([hintergrund-versatz.mjs](hintergrund-versatz.mjs)) ergeben 0 m
Versatz im Bild UND +0,00…0,01 s im Ton, der dort pausiert steht. Die Gegenprobe mit dem
alten Gate-Verhalten, nur `uhr.laeuft` überschrieben: **+6,01 s** — der Ton lief die volle
Abwesenheit weiter, dauerhaft (die Position wird nur beim Eintritt in einen Bereich
gesetzt).
