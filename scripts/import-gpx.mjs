#!/usr/bin/env node
// CLI-Importer: GPX-Track (mit Zeitstempeln) + optionaler Fotoordner →
// Upload-Manifest (luhambo/upload@1) → Backend-Upload → Finalize.
// M1-Testtreiber für das Austauschformat; ab M6 macht das Web-Studio dasselbe
// über die gleiche API. Fotos werden per EXIF verortet (GPS bevorzugt, sonst
// über die Aufnahmezeit auf den Track interpoliert).
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

// — GPX lesen (bewusst ohne XML-Abhängigkeit: trkpt-Blöcke sind flach) —

function parseGpx(xml) {
  const punkte = []
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g
  let m
  while ((m = re.exec(xml))) {
    const attrs = m[1]
    const inhalt = m[2]
    const lat = /lat="([^"]+)"/.exec(attrs)?.[1]
    const lon = /lon="([^"]+)"/.exec(attrs)?.[1]
    if (lat === undefined || lon === undefined) continue
    const ele = /<ele>([^<]+)<\/ele>/.exec(inhalt)?.[1]
    const time = /<time>([^<]+)<\/time>/.exec(inhalt)?.[1]
    punkte.push({ lng: Number(lon), lat: Number(lat), ele: ele ? Number(ele) : 0, time: time ? Date.parse(time) : null })
  }
  return punkte
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
  // Offset iterieren (zweimal reicht — DST-Kanten ändern den Offset höchstens einmal)
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

// — Foto über die Aufnahmezeit auf dem Track verorten —

function ankerZurZeit(punkte, ms) {
  if (ms <= punkte[0].time) return [punkte[0].lng, punkte[0].lat]
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1]
    const b = punkte[i]
    if (ms <= b.time) {
      const t = b.time === a.time ? 0 : (ms - a.time) / (b.time - a.time)
      return [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t]
    }
  }
  const letzter = punkte[punkte.length - 1]
  return [letzter.lng, letzter.lat]
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

const gpx = parseGpx(await readFile(gpxPfad, 'utf8'))
if (gpx.length < 2) {
  console.error(`GPX enthält zu wenige Trackpunkte (${gpx.length}).`)
  exit(1)
}
if (gpx.some((p) => p.time === null || Number.isNaN(p.time))) {
  console.error('GPX ohne (parsebare) Zeitstempel — für M1 werden echte <time>-Einträge benötigt (Auto-Wetter/Tag-Nacht).')
  exit(1)
}

const startMs = gpx[0].time
const endeMs = gpx[gpx.length - 1].time
const pts = gpx.map((p) => [p.lng, p.lat, p.ele, Math.round((p.time - startMs) / 1000)])
console.log(`Track: ${gpx.length} Punkte, ${((endeMs - startMs) / 3600000).toFixed(1)} h, Modus ${args.mode}`)

// Fotos einsammeln + verorten
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
    const anchor = gps ?? ankerZurZeit(gpx, ms)
    const id = `m${media.length + 1}`
    media.push({ id, type: 'photo', file: basename(name), takenAt: isoMitZone(ms, args.zone), anchor })
    dateien.push({ id, inhalt })
    console.log(`  Foto ${name}: ${gps ? 'EXIF-GPS' : 'Zeit-Anker'} [${anchor.map((v) => v.toFixed(5)).join(', ')}]`)
  }
}

const manifest = {
  schema: 'luhambo/upload@1',
  clientTourId: `gpx:${basename(gpxPfad)}:${startMs}`,
  title: args.title ?? null,
  description: null,
  time: { start: isoMitZone(startMs, args.zone), end: isoMitZone(endeMs, args.zone), zone: args.zone },
  segments: [{ mode: args.mode, pts }],
  media,
}

// Login → Token → Upload → Finalize
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
  // Nach dem Rendern sind Medien unveränderlich — eine bereits fertige Tour
  // wird nicht erneut hochgeladen, nur ihre Abspiel-URL ausgegeben.
  const tour = await api(args.server, `/api/tours/${id}`)
  if (tour.schema === 'luhambo/tour@1') {
    console.log(`Tour ${id} existiert bereits („${tour.brandTitle}").`)
    console.log(`Abspielen: http://localhost:5173/?tour=srv:${id}`)
    process.exit(0)
  }
  console.log(`Tour ${id} bereits vorhanden (Status ${tour.status}) — Medien werden erneut geladen`)
} else {
  console.log(`Tour ${id} angelegt`)
}

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
