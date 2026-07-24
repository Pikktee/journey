// Erzeugt die kuratierte MUSIK-Bibliothek über die ElevenLabs Music-API
// (POST /v1/music) und legt sie als MP3 nach public/audio/sfx/ — dasselbe
// Verzeichnis wie die Klänge, damit die Auslieferung (/audio/sfx/<datei>) und
// die Overlay-Referenz (`quelle: 'bibliothek'`) unverändert bleiben.
// Einmalig laufen lassen; die MP3s werden eingecheckt, damit die App zur
// Laufzeit keinen Key und kein Netz braucht.
// Aufruf: node scripts/gen-music-library.mjs
//
// Der Katalog (Anzeige + Dateinamen) liegt in src/studio/sfxbibliothek.ts, die
// Prompts hier. Ein Drift-Wächter (test/studio-baukasten.test.ts) hält die
// Dateinamen beider Seiten synchron — MUSIK_CLIPS wird dafür exportiert.
//
// LÄNGE. 100 s je Stück: lang genug, dass die Wiederholung unter einer
// Kamerafahrt nicht auffällt, kurz genug, dass zehn Stücke das Repo nicht
// sprengen (~1,6 MB je Stück). Die Wiedergabe schleift ohnehin.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'audio', 'sfx')
const LAENGE_MS = 100000

// name = Dateiname OHNE .mp3 (muss zu sfxbibliothek.ts `datei` passen).
// Jeder Prompt endet mit denselben Auflagen: Instrumental, keine Stimmen, keine
// harten Einsätze — das hier läuft UNTER einer Reise, es ist nicht der Film.
const AUFLAGE =
  ' Fully instrumental, no vocals, no spoken word. Smooth and even throughout with no abrupt drops, ' +
  'no risers and no sudden silences, so it can loop and sit under a scene as background music. ' +
  'Starts and ends softly.'

export const MUSIK_CLIPS = [
  {
    name: 'mus-aufbruch',
    text:
      'Hopeful indie-folk travel theme for setting out on a journey at sunrise: fingerpicked acoustic ' +
      'guitar, light shaker and hand claps, warm upright bass, a bright glockenspiel motif that gently ' +
      'builds. Around 105 BPM, optimistic and unhurried.',
  },
  {
    name: 'mus-fernweh',
    text:
      'Wistful, wide-open cinematic theme about longing for far-away places: slow warm pads, a simple ' +
      'melancholic piano melody, distant swelling strings, soft heartbeat-like low drum. Around 75 BPM, ' +
      'spacious and emotional but restrained.',
  },
  {
    name: 'mus-kuestenstrasse',
    text:
      'Sunny coastal driving groove: clean reverb-drenched surf guitar, relaxed brushed drums, warm ' +
      'rounded bass, light organ chords, salty breezy feel. Around 110 BPM, easygoing and cheerful.',
  },
  {
    name: 'mus-nachtfahrt',
    text:
      'Nocturnal synthwave travel groove for riding through the dark: steady pulsing analog bass ' +
      'arpeggio, soft gated drums, distant shimmering pads, a cool restrained lead line. Around 100 BPM, ' +
      'hypnotic and forward-moving.',
  },
  {
    name: 'mus-bergpass',
    text:
      'Sweeping orchestral theme for a high mountain pass: broad sustained strings, warm horns, ' +
      'soft timpani pulse, airy woodwind lines, a sense of altitude and vast cold air. Around 80 BPM, ' +
      'majestic but calm, never bombastic.',
  },
  {
    name: 'mus-tropen',
    text:
      'Warm tropical instrumental: marimba and kalimba melody, soft nylon guitar, light hand ' +
      'percussion, congas and shakers, mellow bass. Around 100 BPM, sunny, humid and laid-back.',
  },
  {
    name: 'mus-stadtpuls',
    text:
      'Crisp urban downtempo groove for moving through a city: tight dry drums, muted funk guitar ' +
      'stabs, deep round bassline, subtle rhodes chords, a little vinyl crackle. Around 95 BPM, cool and ' +
      'understated.',
  },
  {
    name: 'mus-goldene-stunde',
    text:
      'Dreamy golden-hour ambient piece: shimmering guitar swells through long reverb, soft analog ' +
      'pads, slow gentle bass notes, faint bell tones drifting. Around 70 BPM, glowing, warm and hazy, ' +
      'almost beatless.',
  },
  {
    name: 'mus-regentag',
    text:
      'Quiet melancholic piano piece for a grey rainy day: intimate close-miked felt piano, sparse ' +
      'notes, soft low strings underneath, a little room tone. Around 65 BPM, gentle, contemplative, ' +
      'unhurried.',
  },
  {
    name: 'mus-heimkehr',
    text:
      'Calm, resolving instrumental for arriving home at the end of a journey: warm acoustic guitar ' +
      'and soft piano trading a simple recurring melody, gentle brushed drums entering late, mellow ' +
      'strings settling. Around 85 BPM, content and peaceful.',
  },
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

  // Bereits erzeugte Dateien nicht neu generieren (jeder Aufruf kostet
  // API-Guthaben); gezielt neu erzeugen = Datei vorher löschen.
  const fehlend = MUSIK_CLIPS.filter((c) => !fs.existsSync(path.join(OUT, `${c.name}.mp3`)))

  const erzeuge = async (c) => {
    const res = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: c.text + AUFLAGE, music_length_ms: LAENGE_MS }),
    })
    if (!res.ok) throw new Error(`${c.name}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(path.join(OUT, `${c.name}.mp3`), buf)
    console.log(`  ✓ ${c.name}.mp3  (${(buf.length / 1024).toFixed(0)} KB)`)
  }

  if (!fehlend.length) console.log('alle Stücke vorhanden — nichts zu tun')
  else console.log(`${fehlend.length} von ${MUSIK_CLIPS.length} Stücken fehlen — erzeuge …`)
  for (const c of fehlend) {
    try {
      await erzeuge(c)
    } catch (e) {
      console.error('  ✗', e.message)
    }
  }
  console.log('fertig →', OUT)
}
