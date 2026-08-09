# Umsetzung: Profil & Kontoeinstellungen

**Stand:** 6. August 2026 · Etappen 1–7 umgesetzt (Umsetzungsprotokoll, keine offene Roadmap).
**Mockup:** [docs/mockups/studio-konto.html](../mockups/studio-konto.html)
(Mockup-Leiste oben schaltet zwischen den Ansichten und Zuständen.)
**Newsletter:** Einwilligung hier (Etappe 4); Versand noch offen in
[konzept_newsletter.md](../concepts/konzept_newsletter.md).

Fünf Etappen, jede für sich deploybar. Die Reihenfolge ist nicht
Geschmackssache: Etappe 1 legt den Handle fest, und ein Handle, der einmal in
einer geteilten URL steht, ist nicht mehr frei änderbar. Alles andere kann
warten, das nicht.

---

## Etappe 1 — Der Handle und seine Adresse ✅

**Umgesetzt am 6. August 2026.** Der Vhost ist auf dem Server bereits nachgezogen
(`location ~ ^/@`, Sicherung daneben, `nginx -t` + Reload, Gegenprobe grün) — das
darf vor dem Code laufen. Der Rest wartet auf den nächsten Release.
Was wo liegt: [src/handle.ts](../../src/handle.ts) (Regeln, reservierte Wörter,
`zuHandle`) mit Server-Kopie [server/src/handle.ts](../../server/src/handle.ts)
und Drift-Wächter; `profilPfad`/`handleAusPfad` in
[src/routen.ts](../../src/routen.ts); Migration 11+12 in
[server/src/db.ts](../../server/src/db.ts); Vergabe und 90-Tage-Sperre in
[server/src/auth/auth.ts](../../server/src/auth/auth.ts).

**Ziel:** `maptale.io/@henrik` funktioniert, überall wo heute `?id=<uuid>` steht.
Ohne jede sichtbare Änderung an der Oberfläche.

**Server**
- Migration: `users.handle TEXT UNIQUE`, `users.handle_geaendert_am TEXT`.
- Neue Tabelle `handles_reserviert (handle, user_id, frei_ab)` — 90 Tage Sperre
  nach einer Änderung (Begründung: s. Mockup-Kommentar bei `zeigeHandleStand`).
- Vergabe beim Anlegen des Kontos: aus dem Lokalteil der E-Mail
  transliteriert (`zuHandle()` aus dem Mockup), bei Kollision mit Zähler.
  Bestandskonten bekommen ihren Handle in derselben Migration.
- Reservierte Wörter **neben** [src/routen.ts](../../src/routen.ts) pflegen, samt
  Drift-Wächter: Ein neuer Pfad darf keinen vergebenen Handle überschreiben.
- `GET /api/benutzer/:handle/profil` zusätzlich zur ID-Variante
  ([server/src/routes/galerie.ts](../../server/src/routes/galerie.ts) kennt heute
  nur `:id`).
- `PATCH /api/auth/me/profil` um `handle` erweitern, mit Prüfung gegen
  Regeln/Reservierung/Vergabe (dieselbe Logik wie im Mockup, aber serverseitig —
  die Client-Prüfung bleibt reine Bequemlichkeit).

**Web**
- [src/routen.ts](../../src/routen.ts): Eintrag `profil` bekommt eine Funktion
  `profilPfad(handle)` → `/@henrik`. Die alte Form `?id=…` bleibt als Alias
  bestehen und leitet weiter — Mail- und Chat-Links sind in der Welt.
- **Vhost von Hand nachziehen.** Der Deploy zieht ihn nicht mit; die Datei liegt
  auf dem Server unter `/etc/nginx/sites-enabled/maptale.io.conf` (SSH als
  `root@178.104.147.230`, Zugang ist eingerichtet). Neben die drei vorhandenen
  Studio-Aliasse gehört:

  ```nginx
  location ~ ^/@ { rewrite ^ /profil.html last; }
  ```

  Vorgehen: erst `cp maptale.io.conf maptale.io.conf.bak.<datum>` (so machen es
  die vorhandenen Sicherungen dort auch), dann `nginx -t`, dann
  `systemctl reload nginx`, dann Gegenprobe mit `curl -I https://maptale.io/@henrik`.
  [deploy/cloudpanel-nginx.conf](../../deploy/cloudpanel-nginx.conf) ist nur die
  Vorlage im Repo und muss dieselbe Zeile bekommen, sonst driftet sie weiter
  ab. Der Wächter in [test/routen.test.ts](../../test/routen.test.ts) prüft die
  neue Regel mit.
- Reihenfolge beim Ausrollen: Vhost zuerst schadet nicht (`/@…` antwortet dann
  mit der Profilseite, die den unbekannten Handle als „nicht gefunden" zeigt),
  Code danach. Umgekehrt wäre die Adresse für die Dauer eines Deploys tot.
- Dev-Middleware in [vite.config.js](../../vite.config.js) analog.

**Fallstrick:** `@` ist in URLs erlaubt, aber `encodeURIComponent('@')` macht
`%40` daraus. In `pfad()` also nicht durch die Query-Kodierung schicken.

---

## Etappe 2 — Die Profilseite ✅

**Umgesetzt am 6. August 2026.** Titelbild, Avatar, Handle, Ort, Links,
Kennzahl-Chips, Tourenraster und das Bearbeiten-Modal stehen; die vier
Vorschlagsbilder liegen in `public/titelbilder/`.
Nicht gebaut: die **Ortssuche**. Sie ist im Mockup ausdrücklich „eine Attrappe
derselben Idee" — echt wäre sie ein Nominatim-Aufruf an jedem Tastendruck, also
eine ratenbegrenzte Fremdquelle im Tippweg. Das Ortsfeld ist Freitext; wenn die
Vorschläge kommen sollen, ist das ein eigener Schritt (Proxy-Route + Zwischenspeicher).
Ebenfalls bewusst offen: der **Zuschnitt** hochgeladener Titelbilder — das Banner
ist ein fester Ausschnitt (`object-fit: cover`), was bei querformatigen Bildern
dasselbe Ergebnis liefert.
**Nachgezogen am 6. August 2026** (zusammen mit Etappe 3): Ein Profil ohne Anzeigenamen
zeigt jetzt seinen Handle statt „Ohne Namen" (und dann nicht zweimal), und ohne gewähltes
Titelbild steht im Banner eines der vier Vorschlagsbilder — deterministisch aus dem Handle
gewählt (`standardTitelbild`), damit dieselbe Person nicht bei jedem Aufruf ein anderes
Kopfbild hat. Der Knopf im Titelbild-Dialog heißt deshalb „Zurücksetzen" statt „Entfernen":
Danach steht dort nicht nichts.

**Ziel:** [profil.html](../../profil.html) wird zu dem, was das Mockup zeigt —
für Fremde wie für den Besitzer, mit Bearbeiten-Modal.

**Server**
- Migration: `users.ort`, `users.website`, `users.instagram`, `users.titelbild`.
  (`anzeigename`, `bio`, `avatar`, `profil_sichtbarkeit` gibt es seit M-Ausbau.)
- Titelbilder: die vier Vorschläge liegen als statische Dateien im Build
  (`public/titelbilder/`), eigene Uploads gehen den Weg des Avatars
  (`benutzerStorage`, Dateiname mit Zeitstempel gegen Browser-Cache).
- Kennzahlen (Touren, km, Höhenmeter) aus `tours.stats_json` — **nur über
  öffentliche Touren summiert**, sonst verrät die Zahl private Fahrten.

**Web**
- Profilseite: Titelbild, Avatar, Handle, Ort, Links, Kennzahl-Chips,
  Tourenraster. Rechnende Teile DOM-frei nach
  [src/galerie/galeriemodell.ts](../../src/galerie/galeriemodell.ts) bzw. ein
  neues `profilmodell.ts` (Handle-Prüfung, Kennzahlen, Link-Typen) — testbar
  ohne Browser, wie im Projekt üblich.
- Bearbeiten-Modal nur, wenn die Sitzung dem Profil gehört.

**Aufwand-Treiber:** die Bildwege (Titelbild-Upload, Zuschnitt, Auslieferung),
nicht das Formular.

---

## Etappe 3 — Kontoeinstellungen ✅

**Umgesetzt am 6. August 2026.** Seite [konto.html](../../konto.html) +
[src/konto/](../../src/konto/) unter `/konto`; Migration 15 (Sitzungs-Kennzeichen,
`mail_tokens.nutzlast` + Zweck `email`); Routen `POST /api/auth/me/passwort`,
`POST /api/auth/me/email`, `POST /api/auth/email-bestaetigen`,
`GET|DELETE /api/auth/me/geraete[/:id]`, `GET /api/auth/me/speicher`; Mail-Vorlage
`email-wechsel`. Das Konto-Menü hat jetzt „Mein Profil" und „Kontoeinstellungen"
(Studio wie öffentliche Seiten). Umami-Tag: JA (s. CLAUDE.md).

Zwei Abweichungen vom Mockup, beide bewusst:

- **Der Newsletter-Schalter fehlt** — er ist Etappe 4 und hängt an
  Einwilligungs-Protokoll und Abmeldelink; ein Schalter ohne die wäre eine Zusage ohne
  Deckung. Ebenso fehlt der ZIP-Export (Etappe 5).
- **„In Suchmaschinen erscheinen" fehlt VORERST.** `profil.html` ist eine statische Seite
  mit festem `noindex` — der Schalter könnte heute nichts bewirken, außer zu behaupten, er
  täte es. Die Entscheidung ist inzwischen gefallen: Er kommt mit **Etappe 6** zurück,
  sobald die Profilseite serverseitig ausgeliefert wird.

Zusätzlich zum Mockup: **Die Geräteliste zeigt auch die App-Tokens.** Die App meldet sich
mit einem Token an, nicht mit einer Sitzung — eine Liste nur aus Sitzungen hätte genau das
Gerät nicht dabei, das im Mockup als „Maptale App · Pixel 9" gezeichnet ist.

**Ziel:** eigene Seite `/konto`, Inhalt wie im Mockup.

**Server**
- `POST /api/auth/me/passwort` — altes Passwort prüfen, neues setzen.
- `POST /api/auth/me/email` — Änderung anstoßen; wirksam erst nach Klick auf
  den Link an die **neue** Adresse (`mail_tokens` mit neuem `zweck`).
- Sessions sichtbar machen: Migration `sessions.user_agent`, `sessions.ip_prefix`
  (nur die ersten zwei Oktette — mehr braucht niemand, um ein fremdes Gerät zu
  erkennen), `sessions.zuletzt_gesehen`. Dazu `GET /api/auth/me/sessions` und
  `DELETE /api/auth/me/sessions/:id`.
- Speicher-Aufschlüsselung: `quotaStand` liefert heute eine Summe; für die
  vier Balkenabschnitte braucht es die Aufteilung nach Medienart.

**Web**
- Neuer Eintrag in [src/routen.ts](../../src/routen.ts) (`konto` → `/konto`),
  neue Datei `konto.html` + `src/konto/`. Konto-Menü im Studio bekommt die zwei
  Einträge „Mein Profil" und „Kontoeinstellungen".

**Nicht vergessen:** Umami-Tag. Die Seite gehört in die Gruppe „mit Tag" oder
bewusst nicht — [CLAUDE.md](../../CLAUDE.md) beschreibt die Entscheidung.

---

## Etappe 4 — Newsletter-Einwilligung ✅

**Umgesetzt am 6. August 2026.** Migration 16 (`users.newsletter` +
`newsletter_einwilligungen`), [server/src/newsletter.ts](../../server/src/newsletter.ts) +
[routes/newsletter.ts](../../server/src/routes/newsletter.ts); Routen
`POST /api/auth/me/newsletter`, `POST /api/newsletter/abmelden`,
`POST /api/newsletter/ein-klick/:token`, dazu `newsletter` in `/auth/me` und im
Registrierungs-Körper. Oberfläche: Kästchen in der Registrierung
([studio.html](../../studio.html)), Block „Benachrichtigungen" in
[konto.html](../../konto.html), Abmeldelink über `/konto#newsletter-aus=<token>`.
Datenschutzerklärung um Zweck, Rechtsgrundlage, Empfänger und Frist ergänzt.

Drei Entscheidungen, die vom Konzept abweichen oder es schärfen:

- **Der Schalter ist auch bei unbestätigter Adresse bedienbar.** Das Konzept sagt
  „bleibt gesperrt"; gesperrt ist jetzt der VERSAND. Ein toter Schalter ließe rätseln,
  ob die Einwilligung angekommen ist — und eine Einwilligung darf man geben, bevor man
  sie einlösen kann. Der Riegel sitzt dort, wo er wirkt: in `empfaenger()`.
- **Gespeichert wird ein Label, nicht der Wortlaut** (sonst stünde derselbe Satz
  tausendfach in der Tabelle). Damit das Label etwas beweist, hält ein Drift-Wächter
  die Sätze in der Oberfläche gegen `EINWILLIGUNGSTEXTE`.
- **Die drei Jahre Aufbewahrung sind gebaut**, nicht nur zugesagt: `raeumeAuf()` läuft
  täglich neben der Warteliste und lässt die jüngste Zeile immer stehen.

Was Teil B mitbekommt (Versand, noch nicht gebaut): `NewsletterDienst.empfaenger()` und
`newsletterKopfzeilen()` samt `MailNachricht.kopfzeilen` bis zu Resend.

---

## Etappe 5 — Datenexport ✅

**Umgesetzt am 6. August 2026.** [server/src/export.ts](../../server/src/export.ts)
(Auftragsverwaltung, Fristen, ZIP-Mechanik über `yazl`),
[exportinhalt.ts](../../server/src/exportinhalt.ts) (was hineingehört, Ordnernamen,
Begleittext), [exportlauf.ts](../../server/src/exportlauf.ts) (Sammeln und Packen),
[routes/export.ts](../../server/src/routes/export.ts), Migration 16, Mail-Vorlage `export`,
Zeile „Alle Daten exportieren" im Konto, Datenschutzerklärung Abschnitt 11.

Fünf Entscheidungen, die beim Umsetzen dazukamen:

- **Gegen Doppelläufe hilft nur die Datenbank**, keine Prüfung im Code: ein partieller
  `UNIQUE`-Index `WHERE status = 'laeuft'`. Zwischen „läuft schon einer?" und dem INSERT
  liegt sonst ein Fenster, in dem beide Anfragen dasselbe sehen. Der zweite INSERT scheitert,
  und die Route liefert den vorhandenen Auftrag — ohne zweite Mail.
- **Medien gehen ungepackt ins Archiv.** Fotos und Videos sind schon komprimiert; sie durch
  Deflate zu schicken kostet die CPU des ganzen Servers und spart nichts. Gepackt wird nur,
  was Text ist.
- **Aufgeräumt wird stündlich**, nicht im täglichen Lauf neben der Warteliste: Bei einem
  täglichen läge ein Archiv im ungünstigen Fall 72 statt 48 Stunden herum. Derselbe Lauf
  befreit Konten, deren Export beim Neustart mittendrin abbrach — sonst blockierte der
  UNIQUE-Index sie für immer.
- **Der Download-Link braucht keine Anmeldung.** Er wird im Postfach geöffnet, oft auf einem
  anderen Gerät; ein Anmeldezwang machte aus dem Weg zu den eigenen Daten eine Hürde.
  Dieselbe Linie wie beim Passwort-Reset, dessen Link sogar das ganze Konto öffnet. Gefälscht
  und abgelaufen bekommen dieselbe Antwort — ein eigener Text verriete, dass es den Auftrag gab.
- **Die Ordner heißen wie die Reise** (`touren/03-runde-bei-frankfurt/`), nicht wie die
  Kennung: Wer das ZIP öffnet, sucht seine Tour, nicht `t_9fK4mHx2QbVnRs`. Die Kennung steht
  in der `tour.json` daneben. Draußen bleibt der Anreicherungs-Cache — er ist unser Rechenweg,
  keine Auskunft.

### Ursprünglicher Plan


Der einzige Punkt mit echtem Hintergrundlauf: ZIP aus Touren, Medien und
Konto-Angaben bauen, irgendwo ablegen, Link mit 48-Stunden-Frist per Mail.
Braucht eine kleine Job-Verwaltung (Status, Aufräumen alter Archive) — deshalb
zuletzt, obwohl es im Mockup nur eine Zeile ist.

**Bewusst später:** die automatische Newsletter-Erzeugung, Mehrsprachigkeit.

---

## Etappe 5.5 — Auffindbar und teilbar (klein) ✅

Beim Prüfen von Etappe 3 aufgefallen: Es gibt **keine `robots.txt`** (live 404),
**keine Sitemap** und **nirgends Open-Graph-Tags**. Wer heute einen Tour- oder
Profil-Link in WhatsApp, Slack oder Mastodon teilt, bekommt keine Vorschaukarte,
sondern eine nackte URL — bei einem Produkt, dessen Kern das Teilen von Reisen
ist, kein Nebenschauplatz.

- `public/robots.txt`: Verwaltung, Konto und Studio ausschließen, Sitemap nennen.
- `public/sitemap.xml` für die statischen Seiten (Landing, Galerie, Impressum,
  Datenschutz). Profile und Touren kommen erst mit Etappe 6 dazu — vorher
  dürfen sie ohnehin nicht in den Index.
- `og:title`, `og:description`, `og:image`, `twitter:card` in
  [index.html](../../index.html), [galerie.html](../../galerie.html) und
  [erlebnis.html](../../erlebnis.html). Für die statischen Seiten reichen feste
  Werte samt einem Marken-Bild.

Etwa eine Stunde, unabhängig vom Rest.

**Gebaut.** Drei Entscheidungen, die beim Umsetzen dazukamen:

- **Kein `Disallow` auf `/profil` und `/@`.** Ein Disallow verbietet das
  ABRUFEN, ein `noindex` das AUFNEHMEN — wer beides auf dieselbe Seite legt,
  hebt das noindex auf (Google kann es nicht lesen, listet die nackte URL aber
  trotzdem). Genau das noindex braucht Etappe 6 als Schalter.
- **Der Player ist gecrawlt, steht aber nicht in der Sitemap.** Holen dürfen
  die Vorschau-Bots die Seite, sonst hätte ein geteilter Tour-Link keine Karte;
  gelistet gehört sie erst, wenn der Server pro Tour entscheiden kann. Er
  bekommt deshalb auch **kein `og:url`** — es wäre für jede Tour dasselbe, und
  manche Dienste zeigen dann diese Adresse statt der geteilten.
- **Das Marken-Bild ist abgeleitet, nicht gemalt:**
  [scripts/gen-og-bild.mjs](../../scripts/gen-og-bild.mjs) rendert
  `public/og/maptale.jpg` (1200 × 630) aus dem Landing-Hero plus Wortmarke.

Zusammengehalten wird das Ganze von einem Wächter in
[test/routen.test.ts](../../test/routen.test.ts): Jeder Pfad aus `ROUTEN` muss
in der Sitemap stehen, in der robots.txt gesperrt sein oder ausdrücklich als
„gecrawlt, nicht gelistet" geführt werden. Eine neue Seite, die in keiner von
beiden vorkommt, funktioniert sonst tadellos — sie taucht nur nie in einer
Suche auf, und niemand merkt es.

### Nachgezogen: die Tour bekommt eine eigene Adresse

Aus der Frage „warum eigentlich `?tour=…` und nicht `/tour/<nr>`?" wurde ein
eigener Namensraum: **`/tour/<kennung>`** (`tourPfad`/`tourAusPfad` in
[src/routen.ts](../../src/routen.ts), `location ^~ /tour/` im Vhost,
Gegenstück in [vite.config.js](../../vite.config.js)). Ein Query-Parameter ist
kein Ort — solange die Tour einer war, konnte sie weder eine eigene
Vorschaukarte noch einen Sitemap-Eintrag bekommen. Der Pfad ist die
**Vorbedingung für Etappe 6**; die Meta-Tags pro Tour kommen dort.

Drei Festlegungen:

- **Die rohe ID, kein Slug und keine Nummer.** Die Unerratbarkeit der Kennung
  (14 Zeichen, ~2^80, [server/src/ids.ts](../../server/src/ids.ts)) IST die
  Sichtbarkeitsstufe `unlisted`. Eine kurze Nummer schaffte sie ab, ein
  sprechender Slug unter einem bekannten Handle ebenso — und die laufende
  Nummer `no` ist nur pro Besitzer eindeutig.
- **Kein `srv:` im Pfad.** Server-Kennungen tragen ihr `t_` selbst; daran
  unterscheidet der Player sie von den mitgelieferten `TOURS`. Ein Wächter
  verbietet deshalb `t_`-Schlüssel in [src/tours.js](../../src/tours.js).
- **`?tour=…` bleibt bedienbar** und wird beim Start per `replaceState`
  umgeschrieben — wie `?id=…` beim Profil. Nichts ist produktiv, aber es kostet
  nichts, und ältere Installationen der Android-App bauen die alte Form noch.

Mitgezogen: die drei Demo-Karten der Landing samt Alt-Deeplink-Weiche, Studio
(Abspielen, „Link kopieren"), Editor-Vorschau, Galeriekarten sowie
`teilenLink`/`PlayerScreen` der Android-App.

---

## Etappe 6 — Die Profilseite serverseitig ausliefern ✅

**Umgesetzt am 6. August 2026.** Mechanik in
[server/src/seiten.ts](../../server/src/seiten.ts) (Seite holen, Marker-Block ersetzen,
Escaping), Route in [server/src/routes/seiten.ts](../../server/src/routes/seiten.ts)
(`GET /@:handle`, `GET /sitemap-profile.xml`), Migration 15 (`users.suchmaschinen`),
`POST /api/auth/me/suchmaschinen`, Schalter in [konto.html](../../konto.html), Marker in
[profil.html](../../profil.html), `proxy_pass` im Vhost, Dev-Proxy in
[vite.config.js](../../vite.config.js). Datenschutzerklärung Abschnitt 5 nachgezogen — dort
stand „auffindbar über Suchmaschinen", was weder vorher stimmte (alles trug `noindex`) noch
jetzt ohne den Schalter stimmt.

Fünf Entscheidungen, die beim Umsetzen dazukamen:

- **Ein privates oder unbekanntes Profil bekommt einen VERSCHWIEGENEN Kopf** — generischer
  Titel, kein Name. `noindex` verbirgt den Meta-Kopf vor Suchmaschinen, nicht vor Menschen:
  Er steht im Quelltext. Sonst wäre die Route eine Auskunft darüber, wer hier ein Konto hat.
- **Die Sitemap der Profile ist eine ZWEITE Datei** (`/sitemap-profile.xml`) statt eines
  Eintrags in der statischen. Verschiedene Herkunft, verschiedene Änderungsrate; die
  robots.txt nennt beide, was billiger ist als eine Index-Datei mit zwei Einträgen. Gelistet
  wird genau, was auch `index` bekommt — liefe das auseinander, stünde in der Sitemap eine
  Einladung, der die Seite selbst widerspricht.
- **Der Server kennt jetzt die vier Titelbilder** (Kopie in
  [server/src/titelbilder.ts](../../server/src/titelbilder.ts) mit Drift-Wächter). Ohne das
  zeigte die Vorschaukarte eines Profils ohne eigenes Titelbild etwas anderes als das Banner
  der Seite dahinter. Die PRÜFUNG eines gesetzten Titelbilds sieht weiter nur die Form des
  Namens an.
- **Der Abruf des gebauten HTML geht über den öffentlichen Namen**, nicht über `127.0.0.1`:
  Der HTTP-Vhost leitet auf HTTPS um, und HTTPS auf die Loopback-Adresse scheitert am
  Zertifikatsnamen. Ein TLS-Handshake alle fünf Minuten ist billiger als jede
  Sonderbehandlung (`MAPTALE_WEB_URL`, Default = `MAPTALE_BASIS_URL`).
- **Beim Rollout gilt die UMGEKEHRTE Reihenfolge wie in Etappe 1**: erst der Code, dann der
  Vhost. Ein `proxy_pass` auf eine API, die `/@handle` noch nicht kennt, macht jede
  Profilseite sofort tot — während ein zu früher `rewrite`-Block in Etappe 1 nur eine leere
  Seite zeigte.

**Nachgezogen (gleicher Tag): `/tour/<kennung>` auf demselben Weg.** Marker in
[erlebnis.html](../../erlebnis.html), Route und `/sitemap-touren.xml` in derselben Datei,
Vhost-Block ebenfalls auf `proxy_pass`. Die Sichtbarkeitsregel ist hier eine andere als beim
Profil, und das ist Absicht:

| | in der Galerie | Vorschaukarte | in Suchmaschinen |
| --- | --- | --- | --- |
| Tour `public` | ja | ja | **ja** |
| Tour `unlisted` | nein | ja | nein |
| Tour `private` | nein | nein | nein |
| Profil `public` | — | ja | nur mit Schalter |

Eine Tour öffentlich zu stellen heißt, sie in die Galerie zu hängen; sie dort zu finden, aber
nicht über eine Suche, wäre eine Unterscheidung ohne Unterschied. Beim Profil hängt dagegen
ein NAME an der Adresse — deshalb dort der eigene Schalter. Eine private Tour zeigt im Kopf
auch ihrem Besitzer nichts (er bekommt die Seite mit 200, Fremde 404 wie in der API), und die
mitgelieferten Touren reicht der Server unverändert durch: `src/tours.js` ein zweites Mal zu
führen wäre die nächste Kopie.

### Ursprünglicher Plan


**Erst danach kann „In Suchmaschinen erscheinen" zurück ins Konto** — und dann
bewirkt der Schalter auch etwas. Heute trägt [profil.html](../../profil.html)
ein festes `noindex`, weil sie statisch für alle gleich ausgeliefert wird.

Verworfene Wege, damit sie nicht wiederkommen:

| Weg | Warum nicht |
| --- | --- |
| `noindex` per JavaScript entfernen | Google verarbeitet das `noindex` im initialen HTML, **bevor** es JavaScript rendert. Die Seite fliegt raus, ehe der Code läuft |
| `X-Robots-Tag` im Vhost | Nginx weiß nicht, ob DIESER Nutzer indexiert werden will — nur ein Schalter für alle oder keinen |
| Bei jeder Änderung eine statische Datei je Profil schreiben | Cache-Invalidierung und ein Schreibpfad für einen Gewinn, der erst bei Zehntausenden Profilen zählt |

**Der Weg:** Fastify beantwortet `/@handle` selbst und setzt im HTML-Kopf
`robots`, `title`, `description` und die `og:`-Tags nach dem, was in der
Datenbank steht (Titelbild als `og:image` — das löst die Teilen-Vorschau gleich
mit). Der Rest der Seite bleibt clientseitig wie heute.

**Dasselbe für `/tour/<kennung>`.** Der Namensraum steht seit Etappe 5.5
(s. dort), der Player wird nur noch statisch ausgeliefert — es fehlt genau der
Schritt, den auch die Profilseite braucht. Pro Tour aus der Datenbank: `title`
als `og:title`, die Beschreibung, das Titelbild als `og:image`, dazu `og:url`
auf die eigene Adresse (heute bewusst weggelassen, weil es für alle Touren
dasselbe wäre). Und die Regel, die das Ganze ehrlich hält: **`public` bekommt
`index`, `unlisted` bekommt `noindex`** — Vorschaukarte ja, Suchtreffer nein.
Ein ungelisteter Link, der über die Vorschau in den Index rutscht, wäre genau
der Bruch, den die Stufe verspricht zu verhindern. Im Vhost wird dann aus
`location ^~ /tour/ { rewrite ^ /erlebnis.html last; }` ein `proxy_pass`.

Der Knackpunkt ist, woher der Server das gebaute HTML nimmt — die Bundle-Namen
tragen Hashes, der API-Container kennt den Docroot nicht. Zwei Varianten:

1. Der Build kopiert `dist/profil.html` ins API-Image. Koppelt Web-Build und
   Image und braucht einen neuen Deploy-Schritt.
2. **Empfohlen:** Der Container holt `profil.html` zur Laufzeit über Nginx
   (`127.0.0.1`), hält sie ein paar Minuten im Speicher und ersetzt darin nur
   den Meta-Block. Keine Kopplung, kein neuer Deploy-Schritt, ein Fetch pro
   Cache-Periode.

Im Vhost wird aus `location ~ ^/@ { rewrite ^ /profil.html last; }` ein
`proxy_pass` an die API — wieder von Hand, s. Etappe 1.

Dazu gehört: Sitemap um öffentliche, indexierbare Profile UND `public`-Touren
ergänzen,
`canonical`-URL setzen, und der Schalter im Konto schreibt ein Feld
`suchmaschinen` (Standard **aus** — ein Profil über den Link zu teilen ist
etwas anderes, als unter dem eigenen Namen auffindbar zu sein).

---

## Etappe 7 — Ein geteiltes Stylesheet ✅

**Der Befund** (gemessen beim Prüfen von Etappe 3):

- **4519 Zeilen Inline-CSS** in neun HTML-Dateien, **kein einziges externes
  Stylesheet**. studio.html allein trägt 2570 Zeilen.
- **245 `border-radius`-Stellen**, mit drei Werten für dasselbe: 9 px (konto,
  profil, index, galerie), 10 px (studio, admin), 8 px im Mockup — das nie im
  Code ankam.
- **Zwei Namenssysteme für dieselben Farben**: `--akzent`/`--text`/`--fl-1` in
  Studio, Admin, Galerie und Landing gegen `--amber`/`--ink` in Konto und
  Profil.
- In den neuen Seiten stehen Farben teils wieder als **rohe Hex-Werte** in den
  Regeln (`#10151d`, `#222b37`), obwohl daneben Variablen definiert sind.

Das ist keine gewachsene Eigenheit, sondern Duplikation mit messbarem Drift.
Die Radien sind nur das Symptom, an dem es auffiel.

**Der Weg: eine echte CSS-Datei, kein Kompromiss.** `src/basis.css` mit den
Tokens (Farben, Radien, Schatten, Typo) und den Grundelementen, die auf jeder
Seite vorkommen — Knöpfe, Felder, Topbar, Dialogschicht, Tafeln. Eingebunden per
`import './basis.css'` im Einstiegs-TS jeder Seite; Vite bündelt, hasht und
hängt das `<link>` beim Build selbst ein. Seitenspezifisches CSS bleibt
zunächst, wo es ist, und wandert schrittweise nach.

Das frühere Gegenargument — Inline-CSS spart einen Netzabruf und blockiert
nichts — trägt hier nicht: Der Roundtrip fällt genau einmal an, danach liegt die
Datei im Browser-Cache und gilt für ALLE fünf Einstiege, zwischen denen Nutzer
ohnehin wechseln (Studio → Konto → Profil → Galerie → Player). Die
HTML-Dokumente schrumpfen dabei deutlich.

**Der Radius-Wert: 9 / 12 / 14** (Knopf / Karte / Modal). Den tragen die zwei
neuesten Seiten und die Landing bereits; der Sprung von 10 auf 9 fällt nirgends
auf, während 8 überall nachgezogen werden müsste — für einen Unterschied, den
niemand sieht. Festgeschrieben wird er in [DESIGN.md](../../DESIGN.md).

**Reihenfolge**, damit das nicht ein Umbau über alles wird:

1. `basis.css` mit den Tokens, EIN Namenssystem (`--akzent` gewinnt, weil es in
   vier von sechs Dateien steht). Alle Seiten importieren sie; die lokalen
   `:root`-Blöcke fallen weg, `--amber`/`--ink` werden umbenannt.
2. Die Grundelemente nachziehen (Knöpfe, Felder, Topbar, Dialoge) — Seite für
   Seite, jede einzeln überprüfbar.
3. Radien auf die Variablen umstellen; danach ist die Frage einmal beantwortet
   statt bei jeder neuen Seite neu.

Schritt 1 ist klein und bringt den größten Teil des Nutzens. Die Schritte 2 und
3 können liegen bleiben, ohne dass etwas inkonsistent wird.

**Umgesetzt am 6. August 2026, alle drei Schritte.** Was wo liegt:
[src/basis.css](../../src/basis.css) (Tokens, jede Seite),
[src/grundelemente.css](../../src/grundelemente.css) (Kopfleiste, Konto-Menü,
Dialogschicht, Fußzeile — die Produkt-Seiten) und
[src/werkzeug.css](../../src/werkzeug.css) (Knöpfe, Felder, Etiketten von Studio
und Verwaltung). Der Drift-Wächter steht in
[test/basis-css.test.ts](../../test/basis-css.test.ts).

Vier Dinge, die beim Umsetzen anders kamen als geplant:

- **Der Import im Einstiegs-TS trägt nicht.** Vite hängt gebautes CSS ans ENDE
  des `<head>` — die Basis stünde damit HINTER dem `<style>` der Seite und
  schlüge bei gleicher Spezifität genau das, was die Seite absichtlich anders
  macht (gemessen: die Verwaltung wurde 80 px breiter, ohne dass sich eine
  Zeile ihres CSS änderte). Der Dev-Server tut das nicht, es fiele also erst
  nach dem Deploy auf. Die Blätter hängen jetzt als `<link>` vor dem
  `<style>`, und `basisZuerst()` in [vite.config.js](../../vite.config.js)
  stellt die Reihenfolge nach dem Bauen wieder her.
- **Drei Dateien statt einer.** Das Projekt hat zwei Knopf-Register — Pillen
  auf den öffentlichen Seiten, Kästen im Werkzeug —, und `button.knopf` (Pille)
  schlägt `button, .knopf` (Kasten). In einer Datei wären die Werkzeugleisten
  still zu Pillenreihen geworden. Welches Register gewinnt, ist eine
  Design-Entscheidung; sie gehört nicht in eine Aufräum-Etappe.
- **Die Radien sind 9 / 12 / 14 / 16**, nicht 9 / 12 / 14. `rounded.card: 14px`
  ist neu in DESIGN.md, weil es im Code längst der häufigste Wert war (Karten
  und Tafeln überall), nur nirgends geschrieben stand — und 16 blieb für
  Dialoge nötig.
- **Zwei tote Variablen kamen dabei ans Licht**: `var(--text-3)` im
  Passwortfeld (auf Konto- und Profilseite gab es sie nicht, das Augen-Icon
  erbte deshalb die Textfarbe) und `var(--ok, #56c271)` im Studio — eine fünfte
  Grünstufe, die niemand definiert hatte. Der Wächter prüft diese Fehlerklasse
  jetzt mit.

## Was die Umsetzung am ehesten kippt

1. **Der Vhost.** Er wird vom Deploy nicht mitgezogen. Ohne die `@`-Regel
   landet jeder Profil-Link auf der Landing — und zwar still.
2. **Handle-Vergabe für Bestandskonten.** Die Migration muss deterministisch
   und kollisionsfrei sein; einmal vergeben, ist der Name in der Welt.
3. **Kennzahlen und Tourenliste.** Beide müssen serverseitig auf „öffentlich"
   filtern. Ein Filter, der nur im Frontend sitzt, ist kein Filter.
4. **Coverage-Gate.** Der Server deployt nur mit 80 % Testabdeckung — die neuen
   Routen brauchen Tests im selben Zug, nicht danach.

---

## Entschieden — und ausdrücklich verworfen

Damit nicht wieder vorgeschlagen wird, was schon abgeräumt ist:

| Entschieden | Warum |
| --- | --- |
| Profil-URL `maptale.io/@henrik` | eigener Namensraum, sprachneutral (aus `/profil` würde bei i18n `/en/profile`) |
| Handle ≠ Anzeigename, 90 Tage Sperre | Namen sind doppelt und ändern sich, Adressen dürfen das nicht; 90 Tage wiegen Identitätsschutz gegen blockierte Namen auf |
| Profilseite zeigt nur öffentliche Touren | private Touren wohnen in „Meine Touren"; Kennzahlen zählen deshalb auch nur die öffentlichen |
| Bearbeiten im Modal | robuster als `contenteditable` (Enter, eingefügtes HTML, Firefox), Verwerfen ist trivial |
| Sichtbarkeits-Schalter an zwei Stellen | Modal und Kontoeinstellungen, aber EIN Zustand — man findet ihn dort, wo man ihn sucht |
| ~~Radius 8 / 12 / 14~~ → **9 / 12 / 14** | Die 8 aus dem Mockup ist im Code nie angekommen; die neuen Seiten tragen 9, der Bestand 10. Vereinheitlicht wird auf **9** — s. Etappe 7 |
| `--text-3` auf `#7e8a99` | 4,0:1 war zu wenig für 12-px-Meta-Zeilen, jetzt 5,6:1 |
| Labels in Satzschrift | gesperrte Versalien sind die alte Player-Sprache (s. `CLAUDE.md`) |
| Titelbilder als Fotos | gezeichnete Routen über Rastern lasen sich als Kursdiagramm |

| Verworfen | Warum |
| --- | --- |
| „Öffentliche Ansicht" (Vorschau-Modus) | seit die Seite nur öffentliche Touren zeigt, verschwinden darin bloß drei Knöpfe |
| Privatzone / Start und Ziel verbergen | fachlich sinnvoll (ein GPS-Track verrät die Wohnadresse), aber bewusst gestrichen — wenn öffentliche Profile live gehen, gehört das Thema wenigstens in die Datenschutzerklärung |
| Zwei-Faktor-Bestätigung | vorerst nicht; ohne Wiederherstellungscodes sperrt sich der erste Nutzer mit verlorenem Telefon aus |
| Passkeys (WebAuthn) | kein Knopf, sondern ein zweiter kompletter Anmeldeweg: Challenge-Fluss, Credential-ID/Public Key/Signaturzähler, Geräteverwaltung, Wiederherstellung bei Geräteverlust. Der Gewinn ist Phishing-Resistenz — die zählt, wo Geld oder Identität hängen. Hier hängen Reisefotos daran, und angemeldet bleibt man 30 Tage: Die Anmeldung erlebt ein Nutzer vielleicht viermal im Jahr. Falls doch, dann als **Ergänzung** zum Passwort, nie als Ersatz |
| Drittes freies Link-Feld | „Weiteres Profil" mit Platzhalter stellt eine Frage, auf die die meisten keine Antwort haben; kommt als „Link hinzufügen" wieder, wenn es Bedarf gibt |
| „Alle anderen Geräte abmelden" | einzelnes Abmelden genügt |
| Kennzahlen als Kacheln oder Sparklines | drei Anläufe; Chips mit einem Zeichen sind der Kompromiss zwischen Dashboard-Optik und Fließtext |
| Speicher erweitern / Videos verkleinern | setzt ein Preismodell bzw. eine Medien-Pipeline voraus, die es nicht gibt |

**Noch offen, außerhalb dieser fünf Etappen:** EXIF beim Ausliefern öffentlicher
Fotos strippen (ungeprüft, ob der Server das heute tut), Einwilligung zur
Veröffentlichung mit Zeitstempel protokollieren, und die Datenschutzerklärung um
öffentliche Profile, Handles und geteilte Tracks ergänzen.

---

## Vorschlag für den Anfang

Etappe 1 komplett, in einem Zug bis zum Deploy: Migration, Route, Vhost,
Weiterleitung der alten Links, Tests. Danach ist die Adresse festgeklopft und
alles Weitere kann in beliebiger Reihenfolge folgen.
