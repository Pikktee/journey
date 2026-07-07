// Generiert einzelne Koh-Pha-ngan-Foto-Stopps neu über fal.ai (fal-ai/flux/dev).
// Anlass: die drei Nacht-Bootsstopps (Wilde Ostküste, Auf dem Golf, Vor Haad Rin,
// ~21:30–23:26, also lange NACH Sonnenuntergang ~18:40) zeigten eine sonnenartige
// Scheibe mit Strahlenkranz/Lens-Flare — laut Captions steht dort aber der VOLLMOND.
// Neu mit klarem, kleinem, hoch stehendem Vollmond, ohne jede Sonnen-Anmutung.
// Aufruf: node scripts/gen-kohphangan-photos.mjs [dateiname.jpg ...]
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'photos', 'kohphangan')

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = (env.match(/^FAL_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!KEY) { console.error('FAL_KEY fehlt in .env'); process.exit(1) }

const NIGHT = 'Photorealistic cinematic travel photograph, natural realistic colours, sharp focus, atmospheric low-light night photography.'
// Kein Sonnen-Look: das war der Fehler der alten Bilder (Strahlenkranz + Flare).
const NO_SUN = 'NO sun, no sunset, no sunrise, no sunburst, no starburst, no star-shaped light rays, no radiating rays, no lens flare, no glare, no bright glowing horizon, no warm orange light. It is the middle of the night.'

const PHOTOS = [
  {
    // Stopp 9 · ~21:30 · Vollmond, dunkle Dschungelberge
    name: '09-ostkueste.jpg',
    prompt: `${NIGHT} POV from the bow of a traditional Thai longtail boat traveling down the wild remote east coast of Koh Phangan at night. Steep black jungle-covered mountains and hidden coves on both sides, calm dark sea. A bright full moon high up in the dark starry night sky — a small crisp clean round moon disc — casting soft silvery moonlight that shimmers in a path across the rippling water. A couple of tiny distant boat lights. Deep dark tropical night, cool blue moonlit tones. ${NO_SUN}`,
  },
  {
    // Stopp 10 · ~22:36 · Vollmond bricht zwischen Wolken durch
    name: '10-longtail.jpg',
    prompt: `${NIGHT} POV from the bow of a traditional Thai longtail boat on the open Gulf of Thailand at night, after the rain has passed. Scattered clouds across the dark night sky with a bright full moon breaking through a gap between the clouds — a small crisp clean round moon disc — its silvery light reflecting on the calm dark water. A faint dark silhouette of a distant island on the right. Deep dark tropical night, cool blue and silver moonlit tones. ${NO_SUN}`,
  },
  {
    // Stopp 11 · ~23:26 · klare Nacht, Mond hoch, Lichter von Haad Rin
    // Große Mondscheibe mit Krater-Struktur statt grellem Punkt → kein Starburst
    name: '11-vor-haad-rin.jpg',
    prompt: `${NIGHT} POV from the bow of a traditional Thai longtail boat approaching Haad Rin on Koh Phangan late at night. A clear dark starry night sky with a clearly visible large round full moon high overhead — a detailed pale grey moon disc with subtle surface craters and maria and only a soft gentle glow around it, definitely NOT a bright point of light. Soft moonlight on the calm sea. Ahead on the right the twinkling lights of the Haad Rin beach town and a dark headland on the horizon. Deep dark tropical night, cool blue moonlit tones. ${NO_SUN} Absolutely no light rays, spikes or starburst emanating from the moon, no diffraction spikes — just a plain smooth glowing round moon disc.`,
  },
]

const MODEL = 'fal-ai/flux/dev'
const gen = async (p) => {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: p.prompt,
      image_size: { width: 1344, height: 896 },
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
  fs.writeFileSync(path.join(OUT, p.name), Buffer.from(await img.arrayBuffer()))
  console.log(`  ✓ ${p.name}  (${(fs.statSync(path.join(OUT, p.name)).size / 1024).toFixed(0)} KB)`)
}

const only = process.argv.slice(2)
const list = only.length ? PHOTOS.filter((p) => only.includes(p.name)) : PHOTOS
console.log(`Generiere ${list.length} Foto(s) → ${OUT}`)
for (const p of list) {
  try { await gen(p) } catch (e) { console.error('  ✗', e.message) }
}
console.log('fertig')
