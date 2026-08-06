// Erzeugt die Standard-Titelbilder für die Profilseite über fal.ai (fal-ai/flux/dev).
// Aufruf: node scripts/gen-profil-titelbilder.mjs   (überspringt Vorhandenes)
//
// Warum echte Bilder statt gezeichneter Muster: Die erste Fassung zeichnete die
// Route als ansteigende Linie über einem Raster — das liest sich als Kursdiagramm,
// nicht als Reise. Ein Titelbild soll Fernweh auslösen, und dafür ist ein Foto das
// ehrlichere Mittel.
//
// Breites Banner-Format (3:1). Vier Motive, bewusst verschieden in Landschaft,
// Tageszeit und Farbklima — sie stehen im Dialog nebeneinander und müssen sich auf
// einen Blick unterscheiden. Vier, nicht mehr: Das Raster bleibt zweizeilig, und
// die Wahl soll eine Entscheidung sein, kein Katalog.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'mockups', 'titelbilder')

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = (env.match(/^FAL_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!KEY) { console.error('FAL_KEY fehlt in .env'); process.exit(1) }

// Gemeinsamer Look wie bei den Tour-Fotos: analoger Film, keine HDR-Postkarte.
const FILM =
  'Photorealistic 35mm analog film photograph, Kodak Portra, subtle film grain, natural realistic colours, no text, no watermark, no people in the foreground.'

const BILDER = [
  {
    name: 'serpentinen.jpg',
    prompt: `${FILM} Aerial drone view from high above a mountain pass: a narrow asphalt road winding in tight hairpin serpentines down a steep green alpine slope, patches of pine forest, bare rock ridges in the background, long soft shadows of late afternoon sun, hazy blue mountain layers on the horizon. Wide cinematic panorama.`,
  },
  {
    name: 'kueste.jpg',
    prompt: `${FILM} Aerial view along a coastal road hugging steep cliffs above a turquoise sea, white surf breaking on rocks below, dry golden scrub and a few umbrella pines on the cliff tops, small sandy cove, clear midday Mediterranean light, deep blue water gradient. Wide cinematic panorama.`,
  },
  {
    name: 'nachtstadt.jpg',
    prompt: `${FILM} Night aerial view over a European city from a hill: a dense carpet of warm orange and white city lights, a dark river winding through the centre reflecting bridge lights, illuminated boulevards forming glowing lines, deep blue night sky with faint clouds, distant lit church tower. Long exposure, no light trails of cars, no fireworks. Wide cinematic panorama.`,
  },
  {
    name: 'wueste.jpg',
    prompt: `${FILM} Aerial view of a dusty red dirt track curving through an arid desert plateau, scattered dry shrubs, eroded rock formations casting long shadows, warm low sun near the horizon, dust haze, ochre and rust colours, vast empty landscape. Wide cinematic panorama.`,
  },
]

fs.mkdirSync(OUT, { recursive: true })

for (const bild of BILDER) {
  const ziel = path.join(OUT, bild.name)
  if (fs.existsSync(ziel)) { console.log(`· ${bild.name} — vorhanden, übersprungen`); continue }
  process.stdout.write(`… ${bild.name} `)
  const antwort = await fetch('https://fal.run/fal-ai/flux/dev', {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: bild.prompt,
      image_size: { width: 1440, height: 480 },
      num_inference_steps: 34,
      guidance_scale: 3.5,
      output_format: 'jpeg',
      enable_safety_checker: false,
    }),
  })
  if (!antwort.ok) { console.error(`\nFehler ${antwort.status}: ${await antwort.text()}`); process.exit(1) }
  const daten = await antwort.json()
  const url = daten.images?.[0]?.url
  if (!url) { console.error('\nKeine Bild-URL in der Antwort:', JSON.stringify(daten).slice(0, 400)); process.exit(1) }
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  fs.writeFileSync(ziel, bytes)
  console.log(`→ ${(bytes.length / 1024).toFixed(0)} kB`)
}

console.log('fertig:', OUT)
