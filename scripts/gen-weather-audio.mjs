// Erzeugt die Wetter-Soundeffekte über die ElevenLabs Sound-Generation-API und legt
// sie als MP3 nach public/audio/ (Vite serviert public/ statisch → /audio/<name>.mp3).
// Einmalig laufen lassen; die MP3s werden eingecheckt, damit die App keinen Key/kein
// Netz zur Laufzeit braucht. Aufruf: node scripts/gen-weather-audio.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'audio')
fs.mkdirSync(OUT, { recursive: true })

// Key aus .env lesen (nicht ausgeben)
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = (env.match(/^ELEVEN_LABS_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!KEY) { console.error('ELEVEN_LABS_KEY fehlt in .env'); process.exit(1) }

const CLIPS = [
  { name: 'rain', dur: 22, loop: true, text: 'Continuous steady rainfall, moderate rain, ambient background sound of rain hitting the ground and water, no thunder, no music, no voices' },
  { name: 'storm', dur: 22, loop: true, text: 'Heavy torrential rainstorm, intense downpour with gusting wind, dense ambient rain, no music, no voices' },
  { name: 'thunder', dur: 8, loop: false, text: 'A single powerful thunderclap with a sharp crack followed by a long deep rumble rolling away into the distance' },
  { name: 'thunder2', dur: 10, loop: false, text: 'Distant thunder rolling slowly across the sky, low deep rumble far away, no rain sound, no music, no voices' },
  { name: 'thunder3', dur: 6, loop: false, text: 'Very close violent thunder strike, sudden sharp loud crack like splitting wood, short tail, no music, no voices' },
  { name: 'wind', dur: 22, loop: true, text: 'Soft cold winter wind blowing gently, calm snowy ambience, light airy whistling, no rain, no music, no voices' },
]

// Bereits erzeugte Dateien nicht neu generieren (Aufruf kostet API-Guthaben);
// gezielt neu erzeugen = Datei vorher löschen.
const missing = CLIPS.filter((c) => !fs.existsSync(path.join(OUT, `${c.name}.mp3`)))

const gen = async (c) => {
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: c.text, duration_seconds: c.dur, prompt_influence: 0.35, loop: c.loop }),
  })
  if (!res.ok) throw new Error(`${c.name}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const file = path.join(OUT, `${c.name}.mp3`)
  fs.writeFileSync(file, buf)
  console.log(`  ✓ ${c.name}.mp3  (${(buf.length / 1024).toFixed(0)} KB)`)
}

if (!missing.length) console.log('alle Clips vorhanden — nichts zu tun')
for (const c of missing) {
  try { await gen(c) } catch (e) { console.error('  ✗', e.message) }
}
console.log('fertig →', OUT)
