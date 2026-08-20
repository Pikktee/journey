// Das Aussehen der System-Mails: aus denselben Bausteinen entstehen HTML- und
// Text-Fassung — eine Quelle, zwei Ausgaben.
//
// Warum Tabellen und Inline-Styles statt der CSS, die wir sonst schreiben:
// Mail-Programme sind kein Browser. Outlook rendert mit Word, Gmail wirft
// `<style>`-Blöcke in manchen Ansichten weg, `flex`/`grid` gibt es praktisch
// nirgends. Was hier steht, sieht altmodisch aus und ist der Stand der Technik
// für Mails.
//
// Die MARKE bleibt trotzdem dieselbe (DESIGN.md): warmes Dunkel, Amber-Verlauf,
// Outfit. Drei Dinge, die man dabei leicht kaputtmacht:
//
//   1. **Die Fläche muss zweifach gesetzt sein** — als `bgcolor`-Attribut UND
//      als Inline-Style. Nur das Attribut überlebt Outlook, nur der Style
//      überlebt manche Webmailer. Fehlt eins, steht heller Text auf Weiß.
//   2. **Der Knopf ist eine Tabelle mit Hintergrundfarbe**, kein `<button>` und
//      kein reiner Verlauf: Der Verlauf ist Zugabe (`background-image`), die
//      Farbe darunter (`bgcolor`) ist das, was in Outlook ankommt.
//   3. **Das Logo ist ein PNG mit `alt`-Text.** Bilder sind in vielen Clients
//      erst nach einem Klick sichtbar — der Alt-Text ist deshalb so gestaltet,
//      dass an seiner Stelle die Wortmarke steht und nicht ein leeres Kästchen.

import { WEB_PATHS } from './web-paths.js'

/** Die vom Betreiber bearbeitbaren Teile einer Mail. Alles andere ist Layout. */
export interface MailParts {
  subject: string
  /** Überschrift im Mail-Körper — im Text die erste Zeile. */
  title: string
  /** Absätze vor dem Knopf. Leerzeile trennt, einfacher Umbruch bleibt einer. */
  text: string
  /** Beschriftung des Knopfs; leer = kein Knopf (der Link steht dann im Text). */
  button: string
  /** Kleingedrucktes unter dem Knopf — Gültigkeit, Widerspruch, „war ich das nicht?". */
  footer: string
}

export interface LayoutContext {
  /** Öffentliche Basis-URL für Logo und Fußzeile, ohne Schrägstrich am Ende. */
  basisUrl: string
  /** Ziel des Knopfs; ohne Wert wird kein Knopf gezeichnet. */
  link?: string
}

export interface RenderedMail {
  betreff: string
  text: string
  html: string
}

const FARBEN = {
  aussen: '#06090E',
  karte: '#10151d',
  rand: '#222b37',
  tief: '#080b11',
  text: '#F2EDE3',
  gedaempft: '#a7b1bf',
  leise: '#67727f',
  amber: '#F59E0B',
  koralle: '#FF6F52',
  aufAmber: '#221302',
} as const

const SCHRIFT = "'Outfit','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

/** Platzhalter der Form `{{name}}` durch Werte ersetzen; Unbekanntes bleibt stehen. */
export function fillPlaceholders(text: string, werte: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (treffer, name: string) =>
    Object.prototype.hasOwnProperty.call(werte, name) ? (werte[name] ?? '') : treffer,
  )
}

/** Welche Platzhalter in einem Text vorkommen — für Prüfung und Oberfläche. */
export function findPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1] as string))]
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Nackte URLs im Fließtext anklickbar machen.
 *
 * Läuft NACH dem Escapen, deshalb steht im href schon `&amp;` — genau so
 * gehört es ins Attribut. Nachlaufende Satzzeichen gehören zum Satz, nicht zur
 * Adresse; ohne diesen Schnitt hinge der Punkt am Ende im Link.
 */
function verlinke(html: string): string {
  return html.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const schwanz = url.match(/[.,;:!?)\]]+$/)?.[0] ?? ''
    const ziel = url.slice(0, url.length - schwanz.length)
    return `<a href="${ziel}" style="color:${FARBEN.amber};text-decoration:underline;word-break:break-all;">${ziel}</a>${schwanz}`
  })
}

/** Text in Absätze schneiden: Leerzeile trennt, einfacher Umbruch bleibt einer. */
const absaetze = (text: string): string[] =>
  text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((a) => a.trim())
    .filter(Boolean)

/**
 * Ein Absatz, der aus NICHTS als `{{code}}` besteht, wird zur Code-Box.
 *
 * Die Alternative wäre ein eigenes Feld „Code hervorheben" gewesen — ein
 * Formularfeld mehr für eine Entscheidung, die man am Text schon sieht.
 */
const istCodeAbsatz = (roh: string): boolean => /^\{\{\s*code\s*\}\}$/.test(roh.trim())

function absatzHtml(inhalt: string): string {
  return `<p style="margin:0 0 16px;font-family:${SCHRIFT};font-size:16px;line-height:1.65;color:${FARBEN.text};">${inhalt}</p>`
}

function codeBoxHtml(code: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;">` +
    `<tr><td bgcolor="${FARBEN.tief}" style="background-color:${FARBEN.tief};border:1px solid ${FARBEN.rand};border-radius:12px;padding:14px 22px;` +
    `font-family:${SCHRIFT};font-size:24px;font-weight:600;letter-spacing:0.12em;color:${FARBEN.amber};white-space:nowrap;">` +
    `${escape(code)}</td></tr></table>`
  )
}

function knopfHtml(beschriftung: string, ziel: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;">` +
    `<tr><td align="center" bgcolor="${FARBEN.amber}" style="background-color:${FARBEN.amber};` +
    `background-image:linear-gradient(100deg,${FARBEN.amber},${FARBEN.koralle});border-radius:999px;">` +
    `<a href="${escape(ziel)}" style="display:inline-block;padding:14px 30px;font-family:${SCHRIFT};font-size:16px;` +
    `font-weight:600;color:${FARBEN.aufAmber};text-decoration:none;border-radius:999px;">${escape(beschriftung)}</a>` +
    `</td></tr></table>`
  )
}

/**
 * Die Zeile, die im Posteingang neben dem Betreff steht.
 *
 * Ohne sie zeigen Gmail und Apple Mail dort den Anfang des HTML-Quelltexts —
 * bei uns also die Fußzeile oder ein Stück Style. Versteckt wird sie über
 * `display:none` PLUS eine Reihe unsichtbarer Zeichen dahinter, damit der
 * Client nichts anderes nachzieht.
 */
function vorschauZeile(text: string): string {
  const kurz = text.replace(/\s+/g, ' ').trim().slice(0, 140)
  const fueller = '&#847;&zwnj;&nbsp;'.repeat(30)
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FARBEN.aussen};">` +
    `${escape(kurz)}${fueller}</div>`
  )
}

/**
 * Bausteine + Werte → fertige Mail (Betreff, Text, HTML).
 *
 * `werte` sind die Platzhalter-Belegungen (`name`, `code`, …). Der Link des
 * Knopfs kommt aus dem Kontext und nicht aus dem Text: Er ist der Zweck der
 * Mail und darf nicht daran hängen, ob jemand beim Bearbeiten den Platzhalter
 * stehen ließ.
 */
export function renderMail(
  bausteine: MailParts,
  werte: Record<string, string>,
  kontext: LayoutContext,
): RenderedMail {
  const basis = kontext.basisUrl.replace(/\/+$/, '')
  const fuelle = (s: string): string => fillPlaceholders(s, werte)

  const betreff = fuelle(bausteine.subject).replace(/\s+/g, ' ').trim()
  const titel = fuelle(bausteine.title).trim()
  const knopf = bausteine.button.trim()
  const zeigeKnopf = Boolean(knopf && kontext.link)

  // — HTML-Körper —
  const koerper: string[] = []
  for (const roh of absaetze(bausteine.text)) {
    if (istCodeAbsatz(roh)) {
      koerper.push(codeBoxHtml(fuelle(roh)))
      continue
    }
    koerper.push(absatzHtml(verlinke(escape(fuelle(roh)).replace(/\n/g, '<br />'))))
  }
  if (zeigeKnopf) koerper.push(knopfHtml(knopf, kontext.link as string))

  const fussBloecke = absaetze(bausteine.footer).map(
    (roh) =>
      `<p style="margin:0 0 12px;font-family:${SCHRIFT};font-size:13.5px;line-height:1.6;color:${FARBEN.gedaempft};">` +
      `${verlinke(escape(fuelle(roh)).replace(/\n/g, '<br />'))}</p>`,
  )

  // — Text-Fassung —
  const textTeile: string[] = [titel]
  for (const roh of absaetze(bausteine.text)) textTeile.push(fuelle(roh))
  // Der Link steht auf einer EIGENEN Zeile: Mail-Programme, die selbst
  // verlinken, schneiden sonst am nächsten Satzzeichen ab — und ein Token mit
  // angehängtem Punkt löst nichts ein.
  if (zeigeKnopf) textTeile.push(`${knopf}:\n${kontext.link}`)
  for (const roh of absaetze(bausteine.footer)) textTeile.push(fuelle(roh))
  textTeile.push(`Maptale\n${basis}`)
  const text = textTeile.filter(Boolean).join('\n\n')

  const html = huelle(betreff, titel, koerper.join('\n'), fussBloecke.join('\n'), basis, text)
  return { betreff, text, html }
}

/** Das Gerüst um den Inhalt: Logo, Karte, Fußzeile. */
function huelle(
  betreff: string,
  titel: string,
  koerper: string,
  fuss: string,
  basis: string,
  textFassung: string,
): string {
  const trenner = fuss
    ? `<tr><td style="padding:2px 0 20px;"><div style="height:1px;background-color:${FARBEN.rand};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>`
    : ''
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="x-ua-compatible" content="ie=edge" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escape(betreff)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
  body { margin: 0; padding: 0; width: 100% !important; }
  a { color: ${FARBEN.amber}; }
  @media only screen and (max-width: 620px) {
    .maptale-karte { padding: 26px 22px !important; }
    .maptale-titel { font-size: 24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${FARBEN.aussen};">
${vorschauZeile(textFassung)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FARBEN.aussen}" style="background-color:${FARBEN.aussen};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:34px 16px 44px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td align="center" style="padding:0 0 26px;">
            <a href="${basis}" style="text-decoration:none;">
              <img src="${basis}/branding/mail-logo.png" width="152" height="46" alt="Maptale"
                style="display:block;border:0;width:152px;height:46px;font-family:${SCHRIFT};font-size:22px;font-weight:700;color:${FARBEN.text};text-decoration:none;" />
            </a>
          </td>
        </tr>
        <tr>
          <td bgcolor="${FARBEN.karte}" class="maptale-karte" style="background-color:${FARBEN.karte};border:1px solid ${FARBEN.rand};border-radius:16px;padding:34px 36px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <h1 class="maptale-titel" style="margin:0 0 18px;font-family:${SCHRIFT};font-size:27px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${FARBEN.text};">${escape(titel)}</h1>
                  ${koerper}
                </td>
              </tr>
              ${trenner}
              ${fuss ? `<tr><td>${fuss}</td></tr>` : ''}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 12px 0;font-family:${SCHRIFT};font-size:12.5px;line-height:1.7;color:${FARBEN.leise};">
            <span style="color:${FARBEN.gedaempft};">Maptale</span> · deine Reisen als filmischer 3D-Flug.<br />
            <a href="${basis}${WEB_PATHS.impressum}" style="color:${FARBEN.leise};text-decoration:underline;">Impressum</a>
            &nbsp;·&nbsp;
            <a href="${basis}${WEB_PATHS.datenschutz}" style="color:${FARBEN.leise};text-decoration:underline;">Datenschutz</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}
