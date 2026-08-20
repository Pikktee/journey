// Hülle der Kontoeinstellungen: holt die Daten und hängt sie in den DOM. Alles,
// was entschieden oder gerechnet werden muss, steht in kontomodell.ts, die
// Formulare in kontodialoge.ts (nachgeladen — s. dort).
//
// Die Seite ist bewusst NICHT Teil des Studios: Das Studio ist der
// Schneideraum, das hier ist der Ordner mit den Papieren. Sie ist auch nicht
// die Profilseite — dort steht, was andere sehen, hier, was das Konto ausmacht.
// Der einzige Zustand, den sich beide teilen (öffentlich ja/nein), steht
// deshalb an beiden Stellen und schreibt dasselbe Feld.

import { pfad, profilPfad } from '../routen.js'
import { profilSichtbarSatz, suchmaschinenSatz } from '../sichtbarkeit.js'
import { ladeTracker, loeseTrackerRueckkehrEin } from './trackerkarte.js'
import {
  belegtProzent,
  exportZeile,
  geraeteName,
  geraeteSymbol,
  geraeteUnterzeile,
  groesse,
  speicherAbschnitte,
  speicherKnapp,
  type ExportStand,
  type Geraet,
  type SpeicherStand,
} from './kontomodell.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Die Zeichen der Oberfläche — Pfaddaten, damit sie nicht als Markup im HTML stehen. */
const ZEICHEN: Record<string, string> = {
  rechner: 'M3 4.5h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z|M8 19.5h8',
  telefon: 'M7.5 2.5h9a2 2 0 012 2v15a2 2 0 01-2 2h-9a2 2 0 01-2-2v-15a2 2 0 012-2z|M10.5 18.5h3',
  app: 'M7.5 2.5h9a2 2 0 012 2v15a2 2 0 01-2 2h-9a2 2 0 01-2-2v-15a2 2 0 012-2z|M9 6.8l3.2 4.2L15 8.4l0 3.6',
  haken: 'M20 6L9 17l-5-5',
  achtung: 'M12 4.5l8.5 15h-17z|M12 10v4M12 16.8v.2',
}

/** Farben der Balkenabschnitte — dieselbe Reihenfolge wie in `speicherAbschnitte`. */
const FARBEN: Record<string, string> = {
  fotos: 'var(--akzent)',
  videos: 'var(--akzent-2)',
  audio: 'var(--lila)',
  recordings: 'var(--blau)',
  other: 'rgba(242, 237, 227, 0.42)',
}

function zeichne(art: string, strichstaerke = '1.7'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', strichstaerke)
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of (ZEICHEN[art] ?? '').split('|')) {
    const pfadEl = document.createElementNS(SVG_NS, 'path')
    pfadEl.setAttribute('d', d)
    svg.appendChild(pfadEl)
  }
  return svg
}

const $ = (id: string): HTMLElement | null => document.getElementById(id)

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  klasse?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const knoten = document.createElement(tag)
  if (klasse) knoten.className = klasse
  if (text !== undefined) knoten.textContent = text
  return knoten
}

/** Kurze Rückmeldung unten rechts; sie verschwindet von selbst. */
let toastZeit: number | undefined
function melde(text: string): void {
  const toast = $('toast')
  const inhalt = $('toast-text')
  if (!toast || !inhalt) return
  inhalt.textContent = text
  toast.classList.add('sichtbar')
  window.clearTimeout(toastZeit)
  toastZeit = window.setTimeout(() => toast.classList.remove('sichtbar'), 4000)
}

function zeigeHinweis(text: string, link?: { text: string; href: string }): void {
  const ziel = $('meldung')
  if (!ziel) return
  const p = el('p', 'hinweis', text)
  if (link) {
    p.appendChild(document.createTextNode(' '))
    const a = el('a', undefined, link.text)
    a.href = link.href
    a.style.color = 'var(--akzent)'
    p.appendChild(a)
  }
  ziel.replaceChildren(p)
}

interface MeAntwort {
  benutzer: { id: string; email: string; name: string; role: string } | null
  verified?: boolean
  newsletter?: boolean
  profile?: {
    handle: string | null
    displayName: string | null
    visibility: 'private' | 'public'
    searchIndexing?: boolean
  }
  export?: ExportStand | null
}

// ————— Anmeldung & Sicherheit —————

function zeichneKonto(daten: MeAntwort): void {
  const mail = $('k-email')
  if (mail) mail.textContent = daten.benutzer?.email ?? ''

  const stand = $('k-mailstand')
  if (stand) {
    stand.replaceChildren()
    if (daten.verified) {
      stand.className = 'marke gut'
      stand.appendChild(zeichne('haken', '2.4'))
      stand.appendChild(document.createTextNode('bestätigt'))
    } else {
      // Kein stiller Haken auf einer unbestätigten Adresse: Ohne Bestätigung
      // lässt sich nichts hochladen, und das steht sonst nirgends auf dieser Seite.
      stand.className = 'marke offen'
      stand.appendChild(zeichne('achtung', '1.9'))
      stand.appendChild(document.createTextNode('unbestätigt'))
    }
  }
}

// ————— Geräte —————

function geraeteZeile(device: Geraet, beiAbmelden: (g: Geraet) => void): HTMLElement {
  const zeile = el('div', device.current ? 'zeile hier' : 'zeile')

  const symbol = el('span', 'sym')
  symbol.appendChild(zeichne(geraeteSymbol(device)))
  zeile.appendChild(symbol)

  const z = el('span', 'z')
  const titel = el('span', 't')
  titel.appendChild(document.createTextNode(geraeteName(device)))
  if (device.current) {
    const selbst = el('span', 'selbst', ' · dieses Gerät')
    titel.appendChild(selbst)
  }
  z.appendChild(titel)
  const unterzeile = geraeteUnterzeile(device)
  if (unterzeile) z.appendChild(el('span', 'b', unterzeile))
  zeile.appendChild(z)

  // Das eigene Gerät bekommt keinen Knopf: Sich hier abzumelden gewinnt nichts,
  // außer sich gleich wieder anmelden zu dürfen — dafür gibt es das Konto-Menü.
  if (!device.current) {
    const knopf = el('button', 'knopf gefahr', 'Abmelden')
    knopf.type = 'button'
    knopf.addEventListener('click', () => {
      knopf.disabled = true
      beiAbmelden(device)
    })
    zeile.appendChild(knopf)
  }
  return zeile
}

async function ladeGeraete(): Promise<void> {
  const tafel = $('geraete')
  if (!tafel) return
  let devices: Geraet[] = []
  try {
    const antwort = await fetch('/api/auth/me/geraete')
    if (!antwort.ok) throw new Error(String(antwort.status))
    devices = ((await antwort.json()) as { devices: Geraet[] }).devices
  } catch {
    tafel.replaceChildren(zeileMitText('Die Geräteliste ließ sich gerade nicht laden.'))
    return
  }

  const abmelden = async (device: Geraet): Promise<void> => {
    const antwort = await fetch(`/api/auth/me/devices/${encodeURIComponent(device.id)}`, {
      method: 'DELETE',
    })
    if (!antwort.ok) {
      melde('Das Gerät ließ sich nicht abmelden.')
      return
    }
    melde(`${geraeteName(device)} wurde abgemeldet.`)
    void ladeGeraete()
  }

  tafel.replaceChildren(...devices.map((g) => geraeteZeile(g, (ziel) => void abmelden(ziel))))
}

function zeileMitText(text: string): HTMLElement {
  const zeile = el('div', 'zeile')
  const z = el('span', 'z')
  z.appendChild(el('span', 'b', text))
  zeile.appendChild(z)
  return zeile
}

// ————— Speicher —————

async function ladeSpeicher(): Promise<void> {
  const balken = $('sp-balken')
  const legende = $('sp-legende')
  if (!balken || !legende) return
  let stand: SpeicherStand
  try {
    const antwort = await fetch('/api/auth/me/speicher')
    if (!antwort.ok) throw new Error(String(antwort.status))
    stand = (await antwort.json()) as SpeicherStand
  } catch {
    legende.replaceChildren(
      el('span', undefined, 'Der Speicherstand ließ sich gerade nicht laden.'),
    )
    return
  }

  const belegt = $('sp-belegt')
  if (belegt) belegt.textContent = groesse(stand.used)
  const von = $('sp-von')
  if (von) von.textContent = `von ${groesse(stand.limit)} belegt`
  const prozent = $('sp-prozent')
  if (prozent) prozent.textContent = `${Math.round(belegtProzent(stand))} %`

  const abschnitte = speicherAbschnitte(stand)
  balken.replaceChildren(
    ...abschnitte.map((a) => {
      const i = el('i')
      i.style.width = `${a.prozent}%`
      i.style.background = FARBEN[a.art] ?? FARBEN.other!
      return i
    }),
  )
  legende.replaceChildren(
    ...abschnitte.map((a) => {
      const span = el('span')
      const punkt = el('i')
      punkt.style.background = FARBEN[a.art] ?? FARBEN.other!
      span.appendChild(punkt)
      span.appendChild(document.createTextNode(`${a.wort} `))
      span.appendChild(el('b', undefined, groesse(a.bytes)))
      return span
    }),
  )
  // Ein leeres Konto bekommt keine leere Legende hingestellt.
  if (!abschnitte.length) legende.replaceChildren(el('span', undefined, 'Noch nichts hochgeladen.'))

  const warnung = $('sp-warnung')
  if (warnung) warnung.hidden = !speicherKnapp(stand)
}

// ————— Sichtbarkeit —————

function verdrahteSichtbarkeit(daten: MeAntwort): void {
  const schalter = $('s-profil') as HTMLInputElement | null
  const erklaerung = $('s-profil-erklaerung')
  if (!schalter) return
  const handle = daten.profile?.handle ?? null
  const adresse = handle ? `${window.location.host}${profilPfad(handle)}` : 'deiner Profilseite'
  schalter.checked = daten.profile?.visibility === 'public'
  const zeigeSatz = (): void => {
    if (erklaerung) erklaerung.textContent = profilSichtbarSatz(schalter.checked, adresse)
  }
  zeigeSatz()
  schalter.addEventListener('change', async () => {
    const gewuenscht = schalter.checked
    schalter.disabled = true
    const antwort = await fetch('/api/auth/me/profil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: gewuenscht ? 'public' : 'private' }),
    }).catch(() => null)
    schalter.disabled = false
    if (!antwort?.ok) {
      // Zurückstellen statt eine Änderung zu zeigen, die der Server nicht kennt.
      schalter.checked = !gewuenscht
      zeigeSatz()
      melde('Die Sichtbarkeit ließ sich nicht ändern.')
      return
    }
    zeigeSatz()
    melde(gewuenscht ? 'Dein Profil ist jetzt öffentlich.' : 'Dein Profil ist jetzt privat.')
    // Der Schalter darunter hängt an diesem: Ohne öffentliches Profil ist „In
    // Suchmaschinen erscheinen" folgenlos — und das muss man sehen, ohne die
    // Seite neu zu laden.
    zeigeSuche()
  })
}

// ————— In Suchmaschinen erscheinen —————

/**
 * Zeile und Zustand des Schalters „In Suchmaschinen erscheinen".
 *
 * Bei privatem Profil ist er GESPERRT und die Zeile sagt, worauf er wartet: Ein
 * bedienbarer Schalter, der nichts tut, ist die schlechtere Auskunft als einer,
 * der sichtbar auf etwas wartet. Entschieden wird ohnehin im Server: `index`
 * gibt es nur für ein öffentliches Profil MIT diesem Schalter
 * (server/src/routes/seiten.ts).
 *
 * Eigene Funktion, weil zwei Stellen sie brauchen: der Aufbau und jeder Wechsel
 * der Sichtbarkeit darüber.
 */
function zeigeSuche(): void {
  const schalter = $('s-suche') as HTMLInputElement | null
  const profilSchalter = $('s-profil') as HTMLInputElement | null
  const zeile = $('s-suche-erklaerung')
  if (!schalter) return
  const oeffentlich = profilSchalter?.checked === true
  schalter.disabled = !oeffentlich
  schalter.closest('.zeile')?.classList.toggle('ruht', !oeffentlich)
  if (zeile) zeile.textContent = suchmaschinenSatz(schalter.checked, oeffentlich)
}

function verdrahteSuche(daten: MeAntwort): void {
  const schalter = $('s-suche') as HTMLInputElement | null
  if (!schalter) return
  schalter.checked = daten.profile?.searchIndexing === true
  zeigeSuche()

  schalter.addEventListener('change', async () => {
    const gewuenscht = schalter.checked
    schalter.disabled = true
    const antwort = await fetch('/api/auth/me/suchmaschinen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ an: gewuenscht }),
    }).catch(() => null)
    schalter.disabled = false
    if (!antwort?.ok) {
      // Zurückstellen statt eine Einstellung zu zeigen, die der Server nicht kennt.
      schalter.checked = !gewuenscht
      zeigeSuche()
      melde('Die Einstellung ließ sich nicht ändern.')
      return
    }
    zeigeSuche()
    melde(
      gewuenscht
        ? 'Deine Profilseite darf in Suchergebnissen erscheinen.'
        : 'Deine Profilseite erscheint nicht mehr in Suchergebnissen.',
    )
  })
}

// ————— Datenexport —————

/**
 * Der Knopf „ZIP anfordern".
 *
 * Er wartet NICHT auf das Archiv: Die Route antwortet sofort, gebaut wird im
 * Hintergrund, und das Ergebnis kommt per Mail. Deshalb sagt die Rückmeldung
 * genau das — ein Spinner, der Minuten läuft, wäre eine Lüge über die Dauer,
 * und ein Fortschrittsbalken bräuchte einen zweiten Kanal, den es nicht gibt.
 *
 * Läuft schon einer, antwortet der Server mit demselben Auftrag (er legt keinen
 * zweiten an), und wir sagen es an der Zeile. Der Knopf bleibt danach gesperrt:
 * Ein zweiter Klick änderte nichts, sähe aber aus, als täte er es.
 */
function verdrahteExport(daten: MeAntwort): void {
  const knopf = $('btn-export') as HTMLButtonElement | null
  const zeile = $('ex-stand')
  if (!knopf) return

  const zeige = (stand: ExportStand | null | undefined): void => {
    if (zeile) zeile.textContent = exportZeile(stand)
    knopf.disabled = stand?.status === 'laeuft'
  }
  zeige(daten.export)

  // Der Klick fragt erst nach (s. oeffneExportDialog) — der Lauf dahinter
  // dauert Minuten und lässt sich nicht abbrechen.
  const starte = async (): Promise<void> => {
    knopf.disabled = true
    const antwort = await fetch('/api/auth/me/export', { method: 'POST' }).catch(() => null)
    if (!antwort?.ok) {
      knopf.disabled = false
      melde(
        antwort?.status === 429
          ? 'Du hast in der letzten Stunde schon mehrere Archive angefordert.'
          : 'Der Export ließ sich nicht starten.',
      )
      return
    }
    const stand = (await antwort.json().catch(() => null)) as { export?: ExportStand } | null
    zeige(stand?.export)
    melde('Export gestartet. Du bekommst eine Mail, sobald das Archiv bereitliegt.')
  }

  knopf.addEventListener('click', async () => {
    const { oeffneExportDialog } = await import('./kontodialoge.js')
    oeffneExportDialog(starte)
  })
}

// ————— Newsletter —————

/**
 * Der Schalter „Updates & Neues von Maptale".
 *
 * Er ist NICHT gesperrt, solange die Adresse unbestätigt ist — gesperrt ist der
 * Versand (der Server schickt nur an bestätigte Adressen). Ein toter Schalter
 * ließe jemanden rätseln, ob die Einwilligung angekommen ist; die Zeile darunter
 * sagt stattdessen, worauf es noch wartet.
 */
function verdrahteNewsletter(daten: MeAntwort): void {
  const schalter = $('s-news') as HTMLInputElement | null
  const ruht = $('s-news-ruht')
  if (!schalter) return
  schalter.checked = daten.newsletter === true
  const zeigeRuht = (): void => {
    if (ruht) ruht.hidden = !(schalter.checked && daten.verified !== true)
  }
  zeigeRuht()

  schalter.addEventListener('change', async () => {
    const gewuenscht = schalter.checked
    schalter.disabled = true
    const antwort = await fetch('/api/auth/me/newsletter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ an: gewuenscht }),
    }).catch(() => null)
    schalter.disabled = false
    if (!antwort?.ok) {
      // Zurückstellen statt eine Einwilligung zu zeigen, die niemand
      // protokolliert hat.
      schalter.checked = !gewuenscht
      zeigeRuht()
      melde('Die Einstellung ließ sich nicht ändern.')
      return
    }
    zeigeRuht()
    melde(
      gewuenscht
        ? daten.verified === true
          ? 'Du bekommst künftig Updates von Maptale.'
          : 'Notiert. Es geht los, sobald deine E-Mail-Adresse bestätigt ist.'
        : 'Du bekommst keine Updates mehr.',
    )
  })
}

/**
 * `#newsletter-aus=<token>` — der Weg aus jeder Werbemail.
 *
 * Er führt hierher und nicht auf eine eigene Seite: Wer sich abmeldet, ist im
 * selben Atemzug an der Stelle, an der er es sich anders überlegen kann. Er
 * funktioniert OHNE Anmeldung (der Token ist signiert), deshalb läuft er vor
 * der `/auth/me`-Abfrage — und wie beim Adresswechsel wird der Hash sofort aus
 * der Adresszeile geräumt.
 *
 * Der Klick auf den Link trägt schon aus; ein Bestätigungsknopf davor wäre bei
 * einer ABMELDUNG die falsche Reihenfolge (bei der Warteliste steht er, weil
 * dort eine Löschung dranhängt — hier ist die Rücknahme ein Schalter weiter
 * unten). Mail-Scanner, die Links vorab öffnen, lösen das nicht aus: Der Weg
 * ist ein POST.
 */
async function loeseNewsletterAbmeldungEin(): Promise<{ ok: boolean; text: string } | null> {
  const treffer = /^#newsletter-aus=(.+)$/.exec(window.location.hash)
  if (!treffer?.[1]) return null
  const token = decodeURIComponent(treffer[1])
  window.history.replaceState(null, '', window.location.pathname)
  const antwort = await fetch('/api/newsletter/abmelden', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => null)
  if (antwort?.ok) return { ok: true, text: 'Du bekommst keine Updates mehr von Maptale.' }
  const koerper = (await antwort?.json().catch(() => ({}))) as { fehler?: string } | undefined
  return { ok: false, text: koerper?.fehler ?? 'Dieser Abmeldelink gilt nicht mehr.' }
}

// ————— Der Bestätigungslink aus der Mail —————

/**
 * `#email=<token>` einlösen.
 *
 * Der Hash wird sofort aus der Adresszeile geräumt — ein Token, das im Verlauf
 * und in jedem geteilten Screenshot steht, ist keins mehr. Wirkt nur beim
 * LADEN der Seite (wie `#verify=`/`#reset=` im Studio), nicht bei einem
 * Hash-Wechsel in einem offenen Tab.
 */
async function loeseMailWechselEin(): Promise<boolean> {
  const treffer = /^#email=(.+)$/.exec(window.location.hash)
  if (!treffer?.[1]) return false
  const token = decodeURIComponent(treffer[1])
  window.history.replaceState(null, '', window.location.pathname)
  const antwort = await fetch('/api/auth/email-bestaetigen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => null)
  if (antwort?.ok) {
    melde('Deine neue E-Mail-Adresse ist bestätigt.')
    return true
  }
  const koerper = (await antwort?.json().catch(() => ({}))) as { fehler?: string } | undefined
  melde(koerper?.fehler ?? 'Dieser Bestätigungslink gilt nicht mehr.')
  return false
}

// ————— Aufbau —————

export async function starteKonto(): Promise<void> {
  const buehne = $('buehne')
  if (!buehne) return

  // Die Links aus der Mail zuerst: Sie ändern, was gleich darunter angezeigt
  // wird (Adresse bzw. Newsletter-Schalter) — in der anderen Reihenfolge stünde
  // eine Sekunde lang der alte Stand da. Die Abmeldung geht auch ohne
  // Anmeldung, deshalb steht sie vor jeder Prüfung.
  await loeseMailWechselEin()
  const abmeldung = await loeseNewsletterAbmeldungEin()
  // Die Rückkehr vom Tracker-Anbieter: Der Hash wird sofort geräumt, damit ein
  // Neuladen nicht „Verbunden." meldet, ohne dass etwas verbunden wurde.
  const trackerRueckkehr = loeseTrackerRueckkehrEin()

  let daten: MeAntwort
  try {
    const antwort = await fetch('/api/auth/me')
    if (!antwort.ok) throw new Error(String(antwort.status))
    daten = (await antwort.json()) as MeAntwort
  } catch {
    zeigeHinweis('Die Kontoeinstellungen ließen sich gerade nicht laden.')
    return
  }
  if (!daten.benutzer) {
    // Wer aus einer Mail kommt, hat sein Anliegen hier schon erledigt — ihm
    // eine Anmeldemaske hinzustellen, hieße, den Widerruf hinter eine Hürde zu
    // schieben, die er gerade nicht gebraucht hat.
    if (abmeldung) {
      zeigeHinweis(abmeldung.text, { text: 'Zu deinem Konto', href: pfad('anmelden') })
      return
    }
    zeigeHinweis('Für die Kontoeinstellungen musst du angemeldet sein.', {
      text: 'Anmelden',
      href: pfad('anmelden'),
    })
    return
  }
  if (abmeldung) melde(abmeldung.text)

  buehne.hidden = false
  document.title = 'Kontoeinstellungen · Maptale'

  zeichneKonto(daten)
  verdrahteNewsletter(daten)
  verdrahteSichtbarkeit(daten)
  verdrahteSuche(daten)
  verdrahteExport(daten)
  void ladeGeraete()
  void ladeSpeicher()
  void ladeTracker(melde)
  if (trackerRueckkehr) melde(trackerRueckkehr)

  // Die Formulare erst beim ersten Griff — sie bringen die Passwortbewertung mit.
  const dialoge = async (): Promise<typeof import('./kontodialoge.js')> =>
    import('./kontodialoge.js')

  $('btn-mail')?.addEventListener('click', async () => {
    ;(await dialoge()).oeffneMailDialog(melde)
  })
  $('btn-passwort')?.addEventListener('click', async () => {
    // Name und Adresse fließen in die Bewertung ein: Ein Passwort, in dem der
    // eigene Name steht, ist kein gutes.
    const persoenlich = (): string[] =>
      [daten.benutzer?.name, daten.benutzer?.email, daten.profile?.displayName].filter(
        (w): w is string => !!w,
      )
    ;(await dialoge()).oeffnePasswortDialog((text) => {
      melde(text)
      // Der Wechsel hat alle anderen Zugänge beendet — die Liste zeigt es.
      void ladeGeraete()
    }, persoenlich)
  })
  $('btn-loeschen')?.addEventListener('click', async () => {
    ;(await dialoge()).oeffneLoeschDialog(() => {
      window.location.href = pfad('start')
    })
  })
}
