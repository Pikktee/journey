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
    // ~13:03, leichter Regen
    name: 'saltsjon.jpg',
    prompt: `${FILM} View from the stern of a ferry looking back at the Stockholm skyline receding across the water: the City Hall tower, church spires, and the Gröna Lund Ferris wheel on the right, a churning white wake trailing behind, seagulls following the boat. Early afternoon in light rain, overcast grey sky, hazy rainy atmosphere, rain drizzle over the water, wet desaturated muted colours, dull flat light, NO sun, no golden light. Moody.`,
  },
  {
    // ~13:52, leichter Regen
    name: '03-schaeren.jpg',
    prompt: `${FILM} View from a ferry deck over the Stockholm archipelago: a classic red wooden cottage with white trim on a rocky pine-covered islet on the left, small rocky skerries, a Swedish flag on the boat's stern railing, white wake in the water. Early afternoon in light rain, grey overcast sky, damp misty rainy atmosphere, wet dark rocks, drizzle, muted cool desaturated colours, dull flat light, NO sun, no blue sky.`,
  },
  {
    // ~17:33, Regen / Niesel
    name: 'hoggarnsfjarden.jpg',
    prompt: `${FILM} Open archipelago water seen through a ferry's window frame, a single white sailing yacht heeling in the breeze, low rocky pine-covered islands on the horizon, choppy grey-green water. Late afternoon in steady rain, overcast leaden grey sky, rainy hazy atmosphere, rain streaks, wet muted desaturated colours, dull light, NO sun, no blue sky, no fair-weather clouds. Moody and grey.`,
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
