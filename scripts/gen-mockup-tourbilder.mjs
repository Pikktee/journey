// Vorschaubilder für die Tour-Karten im Profil-Mockup.
// Aufruf: node scripts/gen-mockup-tourbilder.mjs
//
// Zwei der drei Touren gibt es im Projekt wirklich — deren Vorschau wird aus
// den vorhandenen Foto-Stopps kopiert und auf Kartenbreite verkleinert, statt
// neue Bilder zu erfinden. Nur für die Lissabon-Tour (im Mockup erfunden)
// entsteht ein neues Bild über fal.ai.
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'mockups', 'tourbilder')
fs.mkdirSync(OUT, { recursive: true })

// — 1. Aus dem Bestand: verkleinerte Kopien (Karten sind ~340 px breit) —
const KOPIEN = [
  { von: 'public/photos/kohphangan/09-ostkueste.jpg', nach: 'kohphangan.jpg' },
  { von: 'public/photos/stockholm/kastell.jpg', nach: 'stockholm.jpg' },
]
for (const k of KOPIEN) {
  const ziel = path.join(OUT, k.nach)
  if (fs.existsSync(ziel)) { console.log(`· ${k.nach} — vorhanden`); continue }
  fs.copyFileSync(path.join(ROOT, k.von), ziel)
  // sips liegt auf jedem Mac bei; 720 px Breite reicht für 2× Retina.
  execFileSync('sips', ['-Z', '720', '-s', 'formatOptions', '72', ziel], { stdio: 'ignore' })
  console.log(`✓ ${k.nach} — aus ${k.von} (${(fs.statSync(ziel).size / 1024).toFixed(0)} kB)`)
}

// — 2. Neu über fal.ai: die erfundene Lissabon-Tour —
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = (env.match(/^FAL_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!KEY) { console.error('FAL_KEY fehlt in .env'); process.exit(1) }

const FILM =
  'Photorealistic 35mm analog film photograph, Kodak Portra, subtle film grain, natural realistic colours, candid documentary travel snapshot, no text, no watermark.'

const NEU = [
  {
    name: 'lissabon.jpg',
    prompt: `${FILM} A classic yellow Lisbon tram (line 28) climbing a narrow steep cobbled street in Alfama, worn pastel-coloured houses with azulejo tiles and small iron balconies on both sides, laundry hanging above, overhead tram wires, warm late afternoon sunlight raking down the hill. Eye-level street view.`,
  },
]

for (const bild of NEU) {
  const ziel = path.join(OUT, bild.name)
  if (fs.existsSync(ziel)) { console.log(`· ${bild.name} — vorhanden`); continue }
  process.stdout.write(`… ${bild.name} `)
  const antwort = await fetch('https://fal.run/fal-ai/flux/dev', {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: bild.prompt,
      image_size: { width: 1024, height: 640 },
      num_inference_steps: 34,
      guidance_scale: 3.5,
      output_format: 'jpeg',
      enable_safety_checker: false,
    }),
  })
  if (!antwort.ok) { console.error(`\nFehler ${antwort.status}: ${await antwort.text()}`); process.exit(1) }
  const daten = await antwort.json()
  const url = daten.images?.[0]?.url
  if (!url) { console.error('\nKeine Bild-URL:', JSON.stringify(daten).slice(0, 300)); process.exit(1) }
  fs.writeFileSync(ziel, Buffer.from(await (await fetch(url)).arrayBuffer()))
  execFileSync('sips', ['-Z', '720', ziel], { stdio: 'ignore' })
  console.log(`→ ${(fs.statSync(ziel).size / 1024).toFixed(0)} kB`)
}

console.log('fertig:', OUT)
