# Ideen-Inspiration (Backlog)

Stand: **2026-08-07**. Gesammelt aus einer Ideensession — **nichts davon ist
beschlossen oder spezifiziert**. Die Datei hält Rohideen fest, damit sie nicht
verloren gehen. Was sich lohnt, wird später zu einem eigenen Konzeptpapier
(wie `foto-tour.md`, `editor-ausbau.md`, …).

**Nicht doppelt führen:** Tracker-Integrationen, Foto-Tour ohne GPX, Reisen/
Sammlungen, Editor-Ausbau, Social Login, Play Store, i18n, Newsletter Teil B
und Modi-Konsolidierung haben bereits eigene Dateien unter `docs/concepts/`.
Hier stehen nur Ideen *neben* diesen Papieren.

Prioritäts-Hinweis aus der Session (nur Orientierung, keine Roadmap):

- Mehr fertige, geteilte Touren → Clip-Export, Erste-Tour-Zauber, Kapitel-Scrubber
- Moat gegen Relive → Tracker (eigenes Konzept) + Gemeinsame Fahrt + Offline-Paket
- Studio als Kreativwerkzeug → Editor-Ausbau (eigenes Konzept) + Stimme + Blickziel

---

## 1. Schnell, hoher Hebel

1. **Teilen als Clip** — 15–30 s Auto-Export (Intro → ein Foto-Orbit → Finale)
   als stummes/vertontes MP4 für Stories. Relive gewinnt oft über WhatsApp/
   Instagram, nicht über den Player-Link.
2. **Besucher-Modus mit Kapitel** — Scrubber zeigt benannte Halte („Strand“,
   „Pass“) statt nur km. Wenig UI, viel Orientierung für Fremde.
3. **Erste-Tour-Zauber** — Nach Upload: 3 Defaults (Musik, Tempo, 1 Moment) +
   „Abspielen“ in unter einer Minute. Studio ist mächtig; die erste Belohnung
   muss früher kommen.

## 2. Produkt-Differenzierung

4. **Gemeinsame Fahrt** — Zwei Tracks derselben Tour (Paar, Gruppe) als
   parallele Marker oder „Zusammenführung“. Emotional stark; Alignment über
   Zeit oder Distanz.
5. **Ort als Einstieg** — Galerie nicht nur chronologisch, sondern „Wer war
   hier?“ / Heatmap öffentlicher Touren. Macht `@handle` und öffentliche
   Touren zu einem Netzwerk, nicht nur zu Listen.
6. **Erinnerungs-Jahr** — Einmal im Jahr: „Deine 12 Touren in 3 Minuten“ als
   generierte Montage. Passt zu Newsletter Teil B und vorhandenen Pipeline-
   Assets.

## 3. Studio / Erzählung

Ergänzt [`editor-ausbau.md`](editor-ausbau.md); Leitregel dort gilt auch hier
(benannte Zustände, Freiheit beim Eigenen).

7. **Stimme als Spur** — Kurze Sprachnotizen am Halt (Handy-Mikro), nicht nur
   Musik/SFX.
8. **Blickziel-Pins** — „Schau dorthin“ als benannter Zustand (Gipfel, See),
   nicht freie Kamera. Die Engine kann Blickpunkte; die Studio-UI fehlt.
9. **Wetter-Erzählung umkehren** — Statt nur Historie: kuratierte Stimmung
   („Gewitter-Finale“) als Look, klar als Inszenierung markiert.
10. **Farbgrade-Looks** — Benannte Looks (Amber Dusk, Alpine Cold) über die
    ganze Fahrt.
11. **Schnitt-Vorschläge aus Vision** — Pipeline sieht schon Fotos: „3 starke
    Orbits, 1 streichen“. Assistent, kein Autopilot.
12. **Kapitel-Titel einbrennen** — Kurze Einblendung bei Ortswechsel
    (Nominatim liefert Namen schon).
13. **Ton-Ducking am Halt** — Musik automatisch leiser, wenn Foto/Video/Sprache
    kommt.
14. **Versionen / „Stand von gestern“** — Leichte Edit-History im Studio:
    zurück zur letzten guten Fassung vor dem Experiment.

## 4. Player & Erlebnis

15. **Nachtmodus als Erzählung** — Touren mit `time` schon möglich; als Preset
    „Sonnenuntergang → Sterne“ mit einem Schalter, nicht als Debug-Flag.
16. **Höhe spüren** — Beim Pass/Steilhang subtiler Kamerahub + Wind-SFX,
    gekoppelt an DEM-Gradient.
17. **Stille-Zonen** — Abschnitte ohne Motor/Musik (Kirchplatz, Gipfel) als
    bewusste Pause.
18. **Foto-Reihenfolge neu erzählen** — Chronologie bleibt Default; optional
    „dramaturgisch“ (Weit → Nah → Detail) als Studio-Vorschlag.
19. **Vergleich „Damals / Heute“** — Zweite Aufnahme derselben Route als
    Überlagerung (Opacity/Split). Stark für Wiederholungsfahrer und Städte.
20. **Wetter-Wahrheit vs. Stimmung** — Zwei Ebenen klar trennen: historisch
    (Open-Meteo) und inszeniert. Ehrlichkeit als Marke (hängt mit Idee 9).

## 5. Aufnahme & App

21. **Geister-Aufzeichnung** — App läuft im Hintergrund mit grobem Track; beim
    Öffnen: „Weiterführen oder verwerfen?“ Senkt „Hab ich vergessen zu starten“.
22. **Battery-Budget sichtbar** — Vor Start: geschätzte Stunden bei aktueller
    Genauigkeit.
23. **Smart-Pause lernen** — Längere Café-Stops automatisch als Pause; in der
    App als Vorschlag vor dem Upload (Pipeline kollabiert Pausen schon).
24. **Live-Companion** — Während der Tour ein Mini-HUD: km, Höhe, nächstes
    Foto-Potenzial („gutes Licht in 200 m“).

## 6. Entdecken & Soziales

Ohne Social-Network-Bloat: lesen und teilen vor dem Schreiben-für-Fremde.

25. **Route remixen** — Öffentliche Tour als Vorlage: Track übernehmen, eigene
    Fotos/Musik drauf. Attribution bleibt.
26. **„Eine Stunde in …“** — Kuratierte Kurzfahrten pro Stadt für Touristen,
    die selbst nichts aufzeichnen.
27. **Geschenk-Tour** — Private Tour für eine Person (Token-Link, Ablaufdatum).
    Passt zu `unlisted`, braucht vor allem UX.
27a. **Live mitverfolgen** — Während der App-Aufnahme Link teilen; Zuschauer
    sehen Spur und Fotos in Echtzeit. Ausgearbeitet:
    [konzept_live_mitverfolgen.md](konzept_live_mitverfolgen.md).
28. **Kommentar am Halt** — Kein Feed: maximal eine Zeile pro Foto-Stopp vom
    Besitzer. Fremde lesen, schreiben nicht.

## 7. Wachstum & Geschäftsmodell

Passend zur bestehenden Ethik (keine versteckten Pro-Regler im Editor).

29. **Patron-Profil** — Öffentliches Profil ohne Werbung, höherer Upload,
    eigener Domain-Pfad — klarer als Features im Schneideraum zu sperren.
30. **Druck / Poster** — Route als Linienkunst + ein Foto. Physisches Souvenir,
    einmaliger Kauf.
31. **Embed für Blogs** — `/embed/t_…` schlank (Autoplay-frei, Attribution fest).
32. **White-label für Guides** — Lokale Guides teilen/verkaufen feste Touren an
    Gäste (Quota + minimales Branding).

## 8. Technik & Moat

33. **Offline-Player-Paket** — Eine Tour inkl. Kacheln/Medien als ZIP für
    Flugzeug/Berge. Verwandt mit dem Datenexport, anderer Zweck.
34. **Karten-Qualität als Feature** — Transparent machen, wo Google-3D greift
    und wo MapLibre glänzt. Ehrlichkeit statt „3D überall“.
35. **Kuratierte Starter-Touren pro Region** — Nicht nur Koh Phangan: Referenz-
    fahrten, die den Ton setzen und Upload-Nutzer kalibrieren.
36. **Progressive Kacheln** — Erst grob, dann scharf; Startscreen sofort.
37. **Tour-Integrität** — Signierter Hash über Track+Medien („unverändert seit
    Upload“) — für Journals, Wettbewerbe, Vertrauen.
38. **Barrierefreie Spur** — Audio-Beschreibung der Fahrt („links Tal, rechts
    Grat“) als optionale Spur.

## 9. Kleine Delights

39. **Finale mit Distanz zum Start** — „14 km und 820 Höhenmeter von zu Hause“,
    wenn Start≈Wohnort erkennbar.
40. **Saisonale Galerie** — Im Winter mehr Schnee-Touren oben, im Sommer Alpen/
    Küste — leichte Gewichtung, kein Algorithmus-Theater.
41. **„Erster Schnee / Erste Fähre“** — Persönliche Meilensteine im Profil als
    stille Chronik, nicht als Punktesystem.
42. **Kartografie-Credits als Geschichte** — Das ⓘ-Popup einmal im Jahr als
    kurze „Woher die Welt kommt“-Einblendung — Attribution mit Charakter.

---

## Nächster Schritt

Eine Idee hieraus wird erst dann verbindlich, wenn sie ein eigenes Konzeptpapier
bekommt (Ziel, Nicht-Ziele, Datenmodell, UI-Fallen) und in dieser Datei als
„ausgelagert nach …“ markiert wird — oder gestrichen, wenn sie sich erledigt hat.
