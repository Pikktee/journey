# Koh-Pha-ngan-Tour — Bild-Prompts (11 Foto-Stopps)

Die Fotos unter `public/photos/kohphangan/*.jpg` wurden über **fal.ai**
(`fal-ai/flux/dev`, 3:2 · 1344×896 · JPEG) generiert. **Jedes Foto zeigt exakt den
Ort am GPS-Anker** — Küsten-Anker → Küste, Interior-Anker → Dschungel/Berge, Wasser-Anker
→ Boot/Meer (per Audit gegen echte OSM-Strände/-Piers geprüft; die Boot-Anker liegen exakt
auf der auditierten Wasser-Route).

Tag **2025-05-12** (Vollmond, laut Open-Meteo real verregnet), Timeline 14:00→00:00.
Wetterbogen (kuratiert via `cfg.weather`, weil ERA5 für die Insel nie ein Gewitter
codiert): schwül-bewölkt → Regen → **Gewitter am Jeep-Aufstieg** → Aufklaren KURZ VOR
Sonnenuntergang (der Grat wird bei ~18:37 im Abendrot überquert) → klare Vollmondnacht.
Uhrzeiten sind linear in der Streckenlänge (42 km): die 17,4 km lange Jeep-Bergstraße
verschiebt die zweite Tourhälfte in die Nacht. Medien-Policy: nur fal.ai (Bild) + ElevenLabs (Audio).

| # | Datei | Ort (Art) | ~Zeit | Wetter |
|---|-------|-----------|-------|--------|
| 1 | `01-thong-sala.jpg` | Thong-Sala-Stadtstrand (Sand, nicht Pier/Wasser) | 14:11 | schwül, Sturm zieht auf |
| 2 | `02-baan-tai.jpg` | Haad Baan Tai, Südküste (Küste) | 15:03 | bedeckt/schwül, noch trocken (Regen setzt kurz danach ein) |
| 3 | `03-phaeng.jpg` | Nam-Tok-Phaeng-Wasserfall (interior) | 16:14 | Regenguss im Dschungel |
| 4 | `04-dschungelbach.jpg` | Bach-Furt der Jeeppiste im Regenwald (interior) | 17:15 | starker Regen |
| 5 | `05-dschungelpiste.jpg` | Beton-Steilrampe, Dschungel-Anstieg (interior) | 18:10 | **Gewitter-Höhepunkt**, heftiger Regen |
| 6 | `06-bergpiste.jpg` | Grat-Hochpunkt der Jeeppiste (interior, ~326 m) | 18:37 | **Gewitter reißt auf**, Abendrot am Sonnenuntergang |
| 7 | `07-thong-nai-pan.jpg` | Thong Nai Pan, Doppelbucht (Küste) | 20:28 | Gewitter durch, Mondaufgang |
| 8 | `08-ostkueste.jpg` | wilde Ostküste vor Than Sadet (Wasser) | 21:32 | klar, Vollmond |
| 9 | `09-longtail.jpg` | Longtail auf dem Golf (Wasser) | 22:37 | klar, Vollmond |
| 10 | `10-vor-haad-rin.jpg` | vor Haad Rin (Wasser) | 23:27 | klar, Vollmond |
| 11 | `11-haad-rin.jpg` | Haad Rin Nok (Küste) | 00:00 | klar, Full Moon Party |

Hinweis (2026-07-07): **Bild 4 `04-dschungelbach` neu** (Foto bei ~17:15 gewünscht, füllte
die Lücke im Jeep-Aufstieg); Bilder 4–10 → 5–11 umnummeriert. **Bild 6 `06-bergpiste` neu
generiert** — das Wetter klart jetzt kurz vor Sonnenuntergang auf (User „zu viel Regen"),
und der Anker wurde auf den ECHTEN Grat-Hochpunkt (~326 m, ~18:37) verschoben: der Pass sitzt
jetzt am Profil-Gipfel und im Abendrot, statt vorher in einer 169-m-Senke mit Gewitter/Blitz.

Gemeinsame Vorgaben: **fotorealistisch, Reise-/Landschaftsfotografie, 3:2, keine
Schrift/Logos.** Neu-Generierung: Batch-Treiber `gen_fal2.py` (Scratchpad) bzw. die
Einzel-Treiber `gen_fal_jeep.py`/`gen_fal_tnp.py`/`gen_fal_ost.py`, oder direkt gegen
`https://fal.run/<model>` mit Header `Authorization: Key $FAL_KEY` (Key aus `.env`).

---

**1 — 01-thong-sala.jpg** — Thong Sala ferry pier and harbour on Ko Pha-ngan: wooden longtail boats in grey-green harbour water, shophouses, palms. Hot humid afternoon before a storm, heavy dark grey monsoon clouds massing over the gulf, a distant rain curtain. Wide angle.

**2 — 02-baan-tai.jpg** — Haad Baan Tai beach, south coast: coconut palms leaning over grey sand, choppy grey-green sea, hazy silhouette of Ko Samui on the horizon. Overcast rainy afternoon, first raindrops dimpling the water, low grey sky.

**3 — 03-phaeng.jpg** — Nam Tok Phaeng waterfall deep in the jungle interior, during a heavy tropical downpour: water cascading brown and swollen over granite boulders, dense dripping rainforest, mist and rain, no sky. Moody, saturated.

**4 — 04-dschungelbach.jpg** (neu 2026-07-07) — a rugged 4x4 off-road jeep fording a swollen muddy jungle stream that floods across a rough track deep in the dense tropical rainforest interior, during a heavy late-afternoon monsoon downpour: reddish-brown churning water rushing over the crossing, the jeep splashing through with headlights on, towering dripping emerald jungle canopy closing overhead, thick mist and rain haze between the trunks, wet glistening foliage, low grey overcast light, moody saturated greens. Cinematic wide travel photograph, photorealistic.

**5 — 05-dschungelpiste.jpg** — a rugged 4x4 jeep grinding up a steep concrete-plate mountain road climbing into the dense jungle interior, during a heavy tropical monsoon downpour in the late afternoon: reddish-brown puddles and runoff streaming down the steep track, dense dripping emerald rainforest crowding both sides, mist rising from the canopy, low grey overcast light, headlights catching the rain. Adventurous, wet, saturated, wide angle.

**6 — 06-bergpiste.jpg** (neu 2026-07-07, Anker auf den echten Grat-Hochpunkt bei ~326 m / ~18:37 verschoben) — a rugged 4x4 jeep on a rough wet concrete-slab mountain track cresting a forested ridge in the tropical island interior at dusk, just after a violent thunderstorm has passed: the heavy storm clouds breaking apart to reveal a glowing band of orange and deep pink sunset afterglow low on the horizon, the wet concrete ramp glistening and mirroring the warm sky, thin streams of water still running across the track, mist and steam rising from the dark green jungle valley far below, distant rain curtains drifting away, first hint of a rising full moon, last warm raking light of sunset, cinematic wide shot, photorealistic.

**7 — 07-thong-nai-pan.jpg** — Thong Nai Pan twin bay, NE coast, an hour after a thunderstorm at nightfall: wet sand glistening, a calm dark bay, forested headlands in silhouette, the last storm clouds breaking apart to reveal a rising full moon low over the sea casting a silver path on the water, a faint deep-blue afterglow at the horizon, first stars. Moonlit long exposure.

**8 — 08-ostkueste.jpg** — from the bow of a wooden longtail boat cruising down the wild, remote east coast at night under a bright full moon: calm dark sea with a shimmering silver moon path, black silhouettes of steep jungle-clad coastal mountains flanking both sides, a hidden bay with one or two distant warm lights, a clear starry sky with a few last drifting clouds. Serene, cinematic, moonlit long exposure, wide angle.

**9 — 09-longtail.jpg** — aboard a wooden longtail on the open Gulf at night: bow silhouette, black water, a full moon high through the last clouds, a silver path on the sea, stars, distant dark coast. Moonlit long exposure.

**10 — 10-vor-haad-rin.jpg** — from a longtail approaching the Haad Rin peninsula at night: clear starry sky, bright full moon high over the sea, silver moonlight on calm water, the twinkling lights of Haad Rin ahead. Serene, moonlit.

**11 — 11-haad-rin.jpg** — the Full Moon Party on Haad Rin Sunrise Beach at midnight: crowd, fire dancers and fire shows, colourful neon/UV light, bars and stages, glow sticks, a big full moon over the sea, clear starry sky. Long exposure with fire/light trails.
