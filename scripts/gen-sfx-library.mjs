// Erzeugt die kuratierte Soundeffekt-Bibliothek über die ElevenLabs
// Sound-Generation-API und legt sie als MP3 nach public/audio/sfx/ (Vite
// serviert public/ statisch → /audio/sfx/<datei>). Einmalig laufen lassen; die
// MP3s werden eingecheckt, damit die App zur Laufzeit keinen Key/kein Netz
// braucht. Aufruf: node scripts/gen-sfx-library.mjs
//
// Der Katalog (Anzeige + Dateinamen) liegt in src/studio/sfxbibliothek.ts; die
// Prompts hier. Ein Drift-Wächter (test/studio-baukasten.test.ts) hält die
// Dateinamen beider Seiten synchron — CLIPS wird dafür exportiert.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'audio', 'sfx')

// name = Dateiname OHNE .mp3 (muss zu sfxbibliothek.ts datei passen); loop=true
// fordert einen nahtlos schleifenbaren Clip an (Umgebungs-Atmosphären).
export const CLIPS = [
  // — Umgebung (Loops) —
  { name: 'amb-hafen', dur: 22, loop: true, text: 'Harbour ambience: seagulls calling, gentle waves lapping against a stone quay, distant boat rigging clinking, no music, no voices' },
  { name: 'amb-wald', dur: 22, loop: true, text: 'Forest ambience: many birds singing, soft rustling of leaves in a light breeze, peaceful woodland, no music, no voices' },
  { name: 'amb-stadt', dur: 22, loop: true, text: 'Busy city street ambience: distant traffic, passing footsteps, faint crowd chatter, urban background, no music, no clear voices' },
  { name: 'amb-markt', dur: 22, loop: true, text: 'Open market ambience: overlapping crowd chatter, distant vendor calls, bustling activity, no music, no clear single voice' },
  { name: 'amb-brandung', dur: 22, loop: true, text: 'Beach ambience: gentle ocean surf, waves rolling in and receding on sand, calm seaside, no music, no voices' },
  { name: 'amb-grillen', dur: 22, loop: true, text: 'Warm tropical night ambience: continuous chirping of crickets and cicadas, no music, no voices' },
  { name: 'amb-bach', dur: 22, loop: true, text: 'Small stream ambience: water babbling and trickling over stones, gentle flowing brook, no music, no voices' },
  { name: 'amb-bergwind', dur: 22, loop: true, text: 'High mountain ambience: soft steady wind, faint distant cowbells, alpine calm, no music, no voices' },
  { name: 'amb-fahrtwind', dur: 22, loop: true, text: 'Steady rushing wind of fast forward motion, air streaming past continuously, open-air travel, no engine, no music, no voices' },
  { name: 'amb-seewind', dur: 22, loop: true, text: 'Brisk sea wind over open water, steady breeze with faint water spray, coastal boat travel, no engine, no music, no voices' },
  // — Effekte (One-Shots) —
  { name: 'sfx-tempelglocke', dur: 6, loop: false, text: 'A single strike of a large Asian temple bell, deep resonant tone with a long fading shimmer, no music, no voices' },
  { name: 'sfx-kirchenglocke', dur: 8, loop: false, text: 'A church bell ringing, a few clear bronze bell strikes echoing, no music, no voices' },
  { name: 'sfx-moewe', dur: 4, loop: false, text: 'A single seagull screech, clear and close, no music, no voices' },
  { name: 'sfx-schiffshorn', dur: 6, loop: false, text: 'A deep low ship horn blast from a departing vessel, powerful and resonant, no music, no voices' },
  { name: 'sfx-hupe', dur: 3, loop: false, text: 'A short car horn honk, single beep, no music, no voices' },
  { name: 'sfx-hund', dur: 4, loop: false, text: 'A dog barking a few times, medium sized dog, clear and close, no music, no voices' },
  { name: 'sfx-applaus', dur: 5, loop: false, text: 'A short burst of applause and cheering from a small crowd, no music, no clear voices' },
  { name: 'sfx-kamera', dur: 2, loop: false, text: 'A single DSLR camera shutter click, crisp mechanical snap, no music, no voices' },
]

// Als Modul importiert (Drift-Test) NICHT generieren — nur bei direktem Aufruf.
const direktAufruf = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direktAufruf) {
  fs.mkdirSync(OUT, { recursive: true })
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  const KEY = (env.match(/^ELEVEN_LABS_KEY\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
  if (!KEY) {
    console.error('ELEVEN_LABS_KEY fehlt in .env')
    process.exit(1)
  }

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

  if (!missing.length) console.log('alle Clips vorhanden — nichts zu tun')
  else console.log(`${missing.length} von ${CLIPS.length} Clips fehlen — erzeuge …`)
  for (const c of missing) {
    try {
      await gen(c)
    } catch (e) {
      console.error('  ✗', e.message)
    }
  }
  console.log('fertig →', OUT)
}
