// Erzeugt die Fahrzeug-Motorgeräusche (geloopt, unaufdringlich) über die ElevenLabs
// Sound-Generation-API und legt sie als MP3 nach public/audio/ ab. Pro Fortbewegungs-
// modus ein leiser, gleichmäßiger Motor-Loop, der während der Fahrt im Hintergrund läuft
// (src/vehicle.js blendet je nach aktivem Segment-Modus über). Einmalig laufen lassen;
// die MP3s werden eingecheckt (App braucht zur Laufzeit keinen Key/kein Netz).
// Gezielt neu erzeugen = Datei vorher löschen. Aufruf: node scripts/gen-vehicle-audio.mjs
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

// Gleichmäßige, konstante Motorläufe ohne Aufheulen/Gangwechsel — damit der Loop
// nahtlos wirkt und dezent unter der Szene bleibt. Jeep (Bergüberquerung), Moped
// (Honda Wave 110, Küstenfahrt) und Boot (thailändisches Longtail auf dem Golf) — die
// drei Fortbewegungsmodi der Koh-Pha-ngan-Tour. Auto-Prompt bleibt auskommentiert bereit.
const CLIPS = [
  { name: 'eng-jeep', dur: 16, loop: true, text: 'Old rugged 4x4 off-road jeep engine running steadily under load on a rough track, low diesel grumble and drivetrain rumble, constant moderate RPM, no revving spikes, no gear changes, no music, no voices' },
  { name: 'eng-moped', dur: 16, loop: true, text: 'Small Honda Wave 110cc four-stroke single-cylinder underbone motorcycle engine cruising at a steady moderate speed, continuous smooth light engine hum with a soft airy exhaust buzz, constant moderate RPM, no revving, no gear changes, no music, no voices' },
  { name: 'eng-boat', dur: 16, loop: true, text: 'Thai wooden long-tail boat puttering steadily across calm sea at a constant slow cruising speed, the distinctive exposed long-tail propeller engine with a rhythmic mechanical chug and putter, gentle wash of water against the wooden hull, constant slow RPM, no revving, no music, no voices' },
  // { name: 'eng-car', dur: 16, loop: true, text: 'Passenger car cruising at a steady speed on a road, smooth continuous petrol engine hum with faint tyre and road noise, constant RPM, no revving, no music, no voices' },
]

// Bereits erzeugte Dateien nicht neu generieren (Aufruf kostet API-Guthaben);
// gezielt neu erzeugen = Datei vorher löschen.
const missing = CLIPS.filter((c) => !fs.existsSync(path.join(OUT, `${c.name}.mp3`)))

const gen = async (c) => {
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: c.text, duration_seconds: c.dur, prompt_influence: 0.4, loop: c.loop }),
  })
  if (!res.ok) throw new Error(`${c.name}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(path.join(OUT, `${c.name}.mp3`), buf)
  console.log(`  ✓ ${c.name}.mp3  (${(buf.length / 1024).toFixed(0)} KB)`)
}

if (!missing.length) console.log('alle Fahrzeug-Clips vorhanden — nichts zu tun')
for (const c of missing) {
  try { await gen(c) } catch (e) { console.error('  ✗', e.message) }
}
console.log('fertig →', OUT)
