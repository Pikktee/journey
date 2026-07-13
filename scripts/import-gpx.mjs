#!/usr/bin/env node
// CLI-Importer: GPX-Track (mit Zeitstempeln) + optionaler Fotoordner →
// Upload-Manifest (luhambo/upload@1, trackFile) → Backend-Upload → Finalize.
// Ab M6 ein DÜNNER Wrapper um dieselbe API wie das Web-Studio: Der Server parst
// das GPX (pipeline/gpx.ts) und verortet die Fotos (pipeline/placement.ts) —
// das CLI liefert nur die Datei, die Zeitspanne und pro Foto EXIF-Zeit/-GPS.
//
// Aufruf:
//   node scripts/import-gpx.mjs <track.gpx> [fotoOrdner] \
//     [--server http://localhost:8787] [--mode bike] [--zone Europe/Berlin] \
//     [--title "…"] [--email …] [--passwort …]
//   Zugangsdaten alternativ über LUHAMBO_EMAIL / LUHAMBO_PASSWORT.

import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { exit } from 'node:process'
import { liesExif } from './exif-node.mjs'

// — Argumente —

function parseArgs(argv) {
  const args = { positional: [], server: 'http://localhost:8787', mode: 'bike', zone: 'Europe/Berlin' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
    else args.positional.push(a)
  }
  return args
}

// — Zeitspanne aus den Track-Punkten (der Server parst die volle Geometrie) —

function gpxTrackZeiten(xml) {
  // Nicht-backtrackend (wie parseGpx im Server): nur den öffnenden Tag matchen,
  // Inhalt bis zum nächsten </trkpt> per indexOf — eine lazy Gruppe wäre bei
  // fehlenden Schluss-Tags quadratisch.
  const zeiten = []
  const re = /<trkpt\b[^>]*>/g
  while (re.exec(xml) !== null) {
    // festes Fenster statt unbeschränktem indexOf (O(N²) ohne Treffer)
    const inhalt = xml.slice(re.lastIndex, re.lastIndex + 500)
    const t = /<time>([^<]+)<\/time>/.exec(inhalt)?.[1]
    if (t) {
      const ms = Date.parse(t)
      if (Number.isFinite(ms)) zeiten.push(ms)
    }
  }
  return zeiten
}

// — EXIF-Zeit (zonenlos) in der Tour-Zone als Epochen-Millisekunden deuten —

function zonenOffsetMs(utcMs, zone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const teile = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const lokalAlsUtc = Date.UTC(+teile.year, +teile.month - 1, +teile.day, +(teile.hour % 24), +teile.minute, +teile.second)
  return lokalAlsUtc - utcMs
}

function exifDatumZuMs(d, zone) {
  const naiv = Date.UTC(d.y, d.mo - 1, d.d, d.hh, d.mm, d.ss)
  let ms = naiv - zonenOffsetMs(naiv, zone)
  ms = naiv - zonenOffsetMs(ms, zone)
  return ms
}

const isoMitZone = (ms, zone) => {
  const offset = zonenOffsetMs(ms, zone)
  const vorzeichen = offset >= 0 ? '+' : '-'
  const absMin = Math.abs(offset) / 60000
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0')
  const mm = String(absMin % 60).padStart(2, '0')
  return new Date(ms + offset).toISOString().replace(/\.\d{3}Z$/, `${vorzeichen}${hh}:${mm}`)
}

// — API-Aufrufe —

async function api(server, pfad, optionen = {}) {
  const antwort = await fetch(`${server}${pfad}`, optionen)
  const text = await antwort.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* Nicht-JSON-Antwort (z. B. leerer Body) */
  }
  if (!antwort.ok) {
    throw new Error(`${optionen.method ?? 'GET'} ${pfad} → ${antwort.status}: ${text.slice(0, 300)}`)
  }
  return json
}

// — Hauptablauf —

const args = parseArgs(process.argv.slice(2))
const [gpxPfad, fotoOrdner] = args.positional
if (!gpxPfad) {
  console.error('Aufruf: node scripts/import-gpx.mjs <track.gpx> [fotoOrdner] [--mode bike] [--zone Europe/Berlin] …')
  exit(1)
}
const email = args.email ?? process.env.LUHAMBO_EMAIL
const passwort = args.passwort ?? process.env.LUHAMBO_PASSWORT
if (!email || !passwort) {
  console.error('Zugangsdaten fehlen: --email/--passwort oder LUHAMBO_EMAIL/LUHAMBO_PASSWORT setzen.')
  exit(1)
}

const gpxText = await readFile(gpxPfad, 'utf8')
const zeiten = gpxTrackZeiten(gpxText)
if (zeiten.length < 2) {
  console.error('GPX ohne (parsebare) <time>-Zeitstempel — für Auto-Wetter/Tag-Nacht werden echte Zeiten benötigt.')
  exit(1)
}
const startMs = zeiten[0]
const endeMs = zeiten[zeiten.length - 1]
console.log(`Track: ${zeiten.length} Zeitpunkte, ${((endeMs - startMs) / 3600000).toFixed(1)} h, Modus ${args.mode}`)

// Fotos einsammeln: EXIF-Zeit (Pflicht) + EXIF-GPS (optional; sonst platziert
// der Server über die Aufnahmezeit).
const media = []
const dateien = []
if (fotoOrdner) {
  for (const name of (await readdir(fotoOrdner)).sort()) {
    const endung = extname(name).toLowerCase()
    if (!['.jpg', '.jpeg'].includes(endung)) continue
    const inhalt = await readFile(join(fotoOrdner, name))
    const { datum, gps } = liesExif(inhalt)
    if (!datum) {
      console.warn(`  ⚠ ${name}: kein EXIF-Datum — übersprungen`)
      continue
    }
    const ms = exifDatumZuMs(datum, args.zone)
    const id = `m${media.length + 1}`
    const eintrag = { id, type: 'photo', file: basename(name), takenAt: isoMitZone(ms, args.zone) }
    if (gps) eintrag.anchor = gps
    media.push(eintrag)
    dateien.push({ id, inhalt })
    console.log(`  Foto ${name}: ${gps ? 'EXIF-GPS' : 'Server-Zeit-Platzierung'}`)
  }
}

const manifest = {
  schema: 'luhambo/upload@1',
  clientTourId: `gpx:${basename(gpxPfad)}:${startMs}`,
  title: args.title ?? null,
  description: null,
  time: { start: isoMitZone(startMs, args.zone), end: isoMitZone(endeMs, args.zone), zone: args.zone },
  trackFile: 'track.gpx',
  trackMode: args.mode,
  media,
}

// Login → Token → Upload (Manifest + GPX + Fotos) → Finalize
const login = await api(args.server, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, passwort, tokenLabel: 'CLI-Importer' }),
})
const auth = { authorization: `Bearer ${login.apiToken}` }

const { id, wiederverwendet } = await api(args.server, '/api/tours', {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify(manifest),
})
if (wiederverwendet) {
  const tour = await api(args.server, `/api/tours/${id}`)
  if (tour.schema === 'luhambo/tour@1') {
    console.log(`Tour ${id} existiert bereits („${tour.brandTitle}").`)
    console.log(`Abspielen: http://localhost:5173/?tour=srv:${id}`)
    process.exit(0)
  }
  console.log(`Tour ${id} bereits vorhanden (Status ${tour.status}) — Dateien werden erneut geladen`)
} else {
  console.log(`Tour ${id} angelegt`)
}

// GPX hochladen (der Server parst es beim Finalize)
await api(args.server, `/api/tours/${id}/track`, {
  method: 'PUT',
  headers: { ...auth, 'content-type': 'application/gpx+xml' },
  body: gpxText,
})
console.log(`  GPX hochgeladen (${(gpxText.length / 1024).toFixed(0)} kB)`)

for (const { id: mid, inhalt } of dateien) {
  await api(args.server, `/api/tours/${id}/media/${mid}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    body: inhalt,
  })
  console.log(`  Medium ${mid} hochgeladen (${(inhalt.length / 1024).toFixed(0)} kB)`)
}

await api(args.server, `/api/tours/${id}/finalize`, { method: 'POST', headers: auth })
process.stdout.write('Verarbeitung')
for (;;) {
  await new Promise((r) => setTimeout(r, 700))
  const tour = await api(args.server, `/api/tours/${id}`)
  if (tour.status === 'fehler') {
    console.error(`\nVerarbeitung fehlgeschlagen: ${tour.fehler}`)
    exit(1)
  }
  if (tour.schema === 'luhambo/tour@1') {
    console.log(`\nFertig: „${tour.brandTitle}" — ${tour.stats.km} km, ${tour.stats.gainM} hm, ${tour.media.length} Medien`)
    console.log(`Abspielen: http://localhost:5173/?tour=srv:${id}`)
    break
  }
  process.stdout.write('.')
}
