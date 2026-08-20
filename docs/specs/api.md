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

Auth-Stufen: **öffentlich** (kein Guard), **Sitzung** (`erfordereBenutzer`,
Cookie oder Bearer-Token), **Besitzer** (Sitzung plus `nurOwner`), **Admin**
(`erfordereAdmin`), **Sichtbarkeit** (öffentlich, aber `darfSehen`: private nur
für den Besitzer). „Bremse" heißt Rate-Limit.

Fehlerantworten tragen überall `{ fehler }`, Validierungsfehler zusätzlich
`details`.

---

## auth (routes/auth.ts)

### POST /api/auth/login (öffentlich, Bremse)
- Request: `email`, `passwort`, `tokenLabel?`
- Response: `benutzer{id,email,name,rolle}`, `apiToken?` (nur mit tokenLabel; dann KEINE Sitzung)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### POST /api/auth/register (öffentlich, Bremse)
- Request: `email`, `passwort`, `name?`, `code?` (Einladung), `newsletter?`
- Response 201: `benutzer`, `verifiziert` (false)
- Aufrufer: src/studio/api.ts

### POST /api/auth/einladung-pruefen (öffentlich, Bremse)
- Request: `code`; Response: `ok`, `pflicht`
- Aufrufer: src/studio/api.ts

### POST /api/auth/verifiziere (öffentlich)
- Request: `token`; Response: `ok` (setzt Session-Cookie)
- Aufrufer: src/studio/api.ts

### POST /api/auth/passwort-reset-anfordern (öffentlich, Bremse)
- Request: `email`; Response: immer `ok` (keine Existenz-Auskunft)
- Aufrufer: src/studio/api.ts

### POST /api/auth/passwort-reset (öffentlich)
- Request: `token`, `passwort`; Response: `ok`
- Aufrufer: src/studio/api.ts

### POST /api/auth/session-aus-token (Sitzung; praktisch nur Bearer)
- Request: –; Response: `sessionId`, `ablauf`
- Aufrufer: android ApiClient.kt (WebView-Player)

### POST /api/auth/logout (öffentlich; wirkt auf Cookie)
- Response: `ok`
- Aufrufer: src/studio/api.ts, src/app-nav.ts

### POST /api/auth/me/passwort (Sitzung, Bremse)
- Request: `alt`, `neu`; Response: `ok` (beendet alle anderen Zugänge)
- Aufrufer: src/konto/kontodialoge.ts

### POST /api/auth/me/email (Sitzung, Bremse)
- Request: `email`, `passwort`; Response: immer `ok` (Mail an NEUE Adresse; Wechsel erst beim Klick)
- Aufrufer: src/konto/kontodialoge.ts

### POST /api/auth/email-bestaetigen (öffentlich; Token ist der Nachweis)
- Request: `token`; Response: `ok`, `email`
- Aufrufer: src/konto/konto.ts (`/konto#email=…`)

### GET /api/auth/me/geraete (Sitzung)
- Response: `geraete[]{id ("sitzung:…"/"app:…"), art ("sitzung"|"app"), kennung, ipPraefix, angemeldetAm, zuletztGesehen, dieses}`
- Aufrufer: src/konto/konto.ts

### DELETE /api/auth/me/geraete/:id (Sitzung)
- Response: `ok`
- Aufrufer: src/konto/konto.ts

### POST /api/auth/me/newsletter (Sitzung)
- Request: `an`; Response: `ok`, `newsletter`, `versandRuht`
- Aufrufer: src/konto/konto.ts

### POST /api/auth/me/suchmaschinen (Sitzung)
- Request: `an`; Response: `ok`, `suchmaschinen`, `wirktRuht`
- Aufrufer: src/konto/konto.ts

### GET /api/auth/me/speicher (Sitzung)
- Response: `benutzt`, `limit`, `frei`, `aufteilung{fotos,videos,klaenge,aufzeichnungen,sonstiges}`
- Aufrufer: src/konto/konto.ts

### DELETE /api/auth/me (Sitzung)
- Response: `ok` (Konto samt Storage weg)
- Aufrufer: src/studio/api.ts, src/konto/kontodialoge.ts, android ApiClient.kt

### GET /api/auth/me (öffentlich; angereichert bei Sitzung)
- Response ohne Anmeldung: `benutzer: null`, `registrierung{offen,einladungPflicht,warteliste}`
- Response angemeldet zusätzlich: `verifiziert`, `quota{benutzt,limit,frei}`, `newsletter`,
  `profil{handle,anzeigename,bio,ort,website,instagram,avatarUrl,titelbild,titelbildUrl,sichtbarkeit,suchmaschinen}`,
  `export{id,status,angefordertAm,fertigAm,laeuftAbAm,bytes,dateien}|null`
- Aufrufer: src/studio/api.ts, src/admin/api.ts, src/app-nav.ts, src/konto/konto.ts, src/profil/profil.ts, android ApiClient.kt

### PATCH /api/auth/me/profil (Sitzung)
- Request: `anzeigename?`, `bio?`, `ort?`, `website?`, `instagram?`, `sichtbarkeit?` (private|public), `handle?`, `titelbild?` (Vorschlags-Name; '' entfernt)
- Response: das Profil-Objekt (wie in /auth/me)
- Aufrufer: src/konto/konto.ts, src/profil/profilbearbeiten.ts, android ApiClient.kt

### PUT /api/auth/me/avatar (Sitzung; roher Bild-Body, max 2 MB)
- Response: `avatarUrl`
- Aufrufer: src/profil/profilbearbeiten.ts, android ApiClient.kt

### DELETE /api/auth/me/avatar (Sitzung)
- Response: `ok`; Aufrufer: src/profil/profilbearbeiten.ts, android ApiClient.kt

### PUT /api/auth/me/titelbild (Sitzung; roher Bild-Body, max 8 MB)
- Response: `titelbildUrl`; Aufrufer: src/profil/profilbearbeiten.ts

### DELETE /api/auth/me/titelbild (Sitzung)
- Response: `ok`; Aufrufer: src/profil/profilbearbeiten.ts

### GET /api/benutzer/:id/titelbild (öffentlich)
- Response: Binär (JPEG, immutable-Cache)
- Aufrufer: kein Code-Literal; datengetrieben als `titelbildUrl` aus Profil-Antworten (img src)

### GET /api/benutzer/:id/avatar (öffentlich)
- Query: `v` (Cache-Buster, Dateiname)
- Response: Binär (JPEG)
- Aufrufer: datengetrieben als `avatarUrl` aus Profil-/Galerie-/Tour-Antworten

---

## tours (routes/tours.ts)

### POST /api/tours (Sitzung + E-Mail-verifiziert)
- Request (UploadManifest, JSON-Schema): `schema`, `clientTourId?`, `title?`, `description?`,
  `time{start,end,zone}`, `segments?[]{mode,label?,pts}`, `trackFile?`, `trackMode?`,
  `modiAutomatisch?`, `media[]{id,type,file,takenAt,anchor?,caption?,durationS?,quelle?}`
- Response 201: `id`; 200 bei Wiederholung: `id`, `wiederverwendet`
- Aufrufer: src/studio/api.ts, android ApiClient.kt (auch tracker/touranleger.ts serverintern)

### POST /api/tours/:id/finalize (Besitzer)
- Response 202: `id`, `status` ("verarbeitung"); 409: `fehler`, `fehlend?[]`
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### PATCH /api/tours/:id (Besitzer)
- Request: `title?`, `description?`, `dachzeile?`, `finale?`, `finaleZiel?`, `visibility?` (private|unlisted|public)
- Response: `ok` (rendert Texte ggf. asynchron nach)
- Aufrufer: src/studio/api.ts, android ApiClient.kt (patchTour + setzeSichtbarkeit)

### GET /api/tours/:id/edits (Besitzer)
- Response: EditOverlay `{schema, medien?, modi?, trim?, kamera?, momente?, audio?, wetter?, titelbild?}`
- Aufrufer: android ApiClient.kt (das Studio bezieht die Edits über /editor)

### PUT /api/tours/:id/edits (Besitzer, JSON-Schema)
- Request: EditOverlay; Unterfelder: `medien{<id>:{caption?,anchor?,geloescht?,display{holdS?,kenBurns?},reihe?,trim{vonS,bisS?}}}`,
  `modi[]{ab,mode}`, `trim{start?,ende?}`, `kamera[]{ab,preset,skala?}`, `momente[]{ab,art,dauerS?}`,
  `audio[]{datei,typ,ab,bis?,anker?,versatzFilmS?,dauerFilmS?,einstiegS?,loop?,lautstaerke?,quelle?}`,
  `wetter[]{ab,mode,staerke?}`, `titelbild?`
- Response: `ok`, `status` (202 bei Re-Render)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### POST /api/tours/:id/reprocess (Besitzer)
- Response 202: `id`, `status`; Aufrufer: src/studio/api.ts, android ApiClient.kt

### GET /api/tours/:id/editor (Besitzer)
- Response: `id`, `status`, `title`, `description`, `dachzeile`, `dachzeileVorschlaege[]`,
  `finale`, `finaleZiel`, `time{start,end,zone}`, `segmente[]{mode,pts}`,
  `medien[]{id,type,src,takenAt,caption,anchor,placement,gpsAnker?,poster?,dauerS?,thumb?}`,
  `audio[]{datei,groesse}`, `autoWetter[]{ab,mode,staerke?}`, `edits`
- Aufrufer: src/studio/api.ts

### GET /api/tours (ohne Anmeldedaten: leere Liste; sonst Sitzung)
- Response: `tours[]{id, no ("N°01"), status, visibility, title, stats, cover, coverThumb, fehler, createdAt}`
  (stats: `km`, `gainM`, `fotos?`, `spur?{d,start,ende}`, `filmS?`, `finale?`)
- Aufrufer: src/studio/api.ts, src/remote.ts, android ApiClient.kt

### GET /api/tours/:id (Sichtbarkeit)
- Response bereit: das tour.json; `schema`, `id`, `no`, `status`, `brandTitle`, `kicker`,
  `titleHtml`, `stops`, `showFinale`, `finaleTitle`, `description`, `time`,
  `segments[]{mode,label,pts,f?}`,
  `media[]{id,type,src,title,caption,anchor,placement,takenAt,durationS?,poster?,thumb?,display?,reihe?}`,
  `timeline?[]{f,t}`, `weather?[]{f,mode,k,source}`, `camera?[]{f,preset,skala?,filmS?}`,
  `moments?[]{f,art,dauerS?,filmS?}`,
  `audio?[]{type,src,f0,f1,gain?,loop?,startS?,filmS?,filmBisS?}`, `stats`,
  dazu frisch eingesetzt `autor{anzeigename,avatarUrl,id?,handle?}`
- Response nicht bereit: `id`, `status`, `fehler?` (nur Owner)
- Aufrufer: src/studio/api.ts, src/remote.ts, android ApiClient.kt

### DELETE /api/tours/:id (Besitzer)
- Response: `ok`; Aufrufer: src/studio/api.ts, android ApiClient.kt

---

## media (routes/media.ts)

### PUT /api/tours/:id/media/:mid (Besitzer; roher Binär-Body)
- Response: `id`, `bytes` (409 bei „bereit"+vorhanden, Tombstone, laufender Verarbeitung; 413 Quota)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### POST /api/tours/:id/medien (Besitzer + verifiziert, JSON-Schema)
- Request: `medien[]{type,file,takenAt,anchor?,caption?,durationS?,quelle?}` (IDs vergibt der Server)
- Response: `medien[]{id,datei}` (indexgleich zur Anfrage), `neu`
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### DELETE /api/tours/:id/media/:mid (Besitzer)
- Response: `ok` (Tombstone bleibt im Manifest; rendert neu)
- Aufrufer: src/studio/api.ts, android ApiClient.kt

### PUT /api/tours/:id/track (Besitzer; roher GPX-Body)
- Response: `bytes`; Aufrufer: src/studio/api.ts, android ApiClient.kt

### PUT /api/tours/:id/audio/:datei (Besitzer; roher Binär-Body; kein Überschreiben)
- Response: `datei`, `bytes`; Aufrufer: src/studio/api.ts

### DELETE /api/tours/:id/audio/:datei (Besitzer; nur wenn Edits die Datei nicht nutzen)
- Response: `ok`; Aufrufer: src/studio/api.ts

### GET /api/media/:tourId/:datei (Sichtbarkeit; Range-Support)
- Response: Binär (Bild/Video/Audio/Poster; private → private-Cache)
- Aufrufer: src/studio/editor.ts (Audio-Quelle), src/exif.ts (Range-Fetch);
  Player/Editor datengetrieben über `src`/`poster`/`thumb` aus tour.json und /editor

---

## audio-bibliothek (routes/bibliothek.ts)

### GET /api/audio-bibliothek (Sitzung)
- Response: `dateien[]{datei,groesse,verwendetVon[]{id,titel}}`
- Aufrufer: src/studio/api.ts

### PUT /api/audio-bibliothek/:datei (Sitzung; Binär-Body; kein Überschreiben)
- Response: `datei`, `bytes`; Aufrufer: src/studio/api.ts

### GET /api/audio-bibliothek/:datei (Sitzung; nur die eigene Datei; Range)
- Response: Binär; Aufrufer: src/studio/editor.ts (Vorhören)

### DELETE /api/audio-bibliothek/:datei (Sitzung; nur wenn keine Tour sie nutzt)
- Response: `ok`; Aufrufer: src/studio/api.ts

### GET /api/tours/:id/bibliothek-audio/:datei (Sichtbarkeit + Tour muss referenzieren; Range)
- Response: Binär
- Aufrufer: kein Code-Literal; datengetrieben als `audio[].src` im tour.json (Player)

---

## galerie / profil (routes/galerie.ts)

### GET /api/galerie (öffentlich)
- Query: `limit` (1–60, Standard 24), `offset`
- Response: `touren[]{id,titel,cover,coverThumb,km,erstelltAm,autor{anzeigename,avatarUrl,id?,handle?}|null}`, `mehr`
- Aufrufer: src/galerie/galerie.ts

### GET /api/benutzer/:id/profil (öffentlich; Besitzer sieht sein privates Profil)
- Params: Handle oder `u_…`-ID
- Response: `handle`, `anzeigename`, `bio`, `ort`, `website`, `instagram`, `avatarUrl`,
  `titelbildUrl`, `dabeiSeit`, `kennzahlen{touren,km,hm}`, `nurFuerDich`, `touren[]` (Galerie-Karten)
- Aufrufer: src/profil/profil.ts

---

## warteliste (routes/warteliste.ts)

### POST /api/auth/warteliste (öffentlich, Bremse)
- Request: `email`, `notiz?`; Response: immer `ok`
- Aufrufer: src/studio/api.ts

### POST /api/auth/warteliste/bestaetigen (öffentlich, Bremse)
- Request: `token`; Response: `ok`, `email`
- Aufrufer: src/studio/api.ts

### POST /api/auth/warteliste/austragen (öffentlich, Bremse)
- Request: `token`; Response: immer `ok`
- Aufrufer: src/studio/api.ts

### GET /api/admin/warteliste (Admin)
- Response: `eintraege[]{id,email,notiz,eingetragenAm,bestaetigtAm,eingeladenAm,eingeladenCode,zustand}`,
  `wartelisteOffen`, `angeboten`
- Aufrufer: src/admin/api.ts

### POST /api/admin/warteliste/:id/einladen (Admin)
- Request: `gueltigTage?`; Response: `eintrag`, `einladung`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/warteliste/:id (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

---

## newsletter (routes/newsletter.ts)

### POST /api/newsletter/abmelden (öffentlich, Bremse)
- Request: `token` (signiert, ohne Frist); Response: `ok`
- Aufrufer: src/konto/konto.ts (`/konto#newsletter-aus=…`)

### POST /api/newsletter/ein-klick/:token (öffentlich, Bremse; RFC 8058)
- Request/Response: leer (Antwort geht an ein Mail-Programm)
- Aufrufer: kein Code; nur List-Unsubscribe-Kopfzeilen der System-Mails

---

## rueckmeldungen (routes/rueckmeldungen.ts)

### POST /api/rueckmeldung (öffentlich, Bremse; angemeldet wird die Konto-ID angehängt)
- Request: `text`, `email?`, `kontext?` (nur die Felder `seite,version,browser,plattform,schirm,sprache,appVersion,geraet,androidVersion` kommen durch), `quelle?` (web|app)
- Response: `ok`
- Aufrufer: src/feedbackformular.ts (Web + App-WebView `/feedback?app=1`)

### GET /api/admin/rueckmeldungen (Admin)
- Query: `status` (offen|in_arbeit|erledigt)
- Response: `rueckmeldungen[]{id,benutzerId,benutzerName,email,text,kontext,quelle,status,notiz,angelegtAm,geaendertAm}`, `zaehlung{offen,in_arbeit,erledigt,gesamt}`
- Aufrufer: src/admin/api.ts

### PATCH /api/admin/rueckmeldungen/:id (Admin)
- Request: `status?`, `notiz?` (auch null); Response: `rueckmeldung`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/rueckmeldungen/:id (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

---

## admin (routes/admin.ts)

### GET /api/admin/statistiken (Admin)
- Response: `echtzeit`, `heute{aufrufe,besucher}`, `letzte7Tage{aufrufe,besucher}`, `gesamt`,
  `referrer[]{quelle,anzahl}`, `seiten[]{pfad,anzahl}` (Umami; bei Ausfall Nullen)
- Aufrufer: src/admin/api.ts

### GET /api/admin/benutzer (Admin)
- Response: `benutzer[]{id,email,name,rolle,verifiziert,angelegtAm,anzeigename,touren,fest,speicher}`, `quotaLimit`
- Aufrufer: src/admin/api.ts

### POST /api/admin/benutzer (Admin)
- Request: `email`, `passwort`, `name`, `rolle?`, `verifiziert?`; Response 201: `benutzer`
- Aufrufer: src/admin/api.ts

### PATCH /api/admin/benutzer/:id (Admin)
- Request: `email?`, `name?`, `rolle?`, `verifiziert?`, `passwort?`; Response: `benutzer`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/benutzer/:id (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

### GET /api/admin/einladungen (Admin)
- Response: `einladungen[]{code,notiz,erstelltAm,erstelltVon,ablauf,eingeloestAm,eingeloestVon,zustand}`,
  `einladungPflicht`, `registrierungOffen`, `basisUrl`
- Aufrufer: src/admin/api.ts

### POST /api/admin/einladungen (Admin)
- Request: `notiz?`, `gueltigTage?` (0 = ohne Ablauf); Response 201: `einladung`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/einladungen/:code (Admin)
- Response: `ok`; Aufrufer: src/admin/api.ts

### PATCH /api/admin/einstellungen (Admin)
- Request: `einladungPflicht?`, `wartelisteOffen?`; Response: beide Felder (ganzer Stand)
- Aufrufer: src/admin/api.ts

### GET /api/admin/mailvorlagen (Admin)
- Response: `vorlagen[]{schluessel,…,bausteine{betreff,titel,text,knopf,fuss},angepasst,geaendertAm,geaendertVon}`, `basisUrl`
- Aufrufer: src/admin/api.ts

### PATCH /api/admin/mailvorlagen/:schluessel (Admin)
- Request: `betreff`, `titel`, `text`, `knopf`, `fuss`; Response: `vorlagen[]`; 400: `fehler`, `probleme[]`
- Aufrufer: src/admin/api.ts

### DELETE /api/admin/mailvorlagen/:schluessel (Admin; auf Standard zurück)
- Response: `vorlagen[]`; Aufrufer: src/admin/api.ts

### POST /api/admin/mailvorlagen/:schluessel/vorschau (Admin)
- Request: Bausteine; Response: `betreff`, `text`, `html`, `probleme[]`
- Aufrufer: src/admin/api.ts

### POST /api/admin/mailvorlagen/:schluessel/test (Admin; Testmail an die eigene Adresse)
- Request: `bausteine?`; Response: `ok`, `an`
- Aufrufer: src/admin/api.ts

### GET /api/admin/protokoll (Admin)
- Query: `stufe` (fehler|warnung), `seit` (höchste bekannte Nummer)
- Response: `eintraege[]{nr,zeit,stufe,text,detail?}`, `gesamt`, `fehler`, `gestartet`
- Aufrufer: src/admin/api.ts (nutzt nur `seit`; `stufe` wird vom Web nicht gesetzt)

---

## export (routes/export.ts)

### POST /api/auth/me/export (Sitzung, Bremse 5/h)
- Response: `ok`, `export{id,status,angefordertAm,fertigAm,laeuftAbAm,bytes,dateien}` (Bau läuft danach im Hintergrund)
- Aufrufer: src/konto/konto.ts

### GET /api/export/:token (öffentlich; signierter Token ist der Nachweis)
- Response: ZIP-Download (`private, no-store`)
- Aufrufer: kein Code; der Link steht in der Export-Mail

---

## tracker (routes/tracker.ts)

### GET /api/tracker/providers (Sitzung)
- Response: `anbieter[]{id,name,verfuegbar,verbunden,status,verbundenSeit,zuletztSync,fehler}`
- Aufrufer: src/konto/trackerkarte.ts, android ApiClient.kt

### POST /api/tracker/:provider/connect (Sitzung)
- Request: `ziel?` (web|app); Response: `autorisierungsUrl`
- Aufrufer: src/konto/trackerkarte.ts, android ApiClient.kt

### GET /api/tracker/:provider/callback (öffentlich; OAuth-Rückkehr, serverseitiger state)
- Query: `code`, `state`, `error`
- Response: Redirect (`/konto#tracker=verbunden|abgebrochen|abgelaufen|fehler` oder `maptale://tracker/<id>?ok=1`)
- Aufrufer: kein Code; der Anbieter leitet den Browser hierher

### DELETE /api/tracker/:provider (Sitzung)
- Response: `ok`, `tourenBleiben`
- Aufrufer: src/konto/trackerkarte.ts, android ApiClient.kt

### POST /api/tracker/:provider/sync (Sitzung, Bremse 6/10 min)
- Response: `gefunden`, `neu`, `imHintergrund`
- Aufrufer: **KEINER** (s. Befunde)

### GET /api/tracker/imports (Sitzung)
- Response: `importe[]{id,benutzerId,anbieter,externeId,status,tourId,gemeldetAm,fertigAm,gesehenAm,fehler,versuche,wiederholbar,tour{titel,km,fotos,status,sichtbarkeit}|null}`
- Aufrufer: src/konto/trackerkarte.ts

### GET /api/tracker/imports/pending (Sitzung)
- Query: `gesehen` (=1 quittiert alles Offene)
- Response: `importe[]` (ohne tour-Anhang)
- Aufrufer: android ApiClient.kt

### POST /api/tracker/imports/gesehen (Sitzung)
- Request: `ids[]`; Response: `ok`
- Aufrufer: android ApiClient.kt

---

## push (routes/push.ts)

### POST /api/push/geraete (Sitzung; das Gerät hängt am App-Token)
- Request: `token`, `plattform` (android|ios)
- Response: `ok`, `push`, `geraetId?` (push=false wenn FCM nicht konfiguriert)
- Aufrufer: android ApiClient.kt

### DELETE /api/push/geraete (Sitzung; Token im Body, nicht im Pfad)
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
- Aufrufer: Browser-Navigation (`profilPfad` in src/routen.ts baut die Links)

### GET /tour/:kennung
- Response: erlebnis.html mit Tour-Meta (`index` nur public; private Tour für Fremde 404)
- Aufrufer: Browser-Navigation (`tourPfad`), android PlayerScreen.kt (`?app=1`), TeilenLink.kt

### GET /sitemap-profile.xml, GET /sitemap-touren.xml
- Response: XML aus der Datenbank; Aufrufer: Suchmaschinen (robots.txt nennt sie)

---

## sonstiges (app.ts)

### GET /api/gesundheit (öffentlich)
- Response: `ok`
- Aufrufer: kein Code; nur `curl` im Runbook docs/ops/deploy-cloudpanel.md

---

## Befunde: einseitige Pfade

**Registriert, aber von keinem Client-Code gerufen:**

1. **POST /api/tracker/:provider/sync**; der einzige echte Verdachtsfall: weder Web
   (trackerkarte.ts) noch Android rufen ihn. Der „Jetzt abrufen"-Knopf, für den die Route
   samt Bremse gebaut ist, existiert in keiner Oberfläche.
2. GET /api/gesundheit; nur ops (curl im Runbook). Absicht (Health-Check).
3. GET /api/export/:token; nur Mail-Link. Absicht.
4. POST /api/newsletter/ein-klick/:token; nur Mail-Kopfzeilen (RFC 8058). Absicht.
5. GET/POST /api/webhooks/tracker/:provider; externe Anbieter. Absicht.
6. GET /api/tracker/:provider/callback; OAuth-Redirect des Anbieters. Absicht.
7. GET /api/benutzer/:id/titelbild, GET /api/benutzer/:id/avatar,
   GET /api/tours/:id/bibliothek-audio/:datei, GET /sitemap-*.xml, GET /@:handle,
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
