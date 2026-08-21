# Benutzerverwaltung (Oberfläche)

Diese Datei lädt, sobald unter `src/admin/` gearbeitet wird. Die Server-Seite (Rollen,
Einladungen, Warteliste, System-Mails) steht in [server/CLAUDE.md](../../server/CLAUDE.md).


Eigene Seite ([admin.html](../../admin.html) + [src/admin/](./)), nicht Teil des Studios:
Das Studio ist der Schneideraum für Touren, das hier ist Hausverwaltung. Erreichbar über das
Konto-Menü im Studio — der Eintrag erscheint nur für Admins. Rechnende Teile liegen DOM-frei in
[admin-model.ts](admin-model.ts), Server-Seite in
[server/src/routes/admin.ts](../../server/src/routes/admin.ts) hinter `requireAdmin`.

**Sechs Reiter, und die Regel steht bei dem, was sie regelt.** Konten · Einladungen ·
Warteliste · Statistiken · Protokoll · System-Mails; alle sechs Panels liegen im DOM, sichtbar ist eins
(dasselbe `hidden`-Muster wie im Studio). Die Liste `TABS` in [admin-model.ts](admin-model.ts)
ist die einzige Quelle für Leiste, Zähler und URL-Anhang (`/admin#invitations`, per
`replaceState` — mit `pushState` führte der Zurück-Knopf durch die zuletzt besuchten Reiter,
statt die Seite zu verlassen); ein Drift-Wächter prüft, dass zu jedem Reiter ein
`panel-<id>` in [admin.html](../../admin.html) steht. Die beiden Schalter der Registrierung liegen
NICHT mehr zusammen in einer Karte, sondern je im Reiter, den sie betreffen — die
Einladungspflicht bei den Einladungen, das Wartelisten-Angebot bei der Warteliste. Weil die
Warteliste dadurch „angeschaltet, aber ohne Wirkung" sein kann, ohne dass die Ursache
sichtbar wäre, steht dort ein Knopf zum anderen Reiter; ob sie wirkt, rechnet
`waitlistOffered` nach (Spiegel der Server-Regel, Wahrheitstabelle doppelt getestet).
**Der Zähler am Reiter ist ein Hinweis, keine Statistik:** bei den Konten sind es alle, bei
Einladungen die OFFENEN, bei der Warteliste die WARTENDEN — und nur die färbt sich amber,
denn nur dort wartet Arbeit. Bei Statistiken steht „Live", bei den Vorlagen ihre Zahl; was
die Angabe jeweils zählt, steht im `aria-label`.

**Das Protokoll zeigt, was die API zuletzt gemeldet hat** — die letzten 500 Warnungen und
Fehler aus einem Ringpuffer im Arbeitsspeicher ([server/src/audit-log.ts](../../server/src/audit-log.ts)).
Bewusst keine Tabelle: Ein Protokoll in der Datenbank will Fristen, Indizes und eine
Aufräumerei, und die Frage dahinter ist fast immer „was ist gerade eben schiefgegangen?".
Der Preis steht offen im Reiter, denn Leere ist hier die GUTE Nachricht und darf nicht
wie ein Ausfall klingen: „Nichts vorgefallen seit dem Start der API am … um …".
Gefüllt wird der Puffer am **Logger-Ziel** (`auditLogTarget` als pino-Stream in
[app.ts](../../server/src/app.ts)), nicht an den Aufrufstellen — sonst gäbe es zwei Wege, etwas
zu melden, und der zweite bliebe liegen; die Zeile geht dabei unverändert weiter nach
stdout, das Docker-Log bleibt also die vollständige Quelle. Drei Feinheiten: Der Zähler am
Reiter zählt nur die FEHLER (eine Warnung ist Betrieb), die Zusammenfassung über der Liste
zählt denselben Vorrat (sonst widerspräche sie ihm sichtbar), und Meldungen, die während
des Lesens eintreffen, rutschen NICHT von selbst in die Liste, sondern warten hinter dem
Streifen „N neue Meldungen anzeigen". Der Abgleich läuft über `since=<höchste Nummer>`;
weil die Nummern nach einem Neustart wieder bei 1 beginnen, vergleicht die Ansicht
zusätzlich `startedAt` und lädt dann komplett neu — ohne das bliebe sie nach jedem Deploy
für immer still und sähe dabei gesund aus.

**Suche und Filter greifen mit UND, und die Segmente zählen INNERHALB der Suche.** Dadurch
beantwortet die Filterleiste zwei Fragen auf einmal (wie viele passen, wie sie sich
verteilen) und eine Zeile „3 von 12" erübrigt sich. Die Sperr-Regeln zählen dagegen über
ALLE Konten: Ein Filter darf nicht darüber entscheiden, ob der letzte Admin löschbar wird.

**Zwei Fallen, die diese Seite gekostet hat:** Das `close`-Ereignis eines `<dialog>` kam in
der Abnahme nicht an — eine Rückfrage, deren Versprechen daran hängt, hängt für immer, und
der Löschen-Knopf tat schlicht nichts. Deshalb lösen die KNÖPFE die Frage auf
(`beendeFrage`), `close`/`cancel` sind nur das Auffangnetz für Esc. Und ein modaler Dialog
liegt im Browser-Top-Layer über allem: Der Flash zur Testmail lag unter dessen Backdrop,
also meldet aus dem Mail-Dialog heraus seine eigene Fußzeile (DESIGN.md sagt dasselbe).
Rückfragen laufen nicht mehr über `window.confirm` — das kam in Systemoptik, nannte oben die
Domain und gab dem gefährlichen Knopf dieselbe Gestalt wie dem harmlosen.

