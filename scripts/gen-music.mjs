// Erzeugt das unaufdringliche Hintergrund-Ambient (läuft während der Track-Animation)
// über die ElevenLabs Music-API und legt es als public/audio/ambient.mp3 ab.
// Einmalig laufen lassen; die MP3 wird eingecheckt (App braucht zur Laufzeit keinen Key).
// Gezielt neu erzeugen = Datei vorher löschen. Aufruf: node scripts/gen-music.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'audio')
fs.mkdirSync(OUT, { recursive: true })

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = (env.match(/^ELEVEN_LABS_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!KEY) { console.error('ELEVEN_LABS_KEY fehlt in .env'); process.exit(1) }

const CLIP = {
  name: 'ambient',
  ms: 360000, // ~6 Min — lang genug, dass der Loop nicht auffällt
  prompt:
    'Uplifting downtempo electronic travel groove for a long scenic journey, gently driving and ' +
    'rhythmic with real forward momentum. A steady relaxed pulse around 100 BPM: soft warm kick and ' +
    'rounded bassline, crisp light percussion, shakers and rimshots, bright arpeggiated synth plucks ' +
    'and warm evolving pads, a subtle melodic hook — an organic chillout / melodic-house feel that ' +
    'carries a sense of motion and travel. Evolving over six minutes through several sections that ' +
    'keep it interesting: brighter energetic passages and pulled-back breakdowns, but always smooth, ' +
    'warm and understated enough to sit under a scene as background music. No vocals, no harsh drops, ' +
    'nothing intrusive. Seamless, atmospheric, feel-good.',
}

const file = path.join(OUT, `${CLIP.name}.mp3`)
if (fs.existsSync(file)) { console.log(`${CLIP.name}.mp3 existiert bereits — nichts zu tun`); process.exit(0) }

const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
  method: 'POST',
  headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: CLIP.prompt, music_length_ms: CLIP.ms }),
})
if (!res.ok) { console.error(`HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`); process.exit(1) }
const buf = Buffer.from(await res.arrayBuffer())
fs.writeFileSync(file, buf)
console.log(`  ✓ ${CLIP.name}.mp3  (${(buf.length / 1024).toFixed(0)} KB)  →`, OUT)
