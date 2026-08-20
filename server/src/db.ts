// SQLite-Zugriff (better-sqlite3, synchron — ein Schreiber genügt hier) samt
// Schema-Migrationen. Die DB hält nur Auth- und Listen-Metadaten; die
// eigentlichen Tour-Daten (Manifest, Medien, gerendertes tour.json) liegen als
// Dateien im Storage — das hält die DB klein und den Umzug auf Postgres/R2 trivial.

import Database from 'better-sqlite3'
import { freierHandle, handleAusEmail } from './handle.js'

export type Db = Database.Database

/**
 * Ein Migrationsschritt ist SQL — oder Code, wo SQL nicht reicht.
 *
 * Die Handle-Vergabe für Bestandskonten (Schritt 11) rechnet pro Zeile aus der
 * E-Mail einen Namen und hängt bei Kollision einen Zähler an; das ist in SQLite
 * nicht auszudrücken, ohne es zu erfinden. Beide Formen laufen in derselben
 * Transaktion wie die Versionsnummer.
 */
type Migration = string | ((db: Db) => void)

// Migrationen laufen der Reihe nach; `user_version` merkt den Stand.
const MIGRATIONEN: Migration[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE TABLE tours (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    no INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('angelegt','verarbeitung','bereit','fehler')),
    visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('private','unlisted','public')),
    client_tour_id TEXT,
    title TEXT,
    description TEXT,
    stats_json TEXT,
    fehler TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_tours_owner ON tours(owner_id, created_at DESC);
  CREATE UNIQUE INDEX idx_tours_client ON tours(owner_id, client_tour_id) WHERE client_tour_id IS NOT NULL;
  `,
  // M9 (offener Betrieb): E-Mail-Bestätigung + Passwort-Reset. Beide laufen
  // über kurzlebige, nur als Hash gespeicherte Einmal-Token (Tabelle
  // mail_tokens). `email_verified` gatet das Hochladen — anmelden darf man
  // sofort, Touren anlegen erst nach Bestätigung.
  `
  ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE mail_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zweck TEXT NOT NULL CHECK (zweck IN ('verify','reset')),
    hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX idx_mail_tokens_user ON mail_tokens(user_id, zweck);
  `,
  // Titelbild der Tour (Pfad wie media[].src im tour.json). Es steht hier und
  // nicht nur im tour.json, weil die Tourliste sonst je Eintrag eine Datei
  // lesen müsste — sie ist der heißeste Aufruf der API. Gefüllt wird die
  // Spalte beim Rendern, genau wie stats_json daneben.
  `
  ALTER TABLE tours ADD COLUMN cover TEXT;
  `,
  // Öffentliches Profil. Getrennt vom Konto-Namen: `name` ist der Klarname aus
  // der Registrierung und bleibt privat, `anzeigename` ist der selbstgewählte
  // Name, unter dem jemand in Galerie und auf seiner Profilseite auftaucht.
  // Ohne diese Trennung würde eine Anmeldung mit dem echten Namen automatisch
  // zur Veröffentlichung desselben führen. `profil_sichtbarkeit` steht deshalb
  // ebenfalls auf 'private'.
  `
  ALTER TABLE users ADD COLUMN anzeigename TEXT;
  ALTER TABLE users ADD COLUMN bio TEXT;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  ALTER TABLE users ADD COLUMN profil_sichtbarkeit TEXT NOT NULL DEFAULT 'private'
    CHECK (profil_sichtbarkeit IN ('private','public'));
  `,
  // Optionaler Endscreen („Ziel erreicht"). Standard aus: die meisten Touren
  // haben kein konkretes Ziel — der Player kehrt dann zum Startscreen zurück.
  // `finale_ziel` ist der vom Autor gesetzte Zielname; leer = Ortsname am Ende.
  `
  ALTER TABLE tours ADD COLUMN finale INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tours ADD COLUMN finale_ziel TEXT;
  `,
  // Benutzerverwaltung: Rollen, Einladungen, umschaltbare Registrierung.
  //
  // `rolle` ist bewusst ein Textfeld mit zwei Werten und keine eigene Tabelle —
  // es gibt genau zwei Rollen, und ein Rechtesystem für zwei Rollen wäre
  // Beiwerk. Bestandskonten werden 'nutzer'; wer Admin ist, entscheidet beim
  // Start die Konfiguration (s. AuthDienst.hebeAdmins).
  //
  // Einladungen sind EINMAL einlösbar: eine Einladung gilt einer Person. Der
  // Code steht im Klartext, weil der Admin ihn weitergeben können muss — er ist
  // ein Türöffner zur Registrierung, kein Geheimnis eines Kontos. Eingelöste
  // Einladungen bleiben als Herkunftsnachweis stehen ('wer kam über welchen
  // Code'), deshalb kein DELETE beim Einlösen.
  `
  ALTER TABLE users ADD COLUMN rolle TEXT NOT NULL DEFAULT 'nutzer'
    CHECK (rolle IN ('nutzer','admin'));
  CREATE TABLE einladungen (
    code TEXT PRIMARY KEY,
    notiz TEXT,
    erstellt_von TEXT REFERENCES users(id) ON DELETE SET NULL,
    erstellt_am TEXT NOT NULL,
    ablauf TEXT,
    eingeloest_von TEXT REFERENCES users(id) ON DELETE SET NULL,
    eingeloest_am TEXT
  );
  CREATE TABLE einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert TEXT NOT NULL
  );
  `,
  // Kachel-Fassung des Titelbilds. Neben `cover` und nicht statt dessen: Listen
  // zeigen 300 px, Detailansichten formatfüllend — mit nur einem Pfad wäre das
  // eine von beiden Größen falsch. NULL bei Touren, die noch keine aufbereiteten
  // Fassungen haben (der Bild-Nachtrag beim Start füllt sie).
  `
  ALTER TABLE tours ADD COLUMN cover_thumb TEXT;
  `,
  // Warteliste für Einladungen: Wer keinen Code hat, hinterlässt seine Adresse,
  // der Betreiber lädt gezielt nach.
  //
  // Der Eintrag entsteht im DOUBLE-OPT-IN: erst der Klick auf den Link in der
  // Bestätigungsmail macht ihn zu einem Platz in der Schlange. Ohne das könnte
  // jeder fremde Adressen eintragen, und dem Betreiber fehlte der Nachweis der
  // Einwilligung (Art. 7 Abs. 1 DSGVO) — deshalb stehen Zeitpunkt UND Quelle
  // beider Schritte in der Zeile.
  //
  // `token_hash` trägt BEIDE Wege aus der Mail: bestätigen und wieder
  // austragen. Er überlebt die Bestätigung, denn sonst liefe der
  // Austragen-Link ins Leere und die Löschung wäre nur über eine Mail an den
  // Betreiber zu haben. Gespeichert wird nur der Hash — wer die Datenbank
  // liest, kann damit niemanden austragen; die Kehrseite ist, dass die
  // Einladungsmail einen FRISCHEN Token braucht (der alte lässt sich nicht
  // wieder herstellen), es also immer der Link aus der jüngsten Mail gilt.
  //
  // Die Adresse steht dagegen im Klartext — sie IST der Zweck der Tabelle, an
  // sie geht die Einladung.
  `
  CREATE TABLE warteliste (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    notiz TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    eingetragen_am TEXT NOT NULL,
    eingetragen_ip TEXT,
    bestaetigt_am TEXT,
    bestaetigt_ip TEXT,
    eingeladen_am TEXT,
    eingeladen_code TEXT
  );
  CREATE INDEX idx_warteliste_reihe ON warteliste(bestaetigt_am);
  `,
  // Angepasste Texte der System-Mails. Die Tabelle hält nur ABWEICHUNGEN vom
  // Katalog in mailvorlagen.ts — eine leere Tabelle ist der Normalfall, und
  // eine bessere Formulierung im Code erreicht dann alle. Deshalb auch kein
  // Vorbefüllen beim Anlegen: Wer nichts geändert hat, hängt am Code.
  `
  CREATE TABLE mailvorlagen (
    schluessel TEXT PRIMARY KEY,
    betreff TEXT NOT NULL,
    titel TEXT NOT NULL,
    text TEXT NOT NULL,
    knopf TEXT NOT NULL,
    fuss TEXT NOT NULL,
    geaendert_am TEXT NOT NULL,
    geaendert_von TEXT REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  // Der Handle: die Adresse einer Person (`maptale.io/@henrik`). Regeln und
  // reservierte Wörter stehen in handle.ts.
  //
  // UNIQUE steht als INDEX und nicht an der Spalte, weil SQLite ein
  // `ALTER TABLE … ADD COLUMN … UNIQUE` nicht kennt. Der Index ist
  // NOCASE — Groß/Klein unterscheidet in einer URL nicht, und zwei Konten
  // „@Henrik" und „@henrik" wären dieselbe Adresse mit zwei Besitzern.
  //
  // `handles_reserviert` hält aufgegebene Handles 90 Tage fest. Das trennt zwei
  // Dinge, die nicht dieselbe Dauer brauchen: Alte LINKS leiten weiter, solange
  // die Adresse niemandem sonst gehört (kostet nichts); die SPERRE schützt
  // davor, dass jemand die Adresse übernimmt und die alten Links miterbt. 90
  // Tage sind der Ausgleich — lang genug gegen Identitätsübernahme, kurz genug,
  // dass Namen nicht auf Jahre blockiert sind (Instagram sperrt 14 Tage, GitHub
  // gibt sofort frei; beides zu wenig für einen Link in einem Reisebericht).
  `
  ALTER TABLE users ADD COLUMN handle TEXT;
  ALTER TABLE users ADD COLUMN handle_geaendert_am TEXT;
  CREATE UNIQUE INDEX idx_users_handle ON users(handle COLLATE NOCASE) WHERE handle IS NOT NULL;
  CREATE TABLE handles_reserviert (
    handle TEXT PRIMARY KEY COLLATE NOCASE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frei_ab TEXT NOT NULL
  );
  `,
  // Bestandskonten bekommen ihren Handle. Einmalig und deterministisch: nach
  // Anlegedatum, aus der E-Mail abgeleitet, bei Kollision mit Zähler — wer
  // zuerst da war, bekommt den kurzen Namen. Einmal vergeben ist er in der
  // Welt, deshalb läuft das hier und nicht beim nächsten Login.
  vergibFehlendeHandles,
  // Die übrigen Profilfelder (Etappe 2). Alle optional und alle NULL by default:
  // Ein Profil ist eine Einladung, kein Formular — wer nichts einträgt, hat
  // trotzdem eine vollständige Seite.
  //
  // `website` und `instagram` stehen als getrennte Spalten und nicht als Liste
  // von Links: Es sind genau zwei, jeder mit eigener Darstellung, und eine
  // Tabelle für zwei Zeilen wäre Beiwerk. Gespeichert wird jeweils die NACKTE
  // Form (`henrikheil.net`, `henrik.unterwegs`) — das Schema bzw. das `@` gehört
  // zur Anzeige, nicht zum Wert, sonst stünde dieselbe Adresse in drei
  // Schreibweisen in der Spalte.
  //
  // `titelbild` trägt entweder den Namen eines mitgelieferten Bildes
  // (`serpentinen.jpg`, s. public/titelbilder/) oder einen Pfad im
  // Benutzer-Storage (`titelbild/<zeitstempel>.jpg`). Die beiden lassen sich am
  // Schrägstrich unterscheiden — ein Vorschlag hat keinen.
  `
  ALTER TABLE users ADD COLUMN ort TEXT;
  ALTER TABLE users ADD COLUMN website TEXT;
  ALTER TABLE users ADD COLUMN instagram TEXT;
  ALTER TABLE users ADD COLUMN titelbild TEXT;
  `,
  // Kontoeinstellungen (Etappe 3): angemeldete Geräte sichtbar machen und der
  // E-Mail-Wechsel.
  //
  // **Die Sitzung bekommt ein Gesicht.** Ohne Gerät und Ort ist eine Liste von
  // Sitzungen eine Liste von IDs, an der niemand erkennt, welche die fremde
  // ist. Vom Absender bleibt deshalb genau so viel stehen, wie zum Wiedererkennen
  // nötig ist: `user_agent` roh (die Deutung — „Chrome auf macOS" — passiert in
  // der Anzeige, damit eine bessere Deutung keine Migration braucht) und
  // `ip_praefix` mit nur ZWEI Oktetten. Die vollständige Adresse wäre ein
  // Bewegungsprofil in der Datenbank; „84.119.x.x" beantwortet dagegen die
  // einzige Frage, die hier gestellt wird — war ich das, oder war das jemand
  // anderes?
  //
  // `zuletzt_gesehen` wird gedrosselt fortgeschrieben (s. AuthDienst.sieheSession):
  // ein UPDATE pro Anfrage wäre ein Schreibvorgang für jedes geladene Bild.
  //
  // Der E-Mail-Wechsel braucht einen dritten Token-Zweck UND einen Platz für
  // die neue Adresse — sie darf erst nach dem Klick in `users` landen, sonst
  // gehörte das Konto ab dem Absenden einer Adresse, die niemand bestätigt hat.
  // SQLite kann ein CHECK nicht ändern, also wird die Tabelle neu gebaut.
  `
  ALTER TABLE sessions ADD COLUMN user_agent TEXT;
  ALTER TABLE sessions ADD COLUMN ip_praefix TEXT;
  ALTER TABLE sessions ADD COLUMN zuletzt_gesehen TEXT;

  CREATE TABLE mail_tokens_neu (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zweck TEXT NOT NULL CHECK (zweck IN ('verify','reset','email')),
    hash TEXT NOT NULL UNIQUE,
    nutzlast TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  INSERT INTO mail_tokens_neu (id, user_id, zweck, hash, nutzlast, created_at, expires_at, used_at)
    SELECT id, user_id, zweck, hash, NULL, created_at, expires_at, used_at FROM mail_tokens;
  DROP TABLE mail_tokens;
  ALTER TABLE mail_tokens_neu RENAME TO mail_tokens;
  CREATE INDEX idx_mail_tokens_user ON mail_tokens(user_id, zweck);
  `,
  // Newsletter-Einwilligung (Etappe 4).
  //
  // **Ein Boolean allein reicht nicht.** Im Streitfall stünde dort „an", und
  // niemand wüsste seit wann, woher und wozu. Art. 7 Abs. 1 DSGVO verlangt, dass
  // der Verantwortliche die Einwilligung NACHWEISEN kann — deshalb die Historie
  // daneben: Zeitpunkt, Zustand, Quelle und der Wortlaut, dem zugestimmt wurde.
  // Der aktuelle Zustand bleibt trotzdem als Spalte an `users`: Der Versand
  // fragt ihn für jeden Empfänger, und „letzte Zeile der Historie" wäre dafür
  // eine Unterabfrage je Konto.
  //
  // `textfassung` trägt eine LABEL-Fassung (`registrierung-2026-08-06`), nicht
  // den Wortlaut selbst — sonst stünde derselbe Satz tausendfach in der
  // Tabelle. Die Zuordnung Label → Wortlaut steht in newsletter.ts, und ein
  // Drift-Wächter hält sie gegen die Sätze in der Oberfläche: Wer den Text
  // ändert, ohne das Label zu heben, würde sonst still eine Zustimmung zu
  // etwas anderem behaupten.
  //
  // ON DELETE CASCADE ist Absicht: Mit dem Konto geht die Adresse, und ohne
  // Adresse gibt es nichts mehr zu belegen. Die drei Jahre Aufbewahrung gelten
  // der ABMELDUNG (die Zeile bleibt, wenn jemand den Schalter umlegt), nicht
  // dem gelöschten Konto — dort schlägt Art. 17 durch.
  `
  ALTER TABLE users ADD COLUMN newsletter INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE newsletter_einwilligungen (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zeitpunkt TEXT NOT NULL,
    zustand TEXT NOT NULL CHECK (zustand IN ('an','aus')),
    quelle TEXT NOT NULL CHECK (quelle IN ('registrierung','konto','abmeldelink')),
    textfassung TEXT NOT NULL
  );
  CREATE INDEX idx_newsletter_einwilligungen ON newsletter_einwilligungen(benutzer_id, zeitpunkt);
  `,

  // 15 — „In Suchmaschinen erscheinen".
  //
  // Ein eigenes Feld neben `profil_sichtbarkeit` und nicht dessen dritte Stufe:
  // Ein Profil über den Link zu teilen ist etwas anderes, als unter dem eigenen
  // Namen auffindbar zu sein. Wer seine Reisen in einer Gruppe herumreicht, hat
  // damit nicht eingewilligt, dass die Adresse dauerhaft in einer Suche steht.
  //
  // **Standard aus.** Bei einem Feld, das eine Person unter ihrem Namen
  // auffindbar macht, ist der stille Standard die Entscheidung — nicht der
  // Schalter, den kaum jemand sucht. Bestandskonten bekommen deshalb 0, obwohl
  // ihre Profile schon öffentlich sein können: Öffentlich war bisher „wer den
  // Link hat", und dabei bleibt es, bis jemand aktiv etwas anderes will.
  //
  // Wirksam wird das Feld nur ZUSAMMEN mit `profil_sichtbarkeit = 'public'`
  // (s. server/src/seiten.ts) — ein privates Profil ist nie indexierbar, egal
  // was hier steht.
  `
  ALTER TABLE users ADD COLUMN suchmaschinen INTEGER NOT NULL DEFAULT 0;
  `,

  // 16 — Datenexport (Art. 20 DSGVO): die Job-Verwaltung.
  //
  // Eine Zeile je Anforderung, nicht je Konto: Was jemand wann angefordert hat,
  // ist die Auskunft, die man später braucht („mein Link ist abgelaufen").
  //
  // **Der partielle UNIQUE-Index ist der Kern.** Zwei Klicks auf denselben
  // Knopf dürfen keine zwei Archive bauen — und eine Prüfung im Code („läuft
  // schon einer?") hilft dagegen nicht: Zwischen SELECT und INSERT liegt ein
  // Fenster, in dem die zweite Anfrage dieselbe Antwort bekommt. Der Index
  // schließt es in der Datenbank: Ein zweiter laufender Job je Konto ist
  // schlicht nicht speicherbar, der INSERT scheitert, und die Route liefert
  // den vorhandenen zurück.
  //
  // `laeuft_ab_am` steht in der Zeile und wird nicht gerechnet: Die Frist gilt
  // ab FERTIGSTELLUNG, und eine später geänderte Konstante darf einen bereits
  // verschickten Link nicht rückwirkend verkürzen oder verlängern.
  `
  CREATE TABLE exporte (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('laeuft','fertig','fehler')),
    angefordert_am TEXT NOT NULL,
    fertig_am TEXT,
    laeuft_ab_am TEXT,
    bytes INTEGER,
    dateien INTEGER,
    fehler TEXT
  );
  CREATE UNIQUE INDEX idx_exporte_laufend ON exporte(benutzer_id) WHERE status = 'laeuft';
  CREATE INDEX idx_exporte_benutzer ON exporte(benutzer_id, angefordert_am);
  `,

  // Tracker-Integrationen: GPS-Tracks aus Sport-Uhren (Polar zuerst) landen
  // ohne Handgriff als spielbare Tour im Konto.
  // Konzept: docs/concepts/konzept_tracker_integrationen.md, Abschnitt 6.
  //
  // Drei Dinge, die man beim Vereinfachen verliert:
  //
  // `externer_nutzer` ist der EINZIGE Zuordnungsweg vom Webhook zum Konto —
  // der Anbieter schickt seine eigene Nutzerkennung, nicht unsere. Fehlt das
  // Feld, ist die Zustellung unzustellbar; fehlt der Index, wird aus jeder
  // Zustellung ein Tabellen-Scan. Er ist partiell, weil die Kennung erst nach
  // dem Token-Tausch feststeht (bei Polar sogar erst nach `POST /v3/users`):
  // Ohne `WHERE … IS NOT NULL` kollidierten alle noch unfertigen
  // Verknüpfungen auf NULL.
  //
  // `uebersprungen` ist ein eigener Status und kein Fehler: Aktivitäten ohne
  // GPS (Hallentraining, Krafteinheit) melden Anbieter genauso. Als Fehler
  // geführt, stünde die Fehlerliste eines Vielsportlers dauerhaft voll.
  //
  // `gesehen_am` gehört auf den SERVER und nicht als „gelesen"-Flag in den
  // Client: Zwei Geräte am selben Konto sollen dieselbe Tour nicht doppelt
  // melden.
  //
  // Der UNIQUE-Index auf (benutzer, anbieter, externe_id) ist der zweite
  // Dedup-Riegel — der erste ist `tours.client_tour_id`, den eine Cloud-Tour
  // als `polar:1234567` belegt. Webhooks werden bei Zustellzweifeln wiederholt
  // (Wahoo staffelt bis 72 h), und zwei parallele Zustellungen sehen zwischen
  // „gibt's schon?" und dem INSERT dasselbe.
  `
  CREATE TABLE tracker_verknuepfungen (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anbieter TEXT NOT NULL,
    externer_nutzer TEXT,
    tokens TEXT NOT NULL,
    laeuft_ab_am TEXT,
    status TEXT NOT NULL CHECK (status IN ('aktiv','abgelaufen','getrennt')),
    verbunden_am TEXT NOT NULL,
    zuletzt_sync_am TEXT,
    letzter_fehler TEXT
  );
  CREATE UNIQUE INDEX idx_tracker_konto ON tracker_verknuepfungen(benutzer_id, anbieter);
  CREATE UNIQUE INDEX idx_tracker_extern ON tracker_verknuepfungen(anbieter, externer_nutzer)
    WHERE externer_nutzer IS NOT NULL;

  CREATE TABLE tracker_importe (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anbieter TEXT NOT NULL,
    externe_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('wartet','laeuft','fertig','fehler','uebersprungen')),
    tour_id TEXT REFERENCES tours(id) ON DELETE SET NULL,
    gemeldet_am TEXT NOT NULL,
    fertig_am TEXT,
    gesehen_am TEXT,
    fehler TEXT
  );
  CREATE UNIQUE INDEX idx_importe_dedup ON tracker_importe(benutzer_id, anbieter, externe_id);
  CREATE INDEX idx_importe_offen ON tracker_importe(benutzer_id, status);
  `,

  // Ein gescheiterter Import darf kein Grabstein sein.
  //
  // Der Dedup-Index beantwortete bisher zwei verschiedene Fragen mit derselben
  // Zeile: „schon erledigt?" und „schon versucht?". Damit blockierte jeder
  // vorübergehende Fehler (Anbieter kurz weg, Netz, Speicher voll) die
  // Aktivität für immer — auch die wiederholte Zustellung, auf die das ganze
  // Verfahren baut (Wahoo staffelt bis 72 h), lief in den Index und tat nichts.
  //
  // `wiederholbar` trennt beides und wird vom AUSGANG gesetzt, nicht vom
  // Status: „ohne GPS" und „zu kurz" sind Aussagen über die Aktivität und
  // bleiben endgültig; „Speicher voll" und jeder echte Fehler sind Aussagen
  // über den Moment. `versuche` deckelt das Ganze, damit eine dauerhaft kaputte
  // Aktivität nicht bei jeder Zustellung erneut durch die Pipeline geht.
  `
  ALTER TABLE tracker_importe ADD COLUMN wiederholbar INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tracker_importe ADD COLUMN versuche INTEGER NOT NULL DEFAULT 1;
  `,

  // Push-Geräte: wohin „deine Tour ist fertig" geht.
  //
  // **`token` ist die plattformneutrale ADRESSE eines Geräts**, nicht unbedingt
  // ein Token: Auf Android steht dort seit FCM 25.1.0 die
  // Firebase-Installations-ID (die den Registrierungs-Token abgelöst hat), auf
  // iOS wird es der APNs-Gerätetoken sein. Ein Feld je Plattform hieße, in
  // jeder Abfrage zu entscheiden, welches gerade gilt.
  //
  // Drei Entscheidungen stecken in diesen zehn Zeilen:
  //
  // **Die Adresse ist global eindeutig.** Sie benennt eine INSTALLATION, nicht ein
  // Konto — meldet sich auf demselben Telefon ein zweites Konto an, ist es
  // derselbe Token. Ohne UNIQUE lägen dann zwei Zeilen da, und die nächste
  // Meldung ginge an beide: Der Vorbesitzer des Geräts erführe, dass jemand
  // anderes eine Tour bekommen hat. Die Registrierung schreibt deshalb per
  // UPSERT um, statt anzulegen.
  //
  // **Das Gerät hängt am App-Token, nicht nur am Konto.** Wer in „Angemeldete
  // Geräte" ein Telefon abmeldet, erwartet, dass dorthin nichts mehr geht —
  // die App selbst kann das nicht mehr aufräumen, sie ist ja gerade
  // ausgesperrt worden. Das CASCADE erledigt es an der einzigen Stelle, die es
  // sicher erledigen kann. NULL bleibt erlaubt, weil sich ein Client auch mit
  // einer Sitzung registrieren dürfte (heute tut es keiner).
  //
  // **`plattform` gibt es von Anfang an**, obwohl nur Android sendet: iOS
  // spricht später APNs, und ein nachträglich eingezogenes Feld hieße, jede
  // vorhandene Zeile raten zu müssen.
  `
  CREATE TABLE push_geraete (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id TEXT REFERENCES tokens(id) ON DELETE CASCADE,
    plattform TEXT NOT NULL CHECK (plattform IN ('android','ios')),
    token TEXT NOT NULL UNIQUE,
    angelegt_am TEXT NOT NULL,
    zuletzt_gesehen_am TEXT NOT NULL
  );
  CREATE INDEX idx_push_benutzer ON push_geraete(benutzer_id);
  `,
  // Die Player-Sitzung der App gehört zum App-Token, nicht in die Geräteliste.
  //
  // Der WebView kann kein Bearer-Token schicken, deshalb tauscht die App ihr
  // Token vor dem Abspielen gegen eine Sitzung. Das legte bis hierher bei JEDEM
  // Öffnen einer Tour eine neue an — zehn Touren angesehen, zehn Zeilen unter
  // „Angemeldete Geräte", jede bis zum Ablauf ihrer Frist. Und weil OkHttp
  // keinen Browser-User-Agent schickt, hieß jede davon „Unbekanntes Gerät":
  // Die Liste, an der man ein fremdes Gerät erkennen soll, füllte sich mit
  // Kopien des eigenen.
  //
  // `token_id` macht die Sitzung zu dem, was sie ist: ein zweiter Ausweis
  // DESSELBEN Geräts. Daran hängen drei Dinge — der Tausch gibt eine
  // vorhandene Sitzung zurück statt einer neuen, die Geräteliste zeigt sie
  // nicht mehr als eigenen Eintrag (das Telefon steht dort schon als App), und
  // das CASCADE nimmt sie mit, wenn jemand die App abmeldet. Ohne das Letzte
  // bliebe nach dem Abmelden ein gültiger Zugang stehen.
  //
  // Das DELETE räumt die Altlast weg, und zwar eng: NUR Sitzungen mit einem
  // OkHttp-User-Agent, denn genau die entstanden auf diesem Weg. Ein Browser
  // schickt so etwas nie, und die App holt sich beim nächsten Abspielen eine
  // neue — sie hat ihr Token, sie ist nicht ausgesperrt.
  `
  ALTER TABLE sessions ADD COLUMN token_id TEXT REFERENCES tokens(id) ON DELETE CASCADE;
  CREATE INDEX idx_sessions_token ON sessions(token_id);
  DELETE FROM sessions WHERE user_agent LIKE 'okhttp%';
  `,
  // Rückmeldungen aus der Alpha: der Eingang für alles, was Besuchern auffällt.
  //
  // **`benutzer_id` ist SET NULL und nicht CASCADE.** Wer sein Konto löscht,
  // soll nicht rückwirkend die Fehlerberichte mitlöschen, an denen die Alpha
  // sich repariert — die Meldung „Upload bricht bei großen Videos ab" ist keine
  // Aussage über eine Person, sobald der Bezug weg ist. Die Kennung ist der
  // Bezug; ohne sie bleibt der Sachverhalt.
  //
  // **`kontext` ist ein JSON-Text und keine Spaltenreihe.** Was zum Melden
  // nützlich ist, ändert sich mit jedem Client (Web heute, App morgen, iOS
  // später); jede neue Angabe wäre sonst eine Migration, und die alten Zeilen
  // trügen ein Feld, das es zu ihrer Zeit nicht gab. Ausgewertet wird beim
  // Lesen, nicht beim Schreiben. NULL heißt: Der Absender hat die technischen
  // Angaben abgewählt — das ist etwas anderes als „leer".
  //
  // **Der Status ist eine kleine, feste Menge.** Ein Freitextfeld liefe binnen
  // eines Monats in „offen", "Offen" und „todo" auseinander.
  `
  CREATE TABLE rueckmeldungen (
    id TEXT PRIMARY KEY,
    benutzer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    email TEXT,
    text TEXT NOT NULL,
    kontext TEXT,
    quelle TEXT NOT NULL CHECK (quelle IN ('web','app')),
    status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','erledigt')),
    notiz TEXT,
    angelegt_am TEXT NOT NULL,
    geaendert_am TEXT
  );
  CREATE INDEX idx_rueckmeldungen_status ON rueckmeldungen(status, angelegt_am DESC);
  `,

  // Die Dachzeile des Startscreens — der kleine Satz über dem Titel.
  //
  // Vorher war das eine erzeugte Zeile („Aufgezeichnet am 14. Mai 2026"), und
  // der naheliegende Ersatz wäre der geocodierte Ortsname gewesen. Beides ist
  // geraten: Nominatim liefert je nach Gegend eine andere Ebene (Stadtteil,
  // Stadt, Landkreis), und ob überhaupt ein Ort dort stehen soll oder eine
  // Sehenswürdigkeit, ein Satzanfang oder gar nichts, weiß nur der Autor.
  //
  // Deshalb ein Feld und kein Algorithmus. Drei Zustände, die man
  // auseinanderhalten muss: NULL heißt „nie etwas gesetzt" (der Render nimmt
  // die Vorbelegung aus dem Ortsnamen), der leere String heißt „ausdrücklich
  // keine Zeile", und ein Text ist der Text. Ein einzelnes Textfeld ohne NULL
  // könnte den ersten Fall nicht vom zweiten unterscheiden.
  `
  ALTER TABLE tours ADD COLUMN dachzeile TEXT;
  `,
  // Welle 1 der Englisch-Migration: Tabellen, Spalten, Werte und die
  // JSON-Blobs gehen auf Englisch
  // ([konzept_codebase_english_refactoring.md](../../docs/concepts/konzept_codebase_english_refactoring.md)
  // §4.2). Der Schritt ist der teuerste der Leiter und der einzige, der Daten
  // BEWEGT statt nur Namen zu tauschen.
  //
  // **Drei Sorten Arbeit, und nur die erste ist ein reines `RENAME`.**
  // Tabellen- und Spaltennamen tauscht SQLite in Ort und Stelle, samt der
  // Verweise in Indizes und `CHECK`-Ausdrücken. Die WERTE einer
  // `CHECK`-Wertemenge kann es nicht ändern: Dort steht der alte Wortlaut im
  // Constraint, also wird die Tabelle nach dem SQLite-Rezept neu gebaut (neue
  // Tabelle, `INSERT … SELECT` mit `CASE`, alte löschen, umbenennen, Indizes
  // neu). Und die JSON-Blobs in Spalten (`tours.stats_json`,
  // `rueckmeldungen.kontext`) tragen ihre Schlüssel im Text — die gehen per
  // `UPDATE` mit.
  //
  // **`foreign_keys` muss für diesen Schritt AUS sein**, und das ist keine
  // Bequemlichkeit: Mit eingeschalteten Fremdschlüsseln führt `DROP TABLE
  // users` ein implizites `DELETE FROM` aus, und jede `ON DELETE CASCADE` der
  // Kindtabellen räumt dabei die halbe Datenbank ab. Das Pragma wirkt nicht
  // innerhalb einer Transaktion, deshalb schaltet `migriere` es aussen um und
  // prüft danach `foreign_key_check` (s. dort).
  //
  // **Zwei Tabellen tragen deutsche Schlüssel als ZEILEN**, ohne `CHECK`:
  // `settings.key` hält die Betriebs-Schalter, `mail_templates.key` die im
  // Admin angepassten Vorlagen. Ohne das `UPDATE` fällt der neue Code STILL
  // zurück — die angepasste Vorlage wird unter `verification` nicht gefunden
  // und der Code-Standard verschickt, `invitation_required` gilt wieder als
  // ungesetzt.
  //
  // **Und die Platzhalter im gespeicherten Vorlagentext gehen mit.** Sie sind
  // die eine Stelle, an der diese Migration Produkttext anfasst: `{{frist}}`,
  // `{{groesse}}` und `{{austragenLink}}` stehen wörtlich in den Zeilen, die
  // jemand im Admin bearbeitet hat. Nur im Code umbenannt, renderte jede
  // angepasste Vorlage künftig `{{frist}}` als Klartext in die Mail.
  `
  -- 1. Tabellen, die nur ihren Namen wechseln
  ALTER TABLE einladungen RENAME TO invitations;
  ALTER TABLE einstellungen RENAME TO settings;
  ALTER TABLE handles_reserviert RENAME TO reserved_handles;
  ALTER TABLE mailvorlagen RENAME TO mail_templates;
  ALTER TABLE push_geraete RENAME TO push_devices;
  ALTER TABLE warteliste RENAME TO waitlist;

  -- 2. Spalten ohne Wertewechsel
  ALTER TABLE sessions RENAME COLUMN ip_praefix TO ip_prefix;
  ALTER TABLE sessions RENAME COLUMN zuletzt_gesehen TO last_seen_at;

  ALTER TABLE mail_tokens RENAME COLUMN zweck TO purpose;
  ALTER TABLE mail_tokens RENAME COLUMN nutzlast TO payload;

  ALTER TABLE invitations RENAME COLUMN notiz TO note;
  ALTER TABLE invitations RENAME COLUMN erstellt_von TO created_by;
  ALTER TABLE invitations RENAME COLUMN erstellt_am TO created_at;
  ALTER TABLE invitations RENAME COLUMN ablauf TO expires_at;
  ALTER TABLE invitations RENAME COLUMN eingeloest_von TO redeemed_by;
  ALTER TABLE invitations RENAME COLUMN eingeloest_am TO redeemed_at;

  ALTER TABLE settings RENAME COLUMN schluessel TO key;
  ALTER TABLE settings RENAME COLUMN wert TO value;

  ALTER TABLE reserved_handles RENAME COLUMN frei_ab TO free_from;

  ALTER TABLE mail_templates RENAME COLUMN schluessel TO key;
  ALTER TABLE mail_templates RENAME COLUMN betreff TO subject;
  ALTER TABLE mail_templates RENAME COLUMN titel TO title;
  ALTER TABLE mail_templates RENAME COLUMN text TO body;
  ALTER TABLE mail_templates RENAME COLUMN knopf TO button;
  ALTER TABLE mail_templates RENAME COLUMN fuss TO footer;
  ALTER TABLE mail_templates RENAME COLUMN geaendert_am TO updated_at;
  ALTER TABLE mail_templates RENAME COLUMN geaendert_von TO updated_by;

  ALTER TABLE push_devices RENAME COLUMN benutzer_id TO user_id;
  ALTER TABLE push_devices RENAME COLUMN plattform TO platform;
  ALTER TABLE push_devices RENAME COLUMN angelegt_am TO created_at;
  ALTER TABLE push_devices RENAME COLUMN zuletzt_gesehen_am TO last_seen_at;

  ALTER TABLE waitlist RENAME COLUMN notiz TO note;
  ALTER TABLE waitlist RENAME COLUMN eingetragen_am TO joined_at;
  ALTER TABLE waitlist RENAME COLUMN eingetragen_ip TO joined_ip;
  ALTER TABLE waitlist RENAME COLUMN bestaetigt_am TO confirmed_at;
  ALTER TABLE waitlist RENAME COLUMN bestaetigt_ip TO confirmed_ip;
  ALTER TABLE waitlist RENAME COLUMN eingeladen_am TO invited_at;
  ALTER TABLE waitlist RENAME COLUMN eingeladen_code TO invited_code;

  -- Die Indexnamen tragen die alten Tabellennamen im Wort; sie sind reine
  -- DDL-Bezeichner ohne Leser ausserhalb dieser Datei.
  DROP INDEX idx_warteliste_reihe;
  CREATE INDEX idx_waitlist_order ON waitlist(confirmed_at);
  DROP INDEX idx_push_benutzer;
  CREATE INDEX idx_push_devices_user ON push_devices(user_id);

  -- 3. Tabellen mit deutschen Werten in CHECK-Constraints: Neubau
  CREATE TABLE users_v2 (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    bio TEXT,
    avatar TEXT,
    profile_visibility TEXT NOT NULL DEFAULT 'private'
      CHECK (profile_visibility IN ('private','public')),
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    handle TEXT,
    handle_changed_at TEXT,
    location TEXT,
    website TEXT,
    instagram TEXT,
    banner TEXT,
    newsletter INTEGER NOT NULL DEFAULT 0,
    search_indexing INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO users_v2 SELECT
    id, email, pw_hash, name, created_at, email_verified, anzeigename, bio, avatar,
    profil_sichtbarkeit,
    CASE rolle WHEN 'nutzer' THEN 'user' ELSE rolle END,
    handle, handle_geaendert_am, ort, website, instagram, titelbild, newsletter, suchmaschinen
    FROM users;
  DROP TABLE users;
  ALTER TABLE users_v2 RENAME TO users;
  CREATE UNIQUE INDEX idx_users_handle ON users(handle COLLATE NOCASE) WHERE handle IS NOT NULL;

  CREATE TABLE tours_v2 (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    no INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created','processing','ready','failed')),
    visibility TEXT NOT NULL DEFAULT 'unlisted'
      CHECK (visibility IN ('private','unlisted','public')),
    client_tour_id TEXT,
    title TEXT,
    description TEXT,
    stats_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cover TEXT,
    finale INTEGER NOT NULL DEFAULT 0,
    finale_target TEXT,
    cover_thumb TEXT,
    kicker TEXT
  );
  INSERT INTO tours_v2 SELECT
    id, owner_id, no,
    CASE status
      WHEN 'angelegt' THEN 'created'
      WHEN 'verarbeitung' THEN 'processing'
      WHEN 'bereit' THEN 'ready'
      WHEN 'fehler' THEN 'failed'
      ELSE status END,
    visibility, client_tour_id, title, description, stats_json, fehler,
    created_at, updated_at, cover, finale, finale_ziel, cover_thumb, dachzeile
    FROM tours;
  DROP TABLE tours;
  ALTER TABLE tours_v2 RENAME TO tours;
  CREATE INDEX idx_tours_owner ON tours(owner_id, created_at DESC);
  CREATE UNIQUE INDEX idx_tours_client ON tours(owner_id, client_tour_id) WHERE client_tour_id IS NOT NULL;

  CREATE TABLE data_exports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('running','done','failed')),
    requested_at TEXT NOT NULL,
    finished_at TEXT,
    expires_at TEXT,
    bytes INTEGER,
    file_count INTEGER,
    error TEXT
  );
  INSERT INTO data_exports SELECT
    id, benutzer_id,
    CASE status
      WHEN 'laeuft' THEN 'running'
      WHEN 'fertig' THEN 'done'
      WHEN 'fehler' THEN 'failed'
      ELSE status END,
    angefordert_am, fertig_am, laeuft_ab_am, bytes, dateien, fehler
    FROM exporte;
  DROP TABLE exporte;
  CREATE UNIQUE INDEX idx_data_exports_running ON data_exports(user_id) WHERE status = 'running';
  CREATE INDEX idx_data_exports_user ON data_exports(user_id, requested_at);

  CREATE TABLE newsletter_consents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('on','off')),
    source TEXT NOT NULL CHECK (source IN ('signup','account','unsubscribe_link')),
    text_version TEXT NOT NULL
  );
  INSERT INTO newsletter_consents SELECT
    id, benutzer_id, zeitpunkt,
    CASE zustand WHEN 'an' THEN 'on' WHEN 'aus' THEN 'off' ELSE zustand END,
    CASE quelle
      WHEN 'registrierung' THEN 'signup'
      WHEN 'konto' THEN 'account'
      WHEN 'abmeldelink' THEN 'unsubscribe_link'
      ELSE quelle END,
    textfassung
    FROM newsletter_einwilligungen;
  DROP TABLE newsletter_einwilligungen;
  CREATE INDEX idx_newsletter_consents ON newsletter_consents(user_id, at);

  CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    email TEXT,
    text TEXT NOT NULL,
    context TEXT,
    source TEXT NOT NULL CHECK (source IN ('web','app')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  INSERT INTO feedback SELECT
    id, benutzer_id, email, text, kontext, quelle,
    CASE status
      WHEN 'offen' THEN 'open'
      WHEN 'in_arbeit' THEN 'in_progress'
      WHEN 'erledigt' THEN 'done'
      ELSE status END,
    notiz, angelegt_am, geaendert_am
    FROM rueckmeldungen;
  DROP TABLE rueckmeldungen;
  CREATE INDEX idx_feedback_status ON feedback(status, created_at DESC);

  CREATE TABLE tracker_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_user TEXT,
    tokens TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active','expired','disconnected')),
    connected_at TEXT NOT NULL,
    last_sync_at TEXT,
    last_error TEXT
  );
  INSERT INTO tracker_links SELECT
    id, benutzer_id, anbieter, externer_nutzer, tokens, laeuft_ab_am,
    CASE status
      WHEN 'aktiv' THEN 'active'
      WHEN 'abgelaufen' THEN 'expired'
      WHEN 'getrennt' THEN 'disconnected'
      ELSE status END,
    verbunden_am, zuletzt_sync_am, letzter_fehler
    FROM tracker_verknuepfungen;
  DROP TABLE tracker_verknuepfungen;
  CREATE UNIQUE INDEX idx_tracker_links_account ON tracker_links(user_id, provider);
  CREATE UNIQUE INDEX idx_tracker_links_external ON tracker_links(provider, external_user)
    WHERE external_user IS NOT NULL;

  CREATE TABLE tracker_imports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','skipped')),
    tour_id TEXT REFERENCES tours(id) ON DELETE SET NULL,
    reported_at TEXT NOT NULL,
    finished_at TEXT,
    seen_at TEXT,
    error TEXT,
    retryable INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO tracker_imports SELECT
    id, benutzer_id, anbieter, externe_id,
    CASE status
      WHEN 'wartet' THEN 'pending'
      WHEN 'laeuft' THEN 'running'
      WHEN 'fertig' THEN 'done'
      WHEN 'fehler' THEN 'failed'
      WHEN 'uebersprungen' THEN 'skipped'
      ELSE status END,
    tour_id, gemeldet_am, fertig_am, gesehen_am, fehler, wiederholbar, versuche
    FROM tracker_importe;
  DROP TABLE tracker_importe;
  CREATE UNIQUE INDEX idx_tracker_imports_dedup ON tracker_imports(user_id, provider, external_id);
  CREATE INDEX idx_tracker_imports_open ON tracker_imports(user_id, status);

  -- 4. Schlüsselzeilen, Platzhalter und JSON-Blobs
  UPDATE settings SET key = CASE key
    WHEN 'einladung_pflicht' THEN 'invitation_required'
    WHEN 'warteliste_offen' THEN 'waitlist_open'
    ELSE key END;

  UPDATE mail_templates SET key = CASE key
    WHEN 'verifikation' THEN 'verification'
    WHEN 'email-wechsel' THEN 'email-change'
    WHEN 'warteliste' THEN 'waitlist'
    WHEN 'warteliste-einladung' THEN 'waitlist-invitation'
    ELSE key END;

  UPDATE mail_templates SET
    subject = replace(replace(replace(subject, '{{frist}}', '{{deadline}}'), '{{groesse}}', '{{size}}'), '{{austragenLink}}', '{{leaveLink}}'),
    title   = replace(replace(replace(title,   '{{frist}}', '{{deadline}}'), '{{groesse}}', '{{size}}'), '{{austragenLink}}', '{{leaveLink}}'),
    body    = replace(replace(replace(body,    '{{frist}}', '{{deadline}}'), '{{groesse}}', '{{size}}'), '{{austragenLink}}', '{{leaveLink}}'),
    button  = replace(replace(replace(button,  '{{frist}}', '{{deadline}}'), '{{groesse}}', '{{size}}'), '{{austragenLink}}', '{{leaveLink}}'),
    footer  = replace(replace(replace(footer,  '{{frist}}', '{{deadline}}'), '{{groesse}}', '{{size}}'), '{{austragenLink}}', '{{leaveLink}}');

  UPDATE tours SET stats_json = replace(replace(replace(
      stats_json, '"fotos":', '"placedMedia":'), '"spur":', '"trackSignature":'), '"ende":', '"end":')
    WHERE stats_json IS NOT NULL;

  UPDATE feedback SET context = replace(replace(replace(replace(replace(
      context, '"geraet":', '"device":'), '"plattform":', '"platform":'),
      '"schirm":', '"screen":'), '"seite":', '"page":'), '"sprache":', '"language":')
    WHERE context IS NOT NULL;
  `,
]

/**
 * Vergibt jedem Konto ohne Handle einen — der Backfill aus Migration 12.
 *
 * Als benannte Funktion und nicht als anonymer Schritt in der Liste, damit sie
 * für sich prüfbar ist: Ein Test, der stattdessen `user_version` zurückdreht,
 * ließe die FOLGENDEN Migrationen ein zweites Mal laufen und scheiterte an der
 * ersten doppelten Spalte.
 *
 * Deterministisch nach Anlegedatum: Wer zuerst da war, bekommt den kurzen
 * Namen. Wiederholbar ist sie auch (`WHERE handle IS NULL`) — einmal Vergebenes
 * fasst sie nie wieder an, denn der Name ist dann in der Welt.
 */
export function vergibFehlendeHandles(db: Db): void {
  const zeilen = db
    .prepare('SELECT id, email FROM users WHERE handle IS NULL ORDER BY created_at ASC, id ASC')
    .all() as Array<{ id: string; email: string }>
  const belegt = new Set(
    (
      db.prepare('SELECT handle FROM users WHERE handle IS NOT NULL').all() as Array<{
        handle: string
      }>
    ).map((z) => z.handle.toLowerCase()),
  )
  const setze = db.prepare('UPDATE users SET handle = ? WHERE id = ?')
  for (const zeile of zeilen) {
    const handle = freierHandle(handleAusEmail(zeile.email), (h) => belegt.has(h))
    belegt.add(handle)
    setze.run(handle, zeile.id)
  }
}

export function oeffneDb(pfad: string): Db {
  const db = new Database(pfad)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migriere(db)
  return db
}

/**
 * Schritte, die OHNE Fremdschlüssel laufen müssen — nach Index in
 * `MIGRATIONEN`, also 0-basiert.
 *
 * Ein Tabellen-Neubau nach dem SQLite-Rezept löscht die alte Tabelle, und
 * `DROP TABLE` führt bei eingeschalteten Fremdschlüsseln ein implizites
 * `DELETE FROM` aus: Jede `ON DELETE CASCADE` der Kindtabellen räumt dabei ab,
 * was an der Zeile hängt. Bei `users` wäre das die halbe Datenbank.
 *
 * Das Pragma wirkt NICHT innerhalb einer Transaktion, deshalb steht es hier
 * aussen um sie herum; `foreign_key_check` danach ist die Gegenprobe.
 */
const OHNE_FREMDSCHLUESSEL = new Set<number>([22])

/** Zahl der Schritte — zugleich der `user_version`, den eine frische DB hat. */
export const MIGRATIONS_STAND = MIGRATIONEN.length

/**
 * Nur bis zu einem Stand migrieren.
 *
 * Für den Leiter-Test: Er füllt die Datenbank auf dem Stand VOR einem Schritt
 * mit je einer Zeile und lässt dann den Schritt darüber laufen. Ein Test, der
 * stattdessen `user_version` zurückdreht, prüfte den Schritt gegen ein Schema,
 * das es so nie gab.
 */
export function migriereBis(db: Db, ziel: number): void {
  migriere(db, ziel)
}

function migriere(db: Db, bis = MIGRATIONEN.length): void {
  const stand = db.pragma('user_version', { simple: true }) as number
  for (let i = stand; i < bis; i++) {
    const schritt = MIGRATIONEN[i]
    if (!schritt) continue
    const ohneFk = OHNE_FREMDSCHLUESSEL.has(i)
    if (ohneFk) db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        if (typeof schritt === 'string') db.exec(schritt)
        else schritt(db)
        db.pragma(`user_version = ${i + 1}`)
      })()
      if (ohneFk) {
        const verletzt = db.pragma('foreign_key_check') as unknown[]
        if (verletzt.length > 0) {
          throw new Error(
            `Migration ${i + 1} hat ${verletzt.length} Fremdschlüssel-Verletzungen hinterlassen`,
          )
        }
      }
    } finally {
      if (ohneFk) db.pragma('foreign_keys = ON')
    }
  }
}
