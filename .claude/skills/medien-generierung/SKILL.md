---
name: medien-generierung
description: Bilder (fal.ai) und Audio (ElevenLabs) für Maptale erzeugen — API-Formen, Generier-Skripte, Studio-Bibliothek (mus-/amb-/sfx-Dateien) und Wiedergabe-Wege im Player. Nutzen, wenn Tour-Fotos, Musik, Atmosphären, Effekte oder Motorloops generiert oder neu erzeugt werden sollen.
---

# Medien-Generierung

**Grundregel (gilt immer, auch ohne diesen Skill): Medien werden AUSSCHLIESSLICH über
fal.ai (Bilder) und ElevenLabs (Audio) generiert — keine anderen Dienste.** Beide Keys
liegen in `.env` (`FAL_KEY`, `ELEVEN_LABS_KEY`) — nur lokal/Dev, nicht in den Build/das Repo.

- **Bilder** (Foto-Stopps etc.): **fal.ai**. HTTP-API `https://fal.run/<model>` mit
  Header `Authorization: Key $FAL_KEY`; Standardmodell `fal-ai/flux/dev`, Seitenverhältnis
  3:2 (`image_size` `{width:1344,height:896}`), `output_format: 'jpeg'`. Fotorealistische,
  auf Ort/Uhrzeit/Wetter des jeweiligen Anker-Punktes abgestimmte Prompts.
- **Audio** (TTS, Wetter-Sounds, Fahrgeräusche, Hintergrundmusik): **ElevenLabs**.
  Wetter-SFX via Sound-Generation-API ([scripts/gen-weather-audio.mjs](../../../scripts/gen-weather-audio.mjs)),
  Fahrzeug-Motorloops ebenso via Sound-Generation
  ([scripts/gen-vehicle-audio.mjs](../../../scripts/gen-vehicle-audio.mjs) — Moped, Jeep und Boot als
  `eng-moped/eng-jeep/eng-boat.mp3`; das Auto ist auskommentiert), Ambient-Musik via Music-API
  `POST /v1/music` `{prompt, music_length_ms}`
  ([scripts/gen-music.mjs](../../../scripts/gen-music.mjs) → `public/audio/ambient.mp3`).

**Die kuratierte Studio-Bibliothek** (Musik & Effekte) kommt aus denselben zwei APIs und
liegt komplett unter `public/audio/sfx/`: zehn Musikstücke à 100 s via Music-API
([scripts/gen-music-library.mjs](../../../scripts/gen-music-library.mjs), `mus-*.mp3`), zehn
Atmosphären-Loops und acht Einzeleffekte via Sound-Generation
([scripts/gen-sfx-library.mjs](../../../scripts/gen-sfx-library.mjs), `amb-*`/`sfx-*`). Katalog
(Anzeige + Dateinamen) ist `src/studio/sfxbibliothek.ts`, die Prompts stehen in den
Skripten; ein Drift-Wächter hält beide Seiten synchron und prüft, dass jede Katalogdatei
wirklich existiert. Beide Skripte überspringen Vorhandenes — gezielt neu erzeugen heißt:
Datei vorher löschen.

**Wiedergabe-Wege im Player:** Loops laufen nahtlos über den Crossfade-Wrapper
`src/audioloop.js` (`SeamlessLoop`), die Hintergrundmusik über `src/music.js`
(Dock-Toggle; entfällt, wenn die Tour eigene Musik in `cfg.audio` mitbringt), die
Motorloops über `src/vehicle.js` (`MODE_SOUND` — `moped`/`jeep`/`ferry`;
`walk`/`bike`/`tram` sind lautlos) — folgt `ui.onModeChange`, läuft nur während der Fahrt
(Gate in main.js).
