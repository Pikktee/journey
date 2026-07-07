// Generiert einzelne Stockholm-Foto-Stopps neu über fal.ai (fal-ai/flux/dev), damit
// Tageszeit und Wetter des Bildes zum Zustand der Animation an diesem Streckenpunkt
// passen (die Tour „stockholm" läuft 09:30→23:00, Auto-Wetter: vormittags bedeckt,
// mittags/nachmittags Regen, nachts in Vaxholm dunkel). Die Kompositionen bleiben wie
// gehabt (Foto-Anker/Captions in tours.js unverändert) — nur Licht/Himmel/Nässe ändern.
// Aufruf: node scripts/gen-stockholm-photos.mjs  (überschreibt public/photos/stockholm/*)
// Nur die unten gelisteten Dateien werden erzeugt; die beiden Vasa-Innenaufnahmen
// (02-vasa, vasa-heck) bleiben unangetastet (Innenraum → Wetter/Zeit irrelevant).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'photos', 'stockholm')

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = (env.match(/^FAL_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!KEY) { console.error('FAL_KEY fehlt in .env'); process.exit(1) }

// Gemeinsamer Look, damit die neuen Bilder zu den vorhandenen (analoger Film) passen.
const FILM = 'Photorealistic 35mm analog film photograph, Kodak Portra, subtle film grain, natural realistic colors, candid documentary travel snapshot, sharp focus.'

const PHOTOS = [
  {
    // ~10:08, bewölkt (~70 %)
    name: 'kungstradgarden.jpg',
    prompt: `${FILM} Kungsträdgården park in central Stockholm on a mid-morning. A wide tree-lined gravel promenade with rows of leafy linden trees, an ornate cast-iron tiered fountain splashing in the centre, elegant pavilion cafés with striped awnings on both sides, people sitting on green park benches. Heavily overcast grey cloudy sky, soft flat diffuse daylight, NO sun, no sunbeams, no lens flare, no long shadows, cool muted late-summer colours, dry pavement. Eye-level view down the promenade.`,
  },
  {
    // ~10:53, stark bewölkt (~84 %)
    name: 'strandvagen.jpg',
    prompt: `${FILM} View from inside a moving vintage blue Stockholm tram (Djurgårdslinjen line 7) looking out through the window along Strandvägen boulevard: grand ornate 19th-century facades on the left, a tall wooden sailing schooner moored at the stone quay on the right, calm harbour water. Late morning under a completely overcast leaden grey sky, soft flat diffuse light, NO sun, no blue sky, no sunlight on the buildings, muted cool colours.`,
  },
  {
    // ~11:43, bewölkt — WICHTIG: Spätsommertag (24. Aug), nicht Winter
    name: 'grona-lund.jpg',
    prompt: `${FILM} The Djurgården waterfront promenade at the Gröna Lund amusement park in Stockholm on a late-August summer day. A tall red steel drop-tower and roller-coaster structure, a colourful ornate illuminated "Gröna Lund" entrance sign, crowds of people in light summer clothes, t-shirts and shorts, strolling along the quayside, a white excursion steamer moored on the right by the water. Lush green leafy summer trees in full foliage. Flat overcast grey cloudy sky, soft diffuse light, NO sun, no blue sky, muted colours, dry ground. Warm humid overcast summer day. No bare trees, no autumn, no winter coats, no snow.`,
  },
  {
    // ~13:03, Regen — kräftiger, sichtbarer Niederschlag (Einschlagsringe + Schleier)
    name: 'saltsjon.jpg',
    prompt: `${FILM} View from the open stern deck of a ferry looking back at the Stockholm skyline receding across the water in HEAVY RAIN. The entire water surface is covered with countless splashes and concentric ripple rings from heavy falling raindrops, dense diagonal streaks of rain fill the whole frame, a thick grey curtain of pouring rain almost hides the distant City Hall tower and the Gröna Lund Ferris wheel, a wet dripping deck railing in the foreground, dark low rain clouds, desaturated grey-green colours, dull flat light. It is visibly raining hard. NO sun, no dry weather, no blue sky.`,
  },
  {
    // ~13:52, Regen — Regenstriche vor den dunklen Kiefern sichtbar (Kontrast-Trick)
    name: '03-schaeren.jpg',
    prompt: `${FILM} View from a ferry deck over the Stockholm archipelago in HEAVY POURING RAIN. A classic red wooden cottage on a rocky islet with dark green pine trees on the left. Bright silvery streaks of heavy rain are clearly visible falling diagonally across the whole frame, standing out sharply against the dark pine trees; the water surface in the foreground is covered with splashes and concentric ripple rings from the pounding rain; a dripping wet Swedish flag on the boat's stern railing; a grey curtain of rain hazes the far islands. Dark low rain clouds, wet glistening rocks, desaturated cool colours, dull light. It is unmistakably raining hard. NO sun, no dry weather, no blue sky.`,
  },
  {
    // ~17:33, Regen — durch die nasse Scheibe, Tropfen am Glas
    name: 'hoggarnsfjarden.jpg',
    prompt: `${FILM} View through a rain-covered ferry window in heavy steady rain: the glass streaked with running raindrops and rivulets of water, beyond it the open archipelago with a single white sailing yacht heeling in the breeze, low rocky pine-covered islands on the horizon, choppy grey-green water. Clearly visible falling rain streaks outside, water droplets and trickles blurring the window glass, dark leaden grey overcast rain clouds, wet muted desaturated colours, dull light. NO sun, no blue sky, no fair-weather clouds, no dry weather. Very rainy and wet.`,
  },
  {
    // ~22:15, Nacht (Sonnenuntergang war ~20:07), leicht bewölkt
    name: 'kastell.jpg',
    prompt: `${FILM} Low-light NIGHT photograph. Vaxholm Fortress, a round grey stone citadel, seen through a gap in an old rough stone rampart wall in the foreground, a small motorboat with navigation lights passing on the dark water of the sound. Late night, deep dark blue night sky with only a faint pale afterglow low on the northern horizon, the fortress dimly lit by warm floodlights, boat lights reflecting on the near-black rippling water, calm cool nocturnal atmosphere. NO sun, no daylight, no sunset, no golden hour, no warm sunlight.`,
  },
  {
    // ~22:45, Nacht, leicht bewölkt
    name: '04-vaxholm.jpg',
    prompt: `${FILM} Low-light NIGHT photograph. The Vaxholm waterfront at night: a row of pastel-coloured wooden boathouses along a wooden pier, small boats moored, warm glowing window lights and pier lanterns reflecting in the calm dark water, the dim silhouette of Vaxholm fortress across the sound in the background. Late night, deep dark blue night sky, quiet and still, only warm artificial lights illuminating the scene. NO sun, no daylight, no sunset, no golden hour, no orange sky.`,
  },
]

const MODEL = 'fal-ai/flux/dev'
const gen = async (p) => {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: p.prompt,
      image_size: { width: 1344, height: 896 }, // 3:2
      num_inference_steps: 34,
      guidance_scale: 3.5,
      output_format: 'jpeg',
      enable_safety_checker: false,
    }),
  })
  if (!res.ok) throw new Error(`${p.name}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const url = data.images?.[0]?.url
  if (!url) throw new Error(`${p.name}: keine Bild-URL in Antwort`)
  const img = await fetch(url)
  const buf = Buffer.from(await img.arrayBuffer())
  fs.writeFileSync(path.join(OUT, p.name), buf)
  console.log(`  ✓ ${p.name}  (${(buf.length / 1024).toFixed(0)} KB)`)
}

const only = process.argv.slice(2) // optional: nur bestimmte Dateinamen neu erzeugen
const list = only.length ? PHOTOS.filter((p) => only.includes(p.name)) : PHOTOS
console.log(`Generiere ${list.length} Foto(s) → ${OUT}`)
for (const p of list) {
  try { await gen(p) } catch (e) { console.error('  ✗', e.message) }
}
console.log('fertig')
