---
stand: 2026-08-17
status: Entwurf, nichts gebaut
betrifft:
  - Player (src/map.ts)
  - Studio-Editor
  - später Export-Auftrag
  - Konten/Quota
  - Location Platform
icon: muenze
---

# Konzept: Monetarisierung und Esri-Lizenz

**Ziel:** Festhalten, woran Maptale Geld verdienen kann und unter welcher
Esri-Lizenz die Satellitenkarte überhaupt im Produkt stehen darf. Relive
verkauft eine Datei. Maptale ist ein Player mit Link. Die Karte hängt an jedem
öffentlichen Aufruf. Daraus folgen Lizenzweg und Paywalls.

**Keine Rechtsberatung.** Die Sätze unten sind Lesarten öffentlicher Esri-Texte
(Stand Recherche 2026-08-17, Vertragstexte E204 vom 21. Nov. 2025 und E300 vom
13. Nov. 2025 im Wortlaut geprüft). Vor dem Umstellen der Kachel-URL und vor dem
ersten öffentlichen Film: Esri Deutschland fragen.

Verwandt:
- [konzept_video_export.md](konzept_video_export.md). Die MP4 wäre der Weg, auf
  dem Zuschauen Esri nichts kostet. **Mit Esri-Kacheln ist sie nach Aktenlage
  weder herstellbar noch verteilbar** (Abschnitt 3.5). Wer dort weiterbaut,
  liest zuerst Abschnitt 8.
- [editor-ausbau.md](editor-ausbau.md). Das Studio ist der Grund, nicht Relive
  zu sein.
- Quota und Speicher liegen schon im Server (`server/src/quota.ts`).

---

## 1. In einem Satz

Zuschauer zahlen uns nichts. Wer herstellt, zahlt für Speicher, Schnitt und
Export. Die Satellitenkarte kommt über ArcGIS Location Platform (Sessions),
nicht über die anonyme World-Imagery-URL. Der Player-Link ist Verbreitung mit
laufenden Kachelkosten, und die deckelt der Server selbst, weil Esri es nicht
tut (Abschnitt 7).

Der Player als bezahltes Produkt ist bei Esri ausdrücklich vorgesehen. **Die
MP4 ist es nicht**, weder ihre Herstellung noch ihre Verbreitung (Abschnitt
3.5). Der Weg, auf dem Zuschauen billig werden sollte, ist damit der Weg, für
den es eine zweite Bildquelle braucht (Abschnitt 8).

---

## 2. Relive ist die Datei, Maptale ist der Player

Relive hat **keinen Player** im Sinne von Maptale. Was man teilt und anschaut,
ist eine gerenderte MP4. Steuerleiste, Filmuhr, Foto-Halt, Adresse `/tour/…`:
das gibt es dort nicht.

In der Relive-App daneben, nicht als geteiltes Erlebnis:

- eine normale 2D-Karte (zoomen, schieben), kostenlos
- eine Memory-Map (alle Touren auf einer Übersicht)
- Plus: **Interactive route**, „Explore every detail in 3D“. Spur auf dem
  Terrain anfassen. Eine 3D-Karte in der App, kein Film. Kein Gegenstück zu
  unserem Player.

Relive Plus (US, Stand 2026): etwa **7 $/Monat** oder **39 $/Jahr**. HD, Musik,
unbegrenzt schneiden, Tempo, mehr Fotos, Relive-Tafel weg, schnellere
Warteschlange, Aktivitäten über 12 Stunden, Interactive route. Kostenlos: ein
Clip pro Aktivität, oft ohne Fotos, mit Relive-Tafel, in der Schlange. Relive
rafft auf etwa eine Minute.

Wir haben es umgekehrt: der interaktive Film ist das Produkt, die Datei die
Ableitung. Nicht den Clip nachbauen und denselben Preis verlangen. Den Film und
den Schneideraum verkaufen, den Clip als Zweitformat dazu.

Relive hat einen **bezahlten ArcGIS-Vertrag**. Deshalb darf deren Clip Esri
zeigen, und deshalb können sie Kacheln unter Bedingungen cachen, die der
öffentliche PAYG-Tarif nicht enthält. Dieselben Bildnamen (Esri, Maxar),
anderer Vertrag.

---

## 3. Esri-Lizenz

### 3.1 Was Maptale heute lädt

Player und Studio-Editor holen World Imagery über die anonyme URL

`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`

(`src/map.ts`, `src/studio/editor.ts`). Galerie und Profil tun das nicht.
Attribution steht am ⓘ ([src/map-attribution.ts](../../src/map-attribution.ts)) und im
Impressum: Esri, Maxar, Earthstar Geographics.

Das ist der Living-Atlas-Dienst **ohne** Konto, **ohne** API-Key, **ohne**
ArcGIS-Online-Abo.

### 3.2 Was die öffentlichen Texte dazu sagen

Esri-FAQ zu Items, die Esri in ArcGIS Online besitzt (21. April 2025):

Mit ArcGIS-Online-Abo darf man Esri-Inhalte **in Esri-Software** nutzen,
Screenshots und gedruckte Karten mit Attribution, Offline nur über Esri
Content Packages in Esri-Software.

Ausdrücklich **nicht**:

- Basemap-Kacheln systematisch abernten, außer über Content Packages
- Kacheln redistribuieren
- von Esri gehosteten Inhalt herunterladen, redistribuieren oder selbst hosten
- Living-Atlas-Inhalt kommerziell in der eigenen App oder im eigenen Produkt
  nutzen. Dafür Esri um eine Lizenz bitten.

Ein Esri-Mitarbeiter in der Developer-Community zum selben World-Imagery-Dienst
ohne Key: nicht kostenlos, braucht ArcGIS Online oder Enterprise, **nicht für
kommerzielle Nutzung**.

Der alte Developer-Freikontingent (OSM-Wiki / esri-leaflet) galt nur zusammen:
Developer-Konto, **kein Umsatz**, unter einer Million Kacheln, Attribution.
Davon ist hier nichts erfüllt. Maptale ist ein Produkt mit Konten und Quota.

**Der Player allein ist schon kommerzielle Nutzung der Kacheln.** Export und
Welt-Cache wären extra. Attribution am ⓘ macht aus der anonymen URL keine
Lizenz. In der Alpha mit wenig Traffic fällt das oft niemandem auf. Das ist
Duldung, keine Lizenz.

### 3.3 Falsche Schubladen

| Produkt | Warum nicht |
| --- | --- |
| Anonyme `server.arcgisonline.com`-URL | Living Atlas, nicht fürs kommerzielle Produkt |
| ArcGIS Online Creator (US grob 500 bis 700 $/Jahr) | GIS-Arbeitsplatz, keine Lizenz für Tausende Player-Nutzer |
| Esri-Deutschland-Shop / Public Account | Public = nichtkommerziell. Euro-Festpreise für Apps stehen nicht öffentlich |
| Eigener Kachel-Spiegel „alle Touren, einmal laden“ | Selbst-Hosten, vom PAYG-Tarif nicht gedeckt |
| World Imagery for Export | Anderes Produkt mit Mengengrenze, nicht die Player-URL |

### 3.4 Der vorgesehene Weg: ArcGIS Location Platform

Konto: [location.arcgis.com/sign-up](https://location.arcgis.com/sign-up/).
Früher ArcGIS Developer. Mail von `no-reply@esri.com` bestätigen, Portal-URL
wählen, Aktivierung innerhalb von 24 Stunden.

Dann im Dashboard: Developer Credentials, API-Key mit Privilege
`premium:user:basemaps`. Pay-as-you-go (PAYG, Abschnitt 4) bleibt in der Alpha
**aus**.

Die Karte kommt über den **Basemap Styles Service**, Stil `arcgis/imagery`
(Satellit, offiziell mit MapLibre). Das ist **nicht** dieselbe anonyme
World-Imagery-URL. Optisch dasselbe Produkt, anderer Vertrag, andere Zählung.
Ob Bildstand und Maxar-Mosaik 1:1 gleich sind, ist offen (Abschnitt 12).

Maptale wäre dann eine **Customer Application**: eigene Substanz (Film,
Studio, Tour), die Location Services nicht ersetzt. Zuschauer sind Application
Users. Der Key gehört uns, nicht den Nutzern.

Vertrag (E204, 21. Nov. 2025), die Stellen die kippen können:

- Login-Daten nicht teilen, technische Zugangskontrolle nicht umgehen.
- Location Platform nicht weiterverkaufen, nicht als reinen Kartendienst an
  Dritte durchreichen.
- Ausgabe (**Resultant Output**) nur zur Visualisierung in der eigenen App.
- **Ein Request, ein Application User.** Ein Token oder eine Kachel-Antwort
  darf nicht viele Nutzer bedienen. Server-Pool „eine Session für die ganze
  Website“ ist genau das Verbot.
- Attribution an Esri und Lizenzgeber darf nicht weg.
- Cachen und Speichern der Ausgabe nur so weit, wie die **HTTP-Cache-Header**
  von Esri es erlauben, um die App zu betreiben. Kein eigenes Weltarchiv.
- Statische Endform (PDF, GIF, JPEG, HTML, „unalterable final form“) ist
  genannt. MP4 steht in der Liste nicht.
- Customer Applications brauchen Nutzungsbedingungen, die Esris Regeln an die
  Endnutzer durchreichen. Esri darf die prüfen.

**Ein bezahltes Maptale ist ausdrücklich erlaubt.** Der Vertrag verweist in 3.3
auf ein zweites Dokument, die produktspezifischen Nutzungsbedingungen (E300,
13. Nov. 2025). Dessen Ziffer 89 gilt für ArcGIS Location Platform und gestattet
wörtlich, **umsatzbringende** Customer Applications an Dritte zu vertreiben,
sofern sie sich authentifizieren. Das ist keine Duldung und keine Auslegung: Der
Player als Produkt mit Abo ist der vorgesehene Fall. Damit ist die Kachelfrage
im Player erledigt, sobald der Weg aus 3.4 gegangen ist. Was NICHT erledigt ist,
steht in 3.5.

### 3.5 Player, Screenshot, Film, Cache

| Was | Lesart |
| --- | --- |
| Interaktiver Player mit Location Platform, Session pro Nutzer, Attribution | Der vorgesehene kommerzielle Fall |
| Screenshot, Folie, Bericht mit Attribution | Static Maps, erlaubt für eigene Sache |
| MP4 mit Credit-Tafel am Ende | Liest sich verboten, gleich dreifach. Siehe unten. |
| Serverseitiges Rendern der MP4 | Liest sich verboten. Wörtlich das Beispiel in E300 Ziffer 10. |
| Kacheln auf eigenem Server für alle Touren | Verboten ohne Sondervertrag |
| Browser-Cache gemäß Esri-Headern | Erlaubt, soweit nötig für die App |
| DEM von AWS Terrarium | Nicht Esri. Darf gecacht werden. |

**Der Film war im ersten Entwurf als „unklar" notiert. Nach dem Wortlaut ist er
es nicht.** Drei voneinander unabhängige Stellen treffen ihn, jede für sich
genügt:

1. **Die Liste der Endformen ist geschlossen.** E204 Ziffer 3.1.d.6.B erlaubt
   Resultant Output in statischem Format, `„(i.e. PDF, GIF, JPEG, HTML)"`, in
   unveränderlicher Endform. Dort steht **i.e.**, nicht e.g. Dieselben Verträge
   schreiben an anderer Stelle e.g., wenn Beispiele gemeint sind (E300 Ziffer
   10). Die Aufzählung ist als abschließend gemeint, MP4 fehlt nicht aus
   Versehen.
2. **Weitergabe an Dritte ist untersagt.** Ziffer 3.1.d.1 verbietet, Resultant
   Output an Dritte weiterzuverteilen; Ziffer 3.1.d.3 erlaubt die Nutzung nur
   zur Visualisierung **und nur innerhalb der eigenen Anwendung**. Eine Datei
   auf WhatsApp oder Instagram ist beides nicht. Das Wort „video" kommt im
   ganzen E204 genau einmal vor, in der Definition von *Third-Party Content*,
   also von FREMDEM Material. Als erlaubte Ausgabeform steht es nirgends.
   Esris Static-Maps-Seite bestätigt es von der anderen Seite: Bildschirmfoto,
   Druck, PDF, Präsentation, „jede andere statische Wiedergabe".
3. **Und der Renderer ist schon vorher dran.** E300 Ziffer 10 gilt für ArcGIS
   Location Platform: Session-Tokens nur je Anwendung und je Gerät,
   **programmatische Nutzung von Session-Tokens ist nicht gestattet**, als
   Beispiel genannt das Exportieren von Kachelmengen. Ein Cloud-Render ist ein
   kopfloser Browser auf unserem Server, der mit einem Token die Kacheln einer
   ganzen Tour zieht. Das ist wörtlich der genannte Fall. Der Export scheitert
   damit bereits an der Herstellung, unabhängig davon, was mit der Datei danach
   geschieht.

Damit dreht sich die Risikoverteilung des ersten Entwurfs um. Die Kacheln im
Player sind sauber lizenzierbar (3.4). **Der Export ist der Teil, der nicht
geht.** Fragen kostet nichts, und Esri kann einen Sondervertrag anbieten, so wie
Relive ihn hat (3.6). Planen sollte man aber nicht mit einem Ja, sondern mit
Abschnitt 8.

### 3.6 Was Relives Vertrag kauft und unserer PAYG nicht

PAYG kauft **Zugriff auf Esris CDN**, gezählt in Sessions oder Kacheln. Relive
kauft (nicht öffentlich) vermutlich Volumen, Cache, Export in die Datei.
Größe: Enterprise, oft fünfstelliger Jahresbetrag, nicht die 36 $ aus
Abschnitt 6. Ab ein paar zehntausend Plays im Monat wird das ein Gespräch mit
Esri Deutschland, nicht Haarspalterei an der FAQ.

---

## 4. Sessions, nicht Kacheln

Location Platform kennt zwei Zählarten für Basemaps. Öffentliche US-Preise
([location.arcgis.com/pricing](https://location.arcgis.com/pricing/)):

| Verbrauch | Frei / Monat | Danach |
| --- | --- | --- |
| Basemap-Kacheln | 2 Mio. | 0,15 $ / 1.000 Kacheln |
| Basemap-Sessions | 1.000 | 4 $ / 1.000 Sessions |
| Technischer Support | Community | 2.500 $ / Jahr, optional |

Eine **Session** ist: ein Nutzer, eine Anwendung, bis zu 12 Stunden, unbegrenzt
Kacheln. Gebühren fallen an, wenn `/sessions/start` antwortet, nicht wenn
jemand Play drückt oder die Kamera fliegt. Zoomen und Tausende Kacheln in
derselben Session kosten nichts extra. Ein 3D-Flug frisst sonst leicht Tausende
Kacheln. Deshalb Sessions, nicht das Kachel-Modell.

**Pay-as-you-go (PAYG)** ist der Schalter im Dashboard. Aus (Standard, keine
Kreditkarte nötig): nach dem Freikontingent sperrt Esri die Karte, keine
Rechnung. An: dieselbe Nutzung läuft weiter und wird abgerechnet.

1.000 Sessions sind für die Alpha sehr viel. Studio-Editor zählt extra, sobald
er denselben Key nutzt.

Esri Deutschland listet keine Euro-Festpreise. Angebot über Store oder Vertrieb.

---

## 5. Reload zählt nur, wenn der Code neu startet

Esri rechnet nicht „Seite neu geladen“. Esri rechnet `/sessions/start`.

Die Tutorials rufen beim Start immer `BasemapSession.start()` auf. Das Token
liegt in einer JS-Variable und stirbt mit der Seite. Deshalb wirkt F5 in der
Demo wie eine neue Rechnung. Die REST-Doku sagt: das Token gilt, solange die
Anwendung läuft. Geschlossen oder neu gestartet: neue Session. Nirgends steht
„F5“, nirgends `sessionStorage`, nirgends ein Verbot, das Token zu speichern.

Im ersten Wurf von `@esri/arcgis-rest-basemap-sessions` gab es `serialize()` und
`deserialize()`: Token plus Zeiten wiederherstellen **ohne** `/sessions/start`.
Dieselbe Idee wie bei OAuth-`UserSession` und localStorage. In der
veröffentlichten Version ist die Hilfsmethode weg. Der Konstruktor-Kommentar
nennt Restore trotzdem noch. Das MapLibre-Plugin kennt keins und startet immer
neu.

`sessionStorage` (gleicher Tab, gleiche Origin) überlebt F5 und den Sprung von
Tour zu Tour. Tab schließen löscht es. Ein zweiter Tab sieht es nicht. Das ist
die Browser-Übersetzung von „diese Anwendung in diesem Tab läuft noch“.
`localStorage` ginge über Tab-Wechsel bis `endTime`. Näher an „Nachmittag in
Maptale“, weiter weg von „application is running“.

Ein Token für alle Besucher auf dem Server ist verboten. Ein Token für
**denselben** Menschen im selben Browser bis `endTime` ist die sinnvolle
Lesart.

**Und der Vertrag ist hier großzügiger als der erste Entwurf annahm.** E300
Ziffer 10 sagt: Session-Tokens nur **je Anwendung und je GERÄT**. Der Vertrag
denkt also in Geräten, nicht in Tabs. `sessionStorage` (ein Tab) ist damit
strenger als verlangt, `localStorage` (ein Gerät, bis `endTime`) liegt näher am
Wortlaut und spart im Zweifel echtes Geld, weil derselbe Mensch die zweite Tour
nicht neu bezahlt. Derselbe Satz zieht allerdings die Grenze zum Export: Was
danach kommt, verbietet programmatische Nutzung ausdrücklich (3.5). Der Token
darf im Gerät liegen. Er darf nicht in einen Renderer.

Android mit offenem Prozess: eine Session am Nachmittag ist der vorgesehene
Fall.

---

## 6. Öffentliche Touren kosten pro Zuschauer

Relive zahlt Esri beim **Rendern**. Die WhatsApp-Datei ist danach ein File.
Nochmal anschauen: null Esri.

Maptale zahlt Esri beim **Abspielen**. Jeder Mensch, der `/tour/…` öffnet, ist
ein Application User. Dessen Token darf nicht mit dem nächsten geteilt werden.
Persistenz hilft nur derselben Person. Eine öffentliche Tour mit 50.000
verschiedenen Leuten sind 50.000 Sessions, auch wenn niemand F5 drückt.

Grobe Rechnung, Session-Modell, PAYG an, 1.000 frei:

| Aufrufe in einem Monat | Esri grob |
| --- | --- |
| 1.000 | 0 $ |
| 10.000 | 36 $ |
| 50.000 | 200 $ |
| 500.000 | 2.000 $ |
| 5 Mio. | 20.000 $ |

50.000 ist spürbar, kein Ruin. 5 Millionen wäre Hit-Größe und dann ein
richtiger Posten, oder der Anlass für den Esri-Vertrag. Ohne PAYG steht nach
1.000 Sessions die Karte für alle. Ein viraler Link in der Alpha wäre dann ein
Ausfall, keine Rechnung.

Der **Link** ist Reichweite mit laufenden Kachelkosten. Die **MP4** wäre
Reichweite ohne Esri-Aufruf und damit der Weg, auf dem Zuschauen billig wird.
Genau der ist nach 3.5 versperrt, solange die Bilder von Esri kommen. Das ist
der teuerste Satz dieses Dokuments: Der Ausweg aus den laufenden Kosten hängt an
demselben Vertrag wie die Kosten selbst. Vorschaukarten ohne Esri (Galerie,
Profil) bleiben gratis.

---

## 7. Deckel und Rückfall

**Esri hat kein Ausgabenlimit.** Kein Budget-Cap, keine automatische
Abschaltung an der Freigrenze, nur ein Dashboard zum Nachschauen. Esri sagt
selbst, man denke über bessere Kontrollen nach. Damit gibt es heute genau zwei
Zustände, und beide sind ungeeignet:

- **PAYG aus:** Nach 1.000 Sessions ist die Karte weg. Für alle, auch für
  zahlende Nutzer, und zwar genau in dem Moment, in dem zum ersten Mal viele
  Leute hinschauen. Der virale Link zeigt dann eine kaputte Seite.
- **PAYG an:** Es läuft weiter, und niemand hält die Kreditkarte an. 200 $ sind
  verkraftbar. Ein Bot, ein Skript oder eine Schleife auf `/tour/…` ist es nicht.

Die Frage ist also nicht „können wir 200 $ zahlen", sondern **„wer stoppt es bei
20.000".**

### 7.1 Warum die Reichweite sich nicht von selbst trägt

Die Versuchung ist, den viralen Fall als Marketing zu verbuchen, das sich
rechnet. Er rechnet sich nicht zuverlässig. Alle Stufen geschätzt, wir haben zu
keiner eigene Daten:

| Stufe | Annahme | Ergebnis |
| --- | --- | --- |
| Aufrufe | viraler Link | 50.000 |
| Anmeldung | 0,3 % | 150 Konten |
| Aktivierung (lädt wirklich eine Tour hoch) | 40 % | 60 |
| Abo | 10 % der Aktiven | **6 Abos** |
| Umsatz Jahr 1 | 6 × 40 € | **240 €** |

Dagegen rund 185 € Esri plus eigener Egress. Jahr eins ist eine Nullnummer, erst
die Folgejahre tragen, weil die 240 € wiederkehren und die 185 € einmalig waren.
Und die Spanne ist weit: Bei 0,05 % Anmeldung sind es 1 Abo und 40 € gegen
185 € Kosten, also ein Verlust; bei 1 % sind es 20 Abos und 800 €. **Ein Konto
ist kein Abo**, und die meisten Zuschauer eines geteilten Links wollten nie
selbst aufzeichnen.

Daraus folgt kein Paywall (Ziffer 7 in Abschnitt 9 bleibt), sondern eine
nüchterne Einsicht: Es gibt **keinen Punkt, an dem mehr Zuschauer sich
automatisch bezahlt machen.** Die Kosten wachsen linear, die Abos nicht. Was den
Fall trotzdem harmlos macht, ist allein die absolute Größe. 185 € sind ein
ärgerlicher Monat, kein existenzielles Ereignis. Bei 500.000 Aufrufen gilt das
nicht mehr.

### 7.2 Die Notbremse gehört uns

Sie lässt sich bauen, weil der Key uns gehört und **wir** die Sessions ausgeben.
Unser Server ist damit die Stelle, an der gezählt wird, nicht Esris Dashboard.
Drei Bauteile, die zusammengehören:

1. **Monatsbudget im Server**, gezählt in Sessions. Jede ausgegebene Session
   zählt hoch, beim Erreichen wird keine neue mehr ausgegeben.
2. **Deckel je Tour**, nicht nur global. Sonst nimmt die eine virale Tour allen
   anderen die Karte weg. Wer gerade schneidet, soll weiterarbeiten können,
   während eine einzelne Tour ihr Kontingent aufbraucht.
3. **Rückfall statt Ausfall.** Über dem Deckel darf nicht die schwarze Karte
   stehen, sondern eine abgespeckte Fassung: Der Film läuft, das Gelände steht,
   das Satellitenbild ist ein anderes (Abschnitt 8). Eine degradierte Tour ist
   verkraftbar, eine tote nicht.

Der Deckel ist damit keine Sparmaßnahme, sondern eine ausgesprochene
Entscheidung: „Diese Tour darf uns 200 $ kosten, dann reden wir." Das ist die
Umkehrung des ersten Entwurfs, in dem der Ausfall der Normalzustand war und PAYG
der riskante Schalter.

Was gegen Skripte hilft, ist **Ratenbegrenzung je IP und Bot-Erkennung vor dem
Ausgeben einer Session**, nicht eine Hürde für Menschen (7.3).

### 7.3 Verworfen: Anmeldung fürs Zuschauen

Der Vorschlag kommt zwangsläufig wieder, deshalb steht hier, warum er einmal
abgelehnt wurde: **Zuschauen setzt keine Registrierung voraus.** Sie würde das
Problem nicht lösen und das Kapital vernichten, um dessen Kosten es geht.

- **Sie kehrt den Trichter um.** Die 0,3 % aus 7.1 sind eine Quote NACH dem
  Erlebnis: Jemand hat den Film gesehen und will das auch. Davor gestellt,
  verlangt dieselbe Entscheidung von jemandem, der noch nichts gesehen hat.
  Aus 50.000 Aufrufen mit 6 Abos würden vielleicht 3.000 mit weniger Abos.
  Gespart: 175 €. Bezahlt: der einzige Kanal, der Maptale ohne Werbebudget
  bekannt macht.
- **Sie trifft den Falschen.** Der Zuschauer ist das Publikum des zahlenden
  Kunden, nicht der Kostenverursacher. Wer seine Tour verschickt und hört „ich
  musste mich anmelden, dann habe ich es gelassen", hat ein schlechteres
  Produkt gekauft. Eine Anmeldung ist keine Kasse, aber dieselbe Tür (Ziffer 7
  in Abschnitt 9).
- **Sie widerspricht dem, was gebaut ist.** Die unerratbare Kennung IST die
  Sichtbarkeitsstufe `unlisted`: Wer den Link hat, darf schauen. Mit
  Anmeldepflicht hängt der Zugang am Konto und die Stufe ist sinnlos. Dazu die
  serverseitigen Vorschaukarten aus Etappe 6 und die Tour-Sitemap: Eine
  Vorschaukarte, die nach dem Antippen eine Anmeldung zeigt, ist ein
  gebrochenes Versprechen, und die indexierte Tour wäre für Suchmaschinen eine
  leere Seite.
- **Sie ist datenschutzrechtlich der falsche Weg.** Konten von Leuten anlegen,
  die nur ein Video sehen wollten, ist das Gegenteil von Datensparsamkeit.
- **Gegen Relive verliert der Link damit endgültig.** Deren geteiltes Ergebnis
  ist eine Datei, die jeder ohne alles öffnet.
- **Und sie löst das Problem nicht.** Die Gefahr waren nie 50.000 Menschen,
  sondern die fehlende Decke. Gegen ein Skript ist die Registrierung ein sehr
  teurer Filter, den es umgeht, sobald sich Konten automatisch anlegen lassen.

Richtig an dem Instinkt ist die Stelle, an der er hingehört: als **Entscheidung
des Herstellers**, nicht als Voreinstellung des Systems. Die Stufe `private`
gibt es bereits. Und der Hinweis „Mach deine eigene Tour" gehört ans **Ende**
des Films, wo die Bereitschaft entsteht, nicht an den Anfang, wo sie fehlt.

**Ein verwandter Hebel bleibt offen:** die Esri-Session erst bei Play starten,
statt beim Laden der Seite. Wer die Seite öffnet und wieder geht, kostete dann
nichts. Umsonst ist das nicht: Das Intro liegt als halbtransparenter Schleier
über der **live rotierenden Karte**, ausdrücklich so gestaltet
([style.css](../../src/style.css) `.intro`). Machbar wäre die Variante „Intro
über der billigen Quelle, Esri ab Play". Das ist eine Gestaltungsentscheidung
und gehört gemessen: Wie viele Besucher kommen überhaupt bis Play? Umami misst
die Player-Seite bereits.

---

## 8. Zweite Bildquelle

Der ganze Rest von Maptale steht auf freien Daten. Nur das Satellitenbild hängt
an einem Anbieter, der uns den Export verbietet (3.5) und das Budget nicht
deckeln kann (7). Solange Esri die einzige denkbare Quelle ist, ist jedes
Gespräch mit Esri Deutschland eines, in dem wir nichts in der Hand haben.

**Drei offene Fragen haben dieselbe Antwort:** der Rückfall für den Deckel, die
Verhandlungsposition, und der Ausweg, falls der Film nicht lizenzierbar wird.
Wer die zweite Bildquelle einmal baut, hat alle drei. Der Einbau ist
überschaubar, weil `src/map.ts` die Kachelquelle an einer Stelle setzt. Was
daran hängt, ist die Optik, nicht die Architektur.

| Quelle | Bild | Film / Video | Lage |
| --- | --- | --- | --- |
| **MapTiler** | Sentinel-2 10 m, Maxar 1 bis 2 m global, Luftbild bis 8 cm (USA, EU, Japan) | **Verkaufen sie ausdrücklich.** Materiallizenzen für Film, TV, Streaming; unbefristete Broadcast-Lizenz; Anbindung an GEOlayers | Cloud ab ~25 bis 29 $/Monat (500k Requests), unbegrenzt 295 $/Monat |
| **Mapbox** | eigenes Satelliten-Mosaik | Geregelt, aber eng: Video nur zur Bewerbung der eigenen Anwendung oder als eigens gestaltete Darstellung | Bewirbt selbst kinematische Routen-Animationen. Verhandelbar, nicht ab Werk erlaubt |
| **Google** | Earth / Photorealistic 3D Tiles | Monetarisiertes Online-Video zu Unterhaltung oder Bildung ohne Anfrage erlaubt, mit Attribution. Keine allgemeine kommerzielle Lizenz | Earth Studio ist ein Werkzeug, keine API für unseren Player |
| **Microsoft** | Bing Imagery | egal | **Scheidet aus.** Bing Maps for Enterprise abgekündigt, Ende 30. Juni 2028, Nachfolger Azure Maps |
| **Sentinel-2 selbst gehostet** | 10 m/px, global, wolkenfrei aufbereitbar | Frei. Copernicus liefert per EU-Recht frei, vollständig und offen, kommerzielle Nutzung eingeschlossen | Kann uns niemand entziehen |

**MapTiler ist der aussichtsreichste Gesprächspartner**, weil Video dort ein
Tarif ist und keine Ausnahme. Wer über einen Film verhandeln will, verhandelt
mit jemandem, dessen Preisliste den Fall schon kennt.

**Sentinel-2 ist die Ebene, die immer bleibt.** Ehrlich gesagt ist 10 m/px für
Maptales Kamerahöhe zu grob, sobald sie tief steht. Für Anflug, Übersicht und
Höhenkamm reicht es. Als Rückfall über dem Deckel (7.2) ist es genau richtig:
Der Film läuft weiter, er sieht nur weicher aus. NAIP (1 m) gilt nur für die
USA, Maxar Open Data nur für Katastrophengebiete. Beides ist keine
Weltgrundkarte.

**Was das für die Optik heißt, ist ungeprüft.** Ob `arcgis/imagery`, MapTiler
und Sentinel-2 nebeneinander als dieselbe Tour durchgehen, entscheidet ein
Vergleich am Bildschirm, nicht diese Tabelle. Das gehört gemessen, bevor
irgendwer einen Vertrag unterschreibt.

---

## 9. Leitentscheidungen

Lizenz:

1. **Anonyme World-Imagery-URL nicht als kommerzielle Grundlage.** Wechsel auf
   Location Platform, `arcgis/imagery`, Session pro Nutzer, bevor der Player
   als Produkt gilt.
2. **Kein eigener Kachel-Spiegel** ohne Esri-Vertrag. Browser-Cache nur nach
   Esris Headern.
3. **Attribution bleibt.** ⓘ und Credit am Filmende. Relive-Tafel gegen Geld
   weg ist bei uns kein Hebel.
4. **Token nicht über Nutzer teilen.** Im Gerät halten, ja (Abschnitt 5). Auf
   dem Server für alle, nein. Und nie in einen Renderer.
5. **Nicht mit einem Ja zum Film planen.** Fragen kostet nichts, aber der
   Export-Bau hängt an Abschnitt 8, nicht an Esris Antwort.
6. **Deckel vor PAYG.** Der Schalter geht erst an, wenn der Server selbst
   zählen und abschalten kann (Abschnitt 7).

Geld:

7. **Zuschauer nicht zur Kasse, und auch nicht zur Anmeldung.** Wer einen Link
   öffnet, soll den Film sehen. 0,4 Cent Esri pro Session (PAYG an, jedes Mal
   `start`) ist COGS der Reichweite, kein Preis. Eine virale Tour ist
   Marketingbudget oder Anlass für den Esri-Vertrag, kein Paywall auf
   `/tour/…`. Dass sie sich nicht von selbst trägt, ändert daran nichts (7.1).
   Der Deckel ist die Antwort, nicht der Preis, und die Registrierung ist es
   erst recht nicht (7.3).
8. **Zahlen soll, wer herstellt.** Aufnahme, Speicher, Studio, Schnitt, Musik,
   Wetter, Export.
9. **Esri-Karte nicht als Premium.** Die Karte ist das Bild. Ohne sie gibt es
   kein Produkt.
10. **Werbung nicht über dem Film.**
11. **Kein Paywall in der Alpha.** Zuerst Location Platform mit PAYG aus, Token
    je Gerät halten, Verbrauch im Dashboard. Monetarisieren, sobald
    Cloud-Export echte Kosten hat.

---

## 10. Was sich verkaufen lässt

Die Stufen folgen den echten Kosten, nicht Relives Bullet-Liste.

| Kosten bei uns | Was man verkaufen kann |
| --- | --- |
| Speicher (Fotos, Videos, Ton) | Quota. Liegt schon da. Bezahlter Speicher trägt. |
| Cloud-Render (Export-Etappe 2) | HD, Warteschlange, 1080p, Film und Clip. Relive hat den Markt beigebracht, dass die Datei Plus ist. Ein Film in Player-Tempo ist teurer als Relives Minutenclip. **Setzt Abschnitt 8 voraus**, mit Esri-Kacheln gibt es diese Zeile nicht. |
| Schnitt und Handwerk | Mehr als ein Export. Musik, Looks, unbegrenztes Speichern. |
| Länge und Menge | Lange Touren, viele Medien. Relive sperrt 12 h und Fotozahl hinter Plus. |

Freemium, das zu Maptale passt:

- **Kostenlos:** aufnehmen, hochladen, schneiden, Link teilen, Player in voller
  Qualität. Vielleicht ein 720p-Export mit Wartezeit, oder nur ein Format, oder
  der Clip statt des ganzen Films.
- **Bezahlt:** Speicher, Cloud-Export ohne Tab, 1080p, Film und Clip, keine
  lange Schlange, mehr Musik und Looks.

Der Player bleibt frei, weil er andere Leute holt. Der Export wird knapp, weil
er GPU frisst.

Stückrechnung grob: ein Abo in Relive-Größe (~40 €/Jahr) trägt sehr viele
Player-Sessions (1.000 frei, danach 4 $/1.000). Es trägt wenige schwere
Cloud-Exports, wenn jeder Lauf Minuten GPU braucht. Deshalb Export
kontingentieren (Stück/Monat, Auflösung), Speicher als Abo, Sessions als
Gemeinkosten. Eine virale Tour mit Zehntausenden Plays ohne zahlenden Urheber
ist bewusstes Defizit.

Abo eher auf der Website kassieren als nur im Store. Relive ist App-first,
Apple und Google behalten einen Schnitt. Maptale ist Web-Studio plus
Android-Aufnahme.

B2B (Tourismus, Veranstalter) ist ein späterer Preis, nicht der Alpha-Weg.

---

## 11. Was in der Alpha zu tun ist (Lizenz zuerst)

1. Location-Platform-Konto anlegen, API-Key mit Basemaps, PAYG **aus**.
2. Anonyme World-Imagery-URL durch Basemap-Styles `arcgis/imagery` und
   Session-Token ersetzen. Player und Editor.
3. Token je Gerät halten (`localStorage` oder gleichwertig, E300 Ziffer 10), nur
   bei Ablauf `/sessions/start`.
4. Nutzungsbedingungen der App: Esri-Attribution und Visualisierung in der App,
   kein Weiterverkauf der Kacheln.
5. Verbrauch im Dashboard ansehen, bevor die Galerie wirklich öffentlich
   skaliert.
6. **Deckel und Rückfall bauen** (Abschnitt 7.2), bevor PAYG angeht.
7. PAYG erst an, wenn eine Karte über 1.000 Aufrufe verkraftet werden soll und
   der Deckel steht.
8. **Zweite Bildquelle prüfen** (Abschnitt 8): MapTiler anfragen, Sentinel-2
   probeweise in `src/map.ts` einhängen, Optik nebeneinander vergleichen.
9. Export NICHT auf Esri-Kacheln bauen. Der Cloud-Render braucht die zweite
   Quelle, nicht Esris Erlaubnis.
10. Ab ein paar zehntausend Plays im Monat: Gespräch mit Esri Deutschland,
    dann mit einer Alternative in der Hand.

---

## 12. Offenes

- Bietet Esri einen Sondervertrag an, der Film und serverseitiges Rendern
  einschließt, und zu welchem Preis? (Die Aktenlage sagt nein, siehe 3.5. Die
  Frage ist, was verhandelbar ist.)
- Wann der Wechsel von PAYG-Sessions zum Enterprise-Vertrag (Cache, Pauschale)?
- Ob `arcgis/imagery` über Location Platform optisch dasselbe ist wie die
  heutige World-Imagery-URL. Rechtlich ist die Frage mit 3.4 beantwortet.
- Wie MapTiler, Sentinel-2 und `arcgis/imagery` in derselben Tour nebeneinander
  aussehen. Gehört gemessen, nicht geschätzt.
- Was ein Rückfall auf 10 m/px an der Kamerahöhe wirklich anrichtet, und ob die
  Kamera dabei höher gehen sollte.
- Wie viele Besucher einer geteilten Tour überhaupt bis Play kommen. Erst diese
  Zahl entscheidet, ob „Esri-Session erst bei Play" den Umbau des Intros wert
  ist (7.3). Umami misst die Player-Seite bereits.
- Welche Sätze in AGB und Datenschutz die Location-Platform-Regeln an Zuschauer
  durchreichen müssen.

Quellen: [Location Platform Pricing](https://location.arcgis.com/pricing/),
[Basemap usage](https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/basemap-usage-styles/),
[sessions/start](https://developers.arcgis.com/rest/basemap-styles/sessions-start-get/),
[Esri FAQ zu Living-Atlas-Items](https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf),
[Location-Platform-Vertrag E204](https://www.esri.com/content/dam/esrisites/en-us/media/legal/platform/platform-legal.pdf),
[Produktspezifische Nutzungsbedingungen E300](https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf),
[Static Maps](https://doc.arcgis.com/en/arcgis-online/reference/static-maps.htm),
[Kein Ausgabenlimit bei PAYG](https://community.esri.com/t5/arcgis-location-platform-developers-ques/no-way-to-limit-billing-usage/td-p/1553058),
[Relive Plus](https://www.relive.com/plus).

Zweite Bildquelle: [MapTiler Satellite](https://www.maptiler.com/maps/satellite/),
[MapTiler Video- und Broadcast-Lizenzen (GEOlayers)](https://www.maptiler.com/cloud/geolayers/),
[Mapbox Product Terms](https://www.mapbox.com/legal/tos),
[Google Earth Studio FAQ](https://www.google.com/earth/studio/faq/),
[Bing Maps for Enterprise: Ende und Umstieg](https://blogs.bing.com/maps/2025-01/What-are-my-options-regarding-Bing-Maps-for-Enterprise-Retirement),
[Copernicus Sentinel-2 als freie Quelle](https://eos.com/blog/free-satellite-imagery-sources/).
