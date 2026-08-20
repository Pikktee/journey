#!/usr/bin/env node
// Seedet die drei kuratierten Demo-Touren (kohphangan, stockholm, oberland)
// aus src/tours.js als echte Server-Touren für einen lokalen Studio-Account.
//
// Aufruf:
//   node scripts/seed-demo-touren.mjs \
//     [--server http://localhost:8787] \
//     [--email henrik@localhost.dev] [--passwort maptale-dev] \
//     [--public]
//
// Idempotent über clientTourId `demo:<id>`. Existiert die Tour schon und ist
// bereit, wird sie übersprungen.

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exit } from 'node:process'
import { TOURS } from '../src/tours.js'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const DEMOids = ['kohphangan', 'stockholm', 'oberland']

function parseArgs(argv) {
  const args = {
    server: 'http://localhost:8787',
    email: process.env.MAPTALE_EMAIL || process.env.LUHAMBO_EMAIL || 'henrik@localhost.dev',
    passwort: process.env.MAPTALE_PASSWORT || process.env.LUHAMBO_PASSWORT || 'maptale-dev',
    public: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--public') args.public = true
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
  }
  return args
}

function haversineM(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Segmente mit tOffset (Sekunden ab time.start), proportional zur Strecke. */
function mitZeitOffsets(segments, dauerS) {
  const flat = []
  for (const seg of segments) {
    for (const p of seg.pts) flat.push(p)
  }
  if (flat.length < 2) {
    return segments.map((seg) => ({
      ...seg,
      pts: seg.pts.map(
        (p) => /** @type {[number,number,number,number]} */ ([p[0], p[1], p[2] ?? 0, 0]),
      ),
    }))
  }
  const cum = [0]
  for (let i = 1; i < flat.length; i++) {
    cum.push(cum[i - 1] + haversineM(flat[i - 1], flat[i]))
  }
  const total = cum[cum.length - 1] || 1
  let k = 0
  return segments.map((seg) => ({
    mode: seg.mode,
    ...(seg.label ? { label: seg.label } : {}),
    pts: seg.pts.map((p) => {
      const t = (cum[k] / total) * dauerS
      k++
      return /** @type {[number,number,number,number]} */ ([
        p[0],
        p[1],
        p[2] ?? 0,
        Math.round(t * 10) / 10,
      ])
    }),
  }))
}

function fotoZeiten(photos, startMs, endeMs) {
  if (!photos.length) return []
  if (photos.length === 1) return [startMs + (endeMs - startMs) * 0.5]
  return photos.map((_, i) => startMs + ((endeMs - startMs) * i) / (photos.length - 1))
}

async function api(server, pfad, init = {}) {
  const res = await fetch(`${server}${pfad}`, init)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const msg = body?.error || body?.message || text || res.statusText
    throw new Error(`${init.method || 'GET'} ${pfad} → ${res.status}: ${msg}`)
  }
  return body
}

async function warteBereit(server, auth, id) {
  process.stdout.write('    Verarbeiten')
  for (;;) {
    await new Promise((r) => setTimeout(r, 800))
    const tour = await api(server, `/api/tours/${id}`, { headers: auth })
    if (tour.status === 'failed') throw new Error(tour.error || 'Verarbeitung fehlgeschlagen')
    if (tour.schema === 'maptale/tour@2' || tour.status === 'ready') {
      process.stdout.write(' fertig\n')
      return tour
    }
    process.stdout.write('.')
  }
}

const args = parseArgs(process.argv.slice(2))

const login = await api(args.server, '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: args.email, password: args.passwort, tokenLabel: 'Demo-Seed' }),
})
const auth = { authorization: `Bearer ${login.apiToken}` }
console.log(`Angemeldet als ${login.user.email}`)

for (const demoId of DEMOids) {
  const cfg = TOURS[demoId]
  if (!cfg) {
    console.warn(`  ⚠ Tour „${demoId}" fehlt in TOURS — übersprungen`)
    continue
  }

  const startMs = Date.parse(cfg.time.start)
  const endeMs = Date.parse(cfg.time.end)
  const dauerS = Math.max(60, (endeMs - startMs) / 1000)
  const segments = mitZeitOffsets(cfg.segments, dauerS)
  const zeiten = fotoZeiten(cfg.photos, startMs, endeMs)

  const media = []
  const dateien = []
  for (let i = 0; i < cfg.photos.length; i++) {
    const foto = cfg.photos[i]
    const rel = foto.src.replace(/^\//, '')
    const abs = join(ROOT, 'public', rel)
    const inhalt = await readFile(abs)
    const id = `m${i + 1}`
    const file = basename(foto.src)
    media.push({
      id,
      type: 'photo',
      file,
      takenAt: new Date(zeiten[i]).toISOString(),
      anchor: foto.anchor,
      caption: foto.title || null,
    })
    dateien.push({ id, inhalt, type: 'image/jpeg' })
  }

  const manifest = {
    schema: 'maptale/upload@2',
    clientTourId: `demo:${demoId}`,
    title: cfg.brandTitle,
    description: cfg.kicker ? `${cfg.kicker} ${cfg.brandTitle}.` : null,
    time: cfg.time,
    segments,
    media,
  }

  console.log(`\n→ ${cfg.brandTitle} (${demoId})`)
  const angelegt = await api(args.server, '/api/tours', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  })
  const id = angelegt.id

  if (angelegt.wiederverwendet) {
    const tour = await api(args.server, `/api/tours/${id}`, { headers: auth })
    if (tour.schema === 'maptale/tour@2' || tour.status === 'ready') {
      console.log(`  bereits bereit (${id}) — übersprungen`)
      if (args.public && tour.visibility !== 'public') {
        await api(args.server, `/api/tours/${id}`, {
          method: 'PATCH',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ visibility: 'public' }),
        })
        console.log('  auf public gestellt')
      }
      continue
    }
    console.log(`  vorhanden (${id}, ${tour.status}) — Medien erneut laden`)
  } else {
    console.log(`  angelegt als ${id}`)
  }

  for (const { id: mid, inhalt, type } of dateien) {
    await api(args.server, `/api/tours/${id}/media/${mid}`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': type },
      body: inhalt,
    })
    console.log(`  Medium ${mid} (${(inhalt.length / 1024).toFixed(0)} kB)`)
  }

  await api(args.server, `/api/tours/${id}/finalize`, { method: 'POST', headers: auth })
  await warteBereit(args.server, auth, id)

  if (args.public) {
    await api(args.server, `/api/tours/${id}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: 'public' }),
    })
    console.log('  Sichtbarkeit: public')
  }

  console.log(`  Abspielen: http://localhost:5173/tour/${id}`)
}

console.log('\nFertig.')
exit(0)
