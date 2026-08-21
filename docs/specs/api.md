---
stand: 2026-08-20
status: Ist-Stand erhoben (Welle 0 der Englisch-Migration); Pfade und Felder sind noch deutsch, die Zielformen stehen in der Abbildungstabelle
betrifft:
  - server/src/routes/
  - server/src/app.ts
  - src/studio/api.ts
  - src/remote.ts
  - android/app/src/main/java/app/maptale/upload/ApiClient.kt
systemteile: [Backend, Studio, Player, App]
---

# HTTP-API

Der bleibende Ort für den API-Vertrag (Konzept Englisch-Migration, §6.7). Dieses
Dokument zählt **alle 95 Routen-Registrierungen** in `server/src` mit
Auth-Stufe, Query-Parametern, Request- und Response-Feldern und den Aufrufern.
Erhoben am 2026-08-19 per Skript über alle drei Quote-Arten und mehrzeilige
Registrierungen, ergänzt durch Lesen der Handler; die Aufrufer-Seite deckt Web
(inklusive Template-Literale und der `anfrage(…)`-Wrapper) und Android ab.

Die Namen sind der **Ist-Stand vor Welle 1**, also noch deutsch. Welle 1 benennt
Pfade und Felder nach der Abbildungstabelle um
([abbildungstabelle.md](abbildungstabelle.md)) und zieht dieses Dokument im
selben Commit nach.

Auth-Stufen: **öffentlich** (kein Guard), **Sitzung** (`requireUser`,
Cookie oder Bearer-Token), **Besitzer** (Sitzung plus `requireOwner`), **Admin**
(`requireAdmin`), **Sichtbarkeit** (öffentlich, aber `canView`: private nur
für den Besitzer). „Bremse" heißt Rate-Limit.

Fehlerantworten tragen überall `{ error }`, Validierungsfehler zusätzlich
`details`.

---

## auth (routes/auth.ts)

### POST /api/auth/login (öffentlich, Bremse)
- Request: `email`, `password`, `tokenLabel?`
- Response: `user{id,email,name,role}`, `apiToken?` (nur mit tokenLabel; dann KEINE Sitzung)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### POST /api/auth/register (öffentlich, Bremse)
- Request: `email`, `password`, `name?`, `code?` (Einladung), `newsletter?`
- Response 201: `user`, `verified` (false)
- Aufrufer: src/studio/api.ts

### POST /api/auth/check-invitation (öffentlich, Bremse)
- Request: `code`; Response: `ok`, `required`
- Aufrufer: src/studio/api.ts

### POST /api/auth/verify (öffentlich)
- Request: `token`; Response: `ok` (setzt Session-Cookie)
- Aufrufer: src/studio/api.ts

### POST /api/auth/password-reset-request (öffentlich, Bremse)
- Request: `email`; Response: immer `ok` (keine Existenz-Auskunft)
- Aufrufer: src/studio/api.ts

### POST /api/auth/password-reset (öffentlich)
- Request: `token`, `password`; Response: `ok`
- Aufrufer: src/studio/api.ts

### POST /api/auth/session-from-token (Sitzung; praktisch nur Bearer)
- Request: –; Response: `sessionId`, `expiresAt`
- Aufrufer: android ApiClient.kt (WebView-Player)

### POST /api/auth/logout (öffentlich; wirkt auf Cookie)
- Response: `ok`
- Aufrufer: src/studio/api.ts, src/app-nav.ts

### POST /api/auth/me/password (Sitzung, Bremse)
- Request: `old`, `new`; Response: `ok` (beendet alle anderen Zugänge)
- Aufrufer: src/account/account-dialogs.ts

### POST /api/auth/me/email (Sitzung, Bremse)
- Request: `email`, `password`; Response: immer `ok` (Mail an NEUE Adresse; Wechsel erst beim Klick)
- Aufrufer: src/account/account-dialogs.ts

### POST /api/auth/confirm-email (öffentlich; Token ist der Nachweis)
- Request: `token`; Response: `ok`, `email`
- Aufrufer: src/account/account.ts (`/account#email=…`)

### GET /api/auth/me/devices (Sitzung)
- Response: `devices[]{id ("session:…"/"app:…"), kind ("session"|"app"), label, ipPrefix, signedInAt, lastSeenAt, current}`
- Aufrufer: src/account/account.ts

### DELETE /api/auth/me/devices/:id (Sitzung)
- Response: `ok`
- Aufrufer: src/account/account.ts

### POST /api/auth/me/newsletter (Sitzung)
- Request: `enabled`; Response: `ok`, `newsletter`, `sendingPaused`
- Aufrufer: src/account/account.ts

### POST /api/auth/me/search-indexing (Sitzung)
- Request: `enabled`; Response: `ok`, `searchIndexing`, `effectPaused`
- Aufrufer: src/account/account.ts

### GET /api/auth/me/storage (Sitzung)
- Response: `used`, `limit`, `free`, `breakdown{photos,videos,audio,recordings,other}`
- Aufrufer: src/account/account.ts

### DELETE /api/auth/me (Sitzung)
- Response: `ok` (Konto samt Storage weg)
- Aufrufer: src/studio/api.ts, src/account/account-dialogs.ts, android ApiClient.kt

### GET /api/auth/me (öffentlich; angereichert bei Sitzung)
- Response ohne Anmeldung: `user: null`, `registration{open,invitationRequired,waitlist}`
- Response angemeldet zusätzlich: `verified`, `quota{used,limit,free}`, `newsletter`,
  `profile{handle,displayName,bio,location,website,instagram,avatarUrl,banner,bannerUrl,visibility,searchIndexing}`,
  `dataExport{id,status,requestedAt,finishedAt,expiresAt,bytes,files}|null`
- Aufrufer: src/studio/api.ts, src/admin/api.ts, src/app-nav.ts, src/account/account.ts, src/profile/profile.ts, android ApiClient.kt

### PATCH /api/auth/me/profile (Sitzung)
- Request: `displayName?`, `bio?`, `location?`, `website?`, `instagram?`, `visibility?` (private|public), `handle?`, `banner?` (Vorschlags-Name; '' entfernt)
- Response: das Profil-Objekt (wie in /auth/me)
- Aufrufer: src/account/account.ts, src/profile/edit-profile.ts, android ApiClient.kt

### PUT /api/auth/me/avatar (Sitzung; roher Bild-Body, max 2 MB)
- Response: `avatarUrl`
- Aufrufer: src/profile/edit-profile.ts, android ApiClient.kt

### DELETE /api/auth/me/avatar (Sitzung)
- Response: `ok`; Aufrufer: src/profile/edit-profile.ts, android ApiClient.kt

### PUT /api/auth/me/banner (Sitzung; roher Bild-Body, max 8 MB)
- Response: `bannerUrl`; Aufrufer: src/profile/edit-profile.ts

### DELETE /api/auth/me/banner (Sitzung)
- Response: `ok`; Aufrufer: src/profile/edit-profile.ts

### GET /api/users/:id/banner (öffentlich)
- Response: Binär (JPEG, immutable-Cache)
- Aufrufer: kein Code-Literal; datengetrieben als `bannerUrl` aus Profil-Antworten (img src)

### GET /api/users/:id/avatar (öffentlich)
- Query: `v` (Cache-Buster, Dateiname)
- Response: Binär (JPEG)
- Aufrufer: datengetrieben als `avatarUrl` aus Profil-/Galerie-/Tour-Antworten

---

## tours (routes/tours.ts)

### POST /api/tours (Sitzung + E-Mail-verifiziert)
- Request (UploadManifest, JSON-Schema): `schema`, `clientTourId?`, `title?`, `description?`,
  `time{start,end,zone}`, `segments?[]{mode,label?,pts}`, `trackFile?`, `trackMode?`,
  `travelModesAuto?`, `media[]{id,type,file,takenAt,anchor?,caption?,durationS?,source?}`
- Response 201: `id`; 200 bei Wiederholung: `id`, `reused`
- Aufrufer: src/studio/api.ts, android ApiClient.kt (auch tracker/touranleger.ts serverintern)

### POST /api/tours/:id/finalize (Besitzer)
- Response 202: `id`, `status` ("processing"); 409: `error`, `missing?[]`
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### PATCH /api/tours/:id (Besitzer)
- Request: `title?`, `description?`, `kicker?`, `finale?`, `finaleTarget?`, `visibility?` (private|unlisted|public)
- Response: `ok` (rendert Texte ggf. asynchron nach)
- Aufrufer: src/studio/api.ts, android ApiClient.kt (patchTour + setzeSichtbarkeit)

### GET /api/tours/:id/edits (Besitzer)
- Response: EditOverlay `{schema, media?, travelModes?, trim?, camera?, moments?, audio?, weather?, cover?}`
- Aufrufer: android ApiClient.kt (das Studio bezieht die Edits über /editor)

### PUT /api/tours/:id/edits (Besitzer, JSON-Schema)
- Request: EditOverlay; Unterfelder: `media{<id>:{caption?,anchor?,removed?,display{holdS?,kenBurns?},order?,trim{fromS,toS?}}}`,
  `travelModes[]{from,mode}`, `trim{start?,end?}`, `camera[]{from,preset,scale?}`, `moments[]{from,kind,durationS?}`,
  `audio[]{file,type,from,to?,anchor?,offsetFilmS?,durationFilmS?,startS?,loop?,volume?,source?}`,
  `weather[]{from,mode,intensity?}`, `cover?`
- Response: `ok`, `status` (202 bei Re-Render)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### POST /api/tours/:id/reprocess (Besitzer)
- Response 202: `id`, `status`; Aufrufer: src/studio/api.ts, android ApiClient.kt

### GET /api/tours/:id/editor (Besitzer)
- Response: `id`, `status`, `title`, `description`, `kicker`, `kickerSuggestions[]`,
  `finale`, `finaleTarget`, `time{start,end,zone}`, `segments[]{mode,pts}`,
  `media[]{id,type,src,takenAt,caption,anchor,placement,gpsAnchor?,poster?,durationS?,thumb?}`,
  `audio[]{file,size}`, `autoWeather[]{from,mode,intensity?}`, `edits`
- Aufrufer: src/studio/api.ts

### GET /api/tours (ohne Anmeldedaten: leere Liste; sonst Sitzung)
- Response: `tours[]{id, no ("N°01"), status, visibility, title, stats, cover, coverThumb, error, createdAt}`
  (stats: `km`, `gainM`, `placedMedia?`, `trackSignature?{d,start,end}`, `filmS?`, `finale?`)
- Aufrufer: src/studio/api.ts, src/remote.ts, android ApiClient.kt

### GET /api/tours/:id (Sichtbarkeit)
- Response bereit: das tour.json; `schema`, `id`, `no`, `status`, `brandTitle`, `kicker`,
  `titleHtml`, `stops`, `showFinale`, `finaleTitle`, `description`, `time`,
  `segments[]{mode,label,pts,f?}`,
  `media[]{id,type,src,title,caption,anchor,placement,takenAt,durationS?,poster?,thumb?,display?,order?}`,
  `timeline?[]{f,t}`, `weather?[]{f,mode,k,source}`, `camera?[]{f,preset,scale?,filmS?}`,
  `moments?[]{f,kind,durationS?,filmS?}`,
  `audio?[]{type,src,f0,f1,gain?,loop?,startS?,filmS?,filmToS?}`, `stats`,
  dazu frisch eingesetzt `author{displayName,avatarUrl,id?,handle?}`
- Response nicht bereit: `id`, `status`, `error?` (nur Owner)
- Aufrufer: src/studio/api.ts, src/remote.ts, android ApiClient.kt

### DELETE /api/tours/:id (Besitzer)
- Response: `ok`; Aufrufer: src/studio/api.ts, android ApiClient.kt

---

## media (routes/media.ts)

### PUT /api/tours/:id/media/:mid (Besitzer; roher Binär-Body)
- Response: `id`, `bytes` (409 bei „bereit"+vorhanden, Tombstone, laufender Verarbeitung; 413 Quota)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### POST /api/tours/:id/media (Besitzer + verifiziert, JSON-Schema)
- Request: `media[]{type,file,takenAt,anchor?,caption?,durationS?,source?}` (IDs vergibt der Server)
- Response: `media[]{id,file}` (indexgleich zur Anfrage), `new`
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### DELETE /api/tours/:id/media/:mid (Besitzer)
- Response: `ok` (Tombstone bleibt im Manifest; rendert neu)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### PUT /api/tours/:id/track (Besitzer; roher GPX-Body)
- Response: `bytes`; Aufrufer: src/studio/api.ts, android ApiClient.kt

### PUT /api/tours/:id/audio/:file (Besitzer; roher Binär-Body; kein Überschreiben)
- Response: `file`, `bytes`; Aufrufer: src/studio/api.ts

### DELETE /api/tours/:id/audio/:file (Besitzer; nur wenn Edits die Datei nicht nutzen)
- Response: `ok`; Aufrufer: src/studio/api.ts

### GET /api/media/:tourId/:file (Sichtbarkeit; Range-Support)
- Response: Binär (Bild/Video/Audio/Poster; private → private-Cache)
- Aufrufer: src/studio/editor.ts (Audio-Quelle), src/exif.ts (Range-Fetch);
  Player/Editor datengetrieben über `src`/`poster`/`thumb` aus tour.json und /editor

---

## audio-bibliothek (routes/bibliothek.ts)

### GET /api/audio-library (Sitzung)
- Response: `files[]{file,size,usedBy[]{id,title}}`
- Aufrufer: src/studio/api.ts

### PUT /api/audio-library/:file (Sitzung; Binär-Body; kein Überschreiben)
- Response: `file`, `bytes`; Aufrufer: src/studio/api.ts

### GET /api/audio-library/:file (Sitzung; nur die eigene Datei; Range)
- Response: Binär; Aufrufer: src/studio/editor.ts (Vorhören)

### DELETE /api/audio-library/:file (Sitzung; nur wenn keine Tour sie nutzt)
- Response: `ok`; Aufrufer: src/studio/api.ts

### GET /api/tours/:id/library-audio/:file (Sichtbarkeit + Tour muss referenzieren; Range)
- Response: Binär
- Aufrufer: kein Code-Literal; datengetrieben als `audio[].src` im tour.json (Player)

---

## galerie / profil (routes/galerie.ts)

### GET /api/gallery (öffentlich)
- Query: `limit` (1–60, Standard 24), `offset`
- Response: `tours[]{id,title,cover,coverThumb,km,createdAt,author{displayName,avatarUrl,id?,handle?}|null}`, `hasMore`
- Aufrufer: src/gallery/gallery.ts

### GET /api/users/:id/profile (öffentlich; Besitzer sieht sein privates Profil)
- Params: Handle oder `u_…`-ID
- Response: `handle`, `displayName`, `bio`, `location`, `website`, `instagram`, `avatarUrl`,
  `bannerUrl`, `memberSince`, `stats{tours,km,elevationGain}`, `ownerOnly`, `tours[]` (Galerie-Karten)
- Aufrufer: src/profile/profile.ts

---

## warteliste (routes/warteliste.ts)

### POST /api/auth/waitlist (öffentlich, Bremse)
- Request: `email`, `note?`; Response: immer `ok`
- Aufrufer: src/studio/api.ts

### POST /api/auth/waitlist/confirm (öffentlich, Bremse)
- Request: `token`; Response: `ok`, `email`
- Aufrufer: src/studio/api.ts

### POST /api/auth/waitlist/leave (öffentlich, Bremse)
- Request: `token`; Response: immer `ok`
- Aufrufer: src/studio/api.ts

### GET /api/admin/waitlist (Admin)
- Response: `entries[]{id,email,note,joinedAt,confirmedAt,invitedAt,invitedCode,state}`,
  `waitlistOpen`, `offered`
- Aufrufer: src/admin/api.ts

### POST /api/admin/waitlist/:id/invite (Admin)
- Request: `validDays?`; Response: `entry`, `invitation`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/waitlist/:id (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

---

## newsletter (routes/newsletter.ts)

### POST /api/newsletter/unsubscribe (öffentlich, Bremse)
- Request: `token` (signiert, ohne Frist); Response: `ok`
- Aufrufer: src/account/account.ts (`/account#newsletter-off=…`)

### POST /api/newsletter/one-click/:token (öffentlich, Bremse; RFC 8058)
- Request/Response: leer (Antwort geht an ein Mail-Programm)
- Aufrufer: kein Code; nur List-Unsubscribe-Kopfzeilen der System-Mails

---

## rueckmeldungen (routes/rueckmeldungen.ts)

### POST /api/feedback (öffentlich, Bremse; angemeldet wird die Konto-ID angehängt)
- Request: `body`, `email?`, `context?` (nur die Felder `page,version,browser,platform,screen,language,appVersion,device,androidVersion` kommen durch), `source?` (web|app)
- Response: `ok`
- Aufrufer: src/feedback-form.ts (Web + App-WebView `/feedback?app=1`)

### GET /api/admin/feedback (Admin)
- Query: `status` (offen|in_arbeit|erledigt)
- Response: `feedback[]{id,userId,userName,email,body,context,source,status,note,createdAt,updatedAt}`, `counts{open,in_progress,done,total}`
- Aufrufer: src/admin/api.ts

### PATCH /api/admin/feedback/:id (Admin)
- Request: `status?`, `note?` (auch null); Response: `feedback`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/feedback/:id (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

---

## admin (routes/admin.ts)

### GET /api/admin/stats (Admin)
- Response: `realtime`, `today{pageviews,visitors}`, `last7Days{pageviews,visitors}`, `total`,
  `referrer[]{source,count}`, `pages[]{path,count}` (Umami; bei Ausfall Nullen)
- Aufrufer: src/admin/api.ts

### GET /api/admin/users (Admin)
- Response: `user[]{id,email,name,role,verified,createdAt,displayName,tours,fixed,storage}`, `quotaLimit`
- Aufrufer: src/admin/api.ts

### POST /api/admin/users (Admin)
- Request: `email`, `password`, `name`, `role?`, `verified?`; Response 201: `user`
- Aufrufer: src/admin/api.ts

### PATCH /api/admin/users/:id (Admin)
- Request: `email?`, `name?`, `role?`, `verified?`, `password?`; Response: `user`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/users/:id (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

### GET /api/admin/invitations (Admin)
- Response: `invitations[]{code,note,createdAt,createdBy,expiresAt,redeemedAt,redeemedBy,state}`,
  `invitationRequired`, `registrationOpen`, `baseUrl`
- Aufrufer: src/admin/api.ts

### POST /api/admin/invitations (Admin)
- Request: `note?`, `validDays?` (0 = ohne Ablauf); Response 201: `invitation`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/invitations/:code (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

### PATCH /api/admin/settings (Admin)
- Request: `invitationRequired?`, `waitlistOpen?`; Response: beide Felder (ganzer Stand)
- Aufrufer: src/admin/api.ts

### GET /api/admin/mail-templates (Admin)
- Response: `templates[]{key,…,blocks{subject,title,body,button,footer},customized,updatedAt,updatedBy}`, `baseUrl`
- Aufrufer: src/admin/api.ts

### PATCH /api/admin/mail-templates/:key (Admin)
- Request: `subject`, `title`, `body`, `button`, `footer`; Response: `templates[]`; 400: `error`, `issues[]`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/mail-templates/:key (Admin; auf Standard zurück)
- Response: `templates[]`; Aufrufer: src/admin/api.ts

### POST /api/admin/mail-templates/:key/preview (Admin)
- Request: Bausteine; Response: `subject`, `body`, `html`, `issues[]`
- Aufrufer: src/admin/api.ts

### POST /api/admin/mail-templates/:key/test (Admin; Testmail an die eigene Adresse)
- Request: `blocks?`; Response: `ok`, `enabled`
- Aufrufer: src/admin/api.ts

### GET /api/admin/audit-log (Admin)
- Query: `level` (failed|warning), `since` (höchste bekannte Nummer)
- Response: `entries[]{no,at,level,body,detail?}`, `total`, `errorCount`, `startedAt`
- Aufrufer: src/admin/api.ts (nutzt nur `since`; `level` wird vom Web nicht gesetzt)

---

## export (routes/export.ts)

### POST /api/auth/me/export (Sitzung, Bremse 5/h)
- Response: `ok`, `dataExport{id,status,requestedAt,finishedAt,expiresAt,bytes,files}` (Bau läuft danach im Hintergrund)
- Aufrufer: src/account/account.ts

### GET /api/export/:token (öffentlich; signierter Token ist der Nachweis)
- Response: ZIP-Download (`private, no-store`)
- Aufrufer: kein Code; der Link steht in der Export-Mail

---

## tracker (routes/tracker.ts)

### GET /api/tracker/providers (Sitzung)
- Response: `provider[]{id,name,available,connected,status,connectedAt,lastSyncAt,error}`
- Aufrufer: src/account/tracker-card.ts, android ApiClient.kt

### POST /api/tracker/:provider/connect (Sitzung)
- Request: `target?` (web|app); Response: `authorizationUrl`
- Aufrufer: src/account/tracker-card.ts, android ApiClient.kt

### GET /api/tracker/:provider/callback (öffentlich; OAuth-Rückkehr, serverseitiger state)
- Query: `code`, `state`, `error`
- Response: Redirect (`/konto#tracker=verbunden|abgebrochen|abgelaufen|fehler` oder `maptale://tracker/<id>?ok=1`)
- Aufrufer: kein Code; der Anbieter leitet den Browser hierher

### DELETE /api/tracker/:provider (Sitzung)
- Response: `ok`, `toursKept`
- Aufrufer: src/account/tracker-card.ts, android ApiClient.kt

### POST /api/tracker/:provider/sync (Sitzung, Bremse 6/10 min)
- Response: `found`, `new`, `inBackground`
- Aufrufer: **KEINER** (s. Befunde)

### GET /api/tracker/imports (Sitzung)
- Response: `imports[]{id,userId,provider,externalId,status,tourId,reportedAt,finishedAt,seenAt,error,attempts,retryable,tour{title,km,placedMedia,status,visibility}|null}`
- Aufrufer: src/account/tracker-card.ts

### GET /api/tracker/imports/pending (Sitzung)
- Query: `seen` (=1 quittiert alles Offene)
- Response: `imports[]` (ohne tour-Anhang)
- Aufrufer: android ApiClient.kt

### POST /api/tracker/imports/seen (Sitzung)
- Request: `ids[]`; Response: `ok`
- Aufrufer: android ApiClient.kt

---

## push (routes/push.ts)

### POST /api/push/devices (Sitzung; das Gerät hängt am App-Token)
- Request: `token`, `platform` (android|ios)
- Response: `ok`, `push`, `deviceId?` (push=false wenn FCM nicht konfiguriert)
- Aufrufer: android ApiClient.kt

### DELETE /api/push/devices (Sitzung; Token im Body, nicht im Pfad)
- Request: `token`; Response: `ok`
- Aufrufer: android ApiClient.kt

---

## webhooks (routes/tracker-webhooks.ts; eigener Plugin-Bereich, roher Body)

### GET /api/webhooks/tracker/:provider (öffentlich; Abo-Prüfung des Anbieters)
- Response: anbieterabhängig; Aufrufer: extern (Anbieter)

### POST /api/webhooks/tracker/:provider (öffentlich; Autorität = Signatur, Body-Limit 64 KB)
- Response: `ok` (Arbeit läuft nach der Antwort); Aufrufer: extern (Polar u. a.)

---

## seiten (routes/seiten.ts; HTML/XML, öffentlich)

### GET /@:handle
- Response: gebautes profil.html mit ersetztem Meta-Block (privat/unbekannt: generisch + noindex)
- Aufrufer: Browser-Navigation (`profilePath` in src/routes.ts baut die Links)

### GET /tour/:kennung
- Response: erlebnis.html mit Tour-Meta (`index` nur public; private Tour für Fremde 404)
- Aufrufer: Browser-Navigation (`tourPath`), android PlayerScreen.kt (`?app=1`), TeilenLink.kt

### GET /sitemap-profile.xml, GET /sitemap-touren.xml
- Response: XML aus der Datenbank; Aufrufer: Suchmaschinen (robots.txt nennt sie)

---

## sonstiges (app.ts)

### GET /api/health (öffentlich)
- Response: `ok`
- Aufrufer: kein Code; nur `curl` im Runbook docs/ops/deploy-cloudpanel.md

---

## Befunde: einseitige Pfade

**Registriert, aber von keinem Client-Code gerufen:**

1. **POST /api/tracker/:provider/sync**; der einzige echte Verdachtsfall: weder Web
   (tracker-card.ts) noch Android rufen ihn. Der „Jetzt abrufen"-Knopf, für den die Route
   samt Bremse gebaut ist, existiert in keiner Oberfläche.
2. GET /api/health; nur ops (curl im Runbook). Absicht (Health-Check).
3. GET /api/export/:token; nur Mail-Link. Absicht.
4. POST /api/newsletter/one-click/:token; nur Mail-Kopfzeilen (RFC 8058). Absicht.
5. GET/POST /api/webhooks/tracker/:provider; externe Anbieter. Absicht.
6. GET /api/tracker/:provider/callback; OAuth-Redirect des Anbieters. Absicht.
7. GET /api/users/:id/banner, GET /api/users/:id/avatar,
   GET /api/tours/:id/library-audio/:file, GET /sitemap-*.xml, GET /@:handle,
   GET /tour/:kennung; nur datengetrieben (URLs aus Server-Antworten, Browser-Navigation,
   robots.txt). Kein Code-Literal auf Aufruferseite, aber in Benutzung.

**Gerufen, aber nie registriert:** keiner gefunden; jeder fetch-/OkHttp-Pfad in Web und
Android trifft eine registrierte Route.

**Nur von einer Plattform gerufen (kein Befund, aber für die Abbildungstabelle relevant):**
- Nur Android: session-aus-token, GET edits, imports/pending, imports/gesehen, push/geraete
- Nur Web: audio-bibliothek*, tours/:id/audio/*, tours/:id/editor, alle /konto- und /admin-Routen,
  galerie, benutzer/:id/profil, warteliste (öffentlich), newsletter/abmelden, export, titelbild

## Gesamtzahl

**95 Routen-Registrierungen** (Skript-Zählung, keine Registrierung mit Variablen-Pfad,
keine `app.route({})`-Objekte, keine `register`-Präfixe).
