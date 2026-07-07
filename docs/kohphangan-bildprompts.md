# Koh-Pha-ngan-Tour — Bild-Prompts (10 Foto-Stopps)

Die Fotos unter `public/photos/kohphangan/*.jpg` wurden über **fal.ai**
(`fal-ai/flux/dev`, 3:2 · 1344×896 · JPEG) generiert. **Jedes Foto zeigt exakt den
Ort am GPS-Anker** — Küsten-Anker → Küste, Interior-Anker → Dschungel/Berge, Wasser-Anker
→ Boot/Meer (per Audit gegen echte OSM-Strände/-Piers geprüft; die Boot-Anker liegen exakt
auf der auditierten Wasser-Route).

Tag **2025-05-12** (Vollmond, laut Open-Meteo real verregnet), Timeline 14:00→00:00.
Wetterbogen (kuratiert via `cfg.weather`, weil ERA5 für die Insel nie ein Gewitter
codiert): schwül-bewölkt → Regen → **Gewitter über der Jeep-Bergüberquerung** → Aufklaren
zum Mondaufgang → klare Vollmondnacht. Uhrzeiten sind linear in der Streckenlänge (40 km):
die 17,6 km lange Jeep-Bergstraße verschiebt die zweite Tourhälfte in die Nacht.
Medien-Policy: nur fal.ai (Bild) + ElevenLabs (Audio).

| # | Datei | Ort (Art) | ~Zeit | Wetter |
|---|-------|-----------|-------|--------|
| 1 | `01-thong-sala.jpg` | Thong-Sala-Pier (Küste) | 14:07 | schwül, Sturm zieht auf |
| 2 | `02-baan-tai.jpg` | Haad Baan Tai, Südküste (Küste) | 14:46 | bedeckt, erster Regen |
| 3 | `03-phaeng.jpg` | Nam-Tok-Phaeng-Wasserfall (interior) | 15:46 | Regenguss im Dschungel |
| 4 | `04-dschungelpiste.jpg` | Beton-Steilrampe, Dschungel-Anstieg (interior) | 17:47 | heftiger Regen |
| 5 | `05-bergpiste.jpg` | Bergkamm/Pass der Jeeppiste (interior) | 18:59 | **Gewitter, Blitz**, Dämmerung |
| 6 | `06-thong-nai-pan.jpg` | Thong Nai Pan, Doppelbucht (Küste) | 20:17 | Gewitter durch, Mondaufgang |
| 7 | `07-ostkueste.jpg` | wilde Ostküste vor Than Sadet (Wasser) | 21:24 | klar, Vollmond |
| 8 | `08-longtail.jpg` | Longtail auf dem Golf (Wasser) | 22:32 | klar, Vollmond |
| 9 | `09-vor-haad-rin.jpg` | vor Haad Rin (Wasser) | 23:25 | klar, Vollmond |
| 10 | `10-haad-rin.jpg` | Haad Rin Nok (Küste) | 00:00 | klar, Full Moon Party |

Gemeinsame Vorgaben: **fotorealistisch, Reise-/Landschaftsfotografie, 3:2, keine
Schrift/Logos.** Neu-Generierung: Batch-Treiber `gen_fal2.py` (Scratchpad) bzw. die
Einzel-Treiber `gen_fal_jeep.py`/`gen_fal_tnp.py`/`gen_fal_ost.py`, oder direkt gegen
`https://fal.run/<model>` mit Header `Authorization: Key $FAL_KEY` (Key aus `.env`).

---

**1 — 01-thong-sala.jpg** — Thong Sala ferry pier and harbour on Ko Pha-ngan: wooden longtail boats in grey-green harbour water, shophouses, palms. Hot humid afternoon before a storm, heavy dark grey monsoon clouds massing over the gulf, a distant rain curtain. Wide angle.

**2 — 02-baan-tai.jpg** — Haad Baan Tai beach, south coast: coconut palms leaning over grey sand, choppy grey-green sea, hazy silhouette of Ko Samui on the horizon. Overcast rainy afternoon, first raindrops dimpling the water, low grey sky.

**3 — 03-phaeng.jpg** — Nam Tok Phaeng waterfall deep in the jungle interior, during a heavy tropical downpour: water cascading brown and swollen over granite boulders, dense dripping rainforest, mist and rain, no sky. Moody, saturated.

**4 — 04-dschungelpiste.jpg** — a rugged 4x4 jeep grinding up a steep concrete-plate mountain road climbing into the dense jungle interior, during a heavy tropical monsoon downpour in the late afternoon: reddish-brown puddles and runoff streaming down the steep track, dense dripping emerald rainforest crowding both sides, mist rising from the canopy, low grey overcast light, headlights catching the rain. Adventurous, wet, saturated, wide angle.

**5 — 05-bergpiste.jpg** — a rough muddy 4x4 jeep track over a forested mountain ridge in the interior, during a violent thunderstorm at dusk: a fork of lightning over dark jungle mountains, sheets of rain, the track running with water, headlights in the downpour, near-dark storm sky.

**6 — 06-thong-nai-pan.jpg** — Thong Nai Pan twin bay, NE coast, an hour after a thunderstorm at nightfall: wet sand glistening, a calm dark bay, forested headlands in silhouette, the last storm clouds breaking apart to reveal a rising full moon low over the sea casting a silver path on the water, a faint deep-blue afterglow at the horizon, first stars. Moonlit long exposure.

**7 — 07-ostkueste.jpg** — from the bow of a wooden longtail boat cruising down the wild, remote east coast at night under a bright full moon: calm dark sea with a shimmering silver moon path, black silhouettes of steep jungle-clad coastal mountains flanking both sides, a hidden bay with one or two distant warm lights, a clear starry sky with a few last drifting clouds. Serene, cinematic, moonlit long exposure, wide angle.

**8 — 08-longtail.jpg** — aboard a wooden longtail on the open Gulf at night: bow silhouette, black water, a full moon high through the last clouds, a silver path on the sea, stars, distant dark coast. Moonlit long exposure.

**9 — 09-vor-haad-rin.jpg** — from a longtail approaching the Haad Rin peninsula at night: clear starry sky, bright full moon high over the sea, silver moonlight on calm water, the twinkling lights of Haad Rin ahead. Serene, moonlit.

**10 — 10-haad-rin.jpg** — the Full Moon Party on Haad Rin Sunrise Beach at midnight: crowd, fire dancers and fire shows, colourful neon/UV light, bars and stages, glow sticks, a big full moon over the sea, clear starry sky. Long exposure with fire/light trails.
